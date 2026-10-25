import { randomUUID } from 'crypto';
import { query } from '../config/database.js';
import { logger } from './logger.service.js';
import {
  NotificationEventType,
  NotificationEventTypeSchema,
  NotificationPriority,
  NotificationPrioritySchema,
  NotificationRecipientRole,
  NotificationRecipient,
  NotificationRecipientSchema,
  NotificationEventPayload,
  NotificationEventPayloadSchema,
  getNotificationEventDefaultPriority,
  getNotificationEventDefaultRoles,
  isUrgentNotificationPriority,
} from '@school-bus/shared';

/**
 * Phase 24.1 — Notification Event Domain Service
 * Manages event lifecycle, recipient resolution, and priority triage.
 */
export class NotificationEventService {
  /**
   * Constructs and validates a standardized NotificationEventPayload
   */
  public static createEvent(params: {
    schoolId: string;
    eventType: NotificationEventType;
    title: string;
    message: string;
    priority?: NotificationPriority;
    tripId?: string | null;
    studentId?: string | null;
    stopId?: string | null;
    busId?: string | null;
    driverId?: string | null;
    metadata?: Record<string, unknown>;
    eventId?: string;
    createdAt?: string;
  }): NotificationEventPayload {
    // 1. Validate event type
    const validatedType = NotificationEventTypeSchema.parse(params.eventType);

    // 2. Determine effective priority
    const effectivePriority = params.priority
      ? NotificationPrioritySchema.parse(params.priority)
      : getNotificationEventDefaultPriority(validatedType);

    // 3. Assemble and parse complete payload
    const eventPayload: NotificationEventPayload = {
      eventId: params.eventId || randomUUID(),
      schoolId: params.schoolId,
      eventType: validatedType,
      priority: effectivePriority,
      tripId: params.tripId ?? null,
      studentId: params.studentId ?? null,
      stopId: params.stopId ?? null,
      busId: params.busId ?? null,
      driverId: params.driverId ?? null,
      title: params.title.trim(),
      message: params.message.trim(),
      metadata: params.metadata || {},
      createdAt: params.createdAt || new Date().toISOString(),
    };

    return NotificationEventPayloadSchema.parse(eventPayload);
  }

  /**
   * Resolves priority with contextual escalation rules
   * e.g., Extreme delay (>= 20 min) escalates TRIP_DELAYED to CRITICAL
   */
  public static resolveEventPriority(
    eventType: NotificationEventType,
    context?: {
      delayMinutes?: number;
      isSevere?: boolean;
      explicitPriority?: NotificationPriority;
    }
  ): NotificationPriority {
    if (context?.explicitPriority) {
      return NotificationPrioritySchema.parse(context.explicitPriority);
    }

    if (context?.isSevere) {
      return 'CRITICAL';
    }

    if (eventType === 'TRIP_DELAYED' && context?.delayMinutes && context.delayMinutes >= 20) {
      return 'CRITICAL';
    }

    return getNotificationEventDefaultPriority(eventType);
  }

  /**
   * Resolves default recipient roles for an event type
   */
  public static resolveDefaultRoles(eventType: NotificationEventType): NotificationRecipientRole[] {
    return getNotificationEventDefaultRoles(eventType);
  }

  /**
   * Checks whether the priority indicates an urgent notification
   */
  public static isUrgent(priority: NotificationPriority): boolean {
    return isUrgentNotificationPriority(priority);
  }

  /**
   * Validates arbitrary payload against NotificationEventPayloadSchema
   */
  public static validatePayload(payload: unknown): {
    isValid: boolean;
    data?: NotificationEventPayload;
    error?: string;
  } {
    const result = NotificationEventPayloadSchema.safeParse(payload);
    if (result.success) {
      return { isValid: true, data: result.data };
    }
    return {
      isValid: false,
      error: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
    };
  }

  /**
   * Resolves actual recipient records (parents, driver, coordinator) for a trip and event
   */
  public static async resolveRecipientsForTrip(
    schoolId: string,
    tripId: string,
    eventType: NotificationEventType,
    options?: { stopId?: string | null; studentId?: string | null }
  ): Promise<NotificationRecipient[]> {
    const roles = getNotificationEventDefaultRoles(eventType);
    const recipients: NotificationRecipient[] = [];

    try {
      // 1. Resolve Parents if PARENT role is included
      if (roles.includes('PARENT')) {
        let parentQuery = `
          SELECT DISTINCT
            p.id            AS "parentId",
            p.phone         AS "phone",
            p.full_name     AS "name",
            s.id            AS "studentId"
          FROM student_stop_assignments ssa
          JOIN students s ON ssa.student_id = s.id AND s.deleted_at IS NULL
          JOIN parents p ON p.student_id = s.id AND p.deleted_at IS NULL
          JOIN trips t ON t.id = $1 AND t.school_id = $2
          WHERE s.school_id = $2
            AND p.notifications_enabled = TRUE
        `;
        const params: (string | null)[] = [tripId, schoolId];

        if (options?.studentId) {
          params.push(options.studentId);
          parentQuery += ` AND s.id = $${params.length}`;
        } else if (options?.stopId) {
          params.push(options.stopId);
          parentQuery += ` AND (ssa.pickup_stop_id = $${params.length} OR ssa.stop_id = $${params.length})`;
        }

        const parentRows = await query<{
          parentId: string;
          phone: string;
          name: string;
          studentId: string;
        }>(parentQuery, params);

        for (const row of parentRows) {
          if (row.phone) {
            recipients.push({
              id: row.parentId,
              schoolId,
              phone: row.phone,
              role: 'PARENT',
              name: row.name,
              studentId: row.studentId,
              tripId,
              parentId: row.parentId,
              preferredChannel: 'WHATSAPP',
            });
          }
        }
      }

      // 2. Resolve Driver if DRIVER role is included
      if (roles.includes('DRIVER')) {
        const driverRows = await query<{
          id: string;
          phone: string;
          name: string;
        }>(
          `SELECT d.id, d.phone, d.full_name AS "name"
           FROM trips t
           JOIN drivers d ON t.driver_id = d.id AND d.deleted_at IS NULL
           WHERE t.id = $1 AND t.school_id = $2`,
          [tripId, schoolId]
        );

        for (const row of driverRows) {
          if (row.phone) {
            recipients.push({
              id: row.id,
              schoolId,
              phone: row.phone,
              role: 'DRIVER',
              name: row.name,
              tripId,
              preferredChannel: 'WHATSAPP',
            });
          }
        }
      }

      // 3. Resolve Admin / Transport Coordinator if applicable
      const hasStaffRole =
        roles.includes('SCHOOL_ADMIN') ||
        roles.includes('TRANSPORT_COORDINATOR') ||
        roles.includes('ADMIN');

      if (hasStaffRole) {
        // Query users with staff roles
        const staffRows = await query<{
          id: string;
          phone: string | null;
          name: string;
          role: string;
        }>(
          `SELECT u.id, u.phone, u.full_name AS "name", u.role
           FROM users u
           WHERE u.school_id = $1
             AND u.role IN ('ADMIN', 'TRANSPORT_COORDINATOR', 'SUPERADMIN')
             AND u.deleted_at IS NULL
             AND u.phone IS NOT NULL`,
          [schoolId]
        );

        for (const row of staffRows) {
          if (row.phone) {
            const role: NotificationRecipientRole =
              row.role === 'TRANSPORT_COORDINATOR'
                ? 'TRANSPORT_COORDINATOR'
                : 'SCHOOL_ADMIN';

            recipients.push({
              id: row.id,
              schoolId,
              phone: row.phone,
              role,
              name: row.name,
              tripId,
              preferredChannel: 'WHATSAPP',
            });
          }
        }
      }
    } catch (err) {
      logger.error('Failed to resolve trip recipients for notification event', {
        schoolId,
        tripId,
        eventType,
        error: (err as Error).message,
      });
    }

    return recipients;
  }

  /**
   * Logs a dispatched or queued notification event directly to database
   */
  public static async recordNotification(data: {
    schoolId: string;
    recipientPhone: string;
    recipientRole?: NotificationRecipientRole;
    channel?: 'WHATSAPP' | 'SMS' | 'PUSH' | 'WEBHOOK';
    templateName?: string;
    messageBody: string;
    status?: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
    eventType?: NotificationEventType;
    priority?: NotificationPriority;
    tripId?: string | null;
    studentId?: string | null;
    parentId?: string | null;
    providerMessageId?: string | null;
    failureReason?: string | null;
  }): Promise<string> {
    const priority =
      data.priority ||
      (data.eventType ? getNotificationEventDefaultPriority(data.eventType) : 'NORMAL');

    const result = await query<{ id: string }>(
      `INSERT INTO notifications (
         school_id, recipient_phone, recipient_role, channel,
         template_name, message_body, status, provider_message_id,
         failure_reason, event_type, priority, trip_id, student_id, parent_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        data.schoolId,
        data.recipientPhone,
        data.recipientRole || 'PARENT',
        data.channel || 'WHATSAPP',
        data.templateName || null,
        data.messageBody,
        data.status || 'SENT',
        data.providerMessageId || null,
        data.failureReason || null,
        data.eventType || null,
        priority,
        data.tripId || null,
        data.studentId || null,
        data.parentId || null,
      ]
    );

    if (!result[0]?.id) {
      throw new Error('Failed to record notification: no ID returned from insert');
    }
    return result[0].id;
  }
}
