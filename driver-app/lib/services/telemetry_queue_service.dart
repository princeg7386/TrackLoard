import 'dart:async';
import '../core/constants/api_constants.dart';
import '../core/utils/retry_helper.dart';
import '../models/device_status_model.dart';
import '../models/queued_telemetry_item.dart';
import 'api_service.dart';
import 'device_status_service.dart';
import 'local_database_service.dart';

/// Service managing the offline SQLite telemetry buffer and automated reconnect sync
class TelemetryQueueService {
  static final TelemetryQueueService _instance = TelemetryQueueService._internal();
  factory TelemetryQueueService() => _instance;
  TelemetryQueueService._internal();

  final LocalDatabaseService _db = LocalDatabaseService();
  final ApiService _api = ApiService();
  final DeviceStatusService _deviceStatus = DeviceStatusService();

  StreamSubscription<DeviceTelemetrySnapshot>? _statusSubscription;
  bool _isSyncing = false;
  bool get isSyncing => _isSyncing;

  int _pendingCount = 0;
  int get pendingCount => _pendingCount;

  final _queueCountController = StreamController<int>.broadcast();
  Stream<int> get pendingCountStream => _queueCountController.stream;

  final _syncStatusController = StreamController<bool>.broadcast();
  Stream<bool> get isSyncingStream => _syncStatusController.stream;

  bool _initialized = false;

  /// Initialize listeners for network recovery and sync triggers
  Future<void> init() async {
    if (_initialized) return;
    _initialized = true;

    // Fetch initial pending count
    _pendingCount = await _db.getPendingCount();
    _queueCountController.add(_pendingCount);

    // Listen for network connectivity transitions
    _statusSubscription = _deviceStatus.statusStream.listen((snapshot) {
      if (snapshot.network.isConnected && !_isSyncing && _pendingCount > 0) {
        // Automatically flush queue when network is restored
        flushPendingQueue();
      }
    });
  }

  /// Enqueue a GPS telemetry ping
  Future<void> enqueuePing({
    required String tripId,
    required String busId,
    required String driverId,
    required double latitude,
    required double longitude,
    required double speedKmh,
    double? bearingDegrees,
    double? accuracyMeters,
    String? recordedAt,
  }) async {
    final item = QueuedTelemetryItem(
      tripId: tripId,
      busId: busId,
      driverId: driverId,
      latitude: latitude,
      longitude: longitude,
      speedKmh: speedKmh,
      bearingDegrees: bearingDegrees,
      accuracyMeters: accuracyMeters,
      recordedAt: recordedAt ?? DateTime.now().toIso8601String(),
    );

    // Save to SQLite
    await _db.enqueueTelemetry(item);
    _pendingCount = await _db.getPendingCount();
    _queueCountController.add(_pendingCount);

    // If online, trigger background drain
    if (_deviceStatus.currentSnapshot.network.isConnected && !_isSyncing) {
      flushPendingQueue();
    }
  }

  /// Drains pending telemetry queue in batches of up to 50 with exponential backoff
  Future<bool> flushPendingQueue({int batchSize = 50}) async {
    if (_isSyncing) return false;
    _isSyncing = true;
    _syncStatusController.add(true);

    try {
      while (true) {
        final pendingItems = await _db.getPendingTelemetry(limit: batchSize);
        if (pendingItems.isEmpty) {
          break;
        }

        final ids = pendingItems.map((item) => item.id!).toList();
        final payloadList = pendingItems.map((item) => item.toPayload()).toList();

        final success = await _sendBatchWithRetry(payloadList);
        if (success) {
          // Remove synced records
          await _db.removeTelemetry(ids);
          _pendingCount = await _db.getPendingCount();
          _queueCountController.add(_pendingCount);
        } else {
          // Increment retry counter and stop current drain cycle
          await _db.incrementRetryCount(ids);
          break;
        }
      }
      return true;
    } catch (_) {
      return false;
    } finally {
      _isSyncing = false;
      _syncStatusController.add(false);
      _pendingCount = await _db.getPendingCount();
      _queueCountController.add(_pendingCount);
    }
  }

  Future<bool> _sendBatchWithRetry(List<Map<String, dynamic>> batch) async {
    try {
      final response = await RetryHelper.retry<ApiResponse<Map<String, dynamic>>>(
        maxAttempts: 3,
        initialDelay: const Duration(milliseconds: 500),
        operation: () async {
          return await _api.post(
            ApiConstants.telemetryEndpoint,
            body: {'locations': batch},
            requiresAuth: true,
          );
        },
        shouldRetry: (err) => true,
      );

      return response.success;
    } catch (_) {
      return false;
    }
  }

  void dispose() {
    _statusSubscription?.cancel();
    _statusSubscription = null;
    _queueCountController.close();
    _syncStatusController.close();
  }
}
