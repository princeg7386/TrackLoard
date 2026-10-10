import 'package:flutter/material.dart';
import '../core/theme/app_theme.dart';
import '../models/device_status_model.dart';
import '../services/device_status_service.dart';

/// Top telemetry bar displaying real-time GPS accuracy, Network connectivity, and Battery state
class LiveStatusBarWidget extends StatelessWidget {
  const LiveStatusBarWidget({super.key});

  @override
  Widget build(BuildContext context) {
    final statusService = DeviceStatusService();

    return StreamBuilder<DeviceTelemetrySnapshot>(
      stream: statusService.statusStream,
      initialData: statusService.currentSnapshot,
      builder: (context, snapshot) {
        final data = snapshot.data ?? DeviceTelemetrySnapshot.initial();
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: AppTheme.secondaryNavy,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: AppTheme.borderMedium.withOpacity(0.2)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              // 1. GPS Status Pill
              _buildGpsIndicator(data.gps),

              Container(width: 1, height: 16, color: Colors.white24),

              // 2. Network Status Pill
              _buildNetworkIndicator(data.network),

              Container(width: 1, height: 16, color: Colors.white24),

              // 3. Battery Status Pill
              _buildBatteryIndicator(data.battery),
            ],
          ),
        );
      },
    );
  }

  Widget _buildGpsIndicator(GpsTelemetryStatus gps) {
    Color dotColor;
    String label;
    IconData icon;

    switch (gps.quality) {
      case GpsQuality.optimal:
        dotColor = AppTheme.statusSuccess;
        label = gps.accuracyMeters != null
            ? '${gps.accuracyMeters!.toStringAsFixed(0)}m (${gps.speedLabel})'
            : 'GPS OK';
        icon = Icons.gps_fixed_rounded;
        break;
      case GpsQuality.acceptable:
        dotColor = AppTheme.statusWarning;
        label = '${gps.accuracyMeters?.toStringAsFixed(0) ?? '--'}m';
        icon = Icons.gps_fixed_rounded;
        break;
      case GpsQuality.poor:
        dotColor = AppTheme.statusEmergency;
        label = 'Weak GPS';
        icon = Icons.gps_not_fixed_rounded;
        break;
      case GpsQuality.searching:
        dotColor = AppTheme.accentSky;
        label = 'Searching GPS';
        icon = Icons.location_searching_rounded;
        break;
      case GpsQuality.disabled:
      default:
        dotColor = AppTheme.statusEmergency;
        label = 'GPS OFF';
        icon = Icons.gps_off_rounded;
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: dotColor),
        const SizedBox(width: 5),
        Text(
          label,
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: dotColor,
          ),
        ),
      ],
    );
  }

  Widget _buildNetworkIndicator(NetworkTelemetryStatus network) {
    final isOnline = network.isConnected;
    final color = isOnline ? AppTheme.statusSuccess : AppTheme.statusEmergency;

    IconData icon;
    if (!isOnline) {
      icon = Icons.wifi_off_rounded;
    } else if (network.type == NetworkType.wifi) {
      icon = Icons.wifi_rounded;
    } else {
      icon = Icons.signal_cellular_alt_rounded;
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: color),
        const SizedBox(width: 5),
        Text(
          network.label,
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: color,
          ),
        ),
      ],
    );
  }

  Widget _buildBatteryIndicator(BatteryTelemetryStatus battery) {
    Color color;
    IconData icon;

    if (battery.isCharging) {
      color = AppTheme.statusSuccess;
      icon = Icons.battery_charging_full_rounded;
    } else if (battery.isLowBattery) {
      color = AppTheme.statusEmergency;
      icon = Icons.battery_alert_rounded;
    } else {
      color = Colors.white70;
      icon = Icons.battery_full_rounded;
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: color),
        const SizedBox(width: 4),
        Text(
          battery.batteryLabel,
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: color,
          ),
        ),
      ],
    );
  }
}
