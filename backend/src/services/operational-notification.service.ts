import { query } from '../config/database.js';
import { MessagingService } from './messaging/messaging.service.js';
import { logger } from './logger.service.js';
import { env } from '../config/env.js';
import {
  NotificationEventType,
  OperationalNotificationResult,
} from '@school-bus/shared';

interface TripContextInfo {
  tripId: string;
  schoolId: string;
  routeId: string;
  routeName: string;
  busId: string;
  busNumber: string;
  driverId: string;
  driverName: string;
  driverPhone: string;
  schoolPhone: string | null;
  schoolEmergencyPhone: string | null;
}

interface StaffContact {
  id: string;
  phone: string;
  name: string;
  role: 'SCHOOL_ADMIN' | 'TRANSPORT_COORDINATOR';
}

interface TripParentInfo {
  parentId: string;
  parentPhone: string;
  parentName: string;
  studentId: string;
  studentName: string;
  trackingToken: string | null;
  notificationsEnabled: boolean;
}

/**
 * Phase 24.3 — Operational Notification Events Service
 * Handles operational anomalies, deviations, safety events, and emergencies:
 * 1. Delay (TRIP_DELAYED)
 * 2. GPS unavailable (GPS_UNAVAILABLE)
 * 3. Route deviation (ROUTE_DEVIATION)
 * 4. Emergency (EMERGENCY_SOS)
 * 5. Unusual stop (UNUSUAL_STOP)
 */
export class OperationalNotificationService {
  // Cooldown durations to avoid notification floods
  public static readonly COOLDOWN_DELAY_MS = 15 * 60 * 1000; // 15 mins
  public static readonly COOLDOWN_GPS_MS = 10 * 60 * 1000; // 10 mins
  public static readonly COOLDOWN_DEVIATION_MS = 10 * 60 * 1000; // 10 mins
  public static readonly COOLDOWN_UNUSUAL_STOP_MS = 15 * 60 * 1000; // 15 mins

  /**
   * Helper: Check if cooldown is active for a trip & event type
   */
  private static async isCooldownActive(
    tripId: string,
    eventType: NotificationEventType,
    cooldownMs: number
  ): Promise<boolean> {
    const recent = await query<{ created_at: string }>(
      `SELECT created_at
       FROM notifications
       WHERE trip_id = $1 AND event_type = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [tripId, eventType]
    );

    if (recent.length === 0 || !recent[0]?.created_at) {
      return false;
    }

    const elapsed = Date.now() - new Date(recent[0].created_at).getTime();
    return elapsed < cooldownMs;
  }

  /**
   * Helper: Load contextual trip details (bus, driver, route, school phones)
   */
  private static async fetchTripContext(
    schoolId: string,
    tripId: string
  ): Promise<TripContextInfo | null> {
    const rows = await query<TripContextInfo>(
      `SELECT
         t.id AS "tripId",
         t.school_id AS "schoolId",
         t.route_id AS "routeId",
         r.name AS "routeName",
         b.id AS "busId",
         b.bus_number AS "busNumber",
         d.id AS "driverId",
         d.full_name AS "driverName",
         d.phone AS "driverPhone",
         s.phone AS "schoolPhone",
         s.emergency_phone AS "schoolEmergencyPhone"
       FROM trips t
       JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
       JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
       JOIN drivers d ON t.driver_id = d.id AND d.deleted_at IS NULL
       JOIN schools s ON t.school_id = s.id AND s.deleted_at IS NULL
       WHERE t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
       LIMIT 1`,
      [tripId, schoolId]
    );

    return rows[0] || null;
  }

  /**
   * Helper: Load school staff contacts (admin / coordinator)
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
   * Helper: Load parents of students on this trip's route
   */
  private static async fetchTripParents(
    schoolId: string,
    routeId: string
  ): Promise<TripParentInfo[]> {
    return await query<TripParentInfo>(
      `SELECT DISTINCT
         p.id AS "parentId",
         p.phone AS "parentPhone",
         p.full_name AS "parentName",
         s.id AS "studentId",
         s.full_name AS "studentName",
         ptt.token AS "trackingToken",
         p.notifications_enabled AS "notificationsEnabled"
       FROM student_stop_assignments ssa
       JOIN pickup_locations pl ON (ssa.pickup_stop_id = pl.id OR ssa.drop_stop_id = pl.id)
         AND pl.route_id = $2 AND pl.deleted_at IS NULL
       JOIN students s ON ssa.student_id = s.id AND s.deleted_at IS NULL
       JOIN parents p ON p.student_id = s.id AND p.deleted_at IS NULL
       LEFT JOIN parent_tracking_tokens ptt
         ON ptt.student_id = s.id AND ptt.revoked_at IS NULL AND ptt.expires_at > NOW() AND ptt.deleted_at IS NULL
       WHERE s.school_id = $1 AND ssa.deleted_at IS NULL`,
      [schoolId, routeId]
    );
  }

  // ===========================================================================
  // 1. Delay (TRIP_DELAYED)
  // ===========================================================================
  public static async notifyTripDelay(params: {
    schoolId: string;
    tripId: string;
    delayMinutes: number;
    stopId?: string | null;
    reason?: string;
  }): Promise<OperationalNotificationResult> {
    const result: OperationalNotificationResult = {
      tripId: params.tripId,
      eventType: 'TRIP_DELAYED',
      notificationsSent: 0,
      recipientsCount: 0,
      cooldownActive: false,
      details: { delayMinutes: params.delayMinutes, reason: params.reason },
    };

    try {
      if (params.delayMinutes < 10) {
        return result; // Minimum threshold 10 minutes
      }

      const isCooldown = await this.isCooldownActive(
        params.tripId,
        'TRIP_DELAYED',
        this.COOLDOWN_DELAY_MS
      );
      if (isCooldown) {
        result.cooldownActive = true;
        return result;
      }

      const trip = await this.fetchTripContext(params.schoolId, params.tripId);
      if (!trip) return result;

      const priority = params.delayMinutes >= 20 ? 'CRITICAL' : 'HIGH';
      const reasonText = params.reason ? ` due to ${params.reason}` : '';

      // 1. Notify Transport Coordinators and Staff
      const staffList = await this.fetchStaffContacts(params.schoolId);
      for (const staff of staffList) {
        const staffMsg = `Fleet Delay Alert: Bus ${trip.busNumber} on route '${trip.routeName}' is delayed by ${params.delayMinutes} minutes${reasonText}.`;
        await MessagingService.sendMessage({
          recipientPhone: staff.phone,
          recipientRole: staff.role,
          schoolId: params.schoolId,
          directText: staffMsg,
          templateId: 'STAFF_DELAY_ALERT',
          eventType: 'TRIP_DELAYED',
          priority,
        });
        result.notificationsSent++;
        result.recipientsCount++;
      }

      // 2. Notify Parents on this route
      const parents = await this.fetchTripParents(params.schoolId, trip.routeId);
      for (const parent of parents) {
        if (!parent.notificationsEnabled) continue;

        const trackingUrl = parent.trackingToken
          ? ` Track live: ${env.PARENT_TRACKING_BASE_URL}?token=${parent.trackingToken}`
          : '';
        const parentMsg = `Transport Delay Notice: Bus ${trip.busNumber} on route '${trip.routeName}' is running approx ${params.delayMinutes} minutes late${reasonText}.${trackingUrl}`;

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
        result.notificationsSent++;
        result.recipientsCount++;
      }

      // 3. Record in delays table for audit logging
      try {
        await query(
          `INSERT INTO delays (
             school_id, trip_id, stop_id, expected_arrival, predicted_arrival,
             delay_minutes, reason, notified_parents_count
           ) VALUES (
             $1, $2, $3, NOW(), NOW() + ($4 || ' minutes')::interval,
             $4, $5, $6
           )`,
          [
            params.schoolId,
            params.tripId,
            params.stopId || null,
            params.delayMinutes,
            params.reason || 'Traffic congestion',
            result.notificationsSent,
          ]
        );
      } catch (err) {
        logger.warn('[OperationalNotificationService] Failed to insert delay record', {
          tripId: params.tripId,
          error: (err as Error).message,
        });
      }
    } catch (err) {
      logger.error('[OperationalNotificationService] notifyTripDelay error (suppressed)', {
        tripId: params.tripId,
        error: (err as Error).message,
      });
    }

    return result;
  }

  // ===========================================================================
  // 2. GPS Unavailable (GPS_UNAVAILABLE)
  // ===========================================================================
  public static async notifyGpsUnavailable(params: {
    schoolId: string;
    tripId: string;
    lastSeenAt?: string;
    reason?: string;
  }): Promise<OperationalNotificationResult> {
    const result: OperationalNotificationResult = {
      tripId: params.tripId,
      eventType: 'GPS_UNAVAILABLE',
      notificationsSent: 0,
      recipientsCount: 0,
      cooldownActive: false,
    };

    try {
      const isCooldown = await this.isCooldownActive(
        params.tripId,
        'GPS_UNAVAILABLE',
        this.COOLDOWN_GPS_MS
      );
      if (isCooldown) {
        result.cooldownActive = true;
        return result;
      }

      const trip = await this.fetchTripContext(params.schoolId, params.tripId);
      if (!trip) return result;

      const lastSeenText = params.lastSeenAt
        ? new Date(params.lastSeenAt).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          })
        : 'recently';

      // 1. Notify Transport Coordinator & Staff
      const staffList = await this.fetchStaffContacts(params.schoolId);
      for (const staff of staffList) {
        const staffMsg = `Operational Alert: GPS signal unavailable for Bus ${trip.busNumber} on route '${trip.routeName}'. Last contact was at ${lastSeenText}. Please verify driver status immediately.`;
        await MessagingService.sendMessage({
          recipientPhone: staff.phone,
          recipientRole: staff.role,
          schoolId: params.schoolId,
          directText: staffMsg,
          templateId: 'STAFF_GPS_LOST_ALERT',
          eventType: 'GPS_UNAVAILABLE',
          priority: 'HIGH',
        });
        result.notificationsSent++;
        result.recipientsCount++;
      }

      // 2. Notify Driver
      if (trip.driverPhone) {
        const driverMsg = `TrackLoard Alert: Your GPS background tracking signal is offline for Bus ${trip.busNumber}. Please ensure location is enabled and open the driver app.`;
        await MessagingService.sendMessage({
          recipientPhone: trip.driverPhone,
          recipientRole: 'DRIVER',
          schoolId: params.schoolId,
          directText: driverMsg,
          templateId: 'DRIVER_GPS_LOST_ALERT',
          eventType: 'GPS_UNAVAILABLE',
          priority: 'HIGH',
        });
        result.notificationsSent++;
        result.recipientsCount++;
      }
    } catch (err) {
      logger.error('[OperationalNotificationService] notifyGpsUnavailable error (suppressed)', {
        tripId: params.tripId,
        error: (err as Error).message,
      });
    }

    return result;
  }

  // ===========================================================================
  // 3. Route Deviation (ROUTE_DEVIATION)
  // ===========================================================================
  public static async notifyRouteDeviation(params: {
    schoolId: string;
    tripId: string;
    deviationDistanceMeters: number;
    latitude: number;
    longitude: number;
    currentSpeedKmh?: number;
  }): Promise<OperationalNotificationResult> {
    const result: OperationalNotificationResult = {
      tripId: params.tripId,
      eventType: 'ROUTE_DEVIATION',
      notificationsSent: 0,
      recipientsCount: 0,
      cooldownActive: false,
      details: {
        deviationDistanceMeters: params.deviationDistanceMeters,
        latitude: params.latitude,
        longitude: params.longitude,
      },
    };

    try {
      const isCooldown = await this.isCooldownActive(
        params.tripId,
        'ROUTE_DEVIATION',
        this.COOLDOWN_DEVIATION_MS
      );
      if (isCooldown) {
        result.cooldownActive = true;
        return result;
      }

      const trip = await this.fetchTripContext(params.schoolId, params.tripId);
      if (!trip) return result;

      const speedText =
        params.currentSpeedKmh != null ? ` (Speed: ${params.currentSpeedKmh} km/h)` : '';

      // 1. Notify Staff
      const staffList = await this.fetchStaffContacts(params.schoolId);
      for (const staff of staffList) {
        const staffMsg = `Safety Alert: Route deviation detected! Bus ${trip.busNumber} on route '${trip.routeName}' is approx ${Math.round(params.deviationDistanceMeters)}m off-route near (${params.latitude.toFixed(4)}, ${params.longitude.toFixed(4)})${speedText}. Immediate check advised.`;
        await MessagingService.sendMessage({
          recipientPhone: staff.phone,
          recipientRole: staff.role,
          schoolId: params.schoolId,
          directText: staffMsg,
          templateId: 'STAFF_ROUTE_DEVIATION_ALERT',
          eventType: 'ROUTE_DEVIATION',
          priority: 'HIGH',
        });
        result.notificationsSent++;
        result.recipientsCount++;
      }

      // 2. Notify Driver
      if (trip.driverPhone) {
        const driverMsg = `Route Warning: Bus ${trip.busNumber} appears to have departed from route '${trip.routeName}'. Please confirm path or contact transport desk.`;
        await MessagingService.sendMessage({
          recipientPhone: trip.driverPhone,
          recipientRole: 'DRIVER',
          schoolId: params.schoolId,
          directText: driverMsg,
          templateId: 'DRIVER_ROUTE_DEVIATION_ALERT',
          eventType: 'ROUTE_DEVIATION',
          priority: 'HIGH',
        });
        result.notificationsSent++;
        result.recipientsCount++;
      }
    } catch (err) {
      logger.error('[OperationalNotificationService] notifyRouteDeviation error (suppressed)', {
        tripId: params.tripId,
        error: (err as Error).message,
      });
    }

    return result;
  }

  // ===========================================================================
  // 4. Emergency (EMERGENCY_SOS)
  // ===========================================================================
  /**
   * Phase 30.3 — School Alert
   *
   * Sends an immediate, enriched SOS alert to all school staff (admin + coordinator)
   * with:
   *  - Live bus location as a Google Maps link (one-tap navigation)
   *  - Driver details: name + direct phone number
   *  - Incident record reference (sosEventId) for dashboard correlation
   *  - Speed at time of alert (if available)
   *  - Route name for operational context
   *
   * Snapshot fields (busNumber, driverName, driverPhone, routeName, speedKmh, sosEventId)
   * are passed from SosService which already has them from Phase 30.2 capture.
   * When omitted (e.g. legacy callers), the method falls back to fetchTripContext().
   *
   * The stale INSERT INTO sos_events that existed here before Phase 30.1 has been
   * removed — SosService.triggerSos() is the single source of truth for SOS records.
   */
  public static async notifyEmergencySos(params: {
    schoolId: string;
    tripId: string;
    triggerSource?: string;
    latitude: number;
    longitude: number;
    notes?: string;
    // ── Phase 30.3 snapshot fields (passed from SosService) ──────────────────
    sosEventId?: string;
    busNumber?: string;
    driverName?: string;
    driverPhone?: string;
    routeName?: string;
    speedKmh?: number;
  }): Promise<OperationalNotificationResult> {
    const result: OperationalNotificationResult = {
      tripId: params.tripId,
      eventType: 'EMERGENCY_SOS',
      notificationsSent: 0,
      recipientsCount: 0,
      cooldownActive: false,
      details: {
        latitude: params.latitude,
        longitude: params.longitude,
        triggerSource: params.triggerSource || 'APP_SOS_BUTTON',
        sosEventId: params.sosEventId,
      },
    };

    try {
      // ── Resolve trip context ─────────────────────────────────────────────
      // When Phase 30.2 snapshot fields are supplied, skip the extra DB JOIN.
      // Fall back to fetchTripContext for legacy / non-snapshot callers.
      let busNumber = params.busNumber;
      let driverName = params.driverName;
      let driverPhone = params.driverPhone;
      let routeName = params.routeName;
      let routeId: string | null = null;
      let schoolPhone: string | null = null;
      let schoolEmergencyPhone: string | null = null;

      const hasSnapshot = !!(busNumber && driverName && driverPhone && routeName);

      if (!hasSnapshot) {
        const trip = await this.fetchTripContext(params.schoolId, params.tripId);
        if (!trip) return result;
        busNumber = trip.busNumber;
        driverName = trip.driverName;
        driverPhone = trip.driverPhone;
        routeName = trip.routeName;
        routeId = trip.routeId;
        schoolPhone = trip.schoolPhone;
        schoolEmergencyPhone = trip.schoolEmergencyPhone;
      } else {
        // Fetch school phones + routeId only (lightweight — needed for parent alert)
        const schoolRows = await query<{
          schoolPhone: string | null;
          schoolEmergencyPhone: string | null;
          routeId: string | null;
        }>(
          `SELECT s.phone AS "schoolPhone", s.emergency_phone AS "schoolEmergencyPhone",
                  t.route_id AS "routeId"
             FROM schools s
             JOIN trips t ON t.school_id = s.id AND t.id = $2 AND t.deleted_at IS NULL
            WHERE s.id = $1 AND s.deleted_at IS NULL
            LIMIT 1`,
          [params.schoolId, params.tripId]
        );
        if (schoolRows.length > 0) {
          schoolPhone = schoolRows[0]!.schoolPhone;
          schoolEmergencyPhone = schoolRows[0]!.schoolEmergencyPhone;
          routeId = schoolRows[0]!.routeId;
        }
      }

      // ── Build live location link ──────────────────────────────────────────
      const mapsUrl = `https://maps.google.com/?q=${params.latitude.toFixed(5)},${params.longitude.toFixed(5)}`;

      // ── Build incident reference line ─────────────────────────────────────
      const incidentRef = params.sosEventId
        ? `Incident ref: SOS-${params.sosEventId.slice(0, 8).toUpperCase()}`
        : '';

      // ── Build speed line ──────────────────────────────────────────────────
      const speedLine =
        params.speedKmh !== undefined && params.speedKmh > 0
          ? `Speed at alert: ${params.speedKmh.toFixed(0)} km/h`
          : '';

      // ── 1. Critical broadcast to Staff & Coordinators ─────────────────────
      const staffList = await this.fetchStaffContacts(params.schoolId);
      for (const staff of staffList) {
        const lines = [
          `🚨 SOS EMERGENCY — Bus ${busNumber}`,
          ``,
          `Route: ${routeName}`,
          `Driver: ${driverName} (${driverPhone})`,
          speedLine,
          `Location: ${mapsUrl}`,
          ``,
          incidentRef,
          `Respond immediately. Check dashboard for live updates.`,
        ].filter((l) => l !== undefined && !(l === speedLine && !speedLine) && !(l === incidentRef && !incidentRef));

        const staffMsg = lines.join('\n');

        await MessagingService.sendMessage({
          recipientPhone: staff.phone,
          recipientRole: staff.role,
          schoolId: params.schoolId,
          directText: staffMsg,
          templateId: 'STAFF_EMERGENCY_SOS',
          eventType: 'EMERGENCY_SOS',
          priority: 'CRITICAL',
        });
        result.notificationsSent++;
        result.recipientsCount++;
      }

      // ── 2. Reassurance message to Parents on this trip ────────────────────
      if (routeId) {
        const parents = await this.fetchTripParents(params.schoolId, routeId);
        const helplineText = schoolPhone || schoolEmergencyPhone || 'School Transport Office';

        for (const parent of parents) {
          const parentMsg = `Safety Alert: An emergency notification was triggered for Bus ${busNumber}. Transport management and school authorities have been alerted and are attending immediately. Helpline: ${helplineText}.`;
          await MessagingService.sendMessage({
            recipientPhone: parent.parentPhone,
            recipientRole: 'PARENT',
            schoolId: params.schoolId,
            studentId: parent.studentId,
            directText: parentMsg,
            templateId: 'PARENT_EMERGENCY_SOS',
            eventType: 'EMERGENCY_SOS',
            priority: 'CRITICAL',
          });
          result.notificationsSent++;
          result.recipientsCount++;
        }
      }
    } catch (err) {
      logger.error('[OperationalNotificationService] notifyEmergencySos error (suppressed)', {
        tripId: params.tripId,
        error: (err as Error).message,
      });
    }

    return result;
  }

  // ===========================================================================
  // 5. Unusual Stop (UNUSUAL_STOP)
  // ===========================================================================
  public static async notifyUnusualStop(params: {
    schoolId: string;
    tripId: string;
    stoppedDurationMinutes: number;
    latitude: number;
    longitude: number;
    nearestStopName?: string;
  }): Promise<OperationalNotificationResult> {
    const result: OperationalNotificationResult = {
      tripId: params.tripId,
      eventType: 'UNUSUAL_STOP',
      notificationsSent: 0,
      recipientsCount: 0,
      cooldownActive: false,
      details: {
        stoppedDurationMinutes: params.stoppedDurationMinutes,
        latitude: params.latitude,
        longitude: params.longitude,
      },
    };

    try {
      const isCooldown = await this.isCooldownActive(
        params.tripId,
        'UNUSUAL_STOP',
        this.COOLDOWN_UNUSUAL_STOP_MS
      );
      if (isCooldown) {
        result.cooldownActive = true;
        return result;
      }

      const trip = await this.fetchTripContext(params.schoolId, params.tripId);
      if (!trip) return result;

      const nearText = params.nearestStopName
        ? ` near ${params.nearestStopName}`
        : ` near (${params.latitude.toFixed(4)}, ${params.longitude.toFixed(4)})`;

      const staffList = await this.fetchStaffContacts(params.schoolId);
      for (const staff of staffList) {
        const staffMsg = `Fleet Alert: Unusual stop detected! Bus ${trip.busNumber} on route '${trip.routeName}' has been stationary outside scheduled stops for ${params.stoppedDurationMinutes} minutes${nearText}. Please check with driver ${trip.driverName} (${trip.driverPhone}).`;
        await MessagingService.sendMessage({
          recipientPhone: staff.phone,
          recipientRole: staff.role,
          schoolId: params.schoolId,
          directText: staffMsg,
          templateId: 'STAFF_UNUSUAL_STOP_ALERT',
          eventType: 'UNUSUAL_STOP',
          priority: 'HIGH',
        });
        result.notificationsSent++;
        result.recipientsCount++;
      }
    } catch (err) {
      logger.error('[OperationalNotificationService] notifyUnusualStop error (suppressed)', {
        tripId: params.tripId,
        error: (err as Error).message,
      });
    }

    return result;
  }
}
