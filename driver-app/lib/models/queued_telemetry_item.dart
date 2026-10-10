import 'dart:convert';

/// Model representing a single pending telemetry ping stored in SQLite
class QueuedTelemetryItem {
  final int? id;
  final String tripId;
  final String busId;
  final String driverId;
  final double latitude;
  final double longitude;
  final double speedKmh;
  final double? bearingDegrees;
  final double? accuracyMeters;
  final String recordedAt;
  final int retryCount;
  final String createdAt;

  QueuedTelemetryItem({
    this.id,
    required this.tripId,
    required this.busId,
    required this.driverId,
    required this.latitude,
    required this.longitude,
    required this.speedKmh,
    this.bearingDegrees,
    this.accuracyMeters,
    required this.recordedAt,
    this.retryCount = 0,
    String? createdAt,
  }) : createdAt = createdAt ?? DateTime.now().toIso8601String();

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'trip_id': tripId,
      'bus_id': busId,
      'driver_id': driverId,
      'latitude': latitude,
      'longitude': longitude,
      'speed_kmh': speedKmh,
      'bearing_degrees': bearingDegrees,
      'accuracy_meters': accuracyMeters,
      'recorded_at': recordedAt,
      'retry_count': retryCount,
      'created_at': createdAt,
    };
  }

  factory QueuedTelemetryItem.fromMap(Map<String, dynamic> map) {
    return QueuedTelemetryItem(
      id: map['id'] as int?,
      tripId: map['trip_id']?.toString() ?? '',
      busId: map['bus_id']?.toString() ?? '',
      driverId: map['driver_id']?.toString() ?? '',
      latitude: (map['latitude'] as num?)?.toDouble() ?? 0.0,
      longitude: (map['longitude'] as num?)?.toDouble() ?? 0.0,
      speedKmh: (map['speed_kmh'] as num?)?.toDouble() ?? 0.0,
      bearingDegrees: (map['bearing_degrees'] as num?)?.toDouble(),
      accuracyMeters: (map['accuracy_meters'] as num?)?.toDouble(),
      recordedAt: map['recorded_at']?.toString() ?? DateTime.now().toIso8601String(),
      retryCount: (map['retry_count'] as int?) ?? 0,
      createdAt: map['created_at']?.toString() ?? DateTime.now().toIso8601String(),
    );
  }

  /// Convert to standard backend TelemetryIngestSchema payload
  Map<String, dynamic> toPayload() {
    return {
      'tripId': tripId,
      'busId': busId,
      'driverId': driverId,
      'latitude': latitude,
      'longitude': longitude,
      'speedKmh': speedKmh,
      if (bearingDegrees != null) 'bearingDegrees': bearingDegrees,
      if (accuracyMeters != null) 'accuracyMeters': accuracyMeters,
      'recordedAt': recordedAt,
    };
  }
}
