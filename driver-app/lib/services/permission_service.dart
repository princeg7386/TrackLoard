import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';
import '../models/permission_status_model.dart';

/// Central Permission Service managing location, background location, and notification permissions
class PermissionService {
  static final PermissionService _instance = PermissionService._internal();
  factory PermissionService() => _instance;
  PermissionService._internal();

  /// Query the comprehensive permission status of the device
  Future<AppPermissionsState> checkPermissions() async {
    final isGpsEnabled = await Geolocator.isLocationServiceEnabled();
    final locationPerm = await Geolocator.checkPermission();
    final notificationStatus = await Permission.notification.status;

    return AppPermissionsState(
      isGpsServiceEnabled: isGpsEnabled,
      locationPermission: locationPerm,
      isNotificationGranted: notificationStatus.isGranted,
    );
  }

  /// Request foreground location permission (Fine / Coarse)
  Future<LocationPermission> requestForegroundLocation() async {
    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    return permission;
  }

  /// Request background location permission ("Allow all the time")
  /// Android requires foreground location to be granted first before requesting background location.
  Future<PermissionStatus> requestBackgroundLocation() async {
    // First ensure foreground location is granted
    final locationPerm = await Geolocator.checkPermission();
    if (locationPerm == LocationPermission.denied ||
        locationPerm == LocationPermission.deniedForever) {
      final requested = await Geolocator.requestPermission();
      if (requested == LocationPermission.denied ||
          requested == LocationPermission.deniedForever) {
        return PermissionStatus.denied;
      }
    }

    // Now request locationAlways permission
    final status = await Permission.locationAlways.request();
    return status;
  }

  /// Request notification permission (Android 13+ POST_NOTIFICATIONS)
  Future<PermissionStatus> requestNotificationPermission() async {
    final status = await Permission.notification.request();
    return status;
  }

  /// Sequential step-by-step permission requester
  Future<AppPermissionsState> requestAllSequentially() async {
    // Step 1: Notifications
    await requestNotificationPermission();

    // Step 2: Foreground location
    await requestForegroundLocation();

    // Step 3: Background location
    await requestBackgroundLocation();

    // Re-check and return fresh state
    return checkPermissions();
  }

  /// Open device OS app settings page if permissions were permanently denied
  Future<bool> openAppSettings() async {
    return Geolocator.openAppSettings();
  }

  /// Open device GPS hardware settings page
  Future<bool> openLocationSettings() async {
    return Geolocator.openLocationSettings();
  }
}
