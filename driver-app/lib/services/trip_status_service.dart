import 'dart:async';
import '../models/trip_state_model.dart';

/// Service managing live trip execution state, elapsed counter, and stop progress
class TripStatusService {
  static final TripStatusService _instance = TripStatusService._internal();
  factory TripStatusService() => _instance;
  TripStatusService._internal();

  ActiveTripProgress? _activeTrip;
  ActiveTripProgress? get activeTrip => _activeTrip;

  Timer? _elapsedTimer;
  Duration _elapsedDuration = Duration.zero;
  Duration get elapsedDuration => _elapsedDuration;

  final _tripController = StreamController<ActiveTripProgress?>.broadcast();
  Stream<ActiveTripProgress?> get tripStream => _tripController.stream;

  final _timerController = StreamController<Duration>.broadcast();
  Stream<Duration> get timerStream => _timerController.stream;

  /// Update the active trip from profile data or API response
  void updateActiveTrip(Map<String, dynamic>? tripJson) {
    if (tripJson == null) {
      _activeTrip = null;
      _stopTimer();
      _tripController.add(null);
      return;
    }

    _activeTrip = ActiveTripProgress.fromJson(tripJson);
    _tripController.add(_activeTrip);

    if (_activeTrip!.isActive) {
      _startTimer();
    } else {
      _stopTimer();
    }
  }

  void _startTimer() {
    _stopTimer();
    if (_activeTrip?.actualStartTime != null) {
      final now = DateTime.now();
      final diff = now.difference(_activeTrip!.actualStartTime!);
      _elapsedDuration = diff.isNegative ? Duration.zero : diff;
    } else {
      _elapsedDuration = Duration.zero;
    }

    _timerController.add(_elapsedDuration);

    _elapsedTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      _elapsedDuration += const Duration(seconds: 1);
      _timerController.add(_elapsedDuration);
    });
  }

  void _stopTimer() {
    _elapsedTimer?.cancel();
    _elapsedTimer = null;
    _elapsedDuration = Duration.zero;
  }

  String formatElapsed(Duration duration) {
    final hours = duration.inHours.toString().padLeft(2, '0');
    final minutes = (duration.inMinutes % 60).toString().padLeft(2, '0');
    final seconds = (duration.inSeconds % 60).toString().padLeft(2, '0');
    if (duration.inHours > 0) {
      return '$hours:$minutes:$seconds';
    }
    return '$minutes:$seconds';
  }

  void dispose() {
    _stopTimer();
    _tripController.close();
    _timerController.close();
  }
}
