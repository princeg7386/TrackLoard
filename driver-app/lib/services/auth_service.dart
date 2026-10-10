import 'package:shared_preferences/shared_preferences.dart';
import '../core/constants/api_constants.dart';
import '../models/driver_profile.dart';
import '../models/last_known_state_model.dart';
import 'api_service.dart';
import 'local_database_service.dart';

/// Service responsible for managing driver session, login, SQLite state persistence, and logout
class AuthService {
  static final AuthService _instance = AuthService._internal();
  factory AuthService() => _instance;
  AuthService._internal();

  final ApiService _api = ApiService();
  final LocalDatabaseService _db = LocalDatabaseService();

  /// Attempt Driver login via phone and PIN/licenseNumber
  Future<ApiResponse<DriverProfileData>> login({
    required String phone,
    String? pin,
    String? licenseNumber,
  }) async {
    final body = <String, dynamic>{
      'phone': phone.trim(),
    };
    if (pin != null && pin.isNotEmpty) {
      body['pin'] = pin.trim();
    }
    if (licenseNumber != null && licenseNumber.isNotEmpty) {
      body['licenseNumber'] = licenseNumber.trim();
    }

    final response = await _api.post(
      ApiConstants.loginEndpoint,
      body: body,
      requiresAuth: false,
    );

    if (response.success && response.data != null) {
      final data = response.data!;
      final token = data['token']?.toString();
      final driverMap = data['driver'] is Map<String, dynamic> ? data['driver'] as Map<String, dynamic> : null;
      final busMap = data['assignedBus'] is Map<String, dynamic> ? data['assignedBus'] as Map<String, dynamic> : null;

      if (token != null && driverMap != null) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(ApiConstants.keyAuthToken, token);
        await prefs.setString(ApiConstants.keyDriverId, driverMap['id']?.toString() ?? '');
        await prefs.setString(ApiConstants.keySchoolId, driverMap['schoolId']?.toString() ?? '');
        await prefs.setString(ApiConstants.keyDriverName, driverMap['fullName']?.toString() ?? '');
        await prefs.setString(ApiConstants.keyDriverPhone, driverMap['phone']?.toString() ?? '');

        if (busMap != null) {
          await prefs.setString(ApiConstants.keyAssignedBusId, busMap['id']?.toString() ?? '');
          await prefs.setString(ApiConstants.keyAssignedBusNumber, busMap['busNumber']?.toString() ?? '');
          await prefs.setString(ApiConstants.keyAssignedBusReg, busMap['registrationNumber']?.toString() ?? '');
        } else {
          await prefs.remove(ApiConstants.keyAssignedBusId);
          await prefs.remove(ApiConstants.keyAssignedBusNumber);
          await prefs.remove(ApiConstants.keyAssignedBusReg);
        }

        // Fetch fresh full profile
        return getProfile();
      }
    }

    return ApiResponse<DriverProfileData>(
      success: false,
      message: response.message ?? 'Login failed. Please check your credentials.',
      statusCode: response.statusCode,
      isOffline: response.isOffline,
    );
  }

  /// Fetch full driver profile with assigned bus and today's trips
  Future<ApiResponse<DriverProfileData>> getProfile() async {
    final response = await _api.get(ApiConstants.profileEndpoint, requiresAuth: true);

    if (response.success && response.data != null) {
      try {
        final profile = DriverProfileData.fromJson(response.data!);

        // Persist fresh last known state snapshot into SQLite
        await _db.saveLastKnownState(
          LastKnownStateSnapshot(profile: profile),
        );

        return ApiResponse<DriverProfileData>(
          success: true,
          data: profile,
          message: response.message,
          statusCode: response.statusCode,
        );
      } catch (e) {
        return ApiResponse<DriverProfileData>(
          success: false,
          message: 'Error parsing profile: $e',
          statusCode: response.statusCode,
        );
      }
    }

    // If request failed (e.g. offline), attempt reading from SQLite last-known cache
    if (response.isOffline || response.statusCode == 0 || response.statusCode == 408) {
      final cachedSnapshot = await _db.getLastKnownState();
      if (cachedSnapshot?.profile != null) {
        return ApiResponse<DriverProfileData>(
          success: true,
          data: cachedSnapshot!.profile,
          message: 'Loaded from offline storage',
          statusCode: 200,
          isOffline: true,
        );
      }
    }

    return ApiResponse<DriverProfileData>(
      success: false,
      message: response.message,
      statusCode: response.statusCode,
      isOffline: response.isOffline,
    );
  }

  /// Check if a valid session token exists locally
  Future<bool> isLoggedIn() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString(ApiConstants.keyAuthToken);
    return token != null && token.isNotEmpty;
  }

  /// Get cached basic user details from SharedPreferences
  Future<Map<String, String?>> getStoredDriver() async {
    final prefs = await SharedPreferences.getInstance();
    return {
      'id': prefs.getString(ApiConstants.keyDriverId),
      'schoolId': prefs.getString(ApiConstants.keySchoolId),
      'fullName': prefs.getString(ApiConstants.keyDriverName),
      'phone': prefs.getString(ApiConstants.keyDriverPhone),
      'busId': prefs.getString(ApiConstants.keyAssignedBusId),
      'busNumber': prefs.getString(ApiConstants.keyAssignedBusNumber),
      'busReg': prefs.getString(ApiConstants.keyAssignedBusReg),
    };
  }

  /// Retrieve last known state directly from SQLite without network delay
  Future<LastKnownStateSnapshot?> getLastKnownSnapshot() async {
    return _db.getLastKnownState();
  }

  /// Clear driver session and local storage
  Future<void> logout() async {
    try {
      await _api.post(ApiConstants.logoutEndpoint, requiresAuth: true);
    } catch (_) {
      // Best-effort logout on backend
    }

    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(ApiConstants.keyAuthToken);
    await prefs.remove(ApiConstants.keyDriverId);
    await prefs.remove(ApiConstants.keySchoolId);
    await prefs.remove(ApiConstants.keyDriverName);
    await prefs.remove(ApiConstants.keyDriverPhone);
    await prefs.remove(ApiConstants.keyAssignedBusId);
    await prefs.remove(ApiConstants.keyAssignedBusNumber);
    await prefs.remove(ApiConstants.keyAssignedBusReg);

    // Clear local SQLite caches
    await _db.clearAll();
  }
}
