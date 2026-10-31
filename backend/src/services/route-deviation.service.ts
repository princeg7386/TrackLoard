import { Pool, PoolClient } from 'pg';
import { query } from '../config/database.js';
import {
  calculateHaversineDistanceMeters,
  decodePolyline,
  GeoCoordinates,
  ROUTE_DEVIATION_CONFIG,
  RouteGeometry,
  RouteWayStop,
  BusRoutePositionResult,
  TripRoutePositionResponse,
  RouteDeviationSeverity,
  ActiveRouteDeviationRecord,
  RouteDeviationEvaluationResult,
} from '@school-bus/shared';
import { NotFoundError, BadRequestError } from '../middlewares/error.middleware.js';
import { logger } from './logger.service.js';

async function executeQuery<T = any>(
  sql: string,
  params: any[] = [],
  client?: PoolClient | Pool
): Promise<T[]> {
  if (client) {
    const res = await (client as any).query(sql, params);
    return res.rows;
  }
  return query<T>(sql, params);
}

export class RouteDeviationService {
  /**
   * Determine the severity tier based on distance from expected corridor
   */
  static calculateDeviationSeverity(distanceMeters: number): RouteDeviationSeverity {
    if (distanceMeters >= ROUTE_DEVIATION_CONFIG.SEVERITY_THRESHOLDS.CRITICAL_METERS) return 'CRITICAL';
    if (distanceMeters >= ROUTE_DEVIATION_CONFIG.SEVERITY_THRESHOLDS.HIGH_METERS) return 'HIGH';
    if (distanceMeters >= ROUTE_DEVIATION_CONFIG.SEVERITY_THRESHOLDS.MEDIUM_METERS) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Load and parse route geometry, waypoints, and sequential stops
   */
  static async loadRouteGeometry(routeId: string, client?: PoolClient | Pool): Promise<RouteGeometry> {
    // 1. Fetch route definition
    const routeRows = await executeQuery<{
      id: string;
      school_id: string;
      name: string;
      code: string;
      route_type: string;
      path_polyline: string | null;
      deviation_threshold_meters: number | null;
    }>(
      `SELECT id, school_id, name, code, route_type, path_polyline, deviation_threshold_meters
       FROM routes
       WHERE id = $1`,
      [routeId],
      client
    );

    const routeRow = routeRows[0];
    if (!routeRow) {
      throw new NotFoundError(`Route with ID '${routeId}' not found`);
    }

    // 2. Fetch ordered pickup stops
    const stopRows = await executeQuery<{
      id: string;
      stop_name: string;
      sequence_order: number;
      latitude: number;
      longitude: number;
      geofence_radius_meters: number | null;
    }>(
      `SELECT id, stop_name, sequence_order, latitude, longitude, geofence_radius_meters
       FROM pickup_locations
       WHERE route_id = $1
       ORDER BY sequence_order ASC`,
      [routeId],
      client
    );

    const stops: RouteWayStop[] = stopRows.map((s) => ({
      id: s.id,
      name: s.stop_name,
      sequenceOrder: Number(s.sequence_order),
      latitude: Number(s.latitude),
      longitude: Number(s.longitude),
      radiusMeters: Number(s.geofence_radius_meters || 50),
    }));

    // 3. Extract and parse coordinates from polyline
    let coordinates: GeoCoordinates[] = [];
    let isFallbackFromStops = false;
    const rawPolyline = (routeRow.path_polyline || '').trim();

    if (rawPolyline) {
      // Check if polyline is formatted as JSON coordinates array
      if (rawPolyline.startsWith('[')) {
        try {
          const parsed = JSON.parse(rawPolyline);
          if (Array.isArray(parsed) && parsed.length > 0) {
            coordinates = parsed
              .map((item: any) => {
                if (Array.isArray(item) && item.length >= 2) {
                  return { latitude: Number(item[0]), longitude: Number(item[1]) };
                } else if (item && typeof item === 'object' && 'latitude' in item && 'longitude' in item) {
                  return { latitude: Number(item.latitude), longitude: Number(item.longitude) };
                }
                return null;
              })
              .filter((c): c is GeoCoordinates => c !== null && !isNaN(c.latitude) && !isNaN(c.longitude));
          }
        } catch (err) {
          logger.warn('Failed to parse JSON polyline, attempting encoded decodePolyline', {
            err: String(err),
            routeId,
          });
        }
      }

      // If not parsed as JSON array, decode as Google encoded polyline string
      if (coordinates.length === 0) {
        try {
          const decoded = decodePolyline(rawPolyline);
          if (decoded && decoded.length > 0) {
            coordinates = decoded.map(([lat, lng]) => ({
              latitude: Number(lat),
              longitude: Number(lng),
            }));
          }
        } catch (err) {
          logger.warn('Failed to decode Google encoded polyline string', {
            err: String(err),
            routeId,
          });
        }
      }
    }

    // 4. Fallback to sequential stop locations if polyline was missing or empty
    if (coordinates.length === 0 && stops.length > 0) {
      coordinates = stops.map((s) => ({
        latitude: s.latitude,
        longitude: s.longitude,
      }));
      isFallbackFromStops = true;
    }

    // 5. Compute total route distance
    let totalDistanceMeters = 0;
    for (let i = 0; i < coordinates.length - 1; i++) {
      totalDistanceMeters += calculateHaversineDistanceMeters(coordinates[i]!, coordinates[i + 1]!);
    }
    const segmentCount = Math.max(0, coordinates.length - 1);

    return {
      routeId: routeRow.id,
      schoolId: routeRow.school_id,
      name: routeRow.name,
      code: routeRow.code,
      routeType: routeRow.route_type,
      deviationThresholdMeters:
        routeRow.deviation_threshold_meters != null
          ? Number(routeRow.deviation_threshold_meters)
          : ROUTE_DEVIATION_CONFIG.DEFAULT_DEVIATION_THRESHOLD_METERS,
      coordinates,
      totalDistanceMeters: Math.round(totalDistanceMeters * 100) / 100,
      segmentCount,
      stops,
      isFallbackFromStops,
    };
  }

  /**
   * Geometric algorithm to determine the bus's cross-track perpendicular distance
   * to the expected route polyline, nearest point on route, nearest stop, and progress percentage.
   */
  static determineBusPositionRelativeToRoute(
    busCoords: GeoCoordinates,
    geometry: RouteGeometry,
    options?: { deviationThresholdMeters?: number }
  ): BusRoutePositionResult {
    const threshold = options?.deviationThresholdMeters ?? geometry.deviationThresholdMeters;

    // Edge case 1: empty coordinates
    if (geometry.coordinates.length === 0) {
      return {
        isOnRoute: true,
        isDeviated: false,
        distanceToRouteMeters: 0,
        deviationThresholdMeters: threshold,
        nearestPointOnRoute: { latitude: busCoords.latitude, longitude: busCoords.longitude },
        nearestSegmentIndex: 0,
        nearestStop: null,
        progressPercentage: 0,
      };
    }

    // Edge case 2: single coordinate
    if (geometry.coordinates.length === 1) {
      const singlePoint = geometry.coordinates[0]!;
      const dist = calculateHaversineDistanceMeters(busCoords, singlePoint);
      const isDeviated = dist > threshold;
      return {
        isOnRoute: !isDeviated,
        isDeviated,
        distanceToRouteMeters: Math.round(dist * 100) / 100,
        deviationThresholdMeters: threshold,
        nearestPointOnRoute: singlePoint,
        nearestSegmentIndex: 0,
        nearestStop: geometry.stops[0]
          ? {
              id: geometry.stops[0].id,
              name: geometry.stops[0].name,
              sequenceOrder: geometry.stops[0].sequenceOrder,
              distanceMeters: Math.round(
                calculateHaversineDistanceMeters(busCoords, geometry.stops[0]) * 100
              ) / 100,
            }
          : null,
        progressPercentage: 0,
      };
    }

    // Cumulative distances along polyline segments
    const cumulativeDistances: number[] = [0];
    for (let i = 0; i < geometry.coordinates.length - 1; i++) {
      const segLen = calculateHaversineDistanceMeters(
        geometry.coordinates[i]!,
        geometry.coordinates[i + 1]!
      );
      cumulativeDistances.push(cumulativeDistances[i]! + segLen);
    }

    let minDistanceMeters = Infinity;
    let nearestPointOnRoute: GeoCoordinates = geometry.coordinates[0]!;
    let nearestSegmentIndex = 0;

    // Iterate through every line segment to find the minimum perpendicular/cross-track distance
    for (let i = 0; i < geometry.coordinates.length - 1; i++) {
      const A = geometry.coordinates[i]!;
      const B = geometry.coordinates[i + 1]!;

      // Equirectangular local planar projection
      const meanLatRad = ((A.latitude + B.latitude) / 2) * (Math.PI / 180);
      const cosMeanLat = Math.cos(meanLatRad);

      const dx = (B.longitude - A.longitude) * cosMeanLat;
      const dy = B.latitude - A.latitude;
      const segLenSq = dx * dx + dy * dy;

      let t = 0;
      if (segLenSq > 1e-12) {
        const px = (busCoords.longitude - A.longitude) * cosMeanLat;
        const py = busCoords.latitude - A.latitude;
        t = (px * dx + py * dy) / segLenSq;
        // Clamp projection scalar to line segment bounds [0, 1]
        t = Math.max(0, Math.min(1, t));
      }

      const projLat = A.latitude + t * (B.latitude - A.latitude);
      const projLng = A.longitude + t * (B.longitude - A.longitude);
      const projPoint: GeoCoordinates = { latitude: projLat, longitude: projLng };

      const distMeters = calculateHaversineDistanceMeters(busCoords, projPoint);
      if (distMeters < minDistanceMeters) {
        minDistanceMeters = distMeters;
        nearestPointOnRoute = projPoint;
        nearestSegmentIndex = i;
      }
    }

    // Distance traversed along route up to nearestPointOnRoute
    const distanceBeforeSegment = cumulativeDistances[nearestSegmentIndex] ?? 0;
    const distanceWithinSegment = calculateHaversineDistanceMeters(
      geometry.coordinates[nearestSegmentIndex]!,
      nearestPointOnRoute
    );
    const distanceAlongRoute = distanceBeforeSegment + distanceWithinSegment;

    const isAtRouteEnd =
      nearestSegmentIndex === geometry.coordinates.length - 2 &&
      calculateHaversineDistanceMeters(
        nearestPointOnRoute,
        geometry.coordinates[geometry.coordinates.length - 1]!
      ) < 1;

    const progressPercentage = isAtRouteEnd
      ? 100
      : geometry.totalDistanceMeters > 0
      ? Math.min(100, Math.max(0, Math.round((distanceAlongRoute / geometry.totalDistanceMeters) * 10000) / 100))
      : 0;

    // Nearest stop along route
    let nearestStop: { id: string; name: string; sequenceOrder: number; distanceMeters: number } | null = null;
    let minStopDistance = Infinity;

    for (const stop of geometry.stops) {
      const stopDist = calculateHaversineDistanceMeters(busCoords, {
        latitude: stop.latitude,
        longitude: stop.longitude,
      });
      if (stopDist < minStopDistance) {
        minStopDistance = stopDist;
        nearestStop = {
          id: stop.id,
          name: stop.name,
          sequenceOrder: stop.sequenceOrder,
          distanceMeters: Math.round(stopDist * 100) / 100,
        };
      }
    }

    const roundedDistanceToRoute = Math.round(minDistanceMeters * 100) / 100;
    const isDeviated = roundedDistanceToRoute > threshold;

    return {
      isOnRoute: !isDeviated,
      isDeviated,
      distanceToRouteMeters: roundedDistanceToRoute,
      deviationThresholdMeters: threshold,
      nearestPointOnRoute: {
        latitude: Math.round(nearestPointOnRoute.latitude * 1e6) / 1e6,
        longitude: Math.round(nearestPointOnRoute.longitude * 1e6) / 1e6,
      },
      nearestSegmentIndex,
      nearestStop,
      progressPercentage,
    };
  }

  /**
   * Retrieve real-time relative route position for an active trip
   */
  static async getTripRoutePosition(
    tripId: string,
    options?: { deviationThresholdMeters?: number },
    client?: PoolClient | Pool
  ): Promise<TripRoutePositionResponse> {
    // 1. Fetch trip and latest bus location
    const tripRows = await executeQuery<{
      trip_id: string;
      school_id: string;
      bus_id: string;
      driver_id: string | null;
      route_id: string;
      trip_status: string;
      last_latitude: number | null;
      last_longitude: number | null;
      last_speed_kmh: number | null;
      last_bearing_degrees: number | null;
      last_gps_recorded_at: string | Date | null;
    }>(
      `SELECT
         t.id as trip_id,
         t.school_id,
         t.bus_id,
         t.driver_id,
         t.route_id,
         t.status as trip_status,
         b.last_latitude,
         b.last_longitude,
         b.last_speed_kmh,
         b.last_bearing_degrees,
         b.last_gps_recorded_at
       FROM trips t
       JOIN buses b ON b.id = t.bus_id
       WHERE t.id = $1`,
      [tripId],
      client
    );

    const tripRow = tripRows[0];
    if (!tripRow) {
      throw new NotFoundError(`Trip with ID '${tripId}' not found`);
    }

    let busLat = tripRow.last_latitude != null ? Number(tripRow.last_latitude) : null;
    let busLng = tripRow.last_longitude != null ? Number(tripRow.last_longitude) : null;
    let speedKmh = tripRow.last_speed_kmh != null ? Number(tripRow.last_speed_kmh) : null;
    let bearingDegrees = tripRow.last_bearing_degrees != null ? Number(tripRow.last_bearing_degrees) : null;
    let recordedAt = tripRow.last_gps_recorded_at ? new Date(tripRow.last_gps_recorded_at).toISOString() : null;

    // If bus record has no coordinates yet, check latest point in gps_locations
    if (busLat == null || busLng == null) {
      const gpsRows = await executeQuery<{
        latitude: number;
        longitude: number;
        speed_kmh: number | null;
        bearing_degrees: number | null;
        recorded_at: string | Date;
      }>(
        `SELECT latitude, longitude, speed_kmh, bearing_degrees, recorded_at
         FROM gps_locations
         WHERE trip_id = $1
         ORDER BY recorded_at DESC
         LIMIT 1`,
        [tripId],
        client
      );

      const gpsRow = gpsRows[0];
      if (gpsRow) {
        busLat = Number(gpsRow.latitude);
        busLng = Number(gpsRow.longitude);
        speedKmh = gpsRow.speed_kmh != null ? Number(gpsRow.speed_kmh) : speedKmh;
        bearingDegrees = gpsRow.bearing_degrees != null ? Number(gpsRow.bearing_degrees) : bearingDegrees;
        recordedAt = new Date(gpsRow.recorded_at).toISOString();
      }
    }

    if (busLat == null || busLng == null) {
      throw new BadRequestError(`No GPS location telemetry found for trip '${tripId}'`);
    }

    // 2. Fetch active route deviation if any
    const devRows = await executeQuery<{
      id: string;
      status: string;
      severity: string;
      started_at: string | Date;
      duration_seconds: number;
      max_deviation_distance_meters: number;
      current_deviation_distance_meters: number;
    }>(
      `SELECT id, status, severity, started_at, duration_seconds, max_deviation_distance_meters, current_deviation_distance_meters
       FROM route_deviations
       WHERE trip_id = $1 AND status = 'ACTIVE'
       ORDER BY started_at DESC
       LIMIT 1`,
      [tripId],
      client
    );

    const devRow = devRows[0];
    const activeDeviation = devRow
      ? {
          id: devRow.id,
          status: devRow.status as any,
          severity: devRow.severity as any,
          startedAt: new Date(devRow.started_at).toISOString(),
          durationSeconds: Number(devRow.duration_seconds || 0),
          maxDeviationDistanceMeters: Number(devRow.max_deviation_distance_meters || 0),
          currentDeviationDistanceMeters: Number(devRow.current_deviation_distance_meters || 0),
        }
      : null;

    // 3. Load route geometry
    const geometry = await this.loadRouteGeometry(tripRow.route_id, client);

    // 4. Calculate position relative to route
    const position = this.determineBusPositionRelativeToRoute(
      { latitude: busLat, longitude: busLng },
      geometry,
      options
    );

    if (bearingDegrees != null) {
      position.bearingDegrees = bearingDegrees;
    }

    return {
      tripId: tripRow.trip_id,
      schoolId: tripRow.school_id,
      busId: tripRow.bus_id,
      driverId: tripRow.driver_id ?? null,
      routeId: tripRow.route_id,
      busLocation: {
        latitude: busLat,
        longitude: busLng,
        speedKmh,
        bearingDegrees,
        recordedAt,
      },
      position,
      activeDeviation,
    };
  }

  // ===========================================================================
  // Phase 28.2 — Deviation Detection Engine
  // ===========================================================================

  /**
   * Per-process debounce counters: tripId → consecutive out-of-corridor pings.
   * Resets cleanly on server restart (3 pings ≈ 15–30 sec, safe to lose on restart).
   */
  private static readonly _deviationDebounce = new Map<string, number>();

  /**
   * Per-process return-to-corridor counters: tripId → consecutive in-corridor pings
   * required before auto-resolving an active deviation event.
   */
  private static readonly _resolveDebounce = new Map<string, number>();

  /** Required consecutive pings outside threshold before opening an event. */
  private static readonly OPEN_DEBOUNCE_POINTS = ROUTE_DEVIATION_CONFIG.DEFAULT_DEBOUNCE_POINTS;

  /** Required consecutive pings inside threshold before auto-resolving. */
  private static readonly RESOLVE_DEBOUNCE_POINTS = 2;

  /**
   * Query the active deviation record for a trip, if one exists.
   */
  static async getActiveDeviationForTrip(tripId: string): Promise<ActiveRouteDeviationRecord | null> {
    const rows = await query<{
      id: string;
      school_id: string;
      trip_id: string;
      bus_id: string;
      driver_id: string | null;
      route_id: string;
      status: string;
      severity: string;
      started_at: string | Date;
      resolved_at: string | Date | null;
      duration_seconds: number;
      max_deviation_distance_meters: number;
      current_deviation_distance_meters: number;
      threshold_distance_meters: number;
      debounce_count: number;
      deviation_latitude: number;
      deviation_longitude: number;
      nearest_route_latitude: number | null;
      nearest_route_longitude: number | null;
      nearest_stop_id: string | null;
      school_notified_at: string | Date | null;
      driver_notified_at: string | Date | null;
      notes: string | null;
    }>(
      `SELECT id, school_id, trip_id, bus_id, driver_id, route_id, status, severity,
              started_at, resolved_at, duration_seconds, max_deviation_distance_meters,
              current_deviation_distance_meters, threshold_distance_meters, debounce_count,
              deviation_latitude, deviation_longitude, nearest_route_latitude,
              nearest_route_longitude, nearest_stop_id, school_notified_at,
              driver_notified_at, notes
       FROM route_deviations
       WHERE trip_id = $1 AND status = 'ACTIVE'
       ORDER BY started_at DESC
       LIMIT 1`,
      [tripId]
    );

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      schoolId: row.school_id,
      tripId: row.trip_id,
      busId: row.bus_id,
      driverId: row.driver_id ?? null,
      routeId: row.route_id,
      status: row.status as any,
      severity: row.severity as any,
      startedAt: new Date(row.started_at).toISOString(),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
      durationSeconds: Number(row.duration_seconds),
      maxDeviationDistanceMeters: Number(row.max_deviation_distance_meters),
      currentDeviationDistanceMeters: Number(row.current_deviation_distance_meters),
      thresholdDistanceMeters: Number(row.threshold_distance_meters),
      debounceCount: Number(row.debounce_count),
      deviationLatitude: Number(row.deviation_latitude),
      deviationLongitude: Number(row.deviation_longitude),
      nearestRouteLatitude: row.nearest_route_latitude != null ? Number(row.nearest_route_latitude) : null,
      nearestRouteLongitude: row.nearest_route_longitude != null ? Number(row.nearest_route_longitude) : null,
      nearestStopId: row.nearest_stop_id ?? null,
      schoolNotifiedAt: row.school_notified_at ? new Date(row.school_notified_at).toISOString() : null,
      driverNotifiedAt: row.driver_notified_at ? new Date(row.driver_notified_at).toISOString() : null,
      notes: row.notes ?? null,
    };
  }

  /**
   * List all currently ACTIVE deviation events for a school.
   */
  static async getActiveDeviationsForSchool(schoolId: string): Promise<ActiveRouteDeviationRecord[]> {
    const rows = await query<{
      id: string;
      school_id: string;
      trip_id: string;
      bus_id: string;
      driver_id: string | null;
      route_id: string;
      status: string;
      severity: string;
      started_at: string | Date;
      resolved_at: string | Date | null;
      duration_seconds: number;
      max_deviation_distance_meters: number;
      current_deviation_distance_meters: number;
      threshold_distance_meters: number;
      debounce_count: number;
      deviation_latitude: number;
      deviation_longitude: number;
      nearest_route_latitude: number | null;
      nearest_route_longitude: number | null;
      nearest_stop_id: string | null;
      school_notified_at: string | Date | null;
      driver_notified_at: string | Date | null;
      notes: string | null;
    }>(
      `SELECT id, school_id, trip_id, bus_id, driver_id, route_id, status, severity,
              started_at, resolved_at, duration_seconds, max_deviation_distance_meters,
              current_deviation_distance_meters, threshold_distance_meters, debounce_count,
              deviation_latitude, deviation_longitude, nearest_route_latitude,
              nearest_route_longitude, nearest_stop_id, school_notified_at,
              driver_notified_at, notes
       FROM route_deviations
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
      routeId: row.route_id,
      status: row.status as any,
      severity: row.severity as any,
      startedAt: new Date(row.started_at).toISOString(),
      resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
      durationSeconds: Number(row.duration_seconds),
      maxDeviationDistanceMeters: Number(row.max_deviation_distance_meters),
      currentDeviationDistanceMeters: Number(row.current_deviation_distance_meters),
      thresholdDistanceMeters: Number(row.threshold_distance_meters),
      debounceCount: Number(row.debounce_count),
      deviationLatitude: Number(row.deviation_latitude),
      deviationLongitude: Number(row.deviation_longitude),
      nearestRouteLatitude: row.nearest_route_latitude != null ? Number(row.nearest_route_latitude) : null,
      nearestRouteLongitude: row.nearest_route_longitude != null ? Number(row.nearest_route_longitude) : null,
      nearestStopId: row.nearest_stop_id ?? null,
      schoolNotifiedAt: row.school_notified_at ? new Date(row.school_notified_at).toISOString() : null,
      driverNotifiedAt: row.driver_notified_at ? new Date(row.driver_notified_at).toISOString() : null,
      notes: row.notes ?? null,
    }));
  }

  /**
   * Evaluate the current bus position relative to its expected route on every
   * telemetry ping. Manages debounce counters, opens/updates/resolves
   * route_deviations records, and returns an evaluation summary.
   *
   * Called fire-and-forget from TelemetryService.ingestLocation.
   */
  static async evaluateTripDeviationOnPing(params: {
    tripId: string;
    schoolId: string;
    busId: string;
    driverId: string | null;
    routeId: string;
    busCoords: GeoCoordinates;
    timestamp: string;
  }): Promise<RouteDeviationEvaluationResult> {
    const { tripId, schoolId, busId, driverId, routeId, busCoords, timestamp } = params;

    // 1. Load route geometry
    let geometry: RouteGeometry;
    try {
      geometry = await this.loadRouteGeometry(routeId);
    } catch (err) {
      logger.warn('[RouteDeviation] Could not load route geometry for deviation evaluation', {
        tripId,
        routeId,
        error: String(err),
      });
      return {
        tripId, schoolId, busId, routeId,
        evaluated: false,
        isDeviated: false,
        distanceToRouteMeters: 0,
        deviationThresholdMeters: ROUTE_DEVIATION_CONFIG.DEFAULT_DEVIATION_THRESHOLD_METERS,
        severity: null,
        debounceCount: 0,
        action: 'NONE',
        activeDeviationId: null,
        message: 'Route geometry unavailable; deviation evaluation skipped',
      };
    }

    // 2. Skip if route has no usable coordinates (prevents false positives)
    if (geometry.coordinates.length === 0) {
      return {
        tripId, schoolId, busId, routeId,
        evaluated: false,
        isDeviated: false,
        distanceToRouteMeters: 0,
        deviationThresholdMeters: geometry.deviationThresholdMeters,
        severity: null,
        debounceCount: 0,
        action: 'NONE',
        message: 'Route has no coordinates; deviation evaluation skipped',
      };
    }

    // 3. Geometric position evaluation
    const position = this.determineBusPositionRelativeToRoute(busCoords, geometry);
    const { isDeviated, distanceToRouteMeters } = position;
    const severity = isDeviated ? this.calculateDeviationSeverity(distanceToRouteMeters) : null;

    // 4. Fetch active deviation record for this trip
    const activeEvent = await this.getActiveDeviationForTrip(tripId);

    // =========================================================================
    // Case A: Bus is deviated
    // =========================================================================
    if (isDeviated) {
      this._resolveDebounce.delete(tripId); // reset resolve counter

      if (!activeEvent) {
        // Accumulate debounce counter
        const count = (this._deviationDebounce.get(tripId) ?? 0) + 1;
        this._deviationDebounce.set(tripId, count);

        if (count < this.OPEN_DEBOUNCE_POINTS) {
          logger.info('[RouteDeviation] Deviation debouncing', {
            tripId, count, distanceToRouteMeters, threshold: geometry.deviationThresholdMeters,
          });
          return {
            tripId, schoolId, busId, routeId,
            evaluated: true,
            isDeviated: true,
            distanceToRouteMeters,
            deviationThresholdMeters: geometry.deviationThresholdMeters,
            severity,
            debounceCount: count,
            action: 'DEBOUNCING',
            activeDeviationId: null,
            message: `Debouncing (${count}/${this.OPEN_DEBOUNCE_POINTS}) — waiting for consecutive confirmations`,
          };
        }

        // Debounce threshold reached → open new deviation record
        this._deviationDebounce.delete(tripId);

        const insertRows = await query<{ id: string }>(
          `INSERT INTO route_deviations (
             school_id, trip_id, bus_id, driver_id, route_id,
             status, severity, started_at,
             duration_seconds, max_deviation_distance_meters, current_deviation_distance_meters,
             threshold_distance_meters, debounce_count,
             deviation_latitude, deviation_longitude,
             deviation_location,
             nearest_route_latitude, nearest_route_longitude, nearest_stop_id
           ) VALUES (
             $1, $2, $3, $4, $5,
             'ACTIVE', $6, $7,
             0, $8, $8,
             $9, $10,
             $11, $12,
             ST_SetSRID(ST_MakePoint($12, $11), 4326),
             $13, $14, $15
           ) RETURNING id`,
          [
            schoolId, tripId, busId, driverId ?? null, routeId,
            severity!, timestamp,
            distanceToRouteMeters,
            geometry.deviationThresholdMeters, this.OPEN_DEBOUNCE_POINTS,
            busCoords.latitude, busCoords.longitude,
            position.nearestPointOnRoute.latitude,
            position.nearestPointOnRoute.longitude,
            position.nearestStop?.id ?? null,
          ]
        );

        const newId = insertRows[0]!.id;
        logger.warn('[RouteDeviation] New deviation event opened', {
          tripId, eventId: newId, severity, distanceToRouteMeters,
          lat: busCoords.latitude, lng: busCoords.longitude,
        });

        return {
          tripId, schoolId, busId, routeId,
          evaluated: true,
          isDeviated: true,
          distanceToRouteMeters,
          deviationThresholdMeters: geometry.deviationThresholdMeters,
          severity,
          debounceCount: this.OPEN_DEBOUNCE_POINTS,
          action: 'OPENED',
          activeDeviationId: newId,
          message: `Route deviation event opened (severity: ${severity}, distance: ${distanceToRouteMeters}m)`,
        };
      }

      // Active event already exists → update it
      const nowSec = Math.floor((Date.now() - new Date(activeEvent.startedAt).getTime()) / 1000);
      const newMax = Math.max(activeEvent.maxDeviationDistanceMeters, distanceToRouteMeters);
      const upgradedSeverity = this.calculateDeviationSeverity(newMax);

      await query(
        `UPDATE route_deviations SET
           current_deviation_distance_meters = $1,
           max_deviation_distance_meters = $2,
           duration_seconds = $3,
           severity = $4,
           deviation_latitude = $5,
           deviation_longitude = $6,
           deviation_location = ST_SetSRID(ST_MakePoint($6, $5), 4326),
           nearest_route_latitude = $7,
           nearest_route_longitude = $8,
           nearest_stop_id = $9,
           updated_at = NOW()
         WHERE id = $10`,
        [
          distanceToRouteMeters,
          newMax,
          nowSec,
          upgradedSeverity,
          busCoords.latitude,
          busCoords.longitude,
          position.nearestPointOnRoute.latitude,
          position.nearestPointOnRoute.longitude,
          position.nearestStop?.id ?? null,
          activeEvent.id,
        ]
      );

      logger.info('[RouteDeviation] Active deviation event updated', {
        tripId, eventId: activeEvent.id, severity: upgradedSeverity,
        distanceToRouteMeters, durationSeconds: nowSec,
      });

      return {
        tripId, schoolId, busId, routeId,
        evaluated: true,
        isDeviated: true,
        distanceToRouteMeters,
        deviationThresholdMeters: geometry.deviationThresholdMeters,
        severity: upgradedSeverity,
        debounceCount: 0,
        action: 'UPDATED',
        activeDeviationId: activeEvent.id,
        message: `Active deviation updated (severity: ${upgradedSeverity}, max: ${newMax}m, duration: ${nowSec}s)`,
      };
    }

    // =========================================================================
    // Case B: Bus is back on route
    // =========================================================================
    this._deviationDebounce.delete(tripId);

    if (!activeEvent) {
      // Healthy — nothing to do
      return {
        tripId, schoolId, busId, routeId,
        evaluated: true,
        isDeviated: false,
        distanceToRouteMeters,
        deviationThresholdMeters: geometry.deviationThresholdMeters,
        severity: null,
        debounceCount: 0,
        action: 'NONE',
        message: 'Bus is on route; no active deviation event',
      };
    }

    // Active event exists but bus is back in corridor — apply resolve debounce
    const resolveCount = (this._resolveDebounce.get(tripId) ?? 0) + 1;
    this._resolveDebounce.set(tripId, resolveCount);

    if (resolveCount < this.RESOLVE_DEBOUNCE_POINTS) {
      logger.info('[RouteDeviation] On-route return debouncing before resolve', {
        tripId, resolveCount,
      });
      return {
        tripId, schoolId, busId, routeId,
        evaluated: true,
        isDeviated: false,
        distanceToRouteMeters,
        deviationThresholdMeters: geometry.deviationThresholdMeters,
        severity: null,
        debounceCount: resolveCount,
        action: 'DEBOUNCING',
        activeDeviationId: activeEvent.id,
        message: `Return debouncing (${resolveCount}/${this.RESOLVE_DEBOUNCE_POINTS}) before resolving deviation`,
      };
    }

    // Resolve the deviation event
    this._resolveDebounce.delete(tripId);
    const finalDuration = Math.floor((Date.now() - new Date(activeEvent.startedAt).getTime()) / 1000);

    await query(
      `UPDATE route_deviations SET
         status = 'RESOLVED',
         resolved_at = NOW(),
         duration_seconds = $1,
         current_deviation_distance_meters = $2,
         updated_at = NOW()
       WHERE id = $3`,
      [finalDuration, distanceToRouteMeters, activeEvent.id]
    );

    logger.info('[RouteDeviation] Deviation event auto-resolved', {
      tripId, eventId: activeEvent.id, durationSeconds: finalDuration,
      maxDeviationDistanceMeters: activeEvent.maxDeviationDistanceMeters,
    });

    return {
      tripId, schoolId, busId, routeId,
      evaluated: true,
      isDeviated: false,
      distanceToRouteMeters,
      deviationThresholdMeters: geometry.deviationThresholdMeters,
      severity: null,
      debounceCount: 0,
      action: 'RESOLVED',
      activeDeviationId: activeEvent.id,
      message: `Deviation auto-resolved after ${finalDuration}s (max distance: ${activeEvent.maxDeviationDistanceMeters}m)`,
    };
  }
}
