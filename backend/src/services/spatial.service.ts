import { query } from '../config/database.js';
import {
  GeoCoordinates,
  TelemetryIngestPayload,
  calculateHaversineDistanceMeters,
} from '@school-bus/shared';

export interface NearbyStopResult {
  id: string;
  stopName: string;
  sequenceOrder: number;
  latitude: number;
  longitude: number;
  scheduledTime: string;
  geofenceRadiusMeters: number;
  distanceMeters: number;
  isWithinGeofence: boolean;
}

export class SpatialService {
  /**
   * Inserts GPS coordinate point into PostGIS database using ST_SetSRID and ST_MakePoint
   */
  static async recordGpsTelemetry(
    payload: TelemetryIngestPayload
  ): Promise<{ id: number; inserted: boolean }> {
    const sql = `
      INSERT INTO gps_locations (
        trip_id,
        bus_id,
        driver_id,
        latitude,
        longitude,
        location,
        speed_kmh,
        bearing_degrees,
        accuracy_meters,
        recorded_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography,
        $6, $7, $8, $9
      )
      RETURNING id;
    `;

    const rows = await query<{ id: number }>(sql, [
      payload.tripId,
      payload.busId,
      payload.driverId,
      payload.latitude,
      payload.longitude,
      payload.speedKmh || 0,
      payload.bearingDegrees || 0,
      payload.accuracyMeters || null,
      payload.recordedAt,
    ]);

    return {
      id: Number(rows[0]?.id),
      inserted: rows.length > 0,
    };
  }

  /**
   * Performs PostGIS ST_DWithin and ST_Distance spatial query to find stops within geofence distance
   */
  static async findStopsNearCoordinates(
    tripId: string,
    coords: GeoCoordinates,
    searchRadiusMeters: number = 1000
  ): Promise<NearbyStopResult[]> {
    const sql = `
      SELECT 
        p.id,
        p.stop_name as "stopName",
        p.sequence_order as "sequenceOrder",
        p.latitude,
        p.longitude,
        p.scheduled_time::text as "scheduledTime",
        p.geofence_radius_meters as "geofenceRadiusMeters",
        ROUND(ST_Distance(
          p.location, 
          ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography
        )::numeric, 1)::float as "distanceMeters",
        ST_DWithin(
          p.location, 
          ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, 
          p.geofence_radius_meters
        ) as "isWithinGeofence"
      FROM trips t
      JOIN routes r ON t.route_id = r.id
      JOIN pickup_locations p ON p.route_id = r.id
      WHERE t.id = $1
        AND ST_DWithin(
          p.location, 
          ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, 
          $4
        )
      ORDER BY p.sequence_order ASC;
    `;

    return await query<NearbyStopResult>(sql, [
      tripId,
      coords.latitude,
      coords.longitude,
      searchRadiusMeters,
    ]);
  }

  /**
   * Generates PostGIS SQL for Point geography creation
   */
  static toGeographyPointSql(lat: number, lng: number): string {
    return `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
  }

  /**
   * Evaluates geofence status in-memory as a high-speed fallback or pre-check
   */
  static checkGeofenceInMemory(
    busCoords: GeoCoordinates,
    stopCoords: GeoCoordinates,
    radiusMeters: number = 300
  ): { isInside: boolean; distanceMeters: number } {
    const distanceMeters = calculateHaversineDistanceMeters(busCoords, stopCoords);
    return {
      isInside: distanceMeters <= radiusMeters,
      distanceMeters,
    };
  }

  /**
   * Point-in-Polygon check using the ray-casting algorithm.
   * Tests whether a GPS point (latitude, longitude) is inside an arbitrary polygon boundary.
   */
  static isPointInPolygon(point: GeoCoordinates, polygon: GeoCoordinates[]): boolean {
    if (!polygon || polygon.length < 3) {
      return false;
    }

    let inside = false;
    const px = point.longitude;
    const py = point.latitude;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i]!.longitude;
      const yi = polygon[i]!.latitude;
      const xj = polygon[j]!.longitude;
      const yj = polygon[j]!.latitude;

      const intersect =
        yi > py !== yj > py &&
        px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;

      if (intersect) {
        inside = !inside;
      }
    }

    return inside;
  }

  /**
   * Generates PostGIS SQL for Polygon geography creation from coordinate vertices.
   * Auto-closes the polygon ring if the first and last vertices differ.
   */
  static toGeographyPolygonSql(coords: GeoCoordinates[]): string {
    if (!coords || coords.length < 3) {
      throw new Error('Polygon must contain at least 3 vertices');
    }
    const closed = [...coords];
    const first = closed[0]!;
    const last = closed[closed.length - 1]!;
    if (first.latitude !== last.latitude || first.longitude !== last.longitude) {
      closed.push(first);
    }
    const wktPoints = closed.map((c) => `${c.longitude} ${c.latitude}`).join(', ');
    return `ST_SetSRID(ST_GeogFromText('POLYGON((${wktPoints}))'), 4326)`;
  }

  /**
   * Evaluates whether a coordinate point is inside a stop geofence,
   * supporting both circular radius and custom polygon boundaries.
   */
  static isPointInGeofenceShape(
    busCoords: GeoCoordinates,
    stop: {
      latitude: number;
      longitude: number;
      geofenceType?: string | null;
      geofenceRadiusMeters?: number | null;
      geofencePolygon?: GeoCoordinates[] | null;
    }
  ): { isInside: boolean; distanceMeters: number } {
    const distanceMeters = calculateHaversineDistanceMeters(busCoords, {
      latitude: stop.latitude,
      longitude: stop.longitude,
    });

    if (
      stop.geofenceType === 'POLYGON' &&
      Array.isArray(stop.geofencePolygon) &&
      stop.geofencePolygon.length >= 3
    ) {
      const isInside = SpatialService.isPointInPolygon(busCoords, stop.geofencePolygon);
      return { isInside, distanceMeters };
    }

    const radius = stop.geofenceRadiusMeters ?? 300;
    return {
      isInside: distanceMeters <= radius,
      distanceMeters,
    };
  }
}


