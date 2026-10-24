/**
 * Phase 20.3 — ETA Refresh Service
 *
 * Responsibilities:
 *  1. EtaSmoothingService.smooth() — pure function that prevents erratic ETA
 *     jumps from GPS noise using exponential smoothing + a hard jump-clamp.
 *     Also detects when the bus is stationary and adds a hold penalty.
 *
 *  2. EtaRefreshService.refreshTripEta() — orchestrates the full refresh cycle:
 *       a) Call EtaService pipeline (assembleContext → calculateStopEtas)
 *       b) Smooth the result against the previously cached summary
 *       c) Publish an ETA_UPDATE SSE event via RealtimeFeedService
 *       d) Cache the smoothed summary for the next refresh cycle
 *
 * Refresh is always **fire-and-forget** — callers do NOT await it.
 * Errors are caught, logged and discarded so the telemetry ingest path
 * is never blocked or made to fail by ETA calculation problems.
 *
 * In-memory cache:
 *   A process-scoped Map stores the previous smoothed summary per tripId.
 *   This is appropriate for the single-instance MVP; a distributed cache
 *   (e.g. Redis) can replace it transparently via the same interface.
 *
 * No new DB migrations — all data comes from existing tables.
 */

import {
  RouteEtaSummary,
  StopEtaResult,
  RouteEtaSummarySchema,
  GpsHealthStatus,
} from '@school-bus/shared';
import { EtaService } from './eta.service.js';
import { RealtimeFeedService } from './realtime-feed.service.js';
import { logger } from './logger.service.js';

// ---------------------------------------------------------------------------
// Smoothing constants
// ---------------------------------------------------------------------------

/**
 * Maximum absolute change in ETA (seconds) allowed per GPS ping per stop.
 * Prevents a single noisy ping from shifting the ETA by several minutes.
 */
const MAX_JUMP_SECONDS = 120;

/**
 * Bus speeds at or below this threshold (km/h) are treated as stationary.
 * Indian school buses idling in traffic routinely show 0–2 km/h readings.
 */
const STOPPED_THRESHOLD_KMH = 2;

/**
 * Extra seconds added to every stop's ETA when the bus is stationary.
 * This nudges ETAs forward conservatively rather than leaving them static.
 */
const STOPPED_HOLD_SECONDS = 60;

/**
 * Exponential smoothing weight for the new observation.
 * 0.7 = "mostly trust the new reading, but temper it with the old one".
 */
const ALPHA = 0.7;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SmoothedEtaResult {
  summary: RouteEtaSummary;
  isStoppedBus: boolean;
}

export interface EtaSmoothingConfig {
  maxJumpSeconds?: number;
  stoppedThresholdKmh?: number;
  stoppedHoldSeconds?: number;
  alpha?: number;
}

// ---------------------------------------------------------------------------
// EtaSmoothingService (pure — no I/O)
// ---------------------------------------------------------------------------

export class EtaSmoothingService {
  /**
   * Apply exponential smoothing and jump-clamping to a freshly computed
   * RouteEtaSummary against the previously published one.
   *
   * @param prev    The last smoothed summary (null on first ping)
   * @param next    The freshly computed raw summary from EtaService
   * @param speedKmh Effective bus speed used for stopped-bus detection
   * @param cfg     Optional overrides for smoothing constants (used in tests)
   */
  static smooth(
    prev: RouteEtaSummary | null,
    next: RouteEtaSummary,
    speedKmh: number,
    cfg: EtaSmoothingConfig = {}
  ): SmoothedEtaResult {
    const maxJump = cfg.maxJumpSeconds ?? MAX_JUMP_SECONDS;
    const stoppedThreshold = cfg.stoppedThresholdKmh ?? STOPPED_THRESHOLD_KMH;
    const holdSecs = cfg.stoppedHoldSeconds ?? STOPPED_HOLD_SECONDS;
    const alpha = cfg.alpha ?? ALPHA;

    const isStoppedBus = speedKmh <= stoppedThreshold;

    // If no previous summary exists, apply the stopped-bus hold if needed but
    // skip smoothing (nothing to smooth against).
    if (prev === null || prev.stopEtas.length === 0) {
      const stopEtas = isStoppedBus
        ? next.stopEtas.map((s) => applyHold(s, holdSecs, next.calculatedAt))
        : next.stopEtas;

      const summary = rebuildSummary(next, stopEtas);
      return { summary, isStoppedBus };
    }

    // Build a map of previous ETAs by stopId for O(1) lookup
    const prevMap = new Map<string, StopEtaResult>(
      prev.stopEtas.map((s) => [s.stopId, s])
    );

    const now = Date.now();

    const smoothedStopEtas: StopEtaResult[] = next.stopEtas.map((newStop) => {
      const oldStop = prevMap.get(newStop.stopId);
      if (!oldStop) {
        // New stop not in previous summary — use raw value (bus may have
        // advanced past some stops since last refresh)
        const dur = isStoppedBus
          ? newStop.durationSeconds + holdSecs
          : newStop.durationSeconds;
        return {
          ...newStop,
          durationSeconds: Math.round(Math.max(0, dur)),
          estimatedArrivalAt: new Date(now + dur * 1000).toISOString(),
        };
      }

      // Exponential smoothing on duration
      const smoothed =
        alpha * newStop.durationSeconds + (1 - alpha) * oldStop.durationSeconds;

      // Hard clamp: do not move ETA more than maxJump seconds per ping
      const lower = oldStop.durationSeconds - maxJump;
      const upper = oldStop.durationSeconds + maxJump;
      const clamped = Math.min(upper, Math.max(lower, smoothed));

      // Stopped-bus hold: add penalty on top of the clamped value
      const finalDur = isStoppedBus
        ? clamped + holdSecs
        : clamped;

      const durationSeconds = Math.round(Math.max(0, finalDur));
      const estimatedArrivalAt = new Date(now + durationSeconds * 1000).toISOString();

      return {
        ...newStop,
        durationSeconds,
        estimatedArrivalAt,
      };
    });

    const summary = rebuildSummary(next, smoothedStopEtas);
    return { summary, isStoppedBus };
  }
}

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

function applyHold(
  stop: StopEtaResult,
  holdSecs: number,
  calculatedAt: string
): StopEtaResult {
  const now = new Date(calculatedAt).getTime();
  const dur = stop.durationSeconds + holdSecs;
  return {
    ...stop,
    durationSeconds: Math.round(Math.max(0, dur)),
    estimatedArrivalAt: new Date(now + dur * 1000).toISOString(),
  };
}

function rebuildSummary(
  base: RouteEtaSummary,
  stopEtas: StopEtaResult[]
): RouteEtaSummary {
  const last = stopEtas[stopEtas.length - 1] ?? null;
  const next = stopEtas[0] ?? null;

  return RouteEtaSummarySchema.parse({
    tripId: base.tripId,
    totalRemainingDistanceMeters: last?.distanceMeters ?? 0,
    totalRemainingDurationSeconds: last?.durationSeconds ?? 0,
    estimatedRouteCompletionAt: last?.estimatedArrivalAt ?? null,
    nextStopEta: next,
    stopEtas,
    effectiveSpeedKmh: base.effectiveSpeedKmh,
    speedSource: base.speedSource,
    calculatedAt: base.calculatedAt,
  });
}

// ---------------------------------------------------------------------------
// EtaRefreshService — fire-and-forget orchestrator
// ---------------------------------------------------------------------------

/**
 * In-memory cache: maps tripId → last smoothed RouteEtaSummary.
 * Cleared when the trip completes (best-effort — entries expire naturally
 * once the trip is no longer active).
 */
const etaSummaryCache = new Map<string, RouteEtaSummary>();

export interface EtaRefreshParams {
  tripId: string;
  schoolId: string;
  busId: string;
  speedKmh: number;
  /** GPS health status to include in the ETA_UPDATE SSE event */
  healthStatus: GpsHealthStatus;
  latitude: number;
  longitude: number;
  recordedAt: string;
}

export class EtaRefreshService {
  /**
   * Recompute ETA for a trip and broadcast via SSE.
   *
   * Always fire-and-forget: callers MUST NOT await this method.
   * All errors are caught internally and logged — the ingest path is not affected.
   */
  static scheduleRefresh(params: EtaRefreshParams): void {
    // Intentionally not awaited — fire-and-forget
    void EtaRefreshService._doRefresh(params).catch((err: unknown) => {
      logger.warn('[EtaRefresh] Unexpected unhandled error in ETA refresh scheduler', {
        tripId: params.tripId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /** Internal async implementation — do not call directly from ingest path */
  static async _doRefresh(params: EtaRefreshParams): Promise<void> {
    const { tripId, schoolId, busId, speedKmh, healthStatus, latitude, longitude, recordedAt } =
      params;

    try {
      // 1. Recompute full ETA pipeline
      const context = await EtaService.assembleContext(tripId, schoolId);
      const rawSummary = await EtaService.calculateStopEtas(context);

      // 2. Smooth against previous cached result
      const prev = etaSummaryCache.get(tripId) ?? null;
      const { summary, isStoppedBus } = EtaSmoothingService.smooth(
        prev,
        rawSummary,
        speedKmh
      );

      // 3. Cache the smoothed result for the next cycle
      etaSummaryCache.set(tripId, summary);

      // 4. Broadcast ETA_UPDATE SSE event
      RealtimeFeedService.publish({
        type: 'ETA_UPDATE',
        schoolId,
        busId,
        tripId,
        latitude,
        longitude,
        speedKmh,
        healthStatus,
        recordedAt,
        timestamp: new Date().toISOString(),
        etaSummary: summary,
        isStoppedBus,
        // Convenience fields for lightweight consumers (e.g. parent web)
        nextStopEtaSeconds: summary.nextStopEta?.durationSeconds ?? null,
        nextStopName: summary.nextStopEta?.stopName ?? null,
        estimatedNextArrivalAt: summary.nextStopEta?.estimatedArrivalAt ?? null,
      });

      logger.debug('[EtaRefresh] ETA refreshed and published', {
        tripId,
        nextStop: summary.nextStopEta?.stopName ?? 'none',
        nextEtaSecs: summary.nextStopEta?.durationSeconds ?? 0,
        isStoppedBus,
        speedKmh,
      });
    } catch (err: unknown) {
      // Non-fatal — log and continue. ETA refresh failures must not affect telemetry ingest.
      logger.warn('[EtaRefresh] ETA refresh failed (non-fatal)', {
        tripId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Evict the cached ETA summary for a trip.
   * Call when a trip ends so the cache does not grow indefinitely.
   */
  static evictCache(tripId: string): void {
    etaSummaryCache.delete(tripId);
  }

  /**
   * Expose cache size for monitoring / tests.
   */
  static getCacheSize(): number {
    return etaSummaryCache.size;
  }

  /**
   * Expose cached summary for a trip — used in tests.
   */
  static getCachedSummary(tripId: string): RouteEtaSummary | null {
    return etaSummaryCache.get(tripId) ?? null;
  }

  /**
   * Clear entire cache — used in tests only.
   */
  static clearCache(): void {
    etaSummaryCache.clear();
  }
}
