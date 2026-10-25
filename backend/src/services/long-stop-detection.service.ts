import { query } from '../config/database.js';
import {
  calculateHaversineDistanceMeters,
  LONG_STOP_CONFIG,
  LongStopDetectionOptions,
  LongStopDetectionOptionsSchema,
  LongStopDetectionResult,
  LongStopRecord,
  LongStopDriverReason,
  LONG_STOP_REASON_LABELS,
  RecordLongStopReasonResponse,
  LongStopWorkflowResult,
} from '@school-bus/shared';
import { NotFoundError } from '../middlewares/error.middleware.js';
import { logger } from './logger.service.js';
import { RealtimeFeedService } from './realtime-feed.service.js';
import { OperationalNotificationService } from './operational-notification.service.js';

export interface TelemetryPointInput {
  latitude: number;
  longitude: number;
  speedKmh?: number | null;
  accuracyMeters?: number | null;
  recordedAt: string | Date;
}

export class LongStopDetectionService {
  /**
   * Pure algorithmic evaluation of a telemetry time series to detect stationary state,
   * accounting for and ignoring GPS jitter and small coordinate drift.
   */
  static evaluateTelemetryStream(
    points: TelemetryPointInput[],
    customOptions?: Partial<LongStopDetectionOptions>
  ): {
    isStationary: boolean;
    isLongStop: boolean;
    stationarySince: string | null;
    durationSeconds: number;
    durationMinutes: number;
    thresholdMinutes: number;
    anchorLatitude: number | null;
    anchorLongitude: number | null;
    averageSpeedKmh: number;
    maxDriftMeters: number;
    stationaryPointsCount: number;
    totalPointsAnalyzed: number;
    status: 'MOVING' | 'STATIONARY_SHORT' | 'LONG_STOP';
  } {
    const options: LongStopDetectionOptions = LongStopDetectionOptionsSchema.parse(customOptions ?? {});

    if (!points || points.length === 0) {
      return {
        isStationary: false,
        isLongStop: false,
        stationarySince: null,
        durationSeconds: 0,
        durationMinutes: 0,
        thresholdMinutes: options.longStopThresholdMinutes,
        anchorLatitude: null,
        anchorLongitude: null,
        averageSpeedKmh: 0,
        maxDriftMeters: 0,
        stationaryPointsCount: 0,
        totalPointsAnalyzed: 0,
        status: 'MOVING',
      };
    }

    // Sort descending: newest ping first (index 0)
    const sorted = [...points].sort((a, b) => {
      const timeA = new Date(a.recordedAt).getTime();
      const timeB = new Date(b.recordedAt).getTime();
      return timeB - timeA;
    });

    const newest = sorted[0]!;
    const anchor = {
      latitude: Number(newest.latitude),
      longitude: Number(newest.longitude),
    };

    // If the latest point has clear, high movement speed, the bus is moving right now
    const latestSpeed = newest.speedKmh != null ? Number(newest.speedKmh) : 0;
    if (latestSpeed > options.stationarySpeedThresholdKmh) {
      // Check if previous point also shows movement (to ignore a single faulty speed spike)
      if (sorted.length > 1) {
        const prev = sorted[1]!;
        const dispMeters = calculateHaversineDistanceMeters(anchor, {
          latitude: Number(prev.latitude),
          longitude: Number(prev.longitude),
        });
        const dtSeconds = Math.max(
          1,
          (new Date(newest.recordedAt).getTime() - new Date(prev.recordedAt).getTime()) / 1000
        );
        const computedSpeedKmh = (dispMeters / dtSeconds) * 3.6;

        if (dispMeters > options.jitterRadiusMeters || computedSpeedKmh > options.stationarySpeedThresholdKmh) {
          return {
            isStationary: false,
            isLongStop: false,
            stationarySince: null,
            durationSeconds: 0,
            durationMinutes: 0,
            thresholdMinutes: options.longStopThresholdMinutes,
            anchorLatitude: anchor.latitude,
            anchorLongitude: anchor.longitude,
            averageSpeedKmh: Math.round(latestSpeed * 10) / 10,
            maxDriftMeters: 0,
            stationaryPointsCount: 0,
            totalPointsAnalyzed: sorted.length,
            status: 'MOVING',
          };
        }
      }
    }

    // Walk backwards from newest to oldest to build the continuous stationary cluster
    const cluster: TelemetryPointInput[] = [];
    let maxDriftMeters = 0;

    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i]!;
      const currentCoords = {
        latitude: Number(current.latitude),
        longitude: Number(current.longitude),
      };

      const driftFromAnchor = calculateHaversineDistanceMeters(anchor, currentCoords);
      const currentSpeed = current.speedKmh != null ? Number(current.speedKmh) : 0;

      // Jitter tolerance:
      // 1. Distance from anchor must be within jitter radius
      // 2. Either reported speed is under threshold OR displacement from anchor is negligible (<= 15m)
      const withinJitterRadius = driftFromAnchor <= options.jitterRadiusMeters;
      const isLowSpeed = currentSpeed <= options.stationarySpeedThresholdKmh;
      const isNegligibleDrift = driftFromAnchor <= 15.0;

      if (i > 0) {
        const prev = sorted[i - 1]!;
        const gapSeconds = (new Date(prev.recordedAt).getTime() - new Date(current.recordedAt).getTime()) / 1000;
        // If there's an excessive temporal gap (> MAX_PING_GAP_SECONDS), stop chaining
        if (gapSeconds > LONG_STOP_CONFIG.MAX_PING_GAP_SECONDS) {
          break;
        }
      }

      if (withinJitterRadius && (isLowSpeed || isNegligibleDrift)) {
        cluster.push(current);
        if (driftFromAnchor > maxDriftMeters) {
          maxDriftMeters = driftFromAnchor;
        }
      } else {
        // Vehicle was in transit prior to this point
        break;
      }
    }

    const stationaryCount = cluster.length;
    const isStationary = stationaryCount >= options.minStationaryPoints;

    if (!isStationary) {
      return {
        isStationary: false,
        isLongStop: false,
        stationarySince: null,
        durationSeconds: 0,
        durationMinutes: 0,
        thresholdMinutes: options.longStopThresholdMinutes,
        anchorLatitude: anchor.latitude,
        anchorLongitude: anchor.longitude,
        averageSpeedKmh: Math.round(latestSpeed * 10) / 10,
        maxDriftMeters: Math.round(maxDriftMeters * 10) / 10,
        stationaryPointsCount: stationaryCount,
        totalPointsAnalyzed: sorted.length,
        status: 'MOVING',
      };
    }

    const earliest = cluster[cluster.length - 1]!;
    const stationarySinceDate = new Date(earliest.recordedAt);
    const latestDate = new Date(newest.recordedAt);

    const durationSeconds = Math.max(
      0,
      Math.floor((latestDate.getTime() - stationarySinceDate.getTime()) / 1000)
    );
    const durationMinutes = Math.round((durationSeconds / 60) * 10) / 10;
    const isLongStop = durationMinutes >= options.longStopThresholdMinutes;

    const totalSpeed = cluster.reduce((sum, p) => sum + (p.speedKmh != null ? Number(p.speedKmh) : 0), 0);
    const averageSpeedKmh = Math.round((totalSpeed / cluster.length) * 10) / 10;

    const status: 'MOVING' | 'STATIONARY_SHORT' | 'LONG_STOP' = isLongStop
      ? 'LONG_STOP'
      : 'STATIONARY_SHORT';

    return {
      isStationary: true,
      isLongStop,
      stationarySince: stationarySinceDate.toISOString(),
      durationSeconds,
      durationMinutes,
      thresholdMinutes: options.longStopThresholdMinutes,
      anchorLatitude: anchor.latitude,
      anchorLongitude: anchor.longitude,
      averageSpeedKmh,
      maxDriftMeters: Math.round(maxDriftMeters * 10) / 10,
      stationaryPointsCount: stationaryCount,
      totalPointsAnalyzed: sorted.length,
      status,
    };
  }

  /**
   * Detect whether an active trip's bus is stationary or in a long stop.
   * Pulls recent telemetry, evaluates jitter filtering, and manages long_stops DB state.
   */
  static async detectStationaryBus(params: {
    tripId: string;
    schoolId: string;
    options?: Partial<LongStopDetectionOptions>;
    autoPersist?: boolean;
  }): Promise<LongStopDetectionResult> {
    const { tripId, schoolId, options, autoPersist = true } = params;

    // 1. Verify trip exists and belongs to school
    const tripRows = await query<{
      id: string;
      school_id: string;
      bus_id: string;
      driver_id: string | null;
      status: string;
    }>(
      `SELECT id, school_id, bus_id, driver_id, status
       FROM trips
       WHERE id = $1 AND school_id = $2`,
      [tripId, schoolId]
    );

    if (tripRows.length === 0) {
      throw new NotFoundError(`Trip with ID '${tripId}' not found for school '${schoolId}'`);
    }

    const trip = tripRows[0]!;

    // 2. Fetch recent telemetry points for this trip (up to 50 pings)
    const telemetryRows = await query<{
      latitude: number;
      longitude: number;
      speed_kmh: number | null;
      accuracy_meters: number | null;
      recorded_at: Date;
    }>(
      `SELECT latitude, longitude, speed_kmh, accuracy_meters, recorded_at
       FROM gps_locations
       WHERE trip_id = $1
       ORDER BY recorded_at DESC
       LIMIT 50`,
      [tripId]
    );

    const points: TelemetryPointInput[] = telemetryRows.map((r) => ({
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      speedKmh: r.speed_kmh != null ? Number(r.speed_kmh) : 0,
      accuracyMeters: r.accuracy_meters != null ? Number(r.accuracy_meters) : null,
      recordedAt: r.recorded_at,
    }));

    // 3. Evaluate stream with jitter filtering
    const evalResult = this.evaluateTelemetryStream(points, options);

    let longStopRecordId: string | null = null;

    // 4. Persistence management if requested
    if (autoPersist) {
      if (evalResult.isLongStop) {
        // Bus is in Long Stop state: insert or update active record
        const existingActive = await query<{ id: string; started_at: Date }>(
          `SELECT id, started_at
           FROM long_stops
           WHERE trip_id = $1 AND status = 'ACTIVE'
           ORDER BY created_at DESC
           LIMIT 1`,
          [tripId]
        );

        if (existingActive.length > 0) {
          const activeRecord = existingActive[0]!;
          longStopRecordId = activeRecord.id;

          await query(
            `UPDATE long_stops
             SET duration_seconds = $1,
                 speed_kmh = $2,
                 latitude = $3,
                 longitude = $4,
                 location = ST_SetSRID(ST_MakePoint($4, $3), 4326),
                 threshold_minutes = $5,
                 updated_at = NOW()
             WHERE id = $6`,
            [
              evalResult.durationSeconds,
              evalResult.averageSpeedKmh,
              evalResult.anchorLatitude,
              evalResult.anchorLongitude,
              evalResult.thresholdMinutes,
              longStopRecordId,
            ]
          );
        } else {
          const insertRows = await query<{ id: string }>(
            `INSERT INTO long_stops (
               school_id, trip_id, bus_id, driver_id,
               latitude, longitude, location,
               started_at, duration_seconds, threshold_minutes,
               speed_kmh, status, created_at, updated_at
             ) VALUES (
               $1, $2, $3, $4,
               $5, $6, ST_SetSRID(ST_MakePoint($6, $5), 4326),
               $7, $8, $9,
               $10, 'ACTIVE', NOW(), NOW()
             )
             RETURNING id`,
            [
              schoolId,
              tripId,
              trip.bus_id,
              trip.driver_id,
              evalResult.anchorLatitude,
              evalResult.anchorLongitude,
              evalResult.stationarySince ? new Date(evalResult.stationarySince) : new Date(),
              evalResult.durationSeconds,
              evalResult.thresholdMinutes,
              evalResult.averageSpeedKmh,
            ]
          );
          longStopRecordId = insertRows[0]?.id ?? null;
          if (longStopRecordId) {
            const finalRecordId = longStopRecordId;
            setImmediate(() => {
              LongStopDetectionService.notifySchoolLongStop({
                schoolId,
                tripId,
                busId: trip.bus_id,
                longStopId: finalRecordId,
                durationMinutes: evalResult.durationMinutes,
                latitude: evalResult.anchorLatitude ?? 0,
                longitude: evalResult.anchorLongitude ?? 0,
              }).catch((err: unknown) => {
                logger.warn('[LongStopDetectionService] notifySchoolLongStop error (suppressed)', {
                  tripId,
                  error: err instanceof Error ? err.message : String(err),
                });
              });
            });
          }
        }
      } else if (evalResult.status === 'MOVING') {
        // Bus resumed moving: resolve any active long stop
        await this.resolveActiveLongStop(tripId);
      }
    }

    return {
      tripId,
      schoolId,
      busId: trip.bus_id,
      isStationary: evalResult.isStationary,
      isLongStop: evalResult.isLongStop,
      stationarySince: evalResult.stationarySince,
      durationSeconds: evalResult.durationSeconds,
      durationMinutes: evalResult.durationMinutes,
      thresholdMinutes: evalResult.thresholdMinutes,
      anchorLatitude: evalResult.anchorLatitude,
      anchorLongitude: evalResult.anchorLongitude,
      averageSpeedKmh: evalResult.averageSpeedKmh,
      maxDriftMeters: evalResult.maxDriftMeters,
      stationaryPointsCount: evalResult.stationaryPointsCount,
      totalPointsAnalyzed: evalResult.totalPointsAnalyzed,
      status: evalResult.status,
      longStopRecordId,
    };
  }

  /**
   * Resolves an active long stop when a vehicle resumes movement.
   */
  static async resolveActiveLongStop(
    tripId: string,
    resolvedBy?: string,
    resolutionNotes?: string
  ): Promise<boolean> {
    const result = await query<{
      id: string;
      school_id: string;
      bus_id: string;
    }>(
      `UPDATE long_stops
       SET status = 'RESOLVED',
           resolved_at = NOW(),
           resolved_by = COALESCE($2, resolved_by),
           resolution_notes = COALESCE($3, resolution_notes),
           updated_at = NOW()
       WHERE trip_id = $1 AND status = 'ACTIVE'
       RETURNING id, school_id, bus_id`,
      [tripId, resolvedBy || null, resolutionNotes || null]
    );

    const rows = Array.isArray(result) ? result : [];
    if (rows.length > 0) {
      const resolved = rows[0]!;
      logger.info('Active long stop resolved for trip', { tripId, longStopId: resolved.id });

      RealtimeFeedService.publish({
        type: 'NOTIFICATION_ALERT',
        schoolId: resolved.school_id,
        busId: resolved.bus_id,
        tripId,
        timestamp: new Date().toISOString(),
        notificationAlert: {
          id: resolved.id,
          eventType: 'UNUSUAL_STOP',
          priority: 'NORMAL',
          title: 'Long Stop Resolved',
          message: 'Long stop resolved: Bus resumed movement',
          recipientRole: 'TRANSPORT_COORDINATOR',
        },
      });

      return true;
    }
    return false;
  }

  /**
   * Dispatches operational alerts to school staff and broadcasts real-time feed updates (Micro-phase 26.3)
   */
  static async notifySchoolLongStop(params: {
    schoolId: string;
    tripId: string;
    busId: string;
    longStopId: string;
    durationMinutes: number;
    latitude: number;
    longitude: number;
  }): Promise<boolean> {
    const { schoolId, tripId, busId, longStopId, durationMinutes, latitude, longitude } = params;

    try {
      // 1. Dispatch operational notification to transport desk
      await OperationalNotificationService.notifyUnusualStop({
        schoolId,
        tripId,
        stoppedDurationMinutes: durationMinutes,
        latitude,
        longitude,
      });

      // 2. Mark school_notified_at in long_stops
      await query(
        `UPDATE long_stops
         SET school_notified_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [longStopId]
      );

      // 3. Broadcast real-time feed alert for the live operational dashboard
      RealtimeFeedService.publish({
        type: 'NOTIFICATION_ALERT',
        schoolId,
        busId,
        tripId,
        timestamp: new Date().toISOString(),
        notificationAlert: {
          id: longStopId,
          eventType: 'UNUSUAL_STOP',
          priority: 'HIGH',
          title: 'Unusual Stop Alert',
          message: `Long stop detected: Bus stationary for ${durationMinutes} minutes`,
          recipientRole: 'TRANSPORT_COORDINATOR',
        },
      });

      logger.info('[LongStopDetection] School notified of long stop event', {
        schoolId,
        tripId,
        longStopId,
        durationMinutes,
      });

      return true;
    } catch (err: unknown) {
      logger.warn('[LongStopDetection] Failed to notify school of long stop (suppressed)', {
        tripId,
        longStopId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * Manual event resolution by transport coordinator or school admin (Micro-phase 26.3)
   */
  static async resolveLongStopManual(params: {
    schoolId: string;
    tripId: string;
    longStopId?: string;
    resolvedBy?: string;
    resolutionNotes?: string;
  }): Promise<LongStopWorkflowResult> {
    const { schoolId, tripId, longStopId, resolvedBy, resolutionNotes } = params;

    // 1. Verify trip exists for this school
    const tripRows = await query<{ id: string; bus_id: string }>(
      `SELECT id, bus_id FROM trips WHERE id = $1 AND school_id = $2`,
      [tripId, schoolId]
    );
    if (tripRows.length === 0) {
      throw new NotFoundError(`Trip with ID '${tripId}' not found for school '${schoolId}'`);
    }

    const trip = tripRows[0]!;

    // 2. Identify target long stop
    let targetId = longStopId || null;
    let currentReason: string | null = null;

    if (targetId) {
      const match = await query<{ id: string; status: string; driver_reason: string | null }>(
        `SELECT id, status, driver_reason FROM long_stops WHERE id = $1 AND trip_id = $2`,
        [targetId, tripId]
      );
      if (match.length === 0) {
        throw new NotFoundError(`Long stop '${targetId}' not found on trip '${tripId}'`);
      }
      currentReason = match[0]?.driver_reason || null;
    } else {
      const active = await query<{ id: string; status: string; driver_reason: string | null }>(
        `SELECT id, status, driver_reason FROM long_stops WHERE trip_id = $1 AND status = 'ACTIVE' LIMIT 1`,
        [tripId]
      );
      if (active.length > 0) {
        targetId = active[0]!.id;
        currentReason = active[0]?.driver_reason || null;
      }
    }

    const nowIso = new Date().toISOString();

    if (!targetId) {
      return {
        success: true,
        longStopId: '00000000-0000-0000-0000-000000000000',
        tripId,
        schoolId,
        status: 'RESOLVED',
        eventCreated: false,
        schoolNotified: false,
        reasonStored: false,
        resolved: true,
        resolvedAt: nowIso,
        message: 'No active long stop found on this trip to resolve',
      };
    }

    await query(
      `UPDATE long_stops
       SET status = 'RESOLVED',
           resolved_at = NOW(),
           resolved_by = $1,
           resolution_notes = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [resolvedBy || null, resolutionNotes || 'Resolved manually by coordinator', targetId]
    );

    RealtimeFeedService.publish({
      type: 'NOTIFICATION_ALERT',
      schoolId,
      busId: trip.bus_id,
      tripId,
      timestamp: nowIso,
      notificationAlert: {
        id: targetId,
        eventType: 'UNUSUAL_STOP',
        priority: 'NORMAL',
        title: 'Long Stop Resolved',
        message: `Long stop manually resolved by transport coordinator: ${resolutionNotes || 'Clear'}`,
        recipientRole: 'TRANSPORT_COORDINATOR',
      },
    });

    return {
      success: true,
      longStopId: targetId,
      tripId,
      schoolId,
      status: 'RESOLVED',
      eventCreated: true,
      schoolNotified: true,
      reasonStored: Boolean(currentReason),
      driverReason: currentReason,
      resolved: true,
      resolvedAt: nowIso,
      message: 'Long stop event successfully resolved',
    };
  }

  /**
   * Coordinator acknowledges long stop event (Micro-phase 26.3)
   */
  static async acknowledgeLongStop(params: {
    schoolId: string;
    tripId: string;
    longStopId?: string;
    acknowledgedBy: string;
    notes?: string;
  }): Promise<LongStopWorkflowResult> {
    const { schoolId, tripId, longStopId, acknowledgedBy, notes } = params;

    const tripRows = await query<{ id: string; bus_id: string }>(
      `SELECT id, bus_id FROM trips WHERE id = $1 AND school_id = $2`,
      [tripId, schoolId]
    );
    if (tripRows.length === 0) {
      throw new NotFoundError(`Trip with ID '${tripId}' not found for school '${schoolId}'`);
    }

    let targetId = longStopId || null;
    let currentReason: string | null = null;

    if (targetId) {
      const match = await query<{ id: string; driver_reason: string | null }>(
        `SELECT id, driver_reason FROM long_stops WHERE id = $1 AND trip_id = $2`,
        [targetId, tripId]
      );
      if (match.length === 0) {
        throw new NotFoundError(`Long stop '${targetId}' not found on trip '${tripId}'`);
      }
      currentReason = match[0]?.driver_reason || null;
    } else {
      const active = await query<{ id: string; driver_reason: string | null }>(
        `SELECT id, driver_reason FROM long_stops WHERE trip_id = $1 AND status = 'ACTIVE' LIMIT 1`,
        [tripId]
      );
      if (active.length > 0) {
        targetId = active[0]!.id;
        currentReason = active[0]?.driver_reason || null;
      }
    }

    if (!targetId) {
      throw new NotFoundError(`No active long stop found for trip '${tripId}'`);
    }

    await query(
      `UPDATE long_stops
       SET acknowledged_by = $1,
           acknowledged_at = NOW(),
           driver_notes = COALESCE($2, driver_notes),
           updated_at = NOW()
       WHERE id = $3`,
      [acknowledgedBy, notes || null, targetId]
    );

    return {
      success: true,
      longStopId: targetId,
      tripId,
      schoolId,
      status: 'ACTIVE',
      eventCreated: true,
      schoolNotified: true,
      reasonStored: Boolean(currentReason),
      driverReason: currentReason,
      resolved: false,
      message: 'Long stop event acknowledged by coordinator',
    };
  }

  /**
   * Retrieves all currently active long stops across the school's fleet.
   */
  static async getActiveLongStops(schoolId: string): Promise<LongStopRecord[]> {
    const rows = await query<{
      id: string;
      school_id: string;
      trip_id: string;
      bus_id: string;
      driver_id: string | null;
      latitude: number;
      longitude: number;
      started_at: Date;
      duration_seconds: number;
      threshold_minutes: number;
      speed_kmh: number;
      status: 'ACTIVE' | 'RESOLVED';
      stop_type: string;
      driver_reason?: string | null;
      driver_notes?: string | null;
      reason_reported_at?: Date | null;
      reason_source?: string | null;
      resolved_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, school_id, trip_id, bus_id, driver_id,
              latitude, longitude, started_at, duration_seconds,
              threshold_minutes, speed_kmh, status, stop_type,
              driver_reason, driver_notes, reason_reported_at, reason_source,
              resolved_at, created_at, updated_at
       FROM long_stops
       WHERE school_id = $1 AND status = 'ACTIVE'
       ORDER BY started_at DESC`,
      [schoolId]
    );

    return rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      tripId: r.trip_id,
      busId: r.bus_id,
      driverId: r.driver_id ?? undefined,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      startedAt: new Date(r.started_at).toISOString(),
      durationSeconds: Number(r.duration_seconds),
      thresholdMinutes: Number(r.threshold_minutes),
      speedKmh: Number(r.speed_kmh),
      status: r.status,
      stopType: r.stop_type || 'UNKNOWN',
      driverReason: r.driver_reason ?? undefined,
      driverNotes: r.driver_notes ?? undefined,
      reasonReportedAt: r.reason_reported_at ? new Date(r.reason_reported_at).toISOString() : undefined,
      reasonSource: r.reason_source ?? undefined,
      resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : undefined,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }

  /**
   * Records driver reason for a long stop (Micro-phase 26.2)
   * Standard reasons: TRAFFIC, VEHICLE_PROBLEM, STUDENT_ISSUE, ROAD_BLOCK, OTHER, NO_PROBLEM
   */
  static async recordDriverReason(params: {
    schoolId: string;
    tripId: string;
    driverId?: string;
    reason: LongStopDriverReason;
    notes?: string;
    source?: 'WHATSAPP' | 'APP' | 'MANUAL_OVERRIDE';
    longStopId?: string;
  }): Promise<RecordLongStopReasonResponse> {
    const { schoolId, tripId, driverId, reason, notes, source = 'WHATSAPP', longStopId } = params;

    // 1. Verify trip existence and tenant scope
    const tripRows = await query<{
      id: string;
      school_id: string;
      bus_id: string;
      driver_id: string | null;
      status: string;
    }>(
      `SELECT id, school_id, bus_id, driver_id, status
       FROM trips
       WHERE id = $1 AND school_id = $2`,
      [tripId, schoolId]
    );

    if (tripRows.length === 0) {
      throw new NotFoundError(`Trip with ID '${tripId}' not found for school '${schoolId}'`);
    }

    const trip = tripRows[0]!;

    // 2. Identify target long stop record
    let targetRecordId = longStopId || null;

    if (targetRecordId) {
      const match = await query<{ id: string }>(
        `SELECT id FROM long_stops WHERE id = $1 AND trip_id = $2`,
        [targetRecordId, tripId]
      );
      if (match.length === 0) {
        throw new NotFoundError(`Long stop record with ID '${targetRecordId}' not found on trip '${tripId}'`);
      }
    } else {
      // Find latest active long stop on this trip
      const activeRows = await query<{ id: string }>(
        `SELECT id FROM long_stops
         WHERE trip_id = $1 AND status = 'ACTIVE'
         ORDER BY created_at DESC
         LIMIT 1`,
        [tripId]
      );

      if (activeRows.length > 0) {
        targetRecordId = activeRows[0]!.id;
      } else {
        // Fallback: Find most recent record on this trip
        const recentRows = await query<{ id: string }>(
          `SELECT id FROM long_stops
           WHERE trip_id = $1
           ORDER BY created_at DESC
           LIMIT 1`,
          [tripId]
        );

        if (recentRows.length > 0) {
          targetRecordId = recentRows[0]!.id;
        }
      }
    }

    // 3. Update existing or insert proactive long stop record
    const reasonLabel = LONG_STOP_REASON_LABELS[reason] || reason;
    const nowIso = new Date().toISOString();

    if (targetRecordId) {
      await query(
        `UPDATE long_stops
         SET driver_reason = $1,
             driver_notes = $2,
             reason_reported_at = NOW(),
             reason_source = $3,
             stop_type = CASE
               WHEN $1 = 'TRAFFIC' THEN 'TRAFFIC_HALT'
               WHEN $1 = 'VEHICLE_PROBLEM' THEN 'VEHICLE_BREAKDOWN'
               WHEN $1 = 'ROAD_BLOCK' THEN 'ROUTE_DIVERSION'
               WHEN $1 = 'STUDENT_ISSUE' THEN 'STUDENT_ASSIST'
               ELSE stop_type
             END,
             updated_at = NOW()
         WHERE id = $4`,
        [reason, notes || null, source, targetRecordId]
      );
    } else {
      // Proactive report before threshold triggered automatic detection
      const insertRows = await query<{ id: string }>(
        `INSERT INTO long_stops (
           school_id, trip_id, bus_id, driver_id,
           latitude, longitude, location,
           started_at, duration_seconds, threshold_minutes,
           speed_kmh, status, stop_type,
           driver_reason, driver_notes, reason_reported_at, reason_source,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4,
           0, 0, ST_SetSRID(ST_MakePoint(0, 0), 4326),
           NOW(), 0, 5,
           0, 'ACTIVE', 'DRIVER_REPORTED',
           $5, $6, NOW(), $7,
           NOW(), NOW()
         )
         RETURNING id`,
        [
          schoolId,
          tripId,
          trip.bus_id,
          driverId || trip.driver_id,
          reason,
          notes || null,
          source,
        ]
      );
      targetRecordId = insertRows[0]?.id ?? '00000000-0000-0000-0000-000000000000';
    }

    logger.info('[LongStopDetection] Recorded driver reason for long stop', {
      tripId,
      longStopId: targetRecordId,
      reason,
      source,
    });

    return {
      success: true,
      longStopId: targetRecordId,
      tripId,
      reason,
      reasonLabel,
      notes: notes || null,
      reportedAt: nowIso,
      source,
      message: `Driver reason '${reasonLabel}' recorded successfully`,
    };
  }
}
