import 'package:flutter/material.dart';
import '../core/theme/app_theme.dart';
import '../services/telemetry_queue_service.dart';

/// Widget displaying the status of the local offline telemetry queue
class QueueSyncIndicator extends StatelessWidget {
  const QueueSyncIndicator({super.key});

  @override
  Widget build(BuildContext context) {
    final queueService = TelemetryQueueService();

    return StreamBuilder<int>(
      stream: queueService.pendingCountStream,
      initialData: queueService.pendingCount,
      builder: (context, countSnap) {
        final pendingCount = countSnap.data ?? 0;
        if (pendingCount <= 0) {
          return const SizedBox.shrink();
        }

        return StreamBuilder<bool>(
          stream: queueService.isSyncingStream,
          initialData: queueService.isSyncing,
          builder: (context, syncSnap) {
            final isSyncing = syncSnap.data ?? false;

            return Container(
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: isSyncing ? const Color(0xFFEFF6FF) : AppTheme.statusWarningLight,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: (isSyncing ? AppTheme.accentSky : AppTheme.statusWarning).withOpacity(0.3),
                ),
              ),
              child: Row(
                children: [
                  if (isSyncing)
                    const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation<Color>(AppTheme.accentSky),
                      ),
                    )
                  else
                    const Icon(Icons.cloud_upload_outlined, size: 18, color: AppTheme.statusWarning),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          isSyncing
                              ? 'Syncing $pendingCount Telemetry Pings...'
                              : '$pendingCount Offline Pings Queued',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                            color: isSyncing ? AppTheme.accentSky : AppTheme.statusWarning,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          isSyncing
                              ? 'Transmitting GPS buffer to safety server'
                              : 'Saved in SQLite. Will auto-sync when network returns.',
                          style: TextStyle(
                            fontSize: 11,
                            color: isSyncing ? AppTheme.accentSky : AppTheme.statusWarning,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (!isSyncing)
                    TextButton(
                      onPressed: () => queueService.flushPendingQueue(),
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        visualDensity: VisualDensity.compact,
                      ),
                      child: const Text('Sync Now', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                    ),
                ],
              ),
            );
          },
        );
      },
    );
  }
}
