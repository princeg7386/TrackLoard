import 'dart:async';
import 'package:battery_plus/battery_plus.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:geolocator/geolocator.dart';
import '../models/device_status_model.dart';

/// Central Service monitoring real-time GPS, Network connectivity, and Battery telemetry
class DeviceStatusService {
  static final DeviceStatusService _instance = DeviceStatusService._internal();
  factory DeviceStatusService() => _instance;
  DeviceStatusService._internal();

  final Battery _battery = Battery();
  final Connectivity _connectivity = Connectivity();

  StreamSubscription<Position>? _positionSubscription;
  StreamSubscription<List<ConnectivityResult>>? _connectivitySubscription;
  StreamSubscription<BatteryState>? _batterySubscription;
  Timer? _periodicTimer;

  final _statusController = StreamController<DeviceTelemetrySnapshot>.broadcast();
  Stream<DeviceTelemetrySnapshot> get statusStream => _statusController.stream;

  DeviceTelemetrySnapshot _currentSnapshot = DeviceTelemetrySnapshot.initial();
  DeviceTelemetrySnapshot get currentSnapshot => _currentSnapshot;

  bool _isMonitoring = false;

  /// Start real-time telemetry stream listeners
  Future<void> startMonitoring() async {
    if (_isMonitoring) return;
    _isMonitoring = true;

    // 1. Initial snapshot fetch
    await refresh();

    // 2. GPS Position stream listener
    try {
      final isServiceEnabled = await Geolocator.isLocationServiceEnabled();
      if (isServiceEnabled) {
        final locationSettings = const LocationSettings(
          accuracy: LocationAccuracy.high,
          distanceFilter: 5, // update every 5 meters
        );

        _positionSubscription = Geolocator.getPositionStream(
          locationSettings: locationSettings,
        ).listen(
          (Position position) {
            _updateGpsFromPosition(position);
          },
          onError: (err) {
            _updateGpsError();
          },
        );
      } else {
        _updateGpsDisabled();
      }
    } catch (_) {
      _updateGpsError();
    }

    // 3. Network Connectivity listener
    _connectivitySubscription = _connectivity.onConnectivityChanged.listen(
      (List<ConnectivityResult> results) {
        _updateNetworkFromResults(results);
      },
      onError: (_) {
        _updateNetworkOffline();
      },
    );

    // 4. Battery state listener
    _batterySubscription = _battery.onBatteryStateChanged.listen(
      (BatteryState state) async {
        final level = await _battery.batteryLevel;
        _updateBattery(level, state == BatteryState.charging || state == BatteryState.full);
      },
    );

    // 5. Periodic status poll (every 10 seconds for battery and GPS health check)
    _periodicTimer = Timer.periodic(const Duration(seconds: 10), (_) {
      refresh();
    });
  }

  /// Stop all listeners to conserve battery
  void stopMonitoring() {
    _isMonitoring = false;
    _positionSubscription?.cancel();
    _positionSubscription = null;
    _connectivitySubscription?.cancel();
    _connectivitySubscription = null;
    _batterySubscription?.cancel();
    _batterySubscription = null;
    _periodicTimer?.cancel();
    _periodicTimer = null;
  }

  /// Manually refresh all telemetry metrics
  Future<DeviceTelemetrySnapshot> refresh() async {
    // A. Query GPS
    GpsTelemetryStatus gpsStatus;
    try {
      final isGpsEnabled = await Geolocator.isLocationServiceEnabled();
      if (!isGpsEnabled) {
        gpsStatus = GpsTelemetryStatus.disabled();
      } else {
        final perm = await Geolocator.checkPermission();
        if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
          gpsStatus = const GpsTelemetryStatus(
            isEnabled: true,
            quality: GpsQuality.poor,
          );
        } else {
          final pos = await Geolocator.getLastKnownPosition();
          if (pos != null) {
            final quality = _calculateGpsQuality(pos.accuracy);
            gpsStatus = GpsTelemetryStatus(
              isEnabled: true,
              quality: quality,
              accuracyMeters: pos.accuracy,
              speedKmH: (pos.speed * 3.6).clamp(0.0, 160.0), // m/s to km/h
              latitude: pos.latitude,
              longitude: pos.longitude,
              lastFixTime: pos.timestamp,
            );
          } else {
            gpsStatus = GpsTelemetryStatus.initial();
          }
        }
      }
    } catch (_) {
      gpsStatus = GpsTelemetryStatus.disabled();
    }

    // B. Query Network
    NetworkTelemetryStatus networkStatus;
    try {
      final results = await _connectivity.checkConnectivity();
      networkStatus = _parseNetworkStatus(results);
    } catch (_) {
      networkStatus = NetworkTelemetryStatus.offline();
    }

    // C. Query Battery
    BatteryTelemetryStatus batteryStatus;
    try {
      final level = await _battery.batteryLevel;
      final state = await _battery.batteryState;
      batteryStatus = BatteryTelemetryStatus(
        levelPercentage: level.clamp(0, 100),
        isCharging: state == BatteryState.charging || state == BatteryState.full,
      );
    } catch (_) {
      batteryStatus = BatteryTelemetryStatus.initial();
    }

    _currentSnapshot = DeviceTelemetrySnapshot(
      gps: gpsStatus,
      network: networkStatus,
      battery: batteryStatus,
    );

    _statusController.add(_currentSnapshot);
    return _currentSnapshot;
  }

  void _updateGpsFromPosition(Position pos) {
    final quality = _calculateGpsQuality(pos.accuracy);
    final speedKmH = (pos.speed * 3.6).clamp(0.0, 160.0);

    final gpsStatus = GpsTelemetryStatus(
      isEnabled: true,
      quality: quality,
      accuracyMeters: pos.accuracy,
      speedKmH: speedKmH,
      latitude: pos.latitude,
      longitude: pos.longitude,
      lastFixTime: pos.timestamp,
    );

    _currentSnapshot = DeviceTelemetrySnapshot(
      gps: gpsStatus,
      network: _currentSnapshot.network,
      battery: _currentSnapshot.battery,
    );
    _statusController.add(_currentSnapshot);
  }

  void _updateGpsDisabled() {
    _currentSnapshot = DeviceTelemetrySnapshot(
      gps: GpsTelemetryStatus.disabled(),
      network: _currentSnapshot.network,
      battery: _currentSnapshot.battery,
    );
    _statusController.add(_currentSnapshot);
  }

  void _updateGpsError() {
    _currentSnapshot = DeviceTelemetrySnapshot(
      gps: const GpsTelemetryStatus(isEnabled: true, quality: GpsQuality.poor),
      network: _currentSnapshot.network,
      battery: _currentSnapshot.battery,
    );
    _statusController.add(_currentSnapshot);
  }

  void _updateNetworkFromResults(List<ConnectivityResult> results) {
    final status = _parseNetworkStatus(results);
    _currentSnapshot = DeviceTelemetrySnapshot(
      gps: _currentSnapshot.gps,
      network: status,
      battery: _currentSnapshot.battery,
    );
    _statusController.add(_currentSnapshot);
  }

  void _updateNetworkOffline() {
    _currentSnapshot = DeviceTelemetrySnapshot(
      gps: _currentSnapshot.gps,
      network: NetworkTelemetryStatus.offline(),
      battery: _currentSnapshot.battery,
    );
    _statusController.add(_currentSnapshot);
  }

  void _updateBattery(int level, bool isCharging) {
    _currentSnapshot = DeviceTelemetrySnapshot(
      gps: _currentSnapshot.gps,
      network: _currentSnapshot.network,
      battery: BatteryTelemetryStatus(
        levelPercentage: level.clamp(0, 100),
        isCharging: isCharging,
      ),
    );
    _statusController.add(_currentSnapshot);
  }

  GpsQuality _calculateGpsQuality(double accuracy) {
    if (accuracy <= 15.0) return GpsQuality.optimal;
    if (accuracy <= 30.0) return GpsQuality.acceptable;
    return GpsQuality.poor;
  }

  NetworkTelemetryStatus _parseNetworkStatus(List<ConnectivityResult> results) {
    if (results.isEmpty || results.contains(ConnectivityResult.none)) {
      return NetworkTelemetryStatus.offline();
    }
    if (results.contains(ConnectivityResult.wifi)) {
      return const NetworkTelemetryStatus(
        isConnected: true,
        type: NetworkType.wifi,
        label: 'Wi-Fi Online',
      );
    }
    if (results.contains(ConnectivityResult.mobile)) {
      return const NetworkTelemetryStatus(
        isConnected: true,
        type: NetworkType.cellular,
        label: '4G/Cellular Online',
      );
    }
    return const NetworkTelemetryStatus(
      isConnected: true,
      type: NetworkType.unknown,
      label: 'Connected',
    );
  }
}
