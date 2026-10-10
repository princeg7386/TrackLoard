import 'dart:async';
import 'dart:math';

/// Utility implementing exponential backoff with jitter for resilient network retries
class RetryHelper {
  /// Execute an asynchronous operation with exponential backoff
  static Future<T> retry<T>({
    required Future<T> Function() operation,
    int maxAttempts = 4,
    Duration initialDelay = const Duration(seconds: 1),
    double backoffMultiplier = 2.0,
    Duration maxDelay = const Duration(seconds: 30),
    bool Function(dynamic error)? shouldRetry,
  }) async {
    int attempt = 0;
    Duration delay = initialDelay;
    final random = Random();

    while (true) {
      attempt++;
      try {
        return await operation();
      } catch (e) {
        if (attempt >= maxAttempts || (shouldRetry != null && !shouldRetry(e))) {
          rethrow;
        }

        // Add 10-20% jitter to prevent thundering herd
        final jitter = (random.nextDouble() * 0.2 - 0.1) * delay.inMilliseconds;
        final actualDelayMs = (delay.inMilliseconds + jitter).clamp(
          0.0,
          maxDelay.inMilliseconds.toDouble(),
        );

        await Future.delayed(Duration(milliseconds: actualDelayMs.toInt()));

        delay = Duration(
          milliseconds: (delay.inMilliseconds * backoffMultiplier).clamp(
            0,
            maxDelay.inMilliseconds,
          ),
        );
      }
    }
  }
}
