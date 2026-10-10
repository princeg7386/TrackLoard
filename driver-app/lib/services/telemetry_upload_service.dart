import 'dart:math';
import 'package:geolocator/geolocator.dart';
import 'telemetry_queue_service.dart';

/// Coordinator handling telemetry transmission, pre-validation, stationary ping suppression, and retries
class TelemetryUploadService {
  static final TelemetryUploadService _instance = TelemetryUploadService._internal();
  factory TelemetryUploadService() => _instance;
  TelemetryUploadService._internal();

  final TelemetryQueueService _queueService = TelemetryQueueService();

  double? _lastTransmittedLat;
  double? _lastTransmittedLng;
  DateTime? _lastTransmittedAt;

  static const double stationaryDistanceMetersThreshold = 5.0;
  static const double stationarySpeedThresholdKmh = 0.5;
  static const Duration heartbeatInterval = Duration(seconds: 30);

  /// Pre-validate and process location ping for upload
  Future<bool> processAndUploadLocation({
    required String tripId,
    required String busId,
    required String driverId,
    required double latitude,
    required double longitude,
    required double speedKmh,
    double? bearingDegrees,
    double? accuracyMeters,
    int? batteryPercentage,
    bool? isCharging,
    String? networkType,
    DateTime? timestamp,
  }) async {
    final now = timestamp ?? DateTime.now();

    // 1. Client-Side Pre-Validation
    if (!_isValidCoordinates(latitude, longitude)) {
      return false;
    }

    // 2. Stationary Ping Suppression (Conserves device battery & cellular bandwidth)
    if (_shouldSuppressStationaryPing(latitude, longitude, speedKmh, now)) {
      return false; // Suppress redundant ping
    }

    // 3. Update last transmitted cache
    _lastTransmittedLat = latitude;
    _lastTransmittedLng = longitude;
    _lastTransmittedAt = now;

    // 4. Dispatch to queue service (which handles immediate push + offline SQLite queueing)
    await _queueService.enqueuePing(
      tripId: tripId,
      busId: busId,
      driverId: driverId,
      latitude: latitude,
      longitude: longitude,
      speedKmh: speedKmh,
      bearingDegrees: bearingDegrees,
      accuracyMeters: accuracyMeters,
      recordedAt: now.toUtc().toIso8601String(),
    );

    return true;
  }

  bool _isValidCoordinates(double lat, double lng) {
    if (lat.isNaN || lng.isNaN) return false;
    if (lat < -90.0 || lat > 90.0) return false;
    if (lng < -180.0 || lng > 180.0) return false;
    return true;
  }

  bool _shouldSuppressStationaryPing(
    double lat,
    double lng,
    double speedKmh,
    DateTime now,
  ) {
    if (_lastTransmittedLat == null || _lastTransmittedLng == null || _lastTransmittedAt == null) {
      return false; // Always send first ping
    }

    final elapsed = now.difference(_lastTransmittedAt!);

    // If 30 seconds have passed since last ping, allow heartbeat ping
    if (elapsed >= heartbeatInterval) {
      return false;
    }

    // Calculate distance from previous position
    final distanceMeters = Geolocator.distanceBetween(
      _lastTransmittedLat!,
      _lastTransmittedLng!,
      lat,
      lng,
    );

    // If vehicle has moved less than 5 meters and speed is near zero, suppress
    if (distanceMeters < stationaryDistanceMetersThreshold &&
        speedKmh < stationarySpeedThresholdKmh) {
      return true;
    }

    return false;
  }

  /// Reset cache on trip start/end
  void reset() {
    _lastTransmittedLat = null;
    _lastTransmittedLng = null;
    _lastTransmittedAt = null;
  }
}
