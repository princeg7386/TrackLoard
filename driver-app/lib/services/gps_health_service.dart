import 'dart:async';
import '../models/device_status_model.dart';
import 'device_status_service.dart';

/// Client-side GPS & Telemetry Health Status Enum matching backend GpsHealthStatus
enum ClientGpsHealthStatus {
  healthy,
  degradedAccuracy,
  staleSignal,
  signalLost,
  offline,
}

/// Detailed GPS health evaluation snapshot
class GpsHealthEvaluation {
  final ClientGpsHealthStatus status;
  final double? accuracyMeters;
  final int ageSeconds;
  final bool isOnline;
  final String statusMessage;

  const GpsHealthEvaluation({
    required this.status,
    required this.accuracyMeters,
    required this.ageSeconds,
    required this.isOnline,
    required this.statusMessage,
  });

  factory GpsHealthEvaluation.initial() => const GpsHealthEvaluation(
        status: ClientGpsHealthStatus.healthy,
        accuracyMeters: null,
        ageSeconds: 0,
        isOnline: true,
        statusMessage: 'GPS Ready',
      );
}

/// Service providing client-side GPS health diagnostics, staleness timers, and degraded signal alerts
class GpsHealthService {
  static final GpsHealthService _instance = GpsHealthService._internal();
  factory GpsHealthService() => _instance;
  GpsHealthService._internal();

  final DeviceStatusService _deviceStatusService = DeviceStatusService();
  final _healthController = StreamController<GpsHealthEvaluation>.broadcast();
  Stream<GpsHealthEvaluation> get healthStream => _healthController.stream;

  GpsHealthEvaluation _currentEvaluation = GpsHealthEvaluation.initial();
  GpsHealthEvaluation get currentEvaluation => _currentEvaluation;

  Timer? _evaluationTimer;
  StreamSubscription<DeviceTelemetrySnapshot>? _snapshotSubscription;

  /// Start evaluation timer and device status stream subscription
  void startMonitoring() {
    _snapshotSubscription?.cancel();
    _snapshotSubscription = _deviceStatusService.statusStream.listen((snapshot) {
      _evaluate(snapshot);
    });

    _evaluationTimer?.cancel();
    _evaluationTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      _evaluate(_deviceStatusService.currentSnapshot);
    });

    _evaluate(_deviceStatusService.currentSnapshot);
  }

  /// Stop health monitoring
  void stopMonitoring() {
    _snapshotSubscription?.cancel();
    _snapshotSubscription = null;
    _evaluationTimer?.cancel();
    _evaluationTimer = null;
  }

  void _evaluate(DeviceTelemetrySnapshot snapshot) {
    final isOnline = snapshot.network.isConnected;
    final lastFix = snapshot.gps.lastFixTime;
    final accuracy = snapshot.gps.accuracyMeters;

    final ageSeconds = lastFix != null
        ? DateTime.now().difference(lastFix).inSeconds.clamp(0, 999999)
        : 999999;

    ClientGpsHealthStatus status;
    String message;

    if (!snapshot.gps.isEnabled || snapshot.gps.quality == GpsQuality.disabled) {
      status = ClientGpsHealthStatus.offline;
      message = 'GPS Hardware Disabled';
    } else if (!isOnline) {
      status = ClientGpsHealthStatus.offline;
      message = 'Internet Disconnected - Buffering pings';
    } else if (ageSeconds >= 300) {
      status = ClientGpsHealthStatus.signalLost;
      message = 'GPS Signal Lost (>5 min no fix)';
    } else if (ageSeconds >= 60) {
      status = ClientGpsHealthStatus.staleSignal;
      message = 'GPS Signal Delayed (${ageSeconds}s old)';
    } else if (accuracy != null && accuracy > 30.0) {
      status = ClientGpsHealthStatus.degradedAccuracy;
      message = 'Low Accuracy (${accuracy.toStringAsFixed(0)}m)';
    } else {
      status = ClientGpsHealthStatus.healthy;
      message = accuracy != null ? 'GPS Optimal (${accuracy.toStringAsFixed(0)}m)' : 'GPS Optimal';
    }

    _currentEvaluation = GpsHealthEvaluation(
      status: status,
      accuracyMeters: accuracy,
      ageSeconds: ageSeconds,
      isOnline: isOnline,
      statusMessage: message,
    );

    _healthController.add(_currentEvaluation);
  }
}
