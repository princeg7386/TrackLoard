import { query } from '../config/database.js';
import {
  GPS_OFFLINE_THRESHOLDS,
  GpsOfflineDetectionType,
  GpsOfflineEvaluationResult,
  GpsOfflineEventRecord,
  TripOfflineDetectionResult,
  FleetOfflineDetectionSummary,
  ReportAppDisconnectRequest,
  LastKnownLocationDetails,
  GpsOfflineResponseResult,
  GpsOfflineRecoveryResult,
  GpsOfflineBatchRecoveryResult,
  TelemetryIngestPayload,
} from '@school-bus/shared';
import { NotFoundError, ForbiddenError, BadRequestError } from '../middlewares/error.middleware.js';
import { logger } from './logger.service.js';
import { RealtimeFeedService } from './realtime-feed.service.js';
import { MessagingService } from './messaging/messaging.service.js';
import { OperationalNotificationService } from './operational-notification.service.js';

interface DbGpsOfflineEventRow {
  id: string;
  school_id: string;
  trip_id: string;
  bus_id: string;
  driver_id: string | null;
  detection_type: GpsOfflineDetectionType;
  status: 'ACTIVE' | 'RESOLVED';
  started_at: string | Date;
  duration_seconds: number;
  stale_threshold_seconds: number;
  disconnect_threshold_seconds: number;
  last_known_latitude: number | null;
  last_known_longitude: number | null;
  last_known_recorded_at: string | Date | null;
  last_known_speed_kmh?: number | null;
  last_known_bearing_degrees?: number | null;
  last_known_address?: string | null;
  last_network_type: string | null;
  last_battery_percentage: number | null;
  resolved_at: string | Date | null;
  recovery_reason: string | null;
  school_notified_at: string | Date | null;
  driver_notified_at: string | Date | null;
  notes: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export class GpsOfflineDetectionService {
  /** Cooldown for school and driver notifications to prevent spam (10 minutes) */
  public static readonly NOTIFICATION_COOLDOWN_MS = 10 * 60 * 1000;

  /**
   * Pure evaluation function: determines whether telemetry indicates
   * HEALTHY, STALE_LOCATION, INTERNET_LOSS, or APP_DISCONNECT.
   * Micro-phase 27.1 Tasks: Stale location threshold; Internet loss; App disconnect.
   */
  static evaluateOfflineState(params: {
    lastGpsRecordedAt?: string | Date | null;
    lastPingAt?: string | Date | null;
    networkType?: string | null;
    isOnline?: boolean;
    hasActiveTrip?: boolean;
    staleThresholdSeconds?: number;
    disconnectThresholdSeconds?: number;
    now?: number;
  }): GpsOfflineEvaluationResult {
    const {
      lastGpsRecordedAt,
      lastPingAt,
      networkType,
      isOnline,
      hasActiveTrip = true,
      staleThresholdSeconds = GPS_OFFLINE_THRESHOLDS.DEFAULT_STALE_LOCATION_SECONDS,
      disconnectThresholdSeconds = GPS_OFFLINE_THRESHOLDS.DEFAULT_APP_DISCONNECT_SECONDS,
      now = Date.now(),
    } = params;

    // When there is no active trip running, offline states are not flagged as operational outages
    if (!hasActiveTrip) {
      return {
        isOffline: false,
        detectionType: null,
        status: 'HEALTHY',
        ageSeconds: 0,
        disconnectAgeSeconds: 0,
        staleThresholdSeconds,
        disconnectThresholdSeconds,
        message: 'No active trip in progress',
      };
    }

    // 1. Calculate age of last known GPS coordinate fix
    let ageSeconds = Infinity;
    if (lastGpsRecordedAt) {
      const gpsTime = new Date(lastGpsRecordedAt).getTime();
      if (!isNaN(gpsTime)) {
        ageSeconds = Math.max(0, Math.floor((now - gpsTime) / 1000));
      }
    }

    // 2. Calculate age of last device ping / heartbeat
    let disconnectAgeSeconds = ageSeconds;
    if (lastPingAt) {
      const pingTime = new Date(lastPingAt).getTime();
      if (!isNaN(pingTime)) {
        disconnectAgeSeconds = Math.max(0, Math.floor((now - pingTime) / 1000));
      }
    }

    // TASK 3: App Disconnect Detection
    // The driver app / background service has stopped sending any heartbeats or pings
    if (disconnectAgeSeconds >= disconnectThresholdSeconds) {
      return {
        isOffline: true,
        detectionType: 'APP_DISCONNECT',
        status: 'APP_DISCONNECT',
        ageSeconds,
        disconnectAgeSeconds,
        staleThresholdSeconds,
        disconnectThresholdSeconds,
        message: `Driver app disconnected: No telemetry or heartbeat received for ${Math.floor(disconnectAgeSeconds)}s (threshold: ${disconnectThresholdSeconds}s)`,
      };
    }

    // TASK 2: Internet Loss Detection
    // Device specifically reported offline status, or network connection dropped
    const normalizedNetwork = networkType ? networkType.toUpperCase() : null;
    if (
      isOnline === false ||
      normalizedNetwork === 'OFFLINE' ||
      normalizedNetwork === 'NONE'
    ) {
      return {
        isOffline: true,
        detectionType: 'INTERNET_LOSS',
        status: 'INTERNET_LOSS',
        ageSeconds,
        disconnectAgeSeconds,
        staleThresholdSeconds,
        disconnectThresholdSeconds,
        message: `Internet connection lost: Device reported offline (${normalizedNetwork || 'NONE'})`,
      };
    }

    // TASK 1: Stale Location Threshold Detection
    // The app/device is communicating, but GNSS satellite fix hasn't updated beyond the threshold
    if (ageSeconds >= staleThresholdSeconds) {
      return {
        isOffline: true,
        detectionType: 'STALE_LOCATION',
        status: 'STALE_LOCATION',
        ageSeconds,
        disconnectAgeSeconds,
        staleThresholdSeconds,
        disconnectThresholdSeconds,
        message: `Stale GPS location: Coordinates have not updated for ${Math.floor(ageSeconds)}s (threshold: ${staleThresholdSeconds}s)`,
      };
    }

    // Telemetry is completely healthy
    return {
      isOffline: false,
      detectionType: null,
      status: 'HEALTHY',
      ageSeconds,
      disconnectAgeSeconds,
      staleThresholdSeconds,
      disconnectThresholdSeconds,
      message: 'GPS and network telemetry are healthy',
    };
  }

  /**
   * Evaluates offline status for a specific trip and persists/updates active events
   */
  static async detectTripOfflineStatus(
    tripId: string,
    options?: {
      staleThresholdSeconds?: number;
      disconnectThresholdSeconds?: number;
      autoPersist?: boolean;
      now?: number;
    }
  ): Promise<TripOfflineDetectionResult> {
    const staleThreshold = options?.staleThresholdSeconds ?? GPS_OFFLINE_THRESHOLDS.DEFAULT_STALE_LOCATION_SECONDS;
    const disconnectThreshold = options?.disconnectThresholdSeconds ?? GPS_OFFLINE_THRESHOLDS.DEFAULT_APP_DISCONNECT_SECONDS;
    const autoPersist = options?.autoPersist !== false;
    const now = options?.now ?? Date.now();

    // 1. Fetch trip and its assigned bus latest cache
    const tripRows = await query<{
      id: string;
      school_id: string;
      bus_id: string;
      driver_id: string | null;
      status: string;
      last_latitude: number | null;
      last_longitude: number | null;
      last_speed_kmh: number | null;
      last_bearing_degrees: number | null;
      last_accuracy_meters: number | null;
      last_battery_percentage: number | null;
      last_network_type: string | null;
      last_gps_recorded_at: string | Date | null;
      last_ping_at: string | Date | null;
    }>(
      `SELECT 
        t.id,
        t.school_id,
        t.bus_id,
        t.driver_id,
        t.status,
        b.last_latitude,
        b.last_longitude,
        b.last_speed_kmh,
        b.last_bearing_degrees,
        b.last_accuracy_meters,
        b.last_battery_percentage,
        b.last_network_type,
        b.last_gps_recorded_at,
        b.updated_at as last_ping_at
       FROM trips t
       JOIN buses b ON b.id = t.bus_id
       WHERE t.id = $1`,
      [tripId]
    );

    if (tripRows.length === 0) {
      throw new NotFoundError(`Trip with ID '${tripId}' not found`);
    }

    const trip = tripRows[0]!;
    const hasActiveTrip = ['IN_TRANSIT', 'DELAYED', 'ARRIVED_SCHOOL'].includes(trip.status);

    // 2. Evaluate offline state
    const evaluation = this.evaluateOfflineState({
      lastGpsRecordedAt: trip.last_gps_recorded_at,
      lastPingAt: trip.last_ping_at,
      networkType: trip.last_network_type,
      isOnline: trip.last_network_type !== 'OFFLINE' && trip.last_network_type !== 'NONE',
      hasActiveTrip,
      staleThresholdSeconds: staleThreshold,
      disconnectThresholdSeconds: disconnectThreshold,
      now,
    });

    let activeOfflineEvent: GpsOfflineEventRecord | null = null;

    if (autoPersist && hasActiveTrip) {
      if (evaluation.isOffline && evaluation.detectionType) {
        // Find existing ACTIVE offline event for this trip
        const existingRows = await query<DbGpsOfflineEventRow>(
          `SELECT * FROM gps_offline_events 
           WHERE trip_id = $1 AND status = 'ACTIVE' 
           ORDER BY started_at DESC LIMIT 1`,
          [tripId]
        );

        if (existingRows.length > 0) {
          const existing = existingRows[0]!;
          // Update duration, kinematics, and detection type if transitioned
          const updatedRows = await query<DbGpsOfflineEventRow>(
            `UPDATE gps_offline_events
             SET duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::int,
                 detection_type = $1,
                 last_known_latitude = $2,
                 last_known_longitude = $3,
                 last_known_recorded_at = $4,
                 last_network_type = $5,
                 last_battery_percentage = $6,
                 last_known_speed_kmh = $7,
                 last_known_bearing_degrees = $8,
                 updated_at = NOW()
             WHERE id = $9
             RETURNING *`,
            [
              evaluation.detectionType,
              trip.last_latitude,
              trip.last_longitude,
              trip.last_gps_recorded_at,
              trip.last_network_type,
              trip.last_battery_percentage,
              trip.last_speed_kmh ?? 0,
              trip.last_bearing_degrees ?? 0,
              existing.id,
            ]
          );
          if (updatedRows.length > 0) {
            activeOfflineEvent = this.mapDbRowToGpsOfflineEventRecord(updatedRows[0]!);
          }
        } else {
          // Create new ACTIVE offline event
          const insertRows = await query<DbGpsOfflineEventRow>(
            `INSERT INTO gps_offline_events (
               school_id,
               trip_id,
               bus_id,
               driver_id,
               detection_type,
               status,
               started_at,
               duration_seconds,
               stale_threshold_seconds,
               disconnect_threshold_seconds,
               last_known_latitude,
               last_known_longitude,
               last_known_location,
               last_known_recorded_at,
               last_network_type,
               last_battery_percentage,
               last_known_speed_kmh,
               last_known_bearing_degrees
             ) VALUES (
               $1, $2, $3, $4, $5, 'ACTIVE', NOW(), 0, $6, $7, $8, $9,
               CASE WHEN $8 IS NOT NULL AND $9 IS NOT NULL THEN ST_SetSRID(ST_MakePoint($9, $8), 4326) ELSE NULL END,
               $10, $11, $12, $13, $14
             ) RETURNING *`,
            [
              trip.school_id,
              trip.id,
              trip.bus_id,
              trip.driver_id,
              evaluation.detectionType,
              staleThreshold,
              disconnectThreshold,
              trip.last_latitude,
              trip.last_longitude,
              trip.last_gps_recorded_at,
              trip.last_network_type,
              trip.last_battery_percentage,
              trip.last_speed_kmh ?? 0,
              trip.last_bearing_degrees ?? 0,
            ]
          );
          if (insertRows.length > 0) {
            activeOfflineEvent = this.mapDbRowToGpsOfflineEventRecord(insertRows[0]!);

            logger.warn('[GpsOfflineDetection] GPS offline event initiated for active trip', {
              tripId,
              busId: trip.bus_id,
              detectionType: evaluation.detectionType,
              message: evaluation.message,
            });

            // Broadcast real-time alert for fleet canvas
            RealtimeFeedService.publish({
              type: 'HEALTH_UPDATE',
              schoolId: trip.school_id,
              busId: trip.bus_id,
              tripId: trip.id,
              healthStatus: evaluation.detectionType === 'STALE_LOCATION' ? 'STALE_SIGNAL' : 'OFFLINE',
              timestamp: new Date().toISOString(),
            });
          }
        }
      } else {
        // If the trip is now HEALTHY but an active event was open, resolve it
        const resolveRows = await query<DbGpsOfflineEventRow>(
          `UPDATE gps_offline_events
           SET status = 'RESOLVED',
               resolved_at = NOW(),
               recovery_reason = 'TELEMETRY_RESUMED',
               duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::int,
               updated_at = NOW()
           WHERE trip_id = $1 AND status = 'ACTIVE'
           RETURNING *`,
          [tripId]
        );
        if (resolveRows.length > 0) {
          logger.info('[GpsOfflineDetection] GPS offline event resolved on telemetry resumption', {
            tripId,
            eventId: resolveRows[0]!.id,
          });
        }
      }
    }

    return {
      tripId: trip.id,
      busId: trip.bus_id,
      schoolId: trip.school_id,
      driverId: trip.driver_id,
      hasActiveTrip,
      tripStatus: trip.status,
      evaluation,
      activeOfflineEvent,
      lastKnownLocation: {
        latitude: trip.last_latitude,
        longitude: trip.last_longitude,
        recordedAt: trip.last_gps_recorded_at ? new Date(trip.last_gps_recorded_at).toISOString() : null,
        speedKmh: trip.last_speed_kmh,
        accuracyMeters: trip.last_accuracy_meters,
        networkType: trip.last_network_type,
        batteryPercentage: trip.last_battery_percentage,
      },
    };
  }

  /**
   * Task 1: Retrieve secured last known location details for an active trip
   */
  static async getLastKnownLocation(tripId: string): Promise<LastKnownLocationDetails> {
    const rows = await query<{
      last_latitude: number | null;
      last_longitude: number | null;
      last_speed_kmh: number | null;
      last_bearing_degrees: number | null;
      last_accuracy_meters: number | null;
      last_battery_percentage: number | null;
      last_network_type: string | null;
      last_gps_recorded_at: string | Date | null;
      event_address: string | null;
    }>(
      `SELECT 
        b.last_latitude,
        b.last_longitude,
        b.last_speed_kmh,
        b.last_bearing_degrees,
        b.last_accuracy_meters,
        b.last_battery_percentage,
        b.last_network_type,
        b.last_gps_recorded_at,
        e.last_known_address as event_address
       FROM trips t
       JOIN buses b ON b.id = t.bus_id
       LEFT JOIN gps_offline_events e ON e.trip_id = t.id AND e.status = 'ACTIVE'
       WHERE t.id = $1`,
      [tripId]
    );

    if (rows.length === 0) {
      throw new NotFoundError(`Trip with ID '${tripId}' not found`);
    }

    const row = rows[0]!;
    const recordedAt = row.last_gps_recorded_at ? new Date(row.last_gps_recorded_at).toISOString() : null;
    const ageSeconds = recordedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(recordedAt).getTime()) / 1000))
      : undefined;

    return {
      latitude: row.last_latitude != null ? Number(row.last_latitude) : null,
      longitude: row.last_longitude != null ? Number(row.last_longitude) : null,
      speedKmh: row.last_speed_kmh != null ? Number(row.last_speed_kmh) : null,
      bearingDegrees: row.last_bearing_degrees != null ? Number(row.last_bearing_degrees) : null,
      accuracyMeters: row.last_accuracy_meters != null ? Number(row.last_accuracy_meters) : null,
      batteryPercentage: row.last_battery_percentage != null ? Number(row.last_battery_percentage) : null,
      networkType: row.last_network_type,
      recordedAt,
      address: row.event_address,
      ageSeconds,
      isStale: ageSeconds !== undefined ? ageSeconds >= GPS_OFFLINE_THRESHOLDS.DEFAULT_STALE_LOCATION_SECONDS : true,
    };
  }

  /**
   * Task 2: Dispatch operational alert to school coordinators and staff
   * Guarded by cooldown (10 minutes) unless force is true
   */
  static async notifySchoolGpsOffline(params: {
    tripId: string;
    eventId?: string;
    schoolId?: string;
    detectionType?: GpsOfflineDetectionType;
    force?: boolean;
  }): Promise<boolean> {
    const { tripId, eventId, schoolId, detectionType, force } = params;

    try {
      // 1. Fetch trip and event context if not provided
      const tripRows = await query<{
        id: string;
        school_id: string;
        bus_id: string;
        bus_number: string;
        route_name: string;
        last_gps_recorded_at: string | Date | null;
        last_latitude: number | null;
        last_longitude: number | null;
      }>(
        `SELECT t.id, t.school_id, b.id as bus_id, b.bus_number, r.name as route_name,
                b.last_gps_recorded_at, b.last_latitude, b.last_longitude
         FROM trips t
         JOIN buses b ON b.id = t.bus_id
         JOIN routes r ON r.id = t.route_id
         WHERE t.id = $1`,
        [tripId]
      );
      if (tripRows.length === 0) return false;
      const trip = tripRows[0]!;
      const effectiveSchoolId = schoolId || trip.school_id;

      // 2. Check cooldown on the event record
      let targetEventId = eventId;
      if (!targetEventId) {
        const openEvent = await query<{ id: string; school_notified_at: string | Date | null }>(
          `SELECT id, school_notified_at FROM gps_offline_events WHERE trip_id = $1 AND status = 'ACTIVE' LIMIT 1`,
          [tripId]
        );
        if (openEvent.length > 0) {
          targetEventId = openEvent[0]!.id;
          if (!force && openEvent[0]!.school_notified_at) {
            const elapsed = Date.now() - new Date(openEvent[0]!.school_notified_at).getTime();
            if (elapsed < this.NOTIFICATION_COOLDOWN_MS) {
              return false; // Cooldown active
            }
          }
        }
      }

      // 3. Dispatch operational notification via OperationalNotificationService
      await OperationalNotificationService.notifyGpsUnavailable({
        schoolId: effectiveSchoolId,
        tripId,
        lastSeenAt: trip.last_gps_recorded_at ? new Date(trip.last_gps_recorded_at).toISOString() : undefined,
        reason: detectionType ? `GPS Offline: ${detectionType}` : 'GPS Offline Alert',
      });

      // 4. Record school_notified_at on event
      if (targetEventId) {
        await query(
          `UPDATE gps_offline_events
           SET school_notified_at = NOW(),
               updated_at = NOW()
           WHERE id = $1`,
          [targetEventId]
        );
      }

      // 5. Broadcast real-time feed alert for operational dashboard
      RealtimeFeedService.publish({
        type: 'NOTIFICATION_ALERT',
        schoolId: effectiveSchoolId,
        busId: trip.bus_id,
        tripId,
        timestamp: new Date().toISOString(),
        notificationAlert: {
          id: targetEventId || tripId,
          eventType: 'GPS_UNAVAILABLE',
          priority: 'HIGH',
          title: 'GPS Offline Alert',
          message: `Bus ${trip.bus_number} GPS is offline (${detectionType || 'SIGNAL_LOST'}) on route '${trip.route_name}'`,
          recipientRole: 'TRANSPORT_COORDINATOR',
        },
      });

      logger.info('[GpsOfflineDetection] School notified of GPS offline event', {
        tripId,
        eventId: targetEventId,
        detectionType,
      });

      return true;
    } catch (err: unknown) {
      logger.warn('[GpsOfflineDetection] Failed to notify school of GPS offline (suppressed)', {
        tripId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * Task 3: Dispatch tailored alert to driver based on failure mode
   * Guarded by cooldown (10 minutes) unless force is true
   */
  static async notifyDriverGpsOffline(params: {
    tripId: string;
    eventId?: string;
    detectionType?: GpsOfflineDetectionType;
    force?: boolean;
  }): Promise<boolean> {
    const { tripId, eventId, detectionType, force } = params;

    try {
      // 1. Fetch trip and driver context
      const driverRows = await query<{
        driver_phone: string | null;
        driver_name: string | null;
        bus_number: string;
        school_id: string;
      }>(
        `SELECT d.phone as driver_phone, d.full_name as driver_name,
                b.bus_number, t.school_id
         FROM trips t
         JOIN buses b ON b.id = t.bus_id
         JOIN drivers d ON d.id = t.driver_id
         WHERE t.id = $1`,
        [tripId]
      );
      if (driverRows.length === 0 || !driverRows[0]?.driver_phone) {
        return false;
      }
      const driver = driverRows[0]!;

      // 2. Check cooldown on event
      let targetEventId = eventId;
      if (!targetEventId) {
        const openEvent = await query<{ id: string; driver_notified_at: string | Date | null }>(
          `SELECT id, driver_notified_at FROM gps_offline_events WHERE trip_id = $1 AND status = 'ACTIVE' LIMIT 1`,
          [tripId]
        );
        if (openEvent.length > 0) {
          targetEventId = openEvent[0]!.id;
          if (!force && openEvent[0]!.driver_notified_at) {
            const elapsed = Date.now() - new Date(openEvent[0]!.driver_notified_at).getTime();
            if (elapsed < this.NOTIFICATION_COOLDOWN_MS) {
              return false; // Cooldown active
            }
          }
        }
      }

      // 3. Tailor copy per failure mode
      let driverMsg: string;
      switch (detectionType) {
        case 'INTERNET_LOSS':
          driverMsg = `TrackLoard Alert: Mobile data/internet connection lost for Bus ${driver.bus_number}. Telemetry is buffered on device. Please verify mobile data is ON.`;
          break;
        case 'STALE_LOCATION':
          driverMsg = `TrackLoard Alert: GPS location fix is frozen for Bus ${driver.bus_number}. Please ensure Location/GPS is ON with High Accuracy and phone has clear sky view.`;
          break;
        case 'APP_DISCONNECT':
        default:
          driverMsg = `TrackLoard Alert: Background tracking disconnected for Bus ${driver.bus_number}. Please reopen the TrackLoard app immediately to resume tracking.`;
          break;
      }

      // 4. Send message via MessagingService adapter
      await MessagingService.sendMessage({
        recipientPhone: driver.driver_phone!,
        recipientRole: 'DRIVER',
        schoolId: driver.school_id,
        directText: driverMsg,
        templateId: 'DRIVER_GPS_LOST_ALERT',
        eventType: 'GPS_UNAVAILABLE',
        priority: 'HIGH',
      });

      // 5. Update driver_notified_at
      if (targetEventId) {
        await query(
          `UPDATE gps_offline_events
           SET driver_notified_at = NOW(),
               updated_at = NOW()
           WHERE id = $1`,
          [targetEventId]
        );
      }

      logger.info('[GpsOfflineDetection] Driver notified of GPS offline event', {
        tripId,
        eventId: targetEventId,
        driverPhone: driver.driver_phone,
        detectionType,
      });

      return true;
    } catch (err: unknown) {
      logger.warn('[GpsOfflineDetection] Failed to notify driver of GPS offline (suppressed)', {
        tripId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * Orchestrates the complete Micro-phase 27.2 Response workflow:
   * 1. Detect & Store/lock last known location
   * 2. Notify school (cooldown guarded)
   * 3. Notify driver (cooldown guarded, tailored message)
   */
  static async respondToOfflineTrip(params: {
    tripId: string;
    schoolId?: string;
    forceNotify?: boolean;
  }): Promise<GpsOfflineResponseResult> {
    const { tripId, schoolId, forceNotify = false } = params;

    // 1. Detect trip offline status and store last known location in event
    const detection = await this.detectTripOfflineStatus(tripId);

    if (!detection.evaluation.isOffline || !detection.activeOfflineEvent) {
      const lastKnown = await this.getLastKnownLocation(tripId);
      return {
        success: true,
        eventId: '00000000-0000-0000-0000-000000000000',
        tripId,
        schoolId: detection.schoolId,
        busId: detection.busId,
        driverId: detection.driverId,
        detectionType: 'STALE_LOCATION',
        status: 'RESOLVED',
        lastKnownLocation: lastKnown,
        schoolNotified: false,
        schoolNotifiedAt: null,
        driverNotified: false,
        driverNotifiedAt: null,
        message: 'Trip telemetry is currently healthy; no offline response required',
      };
    }

    const event = detection.activeOfflineEvent;

    // 2. Notify School
    const schoolNotified = await this.notifySchoolGpsOffline({
      tripId,
      eventId: event.id,
      schoolId: schoolId || detection.schoolId,
      detectionType: event.detectionType,
      force: forceNotify,
    });

    // 3. Notify Driver
    const driverNotified = await this.notifyDriverGpsOffline({
      tripId,
      eventId: event.id,
      detectionType: event.detectionType,
      force: forceNotify,
    });

    // 4. Refresh last known location details
    const lastKnown = await this.getLastKnownLocation(tripId);

    const nowIso = new Date().toISOString();
    return {
      success: true,
      eventId: event.id,
      tripId,
      schoolId: detection.schoolId,
      busId: detection.busId,
      driverId: detection.driverId,
      detectionType: event.detectionType,
      status: event.status,
      lastKnownLocation: lastKnown,
      schoolNotified,
      schoolNotifiedAt: schoolNotified ? nowIso : (event.schoolNotifiedAt ?? null),
      driverNotified,
      driverNotifiedAt: driverNotified ? nowIso : (event.driverNotifiedAt ?? null),
      message: `Offline response executed (School: ${schoolNotified ? 'Notified' : 'Skipped/Cooldown'}, Driver: ${driverNotified ? 'Notified' : 'Skipped/Cooldown'})`,
    };
  }

  /**
   * Fleet-wide scanner: evaluates all active trips and categorizes offline status
   */
  static async scanActiveTripsForOffline(
    schoolId?: string,
    options?: {
      staleThresholdSeconds?: number;
      disconnectThresholdSeconds?: number;
      autoPersist?: boolean;
      now?: number;
    }
  ): Promise<FleetOfflineDetectionSummary> {
    const staleThreshold = options?.staleThresholdSeconds ?? GPS_OFFLINE_THRESHOLDS.DEFAULT_STALE_LOCATION_SECONDS;
    const disconnectThreshold = options?.disconnectThresholdSeconds ?? GPS_OFFLINE_THRESHOLDS.DEFAULT_APP_DISCONNECT_SECONDS;
    const now = options?.now ?? Date.now();

    const params: unknown[] = [];
    let schoolFilter = '';
    if (schoolId) {
      params.push(schoolId);
      schoolFilter = ` AND t.school_id = $${params.length}`;
    }

    const activeTrips = await query<{ id: string; school_id: string }>(
      `SELECT t.id, t.school_id
       FROM trips t
       WHERE t.status IN ('IN_TRANSIT', 'DELAYED', 'ARRIVED_SCHOOL')
         ${schoolFilter}
       ORDER BY t.created_at ASC`,
      params
    );

    let healthyCount = 0;
    let staleLocationCount = 0;
    let internetLossCount = 0;
    let appDisconnectCount = 0;

    const trips: TripOfflineDetectionResult[] = [];

    for (const trip of activeTrips) {
      const result = await this.detectTripOfflineStatus(trip.id, {
        staleThresholdSeconds: staleThreshold,
        disconnectThresholdSeconds: disconnectThreshold,
        autoPersist: options?.autoPersist !== false,
        now,
      });
      trips.push(result);

      switch (result.evaluation.status) {
        case 'HEALTHY':
          healthyCount++;
          break;
        case 'STALE_LOCATION':
          staleLocationCount++;
          break;
        case 'INTERNET_LOSS':
          internetLossCount++;
          break;
        case 'APP_DISCONNECT':
          appDisconnectCount++;
          break;
      }
    }

    return {
      schoolId: schoolId || '00000000-0000-0000-0000-000000000000',
      evaluatedAt: new Date(now).toISOString(),
      totalActiveTrips: activeTrips.length,
      healthyCount,
      staleLocationCount,
      internetLossCount,
      appDisconnectCount,
      totalOfflineCount: staleLocationCount + internetLossCount + appDisconnectCount,
      trips,
    };
  }

  /**
   * Explicit driver app disconnect report (driver app background kill/exit or beacon)
   */
  static async reportAppDisconnect(params: {
    tripId: string;
    driverId?: string;
    payload?: ReportAppDisconnectRequest;
  }): Promise<GpsOfflineEventRecord> {
    const { tripId, driverId, payload } = params;

    const tripRows = await query<{
      id: string;
      school_id: string;
      bus_id: string;
      driver_id: string | null;
      status: string;
      last_latitude: number | null;
      last_longitude: number | null;
      last_battery_percentage: number | null;
      last_network_type: string | null;
      last_gps_recorded_at: string | Date | null;
    }>(
      `SELECT t.id, t.school_id, t.bus_id, t.driver_id, t.status,
              b.last_latitude, b.last_longitude, b.last_battery_percentage,
              b.last_network_type, b.last_gps_recorded_at
       FROM trips t
       JOIN buses b ON b.id = t.bus_id
       WHERE t.id = $1`,
      [tripId]
    );

    if (tripRows.length === 0) {
      throw new NotFoundError(`Trip with ID '${tripId}' not found`);
    }

    const trip = tripRows[0]!;
    const lat = payload?.lastLatitude ?? trip.last_latitude;
    const lng = payload?.lastLongitude ?? trip.last_longitude;
    const battery = payload?.batteryPercentage ?? trip.last_battery_percentage;
    const network = payload?.networkType ?? trip.last_network_type ?? 'OFFLINE';

    // Check if an ACTIVE record already exists
    const existing = await query<DbGpsOfflineEventRow>(
      `SELECT * FROM gps_offline_events 
       WHERE trip_id = $1 AND status = 'ACTIVE' 
       ORDER BY started_at DESC LIMIT 1`,
      [tripId]
    );

    let eventRow: DbGpsOfflineEventRow;

    if (existing.length > 0) {
      const updated = await query<DbGpsOfflineEventRow>(
        `UPDATE gps_offline_events
         SET detection_type = 'APP_DISCONNECT',
             duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::int,
             last_known_latitude = $1,
             last_known_longitude = $2,
             last_network_type = $3,
             last_battery_percentage = $4,
             notes = COALESCE($5, notes),
             updated_at = NOW()
         WHERE id = $6
         RETURNING *`,
        [lat, lng, network, battery, payload?.reason ?? 'Driver app terminated or background stopped', existing[0]!.id]
      );
      eventRow = updated[0]!;
    } else {
      const inserted = await query<DbGpsOfflineEventRow>(
        `INSERT INTO gps_offline_events (
           school_id,
           trip_id,
           bus_id,
           driver_id,
           detection_type,
           status,
           started_at,
           duration_seconds,
           stale_threshold_seconds,
           disconnect_threshold_seconds,
           last_known_latitude,
           last_known_longitude,
           last_known_location,
           last_known_recorded_at,
           last_network_type,
           last_battery_percentage,
           notes
         ) VALUES (
           $1, $2, $3, $4, 'APP_DISCONNECT', 'ACTIVE', NOW(), 0, $5, $6, $7, $8,
           CASE WHEN $7 IS NOT NULL AND $8 IS NOT NULL THEN ST_SetSRID(ST_MakePoint($8, $7), 4326) ELSE NULL END,
           $9, $10, $11, $12
         ) RETURNING *`,
        [
          trip.school_id,
          trip.id,
          trip.bus_id,
          driverId || trip.driver_id,
          GPS_OFFLINE_THRESHOLDS.DEFAULT_STALE_LOCATION_SECONDS,
          GPS_OFFLINE_THRESHOLDS.DEFAULT_APP_DISCONNECT_SECONDS,
          lat,
          lng,
          trip.last_gps_recorded_at,
          network,
          battery,
          payload?.reason ?? 'Driver app terminated or background stopped',
        ]
      );
      eventRow = inserted[0]!;
    }

    logger.warn('[GpsOfflineDetection] Driver app disconnect reported', {
      tripId,
      busId: trip.bus_id,
      driverId,
      reason: payload?.reason,
    });

    RealtimeFeedService.publish({
      type: 'HEALTH_UPDATE',
      schoolId: trip.school_id,
      busId: trip.bus_id,
      tripId: trip.id,
      healthStatus: 'OFFLINE',
      timestamp: new Date().toISOString(),
    });

    return this.mapDbRowToGpsOfflineEventRecord(eventRow);
  }

  /**
   * Retrieves active offline events for a school
   */
  static async getActiveOfflineEvents(schoolId: string): Promise<GpsOfflineEventRecord[]> {
    const rows = await query<DbGpsOfflineEventRow>(
      `SELECT * FROM gps_offline_events 
       WHERE school_id = $1 AND status = 'ACTIVE' 
       ORDER BY started_at DESC`,
      [schoolId]
    );

    return rows.map((r) => this.mapDbRowToGpsOfflineEventRecord(r));
  }

  /**
   * Phase 27.3: Mark an active GPS offline event as recovered upon connection / telemetry restoration
   */
  static async markTripRecovered(params: {
    tripId: string;
    recoveryReason?: string;
  }): Promise<GpsOfflineRecoveryResult> {
    const { tripId, recoveryReason = 'TELEMETRY_RESUMED' } = params;
    const nowIso = new Date().toISOString();

    const resolvedRows = await query<{
      id: string;
      school_id: string;
      bus_id: string;
      started_at: string | Date;
      duration_seconds: number;
    }>(
      `UPDATE gps_offline_events
       SET status = 'RESOLVED',
           resolved_at = NOW(),
           recovery_reason = $2,
           duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::int,
           updated_at = NOW()
       WHERE trip_id = $1 AND status = 'ACTIVE'
       RETURNING id, school_id, bus_id, started_at, duration_seconds`,
      [tripId, recoveryReason]
    );

    const wasOffline = resolvedRows.length > 0;
    const resolved = resolvedRows[0];

    if (wasOffline && resolved) {
      logger.info('[GpsOfflineDetection] GPS offline event marked recovered', {
        tripId,
        eventId: resolved.id,
        recoveryReason,
        durationSeconds: resolved.duration_seconds,
      });

      RealtimeFeedService.publish({
        type: 'HEALTH_UPDATE',
        schoolId: resolved.school_id,
        busId: resolved.bus_id,
        tripId,
        healthStatus: 'HEALTHY',
        timestamp: nowIso,
      });

      RealtimeFeedService.publish({
        type: 'NOTIFICATION_ALERT',
        schoolId: resolved.school_id,
        busId: resolved.bus_id,
        tripId,
        timestamp: nowIso,
        notificationAlert: {
          id: resolved.id,
          eventType: 'GPS_UNAVAILABLE',
          priority: 'NORMAL',
          title: 'GPS Signal Restored',
          message: 'Bus GPS connectivity and real-time telemetry successfully recovered',
          recipientRole: 'TRANSPORT_COORDINATOR',
        },
      });
    }

    return {
      success: true,
      tripId,
      busId: resolved?.bus_id,
      schoolId: resolved?.school_id,
      wasOffline,
      resolvedEventId: resolved?.id ?? null,
      recoveryReason,
      recoveredAt: nowIso,
      message: wasOffline
        ? `GPS offline event successfully marked recovered (${recoveryReason})`
        : 'Trip is already in a healthy/recovered state',
    };
  }

  /**
   * Phase 27.3: Ingests queued offline points on reconnect, skips invalid/duplicates, updates bus cache, and marks recovered
   */
  static async processRecoveryBatch(params: {
    tripId: string;
    locations?: TelemetryIngestPayload[];
    authenticatedDriverId?: string;
  }): Promise<GpsOfflineBatchRecoveryResult> {
    const { tripId, locations = [], authenticatedDriverId } = params;

    // 1. Fetch trip context and verify existence & assignment
    const tripRows = await query<{
      id: string;
      school_id: string;
      bus_id: string;
      driver_id: string;
      status: string;
      bus_number: string;
    }>(
      `SELECT t.id, t.school_id, t.bus_id, t.driver_id, t.status, b.bus_number
       FROM trips t
       JOIN buses b ON b.id = t.bus_id
       WHERE t.id = $1 LIMIT 1;`,
      [tripId]
    );

    if (tripRows.length === 0) {
      throw new NotFoundError(`Trip '${tripId}' not found`);
    }

    const trip = tripRows[0]!;
    if (authenticatedDriverId && trip.driver_id && trip.driver_id !== authenticatedDriverId) {
      throw new ForbiddenError(`Authenticated driver is not assigned to trip ${tripId}`);
    }

    // If no locations were queued (device reconnected with empty buffer)
    if (locations.length === 0) {
      const recovery = await this.markTripRecovered({
        tripId,
        recoveryReason: 'CLIENT_RECONNECTED',
      });
      const lastKnown = await this.getLastKnownLocation(tripId);

      return {
        success: true,
        tripId,
        totalPointsReceived: 0,
        validPointsIngested: 0,
        duplicatePointsSkipped: 0,
        invalidPointsSkipped: 0,
        isRecovered: true,
        resolvedEventId: recovery.resolvedEventId,
        latestLocation: {
          latitude: lastKnown.latitude,
          longitude: lastKnown.longitude,
          speedKmh: lastKnown.speedKmh,
          bearingDegrees: lastKnown.bearingDegrees,
          recordedAt: lastKnown.recordedAt,
        },
        message: 'Trip reconnected successfully without pending batch points',
      };
    }

    // 2. Client-side deduplication & validity filtering
    const now = Date.now();
    let invalidCount = 0;
    const uniqueMap = new Map<string, TelemetryIngestPayload>();

    for (const loc of locations) {
      // Validate kinematics
      if (
        loc.latitude == null || loc.latitude < -90 || loc.latitude > 90 ||
        loc.longitude == null || loc.longitude < -180 || loc.longitude > 180 ||
        (loc.speedKmh != null && (loc.speedKmh < 0 || loc.speedKmh > 160))
      ) {
        invalidCount++;
        continue;
      }

      // Validate timestamps (not > 5 mins in future, not > 24h old)
      const t = new Date(loc.recordedAt).getTime();
      if (isNaN(t) || t > now + 5 * 60 * 1000 || t < now - 24 * 3600 * 1000) {
        invalidCount++;
        continue;
      }

      const key = `${loc.tripId || tripId}:${loc.recordedAt}`;
      uniqueMap.set(key, loc);
    }

    const deduplicated = Array.from(uniqueMap.values());
    const inMemoryDuplicates = locations.length - deduplicated.length - invalidCount;

    // Sort chronologically
    const sorted = [...deduplicated].sort(
      (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
    );

    let ingestedCount = 0;
    let dbDuplicatesCount = 0;

    for (const loc of sorted) {
      const res = await query<{ id: number }>(
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
          loc.tripId || trip.id,
          loc.busId || trip.bus_id,
          loc.driverId || trip.driver_id,
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

      if (res.length > 0) {
        ingestedCount++;
      } else {
        dbDuplicatesCount++;
      }
    }

    const totalDuplicatesSkipped = inMemoryDuplicates + dbDuplicatesCount;

    // 3. Update bus latest cache with latest valid point
    let latestValid: TelemetryIngestPayload | null = sorted[sorted.length - 1] ?? null;

    if (latestValid) {
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
             gps_health_status = 'HEALTHY',
             updated_at = NOW()
         WHERE id = $10
           AND (last_gps_recorded_at IS NULL OR last_gps_recorded_at <= $9);`,
        [
          latestValid.latitude,
          latestValid.longitude,
          latestValid.speedKmh ?? 0,
          latestValid.accuracyMeters ?? null,
          latestValid.bearingDegrees ?? null,
          latestValid.batteryPercentage ?? null,
          latestValid.isCharging ?? false,
          latestValid.networkType ?? 'CELLULAR',
          latestValid.recordedAt,
          trip.bus_id,
        ]
      );

      RealtimeFeedService.publish({
        type: 'LOCATION_UPDATE',
        schoolId: trip.school_id,
        busId: trip.bus_id,
        tripId: trip.id,
        latitude: latestValid.latitude,
        longitude: latestValid.longitude,
        speedKmh: latestValid.speedKmh ?? 0,
        bearingDegrees: latestValid.bearingDegrees ?? null,
        accuracyMeters: latestValid.accuracyMeters ?? null,
        batteryPercentage: latestValid.batteryPercentage ?? null,
        isCharging: latestValid.isCharging ?? false,
        networkType: latestValid.networkType ?? 'CELLULAR',
        healthStatus: 'HEALTHY',
        recordedAt: new Date(latestValid.recordedAt).toISOString(),
        timestamp: new Date().toISOString(),
      });
    }

    // 4. Mark active offline event recovered
    const recovery = await this.markTripRecovered({
      tripId,
      recoveryReason: 'BATCH_SYNC_RECOVERY',
    });

    return {
      success: true,
      tripId,
      totalPointsReceived: locations.length,
      validPointsIngested: ingestedCount,
      duplicatePointsSkipped: totalDuplicatesSkipped,
      invalidPointsSkipped: invalidCount,
      isRecovered: true,
      resolvedEventId: recovery.resolvedEventId,
      latestLocation: latestValid
        ? {
            latitude: latestValid.latitude,
            longitude: latestValid.longitude,
            speedKmh: latestValid.speedKmh ?? 0,
            bearingDegrees: latestValid.bearingDegrees ?? 0,
            recordedAt: new Date(latestValid.recordedAt).toISOString(),
          }
        : undefined,
      message: `Batch recovery successful: ${ingestedCount} points ingested, ${totalDuplicatesSkipped} duplicates skipped, ${invalidCount} invalid points skipped`,
    };
  }

  /**
   * Maps a database row to the typed GpsOfflineEventRecord contract
   */
  private static mapDbRowToGpsOfflineEventRecord(r: DbGpsOfflineEventRow): GpsOfflineEventRecord {
    return {
      id: r.id,
      schoolId: r.school_id,
      tripId: r.trip_id,
      busId: r.bus_id,
      driverId: r.driver_id,
      detectionType: r.detection_type,
      status: r.status,
      startedAt: new Date(r.started_at).toISOString(),
      durationSeconds: Number(r.duration_seconds || 0),
      staleThresholdSeconds: Number(r.stale_threshold_seconds || GPS_OFFLINE_THRESHOLDS.DEFAULT_STALE_LOCATION_SECONDS),
      disconnectThresholdSeconds: Number(r.disconnect_threshold_seconds || GPS_OFFLINE_THRESHOLDS.DEFAULT_APP_DISCONNECT_SECONDS),
      lastKnownLatitude: r.last_known_latitude != null ? Number(r.last_known_latitude) : null,
      lastKnownLongitude: r.last_known_longitude != null ? Number(r.last_known_longitude) : null,
      lastKnownRecordedAt: r.last_known_recorded_at ? new Date(r.last_known_recorded_at).toISOString() : null,
      lastKnownSpeedKmh: r.last_known_speed_kmh != null ? Number(r.last_known_speed_kmh) : null,
      lastKnownBearingDegrees: r.last_known_bearing_degrees != null ? Number(r.last_known_bearing_degrees) : null,
      lastKnownAddress: r.last_known_address ?? null,
      lastNetworkType: r.last_network_type,
      lastBatteryPercentage: r.last_battery_percentage != null ? Number(r.last_battery_percentage) : null,
      resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
      recoveryReason: r.recovery_reason,
      schoolNotifiedAt: r.school_notified_at ? new Date(r.school_notified_at).toISOString() : null,
      driverNotifiedAt: r.driver_notified_at ? new Date(r.driver_notified_at).toISOString() : null,
      notes: r.notes,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : undefined,
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : undefined,
    };
  }
}
