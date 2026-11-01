import 'package:flutter/material.dart';
import '../core/theme/app_theme.dart';
import '../models/upcoming_students_model.dart';

/// Phase 31.2 — Driver upcoming-student view.
///
/// Shows the next pickup stop and the list of students at that stop,
/// with attendance status badges (PENDING, BOARDED, ABSENT).
///
/// States handled:
///   • loading  — spinner while fetching
///   • all done — green tick when allPickupsComplete = true
///   • empty    — no nextStop but trip is running (should not normally happen)
///   • data     — stop details + student rows
///   • error    — retry button
class UpcomingStudentsCard extends StatelessWidget {
  final bool isLoading;
  final UpcomingPickupResult? result;
  final String? errorMessage;
  final bool isOffline;
  final VoidCallback onRefresh;

  const UpcomingStudentsCard({
    super.key,
    required this.isLoading,
    this.result,
    this.errorMessage,
    this.isOffline = false,
    required this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.cardBg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildHeader(),
          const Divider(height: 1, thickness: 1, color: AppTheme.borderSubtle),
          _buildBody(),
        ],
      ),
    );
  }

  // ─── Header ───────────────────────────────────────────────────────────────

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          const Icon(
            Icons.groups_2_rounded,
            size: 18,
            color: AppTheme.accentSky,
          ),
          const SizedBox(width: 8),
          const Expanded(
            child: Text(
              'UPCOMING STOP',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: AppTheme.textSecondary,
                letterSpacing: 0.8,
              ),
            ),
          ),
          // Refresh button
          GestureDetector(
            onTap: onRefresh,
            child: const Icon(
              Icons.refresh_rounded,
              size: 18,
              color: AppTheme.textMuted,
            ),
          ),
        ],
      ),
    );
  }

  // ─── Body ─────────────────────────────────────────────────────────────────

  Widget _buildBody() {
    if (isLoading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 28),
        child: Center(
          child: SizedBox(
            width: 24,
            height: 24,
            child: CircularProgressIndicator(strokeWidth: 2.5),
          ),
        ),
      );
    }

    // Offline notice
    if (isOffline) {
      return _buildStatusMessage(
        icon: Icons.wifi_off_rounded,
        color: AppTheme.statusWarning,
        bgColor: AppTheme.statusWarningLight,
        message: 'No connection. Could not fetch upcoming stop.',
        actionLabel: 'Retry',
        onAction: onRefresh,
      );
    }

    // Error state
    if (errorMessage != null) {
      return _buildStatusMessage(
        icon: Icons.error_outline_rounded,
        color: AppTheme.statusEmergency,
        bgColor: AppTheme.statusEmergencyLight,
        message: errorMessage!,
        actionLabel: 'Retry',
        onAction: onRefresh,
      );
    }

    if (result == null) {
      return const SizedBox.shrink();
    }

    // All pickups done
    if (result!.allPickupsComplete) {
      return _buildStatusMessage(
        icon: Icons.check_circle_rounded,
        color: AppTheme.statusSuccess,
        bgColor: AppTheme.statusSuccessLight,
        message: 'All pickups complete for this trip.',
      );
    }

    // No next stop resolved (edge case)
    if (result!.nextStop == null) {
      return _buildStatusMessage(
        icon: Icons.info_outline_rounded,
        color: AppTheme.statusNeutral,
        bgColor: AppTheme.statusNeutralLight,
        message: 'No upcoming stops found.',
      );
    }

    return _buildStopContent(result!.nextStop!, result!.students, result!.totalPending);
  }

  // ─── Stop + student content ────────────────────────────────────────────────

  Widget _buildStopContent(
    UpcomingStop stop,
    List<UpcomingStudentItem> students,
    int totalPending,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Stop info row
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: AppTheme.accentSky.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(
                  Icons.location_on_rounded,
                  size: 18,
                  color: AppTheme.accentSky,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      stop.name,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        Text(
                          'Stop #${stop.sequenceOrder}',
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppTheme.textMuted,
                          ),
                        ),
                        if (stop.scheduledTime != null) ...[
                          const Text(
                            '  ·  ',
                            style: TextStyle(color: AppTheme.textMuted, fontSize: 12),
                          ),
                          Text(
                            _formatScheduledTime(stop.scheduledTime!),
                            style: const TextStyle(
                              fontSize: 12,
                              color: AppTheme.textMuted,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              // Pending count badge
              if (totalPending > 0)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppTheme.statusWarningLight,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: AppTheme.statusWarning.withOpacity(0.4),
                    ),
                  ),
                  child: Text(
                    '$totalPending pending',
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: AppTheme.statusWarning,
                    ),
                  ),
                ),
            ],
          ),
        ),

        // Divider before student list
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 16),
          child: Divider(height: 1, thickness: 1, color: AppTheme.borderSubtle),
        ),

        // Student rows
        if (students.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Text(
              'No students assigned to this stop.',
              style: const TextStyle(fontSize: 13, color: AppTheme.textMuted),
            ),
          )
        else
          ...students.map((s) => _buildStudentRow(s)),

        const SizedBox(height: 4),
      ],
    );
  }

  Widget _buildStudentRow(UpcomingStudentItem student) {
    final (color, bgColor, label) = _statusStyle(student.attendanceStatus);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Row(
        children: [
          // Avatar circle with initials
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: AppTheme.statusNeutralLight,
              borderRadius: BorderRadius.circular(18),
            ),
            child: Center(
              child: Text(
                _initials(student.fullName),
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppTheme.textSecondary,
                ),
              ),
            ),
          ),
          const SizedBox(width: 12),
          // Name + grade
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  student.fullName,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                    color: AppTheme.textPrimary,
                  ),
                ),
                Text(
                  'Gr ${student.classGrade}${student.section}  ·  ${student.admissionNumber}',
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppTheme.textMuted,
                  ),
                ),
              ],
            ),
          ),
          // Status badge
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
            decoration: BoxDecoration(
              color: bgColor,
              borderRadius: BorderRadius.circular(6),
            ),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w700,
                color: color,
                letterSpacing: 0.4,
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ─── Status message (all done / error / offline / empty) ─────────────────

  Widget _buildStatusMessage({
    required IconData icon,
    required Color color,
    required Color bgColor,
    required String message,
    String? actionLabel,
    VoidCallback? onAction,
  }) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: bgColor,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(icon, size: 18, color: color),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                fontSize: 13,
                color: AppTheme.textSecondary,
              ),
            ),
          ),
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(width: 8),
            TextButton(
              onPressed: onAction,
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: Text(
                actionLabel,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: color,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  (Color, Color, String) _statusStyle(String status) {
    switch (status.toUpperCase()) {
      case 'BOARDED':
        return (AppTheme.statusSuccess, AppTheme.statusSuccessLight, 'BOARDED');
      case 'ABSENT':
        return (AppTheme.statusNeutral, AppTheme.statusNeutralLight, 'ABSENT');
      default: // PENDING
        return (AppTheme.statusWarning, AppTheme.statusWarningLight, 'PENDING');
    }
  }

  String _initials(String fullName) {
    final parts = fullName.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts[0][0].toUpperCase();
    return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
  }

  String _formatScheduledTime(String isoTime) {
    try {
      final dt = DateTime.parse(isoTime).toLocal();
      final h = dt.hour;
      final m = dt.minute.toString().padLeft(2, '0');
      final ampm = h >= 12 ? 'PM' : 'AM';
      final h12 = h % 12 == 0 ? 12 : h % 12;
      return '$h12:$m $ampm';
    } catch (_) {
      return isoTime;
    }
  }
}
