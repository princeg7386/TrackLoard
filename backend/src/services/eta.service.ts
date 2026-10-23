/**
 * Phase 20.1 — ETA Engine: Input Context Assembler
 *
 * Responsibilities:
 *  1. EffectiveSpeedService — derive a reliable speed estimate from:
 *     a) rolling average of last 5 GPS pings within 2 minutes (primary)
 *     b) buses.last_speed_kmh (secondary / last-ping)
 *     c) 20 km/h school-zone constant (ultimate fallback)
 *     Result always clamped to [5, 160] km/h.
 *
 *  2. EtaService.assembleContext(tripId, schoolId) — collect all inputs
 *     the ETA calculator (Phase 20.2) will consume:
 *       - Current bus position (nullable — GPS may not have a fix yet)
 *       - Remaining stops in route order (sequence_order > current_stop_sequence)
 *       - Effective speed + source tag
 *       - Trip metadata (status, actualStartTime, currentStopSequence)
 *
 * No DB migrations. All columns come from existing tables:
 *   trips, buses (migration 013), pickup_locations, gps_locations.
 */

import {
  EtaTripContext,
  EtaTripContextSchema,
  SpeedSource,
} from '@school-bus/shared';
import { query } from '../config/database.js';
import {
  NotFoundError,
  ForbiddenError,
} from '../middlewares/error.middleware.js';
import { logger } from './logger.service.js';

/** Minimum speed used when bus appears stationary or GPS is offline */
const MIN_SPEED_KMH = 5;
/** Maximum realistic school bus speed (matches telemetry clamp) */
const MAX_SPEED_KMH = 160;
/** Default school-zone speed when no live GPS data is available */
const FALLBACK_SPEED_KMH = 20;
/** Rolling window duration for speed averaging */
const ROLLING_WINDOW_MINUTES = 2;
/** Number of most-recent pings to include in rolling average */
const ROLLING_PING_LIMIT = 5;
/** Minimum pings required to use rolling average (vs last_ping) */
const MIN_PINGS_FOR_ROLLING = 2;

// ---------------------------------------------------------------------------
// Raw DB row types (private to this module)
// ---------------------------------------------------------------------------

interface TripRow {
  id: string;
  school_id: string;
  bus_id: string;
  route_id: string;
  status: string;
  current_stop_sequence: number;
  actual_start_time: string | null;
}

interface BusLocationRow {
  last_latitude: number | null;
  last_longitude: number | null;
  last_speed_kmh: number | null;
  last_gps_recorded_at: string | null;
}

interface StopRow {
  id: string;
  stop_name: string;
  sequence_order: number;
  latitude: number;
  longitude: number;
  geofence_radius_meters: number;
  scheduled_time: string;
}

interface SpeedPingRow {
  speed_kmh: number;
}

// ---------------------------------------------------------------------------
// EffectiveSpeedService
// ---------------------------------------------------------------------------

export class EffectiveSpeedService {
  /**
   * Derive the best available speed estimate for a bus.
   *
   * Priority:
   *  1. Rolling average of last N pings within ROLLING_WINDOW_MINUTES  → 'rolling_avg'
   *  2. buses.last_speed_kmh (single last ping)                         → 'last_ping'
   *  3. FALLBACK_SPEED_KMH constant                                     → 'fallback'
   *
   * Always clamped to [MIN_SPEED_KMH, MAX_SPEED_KMH].
   */
  static async computeEffectiveSpeedKmh(busId: string): Promise<{
    speedKmh: number;
    source: SpeedSource;
  }> {
    // 1. Try rolling average from recent GPS pings
    try {
      const pings = await query<SpeedPingRow>(
        `SELECT speed_kmh
         FROM gps_locations
         WHERE bus_id = $1
           AND recorded_at > NOW() - INTERVAL '${ROLLING_WINDOW_MINUTES} minutes'
         ORDER BY recorded_at DESC
         LIMIT $2`,
        [busId, ROLLING_PING_LIMIT]
      );

      if (pings.length >= MIN_PINGS_FOR_ROLLING) {
        const avg =
          pings.reduce((sum, p) => sum + Number(p.speed_kmh), 0) / pings.length;
        const clamped = Math.min(MAX_SPEED_KMH, Math.max(MIN_SPEED_KMH, avg));
        logger.debug(`[EtaService] Rolling avg speed for bus ${busId}: ${clamped.toFixed(1)} km/h (${pings.length} pings)`);
        return { speedKmh: clamped, source: 'rolling_avg' };
      }

      // 2. Fallback to last cached ping speed from buses table
      const busRows = await query<BusLocationRow>(
        `SELECT last_speed_kmh FROM buses WHERE id = $1 LIMIT 1`,
        [busId]
      );

      if (busRows[0]?.last_speed_kmh != null) {
        const lastSpeed = Number(busRows[0].last_speed_kmh);
        const clamped = Math.min(MAX_SPEED_KMH, Math.max(MIN_SPEED_KMH, lastSpeed));
        logger.debug(`[EtaService] Last-ping speed for bus ${busId}: ${clamped.toFixed(1)} km/h`);
        return { speedKmh: clamped, source: 'last_ping' };
      }
    } catch (err: any) {
      logger.warn(`[EtaService] Speed computation DB error for bus ${busId}: ${err.message}`);
    }

    // 3. Ultimate fallback
    logger.debug(`[EtaService] Using fallback speed (${FALLBACK_SPEED_KMH} km/h) for bus ${busId}`);
    return { speedKmh: FALLBACK_SPEED_KMH, source: 'fallback' };
  }
}

// ---------------------------------------------------------------------------
// EtaService
// ---------------------------------------------------------------------------

export class EtaService {
  /**
   * Assemble all inputs required for ETA calculation for a trip.
   *
   * @param tripId  UUID of the active trip
   * @param schoolId  School ID of the caller (tenant isolation)
   * @throws NotFoundError if trip does not exist
   * @throws ForbiddenError if trip belongs to a different school
   */
  static async assembleContext(
    tripId: string,
    schoolId: string
  ): Promise<EtaTripContext> {
    // --- 1. Load trip ---
    const tripRows = await query<TripRow>(
      `SELECT id, school_id, bus_id, route_id, status,
              current_stop_sequence, actual_start_time
       FROM trips
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [tripId]
    );

    if (tripRows.length === 0) {
      throw new NotFoundError(`Trip ${tripId} not found`);
    }

    const trip = tripRows[0]!;

    // Tenant isolation
    if (trip.school_id !== schoolId) {
      throw new ForbiddenError(`Trip ${tripId} does not belong to school ${schoolId}`);
    }

    // --- 2. Load current bus location ---
    const busRows = await query<BusLocationRow>(
      `SELECT last_latitude, last_longitude, last_speed_kmh, last_gps_recorded_at
       FROM buses
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [trip.bus_id]
    );

    const bus = busRows[0];
    const currentPosition =
      bus?.last_latitude != null && bus?.last_longitude != null
        ? { latitude: Number(bus.last_latitude), longitude: Number(bus.last_longitude) }
        : null;

    // --- 3. Load remaining stops in route order ---
    const stopRows = await query<StopRow>(
      `SELECT id, stop_name, sequence_order, latitude, longitude,
              geofence_radius_meters, scheduled_time
       FROM pickup_locations
       WHERE route_id = $1
         AND sequence_order > $2
         AND deleted_at IS NULL
       ORDER BY sequence_order ASC`,
      [trip.route_id, trip.current_stop_sequence]
    );

    const remainingStops = stopRows.map((s) => ({
      stopId: s.id,
      stopName: s.stop_name,
      sequenceOrder: Number(s.sequence_order),
      latitude: Number(s.latitude),
      longitude: Number(s.longitude),
      geofenceRadiusMeters: Number(s.geofence_radius_meters),
      scheduledTime: String(s.scheduled_time),
    }));

    // --- 4. Effective speed ---
    const { speedKmh, source } = await EffectiveSpeedService.computeEffectiveSpeedKmh(
      trip.bus_id
    );

    // --- 5. Assemble and validate context ---
    const raw: EtaTripContext = {
      tripId: trip.id,
      schoolId: trip.school_id,
      busId: trip.bus_id,
      currentPosition,
      effectiveSpeedKmh: speedKmh,
      speedSource: source,
      currentStopSequence: Number(trip.current_stop_sequence),
      remainingStops,
      tripStatus: trip.status,
      actualStartTime: trip.actual_start_time
        ? new Date(trip.actual_start_time).toISOString()
        : null,
      assembledAt: new Date().toISOString(),
    };

    // Validate against shared schema (throws ZodError on malformed data)
    const parsed = EtaTripContextSchema.parse(raw);

    logger.info(
      `[EtaService] Context assembled for trip ${tripId}: ` +
        `${remainingStops.length} remaining stops, ` +
        `speed=${speedKmh.toFixed(1)} km/h (${source}), ` +
        `position=${currentPosition ? `${currentPosition.latitude.toFixed(4)},${currentPosition.longitude.toFixed(4)}` : 'none'}`
    );

    return parsed;
  }
}
