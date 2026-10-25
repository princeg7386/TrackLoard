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
}
