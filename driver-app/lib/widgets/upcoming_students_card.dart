import 'package:flutter/material.dart';
import '../core/theme/app_theme.dart';
import '../models/upcoming_students_model.dart';

/// Phase 31.1 & 31.3 — Driver upcoming-student & pickup arrival view.
///
/// Shows the next pickup stop, arrival status, and the list of students at that stop.
/// When the bus arrives at the stop (or driver signals arrival), boarding becomes active:
///   • Displays "● AT STOP · BOARDING ACTIVE" banner
///   • Allows one-tap individual "Board" button for each pending student
///   • Allows "Board All Pending" batch action for fast turnaround
///
/// States handled:
///   • loading  — spinner while fetching
///   • all done — green tick when allPickupsComplete = true
///   • empty    — no nextStop but trip is running
///   • data     — stop details + student rows + boarding controls
///   • error    — retry button
///   • offline  — warning banner
class UpcomingStudentsCard extends StatefulWidget {
  final bool isLoading;
  final UpcomingPickupResult? result;
  final String? errorMessage;
  final bool isOffline;
  final VoidCallback onRefresh;
  final Future<void> Function(String stopId)? onRecordArrival;
  final Future<void> Function(String studentId, String stopId)? onBoardStudent;
  final Future<void> Function(List<String> studentIds, String stopId)? onBoardAll;

  const UpcomingStudentsCard({
    super.key,
    required this.isLoading,
    this.result,
    this.errorMessage,
    this.isOffline = false,
    required this.onRefresh,
    this.onRecordArrival,
    this.onBoardStudent,
    this.onBoardAll,
  });

  @override
  State<UpcomingStudentsCard> createState() => _UpcomingStudentsCardState();
}

class _UpcomingStudentsCardState extends State<UpcomingStudentsCard> {
  String? _actionInProgressId;

  bool _isActionRunning(String id) => _actionInProgressId == id;

  Future<void> _handleArrival(String stopId) async {
    if (widget.onRecordArrival == null) return;
    setState(() => _actionInProgressId = 'ARRIVAL');
    try {
      await widget.onRecordArrival!(stopId);
    } finally {
      if (mounted) setState(() => _actionInProgressId = null);
    }
  }

  Future<void> _handleBoardSingle(String studentId, String stopId) async {
    if (widget.onBoardStudent == null) return;
    setState(() => _actionInProgressId = studentId);
    try {
      await widget.onBoardStudent!(studentId, stopId);
    } finally {
      if (mounted) setState(() => _actionInProgressId = null);
    }
  }

  Future<void> _handleBoardAll(List<String> studentIds, String stopId) async {
    if (widget.onBoardAll == null) return;
    setState(() => _actionInProgressId = 'BOARD_ALL');
    try {
      await widget.onBoardAll!(studentIds, stopId);
    } finally {
      if (mounted) setState(() => _actionInProgressId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.cardBg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: widget.result?.boardingAvailable == true
              ? AppTheme.statusSuccess.withOpacity(0.4)
              : AppTheme.borderSubtle,
          width: widget.result?.boardingAvailable == true ? 1.5 : 1,
        ),
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
    final isBoardingActive = widget.result?.boardingAvailable == true;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          Icon(
            isBoardingActive ? Icons.check_circle_rounded : Icons.groups_2_rounded,
            size: 18,
            color: isBoardingActive ? AppTheme.statusSuccess : AppTheme.accentSky,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Row(
              children: [
                const Text(
                  'UPCOMING STOP',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: AppTheme.textSecondary,
                    letterSpacing: 0.8,
                  ),
                ),
                if (isBoardingActive) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppTheme.statusSuccessLight,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: const Text(
                      '● AT STOP · BOARDING ACTIVE',
                      style: TextStyle(
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                        color: AppTheme.statusSuccess,
                        letterSpacing: 0.3,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          // Refresh button
          GestureDetector(
            onTap: widget.onRefresh,
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
    if (widget.isLoading) {
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
    if (widget.isOffline) {
      return _buildStatusMessage(
        icon: Icons.wifi_off_rounded,
        color: AppTheme.statusWarning,
        bgColor: AppTheme.statusWarningLight,
        message: 'No connection. Could not fetch upcoming stop.',
        actionLabel: 'Retry',
        onAction: widget.onRefresh,
      );
    }

    // Error state
    if (widget.errorMessage != null) {
      return _buildStatusMessage(
        icon: Icons.error_outline_rounded,
        color: AppTheme.statusEmergency,
        bgColor: AppTheme.statusEmergencyLight,
        message: widget.errorMessage!,
        actionLabel: 'Retry',
        onAction: widget.onRefresh,
      );
    }

    if (widget.result == null) {
      return const SizedBox.shrink();
    }

    // All pickups done
    if (widget.result!.allPickupsComplete) {
      return _buildStatusMessage(
        icon: Icons.check_circle_rounded,
        color: AppTheme.statusSuccess,
        bgColor: AppTheme.statusSuccessLight,
        message: 'All pickups complete for this trip.',
      );
    }

    // No next stop resolved (edge case)
    if (widget.result!.nextStop == null) {
      return _buildStatusMessage(
        icon: Icons.info_outline_rounded,
        color: AppTheme.statusNeutral,
        bgColor: AppTheme.statusNeutralLight,
        message: 'No upcoming stops found.',
      );
    }

    return _buildStopContent(
      widget.result!.nextStop!,
      widget.result!.students,
      widget.result!.totalPending,
      widget.result!.boardingAvailable,
    );
  }

  // ─── Stop + student content ────────────────────────────────────────────────

  Widget _buildStopContent(
    UpcomingStop stop,
    List<UpcomingStudentItem> students,
    int totalPending,
    bool boardingAvailable,
  ) {
    final pendingStudents = students.where((s) => s.attendanceStatus == 'PENDING').toList();

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
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: boardingAvailable
                      ? AppTheme.statusSuccessLight
                      : AppTheme.accentSky.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  Icons.location_on_rounded,
                  size: 20,
                  color: boardingAvailable ? AppTheme.statusSuccess : AppTheme.accentSky,
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

        // Action banner: Arrival or Board-All
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          child: boardingAvailable
              ? (totalPending > 0
                  ? SizedBox(
                      width: double.infinity,
                      child: ElevatedButton.icon(
                        icon: _isActionRunning('BOARD_ALL')
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Icon(Icons.done_all_rounded, size: 16),
                        label: Text('Board All Pending ($totalPending)'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppTheme.statusSuccess,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 10),
                          textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                        ),
                        onPressed: _isActionRunning('BOARD_ALL')
                            ? null
                            : () => _handleBoardAll(
                                  pendingStudents.map((s) => s.studentId).toList(),
                                  stop.id,
                                ),
                      ),
                    )
                  : const SizedBox.shrink())
              : Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'Approaching stop · Boarding unlocks on arrival',
                        style: TextStyle(fontSize: 11, color: AppTheme.textMuted),
                      ),
                    ),
                    OutlinedButton.icon(
                      icon: _isActionRunning('ARRIVAL')
                          ? const SizedBox(
                              width: 12,
                              height: 12,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.pin_drop_rounded, size: 14),
                      label: const Text('Arrived'),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                      ),
                      onPressed: _isActionRunning('ARRIVAL') ? null : () => _handleArrival(stop.id),
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
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Text(
              'No students assigned to this stop.',
              style: TextStyle(fontSize: 13, color: AppTheme.textMuted),
            ),
          )
        else
          ...students.map((s) => _buildStudentRow(s, stop.id, boardingAvailable)),

        const SizedBox(height: 6),
      ],
    );
  }

  Widget _buildStudentRow(
    UpcomingStudentItem student,
    String stopId,
    bool boardingAvailable,
  ) {
    final isPending = student.attendanceStatus == 'PENDING';
    final (color, bgColor, label) = _statusStyle(student.attendanceStatus);
    final isSingleBoarding = _isActionRunning(student.studentId);

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
                if (student.isAbsentToday)
                  Text(
                    student.absenceReason?.isNotEmpty == true
                        ? 'Not going today (${student.absenceReason})'
                        : 'Not going today (parent reported)',
                    style: const TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: AppTheme.statusEmergency,
                    ),
                  ),
              ],
            ),
          ),
          // Quick action: Board button if boarding is active and student is pending (not absent)
          if (isPending && boardingAvailable && !student.isAbsentToday) ...[
            ElevatedButton(
              onPressed: isSingleBoarding ? null : () => _handleBoardSingle(student.studentId, stopId),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.statusSuccess,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                textStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
              ),
              child: isSingleBoarding
                  ? const SizedBox(
                      width: 12,
                      height: 12,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Board'),
            ),
          ] else if (student.isAbsentToday) ...[
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
              decoration: BoxDecoration(
                color: AppTheme.statusEmergencyLight,
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: AppTheme.statusEmergency.withOpacity(0.3)),
              ),
              child: const Text(
                'NOT GOING',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  color: AppTheme.statusEmergency,
                  letterSpacing: 0.4,
                ),
              ),
            ),
          ] else ...[
            // Status chip badge
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
      case 'SKIPPED':
        return (AppTheme.statusNeutral, AppTheme.statusNeutralLight, 'SKIPPED');
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
