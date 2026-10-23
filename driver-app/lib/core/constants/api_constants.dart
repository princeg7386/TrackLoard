/// Application API Constants and Endpoints
class ApiConstants {
  // Configurable Base URL via --dart-define=API_BASE_URL=... with emulator/localhost fallback
  static const String defaultBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:4000/api/v1',
  );

  // Driver Authentication Endpoints
  static const String loginEndpoint = '/driver/auth/login';
  static const String logoutEndpoint = '/driver/auth/logout';
  static const String profileEndpoint = '/driver/auth/me';

  // Driver Attendance Endpoints (Phase 18)
  static const String attendanceStudentsEndpoint = '/driver/attendance/students';
  static const String attendanceBoardingEndpoint = '/driver/attendance/boarding';
  static const String attendanceBoardingBatchEndpoint = '/driver/attendance/boarding/batch';
  static const String attendanceDropEndpoint = '/driver/attendance/drop';
  static const String attendanceDropBatchEndpoint = '/driver/attendance/drop/batch';

  // Telemetry Ingestion Endpoint (used in Phase 10.2 / 10.3)
  static const String telemetryEndpoint = '/telemetry/batch';

  // Storage Keys
  static const String keyAuthToken = 'driver_auth_token';
  static const String keyDriverId = 'driver_id';
  static const String keySchoolId = 'driver_school_id';
  static const String keyDriverName = 'driver_full_name';
  static const String keyDriverPhone = 'driver_phone';
  static const String keyAssignedBusId = 'driver_assigned_bus_id';
  static const String keyAssignedBusNumber = 'driver_assigned_bus_number';
  static const String keyAssignedBusReg = 'driver_assigned_bus_reg';
}
