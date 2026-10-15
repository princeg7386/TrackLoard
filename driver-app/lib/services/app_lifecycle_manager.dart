import 'package:flutter/material.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'device_status_service.dart';
import 'permission_service.dart';
import 'telemetry_queue_service.dart';
import 'location_capture_service.dart';

// ---------------------------------------------------------------------------
// Background isolate entry-point (top-level, required by flutter_background_service)
// ---------------------------------------------------------------------------

/// Called by the Android foreground service when it starts.
/// Runs in a separate isolate — must be a top-level function.
@pragma('vm:entry-point')
void onBackgroundServiceStart(ServiceInstance service) async {
  // Keep alive as a foreground service
  if (service is AndroidServiceInstance) {
    service.on('setAsForeground').listen((_) => service.setAsForegroundService());
    service.on('setAsBackground').listen((_) => service.setAsBackgroundService());
  }
  service.on('stopService').listen((_) => service.stopSelf());

  // Delegate GPS capture to the existing LocationCaptureService
  final gps = LocationCaptureService();
  await gps.startBackgroundCapture();
}

// ---------------------------------------------------------------------------
// App Lifecycle Coordinator
// ---------------------------------------------------------------------------

/// App Lifecycle Coordinator ensuring state preservation across OS
/// foreground/background transitions, and owning the Android foreground
/// GPS service lifecycle via [FlutterBackgroundService].
class AppLifecycleManager with WidgetsBindingObserver {
  static final AppLifecycleManager _instance = AppLifecycleManager._internal();
  factory AppLifecycleManager() => _instance;
  AppLifecycleManager._internal();

  final DeviceStatusService _deviceStatus = DeviceStatusService();
  final TelemetryQueueService _queueService = TelemetryQueueService();
  final PermissionService _permissionService = PermissionService();

  bool _isInitialized = false;

  // ---------------------------------------------------------------------------
  // Bootstrap — call once from main() after ensureInitialized
  // ---------------------------------------------------------------------------

  Future<void> init() async {
    if (_isInitialized) return;
    _isInitialized = true;
    WidgetsBinding.instance.addObserver(this);
    _deviceStatus.startMonitoring();
    _queueService.init();

    // Configure and start the Android foreground / background GPS service.
    await _initBackgroundService();
  }

  /// Configures [FlutterBackgroundService] with an [AndroidServiceConfiguration]
  /// that runs [onBackgroundServiceStart] as a persistent foreground service
  /// so GPS capture continues when the screen locks or the app is backgrounded.
  Future<void> _initBackgroundService() async {
    final service = FlutterBackgroundService();

    await service.configure(
      androidConfiguration: AndroidServiceConfiguration(
        onStart: onBackgroundServiceStart,
        autoStart: true,
        isForegroundMode: true,
        notificationChannelId: 'busloard_gps_channel',
        initialNotificationTitle: 'BUSLOARD GPS Active',
        initialNotificationContent: 'Tracking bus location in the background',
        foregroundServiceNotificationId: 888,
        foregroundServiceTypes: const [AndroidForegroundType.location],
      ),
      iosConfiguration: IosConfiguration(
        // iOS background location is handled via native location manager;
        // the Dart background service is Android-only.
        autoStart: false,
      ),
    );

    await service.startService();
  }

  // ---------------------------------------------------------------------------
  // Runtime helpers exposed to UI layer
  // ---------------------------------------------------------------------------

  /// Send a signal to the running background isolate.
  void sendToService(String event, [Map<String, dynamic>? data]) {
    FlutterBackgroundService().invoke(event, data);
  }

  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _deviceStatus.stopMonitoring();
  }

  // ---------------------------------------------------------------------------
  // WidgetsBindingObserver
  // ---------------------------------------------------------------------------

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.resumed:
        // App returned to foreground: refresh status, check perms, drain queue
        _deviceStatus.refresh();
        _permissionService.checkPermissions();
        _queueService.flushPendingQueue();
        // Promote background service to foreground so notification shows
        sendToService('setAsForeground');
        break;
      case AppLifecycleState.paused:
        // App moved to background: GPS capture continues via foreground service
        sendToService('setAsBackground');
        break;
      case AppLifecycleState.inactive:
      case AppLifecycleState.detached:
      case AppLifecycleState.hidden:
        break;
    }
  }
}
