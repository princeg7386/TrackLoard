import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import '../core/theme/app_theme.dart';
import '../core/utils/app_formatters.dart';
import '../models/assigned_trip.dart';
import '../models/driver_profile.dart';
import '../models/permission_status_model.dart';
import '../models/trip_state_model.dart';
import '../models/student_attendance_model.dart';
import '../services/api_service.dart';
import '../services/app_lifecycle_manager.dart';
import '../services/auth_service.dart';
import '../services/device_status_service.dart';
import '../services/permission_service.dart';
import '../services/telemetry_queue_service.dart';
import '../services/trip_status_service.dart';
import '../widgets/active_trip_card.dart';
import '../widgets/live_status_bar.dart';
import '../widgets/queue_sync_indicator.dart';
import 'login_screen.dart';
import 'permissions_screen.dart';

/// Driver Home Screen displaying Live Telemetry Status, Today's Bus, Active Trip & Scheduled Routes
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  final AuthService _authService = AuthService();
  final PermissionService _permissionService = PermissionService();
  final DeviceStatusService _deviceStatusService = DeviceStatusService();
  final TripStatusService _tripStatusService = TripStatusService();
  final TelemetryQueueService _queueService = TelemetryQueueService();
  final AppLifecycleManager _lifecycleManager = AppLifecycleManager();

  bool _isLoading = true;
  String? _errorMessage;
  bool _isOffline = false;

  DriverProfileData? _profileData;
  Map<String, String?> _storedDriver = {};
  AppPermissionsState? _permissionsState;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _lifecycleManager.init();
    _loadInitialData();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _checkPermissionsStatus();
      _deviceStatusService.refresh();
      _queueService.flushPendingQueue();
    }
  }

  Future<void> _checkPermissionsStatus() async {
    final perms = await _permissionService.checkPermissions();
    if (!mounted) return;
    setState(() {
      _permissionsState = perms;
    });
  }

  Future<void> _loadInitialData() async {
    // 1. Immediately read last-known state from SQLite for instant cold start
    final cachedSnapshot = await _authService.getLastKnownSnapshot();
    final cachedDriver = await _authService.getStoredDriver();

    if (cachedSnapshot?.profile != null) {
      setState(() {
        _profileData = cachedSnapshot!.profile;
        _storedDriver = cachedDriver;
        _isLoading = false;
      });

      final activeTripMap = cachedSnapshot!.profile!.activeTrip ??
          (cachedSnapshot.profile!.todayTrips.isNotEmpty ? cachedSnapshot.profile!.todayTrips.first : null);
      _tripStatusService.updateActiveTrip(activeTripMap);
    } else {
      setState(() {
        _storedDriver = cachedDriver;
        _isLoading = true;
      });
    }

    // 2. Fetch live data in parallel
    await Future.wait([
      _fetchProfile(),
      _checkPermissionsStatus(),
      _deviceStatusService.refresh(),
      _queueService.init(),
    ]);
  }

  Future<void> _fetchProfile() async {
    final result = await _authService.getProfile();

    if (!mounted) return;

    setState(() {
      _isLoading = false;
      if (result.success && result.data != null) {
        _profileData = result.data;
        _errorMessage = null;
        _isOffline = result.isOffline;

        // Update active trip state in trip service
        final activeTripMap = result.data!.activeTrip ??
            (result.data!.todayTrips.isNotEmpty ? result.data!.todayTrips.first : null);
        _tripStatusService.updateActiveTrip(activeTripMap);
      } else {
        _errorMessage = result.message;
        _isOffline = result.isOffline;
        if (result.statusCode == 401) {
          _handleUnauthorized();
        }
      }
    });
  }

  Future<void> _handleRefresh() async {
    await Future.wait([
      _fetchProfile(),
      _checkPermissionsStatus(),
      _deviceStatusService.refresh(),
      _queueService.flushPendingQueue(),
    ]);
  }

  void _handleUnauthorized() async {
    await _authService.logout();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
    );
  }

  void _openPermissionsFlow() async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const PermissionsScreen()),
    );
    _checkPermissionsStatus();
    _deviceStatusService.refresh();
  }

  void _showTelemetryDiagnosticsSheet() {
    final snapshot = _deviceStatusService.currentSnapshot;
    final pendingCount = _queueService.pendingCount;

    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Telemetry Diagnostics',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                IconButton(
                  icon: const Icon(Icons.close, size: 20),
                  onPressed: () => Navigator.pop(ctx),
                ),
              ],
            ),
            const Divider(height: 1),
            const SizedBox(height: 12),
            _buildDiagRow(
              'GPS Coordinates',
              snapshot.gps.latitude != null
                  ? '${snapshot.gps.latitude!.toStringAsFixed(5)}, ${snapshot.gps.longitude!.toStringAsFixed(5)}'
                  : 'Searching for Fix',
            ),
            _buildDiagRow('GPS Accuracy', snapshot.gps.accuracyLabel),
            _buildDiagRow('Speedometer', snapshot.gps.speedLabel),
            _buildDiagRow('Network Carrier / Type', snapshot.network.label),
            _buildDiagRow(
              'Battery Level & State',
              '${snapshot.battery.batteryLabel} ${snapshot.battery.isCharging ? '(Charging ⚡)' : ''}',
            ),
            _buildDiagRow('SQLite Pending Queue', '$pendingCount pings stored'),
            _buildDiagRow(
              'Telemetry Readiness',
              snapshot.isTelemetryHealthy ? 'Healthy & Transmitting' : 'Degraded',
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                if (pendingCount > 0)
                  Expanded(
                    child: OutlinedButton.icon(
                      icon: const Icon(Icons.cloud_upload_outlined, size: 16),
                      label: const Text('Flush Queue'),
                      onPressed: () {
                        _queueService.flushPendingQueue();
                        Navigator.pop(ctx);
                      },
                    ),
                  ),
                if (pendingCount > 0) const SizedBox(width: 8),
                Expanded(
                  child: ElevatedButton(
                    onPressed: () {
                      Navigator.pop(ctx);
                      _openPermissionsFlow();
                    },
                    child: const Text('Permissions'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDiagRow(String title, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(title, style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary)),
          Text(
            value,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppTheme.textPrimary),
          ),
        ],
      ),
    );
  }

  void _confirmLogout() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign Out', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        content: const Text(
          'Are you sure you want to sign out from this bus device?',
          style: TextStyle(fontSize: 13, color: AppTheme.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppTheme.statusEmergency),
            onPressed: () async {
              Navigator.pop(ctx);
              await _authService.logout();
              if (!mounted) return;
              Navigator.of(context).pushReplacement(
                MaterialPageRoute(builder: (_) => const LoginScreen()),
              );
            },
            child: const Text('Sign Out'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final driverName = _profileData?.driver.fullName ?? _storedDriver['fullName'] ?? 'Driver';
    final driverPhone = _profileData?.driver.phone ?? _storedDriver['phone'] ?? '';
    final assignedBus = _profileData?.assignedBus;
    final isPermIncomplete = _permissionsState != null && !_permissionsState!.isFullTelemetryReady;

    return Scaffold(
      backgroundColor: AppTheme.surfaceLight,
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              driverName,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            if (driverPhone.isNotEmpty)
              Text(
                AppFormatters.formatPhoneNumber(driverPhone),
                style: const TextStyle(fontSize: 11, color: AppTheme.textMuted),
              ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, size: 22),
            tooltip: 'Refresh Status',
            onPressed: _isLoading ? null : _handleRefresh,
          ),
          IconButton(
            icon: const Icon(Icons.logout_rounded, size: 20),
            tooltip: 'Sign Out',
            onPressed: _confirmLogout,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _handleRefresh,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // 1. TOP LIVE STATUS BAR (GPS, Network, Battery)
              InkWell(
                onTap: _showTelemetryDiagnosticsSheet,
                borderRadius: BorderRadius.circular(8),
                child: const LiveStatusBarWidget(),
              ),

              const SizedBox(height: 10),

              // 2. OFFLINE SQLITE PENDING QUEUE INDICATOR (Visible when pings buffered)
              const QueueSyncIndicator(),

              // 3. Permission Warning Banner (if missing permissions)
              if (isPermIncomplete) ...[
                _buildPermissionWarningBanner(),
                const SizedBox(height: 12),
              ],

              // 4. Offline or Error Banner
              if (_isOffline) ...[
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppTheme.statusWarningLight,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppTheme.statusWarning.withOpacity(0.3)),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.wifi_off_rounded, size: 18, color: AppTheme.statusWarning),
                      SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'Offline Mode. Telemetry buffered in SQLite; last known state shown.',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: AppTheme.statusWarning,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
              ] else if (_errorMessage != null && !_isLoading) ...[
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppTheme.statusEmergencyLight,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppTheme.statusEmergency.withOpacity(0.3)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.error_outline, size: 18, color: AppTheme.statusEmergency),
                      SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          _errorMessage!,
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppTheme.statusEmergency,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                      TextButton(
                        onPressed: _fetchProfile,
                        child: const Text('Retry', style: TextStyle(fontSize: 12)),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
              ],

              // Loading Spinner State (only if no cache exists)
              if (_isLoading && _profileData == null) ...[
                const Center(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 40.0),
                    child: CircularProgressIndicator(),
                  ),
                ),
              ] else ...[
                // SECTION 1: ACTIVE TRIP LIVE TRACKER (if active trip exists)
                StreamBuilder<ActiveTripProgress?>(
                  stream: _tripStatusService.tripStream,
                  initialData: _tripStatusService.activeTrip,
                  builder: (context, tripSnap) {
                    final activeTrip = tripSnap.data;
                    if (activeTrip != null) {
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _buildSectionHeader(
                            activeTrip.isActive ? 'ACTIVE TRIP IN PROGRESS' : 'NEXT SCHEDULED TRIP',
                            Icons.directions_bus_rounded,
                          ),
                          const SizedBox(height: 8),
                          ActiveTripCard(trip: activeTrip),
                          const SizedBox(height: 20),
                        ],
                      );
                    }
                    return const SizedBox.shrink();
                  },
                ),

                // SECTION 2: TODAY'S ASSIGNED BUS
                _buildSectionHeader('TODAY\'S ASSIGNED BUS', Icons.directions_bus_filled_rounded),
                const SizedBox(height: 8),
                _buildAssignedBusCard(assignedBus),

                const SizedBox(height: 20),

                // SECTION 3: ALL SCHEDULED TRIPS FOR TODAY
                _buildSectionHeader('ALL SCHEDULED TRIPS', Icons.alt_route_rounded),
                const SizedBox(height: 8),
                _buildTodayRoutesCard(),

                const SizedBox(height: 20),

                // SECTION 4: WHATSAPP BOT QUICK OPERATIONS
                _buildWhatsAppBotCard(),

                const SizedBox(height: 20),

                // SECTION 5: TELEMETRY SERVICE & DIAGNOSTICS LAUNCHER
                _buildTelemetryStatusCard(),

                const SizedBox(height: 24),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPermissionWarningBanner() {
    final isGpsOff = !(_permissionsState?.isGpsServiceEnabled ?? true);
    final isBgMissing = !(_permissionsState?.isBackgroundLocationGranted ?? true);

    String message;
    if (isGpsOff) {
      message = 'Device GPS hardware is turned OFF. Bus coordinates cannot be broadcast.';
    } else if (isBgMissing) {
      message = 'Background Location ("Allow all the time") is required for tracking when phone is locked.';
    } else {
      message = 'Important permissions are missing for full GPS telemetry.';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: isGpsOff ? AppTheme.statusEmergencyLight : AppTheme.statusWarningLight,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: (isGpsOff ? AppTheme.statusEmergency : AppTheme.statusWarning).withOpacity(0.4),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Icon(
            isGpsOff ? Icons.gps_off_rounded : Icons.warning_amber_rounded,
            size: 22,
            color: isGpsOff ? AppTheme.statusEmergency : AppTheme.statusWarning,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isGpsOff ? 'GPS Disabled' : 'Permissions Incomplete',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                    color: isGpsOff ? AppTheme.statusEmergency : AppTheme.statusWarning,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  message,
                  style: TextStyle(
                    fontSize: 11,
                    color: isGpsOff ? AppTheme.statusEmergency : AppTheme.statusWarning,
                    height: 1.3,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          ElevatedButton(
            onPressed: _openPermissionsFlow,
            style: ElevatedButton.styleFrom(
              backgroundColor: isGpsOff ? AppTheme.statusEmergency : AppTheme.statusWarning,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              visualDensity: VisualDensity.compact,
            ),
            child: const Text('Fix', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionHeader(String title, IconData icon) {
    return Row(
      children: [
        Icon(icon, size: 16, color: AppTheme.textSecondary),
        const SizedBox(width: 6),
        Text(
          title,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.5,
            color: AppTheme.textSecondary,
          ),
        ),
      ],
    );
  }

  Widget _buildAssignedBusCard(DriverAssignedBus? bus) {
    if (bus == null) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(20.0),
          child: Column(
            children: [
              Icon(Icons.bus_alert_rounded, size: 40, color: AppTheme.textMuted),
              const SizedBox(height: 12),
              const Text(
                'No Bus Assigned',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.textPrimary,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'You currently do not have a bus assigned for today. Contact your transport coordinator to assign a vehicle.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: AppTheme.textSecondary, height: 1.4),
              ),
            ],
          ),
        ),
      );
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppTheme.primaryNavy,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    bus.busNumber.isNotEmpty ? bus.busNumber : 'BUS',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppTheme.statusSuccessLight,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: AppTheme.statusSuccess.withOpacity(0.3)),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      CircleAvatar(radius: 3, backgroundColor: AppTheme.statusSuccess),
                      SizedBox(width: 6),
                      Text(
                        'Assigned & Ready',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: AppTheme.statusSuccess,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Registration Number',
                        style: TextStyle(fontSize: 11, color: AppTheme.textMuted, fontWeight: FontWeight.w500),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        bus.registrationNumber.isNotEmpty ? bus.registrationNumber : 'Not Specified',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.textPrimary,
                        ),
                      ),
                    ],
                  ),
                ),
                if (bus.makeModel != null && bus.makeModel!.isNotEmpty) ...[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Vehicle Model',
                          style: TextStyle(fontSize: 11, color: AppTheme.textMuted, fontWeight: FontWeight.w500),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          bus.makeModel!,
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: AppTheme.textPrimary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 14),
            const Divider(height: 1),
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                icon: const Icon(Icons.people_alt_outlined, size: 18),
                label: const Text('View Registered Students (Manifest)'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppTheme.primaryNavy,
                  side: const BorderSide(color: AppTheme.primaryNavy),
                  padding: const EdgeInsets.symmetric(vertical: 10),
                ),
                onPressed: () => _showStudentRosterSheet(bus.id),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showStudentRosterSheet(String? busId) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        return DraggableScrollableSheet(
          initialChildSize: 0.85,
          minChildSize: 0.5,
          maxChildSize: 0.95,
          expand: false,
          builder: (sheetContext, scrollController) {
            return FutureBuilder<ApiResponse<DriverStudentListModel>>(
              future: ApiService().getAssignedStudents(
                busId: busId,
                tripId: _tripStatusService.activeTrip?.tripId,
              ),
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(
                    child: Padding(
                      padding: EdgeInsets.all(40.0),
                      child: CircularProgressIndicator(),
                    ),
                  );
                }

                if (snapshot.hasError || snapshot.data == null || !snapshot.data!.success) {
                  return Padding(
                    padding: const EdgeInsets.all(24.0),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.error_outline, size: 48, color: AppTheme.statusEmergency),
                        const SizedBox(height: 16),
                        Text(
                          snapshot.data?.message ?? 'Failed to load registered student manifest.',
                          textAlign: TextAlign.center,
                          style: const TextStyle(fontSize: 14, color: AppTheme.textPrimary),
                        ),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          onPressed: () => Navigator.pop(ctx),
                          child: const Text('Close'),
                        ),
                      ],
                    ),
                  );
                }

                DriverStudentListModel manifest = snapshot.data!.data!;
                final activeTripId = manifest.tripId ?? _profileData?.activeTrip?['id']?.toString();

                final TextEditingController searchController = TextEditingController();
                String searchQuery = '';

                return StatefulBuilder(
                  builder: (sheetContext, setModalState) {
                    final students = searchQuery.isEmpty
                        ? manifest.students
                        : manifest.students.where((s) =>
                            s.fullName.toLowerCase().contains(searchQuery.toLowerCase()) ||
                            s.admissionNumber.toLowerCase().contains(searchQuery.toLowerCase())).toList();

                    Future<void> handleRecordBoarding(StudentAttendanceItem student, String status) async {
                      if (activeTripId == null) {
                        ScaffoldMessenger.of(sheetContext).showSnackBar(
                          const SnackBar(
                            content: Text('Cannot mark attendance: No active trip in progress.'),
                            backgroundColor: AppTheme.statusEmergency,
                          ),
                        );
                        return;
                      }

                      final oldStatus = student.attendanceStatus;
                      if (oldStatus == status) return;

                      // Optimistic UI calculation
                      final updatedStudent = student.copyWith(
                        attendanceStatus: status,
                        boardedAt: status == 'BOARDED' ? DateTime.now().toIso8601String() : null,
                      );
                      final updatedList = manifest.students
                          .map((s) => s.studentId == student.studentId ? updatedStudent : s)
                          .toList();

                      int newBoarded = manifest.boardedCount;
                      int newAbsent = manifest.absentCount;
                      int newPending = manifest.pendingCount;

                      if (oldStatus == 'PENDING') {
                        newPending = (newPending - 1).clamp(0, 9999);
                        if (status == 'BOARDED') newBoarded++;
                        if (status == 'ABSENT') newAbsent++;
                      } else if (oldStatus == 'BOARDED' && status == 'ABSENT') {
                        newBoarded = (newBoarded - 1).clamp(0, 9999);
                        newAbsent++;
                      } else if (oldStatus == 'ABSENT' && status == 'BOARDED') {
                        newAbsent = (newAbsent - 1).clamp(0, 9999);
                        newBoarded++;
                      }

                      setModalState(() {
                        manifest = manifest.copyWith(
                          boardedCount: newBoarded,
                          absentCount: newAbsent,
                          pendingCount: newPending,
                          students: updatedList,
                        );
                      });

                      // Capture GPS position
                      double? lat;
                      double? lng;
                      try {
                        final pos = await Geolocator.getLastKnownPosition();
                        if (pos != null) {
                          lat = pos.latitude;
                          lng = pos.longitude;
                        }
                      } catch (_) {}

                      final res = await ApiService().recordBoarding(
                        tripId: activeTripId,
                        studentId: student.studentId,
                        stopId: student.pickupStop.id,
                        status: status,
                        latitude: lat,
                        longitude: lng,
                        recordedAt: DateTime.now().toUtc().toIso8601String(),
                      );

                      if (!res.success) {
                        // Revert on failure
                        setModalState(() {
                          final revertedList = manifest.students
                              .map((s) => s.studentId == student.studentId ? student : s)
                              .toList();
                          manifest = manifest.copyWith(
                            boardedCount: manifest.boardedCount + (oldStatus == 'BOARDED' ? 1 : 0) - (status == 'BOARDED' ? 1 : 0),
                            absentCount: manifest.absentCount + (oldStatus == 'ABSENT' ? 1 : 0) - (status == 'ABSENT' ? 1 : 0),
                            pendingCount: manifest.pendingCount + (oldStatus == 'PENDING' ? 1 : 0),
                            students: revertedList,
                          );
                        });

                        if (sheetContext.mounted) {
                          ScaffoldMessenger.of(sheetContext).showSnackBar(
                            SnackBar(
                              content: Text('Failed to record attendance: ${res.message}'),
                              backgroundColor: AppTheme.statusEmergency,
                            ),
                          );
                        }
                      } else {
                        if (sheetContext.mounted) {
                          ScaffoldMessenger.of(sheetContext).showSnackBar(
                            SnackBar(
                              content: Text(
                                '${student.fullName} marked as ${status == 'BOARDED' ? 'BOARDED' : 'ABSENT'}',
                              ),
                              duration: const Duration(seconds: 2),
                              backgroundColor: status == 'BOARDED' ? AppTheme.statusSuccess : AppTheme.statusEmergency,
                            ),
                          );
                        }
                      }
                    }

                    Future<void> handleRecordDrop(StudentAttendanceItem student) async {
                      if (activeTripId == null) {
                        ScaffoldMessenger.of(sheetContext).showSnackBar(
                          const SnackBar(
                            content: Text('Cannot mark drop: No active trip in progress.'),
                            backgroundColor: AppTheme.statusEmergency,
                          ),
                        );
                        return;
                      }

                      final oldStatus = student.attendanceStatus;
                      if (oldStatus == 'DEBOARDED') return;

                      // Optimistic UI calculation
                      final updatedStudent = student.copyWith(
                        attendanceStatus: 'DEBOARDED',
                        droppedAt: DateTime.now().toIso8601String(),
                      );
                      final updatedList = manifest.students
                          .map((s) => s.studentId == student.studentId ? updatedStudent : s)
                          .toList();

                      int newBoarded = manifest.boardedCount;
                      int newDropped = manifest.droppedCount + 1;
                      int newAbsent = manifest.absentCount;
                      int newPending = manifest.pendingCount;

                      if (oldStatus == 'PENDING') {
                        newPending = (newPending - 1).clamp(0, 9999);
                      } else if (oldStatus == 'ABSENT') {
                        newAbsent = (newAbsent - 1).clamp(0, 9999);
                      }

                      setModalState(() {
                        manifest = manifest.copyWith(
                          boardedCount: newBoarded,
                          droppedCount: newDropped,
                          absentCount: newAbsent,
                          pendingCount: newPending,
                          students: updatedList,
                        );
                      });

                      // Capture GPS position
                      double? lat;
                      double? lng;
                      try {
                        final pos = await Geolocator.getLastKnownPosition();
                        if (pos != null) {
                          lat = pos.latitude;
                          lng = pos.longitude;
                        }
                      } catch (_) {}

                      final res = await ApiService().recordDrop(
                        tripId: activeTripId,
                        studentId: student.studentId,
                        stopId: student.dropStop?.id ?? student.pickupStop.id,
                        status: 'DEBOARDED',
                        latitude: lat,
                        longitude: lng,
                        recordedAt: DateTime.now().toUtc().toIso8601String(),
                      );

                      if (!res.success) {
                        // Revert on failure
                        setModalState(() {
                          final revertedList = manifest.students
                              .map((s) => s.studentId == student.studentId ? student : s)
                              .toList();
                          manifest = manifest.copyWith(
                            boardedCount: manifest.boardedCount,
                            droppedCount: (manifest.droppedCount - 1).clamp(0, 9999),
                            absentCount: manifest.absentCount,
                            pendingCount: manifest.pendingCount + (oldStatus == 'PENDING' ? 1 : 0),
                            students: revertedList,
                          );
                        });

                        if (sheetContext.mounted) {
                          ScaffoldMessenger.of(sheetContext).showSnackBar(
                            SnackBar(
                              content: Text('Failed to record drop: ${res.message}'),
                              backgroundColor: AppTheme.statusEmergency,
                            ),
                          );
                        }
                      } else {
                        if (sheetContext.mounted) {
                          ScaffoldMessenger.of(sheetContext).showSnackBar(
                            SnackBar(
                              content: Text('${student.fullName} marked as DROPPED / DEBOARDED'),
                              duration: const Duration(seconds: 2),
                              backgroundColor: AppTheme.primaryNavy,
                            ),
                          );
                        }
                      }
                    }

                    Future<void> handleViewJourney(StudentAttendanceItem student) async {
                      showModalBottomSheet(
                        context: context,
                        shape: const RoundedRectangleBorder(
                          borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
                        ),
                        builder: (journeyCtx) {
                          return FutureBuilder<ApiResponse<Map<String, dynamic>>>(
                            future: ApiService().getStudentJourney(
                              studentId: student.studentId,
                              tripId: activeTripId,
                            ),
                            builder: (context, snap) {
                              if (snap.connectionState == ConnectionState.waiting) {
                                return const SizedBox(
                                  height: 250,
                                  child: Center(child: CircularProgressIndicator()),
                                );
                              }
                              if (snap.hasError || snap.data?.success != true) {
                                return Padding(
                                  padding: const EdgeInsets.all(24.0),
                                  child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Icon(Icons.error_outline, size: 40, color: AppTheme.statusEmergency),
                                      const SizedBox(height: 12),
                                      Text(snap.data?.message ?? 'Failed to load journey history'),
                                    ],
                                  ),
                                );
                              }

                              final journeyData = snap.data!.data ?? {};
                              final timelineRaw = (journeyData['timeline'] as List<dynamic>?) ?? [];
                              final currentStatus = journeyData['currentStatus']?.toString() ?? 'PENDING';

                              return Padding(
                                padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        const Icon(Icons.timeline_rounded, color: AppTheme.primaryNavy),
                                        const SizedBox(width: 8),
                                        Expanded(
                                          child: Text(
                                            'Journey Timeline: ${student.fullName}',
                                            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                                          ),
                                        ),
                                        Chip(
                                          label: Text(currentStatus, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold)),
                                          backgroundColor: AppTheme.primaryNavy.withOpacity(0.08),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 16),
                                    if (timelineRaw.isEmpty)
                                      const Padding(
                                        padding: EdgeInsets.symmetric(vertical: 24),
                                        child: Center(child: Text('No events recorded yet')),
                                      )
                                    else
                                      Flexible(
                                        child: ListView.separated(
                                          shrinkWrap: true,
                                          itemCount: timelineRaw.length,
                                          separatorBuilder: (_, __) => const Divider(height: 12),
                                          itemBuilder: (_, tIdx) {
                                            final ev = timelineRaw[tIdx] as Map<String, dynamic>;
                                            final type = ev['type']?.toString() ?? 'EVENT';
                                            final status = ev['status']?.toString() ?? '';
                                            final time = ev['timestamp']?.toString() ?? '';
                                            final stopName = ev['stopName']?.toString() ?? '';
                                            final reason = ev['reason']?.toString();

                                            IconData icon = Icons.circle_outlined;
                                            Color iconColor = AppTheme.textMuted;
                                            if (type == 'BOARDING') {
                                              icon = Icons.check_circle_rounded;
                                              iconColor = AppTheme.statusSuccess;
                                            } else if (type == 'DROP') {
                                              icon = Icons.directions_walk_rounded;
                                              iconColor = AppTheme.primaryNavy;
                                            } else if (type == 'CORRECTION') {
                                              icon = Icons.edit_note_rounded;
                                              iconColor = AppTheme.statusWarning;
                                            }

                                            return Row(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              children: [
                                                Icon(icon, size: 20, color: iconColor),
                                                const SizedBox(width: 10),
                                                Expanded(
                                                  child: Column(
                                                    crossAxisAlignment: CrossAxisAlignment.start,
                                                    children: [
                                                      Text(
                                                        '$type: $status',
                                                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                                                      ),
                                                      if (stopName.isNotEmpty)
                                                        Text('Stop: $stopName', style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary)),
                                                      if (reason != null && reason.isNotEmpty)
                                                        Text('Reason: "$reason"', style: const TextStyle(fontSize: 11, fontStyle: FontStyle.italic, color: AppTheme.statusWarning)),
                                                    ],
                                                  ),
                                                ),
                                                Text(
                                                  time.length > 10 ? time.substring(11, 16) : time,
                                                  style: const TextStyle(fontSize: 11, color: AppTheme.textMuted),
                                                ),
                                              ],
                                            );
                                          },
                                        ),
                                      ),
                                  ],
                                ),
                              );
                            },
                          );
                        },
                      );
                    }

                    Future<void> handleOpenCorrectionDialog(StudentAttendanceItem student) async {
                      if (activeTripId == null) {
                        ScaffoldMessenger.of(sheetContext).showSnackBar(
                          const SnackBar(
                            content: Text('Cannot correct attendance: No active trip in progress.'),
                            backgroundColor: AppTheme.statusEmergency,
                          ),
                        );
                        return;
                      }

                      String selectedStatus = student.attendanceStatus == 'BOARDED' ? 'ABSENT' : 'BOARDED';
                      String eventType = selectedStatus == 'DEBOARDED' ? 'DROP' : 'BOARDING';
                      final reasonController = TextEditingController();
                      final formKey = GlobalKey<FormState>();
                      bool isSubmitting = false;

                      await showDialog(
                        context: context,
                        builder: (dialogCtx) {
                          return StatefulBuilder(
                            builder: (context, setDialogState) {
                              return AlertDialog(
                                title: Row(
                                  children: [
                                    const Icon(Icons.edit_note_rounded, color: AppTheme.primaryNavy),
                                    const SizedBox(width: 8),
                                    const Text('Correct Attendance', style: TextStyle(fontSize: 16)),
                                  ],
                                ),
                                content: Form(
                                  key: formKey,
                                  child: SingleChildScrollView(
                                    child: Column(
                                      mainAxisSize: MainAxisSize.min,
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          'Student: ${student.fullName} (${student.admissionNumber})',
                                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                                        ),
                                        const SizedBox(height: 4),
                                        Text(
                                          'Current Status: ${student.attendanceStatus}',
                                          style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                                        ),
                                        const SizedBox(height: 14),
                                        const Text('Correct To:', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                                        DropdownButton<String>(
                                          value: selectedStatus,
                                          isExpanded: true,
                                          items: const [
                                            DropdownMenuItem(value: 'BOARDED', child: Text('Boarded')),
                                            DropdownMenuItem(value: 'ABSENT', child: Text('Absent / Not Boarded')),
                                            DropdownMenuItem(value: 'DEBOARDED', child: Text('Dropped (Deboarded)')),
                                            DropdownMenuItem(value: 'PENDING', child: Text('Reset to Pending')),
                                          ],
                                          onChanged: (val) {
                                            if (val != null) {
                                              setDialogState(() {
                                                selectedStatus = val;
                                                eventType = val == 'DEBOARDED' ? 'DROP' : 'BOARDING';
                                              });
                                            }
                                          },
                                        ),
                                        const SizedBox(height: 12),
                                        TextFormField(
                                          controller: reasonController,
                                          maxLines: 2,
                                          decoration: const InputDecoration(
                                            labelText: 'Reason for correction *',
                                            hintText: 'e.g. Boarded at stop 2 / Clicked by error',
                                            border: OutlineInputBorder(),
                                            contentPadding: EdgeInsets.all(10),
                                          ),
                                          validator: (val) {
                                            if (val == null || val.trim().length < 5) {
                                              return 'Reason must be at least 5 characters.';
                                            }
                                            return null;
                                          },
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                                actions: [
                                  TextButton(
                                    onPressed: isSubmitting ? null : () => Navigator.pop(dialogCtx),
                                    child: const Text('Cancel'),
                                  ),
                                  ElevatedButton(
                                    onPressed: isSubmitting
                                        ? null
                                        : () async {
                                            if (!formKey.currentState!.validate()) return;
                                            setDialogState(() => isSubmitting = true);

                                            double? lat;
                                            double? lng;
                                            try {
                                              final pos = await Geolocator.getLastKnownPosition();
                                              if (pos != null) {
                                                lat = pos.latitude;
                                                lng = pos.longitude;
                                              }
                                            } catch (_) {}

                                            final res = await ApiService().correctAttendance(
                                              tripId: activeTripId,
                                              studentId: student.studentId,
                                              eventType: eventType,
                                              newStatus: selectedStatus,
                                              reason: reasonController.text.trim(),
                                              latitude: lat,
                                              longitude: lng,
                                            );

                                            if (dialogCtx.mounted) {
                                              Navigator.pop(dialogCtx);
                                            }

                                            if (res.success && res.data != null) {
                                              final summaryData = res.data!['summary'] as Map<String, dynamic>?;
                                              final updatedStudent = student.copyWith(
                                                attendanceStatus: selectedStatus,
                                              );
                                              final updatedList = manifest.students
                                                  .map((s) => s.studentId == student.studentId ? updatedStudent : s)
                                                  .toList();

                                              setModalState(() {
                                                manifest = manifest.copyWith(
                                                  boardedCount: summaryData?['boardedCount'] ?? manifest.boardedCount,
                                                  droppedCount: summaryData?['droppedCount'] ?? manifest.droppedCount,
                                                  absentCount: summaryData?['absentCount'] ?? manifest.absentCount,
                                                  pendingCount: summaryData?['pendingCount'] ?? manifest.pendingCount,
                                                  students: updatedList,
                                                );
                                              });

                                              if (sheetContext.mounted) {
                                                ScaffoldMessenger.of(sheetContext).showSnackBar(
                                                  SnackBar(
                                                    content: Text('Attendance corrected for ${student.fullName}'),
                                                    backgroundColor: AppTheme.primaryNavy,
                                                  ),
                                                );
                                              }
                                            } else {
                                              if (sheetContext.mounted) {
                                                ScaffoldMessenger.of(sheetContext).showSnackBar(
                                                  SnackBar(
                                                    content: Text('Correction failed: ${res.message}'),
                                                    backgroundColor: AppTheme.statusEmergency,
                                                  ),
                                                );
                                              }
                                            }
                                          },
                                    child: isSubmitting
                                        ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                                        : const Text('Save Correction'),
                                  ),
                                ],
                              );
                            },
                          );
                        },
                      );
                    }

                    return Column(
                      children: [
                        // Sheet Header
                        Padding(
                          padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Text(
                                          'Student Manifest (${manifest.totalStudents})',
                                          style: const TextStyle(
                                            fontSize: 16,
                                            fontWeight: FontWeight.bold,
                                            color: AppTheme.textPrimary,
                                          ),
                                        ),
                                        const SizedBox(width: 8),
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                          decoration: BoxDecoration(
                                            color: AppTheme.primaryNavy.withOpacity(0.1),
                                            borderRadius: BorderRadius.circular(4),
                                          ),
                                          child: Text(
                                            manifest.busNumber.isNotEmpty ? manifest.busNumber : 'Bus',
                                            style: const TextStyle(
                                              fontSize: 11,
                                              fontWeight: FontWeight.bold,
                                              color: AppTheme.primaryNavy,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                    if (manifest.routeName != null)
                                      Text(
                                        manifest.routeCode != null
                                            ? '${manifest.routeCode} - ${manifest.routeName}'
                                            : manifest.routeName!,
                                        style: const TextStyle(fontSize: 12, color: AppTheme.textMuted),
                                      ),
                                  ],
                                ),
                              ),
                              IconButton(
                                icon: const Icon(Icons.close),
                                onPressed: () => Navigator.pop(ctx),
                              ),
                            ],
                          ),
                        ),

                        // Live Attendance Summary Breakdown
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
                          child: SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: AppTheme.statusSuccessLight,
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(
                                    'Boarded: ${manifest.boardedCount}',
                                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.statusSuccess),
                                  ),
                                ),
                                const SizedBox(width: 6),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: AppTheme.primaryNavy.withOpacity(0.1),
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(
                                    'Dropped: ${manifest.droppedCount}',
                                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.primaryNavy),
                                  ),
                                ),
                                const SizedBox(width: 6),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: AppTheme.statusEmergencyLight,
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(
                                    'Absent: ${manifest.absentCount}',
                                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.statusEmergency),
                                  ),
                                ),
                                const SizedBox(width: 6),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: Colors.grey.shade100,
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(
                                    'Pending: ${manifest.pendingCount}',
                                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppTheme.textMuted),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 6),
                        const Divider(height: 1),

                        // Search bar — client-side filter, no extra API call
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                          child: TextField(
                            controller: searchController,
                            onChanged: (val) => setModalState(() {
                              searchQuery = val.trim();
                            }),
                            decoration: InputDecoration(
                              hintText: 'Search student name or admission no…',
                              hintStyle: const TextStyle(fontSize: 13, color: AppTheme.textMuted),
                              prefixIcon: const Icon(Icons.search_rounded, size: 20, color: AppTheme.textMuted),
                              suffixIcon: searchQuery.isNotEmpty
                                  ? IconButton(
                                      icon: const Icon(Icons.clear_rounded, size: 18),
                                      onPressed: () => setModalState(() {
                                        searchController.clear();
                                        searchQuery = '';
                                      }),
                                    )
                                  : null,
                              isDense: true,
                              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(8),
                                borderSide: BorderSide(color: Colors.grey.shade300),
                              ),
                              enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(8),
                                borderSide: BorderSide(color: Colors.grey.shade300),
                              ),
                              focusedBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(8),
                                borderSide: const BorderSide(color: AppTheme.primaryNavy),
                              ),
                              filled: true,
                              fillColor: Colors.grey.shade50,
                            ),
                          ),
                        ),

                        Expanded(
                          child: students.isEmpty
                              ? Center(
                                  child: Padding(
                                    padding: const EdgeInsets.all(32.0),
                                    child: Column(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Icon(
                                          searchQuery.isNotEmpty
                                              ? Icons.search_off_rounded
                                              : Icons.people_outline_rounded,
                                          size: 40,
                                          color: AppTheme.textMuted,
                                        ),
                                        const SizedBox(height: 12),
                                        Text(
                                          searchQuery.isNotEmpty
                                              ? 'No students match "$searchQuery".\nTry the full name or admission number.'
                                              : 'No registered students found for this route.\nContact your transport coordinator.',
                                          textAlign: TextAlign.center,
                                          style: const TextStyle(color: AppTheme.textMuted, fontSize: 13),
                                        ),
                                      ],
                                    ),
                                  ),
                                )
                              : ListView.builder(
                                  controller: scrollController,
                                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                                  itemCount: students.length,
                                  itemBuilder: (context, index) {
                                    final student = students[index];
                                    final isFirstOfStop = index == 0 ||
                                        students[index - 1].pickupStop.id != student.pickupStop.id;

                                    return Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        if (isFirstOfStop) ...[
                                          Padding(
                                            padding: const EdgeInsets.only(top: 14, bottom: 6),
                                            child: Row(
                                              children: [
                                                const Icon(Icons.place_rounded, size: 16, color: AppTheme.primaryNavy),
                                                const SizedBox(width: 6),
                                                Expanded(
                                                  child: Text(
                                                    'Stop #${student.pickupStop.sequenceOrder}: ${student.pickupStop.name}',
                                                    style: const TextStyle(
                                                      fontWeight: FontWeight.bold,
                                                      fontSize: 13,
                                                      color: AppTheme.primaryNavy,
                                                    ),
                                                  ),
                                                ),
                                                if (student.pickupStop.expectedTimeOffsetMinutes != null)
                                                  Text(
                                                    '+${student.pickupStop.expectedTimeOffsetMinutes}m',
                                                    style: const TextStyle(fontSize: 11, color: AppTheme.textMuted),
                                                  ),
                                              ],
                                            ),
                                          ),
                                        ],
                                        Card(
                                          margin: const EdgeInsets.only(bottom: 6),
                                          elevation: 0,
                                          shape: RoundedRectangleBorder(
                                            borderRadius: BorderRadius.circular(8),
                                            side: BorderSide(color: Colors.grey.shade200),
                                          ),
                                          child: ListTile(
                                            dense: true,
                                            onTap: () => _showStudentDetailSheet(
                                              sheetContext,
                                              student,
                                              manifest,
                                            ),
                                            leading: CircleAvatar(
                                              radius: 16,
                                              backgroundColor: AppTheme.primaryNavy.withOpacity(0.08),
                                              child: Text(
                                                student.fullName.isNotEmpty ? student.fullName[0].toUpperCase() : 'S',
                                                style: const TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  color: AppTheme.primaryNavy,
                                                  fontSize: 12,
                                                ),
                                              ),
                                            ),
                                            title: Text(
                                              student.fullName,
                                              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                                            ),
                                            subtitle: Text(
                                              'Adm: ${student.admissionNumber}${student.grade != null ? ' • Class ${student.grade}' : ''}',
                                              style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                                            ),
                                            trailing: activeTripId != null
                                                ? (student.attendanceStatus == 'PENDING'
                                                    ? Row(
                                                        mainAxisSize: MainAxisSize.min,
                                                        children: [
                                                          IconButton(
                                                            icon: const Icon(Icons.check_circle_outline, color: AppTheme.statusSuccess, size: 24),
                                                            tooltip: 'Mark Boarded',
                                                            onPressed: () => handleRecordBoarding(student, 'BOARDED'),
                                                          ),
                                                          IconButton(
                                                            icon: const Icon(Icons.directions_walk_rounded, color: AppTheme.primaryNavy, size: 24),
                                                            tooltip: 'Mark Dropped',
                                                            onPressed: () => handleRecordDrop(student),
                                                          ),
                                                          IconButton(
                                                            icon: const Icon(Icons.cancel_outlined, color: AppTheme.statusEmergency, size: 24),
                                                            tooltip: 'Mark Absent',
                                                            onPressed: () => handleRecordBoarding(student, 'ABSENT'),
                                                          ),
                                                        ],
                                                      )
                                                    : Row(
                                                        mainAxisSize: MainAxisSize.min,
                                                        children: [
                                                          Container(
                                                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                                            decoration: BoxDecoration(
                                                              color: student.attendanceStatus == 'BOARDED'
                                                                  ? AppTheme.statusSuccessLight
                                                                  : (student.attendanceStatus == 'DEBOARDED'
                                                                      ? AppTheme.primaryNavy.withOpacity(0.1)
                                                                      : (student.attendanceStatus == 'ABSENT'
                                                                          ? AppTheme.statusEmergencyLight
                                                                          : Colors.grey.shade100)),
                                                              borderRadius: BorderRadius.circular(4),
                                                            ),
                                                            child: Text(
                                                              student.attendanceStatus == 'DEBOARDED' ? 'DROPPED' : student.attendanceStatus,
                                                              style: TextStyle(
                                                                fontSize: 10,
                                                                fontWeight: FontWeight.bold,
                                                                color: student.attendanceStatus == 'BOARDED'
                                                                    ? AppTheme.statusSuccess
                                                                    : (student.attendanceStatus == 'DEBOARDED'
                                                                        ? AppTheme.primaryNavy
                                                                        : (student.attendanceStatus == 'ABSENT'
                                                                            ? AppTheme.statusEmergency
                                                                            : AppTheme.textMuted)),
                                                              ),
                                                            ),
                                                          ),
                                                          if (student.attendanceStatus == 'BOARDED')
                                                            IconButton(
                                                              icon: const Icon(Icons.directions_walk_rounded, color: AppTheme.primaryNavy, size: 22),
                                                              tooltip: 'Mark Dropped',
                                                              onPressed: () => handleRecordDrop(student),
                                                            ),
                                                          PopupMenuButton<String>(
                                                            icon: const Icon(Icons.more_vert, size: 18, color: AppTheme.textMuted),
                                                            onSelected: (val) {
                                                              if (val == 'DEBOARDED') {
                                                                handleRecordDrop(student);
                                                              } else if (val == 'VIEW_JOURNEY') {
                                                                handleViewJourney(student);
                                                              } else if (val == 'CORRECT') {
                                                                handleOpenCorrectionDialog(student);
                                                              } else {
                                                                handleRecordBoarding(student, val);
                                                              }
                                                            },
                                                            itemBuilder: (popCtx) => [
                                                              if (student.attendanceStatus != 'BOARDED')
                                                                const PopupMenuItem(value: 'BOARDED', child: Text('Mark Boarded')),
                                                              if (student.attendanceStatus != 'DEBOARDED')
                                                                const PopupMenuItem(value: 'DEBOARDED', child: Text('Mark Dropped (Deboarded)')),
                                                              if (student.attendanceStatus != 'ABSENT')
                                                                const PopupMenuItem(value: 'ABSENT', child: Text('Mark Absent')),
                                                              const PopupMenuDivider(),
                                                              const PopupMenuItem(value: 'VIEW_JOURNEY', child: Text('View Journey Timeline')),
                                                              const PopupMenuItem(value: 'CORRECT', child: Text('Correct Attendance…')),
                                                            ],
                                                          ),
                                                        ],
                                                      ))
                                                : Container(
                                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                                    decoration: BoxDecoration(
                                                      color: student.attendanceStatus == 'BOARDED'
                                                          ? AppTheme.statusSuccessLight
                                                          : (student.attendanceStatus == 'DEBOARDED'
                                                              ? AppTheme.primaryNavy.withOpacity(0.1)
                                                              : (student.attendanceStatus == 'ABSENT'
                                                                  ? AppTheme.statusEmergencyLight
                                                                  : Colors.grey.shade100)),
                                                      borderRadius: BorderRadius.circular(4),
                                                    ),
                                                    child: Text(
                                                      student.attendanceStatus == 'DEBOARDED' ? 'DROPPED' : student.attendanceStatus,
                                                      style: TextStyle(
                                                        fontSize: 10,
                                                        fontWeight: FontWeight.bold,
                                                        color: student.attendanceStatus == 'BOARDED'
                                                            ? AppTheme.statusSuccess
                                                            : (student.attendanceStatus == 'DEBOARDED'
                                                                ? AppTheme.primaryNavy
                                                                : (student.attendanceStatus == 'ABSENT'
                                                                    ? AppTheme.statusEmergency
                                                                    : AppTheme.textMuted)),
                                                      ),
                                                    ),
                                                  )
                                          ),
                                        ),
                                      ],
                                    );
                                  },
                                ),
                        ),
                      ],
                    );
                  },
                );
              },
            );
          },
        );
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Phase 19.2: Student result detail sheet
  // Shows full student info: name, parent, phone, pickup address/location,
  // bus and route. Data comes from the already-loaded DriverStudentListModel.
  // ---------------------------------------------------------------------------
  void _showStudentDetailSheet(
    BuildContext context,
    StudentAttendanceItem student,
    DriverStudentListModel manifest,
  ) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return DraggableScrollableSheet(
          initialChildSize: 0.65,
          minChildSize: 0.4,
          maxChildSize: 0.92,
          builder: (_, scrollCtrl) {
            final status = student.attendanceStatus;
            final Color statusColor = status == 'BOARDED'
                ? AppTheme.statusSuccess
                : status == 'DEBOARDED'
                    ? AppTheme.primaryNavy
                    : status == 'ABSENT'
                        ? AppTheme.statusEmergency
                        : AppTheme.textMuted;
            final Color statusBg = status == 'BOARDED'
                ? AppTheme.statusSuccessLight
                : status == 'DEBOARDED'
                    ? AppTheme.primaryNavy.withOpacity(0.1)
                    : status == 'ABSENT'
                        ? AppTheme.statusEmergencyLight
                        : Colors.grey.shade100;
            final String statusLabel =
                status == 'DEBOARDED' ? 'DROPPED' : status;

            final routeLabel = manifest.routeCode != null
                ? '${manifest.routeCode} – ${manifest.routeName ?? 'Assigned Route'}'
                : manifest.routeName ?? 'Assigned Route';

            return Container(
              decoration: const BoxDecoration(
                color: AppTheme.cardBg,
                borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
              ),
              child: Column(
                children: [
                  // Drag handle
                  Padding(
                    padding: const EdgeInsets.only(top: 10, bottom: 6),
                    child: Container(
                      width: 36,
                      height: 4,
                      decoration: BoxDecoration(
                        color: Colors.grey.shade300,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),

                  // Header: avatar + name + status
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
                    child: Row(
                      children: [
                        CircleAvatar(
                          radius: 22,
                          backgroundColor: AppTheme.primaryNavy.withOpacity(0.1),
                          child: Text(
                            student.fullName.isNotEmpty
                                ? student.fullName[0].toUpperCase()
                                : 'S',
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              color: AppTheme.primaryNavy,
                              fontSize: 18,
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                student.fullName,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w700,
                                  fontSize: 16,
                                  color: AppTheme.textPrimary,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Row(
                                children: [
                                  Text(
                                    'Adm: ${student.admissionNumber}',
                                    style: const TextStyle(
                                        fontSize: 12, color: AppTheme.textSecondary),
                                  ),
                                  if (student.grade != null) ...[
                                    const SizedBox(width: 6),
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 6, vertical: 1),
                                      decoration: BoxDecoration(
                                        color: AppTheme.primaryNavy.withOpacity(0.07),
                                        borderRadius: BorderRadius.circular(4),
                                      ),
                                      child: Text(
                                        'Class ${student.grade}${student.section != null ? '-${student.section}' : ''}',
                                        style: const TextStyle(
                                          fontSize: 11,
                                          color: AppTheme.primaryNavy,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                            ],
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          decoration: BoxDecoration(
                            color: statusBg,
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            statusLabel,
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: statusColor,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Divider(height: 1),

                  // Scrollable body
                  Expanded(
                    child: ListView(
                      controller: scrollCtrl,
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                      children: [
                        // --- Contact section ---
                        _detailSectionHeader(Icons.person_outline_rounded, 'Parent / Guardian'),
                        if (student.parent != null) ...[
                          _detailRow(
                            Icons.badge_outlined,
                            'Name',
                            '${student.parent!.fullName}${student.parent!.relationship != null ? ' (${student.parent!.relationship})' : ''}',
                          ),
                          _detailRow(
                            Icons.phone_outlined,
                            'Phone',
                            student.parent!.phone,
                            valueStyle: const TextStyle(
                              fontSize: 13,
                              color: AppTheme.primaryNavy,
                              fontWeight: FontWeight.w600,
                              decoration: TextDecoration.underline,
                            ),
                          ),
                        ] else
                          _detailRowPlaceholder('No parent contact on record'),
                        if (student.emergencyPhone != null)
                          _detailRow(
                            Icons.emergency_outlined,
                            'Emergency',
                            student.emergencyPhone!,
                            valueStyle: const TextStyle(
                              fontSize: 13,
                              color: AppTheme.statusEmergency,
                              fontWeight: FontWeight.w600,
                            ),
                          ),

                        const SizedBox(height: 16),

                        // --- Pickup stop section ---
                        _detailSectionHeader(Icons.place_rounded, 'Pickup Stop'),
                        _detailRow(
                          Icons.format_list_numbered_rounded,
                          'Stop',
                          '${student.pickupStop.name} (Stop #${student.pickupStop.sequenceOrder})',
                        ),
                        if (student.pickupStop.address != null)
                          _detailRow(
                            Icons.home_outlined,
                            'Address',
                            student.pickupStop.address!,
                          ),
                        _detailRow(
                          Icons.my_location_rounded,
                          'Location',
                          '${student.pickupStop.latitude.toStringAsFixed(5)}, ${student.pickupStop.longitude.toStringAsFixed(5)}',
                          valueStyle: const TextStyle(
                            fontSize: 12,
                            color: AppTheme.textSecondary,
                            fontFamily: 'monospace',
                          ),
                        ),
                        if (student.pickupStop.expectedTimeOffsetMinutes != null)
                          _detailRow(
                            Icons.access_time_outlined,
                            'ETA Offset',
                            '+${student.pickupStop.expectedTimeOffsetMinutes} min from trip start',
                          ),

                        // --- Drop stop (optional) ---
                        if (student.dropStop != null) ...[
                          const SizedBox(height: 16),
                          _detailSectionHeader(Icons.school_outlined, 'Drop Stop'),
                          _detailRow(
                            Icons.format_list_numbered_rounded,
                            'Stop',
                            '${student.dropStop!.name} (Stop #${student.dropStop!.sequenceOrder})',
                          ),
                          if (student.dropStop!.address != null)
                            _detailRow(
                              Icons.home_outlined,
                              'Address',
                              student.dropStop!.address!,
                            ),
                        ],

                        const SizedBox(height: 16),

                        // --- Bus & Route ---
                        _detailSectionHeader(Icons.directions_bus_outlined, 'Bus & Route'),
                        _detailRow(
                          Icons.confirmation_number_outlined,
                          'Bus Number',
                          manifest.busNumber,
                        ),
                        _detailRow(
                          Icons.credit_card_outlined,
                          'Reg. Plate',
                          manifest.registrationNumber,
                        ),
                        _detailRow(
                          Icons.route_outlined,
                          'Route',
                          routeLabel,
                        ),

                        // --- Attendance timestamps ---
                        if (student.boardedAt != null || student.droppedAt != null) ...[
                          const SizedBox(height: 16),
                          _detailSectionHeader(Icons.history_rounded, 'Today\'s Attendance'),
                          if (student.boardedAt != null)
                            _detailRow(Icons.login_rounded, 'Boarded', _formatTimestamp(student.boardedAt!)),
                          if (student.droppedAt != null)
                            _detailRow(Icons.logout_rounded, 'Dropped', _formatTimestamp(student.droppedAt!)),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  // Formats an ISO-8601 timestamp to readable HH:mm IST for the detail sheet
  String _formatTimestamp(String iso) {
    try {
      final dt = DateTime.parse(iso).toLocal();
      final h = dt.hour.toString().padLeft(2, '0');
      final m = dt.minute.toString().padLeft(2, '0');
      return '$h:$m';
    } catch (_) {
      return iso;
    }
  }

  // Section header row for the detail sheet
  Widget _detailSectionHeader(IconData icon, String label) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Icon(icon, size: 15, color: AppTheme.primaryNavy),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: AppTheme.primaryNavy,
              letterSpacing: 0.4,
            ),
          ),
        ],
      ),
    );
  }

  // Key-value detail row for the detail sheet
  Widget _detailRow(
    IconData icon,
    String label,
    String value, {
    TextStyle? valueStyle,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 14, color: AppTheme.textMuted),
          const SizedBox(width: 8),
          SizedBox(
            width: 80,
            child: Text(
              label,
              style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: valueStyle ??
                  const TextStyle(fontSize: 13, color: AppTheme.textPrimary),
            ),
          ),
        ],
      ),
    );
  }

  // Placeholder row when data is absent
  Widget _detailRowPlaceholder(String message) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        message,
        style: const TextStyle(fontSize: 12, color: AppTheme.textMuted, fontStyle: FontStyle.italic),
      ),
    );
  }

  Widget _buildTodayRoutesCard() {
    final tripsRaw = _profileData?.todayTrips ?? [];
    if (tripsRaw.isEmpty) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(20.0),
          child: Column(
            children: [
              Icon(Icons.event_busy_rounded, size: 36, color: AppTheme.textMuted),
              const SizedBox(height: 10),
              const Text(
                'No Trips Scheduled For Today',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                  color: AppTheme.textPrimary,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'Trips scheduled for your bus will automatically appear here.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
              ),
            ],
          ),
        ),
      );
    }

    final trips = tripsRaw.map((t) => AssignedTrip.fromJson(t)).toList();

    return Column(
      children: trips.map((trip) => _buildTripItem(trip)).toList(),
    );
  }

  Widget _buildTripItem(AssignedTrip trip) {
    Color statusColor;
    Color statusBgColor;

    switch (trip.status.toUpperCase()) {
      case 'IN_TRANSIT':
        statusColor = AppTheme.statusSuccess;
        statusBgColor = AppTheme.statusSuccessLight;
        break;
      case 'DELAYED':
        statusColor = AppTheme.statusWarning;
        statusBgColor = AppTheme.statusWarningLight;
        break;
      case 'ARRIVED_SCHOOL':
        statusColor = AppTheme.accentSky;
        statusBgColor = const Color(0xFFF0F9FF);
        break;
      case 'COMPLETED':
        statusColor = AppTheme.statusNeutral;
        statusBgColor = AppTheme.statusNeutralLight;
        break;
      case 'CANCELLED':
        statusColor = AppTheme.statusEmergency;
        statusBgColor = AppTheme.statusEmergencyLight;
        break;
      case 'SCHEDULED':
      default:
        statusColor = AppTheme.accentSky;
        statusBgColor = const Color(0xFFF0F9FF);
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
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
                      trip.routeName ?? 'Scheduled Route',
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: statusBgColor,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: statusColor.withOpacity(0.3)),
                  ),
                  child: Text(
                    AppFormatters.formatTripStatus(trip.status),
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: statusColor,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            const Divider(height: 1, color: AppTheme.borderSubtle),
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    const Icon(Icons.schedule_rounded, size: 15, color: AppTheme.textSecondary),
                    const SizedBox(width: 5),
                    Text(
                      AppFormatters.formatTime(trip.scheduledStartTime),
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppTheme.textPrimary,
                      ),
                    ),
                  ],
                ),
                if (trip.totalStops > 0)
                  Row(
                    children: [
                      const Icon(Icons.place_outlined, size: 15, color: AppTheme.textSecondary),
                      const SizedBox(width: 4),
                      Text(
                        '${trip.totalStops} Stops',
                        style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                      ),
                    ],
                  ),
                if (trip.delayMinutes > 0)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppTheme.statusWarningLight,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      '+${trip.delayMinutes} min delay',
                      style: const TextStyle(
                        fontSize: 11,
                        color: AppTheme.statusWarning,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildWhatsAppBotCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF0FDF4),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: const Color(0xFFBBF7D0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.chat_bubble_rounded, size: 20, color: Color(0xFF16A34A)),
              SizedBox(width: 8),
              Text(
                'WhatsApp Daily Actions',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                  color: Color(0xFF166534),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            'Start Trip, End Trip, Student Pickup Search, Delay Alerts, and SOS are handled directly via WhatsApp bot messages.',
            style: TextStyle(
              fontSize: 12,
              color: Color(0xFF15803D),
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTelemetryStatusCard() {
    final isGpsOff = !(_permissionsState?.isGpsServiceEnabled ?? true);
    final isFullReady = _permissionsState?.isFullTelemetryReady ?? false;
    final isEssential = _permissionsState?.isEssentialReady ?? false;

    String statusText;
    Color statusColor;
    Color statusBgColor;

    if (isGpsOff) {
      statusText = 'GPS DISABLED';
      statusColor = AppTheme.statusEmergency;
      statusBgColor = AppTheme.statusEmergencyLight;
    } else if (isFullReady) {
      statusText = 'OPTIMAL READY';
      statusColor = AppTheme.statusSuccess;
      statusBgColor = AppTheme.statusSuccessLight;
    } else if (isEssential) {
      statusText = 'BASIC ACTIVE';
      statusColor = AppTheme.statusWarning;
      statusBgColor = AppTheme.statusWarningLight;
    } else {
      statusText = 'PERMISSIONS NEEDED';
      statusColor = AppTheme.statusEmergency;
      statusBgColor = AppTheme.statusEmergencyLight;
    }

    return InkWell(
      onTap: _showTelemetryDiagnosticsSheet,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppTheme.borderSubtle),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: statusColor.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: Icon(
                isGpsOff ? Icons.gps_off_rounded : Icons.gps_fixed_rounded,
                size: 18,
                color: statusColor,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'GPS Telemetry Service',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppTheme.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    isFullReady
                        ? 'Tap to view live telemetry diagnostics'
                        : (isGpsOff
                            ? 'Tap to enable device GPS hardware'
                            : 'Tap to configure location permissions'),
                    style: TextStyle(fontSize: 11, color: isFullReady ? AppTheme.textMuted : statusColor),
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: statusBgColor,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                statusText,
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  color: statusColor,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
