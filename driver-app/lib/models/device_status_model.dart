/// GPS accuracy quality levels for fleet tracking
enum GpsQuality {
  optimal, // <= 15m (Green)
  acceptable, // 15m - 30m (Amber)
  poor, // > 30m (Red)
  searching, // GPS active but acquiring satellite fix
  disabled, // Location hardware is OFF
}

/// Real-time GPS status snapshot
class GpsTelemetryStatus {
  final bool isEnabled;
  final GpsQuality quality;
  final double? accuracyMeters;
  final double? speedKmH;
  final double? latitude;
  final double? longitude;
  final DateTime? lastFixTime;

  const GpsTelemetryStatus({
    required this.isEnabled,
    required this.quality,
    this.accuracyMeters,
    this.speedKmH,
    this.latitude,
    this.longitude,
    this.lastFixTime,
  });

  factory GpsTelemetryStatus.initial() => const GpsTelemetryStatus(
        isEnabled: true,
        quality: GpsQuality.searching,
      );

  factory GpsTelemetryStatus.disabled() => const GpsTelemetryStatus(
        isEnabled: false,
        quality: GpsQuality.disabled,
      );

  String get accuracyLabel {
    if (!isEnabled) return 'GPS Disabled';
    if (quality == GpsQuality.searching) return 'Acquiring GPS...';
    if (accuracyMeters == null) return 'No Fix';
    return '${accuracyMeters!.toStringAsFixed(1)}m fix';
  }

  String get speedLabel {
    if (speedKmH == null || speedKmH! <= 0.5) return '0 km/h';
    return '${speedKmH!.toStringAsFixed(1)} km/h';
  }
}

/// Network connectivity status snapshot
enum NetworkType {
  cellular,
  wifi,
  ethernet,
  none,
  unknown,
}

class NetworkTelemetryStatus {
  final bool isConnected;
  final NetworkType type;
  final String label;

  const NetworkTelemetryStatus({
    required this.isConnected,
    required this.type,
    required this.label,
  });

  factory NetworkTelemetryStatus.initial() => const NetworkTelemetryStatus(
        isConnected: true,
        type: NetworkType.cellular,
        label: 'Online',
      );

  factory NetworkTelemetryStatus.offline() => const NetworkTelemetryStatus(
        isConnected: false,
        type: NetworkType.none,
        label: 'Offline',
      );
}

/// Battery & Power status snapshot
class BatteryTelemetryStatus {
  final int levelPercentage;
  final bool isCharging;

  const BatteryTelemetryStatus({
    required this.levelPercentage,
    required this.isCharging,
  });

  factory BatteryTelemetryStatus.initial() => const BatteryTelemetryStatus(
        levelPercentage: 100,
        isCharging: false,
      );

  bool get isLowBattery => levelPercentage <= 20 && !isCharging;
  bool get isCriticalBattery => levelPercentage <= 10 && !isCharging;

  String get batteryLabel => '$levelPercentage%';
}

/// Comprehensive device telemetry snapshot combining GPS, Network, and Battery
class DeviceTelemetrySnapshot {
  final GpsTelemetryStatus gps;
  final NetworkTelemetryStatus network;
  final BatteryTelemetryStatus battery;
  final DateTime updatedAt;

  DeviceTelemetrySnapshot({
    required this.gps,
    required this.network,
    required this.battery,
    DateTime? updatedAt,
  }) : updatedAt = updatedAt ?? DateTime.now();

  factory DeviceTelemetrySnapshot.initial() => DeviceTelemetrySnapshot(
        gps: GpsTelemetryStatus.initial(),
        network: NetworkTelemetryStatus.initial(),
        battery: BatteryTelemetryStatus.initial(),
      );

  /// Overall transmission readiness status
  bool get isTelemetryHealthy =>
      gps.isEnabled &&
      gps.quality != GpsQuality.disabled &&
      gps.quality != GpsQuality.poor &&
      network.isConnected &&
      !battery.isCriticalBattery;
}
