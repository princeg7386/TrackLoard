/**
 * Phase 29.1 — Overspeed Rule Service
 *
 * Responsibilities:
 *  - Resolve the effective speed limit rule for a trip (route override → school → config default)
 *  - Evaluate each telemetry ping's speed against that rule
 *  - Maintain in-process duration accumulators (Map) to honour optional duration thresholds
 *  - Persist overspeed_events rows (ACTIVE / RESOLVED lifecycle)
 *
 * Called fire-and-forget from TelemetryService (Phase 29.2 hook).
 * All methods are static; errors never propagate to the caller.
 */

import { query } from '../config/database.js';
import {
  OVERSPEED_CONFIG,
  OverspeedRule,
  OverspeedEventRecord,
  OverspeedEvaluationResult,
} from '@school-bus/shared';
import { logger } from './logger.service.js';

export class OverspeedRuleService {
  // ---------------------------------------------------------------------------
  // In-process duration accumulators
  // key = tripId, value = accumulated seconds above speed limit
  // Reset to 0 when speed drops back under limit.
  // ---------------------------------------------------------------------------
  private static readonly _durationAccumulator = new Map<string, number>();

  // ---------------------------------------------------------------------------
  // Rule Resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve the effective overspeed rule for a trip.
   * Priority: route-level override → school default → OVERSPEED_CONFIG defaults.
   *
   * @param schoolId  School UUID (for tenant isolation)
   * @param routeId   Route UUID (optional; may be null for unassigned trips)
   */
  static async loadOverspeedRule(
    schoolId: string,
    routeId: string | null
  ): Promise<OverspeedRule> {
    // 1. Try route-level override first
    if (routeId) {
      const routeRows = await query<{
        speed_limit_kmh: number | null;
        overspeed_duration_threshold_seconds: number | null;
      }>(
        `SELECT speed_limit_kmh, overspeed_duration_threshold_seconds
         FROM routes
         WHERE id = $1 AND school_id = $2`,
        [routeId, schoolId]
      );

      const route = routeRows[0];
      if (route?.speed_limit_kmh != null) {
        return {
          schoolId,
          routeId,
          speedLimitKmh: route.speed_limit_kmh,
          durationThresholdSeconds:
            route.overspeed_duration_threshold_seconds ??
            await OverspeedRuleService._schoolDurationThreshold(schoolId),
          source: 'ROUTE_OVERRIDE',
        };
      }
    }

    // 2. School default
    const schoolRows = await query<{
      speed_limit_kmh: number | null;
      overspeed_duration_threshold_seconds: number | null;
    }>(
      `SELECT speed_limit_kmh, overspeed_duration_threshold_seconds
       FROM schools
       WHERE id = $1`,
      [schoolId]
    );

    const school = schoolRows[0];
    if (school?.speed_limit_kmh != null) {
      return {
        schoolId,
        routeId: routeId ?? null,
        speedLimitKmh: school.speed_limit_kmh,
        durationThresholdSeconds:
          school.overspeed_duration_threshold_seconds ??
          OVERSPEED_CONFIG.DEFAULT_DURATION_THRESHOLD_SECONDS,
        source: 'SCHOOL_DEFAULT',
      };
    }

    // 3. Config hard default
    return {
      schoolId,
      routeId: routeId ?? null,
      speedLimitKmh: OVERSPEED_CONFIG.DEFAULT_SPEED_LIMIT_KMH,
      durationThresholdSeconds: OVERSPEED_CONFIG.DEFAULT_DURATION_THRESHOLD_SECONDS,
      source: 'CONFIG_DEFAULT',
    };
  }

  // ---------------------------------------------------------------------------
  // Speed Evaluation
  // ---------------------------------------------------------------------------

  /**
   * Evaluate a single telemetry ping's speed against the active overspeed rule.
   * Manages the in-process duration accumulator and opens/resolves events in DB.
   *
   * Actions:
   *  SKIPPED    — speed below MIN_EVALUATION_SPEED_KMH (bus stopped / GPS noise)
   *  SAFE       — speed is within limit; any active event resolved if exists
   *  DEBOUNCING — speed exceeds limit but duration threshold not yet met
   *  TRIGGERED  — duration threshold met; new ACTIVE event opened in DB
   *  RESOLVED   — was active; speed returned to limit; event marked RESOLVED
   */
  static async evaluateSpeed(params: {
    tripId: string;
    schoolId: string;
    busId: string;
    driverId: string | null;
    routeId: string | null;
    speedKmh: number;
    latitude: number;
    longitude: number;
    timestamp: string;
    /** Seconds since last ping (used to accumulate duration). Default: ASSUMED_PING_INTERVAL_SECONDS */
    pingIntervalSeconds?: number;
  }): Promise<OverspeedEvaluationResult> {
    const {
      tripId, schoolId, busId, driverId, routeId,
      speedKmh, latitude, longitude, timestamp, pingIntervalSeconds,
    } = params;

    const interval = pingIntervalSeconds ?? OVERSPEED_CONFIG.ASSUMED_PING_INTERVAL_SECONDS;

    // Skip evaluation for very low / stationary speed (GPS noise)
    if (speedKmh < OVERSPEED_CONFIG.MIN_EVALUATION_SPEED_KMH) {
      OverspeedRuleService._durationAccumulator.delete(tripId);
      return {
        tripId, schoolId,
        speedKmh, speedLimitKmh: 0,
        isOverspeed: false,
        accumulatedSeconds: 0,
        durationThresholdSeconds: 0,
        action: 'SKIPPED',
        message: `Speed ${speedKmh} km/h below evaluation floor — skipped`,
      };
    }

    // Load effective rule
    const rule = await OverspeedRuleService.loadOverspeedRule(schoolId, routeId);

    const isOverLimit = speedKmh > rule.speedLimitKmh;

    // ── Bus under limit ──────────────────────────────────────────────────────
    if (!isOverLimit) {
      const prevAccum = OverspeedRuleService._durationAccumulator.get(tripId) ?? 0;
      OverspeedRuleService._durationAccumulator.delete(tripId);

      // If there is an active event, resolve it
      const activeEvent = await OverspeedRuleService._getActiveEventForTrip(tripId, schoolId);
      if (activeEvent) {
        const durationSeconds = Math.floor(
          (new Date(timestamp).getTime() - new Date(activeEvent.startedAt).getTime()) / 1000
        );
        await query(
          `UPDATE overspeed_events
           SET status = 'RESOLVED', ended_at = $1, duration_seconds = $2, updated_at = NOW()
           WHERE id = $3 AND school_id = $4`,
          [timestamp, durationSeconds, activeEvent.id, schoolId]
        );
        logger.info('[Overspeed] Event resolved — bus back under limit', {
          tripId, eventId: activeEvent.id, speedKmh, limitKmh: rule.speedLimitKmh, durationSeconds,
        });
        return {
          tripId, schoolId,
          speedKmh, speedLimitKmh: rule.speedLimitKmh,
          isOverspeed: false,
          accumulatedSeconds: 0,
          durationThresholdSeconds: rule.durationThresholdSeconds,
          action: 'RESOLVED',
          activeEventId: activeEvent.id,
          message: `Speed returned to limit — overspeed event resolved after ${durationSeconds}s`,
        };
      }

      return {
        tripId, schoolId,
        speedKmh, speedLimitKmh: rule.speedLimitKmh,
        isOverspeed: false,
        accumulatedSeconds: 0,
        durationThresholdSeconds: rule.durationThresholdSeconds,
        action: 'SAFE',
        message: `Speed ${speedKmh} km/h within limit (${rule.speedLimitKmh} km/h)`,
      };
    }

    // ── Bus over limit ───────────────────────────────────────────────────────
    const prevAccum = OverspeedRuleService._durationAccumulator.get(tripId) ?? 0;
    const newAccum = prevAccum + interval;
    OverspeedRuleService._durationAccumulator.set(tripId, newAccum);

    // Check if an active event already exists — if so, just update it
    const activeEvent = await OverspeedRuleService._getActiveEventForTrip(tripId, schoolId);
    if (activeEvent) {
      // Update max speed and duration
      const newMax = Math.max(activeEvent.maxSpeedKmh, speedKmh);
      const durationSeconds = Math.floor(
        (new Date(timestamp).getTime() - new Date(activeEvent.startedAt).getTime()) / 1000
      );
      const isPeakUpdate = speedKmh >= activeEvent.maxSpeedKmh;

      await query(
        `UPDATE overspeed_events
         SET current_speed_kmh = $1,
             max_speed_kmh = $2,
             duration_seconds = $3,
             ${isPeakUpdate ? 'peak_latitude = $4, peak_longitude = $5, peak_location = ST_SetSRID(ST_MakePoint($5, $4), 4326),' : ''}
             updated_at = NOW()
         WHERE id = ${isPeakUpdate ? '$6' : '$4'} AND school_id = ${isPeakUpdate ? '$7' : '$5'}`,
        isPeakUpdate
          ? [speedKmh, newMax, durationSeconds, latitude, longitude, activeEvent.id, schoolId]
          : [speedKmh, newMax, durationSeconds, activeEvent.id, schoolId]
      );

      return {
        tripId, schoolId,
        speedKmh, speedLimitKmh: rule.speedLimitKmh,
        isOverspeed: true,
        accumulatedSeconds: newAccum,
        durationThresholdSeconds: rule.durationThresholdSeconds,
        action: 'TRIGGERED',
        activeEventId: activeEvent.id,
        message: `Active overspeed event updated — ${speedKmh} km/h (limit: ${rule.speedLimitKmh} km/h, duration: ${durationSeconds}s)`,
      };
    }

    // No active event yet — check duration threshold
    if (newAccum < rule.durationThresholdSeconds) {
      logger.info('[Overspeed] Speed above limit — debouncing duration threshold', {
        tripId, speedKmh, limitKmh: rule.speedLimitKmh,
        accumulated: newAccum, threshold: rule.durationThresholdSeconds,
      });
      return {
        tripId, schoolId,
        speedKmh, speedLimitKmh: rule.speedLimitKmh,
        isOverspeed: true,
        accumulatedSeconds: newAccum,
        durationThresholdSeconds: rule.durationThresholdSeconds,
        action: 'DEBOUNCING',
        message: `Overspeed debouncing — ${newAccum}s accumulated of ${rule.durationThresholdSeconds}s threshold`,
      };
    }

    // Duration threshold met — open a new ACTIVE event
    const insertRows = await query<{ id: string }>(
      `INSERT INTO overspeed_events (
         school_id, trip_id, bus_id, driver_id, route_id,
         status, started_at, duration_seconds, speed_limit_kmh,
         max_speed_kmh, current_speed_kmh,
         peak_latitude, peak_longitude, peak_location
       ) VALUES (
         $1, $2, $3, $4, $5,
         'ACTIVE', $6, $7, $8,
         $9, $9,
         $10, $11, ST_SetSRID(ST_MakePoint($11, $10), 4326)
       ) RETURNING id`,
      [
        schoolId, tripId, busId, driverId ?? null, routeId ?? null,
        timestamp, Math.round(newAccum), rule.speedLimitKmh,
        speedKmh,
        latitude, longitude,
      ]
    );

    const newEventId = insertRows[0]?.id;
    if (!newEventId) {
      logger.warn('[Overspeed] Insert returned no id', { tripId });
      return {
        tripId, schoolId,
        speedKmh, speedLimitKmh: rule.speedLimitKmh,
        isOverspeed: true,
        accumulatedSeconds: newAccum,
        durationThresholdSeconds: rule.durationThresholdSeconds,
        action: 'DEBOUNCING',
        message: 'Overspeed event insert failed — treating as debouncing',
      };
    }

    logger.warn('[Overspeed] New overspeed event opened', {
      tripId, eventId: newEventId, speedKmh,
      limitKmh: rule.speedLimitKmh, ruleSource: rule.source,
    });

    return {
      tripId, schoolId,
      speedKmh, speedLimitKmh: rule.speedLimitKmh,
      isOverspeed: true,
      accumulatedSeconds: newAccum,
      durationThresholdSeconds: rule.durationThresholdSeconds,
      action: 'TRIGGERED',
      activeEventId: newEventId,
      message: `Overspeed event opened — ${speedKmh} km/h exceeds ${rule.speedLimitKmh} km/h limit`,
    };
  }

  // ---------------------------------------------------------------------------
  // Query helpers
  // ---------------------------------------------------------------------------

  /** Get the currently ACTIVE overspeed event for a trip (tenant-scoped). */
  static async _getActiveEventForTrip(
    tripId: string,
    schoolId: string
  ): Promise<OverspeedEventRecord | null> {
    const rows = await query<{
      id: string;
      school_id: string;
      trip_id: string;
      bus_id: string;
      driver_id: string | null;
      route_id: string | null;
      status: string;
      started_at: string;
      ended_at: string | null;
      duration_seconds: number;
      speed_limit_kmh: number;
      max_speed_kmh: string;
      current_speed_kmh: string;
      peak_latitude: number;
      peak_longitude: number;
      school_notified_at: string | null;
      driver_notified_at: string | null;
      created_at: string;
    }>(
      `SELECT id, school_id, trip_id, bus_id, driver_id, route_id, status,
              started_at, ended_at, duration_seconds, speed_limit_kmh,
              max_speed_kmh, current_speed_kmh,
              peak_latitude, peak_longitude,
              school_notified_at, driver_notified_at, created_at
       FROM overspeed_events
       WHERE trip_id = $1 AND school_id = $2 AND status = 'ACTIVE'
       ORDER BY started_at DESC
       LIMIT 1`,
      [tripId, schoolId]
    );

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      schoolId: row.school_id,
      tripId: row.trip_id,
      busId: row.bus_id,
      driverId: row.driver_id ?? null,
      routeId: row.route_id ?? null,
      status: row.status as 'ACTIVE' | 'RESOLVED',
      startedAt: new Date(row.started_at).toISOString(),
      endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
      durationSeconds: Number(row.duration_seconds),
      speedLimitKmh: Number(row.speed_limit_kmh),
      maxSpeedKmh: Number(row.max_speed_kmh),
      currentSpeedKmh: Number(row.current_speed_kmh),
      peakLatitude: Number(row.peak_latitude),
      peakLongitude: Number(row.peak_longitude),
      schoolNotifiedAt: row.school_notified_at
        ? new Date(row.school_notified_at).toISOString()
        : null,
      driverNotifiedAt: row.driver_notified_at
        ? new Date(row.driver_notified_at).toISOString()
        : null,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  /** Get all active overspeed events for a school. */
  static async getActiveEventsForSchool(schoolId: string): Promise<OverspeedEventRecord[]> {
    const rows = await query<{
      id: string;
      school_id: string;
      trip_id: string;
      bus_id: string;
      driver_id: string | null;
      route_id: string | null;
      status: string;
      started_at: string;
      ended_at: string | null;
      duration_seconds: number;
      speed_limit_kmh: number;
      max_speed_kmh: string;
      current_speed_kmh: string;
      peak_latitude: number;
      peak_longitude: number;
      school_notified_at: string | null;
      driver_notified_at: string | null;
      created_at: string;
    }>(
      `SELECT id, school_id, trip_id, bus_id, driver_id, route_id, status,
              started_at, ended_at, duration_seconds, speed_limit_kmh,
              max_speed_kmh, current_speed_kmh,
              peak_latitude, peak_longitude,
              school_notified_at, driver_notified_at, created_at
       FROM overspeed_events
       WHERE school_id = $1 AND status = 'ACTIVE'
       ORDER BY started_at DESC`,
      [schoolId]
    );

    return rows.map((row) => ({
      id: row.id,
      schoolId: row.school_id,
      tripId: row.trip_id,
      busId: row.bus_id,
      driverId: row.driver_id ?? null,
      routeId: row.route_id ?? null,
      status: row.status as 'ACTIVE' | 'RESOLVED',
      startedAt: new Date(row.started_at).toISOString(),
      endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
      durationSeconds: Number(row.duration_seconds),
      speedLimitKmh: Number(row.speed_limit_kmh),
      maxSpeedKmh: Number(row.max_speed_kmh),
      currentSpeedKmh: Number(row.current_speed_kmh),
      peakLatitude: Number(row.peak_latitude),
      peakLongitude: Number(row.peak_longitude),
      schoolNotifiedAt: row.school_notified_at
        ? new Date(row.school_notified_at).toISOString()
        : null,
      driverNotifiedAt: row.driver_notified_at
        ? new Date(row.driver_notified_at).toISOString()
        : null,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private static async _schoolDurationThreshold(schoolId: string): Promise<number> {
    const rows = await query<{ overspeed_duration_threshold_seconds: number | null }>(
      `SELECT overspeed_duration_threshold_seconds FROM schools WHERE id = $1`,
      [schoolId]
    );
    return (
      rows[0]?.overspeed_duration_threshold_seconds ??
      OVERSPEED_CONFIG.DEFAULT_DURATION_THRESHOLD_SECONDS
    );
  }

  /** Reset in-process state for a trip (call on trip end). */
  static clearTripState(tripId: string): void {
    OverspeedRuleService._durationAccumulator.delete(tripId);
  }
}
