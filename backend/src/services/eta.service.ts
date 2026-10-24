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
  StopEtaResult,
  RouteEtaSummary,
  RouteEtaSummarySchema,
  StopEtaResultSchema,
  ParentPickupEta,
  ParentPickupEtaSchema,
  ParentEtaStatus,
  ParentEtaUnavailableReason,
  calculateHaversineDistanceMeters,
} from '@school-bus/shared';
import { query } from '../config/database.js';
import {
  NotFoundError,
  ForbiddenError,
} from '../middlewares/error.middleware.js';
import { logger } from './logger.service.js';
import { RoutingService } from './routing/routing.service.js';

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
  route_id?: string;
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

  /**
   * Phase 20.2 — Calculate per-stop ETAs from an assembled EtaTripContext.
   *
   * Algorithm:
   *  - First stop: origin = currentPosition (or first stop coords when GPS unavailable)
   *  - Each subsequent stop: origin = previous stop coordinates (sequential chaining)
   *  - Duration and distance accumulate cumulatively so later stops include all
   *    intermediate travel time.
   *
   * Uses RoutingService (OSRM / Mock fallback) — provider-independent.
   */
  static async calculateStopEtas(
    context: EtaTripContext
  ): Promise<RouteEtaSummary> {
    const { tripId, schoolId, remainingStops, currentPosition, effectiveSpeedKmh, speedSource } =
      context;

    const now = Date.now();
    const stopEtas: StopEtaResult[] = [];
    let cumulativeDurationSeconds = 0;
    let cumulativeDistanceMeters = 0;

    if (remainingStops.length === 0) {
      // No stops left — trip is complete or has no planned stops
      const summary: RouteEtaSummary = RouteEtaSummarySchema.parse({
        tripId,
        totalRemainingDistanceMeters: 0,
        totalRemainingDurationSeconds: 0,
        estimatedRouteCompletionAt: null,
        nextStopEta: null,
        stopEtas: [],
        effectiveSpeedKmh,
        speedSource,
        calculatedAt: new Date(now).toISOString(),
      });
      return summary;
    }

    for (let i = 0; i < remainingStops.length; i++) {
      const stop = remainingStops[i]!;

      // Determine the origin for this leg
      const origin =
        i === 0
          ? (currentPosition ?? {
              latitude: stop.latitude,
              longitude: stop.longitude,
            })
          : {
              latitude: remainingStops[i - 1]!.latitude,
              longitude: remainingStops[i - 1]!.longitude,
            };

      const destination = { latitude: stop.latitude, longitude: stop.longitude };

      // Skip leg if origin === destination (bus already at stop, or GPS fallback)
      const isSamePoint =
        origin.latitude === destination.latitude &&
        origin.longitude === destination.longitude;

      let legDistanceMeters = 0;
      let legDurationSeconds = 0;
      let provider = 'DIRECT';

      if (!isSamePoint) {
        try {
          const etaResult = await RoutingService.calculateEta(
            { origin, destination, averageSpeedKmh: effectiveSpeedKmh },
            schoolId
          );
          legDistanceMeters = etaResult.distanceMeters;
          legDurationSeconds = etaResult.durationSeconds;
          provider = etaResult.provider;
        } catch (err: any) {
          logger.warn(
            `[EtaService] ETA calculation failed for stop ${stop.stopId}: ${err.message}. Using haversine fallback.`
          );
          // Geometric fallback — never crash the ETA engine
          const straight = calculateHaversineDistanceMeters(origin, destination);
          legDistanceMeters = Math.round(straight * 1.25); // winding factor
          const speedMs = effectiveSpeedKmh / 3.6;
          legDurationSeconds = Math.round(legDistanceMeters / speedMs);
          provider = 'HAVERSINE_FALLBACK';
        }
      }

      cumulativeDistanceMeters += legDistanceMeters;
      cumulativeDurationSeconds += legDurationSeconds;

      stopEtas.push(
        StopEtaResultSchema.parse({
          stopId: stop.stopId,
          stopName: stop.stopName,
          sequenceOrder: stop.sequenceOrder,
          distanceMeters: cumulativeDistanceMeters,
          durationSeconds: cumulativeDurationSeconds,
          estimatedArrivalAt: new Date(now + cumulativeDurationSeconds * 1000).toISOString(),
          provider,
        })
      );
    }

    const lastStop = stopEtas[stopEtas.length - 1]!;

    const summary: RouteEtaSummary = RouteEtaSummarySchema.parse({
      tripId,
      totalRemainingDistanceMeters: cumulativeDistanceMeters,
      totalRemainingDurationSeconds: cumulativeDurationSeconds,
      estimatedRouteCompletionAt: lastStop.estimatedArrivalAt,
      nextStopEta: stopEtas[0] ?? null,
      stopEtas,
      effectiveSpeedKmh,
      speedSource,
      calculatedAt: new Date(now).toISOString(),
    });

    logger.info(
      `[EtaService] ETA calculated for trip ${tripId}: ` +
        `${stopEtas.length} stops, ` +
        `totalDist=${cumulativeDistanceMeters}m, ` +
        `totalDuration=${cumulativeDurationSeconds}s, ` +
        `nextStop=${stopEtas[0]?.stopName ?? 'none'} in ${stopEtas[0]?.durationSeconds ?? 0}s`
    );

    return summary;
  }

  /**
   * Phase 20.2 — Full pipeline: assemble context then calculate ETAs.
   * Convenience wrapper for the controller.
   */
  static async calculateTripEta(
    tripId: string,
    schoolId: string
  ): Promise<RouteEtaSummary> {
    const context = await EtaService.assembleContext(tripId, schoolId);
    return EtaService.calculateStopEtas(context);
  }

  /**
   * Phase 20.4 — Calculate parent-specific ETA for a student's pickup stop.
   * Handles unavailable states (trip not started, stop passed, GPS offline, etc.)
   */
  static async calculateParentEta(params: {
    tripId: string;
    schoolId: string;
    stopId?: string | null;
    cachedSummary?: RouteEtaSummary | null;
  }): Promise<ParentPickupEta> {
    const { tripId, schoolId, stopId } = params;

    // 1. If student has no stop assigned
    if (!stopId) {
      return EtaService.getUnavailableParentEta(
        'NO_STOP_ASSIGNED',
        'No pickup stop has been assigned for this student.',
        { tripId }
      );
    }

    // 2. Fetch trip info
    const tripRows = await query<TripRow>(
      `SELECT id, school_id, bus_id, route_id, status, current_stop_sequence, actual_start_time
       FROM trips
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [tripId, schoolId]
    );

    if (tripRows.length === 0) {
      throw new NotFoundError(`Trip ${tripId} not found for school ${schoolId}`);
    }

    const trip = tripRows[0]!;

    // 3. Handle non-running trip statuses
    if (trip.status === 'SCHEDULED') {
      return EtaService.getUnavailableParentEta(
        'TRIP_NOT_STARTED',
        'The bus has not started this trip yet. Live ETA will activate once the journey begins.',
        { tripId: trip.id, stopId }
      );
    }

    if (trip.status === 'COMPLETED') {
      return EtaService.getUnavailableParentEta(
        'TRIP_COMPLETED',
        'This trip has been completed.',
        { tripId: trip.id, stopId }
      );
    }

    if (trip.status === 'CANCELLED') {
      return EtaService.getUnavailableParentEta(
        'TRIP_CANCELLED',
        'This trip was cancelled.',
        { tripId: trip.id, stopId }
      );
    }

    // 4. Fetch stop info
    const stopRows = await query<StopRow>(
      `SELECT id, route_id, stop_name, sequence_order, geofence_radius_meters
       FROM pickup_locations
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [stopId]
    );

    if (stopRows.length === 0 || stopRows[0]!.route_id !== trip.route_id) {
      return EtaService.getUnavailableParentEta(
        'STOP_NOT_ON_ROUTE',
        'Assigned pickup stop is not part of this trip route.',
        { tripId: trip.id, stopId }
      );
    }

    const stop = stopRows[0]!;

    // 5. Check if the stop was already completed or passed
    const currentSeq = trip.current_stop_sequence ?? 0;
    if (stop.sequence_order <= currentSeq) {
      const now = new Date().toISOString();
      return ParentPickupEtaSchema.parse({
        tripId: trip.id,
        stopId: stop.id,
        stopName: stop.stop_name,
        sequenceOrder: stop.sequence_order,
        durationSeconds: null,
        distanceMeters: null,
        etaMinutes: null,
        estimatedArrivalAt: null,
        status: 'PASSED',
        isAvailable: false,
        unavailableReason: 'STOP_ALREADY_PASSED',
        unavailableMessage: `The bus has already passed ${stop.stop_name}.`,
        isApproaching: false,
        isPassed: true,
        lastUpdatedAt: now,
        calculatedAt: now,
      });
    }

    // 6. Stop is upcoming — retrieve route summary (cached or newly calculated)
    let summary: RouteEtaSummary | null = params.cachedSummary ?? null;

    if (!summary) {
      try {
        const { EtaRefreshService } = await import('./eta-refresh.service.js');
        summary = EtaRefreshService.getCachedSummary(trip.id);
      } catch {
        // Ignore import/cache error and recalculate below
      }
    }

    if (!summary) {
      summary = await EtaService.calculateTripEta(trip.id, trip.school_id);
    }

    return EtaService.extractParentEtaFromSummary(
      summary,
      stop.id,
      stop.stop_name,
      stop.sequence_order,
      stop.geofence_radius_meters
    );
  }

  /**
   * Phase 20.4 — Synchronously extract a ParentPickupEta from a RouteEtaSummary.
   * Used by SSE subscribers and direct handlers when a summary is already in hand.
   */
  static extractParentEtaFromSummary(
    summary: RouteEtaSummary,
    stopId: string,
    stopName?: string | null,
    sequenceOrder?: number | null,
    geofenceRadiusMeters?: number | null
  ): ParentPickupEta {
    const targetStop = summary.stopEtas.find((s) => s.stopId === stopId);

    if (!targetStop) {
      return ParentPickupEtaSchema.parse({
        tripId: summary.tripId,
        stopId,
        stopName: stopName ?? null,
        sequenceOrder: sequenceOrder ?? null,
        durationSeconds: null,
        distanceMeters: null,
        etaMinutes: null,
        estimatedArrivalAt: null,
        status: 'UNAVAILABLE',
        isAvailable: false,
        unavailableReason: 'CALCULATION_PENDING',
        unavailableMessage: 'Calculating live estimated arrival time...',
        isApproaching: false,
        isPassed: false,
        effectiveSpeedKmh: summary.effectiveSpeedKmh,
        calculatedAt: summary.calculatedAt,
        lastUpdatedAt: summary.calculatedAt,
      });
    }

    const durationSeconds = Math.max(0, targetStop.durationSeconds);
    const distanceMeters = Math.max(0, targetStop.distanceMeters);
    const etaMinutes =
      durationSeconds < 60 ? (durationSeconds === 0 ? 0 : 1) : Math.round(durationSeconds / 60);

    const approachRadius = geofenceRadiusMeters ?? 500;
    // Approaching if duration is <= 5 minutes (300 seconds) OR within approach radius
    const isApproaching = durationSeconds <= 300 || distanceMeters <= approachRadius;
    const status: ParentEtaStatus = isApproaching ? 'APPROACHING' : 'AVAILABLE';
    const isStoppedBus =
      summary.speedSource === 'fallback' ? false : summary.effectiveSpeedKmh <= 2;

    return ParentPickupEtaSchema.parse({
      tripId: summary.tripId,
      stopId: targetStop.stopId,
      stopName: targetStop.stopName,
      sequenceOrder: targetStop.sequenceOrder,
      durationSeconds,
      distanceMeters,
      etaMinutes,
      estimatedArrivalAt: targetStop.estimatedArrivalAt,
      status,
      isAvailable: true,
      unavailableReason: null,
      unavailableMessage: null,
      isApproaching,
      isPassed: false,
      isStoppedBus,
      effectiveSpeedKmh: summary.effectiveSpeedKmh,
      lastUpdatedAt: summary.calculatedAt,
      calculatedAt: summary.calculatedAt,
    });
  }

  /**
   * Phase 20.4 — Helper for constructing typed unavailable ParentPickupEta records.
   */
  static getUnavailableParentEta(
    reason: ParentEtaUnavailableReason,
    message: string,
    params?: {
      tripId?: string | null;
      stopId?: string | null;
      stopName?: string | null;
      sequenceOrder?: number | null;
    }
  ): ParentPickupEta {
    const isPassed = reason === 'STOP_ALREADY_PASSED';
    const status: ParentEtaStatus = isPassed ? 'PASSED' : 'UNAVAILABLE';
    const now = new Date().toISOString();

    return ParentPickupEtaSchema.parse({
      tripId: params?.tripId ?? null,
      stopId: params?.stopId ?? null,
      stopName: params?.stopName ?? null,
      sequenceOrder: params?.sequenceOrder ?? null,
      durationSeconds: null,
      distanceMeters: null,
      etaMinutes: null,
      estimatedArrivalAt: null,
      status,
      isAvailable: false,
      unavailableReason: reason,
      unavailableMessage: message,
      isApproaching: false,
      isPassed,
      lastUpdatedAt: now,
      calculatedAt: now,
    });
  }
}
