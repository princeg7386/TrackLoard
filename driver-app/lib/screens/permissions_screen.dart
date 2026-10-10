import 'package:flutter/material.dart';
import '../core/theme/app_theme.dart';
import '../models/permission_status_model.dart';
import '../services/permission_service.dart';

/// Screen explaining and requesting device permissions for bus tracking
class PermissionsScreen extends StatefulWidget {
  final VoidCallback? onAllGranted;

  const PermissionsScreen({super.key, this.onAllGranted});

  @override
  State<PermissionsScreen> createState() => _PermissionsScreenState();
}

class _PermissionsScreenState extends State<PermissionsScreen> with WidgetsBindingObserver {
  final PermissionService _permissionService = PermissionService();

  AppPermissionsState? _permissionsState;
  bool _isLoading = true;
  bool _isRequesting = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _checkStatus();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      // Re-check permissions when returning from device settings
      _checkStatus();
    }
  }

  Future<void> _checkStatus() async {
    final state = await _permissionService.checkPermissions();
    if (!mounted) return;

    setState(() {
      _permissionsState = state;
      _isLoading = false;
    });

    if (state.isFullTelemetryReady && widget.onAllGranted != null) {
      widget.onAllGranted!();
    }
  }

  Future<void> _handleGrantAll() async {
    setState(() {
      _isRequesting = true;
    });

    await _permissionService.requestAllSequentially();

    if (!mounted) return;

    setState(() {
      _isRequesting = false;
    });

    await _checkStatus();
  }

  @override
  Widget build(BuildContext context) {
    final isPermDenied = _permissionsState?.isLocationPermanentlyDenied ?? false;
    final isGpsOff = !(_permissionsState?.isGpsServiceEnabled ?? true);
    final isReady = _permissionsState?.isEssentialReady ?? false;

    return Scaffold(
      backgroundColor: AppTheme.surfaceLight,
      appBar: AppBar(
        title: const Text('Device Permissions'),
        automaticallyImplyLeading: false,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SafeArea(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Header Banner
                    Center(
                      child: Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: AppTheme.primaryNavy.withOpacity(0.08),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.location_on_rounded,
                          size: 44,
                          color: AppTheme.primaryNavy,
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      'Bus Tracking Permissions',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                        color: AppTheme.textPrimary,
                        letterSpacing: -0.3,
                      ),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'To provide accurate ETAs to parents and transport coordinators, the driver app requires the following permissions:',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 13,
                        color: AppTheme.textSecondary,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 24),

                    // PERMISSION 1: Precise GPS Location
                    _buildPermissionCard(
                      title: 'Precise GPS Location',
                      description: 'Provides exact bus coordinates along the school pickup and drop route.',
                      icon: Icons.my_location_rounded,
                      isGranted: _permissionsState?.isForegroundLocationGranted ?? false,
                      actionWidget: !(_permissionsState?.isForegroundLocationGranted ?? false)
                          ? OutlinedButton(
                              onPressed: () async {
                                await _permissionService.requestForegroundLocation();
                                _checkStatus();
                              },
                              style: OutlinedButton.styleFrom(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              ),
                              child: const Text('Allow', style: TextStyle(fontSize: 12)),
                            )
                          : null,
                    ),

                    const SizedBox(height: 12),

                    // PERMISSION 2: Background Location ("Allow all the time")
                    _buildPermissionCard(
                      title: 'Background Location',
                      description: 'Select "Allow all the time" in OS settings so tracking continues while screen is locked.',
                      icon: Icons.screen_lock_portrait_rounded,
                      isGranted: _permissionsState?.isBackgroundLocationGranted ?? false,
                      actionWidget: !(_permissionsState?.isBackgroundLocationGranted ?? false)
                          ? OutlinedButton(
                              onPressed: () async {
                                await _permissionService.requestBackgroundLocation();
                                _checkStatus();
                              },
                              style: OutlinedButton.styleFrom(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              ),
                              child: const Text('Allow All Time', style: TextStyle(fontSize: 12)),
                            )
                          : null,
                    ),

                    const SizedBox(height: 12),

                    // PERMISSION 3: Notifications
                    _buildPermissionCard(
                      title: 'Foreground Notifications',
                      description: 'Shows active trip status in the notification shade and delivers urgent route alerts.',
                      icon: Icons.notifications_active_outlined,
                      isGranted: _permissionsState?.isNotificationGranted ?? false,
                      actionWidget: !(_permissionsState?.isNotificationGranted ?? false)
                          ? OutlinedButton(
                              onPressed: () async {
                                await _permissionService.requestNotificationPermission();
                                _checkStatus();
                              },
                              style: OutlinedButton.styleFrom(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              ),
                              child: const Text('Allow', style: TextStyle(fontSize: 12)),
                            )
                          : null,
                    ),

                    const SizedBox(height: 12),

                    // HARDWARE: GPS Toggle
                    _buildPermissionCard(
                      title: 'Device GPS Toggle',
                      description: 'Device location hardware must be switched ON for satellite positioning.',
                      icon: Icons.gps_fixed_rounded,
                      isGranted: _permissionsState?.isGpsServiceEnabled ?? false,
                      actionWidget: isGpsOff
                          ? OutlinedButton(
                              onPressed: () async {
                                await _permissionService.openLocationSettings();
                              },
                              style: OutlinedButton.styleFrom(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              ),
                              child: const Text('Enable GPS', style: TextStyle(fontSize: 12)),
                            )
                          : null,
                    ),

                    const SizedBox(height: 24),

                    // Main Action Buttons
                    if (isPermDenied) ...[
                      ElevatedButton.icon(
                        icon: const Icon(Icons.settings, size: 18),
                        label: const Text('Open App Settings'),
                        style: ElevatedButton.styleFrom(backgroundColor: AppTheme.statusWarning),
                        onPressed: () => _permissionService.openAppSettings(),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Location permission was permanently denied. Please enable "Location: Allow all the time" in App Settings.',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 11, color: AppTheme.statusWarning),
                      ),
                      const SizedBox(height: 12),
                    ] else ...[
                      ElevatedButton(
                        onPressed: _isRequesting ? null : _handleGrantAll,
                        child: _isRequesting
                            ? const SizedBox(
                                height: 20,
                                width: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                                ),
                              )
                            : const Text('Grant All Permissions'),
                      ),
                      const SizedBox(height: 12),
                    ],

                    if (isReady)
                      OutlinedButton(
                        onPressed: () {
                          if (widget.onAllGranted != null) {
                            widget.onAllGranted!();
                          } else {
                            Navigator.pop(context, true);
                          }
                        },
                        child: const Text('Continue to Dashboard'),
                      ),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildPermissionCard({
    required String title,
    required String description,
    required IconData icon,
    required bool isGranted,
    Widget? actionWidget,
  }) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14.0),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: isGranted ? AppTheme.statusSuccessLight : AppTheme.statusNeutralLight,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(
                icon,
                size: 20,
                color: isGranted ? AppTheme.statusSuccess : AppTheme.textSecondary,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          title,
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                            color: AppTheme.textPrimary,
                          ),
                        ),
                      ),
                      if (isGranted)
                        const Row(
                          children: [
                            Icon(Icons.check_circle_rounded, size: 16, color: AppTheme.statusSuccess),
                            SizedBox(width: 4),
                            Text(
                              'Granted',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                color: AppTheme.statusSuccess,
                              ),
                            ),
                          ],
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    description,
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppTheme.textSecondary,
                      height: 1.3,
                    ),
                  ),
                  if (actionWidget != null) ...[
                    const SizedBox(height: 8),
                    actionWidget,
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
