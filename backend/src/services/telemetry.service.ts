import { query, transaction } from '../config/database.js';
import {
  TelemetryIngestPayload,
  GpsLocationRecord,
} from '@school-bus/shared';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
} from '../middlewares/error.middleware.js';
import { GpsHealthService } from './gps-health.service.js';
import { logger } from './logger.service.js';

export interface TelemetryIngestResult {
  ingestedCount: number;
  duplicatesSkipped: number;
  latestLocation: {
    tripId: string;
    busId: string;
    driverId: string;
    latitude: number;
    longitude: number;
    speedKmh: number;
    batteryPercentage?: number;
    isCharging?: boolean;
    networkType?: string;
    recordedAt: string;
  };
}

export class TelemetryService {
  /**
   * Ingest a single GPS location ping from mobile driver app with idempotent deduplication
   */
  static async ingestLocation(
    payload: TelemetryIngestPayload,
    authenticatedDriverId?: string
  ): Promise<GpsLocationRecord> {
    // If driver authentication is provided, ensure payload matches driver identity
    if (authenticatedDriverId && payload.driverId !== authenticatedDriverId) {
      throw new ForbiddenError('Driver ID in telemetry payload does not match authenticated session');
    }

    // Verify trip exists and is assigned to the specified bus and driver
    const tripRows = await query<{
      id: string;
      school_id: string;
      bus_id: string;
      driver_id: string;
      status: string;
    }>(
      `SELECT id, school_id, bus_id, driver_id, status 
       FROM trips 
       WHERE id = $1 LIMIT 1;`,
      [payload.tripId]
    );

    const trip = tripRows[0];
    if (!trip) {
      throw new NotFoundError('Trip specified in telemetry ping not found');
    }

    if (trip.bus_id !== payload.busId) {
      throw new ForbiddenError('Bus ID does not match the active trip assignment');
    }

    if (trip.driver_id !== payload.driverId) {
      throw new ForbiddenError('Driver ID does not match the active trip assignment');
    }

    // Insert into gps_locations with ON CONFLICT (trip_id, recorded_at) DO NOTHING
    const resultRows = await query<{
      id: string;
      trip_id: string;
      bus_id: string;
      driver_id: string;
      latitude: number;
      longitude: number;
      speed_kmh: number;
      bearing_degrees: number | null;
      accuracy_meters: number | null;
      battery_percentage: number | null;
      is_charging: boolean | null;
      network_type: string | null;
      recorded_at: string;
      created_at: string;
    }>(
      `INSERT INTO gps_locations (
        trip_id,
        bus_id,
        driver_id,
        latitude,
        longitude,
        location,
        speed_kmh,
        bearing_degrees,
        accuracy_meters,
        battery_percentage,
        is_charging,
        network_type,
        recorded_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        ST_SetSRID(ST_MakePoint($5, $4), 4326),
        $6, $7, $8, $9, $10, $11, $12
      )
      ON CONFLICT (trip_id, recorded_at) DO UPDATE
      SET 
        speed_kmh = EXCLUDED.speed_kmh,
        battery_percentage = COALESCE(EXCLUDED.battery_percentage, gps_locations.battery_percentage),
        network_type = COALESCE(EXCLUDED.network_type, gps_locations.network_type)
      RETURNING 
        id,
        trip_id as "tripId",
        bus_id as "busId",
        driver_id as "driverId",
        latitude,
        longitude,
        speed_kmh as "speedKmh",
        bearing_degrees as "bearingDegrees",
        accuracy_meters as "accuracyMeters",
        battery_percentage as "batteryPercentage",
        is_charging as "isCharging",
        network_type as "networkType",
        recorded_at as "recordedAt",
        created_at as "createdAt";`,
      [
        payload.tripId,
        payload.busId,
        payload.driverId,
        payload.latitude,
        payload.longitude,
        payload.speedKmh ?? 0,
        payload.bearingDegrees ?? 0,
        payload.accuracyMeters ?? null,
        payload.batteryPercentage ?? null,
        payload.isCharging ?? false,
        payload.networkType ?? 'CELLULAR',
        payload.recordedAt,
      ]
    );

    const inserted = resultRows[0]!;

    // Refresh bus latest location cache & GPS health state
    const healthStatus = GpsHealthService.calculateHealthStatus({
      accuracyMeters: payload.accuracyMeters,
      recordedAt: payload.recordedAt,
      isOnline: payload.networkType !== 'OFFLINE',
      hasActiveTrip: true,
    });

    await query(
      `UPDATE buses 
       SET last_latitude = $1,
           last_longitude = $2,
           last_location = ST_SetSRID(ST_MakePoint($2, $1), 4326),
           last_speed_kmh = $3,
           last_accuracy_meters = $4,
           last_bearing_degrees = $5,
           last_battery_percentage = $6,
           last_is_charging = $7,
           last_network_type = $8,
           last_gps_recorded_at = $9,
           gps_health_status = $10,
           updated_at = NOW()
       WHERE id = $11
         AND (last_gps_recorded_at IS NULL OR last_gps_recorded_at <= $9);`,
      [
        payload.latitude,
        payload.longitude,
        payload.speedKmh ?? 0,
        payload.accuracyMeters ?? null,
        payload.bearingDegrees ?? null,
        payload.batteryPercentage ?? null,
        payload.isCharging ?? false,
        payload.networkType ?? 'CELLULAR',
        payload.recordedAt,
        healthStatus,
        payload.busId,
      ]
    );

    logger.debug('GPS telemetry ping ingested', {
      tripId: payload.tripId,
      busId: payload.busId,
      lat: payload.latitude,
      lng: payload.longitude,
      speed: payload.speedKmh,
    });

    return {
      id: parseInt(inserted.id, 10),
      tripId: inserted.tripId,
      busId: inserted.busId,
      driverId: inserted.driverId,
      latitude: Number(inserted.latitude),
      longitude: Number(inserted.longitude),
      speedKmh: Number(inserted.speedKmh),
      bearingDegrees: inserted.bearingDegrees != null ? Number(inserted.bearingDegrees) : undefined,
      accuracyMeters: inserted.accuracyMeters != null ? Number(inserted.accuracyMeters) : undefined,
      batteryPercentage: inserted.batteryPercentage != null ? Number(inserted.batteryPercentage) : undefined,
      isCharging: inserted.isCharging != null ? Boolean(inserted.isCharging) : undefined,
      networkType: (inserted.networkType as any) ?? 'CELLULAR',
      recordedAt: new Date(inserted.recordedAt).toISOString(),
      createdAt: new Date(inserted.createdAt).toISOString(),
    };
  }

  /**
   * Ingest a batch of offline-buffered GPS telemetry pings with deduplication
   */
  static async ingestBatch(
    locations: TelemetryIngestPayload[],
    authenticatedDriverId?: string
  ): Promise<TelemetryIngestResult> {
    if (locations.length === 0) {
      return {
        ingestedCount: 0,
        duplicatesSkipped: 0,
        latestLocation: {} as any,
      };
    }

    // Deduplicate on client-sent timestamps in memory first
    const uniqueMap = new Map<string, TelemetryIngestPayload>();
    for (const loc of locations) {
      const key = `${loc.tripId}:${loc.recordedAt}`;
      uniqueMap.set(key, loc);
    }
    const deduplicated = Array.from(uniqueMap.values());
    const duplicatesSkipped = locations.length - deduplicated.length;

    // Sort chronologically
    const sorted = [...deduplicated].sort(
      (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
    );

    let ingestedCount = 0;

    await transaction(async (client) => {
      for (const loc of sorted) {
        if (authenticatedDriverId && loc.driverId !== authenticatedDriverId) {
          throw new ForbiddenError('Driver ID in batch item does not match authenticated session');
        }

        const res = await client.query(
          `INSERT INTO gps_locations (
            trip_id,
            bus_id,
            driver_id,
            latitude,
            longitude,
            location,
            speed_kmh,
            bearing_degrees,
            accuracy_meters,
            battery_percentage,
            is_charging,
            network_type,
            recorded_at
          ) VALUES (
            $1, $2, $3, $4, $5,
            ST_SetSRID(ST_MakePoint($5, $4), 4326),
            $6, $7, $8, $9, $10, $11, $12
          )
          ON CONFLICT (trip_id, recorded_at) DO NOTHING
          RETURNING id;`,
          [
            loc.tripId,
            loc.busId,
            loc.driverId,
            loc.latitude,
            loc.longitude,
            loc.speedKmh ?? 0,
            loc.bearingDegrees ?? 0,
            loc.accuracyMeters ?? null,
            loc.batteryPercentage ?? null,
            loc.isCharging ?? false,
            loc.networkType ?? 'CELLULAR',
            loc.recordedAt,
          ]
        );
        if (res.rowCount && res.rowCount > 0) {
          ingestedCount++;
        }
      }

      // Group latest point by busId to refresh bus cache
      const busLatestMap = new Map<string, TelemetryIngestPayload>();
      for (const loc of sorted) {
        busLatestMap.set(loc.busId, loc);
      }

      for (const [busId, latestLoc] of busLatestMap.entries()) {
        const healthStatus = GpsHealthService.calculateHealthStatus({
          accuracyMeters: latestLoc.accuracyMeters,
          recordedAt: latestLoc.recordedAt,
          isOnline: latestLoc.networkType !== 'OFFLINE',
          hasActiveTrip: true,
        });

        await client.query(
          `UPDATE buses 
           SET last_latitude = $1,
               last_longitude = $2,
               last_location = ST_SetSRID(ST_MakePoint($2, $1), 4326),
               last_speed_kmh = $3,
               last_accuracy_meters = $4,
               last_bearing_degrees = $5,
               last_battery_percentage = $6,
               last_is_charging = $7,
               last_network_type = $8,
               last_gps_recorded_at = $9,
               gps_health_status = $10,
               updated_at = NOW()
           WHERE id = $11
             AND (last_gps_recorded_at IS NULL OR last_gps_recorded_at <= $9);`,
          [
            latestLoc.latitude,
            latestLoc.longitude,
            latestLoc.speedKmh ?? 0,
            latestLoc.accuracyMeters ?? null,
            latestLoc.bearingDegrees ?? null,
            latestLoc.batteryPercentage ?? null,
            latestLoc.isCharging ?? false,
            latestLoc.networkType ?? 'CELLULAR',
            latestLoc.recordedAt,
            healthStatus,
            busId,
          ]
        );
      }
    });

    const latest = sorted[sorted.length - 1]!;

    logger.info('Batch GPS telemetry ingested successfully', {
      batchSize: locations.length,
      ingestedCount,
      duplicatesSkipped,
      tripId: latest.tripId,
      busId: latest.busId,
    });

    return {
      ingestedCount,
      duplicatesSkipped,
      latestLocation: {
        tripId: latest.tripId,
        busId: latest.busId,
        driverId: latest.driverId,
        latitude: latest.latitude,
        longitude: latest.longitude,
        speedKmh: latest.speedKmh ?? 0,
        batteryPercentage: latest.batteryPercentage,
        isCharging: latest.isCharging,
        networkType: latest.networkType,
        recordedAt: latest.recordedAt,
      },
    };
  }

  /**
   * Get the most recent GPS location for a bus
   */
  static async getLatestBusLocation(busId: string) {
    const rows = await query<{
      id: string;
      trip_id: string;
      bus_id: string;
      driver_id: string;
      latitude: number;
      longitude: number;
      speed_kmh: number;
      bearing_degrees: number | null;
      accuracy_meters: number | null;
      battery_percentage: number | null;
      is_charging: boolean | null;
      network_type: string | null;
      recorded_at: string;
      created_at: string;
    }>(
      `SELECT 
        id,
        trip_id as "tripId",
        bus_id as "busId",
        driver_id as "driverId",
        latitude,
        longitude,
        speed_kmh as "speedKmh",
        bearing_degrees as "bearingDegrees",
        accuracy_meters as "accuracyMeters",
        battery_percentage as "batteryPercentage",
        is_charging as "isCharging",
        network_type as "networkType",
        recorded_at as "recordedAt",
        created_at as "createdAt"
       FROM gps_locations
       WHERE bus_id = $1
       ORDER BY recorded_at DESC
       LIMIT 1;`,
      [busId]
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0]!;
    return {
      id: parseInt(row.id, 10),
      tripId: row.tripId,
      busId: row.busId,
      driverId: row.driverId,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      speedKmh: Number(row.speedKmh),
      bearingDegrees: row.bearingDegrees != null ? Number(row.bearingDegrees) : undefined,
      accuracyMeters: row.accuracyMeters != null ? Number(row.accuracyMeters) : undefined,
      batteryPercentage: row.batteryPercentage != null ? Number(row.batteryPercentage) : undefined,
      isCharging: row.isCharging != null ? Boolean(row.isCharging) : undefined,
      networkType: row.networkType ?? 'CELLULAR',
      recordedAt: new Date(row.recordedAt).toISOString(),
    };
  }

  /**
   * Get location trail points for a trip
   */
  static async getTripLocationTrail(tripId: string, limit: number = 200) {
    const rows = await query<{
      id: string;
      latitude: number;
      longitude: number;
      speed_kmh: number;
      bearing_degrees: number | null;
      accuracy_meters: number | null;
      battery_percentage: number | null;
      recorded_at: string;
    }>(
      `SELECT 
        id,
        latitude,
        longitude,
        speed_kmh as "speedKmh",
        bearing_degrees as "bearingDegrees",
        accuracy_meters as "accuracyMeters",
        battery_percentage as "batteryPercentage",
        recorded_at as "recordedAt"
       FROM gps_locations
       WHERE trip_id = $1
       ORDER BY recorded_at ASC
       LIMIT $2;`,
      [tripId, limit]
    );

    return rows.map((row) => ({
      id: parseInt(row.id, 10),
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      speedKmh: Number(row.speedKmh),
      bearingDegrees: row.bearingDegrees != null ? Number(row.bearingDegrees) : undefined,
      accuracyMeters: row.accuracyMeters != null ? Number(row.accuracyMeters) : undefined,
      batteryPercentage: row.batteryPercentage != null ? Number(row.batteryPercentage) : undefined,
      recordedAt: new Date(row.recordedAt).toISOString(),
    }));
  }
}
