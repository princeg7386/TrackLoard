import 'package:geolocator/geolocator.dart';

/// Detailed model tracking device permissions and hardware status
class AppPermissionsState {
  final bool isGpsServiceEnabled;
  final LocationPermission locationPermission;
  final bool isNotificationGranted;

  AppPermissionsState({
    required this.isGpsServiceEnabled,
    required this.locationPermission,
    required this.isNotificationGranted,
  });

  /// Check if foreground location (while in use or always) is granted
  bool get isForegroundLocationGranted =>
      locationPermission == LocationPermission.whileInUse ||
      locationPermission == LocationPermission.always;

  /// Check if background location ('Allow all the time') is granted
  bool get isBackgroundLocationGranted =>
      locationPermission == LocationPermission.always;

  /// Check if location permission is permanently denied (needs app settings)
  bool get isLocationPermanentlyDenied =>
      locationPermission == LocationPermission.deniedForever;

  /// Check if essential tracking permissions (GPS on + Foreground Location) are ready
  bool get isEssentialReady =>
      isGpsServiceEnabled && isForegroundLocationGranted;

  /// Check if 100% optimal background telemetry permissions are ready
  bool get isFullTelemetryReady =>
      isGpsServiceEnabled &&
      isBackgroundLocationGranted &&
      isNotificationGranted;

  /// Get list of human-readable missing permissions
  List<String> get missingPermissions {
    final list = <String>[];
    if (!isGpsServiceEnabled) {
      list.add('Device GPS Hardware Disabled');
    }
    if (!isForegroundLocationGranted) {
      list.add('Location Permission Denied');
    } else if (!isBackgroundLocationGranted) {
      list.add('Background Location ("Allow all the time") Missing');
    }
    if (!isNotificationGranted) {
      list.add('Notification Permission Missing');
    }
    return list;
  }
}
