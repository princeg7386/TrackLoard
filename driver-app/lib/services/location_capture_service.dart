import 'dart:async';
import 'package:geolocator/geolocator.dart';
import '../models/device_status_model.dart';
import 'device_status_service.dart';
import 'telemetry_upload_service.dart';

/// Continuous Location Capture Engine.
///
/// Uses Geolocator with [AndroidSettings] and a [ForegroundNotificationConfig]
/// so the OS keeps the position stream alive when the screen locks.
/// The foreground notification is shown only while a trip is active.
class LocationCaptureService {
  static final LocationCaptureService _instance = LocationCaptureService._internal();
  factory LocationCaptureService() => _instance;
  LocationCaptureService._internal();

  final DeviceStatusService _deviceStatus = DeviceStatusService();
  final TelemetryUploadService _uploadService = TelemetryUploadService();

  StreamSubscription<Position>? _positionStreamSub;
  bool _isCapturing = false;
  bool get isCapturing => _isCapturing;

  String? _activeTripId;
  String? _activeBusId;
  String? _activeDriverId;

  /// Start continuous location capture for an active trip.
  ///
  /// Passes [AndroidSettings] with a [ForegroundNotificationConfig] so Android
  /// keeps the stream running when the screen is locked — no separate background
  /// isolate or flutter_background_service dependency required.
  Future<bool> startTripCapture({
    required String tripId,
    required String busId,
    required String driverId,
  }) async {
    if (_isCapturing && _activeTripId == tripId) return true;

    _activeTripId = tripId;
    _activeBusId = busId;
    _activeDriverId = driverId;
    _isCapturing = true;
    _uploadService.reset();

    try {
      final isGpsEnabled = await Geolocator.isLocationServiceEnabled();
      if (!isGpsEnabled) return false;

      final perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        return false;
      }

      // AndroidSettings with foregroundNotificationConfig keeps GPS alive when
      // the screen locks — the OS treats the stream as a foreground service.
      final locationSettings = AndroidSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 5,
        foregroundNotificationConfig: ForegroundNotificationConfig(
          notificationText: 'BUSLOARD is tracking bus location',
          notificationTitle: 'BUSLOARD GPS Active',
          enableWakeLock: true,
          notificationIcon: AndroidResource(
            name: 'ic_launcher',
            defType: 'mipmap',
          ),
        ),
      );

      _positionStreamSub?.cancel();
      _positionStreamSub = Geolocator.getPositionStream(
        locationSettings: locationSettings,
      ).listen(
        (Position pos) {
          _processLocationUpdate(pos);
        },
        onError: (_) {
          // Ignore transient GPS stream errors; service auto-recovers
        },
      );

      // Force immediate initial capture ping
      final initialPos = await Geolocator.getCurrentPosition();
      _processLocationUpdate(initialPos);

      return true;
    } catch (_) {
      return false;
    }
  }

  /// Stop active trip capture and dismiss the foreground notification.
  void stopTripCapture() {
    _isCapturing = false;
    _activeTripId = null;
    _activeBusId = null;
    _activeDriverId = null;
    _positionStreamSub?.cancel();
    _positionStreamSub = null;
    _uploadService.reset();
  }

  void _processLocationUpdate(Position pos) {
    if (!_isCapturing || _activeTripId == null || _activeBusId == null || _activeDriverId == null) {
      return;
    }

    final snapshot = _deviceStatus.currentSnapshot;

    String networkTypeStr;
    switch (snapshot.network.type) {
      case NetworkType.cellular:
        networkTypeStr = 'CELLULAR';
        break;
      case NetworkType.wifi:
        networkTypeStr = 'WIFI';
        break;
      case NetworkType.none:
        networkTypeStr = 'OFFLINE';
        break;
      case NetworkType.ethernet:
      case NetworkType.unknown:
      default:
        networkTypeStr = 'UNKNOWN';
    }

    final speedKmh = (pos.speed * 3.6).clamp(0.0, 160.0);

    _uploadService.processAndUploadLocation(
      tripId: _activeTripId!,
      busId: _activeBusId!,
      driverId: _activeDriverId!,
      latitude: pos.latitude,
      longitude: pos.longitude,
      speedKmh: speedKmh,
      bearingDegrees: pos.heading >= 0 ? pos.heading : null,
      accuracyMeters: pos.accuracy > 0 ? pos.accuracy : null,
      batteryPercentage: snapshot.battery.levelPercentage,
      isCharging: snapshot.battery.isCharging,
      networkType: networkTypeStr,
      timestamp: pos.timestamp,
    );
  }
}
