import { query, transaction } from '../config/database.js';
import {
  TelemetryIngestPayload,
  GpsLocationRecord,
  TelemetryFeedEvent,
} from '@school-bus/shared';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
} from '../middlewares/error.middleware.js';
import { GpsHealthService } from './gps-health.service.js';
import { RealtimeFeedService } from './realtime-feed.service.js';
import { EtaRefreshService } from './eta-refresh.service.js';
import { GeofenceNotificationService } from './geofence-notification.service.js';
import { GeofenceService } from './geofence.service.js';
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
   * Validate that GPS recorded timestamp is not in the future and not older than 24 hours
   */
  static validateTimestamp(recordedAt: string): void {
    const recordedTime = new Date(recordedAt).getTime();
    if (isNaN(recordedTime)) {
      throw new BadRequestError('Invalid recordedAt timestamp');
    }

    const now = Date.now();
    const maxFutureSkewMs = 5 * 60 * 1000; // Allow 5 minutes clock skew
    if (recordedTime > now + maxFutureSkewMs) {
      throw new BadRequestError('Telemetry recordedAt timestamp cannot be in the future');
    }

    const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours maximum historical age
    if (now - recordedTime > maxAgeMs) {
      throw new BadRequestError('Telemetry ping is too old (> 24 hours)');
    }
  }

  /**
   * Validate coordinate bounds and realistic kinematic limits
   */
  static validateKinematics(payload: {
    speedKmh?: number | null;
    latitude: number;
    longitude: number;
  }): void {
    if (payload.speedKmh != null && payload.speedKmh > 160) {
      throw new BadRequestError('Telemetry speed exceeds realistic vehicle threshold (> 160 km/h)');
    }
    if (payload.latitude < -90 || payload.latitude > 90) {
      throw new BadRequestError('Latitude out of valid geographic range [-90, 90]');
    }
    if (payload.longitude < -180 || payload.longitude > 180) {
      throw new BadRequestError('Longitude out of valid geographic range [-180, 180]');
    }
  }

  /**
   * Ingest a single GPS location ping from mobile driver app with idempotent deduplication
   */
  static async ingestLocation(
    payload: TelemetryIngestPayload,
    authenticatedDriverId?: string
  ): Promise<GpsLocationRecord> {
    // 1. Source & Kinematic validation
    this.validateTimestamp(payload.recordedAt);
    this.validateKinematics(payload);

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

    // Validate trip lifecycle: reject finished or cancelled trips
    if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED') {
      throw new BadRequestError(`Cannot ingest telemetry for a trip that is ${trip.status.toLowerCase()}`);
    }

    // Insert into gps_locations with ON CONFLICT (trip_id, recorded_at) DO NOTHING
    const resultRows = await query<{
      id: string;
      tripId: string;
      busId: string;
      driverId: string;
      latitude: number;
      longitude: number;
      speedKmh: number;
      bearingDegrees: number | null;
      accuracyMeters: number | null;
      batteryPercentage: number | null;
      isCharging: boolean | null;
      networkType: string | null;
      recordedAt: string;
      createdAt: string;
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

    // 3. Broadcast real-time feed event (SSE / Pub-Sub)
    RealtimeFeedService.publish({
      type: 'LOCATION_UPDATE',
      schoolId: trip.school_id,
      busId: payload.busId,
      tripId: payload.tripId,
      latitude: payload.latitude,
      longitude: payload.longitude,
      speedKmh: payload.speedKmh ?? 0,
      bearingDegrees: payload.bearingDegrees ?? null,
      accuracyMeters: payload.accuracyMeters ?? null,
      batteryPercentage: payload.batteryPercentage ?? null,
      isCharging: payload.isCharging ?? false,
      networkType: payload.networkType ?? 'CELLULAR',
      healthStatus,
      recordedAt: new Date(payload.recordedAt).toISOString(),
      timestamp: new Date().toISOString(),
    });

    // 4. Phase 20.3 — Fire-and-forget ETA refresh (non-blocking, errors are swallowed)
    EtaRefreshService.scheduleRefresh({
      tripId: payload.tripId,
      schoolId: trip.school_id,
      busId: payload.busId,
      speedKmh: payload.speedKmh ?? 0,
      healthStatus,
      latitude: payload.latitude,
      longitude: payload.longitude,
      recordedAt: new Date(payload.recordedAt).toISOString(),
    });

    // 5. Phase 21.1 — Fire-and-forget geofence approach notifications (non-blocking)
    GeofenceNotificationService.checkAndNotify(
      payload.tripId,
      { latitude: payload.latitude, longitude: payload.longitude }
    ).catch((err: unknown) => {
      logger.warn('GeofenceNotificationService.checkAndNotify error (suppressed)', {
        tripId: payload.tripId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // 6. Phase 21.1, 21.2 & 21.3 — Geofence Entry/Exit/DWELL & School Arrival (fire-and-forget, non-blocking)
    GeofenceService.evaluateTripStops({
      tripId: payload.tripId,
      schoolId: trip.school_id,
      busId: payload.busId,
      latitude: payload.latitude,
      longitude: payload.longitude,
      recordedAt: new Date(payload.recordedAt),
      emitDwellEvents: true,
      triggerWorkflows: true,
    }).catch((err: unknown) => {
      logger.warn('GeofenceService.evaluateTripStops error (suppressed)', {
        tripId: payload.tripId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    GeofenceService.evaluateSchoolArrival({
      tripId: payload.tripId,
      schoolId: trip.school_id,
      busId: payload.busId,
      latitude: payload.latitude,
      longitude: payload.longitude,
      recordedAt: new Date(payload.recordedAt),
    }).catch((err: unknown) => {
      logger.warn('GeofenceService.evaluateSchoolArrival error (suppressed)', {
        tripId: payload.tripId,
        error: err instanceof Error ? err.message : String(err),
      });
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

    // Deduplicate on client-sent timestamps in memory first, filtering out invalid points
    const uniqueMap = new Map<string, TelemetryIngestPayload>();
    for (const loc of locations) {
      try {
        this.validateTimestamp(loc.recordedAt);
        this.validateKinematics(loc);
      } catch (err: any) {
        logger.warn('Skipping invalid telemetry point in offline batch', {
          tripId: loc.tripId,
          recordedAt: loc.recordedAt,
          reason: err.message,
        });
        continue;
      }
      const key = `${loc.tripId}:${loc.recordedAt}`;
      uniqueMap.set(key, loc);
    }

    if (uniqueMap.size === 0 && locations.length > 0) {
      throw new BadRequestError('All telemetry points in batch failed kinematic or timestamp validation');
    }

    const deduplicated = Array.from(uniqueMap.values());
    const duplicatesSkipped = locations.length - deduplicated.length;

    // Sort chronologically
    const sorted = [...deduplicated].sort(
      (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
    );

    let ingestedCount = 0;
    const tripSchoolMap = new Map<string, string>();

    await transaction(async (client) => {
      // Validate all unique trips in batch: fetch bus_id and driver_id to enforce assignment.
      // Throw NotFoundError (not skip) when a tripId does not exist — unknown trips must be
      // rejected so the app does not retry the same broken batch forever.
      const tripIds = Array.from(new Set(sorted.map((s) => s.tripId)));
      const tripMap = new Map<string, { id: string; school_id: string; bus_id: string; driver_id: string; status: string }>();

      for (const tripId of tripIds) {
        const tripRes = await client.query<{ id: string; school_id: string; bus_id: string; driver_id: string; status: string }>(
          `SELECT id, school_id, bus_id, driver_id, status FROM trips WHERE id = $1 LIMIT 1;`,
          [tripId]
        );
        const trip = tripRes.rows[0];
        if (!trip) {
          throw new NotFoundError(`Trip ${tripId} not found — cannot ingest telemetry for an unknown trip`);
        }
        if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED') {
          throw new BadRequestError(`Cannot ingest telemetry for trip ${tripId} which is ${trip.status.toLowerCase()}`);
        }
        if (authenticatedDriverId && trip.driver_id !== authenticatedDriverId) {
          throw new ForbiddenError(`Authenticated driver is not assigned to trip ${tripId}`);
        }
        tripMap.set(tripId, trip);
        tripSchoolMap.set(tripId, trip.school_id);
      }

      for (const loc of sorted) {
        if (authenticatedDriverId && loc.driverId !== authenticatedDriverId) {
          throw new ForbiddenError('Driver ID in batch item does not match authenticated session');
        }

        const trip = tripMap.get(loc.tripId);
        if (!trip) {
          throw new NotFoundError(`Trip ${loc.tripId} not found`);
        }
        if (trip.bus_id !== loc.busId) {
          throw new ForbiddenError(
            `Bus ID ${loc.busId} does not match trip ${loc.tripId} assignment (assigned bus: ${trip.bus_id})`
          );
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

        // Broadcast real-time feed event
        const schoolId = tripSchoolMap.get(latestLoc.tripId) ?? '';
        RealtimeFeedService.publish({
          type: 'LOCATION_UPDATE',
          schoolId,
          busId,
          tripId: latestLoc.tripId,
          latitude: latestLoc.latitude,
          longitude: latestLoc.longitude,
          speedKmh: latestLoc.speedKmh ?? 0,
          bearingDegrees: latestLoc.bearingDegrees ?? null,
          accuracyMeters: latestLoc.accuracyMeters ?? null,
          batteryPercentage: latestLoc.batteryPercentage ?? null,
          isCharging: latestLoc.isCharging ?? false,
          networkType: latestLoc.networkType ?? 'CELLULAR',
          healthStatus,
          recordedAt: new Date(latestLoc.recordedAt).toISOString(),
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Phase 20.3 — Fire-and-forget ETA refresh per unique trip in the batch.
    // We use the *latest* ping per trip (chronologically last in `sorted`) to
    // provide the most up-to-date speed and position to the refresh service.
    const latestPerTrip = new Map<string, typeof sorted[0]>();
    for (const loc of sorted) {
      latestPerTrip.set(loc.tripId, loc);
    }
    for (const [tripId, loc] of latestPerTrip.entries()) {
      const schoolId = tripSchoolMap.get(tripId) ?? '';
      const batchHealthStatus = GpsHealthService.calculateHealthStatus({
        accuracyMeters: loc.accuracyMeters,
        recordedAt: loc.recordedAt,
        isOnline: loc.networkType !== 'OFFLINE',
        hasActiveTrip: true,
      });
      EtaRefreshService.scheduleRefresh({
        tripId,
        schoolId,
        busId: loc.busId,
        speedKmh: loc.speedKmh ?? 0,
        healthStatus: batchHealthStatus,
        latitude: loc.latitude,
        longitude: loc.longitude,
        recordedAt: new Date(loc.recordedAt).toISOString(),
      });
    }

    // Phase 21.1, 21.2 & 21.3 — Geofence Entry/Exit/DWELL & School Arrival for batch telemetry points
    for (const loc of sorted) {
      const schoolId = tripSchoolMap.get(loc.tripId) ?? '';
      GeofenceService.evaluateTripStops({
        tripId: loc.tripId,
        schoolId,
        busId: loc.busId,
        latitude: loc.latitude,
        longitude: loc.longitude,
        recordedAt: new Date(loc.recordedAt),
        emitDwellEvents: true,
        triggerWorkflows: true,
      }).catch((err: unknown) => {
        logger.warn('GeofenceService.evaluateTripStops batch error (suppressed)', {
          tripId: loc.tripId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      GeofenceService.evaluateSchoolArrival({
        tripId: loc.tripId,
        schoolId,
        busId: loc.busId,
        latitude: loc.latitude,
        longitude: loc.longitude,
        recordedAt: new Date(loc.recordedAt),
      }).catch((err: unknown) => {
        logger.warn('GeofenceService.evaluateSchoolArrival batch error (suppressed)', {
          tripId: loc.tripId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

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
   * Get the most recent GPS location for a bus.
   * @param callerSchoolId When provided, enforces tenant isolation — throws NotFoundError
   *   if the bus does not belong to this school (prevents cross-school data leakage).
   */
  static async getLatestBusLocation(busId: string, callerSchoolId?: string) {
    // Tenant isolation: verify the bus belongs to the caller's school before returning data.
    if (callerSchoolId) {
      const busCheck = await query<{ school_id: string }>(
        `SELECT school_id FROM buses WHERE id = $1 AND deleted_at IS NULL LIMIT 1;`,
        [busId]
      );
      if (!busCheck[0] || busCheck[0].school_id !== callerSchoolId) {
        throw new NotFoundError(`Bus ${busId} not found`);
      }
    }

    const rows = await query<{
      id: string;
      tripId: string;
      busId: string;
      driverId: string;
      latitude: number;
      longitude: number;
      speedKmh: number;
      bearingDegrees: number | null;
      accuracyMeters: number | null;
      batteryPercentage: number | null;
      isCharging: boolean | null;
      networkType: string | null;
      recordedAt: string;
      createdAt: string;
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
   * Get location trail points for a trip.
   * @param callerSchoolId When provided, enforces tenant isolation — throws NotFoundError
   *   if the trip does not belong to this school (prevents cross-school data leakage).
   */
  static async getTripLocationTrail(tripId: string, limit: number = 200, callerSchoolId?: string) {
    // Tenant isolation: verify the trip belongs to the caller's school before returning data.
    if (callerSchoolId) {
      const tripCheck = await query<{ school_id: string }>(
        `SELECT school_id FROM trips WHERE id = $1 LIMIT 1;`,
        [tripId]
      );
      if (!tripCheck[0] || tripCheck[0].school_id !== callerSchoolId) {
        throw new NotFoundError(`Trip ${tripId} not found`);
      }
    }

    const rows = await query<{
      id: string;
      latitude: number;
      longitude: number;
      speedKmh: number;
      bearingDegrees: number | null;
      accuracyMeters: number | null;
      batteryPercentage: number | null;
      recordedAt: string;
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

  /**
   * Verify a trip belongs to the given school. Used by SSE feed before streaming.
   * Throws NotFoundError if the trip doesn't exist or belongs to a different school.
   */
  static async verifyTripOwnership(tripId: string, callerSchoolId: string): Promise<void> {
    const rows = await query<{ school_id: string }>(
      `SELECT school_id FROM trips WHERE id = $1 LIMIT 1;`,
      [tripId]
    );
    if (!rows[0] || rows[0].school_id !== callerSchoolId) {
      throw new NotFoundError(`Trip ${tripId} not found`);
    }
  }
}
