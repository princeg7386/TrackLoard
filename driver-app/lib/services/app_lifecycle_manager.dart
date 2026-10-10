import 'package:flutter/material.dart';
import 'device_status_service.dart';
import 'permission_service.dart';
import 'telemetry_queue_service.dart';

/// App Lifecycle Coordinator ensuring state preservation across OS foreground/background transitions
class AppLifecycleManager with WidgetsBindingObserver {
  static final AppLifecycleManager _instance = AppLifecycleManager._internal();
  factory AppLifecycleManager() => _instance;
  AppLifecycleManager._internal();

  final DeviceStatusService _deviceStatus = DeviceStatusService();
  final TelemetryQueueService _queueService = TelemetryQueueService();
  final PermissionService _permissionService = PermissionService();

  bool _isInitialized = false;

  void init() {
    if (_isInitialized) return;
    _isInitialized = true;
    WidgetsBinding.instance.addObserver(this);
    _deviceStatus.startMonitoring();
    _queueService.init();
  }

  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _deviceStatus.stopMonitoring();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.resumed:
        // App returned to foreground: refresh status, check perms, drain queue
        _deviceStatus.refresh();
        _permissionService.checkPermissions();
        _queueService.flushPendingQueue();
        break;
      case AppLifecycleState.paused:
        // App moved to background: telemetry continues via background service
        break;
      case AppLifecycleState.inactive:
      case AppLifecycleState.detached:
      case AppLifecycleState.hidden:
        break;
    }
  }
}
