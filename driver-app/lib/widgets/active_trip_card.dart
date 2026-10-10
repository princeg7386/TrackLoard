import 'package:flutter/material.dart';
import '../core/theme/app_theme.dart';
import '../core/utils/app_formatters.dart';
import '../models/trip_state_model.dart';
import '../services/trip_status_service.dart';

/// Interactive card displaying real-time execution status of the current or scheduled trip
class ActiveTripCard extends StatelessWidget {
  final ActiveTripProgress trip;

  const ActiveTripCard({
    super.key,
    required this.trip,
  });

  @override
  Widget build(BuildContext context) {
    final tripService = TripStatusService();

    Color statusColor;
    Color statusBgColor;

    switch (trip.status) {
      case TripLifecycleStatus.inTransit:
        statusColor = AppTheme.statusSuccess;
        statusBgColor = AppTheme.statusSuccessLight;
        break;
      case TripLifecycleStatus.delayed:
        statusColor = AppTheme.statusWarning;
        statusBgColor = AppTheme.statusWarningLight;
        break;
      case TripLifecycleStatus.completed:
        statusColor = AppTheme.statusNeutral;
        statusBgColor = AppTheme.statusNeutralLight;
        break;
      case TripLifecycleStatus.cancelled:
        statusColor = AppTheme.statusEmergency;
        statusBgColor = AppTheme.statusEmergencyLight;
        break;
      case TripLifecycleStatus.scheduled:
      default:
        statusColor = AppTheme.accentSky;
        statusBgColor = const Color(0xFFF0F9FF);
    }

    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: trip.isActive ? statusColor.withOpacity(0.5) : AppTheme.borderSubtle,
          width: trip.isActive ? 1.5 : 1.0,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Top Row: Direction, Route Name & Live Status Badge
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: trip.tripType == 'DROP'
                            ? const Color(0xFFFEF3C7)
                            : const Color(0xFFE0F2FE),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Icon(
                        trip.tripType == 'DROP' ? Icons.wb_twilight_rounded : Icons.wb_sunny_rounded,
                        size: 16,
                        color: trip.tripType == 'DROP' ? const Color(0xFFB45309) : const Color(0xFF0369A1),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      trip.routeName,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.textPrimary,
                        letterSpacing: -0.2,
                      ),
                    ),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: statusBgColor,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: statusColor.withOpacity(0.4)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (trip.isActive) ...[
                        Container(
                          width: 6,
                          height: 6,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: statusColor,
                          ),
                        ),
                        const SizedBox(width: 6),
                      ],
                      Text(
                        trip.statusLabel,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                          color: statusColor,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),

            const SizedBox(height: 14),

            // Live Timer & Scheduled Time Row
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                // Scheduled Departure
                Row(
                  children: [
                    const Icon(Icons.schedule_rounded, size: 16, color: AppTheme.textSecondary),
                    const SizedBox(width: 6),
                    Text(
                      'Scheduled: ${AppFormatters.formatTime(trip.scheduledStartTime)}',
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                  ],
                ),

                // Running Elapsed Clock (for active trip)
                if (trip.isActive)
                  StreamBuilder<Duration>(
                    stream: tripService.timerStream,
                    initialData: tripService.elapsedDuration,
                    builder: (context, timerSnap) {
                      final duration = timerSnap.data ?? Duration.zero;
                      return Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppTheme.primaryNavy.withOpacity(0.08),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.timer_outlined, size: 13, color: AppTheme.primaryNavy),
                            const SizedBox(width: 4),
                            Text(
                              tripService.formatElapsed(duration),
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                color: AppTheme.primaryNavy,
                                fontFamily: 'monospace',
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
              ],
            ),

            const SizedBox(height: 14),

            // Stop Sequence Progress Bar
            if (trip.totalStops > 0) ...[
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Stop ${trip.currentStopSequence} of ${trip.totalStops}',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppTheme.textSecondary,
                    ),
                  ),
                  Text(
                    '${(trip.progressFraction * 100).toInt()}% completed',
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppTheme.textMuted,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: trip.progressFraction,
                  minHeight: 6,
                  backgroundColor: AppTheme.borderSubtle,
                  valueColor: AlwaysStoppedAnimation<Color>(statusColor),
                ),
              ),
              const SizedBox(height: 10),
            ],

            // Current / Next Stop Name
            if (trip.currentStopName != null || trip.nextStopName != null) ...[
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceLight,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: AppTheme.borderSubtle),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.pin_drop_rounded, size: 16, color: AppTheme.accentSky),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        trip.currentStopName != null
                            ? 'Current Stop: ${trip.currentStopName}'
                            : 'Next Stop: ${trip.nextStopName}',
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: AppTheme.textPrimary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ),
            ],

            // Delay Warning Banner if delayed
            if (trip.delayMinutes > 0) ...[
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: AppTheme.statusWarningLight,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.alarm_on_rounded, size: 14, color: AppTheme.statusWarning),
                    const SizedBox(width: 6),
                    Text(
                      'Running ${trip.delayMinutes} minutes behind schedule',
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.statusWarning,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
