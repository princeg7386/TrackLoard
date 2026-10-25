import { query } from '../config/database.js';
import { logger } from './logger.service.js';
import { MessagingService } from './messaging/messaging.service.js';
import { NotificationAntiSpamService } from './notification-anti-spam.service.js';
import { DelayIntelligenceService } from './delay-intelligence.service.js';
import { DelaySpamControlService } from './delay-spam-control.service.js';
import { RealtimeFeedService } from './realtime-feed.service.js';
import {
  DelayAlertDispatchResult,
  DelayAlertDispatchResultSchema,
  DelayRecoveryResult,
  DelayRecoveryResultSchema,
  NotificationPriority,
} from '@school-bus/shared';
import { NotFoundError } from '../middlewares/error.middleware.js';

interface TripContext {
  id: string;
  schoolId: string;
  routeId: string;
  routeName: string;
  busId: string;
  busNumber: string;
  driverId: string;
  driverName: string;
  driverPhone: string;
}

interface StaffContact {
  id: string;
  phone: string;
  name: string;
  role: 'SCHOOL_ADMIN' | 'TRANSPORT_COORDINATOR';
}

export class DelayNotificationService {
  /**
   * Helper: Fetch trip and vehicle context
   */
  private static async fetchTripContext(
    tripId: string,
    schoolId: string
  ): Promise<TripContext> {
    const rows = await query<any>(
      `SELECT
         t.id,
         t.school_id AS "schoolId",
         t.route_id AS "routeId",
         r.name AS "routeName",
         b.id AS "busId",
         b.bus_number AS "busNumber",
         d.id AS "driverId",
         d.full_name AS "driverName",
         d.phone AS "driverPhone"
       FROM trips t
       JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
       JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
       JOIN drivers d ON t.driver_id = d.id AND d.deleted_at IS NULL
       WHERE t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
       LIMIT 1`,
      [tripId, schoolId]
    );

    if (rows.length === 0 || !rows[0]) {
      throw new NotFoundError(`Trip ${tripId} not found for school ${schoolId}`);
    }

    return rows[0];
  }

  /**
   * Helper: Fetch transport staff contacts
   */
  private static async fetchStaffContacts(schoolId: string): Promise<StaffContact[]> {
    const rows = await query<{
      id: string;
      phone: string;
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

    return rows.map((r) => ({
      id: r.id,
      phone: r.phone,
      name: r.name,
      role: r.role === 'TRANSPORT_COORDINATOR' ? 'TRANSPORT_COORDINATOR' : 'SCHOOL_ADMIN',
    }));
  }

  /**
   * Helper: Format time string into Indian Standard Time (HH:MM AM/PM)
   */
  private static formatTimeIst(isoString: string): string {
    try {
      return new Date(isoString).toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return isoString.substring(11, 16);
    }
  }

  /**
   * 1. Send Delay Alert & Update Live ETA
   * Dispatches WhatsApp alerts to waiting parents and staff, records active delay,
   * and pushes real-time ETA update across SSE streams.
   */
  public static async dispatchDelayAlert(params: {
    schoolId: string;
    tripId: string;
    minDelayMinutes?: number;
    reason?: string;
  }): Promise<DelayAlertDispatchResult> {
    const minDelay = params.minDelayMinutes ?? 10;
    const trip = await this.fetchTripContext(params.tripId, params.schoolId);

    // 1. Identify upcoming affected pickups and waiting parents
    const affectedResult = await DelayIntelligenceService.identifyWaitingParents({
      schoolId: params.schoolId,
      tripId: params.tripId,
      minDelayMinutes: minDelay,
    });

    if (
      affectedResult.overallDelayMinutes < minDelay ||
      affectedResult.waitingParentsCount === 0
    ) {
      return {
        tripId: params.tripId,
        schoolId: params.schoolId,
        dispatched: false,
        cooldownActive: false,
        spamControlled: false,
        isEscalation: false,
        delayMinutes: affectedResult.overallDelayMinutes,
        affectedParentsCount: affectedResult.waitingParentsCount,
        notificationsSent: 0,
        message:
          affectedResult.waitingParentsCount === 0
            ? 'No waiting parents found at affected stops'
            : `Trip delay (${affectedResult.overallDelayMinutes}m) below threshold (${minDelay}m)`,
      };
    }

    const priority: NotificationPriority =
      affectedResult.overallDelayMinutes >= 20 ? 'CRITICAL' : 'HIGH';

    // 2. Micro-phase 25.5: Spam Control Evaluation
    // Avoids repeated identical delay messages and filters out minor fluctuations (1-4 mins)
    const spamEval = await DelaySpamControlService.evaluateSpamControl({
      tripId: params.tripId,
      schoolId: params.schoolId,
      currentDelayMinutes: affectedResult.overallDelayMinutes,
    });

    if (!spamEval.allowed) {
      return {
        tripId: params.tripId,
        schoolId: params.schoolId,
        dispatched: false,
        cooldownActive: false,
        spamControlled: true,
        isEscalation: false,
        delayMinutes: affectedResult.overallDelayMinutes,
        affectedParentsCount: affectedResult.waitingParentsCount,
        notificationsSent: 0,
        message: spamEval.reason || 'Delay notification suppressed by spam control',
      };
    }

    // 3. Anti-spam throttle check (15m cooldown on TRIP_DELAYED alerts)
    const throttleCheck = await NotificationAntiSpamService.checkThrottle({
      recipientPhone: trip.driverPhone,
      eventType: 'TRIP_DELAYED',
      priority,
      tripId: params.tripId,
    });

    if (!throttleCheck.allowed) {
      return {
        tripId: params.tripId,
        schoolId: params.schoolId,
        dispatched: false,
        cooldownActive: true,
        spamControlled: false,
        isEscalation: spamEval.isEscalation,
        delayMinutes: affectedResult.overallDelayMinutes,
        affectedParentsCount: affectedResult.waitingParentsCount,
        notificationsSent: 0,
        message: throttleCheck.reason || 'Delay alert cooldown active',
      };
    }

    const isEscalation = spamEval.isEscalation;
    const updatePrefix = isEscalation ? 'Delay Update: ' : '';
    const furtherDelayPart =
      isEscalation && spamEval.deltaMinutes ? ` (+${spamEval.deltaMinutes}m further delay)` : '';
    const reasonText = params.reason ? ` due to ${params.reason}` : '';
    let notificationsSent = 0;

    // 4. Dispatch WhatsApp messages to waiting parents
    for (const parent of affectedResult.waitingParents) {
      const predictedTime = this.formatTimeIst(parent.predictedArrival);
      const trackingUrlPart = parent.trackingUrl ? ` Track live: ${parent.trackingUrl}` : '';
      const parentMsg = `Namaste ${parent.parentName}, ${updatePrefix}Bus ${trip.busNumber} on route '${trip.routeName}' is running approx ${parent.delayMinutes} minutes late${furtherDelayPart}${reasonText} for ${parent.studentName} at ${parent.stopName}. New expected arrival: ${predictedTime}.${trackingUrlPart}`;

      try {
        await MessagingService.sendMessage({
          recipientPhone: parent.parentPhone,
          recipientRole: 'PARENT',
          schoolId: params.schoolId,
          studentId: parent.studentId,
          directText: parentMsg,
          templateId: 'PARENT_DELAY_ALERT',
          eventType: 'TRIP_DELAYED',
          priority,
        });
        notificationsSent++;
      } catch (err: any) {
        logger.warn(
          `[DelayNotificationService] Failed to send delay alert to parent ${parent.parentPhone}: ${err.message}`
        );
      }
    }

    // 4. Dispatch alert to school transport coordinators and staff
    const staffContacts = await this.fetchStaffContacts(params.schoolId);
    for (const staff of staffContacts) {
      const staffMsg = `Fleet Delay Alert: Bus ${trip.busNumber} on route '${trip.routeName}' is delayed by ${affectedResult.overallDelayMinutes} minutes${reasonText} (${affectedResult.waitingParentsCount} waiting parents affected).`;
      try {
        await MessagingService.sendMessage({
          recipientPhone: staff.phone,
          recipientRole: staff.role,
          schoolId: params.schoolId,
          directText: staffMsg,
          templateId: 'STAFF_DELAY_ALERT',
          eventType: 'TRIP_DELAYED',
          priority,
        });
        notificationsSent++;
      } catch (err: any) {
        logger.warn(
          `[DelayNotificationService] Failed to send delay alert to staff ${staff.phone}: ${err.message}`
        );
      }
    }

    // 5. Insert operational record into delays table
    let delayRecordId: string | null = null;
    try {
      const delayRows = await query<{ id: string }>(
        `INSERT INTO delays (
           school_id, trip_id, stop_id, expected_arrival, predicted_arrival,
           delay_minutes, reason, notified_parents_count
         ) VALUES (
           $1, $2, $3, NOW(), NOW() + ($4 || ' minutes')::interval,
           $4, $5, $6
         ) RETURNING id`,
        [
          params.schoolId,
          params.tripId,
          affectedResult.affectedPickups[0]?.stopId || null,
          affectedResult.overallDelayMinutes,
          params.reason || null,
          affectedResult.waitingParentsCount,
        ]
      );
      if (delayRows.length > 0 && delayRows[0]) {
        delayRecordId = delayRows[0].id;
      }
    } catch (err: any) {
      logger.warn(`[DelayNotificationService] Failed to insert delay record: ${err.message}`);
    }

    // 6. Update ETA & Push Real-Time SSE Feed Updates
    const firstPickup = affectedResult.affectedPickups[0];
    RealtimeFeedService.publish({
      type: 'ETA_UPDATE',
      schoolId: params.schoolId,
      tripId: params.tripId,
      busId: trip.busId,
      timestamp: new Date().toISOString(),
      nextStopEtaSeconds: (affectedResult.overallDelayMinutes * 60),
      nextStopName: firstPickup?.stopName || 'Upcoming Stop',
    });

    RealtimeFeedService.publish({
      type: 'NOTIFICATION_ALERT',
      schoolId: params.schoolId,
      tripId: params.tripId,
      busId: trip.busId,
      timestamp: new Date().toISOString(),
      notificationAlert: {
        id: delayRecordId || trip.id,
        eventType: 'TRIP_DELAYED',
        priority,
        title: 'Trip Delay Notice',
        message: `Bus ${trip.busNumber} on route '${trip.routeName}' is running ${affectedResult.overallDelayMinutes}m late`,
        recipientRole: 'TRANSPORT_COORDINATOR',
      },
    });

    const result: DelayAlertDispatchResult = {
      tripId: params.tripId,
      schoolId: params.schoolId,
      dispatched: true,
      cooldownActive: false,
      spamControlled: false,
      isEscalation,
      delayMinutes: affectedResult.overallDelayMinutes,
      affectedParentsCount: affectedResult.waitingParentsCount,
      notificationsSent,
      delayRecordId,
      message: `${isEscalation ? 'Delay escalation alert' : 'Delay alert'} successfully dispatched to ${affectedResult.waitingParentsCount} waiting parents and ${staffContacts.length} staff`,
    };

    return DelayAlertDispatchResultSchema.parse(result);
  }

  /**
   * 2. Send Recovery Update When Appropriate
   * Detects when a bus catches up and resolves active delay record,
   * notifying parents and staff that the bus is back on schedule.
   */
  public static async checkAndDispatchRecoveryUpdate(params: {
    schoolId: string;
    tripId: string;
  }): Promise<DelayRecoveryResult> {
    const trip = await this.fetchTripContext(params.tripId, params.schoolId);

    // 1. Check for active unresolved delay record
    const activeDelays = await query<{
      id: string;
      delay_minutes: number;
      notified_parents_count: number;
    }>(
      `SELECT id, delay_minutes, notified_parents_count
       FROM delays
       WHERE trip_id = $1 AND school_id = $2 AND resolved_at IS NULL AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [params.tripId, params.schoolId]
    );

    if (activeDelays.length === 0 || !activeDelays[0]) {
      return {
        tripId: params.tripId,
        schoolId: params.schoolId,
        recovered: false,
        delayRecordId: null,
        initialDelayMinutes: 0,
        currentDelayMinutes: 0,
        parentsNotified: 0,
        message: 'No active unresolved delay found for trip',
      };
    }

    const activeDelay = activeDelays[0];

    // 2. Evaluate current live delay
    const currentComparison = await DelayIntelligenceService.compareTripTimeline(
      params.tripId,
      params.schoolId
    );

    // Recovery criteria: overall delay is now <= 5 mins (ON_TIME)
    // or has improved by >= 7 minutes from initial delay
    const isRecovered =
      currentComparison.overallDelayMinutes <= 5 ||
      activeDelay.delay_minutes - currentComparison.overallDelayMinutes >= 7;

    if (!isRecovered) {
      return {
        tripId: params.tripId,
        schoolId: params.schoolId,
        recovered: false,
        delayRecordId: activeDelay.id,
        initialDelayMinutes: activeDelay.delay_minutes,
        currentDelayMinutes: currentComparison.overallDelayMinutes,
        parentsNotified: 0,
        message: `Trip delay (${currentComparison.overallDelayMinutes}m) is still active`,
      };
    }

    // 3. Mark delay resolved in database
    await query(
      `UPDATE delays
       SET resolved_at = NOW()
       WHERE id = $1`,
      [activeDelay.id]
    );

    let parentsNotified = 0;

    // 4. If parents were previously alerted, dispatch recovery notices
    if (activeDelay.notified_parents_count > 0) {
      const waitingResult = await DelayIntelligenceService.identifyWaitingParents({
        schoolId: params.schoolId,
        tripId: params.tripId,
        minDelayMinutes: 0, // all remaining waiting parents
      });

      for (const parent of waitingResult.waitingParents) {
        const predictedTime = this.formatTimeIst(parent.predictedArrival);
        const trackingUrlPart = parent.trackingUrl ? ` Track live: ${parent.trackingUrl}` : '';
        const recoveryMsg = `Namaste ${parent.parentName}, Good news! Bus ${trip.busNumber} on route '${trip.routeName}' has made up time and is now running on schedule for ${parent.studentName} at ${parent.stopName}. Expected arrival: ${predictedTime}.${trackingUrlPart}`;

        try {
          await MessagingService.sendMessage({
            recipientPhone: parent.parentPhone,
            recipientRole: 'PARENT',
            schoolId: params.schoolId,
            studentId: parent.studentId,
            directText: recoveryMsg,
            templateId: 'DELAY_RECOVERED_NOTICE',
            eventType: 'TRIP_DELAYED',
            priority: 'NORMAL',
          });
          parentsNotified++;
        } catch (err: any) {
          logger.warn(
            `[DelayNotificationService] Failed to send recovery notice to parent ${parent.parentPhone}: ${err.message}`
          );
        }
      }

      // Notify transport staff
      const staffContacts = await this.fetchStaffContacts(params.schoolId);
      for (const staff of staffContacts) {
        const staffMsg = `Delay Resolved: Bus ${trip.busNumber} on route '${trip.routeName}' has recovered lost time and is back on schedule (current delay: ${currentComparison.overallDelayMinutes}m).`;
        try {
          await MessagingService.sendMessage({
            recipientPhone: staff.phone,
            recipientRole: staff.role,
            schoolId: params.schoolId,
            directText: staffMsg,
            templateId: 'STAFF_DELAY_RECOVERED',
            eventType: 'TRIP_DELAYED',
            priority: 'NORMAL',
          });
        } catch (err: any) {
          logger.warn(
            `[DelayNotificationService] Failed to send recovery notice to staff ${staff.phone}: ${err.message}`
          );
        }
      }
    }

    // 5. Update ETA & Push Real-Time SSE Recovery Feed
    RealtimeFeedService.publish({
      type: 'ETA_UPDATE',
      schoolId: params.schoolId,
      tripId: params.tripId,
      busId: trip.busId,
      timestamp: new Date().toISOString(),
      nextStopEtaSeconds: Math.max(0, currentComparison.overallDelayMinutes * 60),
    });

    RealtimeFeedService.publish({
      type: 'NOTIFICATION_ALERT',
      schoolId: params.schoolId,
      tripId: params.tripId,
      busId: trip.busId,
      timestamp: new Date().toISOString(),
      notificationAlert: {
        id: activeDelay.id,
        eventType: 'TRIP_DELAYED',
        priority: 'NORMAL',
        title: 'Schedule Recovered',
        message: `Bus ${trip.busNumber} on route '${trip.routeName}' has recovered lost time and is back on schedule`,
        recipientRole: 'TRANSPORT_COORDINATOR',
      },
    });

    const result: DelayRecoveryResult = {
      tripId: params.tripId,
      schoolId: params.schoolId,
      recovered: true,
      delayRecordId: activeDelay.id,
      initialDelayMinutes: activeDelay.delay_minutes,
      currentDelayMinutes: currentComparison.overallDelayMinutes,
      parentsNotified,
      message: `Delay successfully resolved. Recovery update sent to ${parentsNotified} waiting parents.`,
    };

    return DelayRecoveryResultSchema.parse(result);
  }
}
