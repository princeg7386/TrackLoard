import 'package:flutter/material.dart';
import '../core/theme/app_theme.dart';
import '../core/utils/app_formatters.dart';
import '../models/assigned_trip.dart';
import '../models/driver_profile.dart';
import '../services/auth_service.dart';
import 'login_screen.dart';

/// Driver Home Screen displaying Today's Bus, Today's Route, and Telemetry Status
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final AuthService _authService = AuthService();

  bool _isLoading = true;
  bool _isRefreshing = false;
  String? _errorMessage;
  bool _isOffline = false;

  DriverProfileData? _profileData;
  Map<String, String?> _storedDriver = {};

  @override
  void initState() {
    super.initState();
    _loadInitialData();
  }

  Future<void> _loadInitialData() async {
    final cached = await _authService.getStoredDriver();
    setState(() {
      _storedDriver = cached;
      _isLoading = true;
      _errorMessage = null;
    });

    await _fetchProfile();
  }

  Future<void> _fetchProfile() async {
    final result = await _authService.getProfile();

    if (!mounted) return;

    setState(() {
      _isLoading = false;
      _isRefreshing = false;
      if (result.success && result.data != null) {
        _profileData = result.data;
        _errorMessage = null;
        _isOffline = false;
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
    setState(() {
      _isRefreshing = true;
    });
    await _fetchProfile();
  }

  void _handleUnauthorized() async {
    await _authService.logout();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
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

  Color _getStatusColor(String status) {
    switch (status.toUpperCase()) {
      case 'IN_TRANSIT':
        return AppTheme.statusSuccess;
      case 'DELAYED':
        return AppTheme.statusWarning;
      case 'COMPLETED':
        return AppTheme.statusNeutral;
      case 'CANCELLED':
        return AppTheme.statusEmergency;
      case 'SCHEDULED':
      default:
        return AppTheme.accentSky;
    }
  }

  Color _getStatusBgColor(String status) {
    switch (status.toUpperCase()) {
      case 'IN_TRANSIT':
        return AppTheme.statusSuccessLight;
      case 'DELAYED':
        return AppTheme.statusWarningLight;
      case 'COMPLETED':
        return AppTheme.statusNeutralLight;
      case 'CANCELLED':
        return AppTheme.statusEmergencyLight;
      case 'SCHEDULED':
      default:
        return const Color(0xFFF0F9FF);
    }
  }

  @override
  Widget build(BuildContext context) {
    final driverName = _profileData?.driver.fullName ?? _storedDriver['fullName'] ?? 'Driver';
    final driverPhone = _profileData?.driver.phone ?? _storedDriver['phone'] ?? '';
    final assignedBus = _profileData?.assignedBus;

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
              // Offline or Error Banner
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
                          'Offline Mode. Showing cached bus & route assignments.',
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

              // Loading Spinner State
              if (_isLoading && _profileData == null) ...[
                const Center(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 40.0),
                    child: CircularProgressIndicator(),
                  ),
                ),
              ] else ...[
                // SECTION 1: TODAY'S ASSIGNED BUS
                _buildSectionHeader('TODAY\'S ASSIGNED BUS', Icons.directions_bus_filled_rounded),
                const SizedBox(height: 8),
                _buildAssignedBusCard(assignedBus),

                const SizedBox(height: 20),

                // SECTION 2: TODAY'S SCHEDULED ROUTE & TRIPS
                _buildSectionHeader('TODAY\'S SCHEDULED ROUTES', Icons.alt_route_rounded),
                const SizedBox(height: 8),
                _buildTodayRoutesCard(),

                const SizedBox(height: 20),

                // SECTION 3: WHATSAPP BOT QUICK OPERATIONS
                _buildWhatsAppBotCard(),

                const SizedBox(height: 20),

                // SECTION 4: BACKGROUND TELEMETRY STATUS (Foundation for Phase 10.2)
                _buildTelemetryStatusCard(),

                const SizedBox(height: 24),
              ],
            ],
          ),
        ),
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
      // Empty State: No Bus Assigned
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
                // Bus Badge
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
                // Status Badge
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
          ],
        ),
      ),
    );
  }

  Widget _buildTodayRoutesCard() {
    final tripsRaw = _profileData?.todayTrips ?? [];
    if (tripsRaw.isEmpty) {
      // Empty State: No Trips Scheduled Today
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
    final statusColor = _getStatusColor(trip.status);
    final statusBgColor = _getStatusBgColor(trip.status);

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
        color: const Color(0xFFF0FDF4), // Light WhatsApp Emerald
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
    return Container(
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
              color: AppTheme.primaryNavy.withOpacity(0.06),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.gps_fixed_rounded, size: 18, color: AppTheme.primaryNavy),
          ),
          const SizedBox(width: 12),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'GPS Telemetry Service',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppTheme.textPrimary,
                  ),
                ),
                SizedBox(height: 2),
                Text(
                  'Background location engine active and ready',
                  style: TextStyle(fontSize: 11, color: AppTheme.textMuted),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppTheme.statusSuccessLight,
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Text(
              'READY',
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w700,
                color: AppTheme.statusSuccess,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
