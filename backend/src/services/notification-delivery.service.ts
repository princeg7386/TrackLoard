import { query } from '../config/database.js';
import { MessagingService } from './messaging/messaging.service.js';
import { RealtimeFeedService } from './realtime-feed.service.js';
import { logger } from './logger.service.js';
import {
  NotificationEventType,
  NotificationPriority,
  NotificationAlertItem,
  NotificationAlertsQuery,
  NotificationAlertsResponse,
  NotificationDeliveryStats,
  RetryNotificationResponse,
} from '@school-bus/shared';
import { NotFoundError, BadRequestError } from '../middlewares/error.middleware.js';

export class NotificationDeliveryService {
  public static readonly MAX_RETRY_ATTEMPTS = 3;

  /**
   * Broadcasts a real-time notification alert to active dashboard SSE listeners
   */
  public static publishDashboardAlert(params: {
    notificationId: string;
    schoolId: string;
    tripId?: string | null;
    busId?: string | null;
    eventType: NotificationEventType;
    priority: NotificationPriority;
    title: string;
    message: string;
    recipientRole?: string;
    channel?: string;
  }): void {
    try {
      RealtimeFeedService.publish({
        type: 'NOTIFICATION_ALERT',
        schoolId: params.schoolId,
        busId: params.busId || '',
        tripId: params.tripId || '',
        timestamp: new Date().toISOString(),
        notificationAlert: {
          id: params.notificationId,
          eventType: params.eventType,
          priority: params.priority,
          title: params.title,
          message: params.message,
          recipientRole: params.recipientRole || 'ADMIN',
          channel: params.channel || 'WHATSAPP',
        },
      });
    } catch (err) {
      logger.warn('[NotificationDeliveryService] Failed to publish dashboard alert over SSE', {
        error: (err as Error).message,
      });
    }
  }

  /**
   * Handles inbound delivery receipts and status updates from WhatsApp provider webhooks
   */
  public static async handleDeliveryWebhook(
    providerMessageId: string,
    status: 'DELIVERED' | 'READ' | 'FAILED',
    details?: { failureReason?: string; timestamp?: string }
  ): Promise<{ id: string; status: string } | null> {
    const timeIso = details?.timestamp || new Date().toISOString();

    const rows = await query<{ id: string; school_id: string; status: string }>(
      `UPDATE notifications
       SET
         status = $1,
         failure_reason = CASE WHEN $1 = 'FAILED' THEN COALESCE($2, 'Provider delivery failure') ELSE failure_reason END,
         delivered_at = CASE WHEN $1 IN ('DELIVERED', 'READ') AND delivered_at IS NULL THEN $3::timestamptz ELSE delivered_at END,
         read_at = CASE WHEN $1 = 'READ' AND read_at IS NULL THEN $3::timestamptz ELSE read_at END
       WHERE provider_message_id = $4
       RETURNING id, school_id, status`,
      [status, details?.failureReason || null, timeIso, providerMessageId]
    );

    if (rows.length === 0 || !rows[0]) {
      return null;
    }

    logger.info('[NotificationDeliveryService] Webhook delivery status updated', {
      notificationId: rows[0].id,
      providerMessageId,
      status,
    });

    return rows[0];
  }

  /**
   * Retries dispatch of a single failed notification with exponential backoff & max attempt tracking
   */
  public static async retryNotification(
    schoolId: string,
    notificationId: string
  ): Promise<RetryNotificationResponse> {
    const rows = await query<{
      id: string;
      school_id: string;
      trip_id: string | null;
      recipient_phone: string;
      recipient_role: string;
      channel: string;
      template_name: string | null;
      message_body: string;
      status: string;
      event_type: NotificationEventType | null;
      priority: NotificationPriority;
      retry_count: number;
    }>(
      `SELECT id, school_id, trip_id, recipient_phone, recipient_role,
              channel, template_name, message_body, status, event_type,
              priority, retry_count
       FROM notifications
       WHERE id = $1 AND school_id = $2`,
      [notificationId, schoolId]
    );

    if (rows.length === 0 || !rows[0]) {
      throw new NotFoundError(`Notification ${notificationId} not found in this school context`);
    }

    const notif = rows[0];

    if (notif.status !== 'FAILED') {
      throw new BadRequestError(`Cannot retry notification with status '${notif.status}'. Only FAILED notifications can be retried.`);
    }

    const nextRetryCount = notif.retry_count + 1;
    const nowIso = new Date().toISOString();

    try {
      const sendResult = await MessagingService.sendMessage({
        recipientPhone: notif.recipient_phone,
        recipientRole: notif.recipient_role,
        schoolId: notif.school_id,
        directText: notif.message_body,
        templateId: notif.template_name || undefined,
        eventType: notif.event_type || undefined,
        priority: notif.priority,
      });

      // Retry succeeded!
      await query(
        `UPDATE notifications
         SET
           status = 'SENT',
           provider_message_id = $1,
           failure_reason = NULL,
           retry_count = $2,
           last_retry_at = $3,
           next_retry_at = NULL
         WHERE id = $4`,
        [sendResult.messageId, nextRetryCount, nowIso, notificationId]
      );

      return {
        success: true,
        notificationId,
        status: 'SENT',
        retryCount: nextRetryCount,
        message: 'Notification re-dispatched successfully',
      };
    } catch (err) {
      const isExhausted = nextRetryCount >= this.MAX_RETRY_ATTEMPTS;
      // Exponential backoff: 2^retryCount minutes
      const backoffMinutes = Math.pow(2, nextRetryCount);

      await query(
        `UPDATE notifications
         SET
           retry_count = $1,
           last_retry_at = $2,
           failure_reason = $3,
           next_retry_at = CASE WHEN $4::boolean = TRUE THEN NULL ELSE NOW() + ($5 || ' minutes')::interval END
         WHERE id = $6`,
        [
          nextRetryCount,
          nowIso,
          (err as Error).message || 'Retry dispatch failed',
          isExhausted,
          backoffMinutes,
          notificationId,
        ]
      );

      return {
        success: false,
        notificationId,
        status: 'FAILED',
        retryCount: nextRetryCount,
        message: isExhausted
          ? 'Notification retry failed and maximum retry attempts have been exhausted (dead-letter)'
          : `Notification retry failed. Next retry scheduled in ${backoffMinutes} minutes`,
        failureReason: (err as Error).message,
      };
    }
  }

  /**
   * Batch retry worker for failed notifications eligible for retry
   */
  public static async retryPendingFailedNotifications(
    schoolId?: string,
    limit: number = 20
  ): Promise<{ totalRetried: number; succeeded: number; failed: number }> {
    let sql = `
      SELECT id, school_id
      FROM notifications
      WHERE status = 'FAILED'
        AND retry_count < $1
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
    `;
    const params: any[] = [this.MAX_RETRY_ATTEMPTS];

    if (schoolId) {
      params.push(schoolId);
      sql += ` AND school_id = $${params.length}`;
    }

    params.push(limit);
    sql += ` ORDER BY priority = 'CRITICAL' DESC, priority = 'HIGH' DESC, created_at ASC LIMIT $${params.length}`;

    const candidates = await query<{ id: string; school_id: string }>(sql, params);

    let succeeded = 0;
    let failed = 0;

    for (const c of candidates) {
      try {
        const res = await this.retryNotification(c.school_id, c.id);
        if (res.success) {
          succeeded++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    return {
      totalRetried: candidates.length,
      succeeded,
      failed,
    };
  }

  /**
   * Queries paginated operational notification alerts for the school admin dashboard
   */
  public static async getSchoolAlerts(
    schoolId: string,
    filter: NotificationAlertsQuery
  ): Promise<NotificationAlertsResponse> {
    const page = filter.page || 1;
    const limit = filter.limit || 25;
    const offset = (page - 1) * limit;

    let whereSql = `WHERE school_id = $1`;
    const params: any[] = [schoolId];

    if (filter.priority) {
      params.push(filter.priority);
      whereSql += ` AND priority = $${params.length}`;
    }

    if (filter.eventType) {
      params.push(filter.eventType);
      whereSql += ` AND event_type = $${params.length}`;
    }

    if (filter.status) {
      params.push(filter.status);
      whereSql += ` AND status = $${params.length}`;
    }

    if (filter.tripId) {
      params.push(filter.tripId);
      whereSql += ` AND trip_id = $${params.length}`;
    }

    // 1. Total count
    const countRows = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications ${whereSql}`,
      params
    );
    const total = parseInt(countRows[0]?.count || '0', 10);

    // 2. Paginated rows
    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    const rows = await query<any>(
      `SELECT
         id,
         school_id AS "schoolId",
         trip_id AS "tripId",
         recipient_phone AS "recipientPhone",
         recipient_role AS "recipientRole",
         channel,
         template_name AS "templateName",
         message_body AS "messageBody",
         status,
         failure_reason AS "failureReason",
         event_type AS "eventType",
         priority,
         delivered_at AS "deliveredAt",
         read_at AS "readAt",
         retry_count AS "retryCount",
         created_at AS "createdAt"
       FROM notifications
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params
    );

    const alerts: NotificationAlertItem[] = rows.map((r: any) => ({
      id: r.id,
      schoolId: r.schoolId,
      tripId: r.tripId || null,
      recipientPhone: r.recipientPhone,
      recipientRole: r.recipientRole,
      channel: r.channel,
      templateName: r.templateName || null,
      messageBody: r.messageBody,
      status: r.status,
      failureReason: r.failureReason || null,
      eventType: r.eventType || null,
      priority: r.priority || 'NORMAL',
      deliveredAt: r.deliveredAt ? new Date(r.deliveredAt).toISOString() : null,
      readAt: r.readAt ? new Date(r.readAt).toISOString() : null,
      retryCount: Number(r.retryCount) || 0,
      createdAt: new Date(r.createdAt).toISOString(),
    }));

    const totalPages = Math.ceil(total / limit);

    return {
      alerts,
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    };
  }

  /**
   * Aggregates notification delivery metrics for school operations
   */
  public static async getSchoolNotificationStats(
    schoolId: string
  ): Promise<NotificationDeliveryStats> {
    const rows = await query<{
      total_sent: string;
      delivered_count: string;
      read_count: string;
      failed_count: string;
      pending_count: string;
      critical_count: string;
      high_count: string;
      normal_count: string;
      low_count: string;
    }>(
      `SELECT
         COUNT(*)::text AS total_sent,
         COUNT(*) FILTER (WHERE status = 'DELIVERED')::text AS delivered_count,
         COUNT(*) FILTER (WHERE status = 'READ')::text AS read_count,
         COUNT(*) FILTER (WHERE status = 'FAILED')::text AS failed_count,
         COUNT(*) FILTER (WHERE status IN ('QUEUED', 'SENT'))::text AS pending_count,
         COUNT(*) FILTER (WHERE priority = 'CRITICAL')::text AS critical_count,
         COUNT(*) FILTER (WHERE priority = 'HIGH')::text AS high_count,
         COUNT(*) FILTER (WHERE priority = 'NORMAL')::text AS normal_count,
         COUNT(*) FILTER (WHERE priority = 'LOW')::text AS low_count
       FROM notifications
       WHERE school_id = $1`,
      [schoolId]
    );

    const r = rows[0] || {
      total_sent: '0',
      delivered_count: '0',
      read_count: '0',
      failed_count: '0',
      pending_count: '0',
      critical_count: '0',
      high_count: '0',
      normal_count: '0',
      low_count: '0',
    };

    const total = parseInt(r.total_sent, 10);
    const delivered = parseInt(r.delivered_count, 10);
    const read = parseInt(r.read_count, 10);
    const failed = parseInt(r.failed_count, 10);
    const pending = parseInt(r.pending_count, 10);

    const successCount = delivered + read;
    const deliveryRatePercent = total > 0 ? Math.round((successCount / total) * 1000) / 10 : 100;

    return {
      schoolId,
      totalSent: total,
      deliveredCount: delivered,
      readCount: read,
      failedCount: failed,
      pendingCount: pending,
      deliveryRatePercent,
      priorityBreakdown: {
        critical: parseInt(r.critical_count, 10),
        high: parseInt(r.high_count, 10),
        normal: parseInt(r.normal_count, 10),
        low: parseInt(r.low_count, 10),
      },
    };
  }
}
