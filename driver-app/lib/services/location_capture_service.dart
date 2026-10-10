import 'dart:async';
import 'package:geolocator/geolocator.dart';
import '../models/device_status_model.dart';
import 'device_status_service.dart';
import 'telemetry_queue_service.dart';

/// Continuous Location Capture Engine capturing high-precision GPS, Speed, Accuracy, Battery and Network
class LocationCaptureService {
  static final LocationCaptureService _instance = LocationCaptureService._internal();
  factory LocationCaptureService() => _instance;
  LocationCaptureService._internal();

  final DeviceStatusService _deviceStatus = DeviceStatusService();
  final TelemetryQueueService _queueService = TelemetryQueueService();

  StreamSubscription<Position>? _positionStreamSub;
  bool _isCapturing = false;
  bool get isCapturing => _isCapturing;

  String? _activeTripId;
  String? _activeBusId;
  String? _activeDriverId;

  /// Start continuous location capture for an active trip
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

    try {
      final isGpsEnabled = await Geolocator.isLocationServiceEnabled();
      if (!isGpsEnabled) return false;

      final perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        return false;
      }

      // Configure high-frequency high-precision capture settings
      const locationSettings = LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 5, // Capture update every 5 meters
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

  /// Stop active trip capture
  void stopTripCapture() {
    _isCapturing = false;
    _activeTripId = null;
    _activeBusId = null;
    _activeDriverId = null;
    _positionStreamSub?.cancel();
    _positionStreamSub = null;
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

    final speedKmh = (pos.speed * 3.6).clamp(0.0, 180.0);

    _queueService.enqueuePing(
      tripId: _activeTripId!,
      busId: _activeBusId!,
      driverId: _activeDriverId!,
      latitude: pos.latitude,
      longitude: pos.longitude,
      speedKmh: speedKmh,
      bearingDegrees: pos.heading >= 0 ? pos.heading : null,
      accuracyMeters: pos.accuracy > 0 ? pos.accuracy : null,
      recordedAt: pos.timestamp.toUtc().toIso8601String(),
    );
  }
}
