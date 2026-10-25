import { query } from '../config/database.js';
import { logger } from './logger.service.js';
import {
  NotificationEventType,
  NotificationPriority,
  AntiSpamCheckResult,
  NOTIFICATION_ANTI_SPAM_CONFIG,
} from '@school-bus/shared';

export interface AffectedParentTarget {
  parentId: string;
  parentPhone: string;
  parentName: string;
  studentId: string;
  studentName: string;
  stopId: string;
  stopName: string;
  sequenceOrder: number;
  trackingToken: string | null;
  notificationsEnabled: boolean;
}

/**
 * Phase 24.5 — Notification Anti-Spam & Smart Targeting Service
 * Responsibilities:
 * 1. Event Deduplication: Prevents double-firing from GPS noise, retries, and rapid transitions.
 * 2. Alert Throttling: Enforces recipient burst limits and event-category cooldowns (with CRITICAL bypass).
 * 3. Affected Parent Targeting: Excludes opted-out, absent, already-deboarded, and upstream parents.
 */
export class NotificationAntiSpamService {
  /**
   * 1. Check if an event notification has already been dispatched for this trip + target
   */
  public static async checkDuplicate(params: {
    tripId: string;
    studentId?: string | null;
    stopId?: string | null;
    eventType: NotificationEventType;
    windowMs?: number;
  }): Promise<AntiSpamCheckResult> {
    try {
      let sql = `
        SELECT id, created_at
        FROM notifications
        WHERE trip_id = $1 AND event_type = $2
      `;
      const sqlParams: any[] = [params.tripId, params.eventType];

      if (params.studentId) {
        sqlParams.push(params.studentId);
        sql += ` AND student_id = $${sqlParams.length}`;
      } else if (params.stopId) {
        sqlParams.push(params.stopId);
        sql += ` AND stop_id = $${sqlParams.length}`;
      }

      if (params.windowMs) {
        sqlParams.push(params.windowMs);
        sql += ` AND created_at >= NOW() - ($${sqlParams.length} || ' milliseconds')::interval`;
      }

      sql += ` ORDER BY created_at DESC LIMIT 1`;

      const existing = await query<{ id: string; created_at: string }>(sql, sqlParams);

      if (existing.length > 0) {
        return {
          allowed: false,
          deduplicated: true,
          throttled: false,
          reason: `Duplicate event '${params.eventType}' already dispatched for this trip/target`,
        };
      }

      return {
        allowed: true,
        deduplicated: false,
        throttled: false,
      };
    } catch (err) {
      logger.warn('[NotificationAntiSpamService] checkDuplicate error (suppressed, allowing event)', {
        tripId: params.tripId,
        eventType: params.eventType,
        error: (err as Error).message,
      });
      return { allowed: true, deduplicated: false, throttled: false };
    }
  }

  /**
   * 2. Check if a notification is throttled by burst rate limits or event cooldowns
   */
  public static async checkThrottle(params: {
    recipientPhone: string;
    eventType: NotificationEventType;
    priority: NotificationPriority;
    tripId?: string;
  }): Promise<AntiSpamCheckResult> {
    // Safety Rule: CRITICAL priority notifications (e.g. EMERGENCY_SOS) are NEVER throttled!
    if (params.priority === 'CRITICAL') {
      return { allowed: true, throttled: false, deduplicated: false };
    }

    try {
      // A. Recipient Burst Rate Limit (e.g. max 1 message every 30 seconds to the same phone)
      const recentToPhone = await query<{ created_at: string }>(
        `SELECT created_at
         FROM notifications
         WHERE recipient_phone = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [params.recipientPhone]
      );

      if (recentToPhone.length > 0 && recentToPhone[0]?.created_at) {
        const elapsedSeconds = Math.floor(
          (Date.now() - new Date(recentToPhone[0].created_at).getTime()) / 1000
        );
        const burstLimitSeconds = NOTIFICATION_ANTI_SPAM_CONFIG.BURST_THROTTLE_SECONDS;

        if (elapsedSeconds < burstLimitSeconds) {
          const remaining = burstLimitSeconds - elapsedSeconds;
          return {
            allowed: false,
            throttled: true,
            deduplicated: false,
            cooldownRemainingSeconds: remaining,
            reason: `Burst throttle active: ${remaining}s remaining before next message to this recipient`,
          };
        }
      }

      // B. Event-Category Cooldown for Repeated Anomaly Alerts
      if (params.tripId) {
        let cooldownMinutes = 0;
        if (params.eventType === 'TRIP_DELAYED') {
          cooldownMinutes = NOTIFICATION_ANTI_SPAM_CONFIG.DELAY_ALERT_COOLDOWN_MINUTES;
        } else if (params.eventType === 'GPS_UNAVAILABLE') {
          cooldownMinutes = NOTIFICATION_ANTI_SPAM_CONFIG.GPS_ALERT_COOLDOWN_MINUTES;
        } else if (params.eventType === 'ROUTE_DEVIATION') {
          cooldownMinutes = NOTIFICATION_ANTI_SPAM_CONFIG.DEVIATION_ALERT_COOLDOWN_MINUTES;
        } else if (params.eventType === 'UNUSUAL_STOP') {
          cooldownMinutes = NOTIFICATION_ANTI_SPAM_CONFIG.UNUSUAL_STOP_COOLDOWN_MINUTES;
        }

        if (cooldownMinutes > 0) {
          const recentEvent = await query<{ created_at: string }>(
            `SELECT created_at
             FROM notifications
             WHERE trip_id = $1 AND event_type = $2
             ORDER BY created_at DESC
             LIMIT 1`,
            [params.tripId, params.eventType]
          );

          if (recentEvent.length > 0 && recentEvent[0]?.created_at) {
            const elapsedMinutes = Math.floor(
              (Date.now() - new Date(recentEvent[0].created_at).getTime()) / (60 * 1000)
            );

            if (elapsedMinutes < cooldownMinutes) {
              const remainingSec = (cooldownMinutes - elapsedMinutes) * 60;
              return {
                allowed: false,
                throttled: true,
                deduplicated: false,
                cooldownRemainingSeconds: remainingSec,
                reason: `Cooldown active for '${params.eventType}': ${cooldownMinutes - elapsedMinutes}m remaining`,
              };
            }
          }
        }
      }

      return { allowed: true, throttled: false, deduplicated: false };
    } catch (err) {
      logger.warn('[NotificationAntiSpamService] checkThrottle error (suppressed, allowing event)', {
        recipientPhone: params.recipientPhone,
        eventType: params.eventType,
        error: (err as Error).message,
      });
      return { allowed: true, throttled: false, deduplicated: false };
    }
  }

  /**
   * 3. Select ONLY affected parents based on route, stop sequence, absence, and journey stage
   */
  public static async filterAffectedParents(params: {
    schoolId: string;
    tripId: string;
    routeId: string;
    eventType: NotificationEventType;
    stopId?: string | null;
    isDownstreamOnly?: boolean;
    tripType?: 'MORNING_PICKUP' | 'EVENING_DROP';
  }): Promise<AffectedParentTarget[]> {
    try {
      // A. If isDownstreamOnly and stopId are provided, determine sequence order threshold
      let sequenceOrderThreshold = 0;
      if (params.isDownstreamOnly && params.stopId) {
        const stopRow = await query<{ sequence_order: number }>(
          `SELECT sequence_order
           FROM pickup_locations
           WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
           LIMIT 1`,
          [params.stopId, params.schoolId]
        );
        if (stopRow.length > 0 && stopRow[0]?.sequence_order != null) {
          sequenceOrderThreshold = stopRow[0].sequence_order;
        }
      }

      let sql = `
        SELECT DISTINCT
          p.id AS "parentId",
          p.phone AS "parentPhone",
          p.full_name AS "parentName",
          s.id AS "studentId",
          s.full_name AS "studentName",
          pl.id AS "stopId",
          pl.name AS "stopName",
          pl.sequence_order AS "sequenceOrder",
          ptt.token AS "trackingToken",
          p.notifications_enabled AS "notificationsEnabled"
        FROM student_stop_assignments ssa
        JOIN pickup_locations pl ON (ssa.pickup_stop_id = pl.id OR ssa.drop_stop_id = pl.id OR ssa.stop_id = pl.id)
          AND pl.route_id = $2 AND pl.deleted_at IS NULL
        JOIN students s ON ssa.student_id = s.id AND s.deleted_at IS NULL
        JOIN parents p ON p.student_id = s.id AND p.deleted_at IS NULL
        LEFT JOIN parent_tracking_tokens ptt
          ON ptt.student_id = s.id AND ptt.revoked_at IS NULL AND ptt.expires_at > NOW() AND ptt.deleted_at IS NULL
        WHERE s.school_id = $1
          AND ssa.deleted_at IS NULL
          AND p.notifications_enabled = TRUE
      `;
      const queryParams: any[] = [params.schoolId, params.routeId];

      // Anti-Spam Filter 1: Stop Isolation (when specific stop alert like BUS_APPROACHING)
      if (params.stopId && !params.isDownstreamOnly) {
        queryParams.push(params.stopId);
        sql += ` AND (ssa.pickup_stop_id = $${queryParams.length} OR ssa.drop_stop_id = $${queryParams.length} OR ssa.stop_id = $${queryParams.length})`;
      }

      // Anti-Spam Filter 2: Downstream Stop Isolation (for stop delays)
      if (params.isDownstreamOnly && sequenceOrderThreshold > 0) {
        queryParams.push(sequenceOrderThreshold);
        sql += ` AND pl.sequence_order >= $${queryParams.length}`;
      }

      // Anti-Spam Filter 3: Exclude students marked absent for today
      sql += `
        AND NOT EXISTS (
          SELECT 1
          FROM absence_records ar
          WHERE ar.student_id = s.id
            AND ar.school_id = $1
            AND ar.absence_date = CURRENT_DATE
            AND ar.deleted_at IS NULL
        )
      `;

      // Anti-Spam Filter 4: Exclude students already deboarded on this trip
      queryParams.push(params.tripId);
      sql += `
        AND NOT EXISTS (
          SELECT 1
          FROM drop_events de
          WHERE de.trip_id = $${queryParams.length}
            AND de.student_id = s.id
            AND de.status = 'DEBOARDED'
        )
      `;

      // Sort in stop sequence order
      sql += ` ORDER BY pl.sequence_order ASC, s.full_name ASC`;

      const rows = await query<any>(sql, queryParams);

      return rows.map((r: any) => ({
        parentId: r.parentId,
        parentPhone: r.parentPhone,
        parentName: r.parentName,
        studentId: r.studentId,
        studentName: r.studentName,
        stopId: r.stopId,
        stopName: r.stopName,
        sequenceOrder: Number(r.sequenceOrder) || 0,
        trackingToken: r.trackingToken || null,
        notificationsEnabled: Boolean(r.notificationsEnabled),
      }));
    } catch (err) {
      logger.error('[NotificationAntiSpamService] filterAffectedParents error (suppressed)', {
        schoolId: params.schoolId,
        tripId: params.tripId,
        error: (err as Error).message,
      });
      return [];
    }
  }

  /**
   * 4. Unified anti-spam evaluation method
   */
  public static async evaluateAntiSpam(params: {
    schoolId: string;
    tripId: string;
    eventType: NotificationEventType;
    priority?: NotificationPriority;
    recipientPhone?: string;
    stopId?: string | null;
    studentId?: string | null;
    isDownstreamOnly?: boolean;
    routeId?: string;
  }): Promise<{
    allowed: boolean;
    duplicateCheck: AntiSpamCheckResult;
    throttleCheck?: AntiSpamCheckResult;
    affectedParentsCount?: number;
    rejectionReason?: string;
  }> {
    const priority = params.priority || 'NORMAL';

    // 1. Check duplicate
    const duplicateCheck = await this.checkDuplicate({
      tripId: params.tripId,
      eventType: params.eventType,
      studentId: params.studentId,
      stopId: params.stopId,
    });

    if (!duplicateCheck.allowed) {
      return {
        allowed: false,
        duplicateCheck,
        rejectionReason: duplicateCheck.reason,
      };
    }

    // 2. Check throttle (if recipientPhone provided)
    let throttleCheck: AntiSpamCheckResult | undefined;
    if (params.recipientPhone) {
      throttleCheck = await this.checkThrottle({
        recipientPhone: params.recipientPhone,
        eventType: params.eventType,
        priority,
        tripId: params.tripId,
      });

      if (!throttleCheck.allowed) {
        return {
          allowed: false,
          duplicateCheck,
          throttleCheck,
          rejectionReason: throttleCheck.reason,
        };
      }
    }

    // 3. Count affected parents if routeId is provided
    let affectedParentsCount: number | undefined;
    if (params.routeId) {
      const affected = await this.filterAffectedParents({
        schoolId: params.schoolId,
        tripId: params.tripId,
        routeId: params.routeId,
        eventType: params.eventType,
        stopId: params.stopId,
        isDownstreamOnly: params.isDownstreamOnly,
      });
      affectedParentsCount = affected.length;
    }

    return {
      allowed: true,
      duplicateCheck,
      throttleCheck,
      affectedParentsCount,
    };
  }
}
