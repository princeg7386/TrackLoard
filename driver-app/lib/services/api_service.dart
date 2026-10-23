import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../core/constants/api_constants.dart';
import '../models/student_attendance_model.dart';

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

  /// Retrieves registered student list and pickup details for assigned bus or trip (Phase 18.1)
  Future<ApiResponse<DriverStudentListModel>> getAssignedStudents({
    String? busId,
    String? tripId,
  }) async {
    final queryParams = <String, String>{};
    if (busId != null && busId.isNotEmpty) {
      queryParams['busId'] = busId;
    }
    if (tripId != null && tripId.isNotEmpty) {
      queryParams['tripId'] = tripId;
    }

    final queryString = queryParams.isNotEmpty
        ? '?${queryParams.entries.map((e) => '${Uri.encodeComponent(e.key)}=${Uri.encodeComponent(e.value)}').join('&')}'
        : '';

    final res = await get('${ApiConstants.attendanceStudentsEndpoint}$queryString');
    if (!res.success || res.data == null) {
      return ApiResponse<DriverStudentListModel>(
        success: false,
        message: res.message,
        statusCode: res.statusCode,
        isOffline: res.isOffline,
      );
    }

    try {
      final model = DriverStudentListModel.fromJson(res.data!);
      return ApiResponse<DriverStudentListModel>(
        success: true,
        data: model,
        message: res.message,
        statusCode: res.statusCode,
      );
    } catch (e) {
      return ApiResponse<DriverStudentListModel>(
        success: false,
        message: 'Failed to parse student attendance list: ${e.toString()}',
        statusCode: res.statusCode,
      );
    }
  }

  /// Records boarding attendance for an individual student (Micro-Phase 18.2)
  /// Tasks: Boarded, Not boarded (ABSENT), Timestamp, Location
  Future<ApiResponse<Map<String, dynamic>>> recordBoarding({
    required String tripId,
    required String studentId,
    String? stopId,
    required String status,
    double? latitude,
    double? longitude,
    String? recordedAt,
  }) async {
    final payload = <String, dynamic>{
      'tripId': tripId,
      'studentId': studentId,
      'status': status,
      if (stopId != null) 'stopId': stopId,
      if (latitude != null) 'latitude': latitude,
      if (longitude != null) 'longitude': longitude,
      'recordedAt': recordedAt ?? DateTime.now().toUtc().toIso8601String(),
    };

    return post(ApiConstants.attendanceBoardingEndpoint, body: payload);
  }

  /// Records boarding attendance for a batch of students (Micro-Phase 18.2)
  Future<ApiResponse<Map<String, dynamic>>> recordBoardingBatch({
    required String tripId,
    String? stopId,
    required List<Map<String, dynamic>> records,
  }) async {
    final payload = <String, dynamic>{
      'tripId': tripId,
      if (stopId != null) 'stopId': stopId,
      'records': records,
    };

    return post(ApiConstants.attendanceBoardingBatchEndpoint, body: payload);
  }

  /// Records drop / deboarding attendance for a single student (Micro-Phase 18.3)
  Future<ApiResponse<Map<String, dynamic>>> recordDrop({
    required String tripId,
    required String studentId,
    String? stopId,
    String status = 'DEBOARDED',
    double? latitude,
    double? longitude,
    String? recordedAt,
  }) async {
    final payload = <String, dynamic>{
      'tripId': tripId,
      'studentId': studentId,
      'status': status,
      if (stopId != null) 'stopId': stopId,
      if (latitude != null) 'latitude': latitude,
      if (longitude != null) 'longitude': longitude,
      'recordedAt': recordedAt ?? DateTime.now().toUtc().toIso8601String(),
    };

    return post(ApiConstants.attendanceDropEndpoint, body: payload);
  }

  /// Records drop attendance for a batch of students (Micro-Phase 18.3)
  Future<ApiResponse<Map<String, dynamic>>> recordDropBatch({
    required String tripId,
    String? stopId,
    required List<Map<String, dynamic>> records,
  }) async {
    final payload = <String, dynamic>{
      'tripId': tripId,
      if (stopId != null) 'stopId': stopId,
      'records': records,
    };

    return post(ApiConstants.attendanceDropBatchEndpoint, body: payload);
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
