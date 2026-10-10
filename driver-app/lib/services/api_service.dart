import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../core/constants/api_constants.dart';

/// Response wrapper for API calls
class ApiResponse<T> {
  final bool success;
  final T? data;
  final String? message;
  final int statusCode;
  final bool isOffline;

  ApiResponse({
    required this.success,
    this.data,
    this.message,
    required this.statusCode,
    this.isOffline = false,
  });
}

/// Central API Service for handling HTTP communication with the backend
class ApiService {
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  String _baseUrl = ApiConstants.defaultBaseUrl;

  void setBaseUrl(String url) {
    _baseUrl = url.endsWith('/') ? url.substring(0, url.length - 1) : url;
  }

  String get baseUrl => _baseUrl;

  Future<Map<String, String>> _getHeaders({bool requiresAuth = true}) async {
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (requiresAuth) {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString(ApiConstants.keyAuthToken);
      if (token != null && token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }
    }

    return headers;
  }

  /// Generic POST request
  Future<ApiResponse<Map<String, dynamic>>> post(
    String endpoint, {
    Map<String, dynamic>? body,
    bool requiresAuth = true,
  }) async {
    try {
      final url = Uri.parse('$_baseUrl$endpoint');
      final headers = await _getHeaders(requiresAuth: requiresAuth);

      final response = await http
          .post(
            url,
            headers: headers,
            body: body != null ? jsonEncode(body) : null,
          )
          .timeout(const Duration(seconds: 15));

      return _processResponse(response);
    } on SocketException {
      return ApiResponse<Map<String, dynamic>>(
        success: false,
        message: 'No internet connection. Please check your network.',
        statusCode: 0,
        isOffline: true,
      );
    } on TimeoutException {
      return ApiResponse<Map<String, dynamic>>(
        success: false,
        message: 'Request timed out. Please try again.',
        statusCode: 408,
      );
    } catch (e) {
      return ApiResponse<Map<String, dynamic>>(
        success: false,
        message: 'An unexpected error occurred: ${e.toString()}',
        statusCode: 500,
      );
    }
  }

  /// Generic GET request
  Future<ApiResponse<Map<String, dynamic>>> get(
    String endpoint, {
    bool requiresAuth = true,
  }) async {
    try {
      final url = Uri.parse('$_baseUrl$endpoint');
      final headers = await _getHeaders(requiresAuth: requiresAuth);

      final response = await http
          .get(url, headers: headers)
          .timeout(const Duration(seconds: 15));

      return _processResponse(response);
    } on SocketException {
      return ApiResponse<Map<String, dynamic>>(
        success: false,
        message: 'No internet connection. Please check your network.',
        statusCode: 0,
        isOffline: true,
      );
    } on TimeoutException {
      return ApiResponse<Map<String, dynamic>>(
        success: false,
        message: 'Request timed out. Please try again.',
        statusCode: 408,
      );
    } catch (e) {
      return ApiResponse<Map<String, dynamic>>(
        success: false,
        message: 'An unexpected error occurred: ${e.toString()}',
        statusCode: 500,
      );
    }
  }

  ApiResponse<Map<String, dynamic>> _processResponse(http.Response response) {
    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      final isSuccess = response.statusCode >= 200 && response.statusCode < 300;

      if (decoded is Map<String, dynamic>) {
        final message = decoded['message']?.toString() ??
            (isSuccess ? 'Success' : 'Request failed with status ${response.statusCode}');
        final data = decoded['data'] is Map<String, dynamic>
            ? decoded['data'] as Map<String, dynamic>
            : (decoded['data'] == null ? decoded : {'raw': decoded['data']});

        return ApiResponse<Map<String, dynamic>>(
          success: isSuccess && (decoded['success'] != false),
          data: data,
          message: message,
          statusCode: response.statusCode,
        );
      }

      return ApiResponse<Map<String, dynamic>>(
        success: isSuccess,
        data: {'raw': decoded},
        message: isSuccess ? 'Success' : 'Request failed',
        statusCode: response.statusCode,
      );
    } catch (_) {
      return ApiResponse<Map<String, dynamic>>(
        success: response.statusCode >= 200 && response.statusCode < 300,
        message: response.body.isNotEmpty ? response.body : 'Status ${response.statusCode}',
        statusCode: response.statusCode,
      );
    }
  }
}
