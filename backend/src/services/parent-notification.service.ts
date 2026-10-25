import { query } from '../config/database.js';
import { MessagingService } from './messaging/messaging.service.js';
import { logger } from './logger.service.js';
import { env } from '../config/env.js';
import {
  NotificationEventType,
  ParentNotificationEventResult,
} from '@school-bus/shared';

interface ParentTargetRow {
  tripId: string;
  schoolId: string;
  busNumber: string;
  routeName: string;
  parentId: string;
  parentPhone: string;
  parentName: string;
  studentId: string;
  studentName: string;
  stopName: string;
  trackingToken: string | null;
  notificationsEnabled: boolean;
}

/**
 * Phase 24.2 — Parent Notification Events Service
 * Manages parent notifications across all key transit milestones:
 * 1. Bus started (TRIP_STARTED)
 * 2. 10-minute alert (BUS_APPROACHING_10M)
 * 3. 3-minute / nearby alert (BUS_APPROACHING_3M)
 * 4. Reached pickup (BUS_ARRIVED_STOP)
 * 5. Child boarded (STUDENT_BOARDED)
 * 6. Child dropped (STUDENT_DROPPED)
 * 7. Trip completed (TRIP_COMPLETED)
 *
 * Designed with deduplication, opt-out checking, and non-blocking failure suppression.
 */
export class ParentNotificationService {
  /**
   * Helper to construct live web tracking URL from token
   */
  private static buildTrackingUrl(token: string | null): string | null {
    if (!token) return null;
    return `${env.PARENT_TRACKING_BASE_URL}?token=${token}`;
  }

  /**
   * Helper to format time in Indian Standard Time (IST) or HH:MM AM/PM
   */
  private static formatTime(dateStr?: string): string {
    const d = dateStr ? new Date(dateStr) : new Date();
    try {
      return d.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return d.toISOString().substring(11, 16);
    }
  }

  /**
   * Check if a parent has already received a notification for this trip, student & event
   */
  private static async isAlreadyNotified(
    tripId: string,
    studentId: string,
    eventType: NotificationEventType
  ): Promise<boolean> {
    const existing = await query<{ id: string }>(
      `SELECT id
       FROM notifications
       WHERE trip_id = $1
         AND student_id = $2
         AND event_type = $3
       LIMIT 1`,
      [tripId, studentId, eventType]
    );
    return existing.length > 0;
  }

  // ===========================================================================
  // 1. Bus Started (TRIP_STARTED)
  // ===========================================================================
  public static async notifyTripStarted(params: {
    schoolId: string;
    tripId: string;
    startedAt?: string;
  }): Promise<ParentNotificationEventResult> {
    const result: ParentNotificationEventResult = {
      tripId: params.tripId,
      eventType: 'TRIP_STARTED',
      notificationsSent: 0,
      parentsChecked: 0,
      alreadyNotified: 0,
      optedOut: 0,
    };

    try {
      const candidates = await query<ParentTargetRow>(
        `SELECT DISTINCT
           t.id AS "tripId",
           t.school_id AS "schoolId",
           b.bus_number AS "busNumber",
           r.name AS "routeName",
           p.id AS "parentId",
           p.phone AS "parentPhone",
           p.full_name AS "parentName",
           s.id AS "studentId",
           s.full_name AS "studentName",
           COALESCE(pl.name, 'Designated Stop') AS "stopName",
           ptt.token AS "trackingToken",
           p.notifications_enabled AS "notificationsEnabled"
         FROM trips t
         JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
         JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
         JOIN student_stop_assignments ssa ON ssa.deleted_at IS NULL
         JOIN pickup_locations pl ON (ssa.pickup_stop_id = pl.id OR ssa.drop_stop_id = pl.id) AND pl.route_id = r.id AND pl.deleted_at IS NULL
         JOIN students s ON ssa.student_id = s.id AND s.deleted_at IS NULL
         JOIN parents p ON p.student_id = s.id AND p.deleted_at IS NULL
         LEFT JOIN parent_tracking_tokens ptt
           ON ptt.student_id = s.id AND ptt.revoked_at IS NULL AND ptt.expires_at > NOW() AND ptt.deleted_at IS NULL
         WHERE t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL`,
        [params.tripId, params.schoolId]
      );

      result.parentsChecked = candidates.length;

      for (const row of candidates) {
        if (!row.notificationsEnabled) {
          result.optedOut++;
          continue;
        }

        const alreadySent = await this.isAlreadyNotified(params.tripId, row.studentId, 'TRIP_STARTED');
        if (alreadySent) {
          result.alreadyNotified++;
          continue;
        }

        const trackingUrl = this.buildTrackingUrl(row.trackingToken);
        const linkPart = trackingUrl
          ? ` Track live: ${trackingUrl}`
          : ' Reply TRACK to track bus live.';
        const messageBody = `Namaste ${row.parentName}, Bus ${row.busNumber} on route '${row.routeName}' has started its trip.${linkPart}`;

        await MessagingService.sendMessage({
          recipientPhone: row.parentPhone,
          recipientRole: 'PARENT',
          schoolId: row.schoolId,
          studentId: row.studentId,
          directText: messageBody,
          templateId: 'TRIP_STARTED_ALERT',
          eventType: 'TRIP_STARTED',
          priority: 'NORMAL',
        });

        result.notificationsSent++;
      }
    } catch (err) {
      logger.error('[ParentNotificationService] notifyTripStarted error (suppressed)', {
        tripId: params.tripId,
        error: (err as Error).message,
      });
    }

    return result;
  }

  // ===========================================================================
  // 2. 10-Minute Alert (BUS_APPROACHING_10M)
  // ===========================================================================
  public static async notifyApproaching10Min(params: {
    schoolId: string;
    tripId: string;
    stopId: string;
    etaMinutes: number;
  }): Promise<ParentNotificationEventResult> {
    const result: ParentNotificationEventResult = {
      tripId: params.tripId,
      eventType: 'BUS_APPROACHING_10M',
      notificationsSent: 0,
      parentsChecked: 0,
      alreadyNotified: 0,
      optedOut: 0,
    };

    try {
      const candidates = await query<ParentTargetRow>(
        `SELECT DISTINCT
           t.id AS "tripId",
           t.school_id AS "schoolId",
           b.bus_number AS "busNumber",
           r.name AS "routeName",
           p.id AS "parentId",
           p.phone AS "parentPhone",
           p.full_name AS "parentName",
           s.id AS "studentId",
           s.full_name AS "studentName",
           pl.name AS "stopName",
           ptt.token AS "trackingToken",
           p.notifications_enabled AS "notificationsEnabled"
         FROM trips t
         JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
         JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
         JOIN student_stop_assignments ssa
           ON (ssa.pickup_stop_id = $3 OR ssa.stop_id = $3 OR ssa.drop_stop_id = $3)
           AND ssa.deleted_at IS NULL
         JOIN pickup_locations pl ON pl.id = $3 AND pl.deleted_at IS NULL
         JOIN students s ON ssa.student_id = s.id AND s.deleted_at IS NULL
         JOIN parents p ON p.student_id = s.id AND p.deleted_at IS NULL
         LEFT JOIN parent_tracking_tokens ptt
           ON ptt.student_id = s.id AND ptt.revoked_at IS NULL AND ptt.expires_at > NOW() AND ptt.deleted_at IS NULL
         WHERE t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL`,
        [params.tripId, params.schoolId, params.stopId]
      );

      result.parentsChecked = candidates.length;

      for (const row of candidates) {
        if (!row.notificationsEnabled) {
          result.optedOut++;
          continue;
        }

        const alreadySent = await this.isAlreadyNotified(params.tripId, row.studentId, 'BUS_APPROACHING_10M');
        if (alreadySent) {
          result.alreadyNotified++;
          continue;
        }

        const trackingUrl = this.buildTrackingUrl(row.trackingToken);
        const linkPart = trackingUrl ? ` Track live: ${trackingUrl}` : '';
        const messageBody = `Namaste ${row.parentName}, Bus ${row.busNumber} is approx ${params.etaMinutes} minutes away from ${row.stopName} for ${row.studentName}. Please get ready.${linkPart}`;

        await MessagingService.sendMessage({
          recipientPhone: row.parentPhone,
          recipientRole: 'PARENT',
          schoolId: row.schoolId,
          studentId: row.studentId,
          directText: messageBody,
          templateId: 'APPROACH_10M_ALERT',
          eventType: 'BUS_APPROACHING_10M',
          priority: 'HIGH',
        });

        result.notificationsSent++;
      }
    } catch (err) {
      logger.error('[ParentNotificationService] notifyApproaching10Min error (suppressed)', {
        tripId: params.tripId,
        stopId: params.stopId,
        error: (err as Error).message,
      });
    }

    return result;
  }

  // ===========================================================================
  // 3. 3-Minute / Nearby Alert (BUS_APPROACHING_3M)
  // ===========================================================================
  public static async notifyApproaching3Min(params: {
    schoolId: string;
    tripId: string;
    stopId: string;
    etaMinutes?: number;
    distanceMeters?: number;
  }): Promise<ParentNotificationEventResult> {
    const result: ParentNotificationEventResult = {
      tripId: params.tripId,
      eventType: 'BUS_APPROACHING_3M',
      notificationsSent: 0,
      parentsChecked: 0,
      alreadyNotified: 0,
      optedOut: 0,
    };

    try {
      const candidates = await query<ParentTargetRow>(
        `SELECT DISTINCT
           t.id AS "tripId",
           t.school_id AS "schoolId",
           b.bus_number AS "busNumber",
           r.name AS "routeName",
           p.id AS "parentId",
           p.phone AS "parentPhone",
           p.full_name AS "parentName",
           s.id AS "studentId",
           s.full_name AS "studentName",
           pl.name AS "stopName",
           ptt.token AS "trackingToken",
           p.notifications_enabled AS "notificationsEnabled"
         FROM trips t
         JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
         JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
         JOIN student_stop_assignments ssa
           ON (ssa.pickup_stop_id = $3 OR ssa.stop_id = $3 OR ssa.drop_stop_id = $3)
           AND ssa.deleted_at IS NULL
         JOIN pickup_locations pl ON pl.id = $3 AND pl.deleted_at IS NULL
         JOIN students s ON ssa.student_id = s.id AND s.deleted_at IS NULL
         JOIN parents p ON p.student_id = s.id AND p.deleted_at IS NULL
         LEFT JOIN parent_tracking_tokens ptt
           ON ptt.student_id = s.id AND ptt.revoked_at IS NULL AND ptt.expires_at > NOW() AND ptt.deleted_at IS NULL
         WHERE t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL`,
        [params.tripId, params.schoolId, params.stopId]
      );

      result.parentsChecked = candidates.length;

      for (const row of candidates) {
        if (!row.notificationsEnabled) {
          result.optedOut++;
          continue;
        }

        const alreadySent = await this.isAlreadyNotified(params.tripId, row.studentId, 'BUS_APPROACHING_3M');
        if (alreadySent) {
          result.alreadyNotified++;
          continue;
        }

        const trackingUrl = this.buildTrackingUrl(row.trackingToken);
        const linkPart = trackingUrl ? ` Track: ${trackingUrl}` : '';
        const etaText = params.etaMinutes ? `approx ${params.etaMinutes} mins away` : 'nearby';
        const messageBody = `Namaste ${row.parentName}, Bus ${row.busNumber} is ${etaText} from ${row.stopName}. Please proceed to the pickup point with ${row.studentName}.${linkPart}`;

        await MessagingService.sendMessage({
          recipientPhone: row.parentPhone,
          recipientRole: 'PARENT',
          schoolId: row.schoolId,
          studentId: row.studentId,
          directText: messageBody,
          templateId: 'APPROACH_3M_ALERT',
          eventType: 'BUS_APPROACHING_3M',
          priority: 'HIGH',
        });

        result.notificationsSent++;
      }
    } catch (err) {
      logger.error('[ParentNotificationService] notifyApproaching3Min error (suppressed)', {
        tripId: params.tripId,
        stopId: params.stopId,
        error: (err as Error).message,
      });
    }

    return result;
  }

  // ===========================================================================
  // 4. Reached Pickup (BUS_ARRIVED_STOP)
  // ===========================================================================
  public static async notifyBusArrivedStop(params: {
    schoolId: string;
    tripId: string;
    stopId: string;
    stopName?: string;
  }): Promise<ParentNotificationEventResult> {
    const result: ParentNotificationEventResult = {
      tripId: params.tripId,
      eventType: 'BUS_ARRIVED_STOP',
      notificationsSent: 0,
      parentsChecked: 0,
      alreadyNotified: 0,
      optedOut: 0,
    };

    try {
      const candidates = await query<ParentTargetRow>(
        `SELECT DISTINCT
           t.id AS "tripId",
           t.school_id AS "schoolId",
           b.bus_number AS "busNumber",
           r.name AS "routeName",
           p.id AS "parentId",
           p.phone AS "parentPhone",
           p.full_name AS "parentName",
           s.id AS "studentId",
           s.full_name AS "studentName",
           COALESCE($4, pl.name, 'Designated Stop') AS "stopName",
           ptt.token AS "trackingToken",
           p.notifications_enabled AS "notificationsEnabled"
         FROM trips t
         JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
         JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
         JOIN student_stop_assignments ssa
           ON (ssa.pickup_stop_id = $3 OR ssa.stop_id = $3 OR ssa.drop_stop_id = $3)
           AND ssa.deleted_at IS NULL
         LEFT JOIN pickup_locations pl ON pl.id = $3 AND pl.deleted_at IS NULL
         JOIN students s ON ssa.student_id = s.id AND s.deleted_at IS NULL
         JOIN parents p ON p.student_id = s.id AND p.deleted_at IS NULL
         LEFT JOIN parent_tracking_tokens ptt
           ON ptt.student_id = s.id AND ptt.revoked_at IS NULL AND ptt.expires_at > NOW() AND ptt.deleted_at IS NULL
         WHERE t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL`,
        [params.tripId, params.schoolId, params.stopId, params.stopName || null]
      );

      result.parentsChecked = candidates.length;

      for (const row of candidates) {
        if (!row.notificationsEnabled) {
          result.optedOut++;
          continue;
        }

        const alreadySent = await this.isAlreadyNotified(params.tripId, row.studentId, 'BUS_ARRIVED_STOP');
        if (alreadySent) {
          result.alreadyNotified++;
          continue;
        }

        const trackingUrl = this.buildTrackingUrl(row.trackingToken);
        const linkPart = trackingUrl ? ` Track live: ${trackingUrl}` : '';
        const messageBody = `Namaste ${row.parentName}, Bus ${row.busNumber} has arrived at ${row.stopName}.${linkPart}`;

        await MessagingService.sendMessage({
          recipientPhone: row.parentPhone,
          recipientRole: 'PARENT',
          schoolId: row.schoolId,
          studentId: row.studentId,
          directText: messageBody,
          templateId: 'ARRIVED_STOP_ALERT',
          eventType: 'BUS_ARRIVED_STOP',
          priority: 'NORMAL',
        });

        result.notificationsSent++;
      }
    } catch (err) {
      logger.error('[ParentNotificationService] notifyBusArrivedStop error (suppressed)', {
        tripId: params.tripId,
        stopId: params.stopId,
        error: (err as Error).message,
      });
    }

    return result;
  }

  // ===========================================================================
  // 5. Child Boarded (STUDENT_BOARDED)
  // ===========================================================================
  public static async notifyStudentBoarded(params: {
    schoolId: string;
    tripId: string;
    studentId: string;
    stopId?: string | null;
    recordedAt?: string;
  }): Promise<boolean> {
    try {
      const candidates = await query<ParentTargetRow>(
        `SELECT DISTINCT
           t.id AS "tripId",
           t.school_id AS "schoolId",
           b.bus_number AS "busNumber",
           r.name AS "routeName",
           p.id AS "parentId",
           p.phone AS "parentPhone",
           p.full_name AS "parentName",
           s.id AS "studentId",
           s.full_name AS "studentName",
           COALESCE(pl.name, 'designated stop') AS "stopName",
           ptt.token AS "trackingToken",
           p.notifications_enabled AS "notificationsEnabled"
         FROM trips t
         JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
         JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
         JOIN students s ON s.id = $3 AND s.deleted_at IS NULL
         JOIN parents p ON p.student_id = s.id AND p.deleted_at IS NULL
         LEFT JOIN pickup_locations pl ON pl.id = $4 AND pl.deleted_at IS NULL
         LEFT JOIN parent_tracking_tokens ptt
           ON ptt.student_id = s.id AND ptt.revoked_at IS NULL AND ptt.expires_at > NOW() AND ptt.deleted_at IS NULL
         WHERE t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
         LIMIT 1`,
        [params.tripId, params.schoolId, params.studentId, params.stopId || null]
      );

      if (candidates.length === 0 || !candidates[0]) {
        return false;
      }

      const row = candidates[0];
      if (!row.notificationsEnabled) {
        return false;
      }

      const alreadySent = await this.isAlreadyNotified(params.tripId, row.studentId, 'STUDENT_BOARDED');
      if (alreadySent) {
        return false;
      }

      const timeStr = this.formatTime(params.recordedAt);
      const trackingUrl = this.buildTrackingUrl(row.trackingToken);
      const linkPart = trackingUrl ? ` Track: ${trackingUrl}` : '';
      const messageBody = `Namaste ${row.parentName}, ${row.studentName} has safely boarded Bus ${row.busNumber} at ${row.stopName} (${timeStr}).${linkPart}`;

      await MessagingService.sendMessage({
        recipientPhone: row.parentPhone,
        recipientRole: 'PARENT',
        schoolId: row.schoolId,
        studentId: row.studentId,
        directText: messageBody,
        templateId: 'STUDENT_BOARDED_ALERT',
        eventType: 'STUDENT_BOARDED',
        priority: 'NORMAL',
      });

      return true;
    } catch (err) {
      logger.error('[ParentNotificationService] notifyStudentBoarded error (suppressed)', {
        tripId: params.tripId,
        studentId: params.studentId,
        error: (err as Error).message,
      });
      return false;
    }
  }

  // ===========================================================================
  // 6. Child Dropped (STUDENT_DROPPED)
  // ===========================================================================
  public static async notifyStudentDropped(params: {
    schoolId: string;
    tripId: string;
    studentId: string;
    stopId?: string | null;
    recordedAt?: string;
  }): Promise<boolean> {
    try {
      const candidates = await query<ParentTargetRow>(
        `SELECT DISTINCT
           t.id AS "tripId",
           t.school_id AS "schoolId",
           b.bus_number AS "busNumber",
           r.name AS "routeName",
           p.id AS "parentId",
           p.phone AS "parentPhone",
           p.full_name AS "parentName",
           s.id AS "studentId",
           s.full_name AS "studentName",
           COALESCE(pl.name, 'designated stop') AS "stopName",
           ptt.token AS "trackingToken",
           p.notifications_enabled AS "notificationsEnabled"
         FROM trips t
         JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
         JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
         JOIN students s ON s.id = $3 AND s.deleted_at IS NULL
         JOIN parents p ON p.student_id = s.id AND p.deleted_at IS NULL
         LEFT JOIN pickup_locations pl ON pl.id = $4 AND pl.deleted_at IS NULL
         LEFT JOIN parent_tracking_tokens ptt
           ON ptt.student_id = s.id AND ptt.revoked_at IS NULL AND ptt.expires_at > NOW() AND ptt.deleted_at IS NULL
         WHERE t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
         LIMIT 1`,
        [params.tripId, params.schoolId, params.studentId, params.stopId || null]
      );

      if (candidates.length === 0 || !candidates[0]) {
        return false;
      }

      const row = candidates[0];
      if (!row.notificationsEnabled) {
        return false;
      }

      const alreadySent = await this.isAlreadyNotified(params.tripId, row.studentId, 'STUDENT_DROPPED');
      if (alreadySent) {
        return false;
      }

      const timeStr = this.formatTime(params.recordedAt);
      const messageBody = `Namaste ${row.parentName}, ${row.studentName} has been safely dropped off at ${row.stopName} (${timeStr}). Have a great day!`;

      await MessagingService.sendMessage({
        recipientPhone: row.parentPhone,
        recipientRole: 'PARENT',
        schoolId: row.schoolId,
        studentId: row.studentId,
        directText: messageBody,
        templateId: 'STUDENT_DROPPED_ALERT',
        eventType: 'STUDENT_DROPPED',
        priority: 'NORMAL',
      });

      return true;
    } catch (err) {
      logger.error('[ParentNotificationService] notifyStudentDropped error (suppressed)', {
        tripId: params.tripId,
        studentId: params.studentId,
        error: (err as Error).message,
      });
      return false;
    }
  }

  // ===========================================================================
  // 7. Trip Completed (TRIP_COMPLETED)
  // ===========================================================================
  public static async notifyTripCompleted(params: {
    schoolId: string;
    tripId: string;
    endedAt?: string;
  }): Promise<ParentNotificationEventResult> {
    const result: ParentNotificationEventResult = {
      tripId: params.tripId,
      eventType: 'TRIP_COMPLETED',
      notificationsSent: 0,
      parentsChecked: 0,
      alreadyNotified: 0,
      optedOut: 0,
    };

    try {
      const candidates = await query<ParentTargetRow>(
        `SELECT DISTINCT
           t.id AS "tripId",
           t.school_id AS "schoolId",
           b.bus_number AS "busNumber",
           r.name AS "routeName",
           p.id AS "parentId",
           p.phone AS "parentPhone",
           p.full_name AS "parentName",
           s.id AS "studentId",
           s.full_name AS "studentName",
           COALESCE(pl.name, 'School / Destination') AS "stopName",
           ptt.token AS "trackingToken",
           p.notifications_enabled AS "notificationsEnabled"
         FROM trips t
         JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
         JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
         JOIN student_stop_assignments ssa ON ssa.deleted_at IS NULL
         JOIN pickup_locations pl ON (ssa.pickup_stop_id = pl.id OR ssa.drop_stop_id = pl.id) AND pl.route_id = r.id AND pl.deleted_at IS NULL
         JOIN students s ON ssa.student_id = s.id AND s.deleted_at IS NULL
         JOIN parents p ON p.student_id = s.id AND p.deleted_at IS NULL
         LEFT JOIN parent_tracking_tokens ptt
           ON ptt.student_id = s.id AND ptt.revoked_at IS NULL AND ptt.expires_at > NOW() AND ptt.deleted_at IS NULL
         WHERE t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL`,
        [params.tripId, params.schoolId]
      );

      result.parentsChecked = candidates.length;

      for (const row of candidates) {
        if (!row.notificationsEnabled) {
          result.optedOut++;
          continue;
        }

        const alreadySent = await this.isAlreadyNotified(params.tripId, row.studentId, 'TRIP_COMPLETED');
        if (alreadySent) {
          result.alreadyNotified++;
          continue;
        }

        const messageBody = `Namaste ${row.parentName}, Bus ${row.busNumber} has safely completed its trip on route '${row.routeName}'. ${row.studentName} has reached safely. Thank you.`;

        await MessagingService.sendMessage({
          recipientPhone: row.parentPhone,
          recipientRole: 'PARENT',
          schoolId: row.schoolId,
          studentId: row.studentId,
          directText: messageBody,
          templateId: 'TRIP_COMPLETED_ALERT',
          eventType: 'TRIP_COMPLETED',
          priority: 'NORMAL',
        });

        result.notificationsSent++;
      }
    } catch (err) {
      logger.error('[ParentNotificationService] notifyTripCompleted error (suppressed)', {
        tripId: params.tripId,
        error: (err as Error).message,
      });
    }

    return result;
  }
}
