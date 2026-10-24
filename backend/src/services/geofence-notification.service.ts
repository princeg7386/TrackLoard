import { query } from '../config/database.js';
import { GeoCoordinates, GeofenceNotificationResult } from '@school-bus/shared';
import { SpatialService } from './spatial.service.js';
import { MessagingService } from './messaging/messaging.service.js';
import { logger } from './logger.service.js';
import { env } from '../config/env.js';

/**
 * A parent record that is eligible to receive an approach notification.
 */
interface EligibleParent {
  parentId: string;
  studentId: string;
  schoolId: string;
  parentPhone: string;
  parentName: string;
  studentName: string;
  stopId: string;
  stopName: string;
  distanceMeters: number;
  trackingToken: string | null;
}

/**
 * Phase 21.1 — Geofence Notification Service
 *
 * Sends a WhatsApp approach notification to parents when the bus enters the
 * geofence radius of their child's pickup stop, at most once per
 * (trip, stop, student) combination.
 *
 * Called fire-and-forget from TelemetryService after every GPS ping.
 * All errors are swallowed so the telemetry path is never blocked.
 */
export class GeofenceNotificationService {
  /**
   * Default search radius used to find "nearby" stops before doing the
   * per-stop geofence check.  Picks up stops up to 500 m away so the
   * notification arrives a little before the bus is actually at the stop.
   */
  private static readonly APPROACH_SEARCH_RADIUS_METERS = 500;

  /**
   * Entry point: check all stops for this trip that are within approach radius
   * of the current bus position, then notify eligible parents.
   *
   * @param tripId   Active trip UUID
   * @param busCoords  Current GPS fix from the latest telemetry ping
   * @param etaMinutes Smoothed ETA in minutes for the next stop (optional)
   */
  static async checkAndNotify(
    tripId: string,
    busCoords: GeoCoordinates,
    etaMinutes?: number
  ): Promise<GeofenceNotificationResult> {
    const result: GeofenceNotificationResult = {
      tripId,
      notificationsSent: 0,
      stopsChecked: 0,
      alreadyNotified: 0,
      optedOut: 0,
    };

    // 1. Find all stops within approach radius via PostGIS
    let nearbyStops;
    try {
      nearbyStops = await SpatialService.findStopsNearCoordinates(
        tripId,
        busCoords,
        GeofenceNotificationService.APPROACH_SEARCH_RADIUS_METERS
      );
    } catch (err) {
      logger.warn('GeofenceNotificationService: spatial query failed', {
        tripId,
        error: err instanceof Error ? err.message : String(err),
      });
      return result;
    }

    result.stopsChecked = nearbyStops.length;

    if (nearbyStops.length === 0) {
      return result;
    }

    const stopIds = nearbyStops.map((s) => s.id);

    // 2. Find eligible parents for these stops (students assigned to stops,
    //    parents with notifications enabled, and no existing log entry for
    //    this trip+stop+student combination)
    let eligible: EligibleParent[];
    try {
      eligible = await GeofenceNotificationService.fetchEligibleParents(tripId, stopIds);
    } catch (err) {
      logger.warn('GeofenceNotificationService: eligibility query failed', {
        tripId,
        error: err instanceof Error ? err.message : String(err),
      });
      return result;
    }

    if (eligible.length === 0) {
      return result;
    }

    // Build a quick distance map keyed by stopId for message text
    const distanceByStop = new Map(nearbyStops.map((s) => [s.id, s.distanceMeters]));

    // 3. For each eligible parent: send WhatsApp, then write dedup log row
    for (const parent of eligible) {
      const distanceMeters = distanceByStop.get(parent.stopId) ?? 0;
      const trackingUrl = parent.trackingToken
        ? `${env.PARENT_TRACKING_BASE_URL}?token=${parent.trackingToken}`
        : null;

      const messageBody = GeofenceNotificationService.buildApproachMessage({
        studentName: parent.studentName,
        stopName: parent.stopName,
        distanceMeters,
        etaMinutes,
        trackingUrl,
      });

      let messageSid: string | null = null;
      try {
        const sendResult = await MessagingService.sendMessage({
          recipientPhone: parent.parentPhone,
          recipientRole: 'PARENT',
          schoolId: parent.schoolId,
          studentId: parent.studentId,
          directText: messageBody,
          templateId: 'GEOFENCE_APPROACH',
        });
        messageSid = sendResult.messageId;
        result.notificationsSent += 1;
        logger.info('GeofenceNotificationService: approach notification sent', {
          tripId,
          stopId: parent.stopId,
          studentId: parent.studentId,
          parentId: parent.parentId,
        });
      } catch (err) {
        logger.warn('GeofenceNotificationService: message dispatch failed', {
          tripId,
          stopId: parent.stopId,
          parentId: parent.parentId,
          error: err instanceof Error ? err.message : String(err),
        });
        // Skip dedup log if dispatch failed — allow retry on next ping
        continue;
      }

      // 4. Insert dedup log row (idempotent — unique constraint on trip+stop+student)
      try {
        await query(
          `INSERT INTO geofence_notification_log
             (trip_id, stop_id, student_id, parent_id, school_id,
              trigger_distance_meters, eta_minutes, message_sid)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (trip_id, stop_id, student_id) DO NOTHING`,
          [
            tripId,
            parent.stopId,
            parent.studentId,
            parent.parentId,
            parent.schoolId,
            distanceMeters,
            etaMinutes ?? null,
            messageSid,
          ]
        );
      } catch (err) {
        // Log the DB error but do not fail — notification already sent
        logger.error('GeofenceNotificationService: dedup log insert failed', {
          tripId,
          stopId: parent.stopId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
  }

  /**
   * Fetches parents eligible for an approach notification for the given stops.
   * Excludes:
   * - parents with notifications_enabled = false
   * - parents already notified for this (trip, stop, student) combination
   */
  private static async fetchEligibleParents(
    tripId: string,
    stopIds: string[]
  ): Promise<EligibleParent[]> {
    if (stopIds.length === 0) {
      return [];
    }

    // Build $N placeholders for stop IDs
    const placeholders = stopIds.map((_, i) => `$${i + 2}`).join(', ');

    const sql = `
      SELECT
        p.id                          AS "parentId",
        s.id                          AS "studentId",
        s.school_id                   AS "schoolId",
        p.phone                       AS "parentPhone",
        p.full_name                   AS "parentName",
        s.full_name                   AS "studentName",
        pl.id                         AS "stopId",
        pl.stop_name                  AS "stopName",
        ptt.token                     AS "trackingToken"
      FROM student_stop_assignments ssa
      JOIN students s            ON ssa.student_id = s.id
      JOIN pickup_locations pl   ON ssa.stop_id = pl.id
      JOIN parents p             ON p.student_id = s.id
      LEFT JOIN parent_tracking_tokens ptt
                                 ON ptt.student_id = s.id
                                 AND ptt.expires_at > NOW()
                                 AND ptt.revoked_at IS NULL
      WHERE ssa.stop_id = ANY(ARRAY[${placeholders}]::uuid[])
        AND s.deleted_at IS NULL
        AND p.notifications_enabled = TRUE
        -- Dedup: exclude already-notified combinations for this trip
        AND NOT EXISTS (
          SELECT 1
          FROM geofence_notification_log gnl
          WHERE gnl.trip_id = $1
            AND gnl.stop_id = ssa.stop_id
            AND gnl.student_id = ssa.student_id
        )
      ORDER BY pl.sequence_order ASC, s.full_name ASC
    `;

    const params: unknown[] = [tripId, ...stopIds];
    return query<EligibleParent>(sql, params);
  }

  /**
   * Builds the plain-text WhatsApp approach notification message.
   */
  private static buildApproachMessage(opts: {
    studentName: string;
    stopName: string;
    distanceMeters: number;
    etaMinutes?: number;
    trackingUrl: string | null;
  }): string {
    const distanceText =
      opts.distanceMeters >= 1000
        ? `${(opts.distanceMeters / 1000).toFixed(1)} km`
        : `${Math.round(opts.distanceMeters)} m`;

    const etaText =
      opts.etaMinutes !== undefined && opts.etaMinutes !== null
        ? `Arriving in approximately *${opts.etaMinutes} min*.`
        : 'Arriving soon.';

    const lines = [
      `🚌 *Bus Approaching* — ${opts.studentName}'s pickup stop`,
      `📍 Stop: *${opts.stopName}* (${distanceText} away)`,
      etaText,
    ];

    if (opts.trackingUrl) {
      lines.push(`🔴 Live tracking: ${opts.trackingUrl}`);
    }

    lines.push('Please ensure your child is ready at the stop.');
    return lines.join('\n');
  }
}
