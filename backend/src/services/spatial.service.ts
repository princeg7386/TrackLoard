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
}
