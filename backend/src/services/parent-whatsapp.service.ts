import {
  ParentWhatsAppAction,
  ParentWhatsAppMenuItem,
  ParentWhatsAppMenuResponse,
  ParentWhatsAppInboundRequest,
  ParentWhatsAppInboundResponse,
  ParentTrackBusResponse,
  ParentMyEtaResponse,
  ParentMyChildResponse,
  ParentMyPickupResponse,
  ParentPickupUpdateRequest,
  ParentPickupUpdateResult,
  TripStatus,
  normalizeIndianPhoneNumber,
} from '@school-bus/shared';
import { query } from '../config/database.js';
import { MessagingService } from './messaging/messaging.service.js';
import { logger } from './logger.service.js';
import { ParentIdentityService } from './parent-identity.service.js';
import { EtaService } from './eta.service.js';
import { DynamicPickupService } from './dynamic-pickup/dynamic-pickup.service.js';
import { NotFoundError } from '../middlewares/error.middleware.js';
import { env } from '../config/env.js';

export interface ParentContextRecord {
  parentId: string;
  parentName: string;
  parentPhone: string;
  parentEmail?: string;
  relationship: string;
  schoolId: string;
  schoolName: string;
  schoolCode?: string;
  schoolPhone?: string;
  schoolEmergencyPhone?: string;
  studentId: string;
  studentName: string;
  admissionNumber?: string;
  classGrade?: string;
  section?: string;
  rollNumber?: string;
  pickupStop?: {
    id: string;
    stopName: string;
    scheduledTime?: string;
    sequenceOrder?: number;
    geofenceRadiusMeters?: number;
    latitude?: number;
    longitude?: number;
  } | null;
}

export interface ParentActiveTripContext {
  id: string;
  routeId: string;
  routeName?: string;
  routeCode?: string;
  routeType?: string;
  status: TripStatus;
  busId: string;
  busNumber?: string;
  registrationNumber?: string;
  driverId: string;
  driverName?: string;
  driverPhone?: string;
  scheduledStartTime?: string;
  delayMinutes?: number;
  currentStopSequence?: number;
  totalStops?: number;
  lastGpsLocation?: {
    latitude: number;
    longitude: number;
    speedKmh: number;
    bearingDegrees?: number;
    recordedAt: string;
  } | null;
}

export class ParentWhatsappService {
  /**
   * Normalizes Indian phone numbers into consistent international format (+91...)
   */
  public static normalizeIndianPhone(rawPhone: string): {
    international: string;
    national10: string;
    variants: string[];
  } {
    const digits = rawPhone.replace(/\D/g, '');
    let national10 = digits;

    if (digits.length === 10) {
      national10 = digits;
    } else if (digits.length === 11 && digits.startsWith('0')) {
      national10 = digits.substring(1);
    } else if (digits.length === 12 && digits.startsWith('91')) {
      national10 = digits.substring(2);
    } else if (digits.length > 10) {
      national10 = digits.slice(-10);
    }

    const international = `+91${national10}`;
    const variants = [
      international,
      `91${national10}`,
      national10,
      `0${national10}`,
    ];

    return { international, national10, variants };
  }

  /**
   * Resolves parent record with attached student, school, and pickup stop by phone number.
   * Follows strict product boundary: 1:1 direct access context per student token/link.
   */
  public static async findParentByPhone(
    phone: string,
    schoolId?: string
  ): Promise<ParentContextRecord | null> {
    const { variants, national10 } = this.normalizeIndianPhone(phone);

    const rows = await query<{
      parent_id: string;
      parent_name: string;
      parent_phone: string;
      parent_email: string | null;
      relationship: string;
      school_id: string;
      school_name: string;
      school_code: string | null;
      school_phone: string | null;
      school_emergency_phone: string | null;
      student_id: string;
      student_name: string;
      admission_number: string | null;
      class_grade: string | null;
      section: string | null;
      roll_number: string | null;
      stop_id: string | null;
      stop_name: string | null;
      scheduled_time: string | null;
      sequence_order: number | null;
      geofence_radius_meters: number | null;
      stop_lat: number | null;
      stop_lon: number | null;
    }>(
      `SELECT 
         p.id AS parent_id,
         p.full_name AS parent_name,
         p.phone AS parent_phone,
         p.email AS parent_email,
         p.relationship,
         sch.id AS school_id,
         sch.name AS school_name,
         sch.code AS school_code,
         sch.phone AS school_phone,
         sch.emergency_contact_phone AS school_emergency_phone,
         s.id AS student_id,
         s.full_name AS student_name,
         s.admission_number,
         s.class_grade,
         s.section,
         s.roll_number,
         pl.id AS stop_id,
         pl.stop_name,
         pl.scheduled_time::text AS scheduled_time,
         pl.sequence_order,
         pl.geofence_radius_meters,
         ST_Y(pl.location::geometry) AS stop_lat,
         ST_X(pl.location::geometry) AS stop_lon
       FROM parents p
       JOIN students s ON p.student_id = s.id AND s.deleted_at IS NULL
       JOIN schools sch ON p.school_id = sch.id AND sch.deleted_at IS NULL
       LEFT JOIN student_stop_assignments ssa ON s.id = ssa.student_id AND ssa.deleted_at IS NULL
       LEFT JOIN pickup_locations pl ON ssa.pickup_stop_id = pl.id AND pl.deleted_at IS NULL
       WHERE (
         p.phone = $1 OR p.phone = $2 OR p.phone = $3 OR p.phone = $4
         OR RIGHT(p.phone, 10) = $5
       )
       AND ($6::uuid IS NULL OR p.school_id = $6::uuid)
       AND p.deleted_at IS NULL
       ORDER BY p.created_at ASC
       LIMIT 1`,
      [variants[0], variants[1], variants[2], variants[3], national10, schoolId || null]
    );

    if (rows.length === 0 || !rows[0]) {
      return null;
    }

    const r = rows[0];
    return {
      parentId: r.parent_id,
      parentName: r.parent_name,
      parentPhone: r.parent_phone,
      parentEmail: r.parent_email || undefined,
      relationship: r.relationship,
      schoolId: r.school_id,
      schoolName: r.school_name,
      schoolCode: r.school_code || undefined,
      schoolPhone: r.school_phone || undefined,
      schoolEmergencyPhone: r.school_emergency_phone || undefined,
      studentId: r.student_id,
      studentName: r.student_name,
      admissionNumber: r.admission_number || undefined,
      classGrade: r.class_grade || undefined,
      section: r.section || undefined,
      rollNumber: r.roll_number || undefined,
      pickupStop: r.stop_id
        ? {
            id: r.stop_id,
            stopName: r.stop_name || 'Assigned Stop',
            scheduledTime: r.scheduled_time || undefined,
            sequenceOrder: r.sequence_order || undefined,
            geofenceRadiusMeters: r.geofence_radius_meters || undefined,
            latitude: r.stop_lat !== null ? Number(r.stop_lat) : undefined,
            longitude: r.stop_lon !== null ? Number(r.stop_lon) : undefined,
          }
        : null,
    };
  }

  /**
   * Resolves active or today's scheduled trip context for the student's route/stop
   */
  public static async getParentTripContext(
    schoolId: string,
    stopId?: string | null
  ): Promise<ParentActiveTripContext | null> {
    if (!stopId) {
      return null;
    }

    // 1. Look for currently active trip (IN_TRANSIT or DELAYED) for the route containing the stop
    const activeRows = await query<{
      id: string;
      route_id: string;
      status: string;
      bus_id: string;
      bus_number: string | null;
      registration_number: string | null;
      driver_id: string;
      driver_name: string | null;
      driver_phone: string | null;
      route_name: string | null;
      route_code: string | null;
      route_type: string | null;
      delay_minutes: number | null;
      current_stop_sequence: number | null;
      total_stops: number | null;
      latitude: number | null;
      longitude: number | null;
      speed_kmh: number | null;
      bearing_degrees: number | null;
      gps_recorded_at: string | null;
    }>(
      `SELECT t.id, t.route_id, t.status, t.bus_id, t.driver_id, t.delay_minutes,
              t.current_stop_sequence,
              b.bus_number, b.registration_number,
              d.full_name AS driver_name, d.phone AS driver_phone,
              r.name AS route_name, r.code AS route_code, r.route_type,
              (SELECT COUNT(*)::int FROM pickup_locations WHERE route_id = t.route_id AND deleted_at IS NULL) AS total_stops,
              ST_Y(gps.location::geometry) AS latitude,
              ST_X(gps.location::geometry) AS longitude,
              gps.speed_kmh,
              gps.bearing_degrees,
              gps.recorded_at::text AS gps_recorded_at
       FROM trips t
       JOIN pickup_locations pl ON pl.route_id = t.route_id AND pl.deleted_at IS NULL
       LEFT JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
       LEFT JOIN drivers d ON t.driver_id = d.id AND d.deleted_at IS NULL
       LEFT JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT location, speed_kmh, bearing_degrees, recorded_at
         FROM gps_locations
         WHERE trip_id = t.id
         ORDER BY recorded_at DESC
         LIMIT 1
       ) gps ON TRUE
       WHERE pl.id = $1 AND t.school_id = $2
         AND t.status IN ('IN_TRANSIT', 'DELAYED', 'ARRIVED_SCHOOL')
         AND t.deleted_at IS NULL
       ORDER BY CASE WHEN t.status = 'IN_TRANSIT' THEN 1 WHEN t.status = 'DELAYED' THEN 2 ELSE 3 END,
                t.started_at DESC NULLS LAST
       LIMIT 1`,
      [stopId, schoolId]
    );

    if (activeRows.length > 0 && activeRows[0]) {
      const a = activeRows[0];
      let lastGpsLocation: ParentActiveTripContext['lastGpsLocation'] = null;

      if (
        a.latitude !== null &&
        a.latitude !== undefined &&
        !isNaN(Number(a.latitude)) &&
        a.longitude !== null &&
        a.longitude !== undefined &&
        !isNaN(Number(a.longitude))
      ) {
        lastGpsLocation = {
          latitude: Number(a.latitude),
          longitude: Number(a.longitude),
          speedKmh:
            a.speed_kmh !== null && a.speed_kmh !== undefined && !isNaN(Number(a.speed_kmh))
              ? Number(a.speed_kmh)
              : 0,
          bearingDegrees:
            a.bearing_degrees !== null && a.bearing_degrees !== undefined
              ? Number(a.bearing_degrees)
              : undefined,
          recordedAt: a.gps_recorded_at || new Date().toISOString(),
        };
      }

      return {
        id: a.id,
        routeId: a.route_id,
        routeName: a.route_name || undefined,
        routeCode: a.route_code || undefined,
        routeType: a.route_type || undefined,
        status: a.status as TripStatus,
        busId: a.bus_id,
        busNumber: a.bus_number || undefined,
        registrationNumber: a.registration_number || undefined,
        driverId: a.driver_id,
        driverName: a.driver_name || undefined,
        driverPhone: a.driver_phone || undefined,
        delayMinutes: a.delay_minutes || 0,
        currentStopSequence: a.current_stop_sequence || 0,
        totalStops: a.total_stops || undefined,
        lastGpsLocation,
      };
    }

    // 2. Look for today's scheduled trip
    const todayDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const scheduledRows = await query<{
      id: string;
      route_id: string;
      status: string;
      bus_id: string;
      bus_number: string | null;
      registration_number: string | null;
      driver_id: string;
      driver_name: string | null;
      driver_phone: string | null;
      route_name: string | null;
      route_code: string | null;
      route_type: string | null;
      scheduled_start_time: string | null;
      total_stops: number | null;
    }>(
      `SELECT t.id, t.route_id, t.status, t.bus_id, t.driver_id,
              t.scheduled_start_time::text AS scheduled_start_time,
              b.bus_number, b.registration_number,
              d.full_name AS driver_name, d.phone AS driver_phone,
              r.name AS route_name, r.code AS route_code, r.route_type,
              (SELECT COUNT(*)::int FROM pickup_locations WHERE route_id = t.route_id AND deleted_at IS NULL) AS total_stops
       FROM trips t
       JOIN pickup_locations pl ON pl.route_id = t.route_id AND pl.deleted_at IS NULL
       LEFT JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
       LEFT JOIN drivers d ON t.driver_id = d.id AND d.deleted_at IS NULL
       LEFT JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
       WHERE pl.id = $1 AND t.school_id = $2
         AND t.status = 'SCHEDULED'
         AND t.scheduled_date = $3::date
         AND t.deleted_at IS NULL
       ORDER BY t.scheduled_start_time ASC
       LIMIT 1`,
      [stopId, schoolId, todayDate]
    );

    if (scheduledRows.length > 0 && scheduledRows[0]) {
      const s = scheduledRows[0];
      return {
        id: s.id,
        routeId: s.route_id,
        routeName: s.route_name || undefined,
        routeCode: s.route_code || undefined,
        routeType: s.route_type || undefined,
        status: s.status as TripStatus,
        busId: s.bus_id,
        busNumber: s.bus_number || undefined,
        registrationNumber: s.registration_number || undefined,
        driverId: s.driver_id,
        driverName: s.driver_name || undefined,
        driverPhone: s.driver_phone || undefined,
        scheduledStartTime: s.scheduled_start_time || undefined,
        totalStops: s.total_stops || undefined,
      };
    }

    return null;
  }

  /**
   * Standard Parent WhatsApp Menu Items (Micro-phase 22.1 tasks)
   */
  public static getStandardMenuItems(): ParentWhatsAppMenuItem[] {
    return [
      {
        action: ParentWhatsAppAction.TRACK_MY_BUS,
        title: 'Track My Bus',
        description: 'Live real-time map link and bus transit status',
        commandCode: '1',
      },
      {
        action: ParentWhatsAppAction.MY_ETA,
        title: 'My ETA',
        description: 'Estimated arrival time & distance to your pickup stop',
        commandCode: '2',
      },
      {
        action: ParentWhatsAppAction.MY_CHILD,
        title: 'My Child',
        description: 'Student details & today’s bus boarding status',
        commandCode: '3',
      },
      {
        action: ParentWhatsAppAction.MY_PICKUP,
        title: 'My Pickup',
        description: 'Assigned pickup stop, schedule & location update',
        commandCode: '4',
      },
      {
        action: ParentWhatsAppAction.NOTIFICATIONS,
        title: 'Notifications',
        description: 'Recent alerts, approach notices & delivery status',
        commandCode: '5',
      },
      {
        action: ParentWhatsAppAction.HELP,
        title: 'Help',
        description: 'School transport control room helpline & commands',
        commandCode: '6',
      },
    ];
  }

  /**
   * Generates formatted WhatsApp text message for the parent menu
   */
  public static formatParentMenuText(params: {
    parentName: string;
    studentName: string;
    classGrade?: string;
    section?: string;
    schoolName: string;
    activeTrip?: ParentActiveTripContext | null;
    pickupStopName?: string;
  }): string {
    const {
      parentName,
      studentName,
      classGrade,
      section,
      schoolName,
      activeTrip,
      pickupStopName,
    } = params;

    const classInfo = classGrade ? ` (Class ${classGrade}${section ? `-${section}` : ''})` : '';

    let statusLine = 'Bus Status: *Idle / Not in Transit* ⚪';
    if (activeTrip) {
      if (activeTrip.status === TripStatus.IN_TRANSIT) {
        statusLine = `Bus Status: *In Transit* 🟢 (Bus #${activeTrip.busNumber || 'Assigned'})`;
      } else if (activeTrip.status === TripStatus.DELAYED) {
        statusLine = `Bus Status: *Delayed (${activeTrip.delayMinutes || 10}m)* 🟡 (Bus #${activeTrip.busNumber || 'Assigned'})`;
      } else if (activeTrip.status === TripStatus.ARRIVED_SCHOOL) {
        statusLine = 'Bus Status: *Arrived at School* 🏫';
      } else if (activeTrip.status === TripStatus.SCHEDULED) {
        statusLine = `Bus Status: *Scheduled for Today* 🕒 (${activeTrip.scheduledStartTime || 'Upcoming'})`;
      }
    }

    const stopLine = pickupStopName ? `\nAssigned Stop: *${pickupStopName}*` : '';

    return (
      `🚌 *School Bus Parent Portal*\n` +
      `Namaste, *${parentName}*!\n\n` +
      `Child: *${studentName}*${classInfo}\n` +
      `School: *${schoolName}*${stopLine}\n` +
      `${statusLine}\n\n` +
      `Reply with a number or command:\n` +
      `1️⃣ *Track My Bus* — Live map tracking link\n` +
      `2️⃣ *My ETA* — Estimated arrival time at stop\n` +
      `3️⃣ *My Child* — Student info & attendance status\n` +
      `4️⃣ *My Pickup* — Stop location & scheduled time\n` +
      `5️⃣ *Notifications* — Recent alerts & updates\n` +
      `6️⃣ *Help* — Support & transport helpline\n\n` +
      `_Type any number (1-6) or command keyword anytime._`
    );
  }

  /**
   * Retrieves or creates a secure persistent live web tracking token for parent & student
   */
  public static async getOrCreateTrackingUrl(
    parentId: string,
    studentId: string,
    schoolId: string,
    tripId?: string | null
  ): Promise<{ trackingUrl: string; expiresAt?: string; isExpired: boolean }> {
    try {
      const tokenData = await ParentIdentityService.createTrackingToken({
        parentId,
        studentId,
        schoolId,
        tripId: tripId || null,
        purpose: 'LIVE_TRACKING',
      });
      return {
        trackingUrl: tokenData.trackingUrl,
        expiresAt: tokenData.expiresAt,
        isExpired: false,
      };
    } catch {
      // Fallback persistent root url
      return {
        trackingUrl: `${(env.PARENT_TRACKING_BASE_URL || 'https://tracking.schoolbus.in/track').replace(/\/+$/, '')}/live`,
        isExpired: false,
      };
    }
  }

  /**
   * Retrieves complete Parent WhatsApp Menu by phone number or parent context
   */
  public static async getParentMenu(
    phone: string,
    schoolId?: string
  ): Promise<ParentWhatsAppMenuResponse | null> {
    const parent = await this.findParentByPhone(phone, schoolId);
    if (!parent) {
      return null;
    }

    const activeTrip = await this.getParentTripContext(parent.schoolId, parent.pickupStop?.id);
    const tokenResult = await this.getOrCreateTrackingUrl(
      parent.parentId,
      parent.studentId,
      parent.schoolId,
      activeTrip?.id
    );
    const trackingUrl = tokenResult.trackingUrl;

    const menuItems = this.getStandardMenuItems();
    const formattedText = this.formatParentMenuText({
      parentName: parent.parentName,
      studentName: parent.studentName,
      classGrade: parent.classGrade,
      section: parent.section,
      schoolName: parent.schoolName,
      activeTrip,
      pickupStopName: parent.pickupStop?.stopName,
    });

    return {
      parent: {
        id: parent.parentId,
        fullName: parent.parentName,
        phone: parent.parentPhone,
        schoolId: parent.schoolId,
      },
      student: {
        id: parent.studentId,
        fullName: parent.studentName,
        admissionNumber: parent.admissionNumber || null,
        classGrade: parent.classGrade || null,
        section: parent.section || null,
        rollNumber: parent.rollNumber || null,
      },
      school: {
        id: parent.schoolId,
        name: parent.schoolName,
        code: parent.schoolCode || null,
        phone: parent.schoolPhone || null,
        emergencyContactPhone: parent.schoolEmergencyPhone || null,
      },
      pickupStop: parent.pickupStop
        ? {
            id: parent.pickupStop.id,
            stopName: parent.pickupStop.stopName,
            scheduledTime: parent.pickupStop.scheduledTime || null,
            geofenceRadiusMeters: parent.pickupStop.geofenceRadiusMeters || null,
            latitude: parent.pickupStop.latitude || null,
            longitude: parent.pickupStop.longitude || null,
          }
        : null,
      activeTrip: activeTrip
        ? {
            id: activeTrip.id,
            routeId: activeTrip.routeId,
            routeName: activeTrip.routeName || null,
            status: activeTrip.status,
            busNumber: activeTrip.busNumber || null,
            registrationNumber: activeTrip.registrationNumber || null,
            driverName: activeTrip.driverName || null,
            driverPhone: activeTrip.driverPhone || null,
          }
        : null,
      trackingUrl,
      menuItems,
      formattedText,
    };
  }

  /**
   * Action 1: Track My Bus (Phase 22.2)
   * Enriches response with: Current bus, Location, Route, Pickup, ETA, Trip status, and Secure live link
   */
  public static async handleTrackMyBus(
    parent: ParentContextRecord,
    activeTrip: ParentActiveTripContext | null
  ): Promise<{ replyText: string; trackingUrl: string; data: any }> {
    const tokenResult = await this.getOrCreateTrackingUrl(
      parent.parentId,
      parent.studentId,
      parent.schoolId,
      activeTrip?.id
    );
    const trackingUrl = tokenResult.trackingUrl;
    const tokenExpiresAt = tokenResult.expiresAt;

    let expiryNote = 'Link valid for today’s trip';
    if (tokenExpiresAt) {
      try {
        const expTime = new Intl.DateTimeFormat('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Kolkata',
        }).format(new Date(tokenExpiresAt));
        expiryNote = `Link valid for today until ${expTime}`;
      } catch {
        // Fallback
      }
    }

    const busNumber = activeTrip?.busNumber || 'Assigned';
    const registrationNumber = activeTrip?.registrationNumber || 'N/A';
    const driverName = activeTrip?.driverName || 'Assigned Driver';
    const driverPhone = activeTrip?.driverPhone || '';

    const stopName = parent.pickupStop?.stopName || 'Assigned Stop';
    const scheduledTime = parent.pickupStop?.scheduledTime || 'Scheduled Morning Route';
    const sequenceOrder = parent.pickupStop?.sequenceOrder;
    const stopSeqText = sequenceOrder ? ` (Stop #${sequenceOrder})` : '';

    let tripStatusLabel = 'Idle / Not in Transit ⚪';
    if (activeTrip) {
      if (activeTrip.status === TripStatus.IN_TRANSIT) {
        tripStatusLabel =
          (activeTrip.delayMinutes || 0) > 5
            ? `In Transit 🟡 (Delayed by ${activeTrip.delayMinutes}m)`
            : 'In Transit 🟢 (On Time)';
      } else if (activeTrip.status === TripStatus.DELAYED) {
        tripStatusLabel = `Delayed 🟡 (${activeTrip.delayMinutes || 10}m)`;
      } else if (activeTrip.status === TripStatus.ARRIVED_SCHOOL) {
        tripStatusLabel = 'Arrived at School Campus 🏫';
      } else if (activeTrip.status === TripStatus.SCHEDULED) {
        tripStatusLabel = `Scheduled for Today 🕒 (${activeTrip.scheduledStartTime || 'Upcoming'})`;
      }
    }

    // Dynamic ETA Calculation
    let etaData: any = null;
    let etaMinutes: number | null = null;
    let distanceMeters: number | null = null;
    let isApproaching = false;
    let estimatedArrivalAtStr: string | null = null;

    if (
      activeTrip &&
      (activeTrip.status === TripStatus.IN_TRANSIT || activeTrip.status === TripStatus.DELAYED) &&
      parent.pickupStop?.id
    ) {
      try {
        const etaResult = await EtaService.calculateParentEta({
          tripId: activeTrip.id,
          schoolId: parent.schoolId,
          stopId: parent.pickupStop.id,
        });

        if (etaResult.isAvailable && etaResult.etaMinutes !== null && etaResult.etaMinutes !== undefined) {
          etaMinutes = etaResult.etaMinutes;
          distanceMeters = etaResult.distanceMeters || null;
          isApproaching = etaResult.isApproaching || false;
          estimatedArrivalAtStr = etaResult.estimatedArrivalAt || null;
        }

        etaData = {
          isAvailable: etaResult.isAvailable,
          etaMinutes: etaResult.etaMinutes || null,
          distanceMeters: etaResult.distanceMeters || null,
          estimatedArrivalAt: etaResult.estimatedArrivalAt || null,
          isApproaching: etaResult.isApproaching || false,
          statusText: etaResult.isApproaching
            ? 'Approaching Stop'
            : etaResult.etaMinutes
            ? `~${etaResult.etaMinutes} mins`
            : 'Calculating',
        };
      } catch (err: any) {
        logger.warn(`Failed to calculate ETA for track bus: ${err.message}`);
      }
    }

    let locationData: any = null;
    let locationSection = '';
    if (activeTrip?.lastGpsLocation) {
      const loc = activeTrip.lastGpsLocation;
      const speed = loc.speedKmh || 0;
      const isMoving = speed > 3;
      const recencySeconds = Math.max(
        0,
        Math.floor((Date.now() - new Date(loc.recordedAt).getTime()) / 1000)
      );
      const recencyText =
        recencySeconds < 60
          ? 'Updated just now'
          : `Updated ${Math.floor(recencySeconds / 60)}m ago`;
      const movementText = isMoving ? `Moving at ${Math.round(speed)} km/h` : 'Stationary (0 km/h)';

      locationData = {
        latitude: loc.latitude,
        longitude: loc.longitude,
        speedKmh: loc.speedKmh,
        bearingDegrees: loc.bearingDegrees,
        recordedAt: loc.recordedAt,
        recencySeconds,
        recencyText,
        isMoving,
      };

      locationSection =
        `\n📍 *Current Bus Location:*\n` +
        `• ${movementText} • ${recencyText}\n` +
        `• GPS: ${loc.latitude.toFixed(4)}° N, ${loc.longitude.toFixed(4)}° E\n`;
    }

    let etaSection = '';
    if (etaMinutes !== null) {
      const distanceKm = distanceMeters ? (distanceMeters / 1000).toFixed(1) : null;
      const distText = distanceKm ? ` (${distanceKm} km away)` : '';
      const approachTag = isApproaching ? ' ⚠️ *Bus is Approaching!*' : '';
      let arrTime = '';
      if (estimatedArrivalAtStr) {
        try {
          arrTime = ` (~${new Intl.DateTimeFormat('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: 'Asia/Kolkata',
          }).format(new Date(estimatedArrivalAtStr))})`;
        } catch {}
      }

      etaSection =
        `\n⏱️ *Arrival ETA:*\n` +
        `• Expected in *${etaMinutes} min${etaMinutes === 1 ? '' : 's'}*${arrTime}${distText}${approachTag}\n`;
    }

    const routeName = activeTrip?.routeName || 'Assigned Bus Route';
    const routeCode = activeTrip?.routeCode ? `[${activeTrip.routeCode}] ` : '';
    const stopProgress = activeTrip?.totalStops
      ? `Stop ${activeTrip.currentStopSequence || 1} of ${activeTrip.totalStops}`
      : `Stop #${activeTrip?.currentStopSequence || 1}`;

    let replyText = '';
    if (activeTrip?.status === TripStatus.IN_TRANSIT || activeTrip?.status === TripStatus.DELAYED) {
      const driverPhoneText = driverPhone ? ` (📞 ${driverPhone})` : '';

      replyText =
        `🚌 *Live Bus Tracking*\n` +
        `Student: *${parent.studentName}* (${parent.schoolName})\n` +
        `Bus *#${busNumber}* (${registrationNumber}) is currently *In Transit* 🟢\n` +
        `Driver: *${driverName}*${driverPhoneText}\n\n` +
        `🚦 *Trip Status:* *${tripStatusLabel}*\n` +
        `🗺️ *Route:* *${routeCode}${routeName}* (${stopProgress})\n` +
        `🚏 *Pickup Stop:* *${stopName}*${stopSeqText}\n` +
        `• Scheduled: *${scheduledTime}*` +
        `${locationSection}` +
        `${etaSection}\n` +
        `🔗 *Tap to View Live Map:*\n` +
        `${trackingUrl}\n\n` +
        `_(${expiryNote}. No app install needed. Live map updates automatically as the bus moves.)_`;
    } else {
      const driverPhoneText = driverPhone ? ` (📞 ${driverPhone})` : '';
      const driverDetails = activeTrip?.driverName ? `\nDriver: *${driverName}*${driverPhoneText}` : '';

      replyText =
        `🚌 *Live Bus Tracking*\n` +
        `Student: *${parent.studentName}* (${parent.schoolName})\n` +
        `Bus is currently *Idle / Not in Transit*.${driverDetails}\n\n` +
        `🚦 *Trip Status:* *${tripStatusLabel}*\n` +
        `🚏 *Assigned Stop:* *${stopName}*${stopSeqText}\n` +
        `🕒 *Scheduled Pickup:* *${scheduledTime}*\n` +
        `🚌 *Assigned Bus:* Bus *#${busNumber}* (${registrationNumber})\n\n` +
        `🔗 *Tap to View Live Map:*\n` +
        `${trackingUrl}\n\n` +
        `_(${expiryNote}. Live map activates automatically once the driver starts the trip.)_`;
    }

    const fullData = {
      student: {
        id: parent.studentId,
        fullName: parent.studentName,
        admissionNumber: parent.admissionNumber,
        classGrade: parent.classGrade,
        section: parent.section,
      },
      school: {
        id: parent.schoolId,
        name: parent.schoolName,
      },
      bus: activeTrip
        ? {
            id: activeTrip.busId,
            busNumber,
            registrationNumber,
            driverName,
            driverPhone: driverPhone || null,
          }
        : null,
      location: locationData,
      route: activeTrip
        ? {
            id: activeTrip.routeId,
            name: routeName,
            code: activeTrip.routeCode || null,
            routeType: activeTrip.routeType || null,
            currentStopSequence: activeTrip.currentStopSequence,
            totalStops: activeTrip.totalStops,
          }
        : null,
      pickup: parent.pickupStop
        ? {
            id: parent.pickupStop.id,
            stopName: parent.pickupStop.stopName,
            sequenceOrder: parent.pickupStop.sequenceOrder,
            scheduledTime: parent.pickupStop.scheduledTime,
            geofenceRadiusMeters: parent.pickupStop.geofenceRadiusMeters,
          }
        : null,
      eta: etaData,
      trip: activeTrip
        ? {
            id: activeTrip.id,
            status: activeTrip.status,
            delayMinutes: activeTrip.delayMinutes || 0,
            statusLabel: tripStatusLabel,
          }
        : null,
      secureLink: {
        trackingUrl,
        expiresAt: tokenExpiresAt || null,
        isExpired: false,
      },
      formattedMessage: replyText,
      // Backward-compatible properties:
      trackingUrl,
      busNumber: activeTrip?.busNumber,
      driverName: activeTrip?.driverName,
      status: activeTrip?.status || 'IDLE',
    };

    return {
      replyText,
      trackingUrl,
      data: fullData,
    };
  }

  /**
   * Retrieves comprehensive Track My Bus details by phone number (Micro-phase 22.2)
   */
  public static async getTrackBusDetails(
    phone: string,
    schoolId?: string
  ): Promise<ParentTrackBusResponse | null> {
    const parent = await this.findParentByPhone(phone, schoolId);
    if (!parent) {
      return null;
    }
    const activeTrip = await this.getParentTripContext(parent.schoolId, parent.pickupStop?.id);
    const result = await this.handleTrackMyBus(parent, activeTrip);
    return result.data as ParentTrackBusResponse;
  }

  /**
   * Action 2: My ETA (Phase 22.3)
   * Returns latest dynamic ETA, last update recency/telemetry, and handles unavailable states
   */
  public static async handleMyEta(
    parent: ParentContextRecord,
    activeTrip: ParentActiveTripContext | null
  ): Promise<{ replyText: string; data: any }> {
    const tokenResult = await this.getOrCreateTrackingUrl(
      parent.parentId,
      parent.studentId,
      parent.schoolId,
      activeTrip?.id
    );
    const trackingUrl = tokenResult.trackingUrl;

    const stopName = parent.pickupStop?.stopName || 'Assigned Stop';
    const scheduledTime = parent.pickupStop?.scheduledTime || 'Scheduled Morning Route';
    const busNumber = activeTrip?.busNumber || 'Assigned';
    const registrationNumber = activeTrip?.registrationNumber || 'N/A';
    const driverName = activeTrip?.driverName || 'Assigned Driver';
    const driverPhone = activeTrip?.driverPhone || '';

    // Calculate lastUpdate telemetry if available
    let lastUpdateData: {
      recordedAt: string | null;
      recencySeconds: number | null;
      recencyText: string | null;
      speedKmh: number | null;
      isMoving: boolean;
    } | null = null;

    if (activeTrip?.lastGpsLocation) {
      const loc = activeTrip.lastGpsLocation;
      const speed = loc.speedKmh || 0;
      const isMoving = speed > 3;
      const recencySeconds = Math.max(
        0,
        Math.floor((Date.now() - new Date(loc.recordedAt).getTime()) / 1000)
      );
      const recencyText =
        recencySeconds < 60
          ? 'Updated just now'
          : `Updated ${Math.floor(recencySeconds / 60)}m ago`;

      lastUpdateData = {
        recordedAt: loc.recordedAt,
        recencySeconds,
        recencyText,
        speedKmh: loc.speedKmh,
        isMoving,
      };
    }

    // 1. Check if student has no stop assigned
    if (!parent.pickupStop?.id) {
      const replyText =
        `⏱️ *Bus Arrival ETA*\n` +
        `Student: *${parent.studentName}*\n` +
        `Status: *No Pickup Stop Assigned* ⚠️\n\n` +
        `No pickup stop has been assigned for ${parent.studentName} yet.\n` +
        `Please contact ${parent.schoolName} transport coordinator to configure your pickup stop.\n\n` +
        `🔗 *Live Web Tracking:*\n${trackingUrl}`;

      const fullData = {
        student: {
          id: parent.studentId,
          fullName: parent.studentName,
          admissionNumber: parent.admissionNumber,
          classGrade: parent.classGrade,
          section: parent.section,
        },
        stop: null,
        bus: activeTrip
          ? {
              id: activeTrip.busId,
              busNumber,
              registrationNumber,
              driverName,
              driverPhone: driverPhone || null,
            }
          : null,
        eta: {
          isAvailable: false,
          etaMinutes: null,
          distanceMeters: null,
          estimatedArrivalAt: null,
          isApproaching: false,
          isPassed: false,
          status: 'NO_STOP_ASSIGNED',
          unavailableReason: 'NO_STOP_ASSIGNED',
          unavailableMessage: 'No pickup stop has been assigned for this student.',
        },
        lastUpdate: lastUpdateData,
        trackingUrl,
        formattedMessage: replyText,
        // Backward-compatible properties:
        isAvailable: false,
        stopName,
        scheduledTime,
        status: 'NO_STOP_ASSIGNED',
      };

      return { replyText, data: fullData };
    }

    // 2. Check if trip is not active (SCHEDULED / IDLE / COMPLETED / CANCELLED)
    if (!activeTrip || (activeTrip.status !== TripStatus.IN_TRANSIT && activeTrip.status !== TripStatus.DELAYED)) {
      const isCompleted = activeTrip?.status === TripStatus.COMPLETED;
      const isCancelled = activeTrip?.status === TripStatus.CANCELLED;

      let statusTitle = 'Bus Not Currently in Transit ⚪';
      let statusDetail = `Scheduled pickup is at *${scheduledTime}*.\nLive ETA will update in real time once the trip begins.`;
      let etaStatus = 'TRIP_NOT_STARTED';

      if (isCompleted) {
        statusTitle = 'Trip Completed for Today 🏁';
        statusDetail = `Today’s bus trip has been marked as completed.`;
        etaStatus = 'TRIP_COMPLETED';
      } else if (isCancelled) {
        statusTitle = 'Trip Cancelled ❌';
        statusDetail = `Today’s bus trip was cancelled by the school administration.`;
        etaStatus = 'TRIP_CANCELLED';
      }

      const replyText =
        `⏱️ *Bus Arrival ETA*\n` +
        `Stop: *${stopName}*\n` +
        `Status: *${statusTitle}*\n\n` +
        `${statusDetail}\n\n` +
        `_Reply *1* or *TRACK* to open the live tracking web map._`;

      const fullData = {
        student: {
          id: parent.studentId,
          fullName: parent.studentName,
          admissionNumber: parent.admissionNumber,
          classGrade: parent.classGrade,
          section: parent.section,
        },
        stop: {
          id: parent.pickupStop.id,
          stopName: parent.pickupStop.stopName,
          sequenceOrder: parent.pickupStop.sequenceOrder,
          scheduledTime: parent.pickupStop.scheduledTime,
          geofenceRadiusMeters: parent.pickupStop.geofenceRadiusMeters,
        },
        bus: activeTrip
          ? {
              id: activeTrip.busId,
              busNumber,
              registrationNumber,
              driverName,
              driverPhone: driverPhone || null,
            }
          : null,
        eta: {
          isAvailable: false,
          etaMinutes: null,
          distanceMeters: null,
          estimatedArrivalAt: null,
          isApproaching: false,
          isPassed: false,
          status: etaStatus,
          unavailableReason: etaStatus,
          unavailableMessage: statusDetail.replace(/\*/g, ''),
        },
        lastUpdate: lastUpdateData,
        trackingUrl,
        formattedMessage: replyText,
        // Backward-compatible properties:
        isAvailable: false,
        stopName,
        scheduledTime,
        status: etaStatus,
      };

      return { replyText, data: fullData };
    }

    // 3. Trip is active (IN_TRANSIT or DELAYED) -> calculate ETA via EtaService
    let etaResult: any = null;
    try {
      etaResult = await EtaService.calculateParentEta({
        tripId: activeTrip.id,
        schoolId: parent.schoolId,
        stopId: parent.pickupStop.id,
      });
    } catch (err: any) {
      logger.warn(`Failed to calculate Parent ETA for stop ${parent.pickupStop.id}: ${err.message}`);
    }

    // Handle stop already passed
    if (etaResult?.isPassed || etaResult?.status === 'PASSED') {
      const replyText =
        `⏱️ *Bus Arrival ETA*\n` +
        `Stop: *${stopName}*\n` +
        `Status: *Bus Already Passed Your Stop* ℹ️\n\n` +
        `The bus *#${busNumber}* has already departed from *${stopName}*.\n` +
        `You can track the continuing route on the live map.\n\n` +
        `🔗 *Live Map:*\n${trackingUrl}`;

      const fullData = {
        student: {
          id: parent.studentId,
          fullName: parent.studentName,
          admissionNumber: parent.admissionNumber,
          classGrade: parent.classGrade,
          section: parent.section,
        },
        stop: {
          id: parent.pickupStop.id,
          stopName: parent.pickupStop.stopName,
          sequenceOrder: parent.pickupStop.sequenceOrder,
          scheduledTime: parent.pickupStop.scheduledTime,
          geofenceRadiusMeters: parent.pickupStop.geofenceRadiusMeters,
        },
        bus: {
          id: activeTrip.busId,
          busNumber,
          registrationNumber,
          driverName,
          driverPhone: driverPhone || null,
        },
        eta: {
          isAvailable: false,
          etaMinutes: null,
          distanceMeters: null,
          estimatedArrivalAt: null,
          isApproaching: false,
          isPassed: true,
          status: 'PASSED',
          unavailableReason: 'STOP_ALREADY_PASSED',
          unavailableMessage: `The bus has already passed ${stopName}.`,
        },
        lastUpdate: lastUpdateData,
        trackingUrl,
        formattedMessage: replyText,
        // Backward-compatible properties:
        isAvailable: false,
        stopName,
        scheduledTime,
        status: 'PASSED',
        isPassed: true,
      };

      return { replyText, data: fullData };
    }

    // Handle live ETA available
    if (etaResult?.isAvailable && etaResult.etaMinutes !== null && etaResult.etaMinutes !== undefined) {
      const etaMinutes = etaResult.etaMinutes;
      const distanceMeters = etaResult.distanceMeters || null;
      const isApproaching = etaResult.isApproaching || false;
      const estimatedArrivalAt = etaResult.estimatedArrivalAt || null;

      const distanceKm = distanceMeters ? (distanceMeters / 1000).toFixed(1) : null;
      const distanceText = distanceKm ? `\nDistance: *${distanceKm} km away*` : '';
      const approachTag = isApproaching ? ' ⚠️ *Bus is Approaching!*' : '';

      let etaFormatted = '';
      if (estimatedArrivalAt) {
        try {
          etaFormatted = new Intl.DateTimeFormat('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: 'Asia/Kolkata',
          }).format(new Date(estimatedArrivalAt));
        } catch {}
      }
      const arrivalEst = etaFormatted ? ` (~${etaFormatted})` : '';

      let lastUpdateLine = '';
      if (lastUpdateData?.recencyText) {
        const movementStr =
          lastUpdateData.isMoving && lastUpdateData.speedKmh
            ? `Moving at ${Math.round(lastUpdateData.speedKmh)} km/h`
            : 'Stationary';
        lastUpdateLine = `📡 *Last Update:* ${lastUpdateData.recencyText} • ${movementStr}\n`;
      }

      const replyText =
        `⏱️ *Bus Arrival ETA*${approachTag}\n` +
        `Stop: *${stopName}*\n` +
        `Expected Arrival: *${etaMinutes} min${etaMinutes === 1 ? '' : 's'}*${arrivalEst}${distanceText}\n` +
        `Bus: *#${busNumber}*\n` +
        `${lastUpdateLine}\n` +
        `_Please arrive at the stop 5 minutes prior to avoid delays._\n` +
        `_Reply *1* to track live location._`;

      const fullData = {
        student: {
          id: parent.studentId,
          fullName: parent.studentName,
          admissionNumber: parent.admissionNumber,
          classGrade: parent.classGrade,
          section: parent.section,
        },
        stop: {
          id: parent.pickupStop.id,
          stopName: parent.pickupStop.stopName,
          sequenceOrder: parent.pickupStop.sequenceOrder,
          scheduledTime: parent.pickupStop.scheduledTime,
          geofenceRadiusMeters: parent.pickupStop.geofenceRadiusMeters,
        },
        bus: {
          id: activeTrip.busId,
          busNumber,
          registrationNumber,
          driverName,
          driverPhone: driverPhone || null,
        },
        eta: {
          isAvailable: true,
          etaMinutes,
          distanceMeters,
          estimatedArrivalAt,
          isApproaching,
          isPassed: false,
          status: isApproaching ? 'APPROACHING' : 'CALCULATED',
          unavailableReason: null,
          unavailableMessage: null,
        },
        lastUpdate: lastUpdateData,
        trackingUrl,
        formattedMessage: replyText,
        // Backward-compatible properties:
        isAvailable: true,
        etaMinutes,
        distanceMeters,
        stopName,
        isApproaching,
        status: isApproaching ? 'APPROACHING' : 'CALCULATED',
      };

      return { replyText, data: fullData };
    }

    // Telemetry synchronizing, offline, or stale
    const unavailableReason = etaResult?.unavailableReason || 'GPS_SYNCHRONIZING';
    const unavailableMessage =
      etaResult?.unavailableMessage || 'Bus is on route! Live telemetry is synchronizing.';

    let lastUpdateLine = '';
    if (lastUpdateData?.recencyText) {
      lastUpdateLine = `📡 *Last Update:* ${lastUpdateData.recencyText}\n`;
    }

    const replyText =
      `⏱️ *Bus Arrival ETA*\n` +
      `Stop: *${stopName}*\n` +
      `Status: *Bus in Transit* 🟢\n` +
      `Bus: *#${busNumber}*\n` +
      `${lastUpdateLine}\n` +
      `${unavailableMessage}\n` +
      `_Reply *1* to view the bus position directly on the live map._`;

    const fullData = {
      student: {
        id: parent.studentId,
        fullName: parent.studentName,
        admissionNumber: parent.admissionNumber,
        classGrade: parent.classGrade,
        section: parent.section,
      },
      stop: {
        id: parent.pickupStop.id,
        stopName: parent.pickupStop.stopName,
        sequenceOrder: parent.pickupStop.sequenceOrder,
        scheduledTime: parent.pickupStop.scheduledTime,
        geofenceRadiusMeters: parent.pickupStop.geofenceRadiusMeters,
      },
      bus: {
        id: activeTrip.busId,
        busNumber,
        registrationNumber,
        driverName,
        driverPhone: driverPhone || null,
      },
      eta: {
        isAvailable: false,
        etaMinutes: null,
        distanceMeters: null,
        estimatedArrivalAt: null,
        isApproaching: false,
        isPassed: false,
        status: unavailableReason,
        unavailableReason,
        unavailableMessage,
      },
      lastUpdate: lastUpdateData,
      trackingUrl,
      formattedMessage: replyText,
      // Backward-compatible properties:
      isAvailable: false,
      stopName,
      status: unavailableReason,
    };

    return { replyText, data: fullData };
  }

  /**
   * Retrieves comprehensive My ETA details by phone number (Micro-phase 22.3)
   */
  public static async getMyEtaDetails(
    phone: string,
    schoolId?: string
  ): Promise<ParentMyEtaResponse | null> {
    const parent = await this.findParentByPhone(phone, schoolId);
    if (!parent) {
      return null;
    }
    const activeTrip = await this.getParentTripContext(parent.schoolId, parent.pickupStop?.id);
    const result = await this.handleMyEta(parent, activeTrip);
    return result.data as ParentMyEtaResponse;
  }


  /**
   * Action 3: My Child (Phase 22.4)
   * Evaluates current journey status, boarding status, and drop status for the student
   */
  public static async handleMyChild(
    parent: ParentContextRecord,
    activeTrip: ParentActiveTripContext | null
  ): Promise<{ replyText: string; data: any }> {
    const todayDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

    const attendanceRows = await query<{
      event_type: 'BOARDING' | 'DROP';
      status?: string;
      recorded_at: string;
      marked_by?: string | null;
      stop_name: string | null;
    }>(
      `SELECT 'BOARDING' AS event_type, b.status, b.recorded_at::text, b.marked_by, pl.stop_name
       FROM boarding_events b
       LEFT JOIN pickup_locations pl ON b.stop_id = pl.id
       WHERE b.student_id = $1 AND b.recorded_at::date = $2::date
       UNION ALL
       SELECT 'DROP' AS event_type, d.status, d.recorded_at::text, d.marked_by, pl.stop_name
       FROM drop_events d
       LEFT JOIN pickup_locations pl ON d.stop_id = pl.id
       WHERE d.student_id = $1 AND d.recorded_at::date = $2::date
       ORDER BY recorded_at DESC`,
      [parent.studentId, todayDate]
    );

    const formatTime = (isoString?: string | null): string | null => {
      if (!isoString) return null;
      try {
        return new Intl.DateTimeFormat('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Kolkata',
        }).format(new Date(isoString));
      } catch {
        return null;
      }
    };

    // 1. Identify Boarding & Drop events
    const boardingEvent = attendanceRows.find((r) => r.event_type === 'BOARDING');
    const dropEvent = attendanceRows.find((r) => r.event_type === 'DROP');

    // 2. Evaluate Boarding Status
    let boardingStatus: 'BOARDED' | 'NOT_BOARDED' | 'ABSENT' = 'NOT_BOARDED';
    let isBoarded = false;
    let boardingTimeFormatted: string | null = null;
    let boardingStopName: string | null = null;

    if (boardingEvent) {
      const rawStatus = (boardingEvent.status || 'BOARDED').toUpperCase();
      if (rawStatus === 'ABSENT') {
        boardingStatus = 'ABSENT';
      } else {
        boardingStatus = 'BOARDED';
        isBoarded = true;
      }
      boardingTimeFormatted = formatTime(boardingEvent.recorded_at);
      boardingStopName = boardingEvent.stop_name || parent.pickupStop?.stopName || 'Pickup Stop';
    }

    // 3. Evaluate Drop Status
    let dropStatus: 'DEBOARDED' | 'PENDING' | 'MISSED' | 'NOT_APPLICABLE' = 'PENDING';
    let isDropped = false;
    let dropTimeFormatted: string | null = null;
    let dropStopName: string | null = null;

    if (dropEvent) {
      const rawDropStatus = (dropEvent.status || 'DEBOARDED').toUpperCase();
      if (rawDropStatus === 'MISSED') {
        dropStatus = 'MISSED';
      } else {
        dropStatus = 'DEBOARDED';
        isDropped = true;
      }
      dropTimeFormatted = formatTime(dropEvent.recorded_at);
      dropStopName = dropEvent.stop_name || 'Destination / School';
    }

    // 4. Evaluate Current Journey Status
    let journeyStatus = 'NOT_IN_TRANSIT';
    let journeyLabel = 'Not in Transit ⚪';
    let journeyDescription = 'No active journey currently in transit.';

    if (isDropped) {
      journeyStatus = 'SAFELY_DROPPED';
      journeyLabel = `Safely Dropped at ${dropTimeFormatted || 'Destination'} ✅`;
      journeyDescription = 'Student has safely deboarded the bus.';
    } else if (boardingStatus === 'ABSENT') {
      journeyStatus = 'ABSENT';
      journeyLabel = 'Marked Absent ❌';
      journeyDescription = 'Student was marked absent for today’s trip.';
    } else if (isBoarded) {
      journeyStatus = 'ON_BUS';
      journeyLabel =
        activeTrip?.status === 'ARRIVED_SCHOOL'
          ? 'On Bus — Arrived at School 🏫'
          : 'On Bus — In Transit 🚌';
      journeyDescription = 'Student is on board the bus and travelling safely.';
    } else if (
      activeTrip?.status === TripStatus.IN_TRANSIT ||
      activeTrip?.status === TripStatus.DELAYED
    ) {
      journeyStatus = 'AWAITING_BOARDING';
      journeyLabel = 'Awaiting Boarding 🕒';
      journeyDescription = 'Bus is currently on route, awaiting student pickup.';
    } else if (activeTrip?.status === TripStatus.SCHEDULED) {
      journeyStatus = 'SCHEDULED';
      journeyLabel = 'Trip Scheduled ⚪';
      journeyDescription = 'Bus trip is scheduled and will begin shortly.';
    }

    // 5. Compose Transit Summary Text
    let attendanceStatus = 'Not Yet Boarded';
    if (isDropped) {
      attendanceStatus = `Safely Dropped at ${dropTimeFormatted} (${dropStopName || 'Destination'}) ✅`;
    } else if (isBoarded) {
      attendanceStatus = `Boarded Bus at ${boardingTimeFormatted} (${boardingStopName || 'Pickup Stop'}) 🚌`;
    } else if (boardingStatus === 'ABSENT') {
      attendanceStatus = 'Marked Absent for today’s trip ❌';
    } else if (activeTrip?.status === TripStatus.IN_TRANSIT) {
      attendanceStatus = 'Bus is currently in transit (Awaiting boarding) 🕒';
    }

    const classSection = parent.classGrade
      ? `Class ${parent.classGrade}${parent.section ? ` - Section ${parent.section}` : ''}`
      : 'Registered';

    const busNumber = activeTrip?.busNumber ? `Bus *#${activeTrip.busNumber}*` : 'Assigned Bus';
    const regText = activeTrip?.registrationNumber ? ` (${activeTrip.registrationNumber})` : '';
    const driverPhoneText = activeTrip?.driverPhone ? ` (📞 ${activeTrip.driverPhone})` : '';
    const driverText = activeTrip?.driverName ? `\nDriver: *${activeTrip.driverName}*${driverPhoneText}` : '';
    const assignedStopText = parent.pickupStop?.stopName || 'Not Assigned';

    const replyText =
      `🎒 *Student Profile & Attendance*\n` +
      `Name: *${parent.studentName}*\n` +
      `Admission No: *${parent.admissionNumber || 'N/A'}*\n` +
      `Class: *${classSection}* | Roll No: *${parent.rollNumber || 'N/A'}*\n` +
      `School: *${parent.schoolName}*\n\n` +
      `🚦 *Current Journey Status:*\n` +
      `• *${journeyLabel}*\n` +
      `_${journeyDescription}_\n\n` +
      `📋 *Today’s Transit Status:*\n` +
      `• *${attendanceStatus}*\n\n` +
      `🚌 *Assigned Bus:* ${busNumber}${regText}${driverText}\n` +
      `🚏 *Assigned Stop:* *${assignedStopText}*\n\n` +
      `_Reply *1* for live tracking or *2* for ETA._`;

    const fullData = {
      student: {
        id: parent.studentId,
        fullName: parent.studentName,
        admissionNumber: parent.admissionNumber || null,
        classGrade: parent.classGrade || null,
        section: parent.section || null,
        rollNumber: parent.rollNumber || null,
      },
      school: {
        id: parent.schoolId,
        name: parent.schoolName,
        emergencyContactPhone: parent.schoolEmergencyPhone || null,
      },
      journey: {
        status: journeyStatus,
        statusLabel: journeyLabel,
        description: journeyDescription,
      },
      boarding: {
        status: boardingStatus,
        isBoarded,
        recordedAt: boardingEvent?.recorded_at || null,
        recordedAtFormatted: boardingTimeFormatted,
        stopName: boardingStopName,
        markedBy: boardingEvent?.marked_by || null,
      },
      drop: {
        status: dropStatus,
        isDropped,
        recordedAt: dropEvent?.recorded_at || null,
        recordedAtFormatted: dropTimeFormatted,
        stopName: dropStopName,
        markedBy: dropEvent?.marked_by || null,
      },
      bus: activeTrip
        ? {
            id: activeTrip.busId,
            busNumber: activeTrip.busNumber || 'Assigned',
            registrationNumber: activeTrip.registrationNumber || 'N/A',
            driverName: activeTrip.driverName || null,
            driverPhone: activeTrip.driverPhone || null,
          }
        : null,
      pickupStop: parent.pickupStop
        ? {
            id: parent.pickupStop.id,
            stopName: parent.pickupStop.stopName,
            scheduledTime: parent.pickupStop.scheduledTime || null,
          }
        : null,
      formattedMessage: replyText,
      // Backward-compatible properties:
      studentId: parent.studentId,
      studentName: parent.studentName,
      admissionNumber: parent.admissionNumber,
      attendanceStatus,
      assignedStop: parent.pickupStop?.stopName,
    };

    return {
      replyText,
      data: fullData,
    };
  }

  /**
   * Retrieves comprehensive My Child details by phone number (Micro-phase 22.4)
   */
  public static async getMyChildDetails(
    phone: string,
    schoolId?: string
  ): Promise<ParentMyChildResponse | null> {
    const parent = await this.findParentByPhone(phone, schoolId);
    if (!parent) {
      return null;
    }
    const activeTrip = await this.getParentTripContext(parent.schoolId, parent.pickupStop?.id);
    const result = await this.handleMyChild(parent, activeTrip);
    return result.data as ParentMyChildResponse;
  }


  /**
   * Action 4: My Pickup (Phase 22.5: View Pickup)
   */
  public static async handleMyPickup(
    parent: ParentContextRecord,
    activeTrip?: ParentActiveTripContext | null
  ): Promise<{ replyText: string; data: any }> {
    const stop = parent.pickupStop;

    if (!stop) {
      const replyText =
        `📍 *Assigned Pickup Stop*\n` +
        `Student: *${parent.studentName}*\n` +
        `Status: *No stop currently assigned* ⚠️\n\n` +
        `Please contact *${parent.schoolName}* transport administration to assign your pickup stop, or share your live GPS location pin directly in this WhatsApp chat to submit a pickup location update.\n\n` +
        `_Reply *6* for school helpline details._`;

      const fullData = {
        student: {
          id: parent.studentId,
          fullName: parent.studentName,
          admissionNumber: parent.admissionNumber || null,
          classGrade: parent.classGrade || null,
          section: parent.section || null,
        },
        school: {
          id: parent.schoolId,
          name: parent.schoolName,
          emergencyContactPhone: parent.schoolEmergencyPhone || null,
        },
        pickupStop: null,
        route: null,
        updateFlow: {
          instructions:
            'Share your live WhatsApp GPS pin or submit coordinates to request a pickup point update.',
          canUpdate: true,
          whatsappCommand: 'Share GPS Location Pin',
        },
        formattedMessage: replyText,
        // Backward-compatible properties:
        stopAssigned: false,
      };

      return {
        replyText,
        data: fullData,
      };
    }

    let coordinatesFormatted: string | null = null;
    let coordsText = '';
    if (
      stop.latitude !== undefined &&
      stop.longitude !== undefined &&
      stop.latitude !== null &&
      stop.longitude !== null
    ) {
      coordinatesFormatted = `${Number(stop.latitude).toFixed(4)}° N, ${Number(stop.longitude).toFixed(4)}° E`;
      coordsText = `Coordinates: *${coordinatesFormatted}*\n`;
    }

    let routeText = '';
    if (activeTrip?.routeName) {
      const codeText = activeTrip.routeCode ? ` [${activeTrip.routeCode}]` : '';
      routeText = `Route: *${activeTrip.routeName}${codeText}*\n`;
    }

    const scheduledTimeText = stop.scheduledTime
      ? `Scheduled Pickup: *${stop.scheduledTime}* 🕒\n`
      : '';
    const radiusText = stop.geofenceRadiusMeters
      ? `Approach Radius: *${stop.geofenceRadiusMeters} meters*\n`
      : '';
    const seqText = stop.sequenceOrder ? ` (Stop #${stop.sequenceOrder})` : '';

    const replyText =
      `📍 *Assigned Pickup Stop*\n` +
      `Student: *${parent.studentName}*\n` +
      `Stop Name: *${stop.stopName}*${seqText}\n` +
      `${scheduledTimeText}` +
      `${radiusText}` +
      `${coordsText}` +
      `${routeText}\n` +
      `Need to update or share your live GPS location for pickup?\n` +
      `_You can share your live GPS pin directly in this WhatsApp chat to submit a pickup location update._\n\n` +
      `_Reply *1* to view the stop on the live tracking map._`;

    const fullData = {
      student: {
        id: parent.studentId,
        fullName: parent.studentName,
        admissionNumber: parent.admissionNumber || null,
        classGrade: parent.classGrade || null,
        section: parent.section || null,
      },
      school: {
        id: parent.schoolId,
        name: parent.schoolName,
        emergencyContactPhone: parent.schoolEmergencyPhone || null,
      },
      pickupStop: {
        id: stop.id,
        stopName: stop.stopName,
        scheduledTime: stop.scheduledTime || null,
        sequenceOrder: stop.sequenceOrder || null,
        geofenceRadiusMeters: stop.geofenceRadiusMeters || null,
        latitude: stop.latitude !== undefined && stop.latitude !== null ? Number(stop.latitude) : null,
        longitude: stop.longitude !== undefined && stop.longitude !== null ? Number(stop.longitude) : null,
        coordinatesFormatted,
      },
      route: activeTrip?.routeId
        ? {
            id: activeTrip.routeId,
            name: activeTrip.routeName || 'Assigned Route',
            code: activeTrip.routeCode || null,
            totalStops: activeTrip.totalStops || null,
          }
        : null,
      updateFlow: {
        instructions:
          'Share your live WhatsApp GPS pin or submit new coordinates to request an updated pickup point.',
        canUpdate: true,
        whatsappCommand: 'Share GPS Location Pin',
      },
      formattedMessage: replyText,
      // Backward-compatible properties:
      stopAssigned: true,
      stopId: stop.id,
      stopName: stop.stopName,
      scheduledTime: stop.scheduledTime,
      radiusMeters: stop.geofenceRadiusMeters,
    };

    return {
      replyText,
      data: fullData,
    };
  }

  /**
   * Action 4b: Request Pickup Update Flow (Phase 22.5)
   * Validates new location coordinates and assigns or creates safe pickup point
   */
  public static async handlePickupLocationUpdate(
    parent: ParentContextRecord,
    params: {
      latitude: number;
      longitude: number;
      stopName?: string;
      landmark?: string;
    }
  ): Promise<ParentPickupUpdateResult> {
    const { latitude, longitude, stopName, landmark } = params;

    // 1. Validate coordinates against school catchment service area
    const validation = await DynamicPickupService.validateCoordinates({
      latitude,
      longitude,
      schoolId: parent.schoolId,
      maxCatchmentKm: 35,
    });

    if (!validation.isValid) {
      const distanceText =
        validation.distanceToSchoolKm !== undefined ? ` (${validation.distanceToSchoolKm} km away)` : '';
      const replyText =
        `⚠️ *Unable to Update Pickup Location*\n` +
        `Hello ${parent.parentName}. We received your location (${latitude.toFixed(4)}° N, ${longitude.toFixed(4)}° E), ` +
        `but it appears to be outside our bus service zone${distanceText}.\n\n` +
        `Please contact *${parent.schoolName}* transport coordinator for assistance.\n` +
        `_Reply *6* for help and helpline numbers._`;

      return {
        success: false,
        studentId: parent.studentId,
        studentName: parent.studentName,
        pickupStopId: parent.pickupStop?.id || '',
        pickupStopName: parent.pickupStop?.stopName || 'Current Stop',
        latitude,
        longitude,
        reusedExistingStop: false,
        formattedMessage: replyText,
      };
    }

    // 2. Perform direct dynamic pickup update (Rule 3: no mandatory school approval)
    const updateResult = await DynamicPickupService.updateStudentPickup(
      {
        studentId: parent.studentId,
        schoolId: parent.schoolId,
        latitude,
        longitude,
        stopName: stopName || validation.suggestedStopName || `${parent.studentName} Pickup Point`,
        landmark: landmark || undefined,
        notifyParent: false,
      },
      parent.schoolId
    );

    const replyText =
      `✅ *Pickup Location Updated Successfully*\n` +
      `Student: *${parent.studentName}*\n` +
      `New Pickup Stop: *${updateResult.pickupStopName}*\n` +
      `Coordinates: *${latitude.toFixed(4)}° N, ${longitude.toFixed(4)}° E*\n` +
      `Distance to School: *${validation.distanceToSchoolKm || 0} km*\n\n` +
      `Your pickup point has been updated. Live tracking will reflect this stop on your child's next route.\n\n` +
      `_Reply *4* to view updated stop details or *1* to track your bus._`;

    return {
      success: true,
      studentId: parent.studentId,
      studentName: parent.studentName,
      pickupStopId: updateResult.pickupStopId,
      pickupStopName: updateResult.pickupStopName,
      latitude,
      longitude,
      reusedExistingStop: updateResult.reusedExistingStop,
      formattedMessage: replyText,
    };
  }

  /**
   * Retrieves comprehensive My Pickup details by phone number (Micro-phase 22.5)
   */
  public static async getMyPickupDetails(
    phone: string,
    schoolId?: string
  ): Promise<ParentMyPickupResponse | null> {
    const parent = await this.findParentByPhone(phone, schoolId);
    if (!parent) {
      return null;
    }
    const activeTrip = await this.getParentTripContext(parent.schoolId, parent.pickupStop?.id);
    const result = await this.handleMyPickup(parent, activeTrip);
    return result.data as ParentMyPickupResponse;
  }

  /**
   * Executes pickup update request via direct API or coordinator action (Micro-phase 22.5)
   */
  public static async requestPickupUpdate(
    params: ParentPickupUpdateRequest
  ): Promise<ParentPickupUpdateResult> {
    const parent = await this.findParentByPhone(params.phone, params.schoolId);
    if (!parent) {
      throw new NotFoundError(`Parent not found for phone number: ${params.phone}`);
    }

    return await this.handlePickupLocationUpdate(parent, {
      latitude: params.latitude,
      longitude: params.longitude,
      stopName: params.stopName || undefined,
      landmark: params.landmark || undefined,
    });
  }


  /**
   * Action 5: Notifications
   */
  public static async handleNotifications(
    parent: ParentContextRecord
  ): Promise<{ replyText: string; data: any }> {
    const { variants } = this.normalizeIndianPhone(parent.parentPhone);

    const rows = await query<{
      id: string;
      template_name: string;
      message_body: string;
      status: string;
      created_at: string;
    }>(
      `SELECT id, template_name, message_body, status, created_at::text
       FROM notifications
       WHERE school_id = $1
         AND (recipient_phone = $2 OR recipient_phone = $3 OR recipient_phone = $4)
       ORDER BY created_at DESC
       LIMIT 4`,
      [parent.schoolId, variants[0], variants[1], variants[2]]
    );

    let historySection = 'No recent alerts logged in the last 24 hours.';
    if (rows.length > 0) {
      historySection = rows
        .map((r, i) => {
          const time = new Intl.DateTimeFormat('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: 'Asia/Kolkata',
          }).format(new Date(r.created_at));
          const summary = r.message_body.replace(/\n/g, ' ').substring(0, 60);
          return `${i + 1}. [${time}] ${summary}...`;
        })
        .join('\n');
    }

    const replyText =
      `🔔 *Parent Notification Center*\n` +
      `Alerts Channel: *WhatsApp Notifications Active* ✅\n` +
      `Recipient: *${parent.parentPhone}*\n\n` +
      `Recent Updates:\n` +
      `${historySection}\n\n` +
      `_You will automatically receive WhatsApp alerts when the bus begins its trip and approaches your stop._\n` +
      `_Reply *1* to track live location._`;

    return {
      replyText,
      data: {
        channel: 'WHATSAPP',
        isActive: true,
        recentCount: rows.length,
      },
    };
  }

  /**
   * Action 6: Help
   */
  public static async handleHelp(
    parent: ParentContextRecord
  ): Promise<{ replyText: string; data: any }> {
    const schoolPhone = parent.schoolPhone || '+91-11-23456789';
    const emergencyPhone = parent.schoolEmergencyPhone || schoolPhone;

    const replyText =
      `ℹ️ *School Transport Help & Support*\n` +
      `School: *${parent.schoolName}*\n\n` +
      `Available Commands:\n` +
      `Type *1* or *TRACK* — Live bus map tracking link\n` +
      `Type *2* or *ETA* — Live arrival time at pickup stop\n` +
      `Type *3* or *CHILD* — Student info & boarding status\n` +
      `Type *4* or *PICKUP* — Pickup stop details\n` +
      `Type *5* or *ALERTS* — Recent notifications\n` +
      `Type *6* or *HELP* — Show this support menu\n\n` +
      `📞 *Transport Control Room:*\n` +
      `Helpline: *${schoolPhone}*\n` +
      `Emergency Desk: *${emergencyPhone}*\n\n` +
      `_Reply *0* or *MENU* at any time to return to the main menu._`;

    return {
      replyText,
      data: {
        schoolPhone,
        emergencyPhone,
        schoolName: parent.schoolName,
      },
    };
  }

  /**
   * Parses natural text input into ParentWhatsAppAction or special commands
   */
  public static parseParentAction(text?: string): ParentWhatsAppAction | 'MENU' | 'UNKNOWN_COMMAND' {
    if (!text) {
      return 'MENU';
    }

    const clean = text.trim().toLowerCase();

    // 1. Track My Bus
    if (
      clean === '1' ||
      clean === 'track' ||
      clean === 'track bus' ||
      clean === 'track my bus' ||
      clean === 'bus' ||
      clean === 'live' ||
      clean === 'map' ||
      clean === 'location' ||
      clean.includes('track') ||
      clean === 'parent_action_track_my_bus'
    ) {
      return ParentWhatsAppAction.TRACK_MY_BUS;
    }

    // 2. My ETA
    if (
      clean === '2' ||
      clean === 'eta' ||
      clean === 'my eta' ||
      clean === 'time' ||
      clean === 'arrival' ||
      clean === 'when' ||
      clean === 'expected' ||
      clean.includes('eta') ||
      clean === 'parent_action_my_eta'
    ) {
      return ParentWhatsAppAction.MY_ETA;
    }

    // 3. My Child
    if (
      clean === '3' ||
      clean === 'child' ||
      clean === 'my child' ||
      clean === 'student' ||
      clean === 'kid' ||
      clean === 'attendance' ||
      clean === 'status' ||
      clean.includes('child') ||
      clean === 'parent_action_my_child'
    ) {
      return ParentWhatsAppAction.MY_CHILD;
    }

    // 4. My Pickup
    if (
      clean === '4' ||
      clean === 'pickup' ||
      clean === 'my pickup' ||
      clean === 'stop' ||
      clean === 'pickup stop' ||
      clean.includes('pickup') ||
      clean === 'parent_action_my_pickup'
    ) {
      return ParentWhatsAppAction.MY_PICKUP;
    }

    // 5. Notifications
    if (
      clean === '5' ||
      clean === 'notifications' ||
      clean === 'notification' ||
      clean === 'alerts' ||
      clean === 'alert' ||
      clean === 'updates' ||
      clean.includes('alert') ||
      clean === 'parent_action_notifications'
    ) {
      return ParentWhatsAppAction.NOTIFICATIONS;
    }

    // 6. Help
    if (
      clean === '6' ||
      clean === 'help' ||
      clean === 'support' ||
      clean === 'contact' ||
      clean === 'helpline' ||
      clean === 'emergency' ||
      clean === 'sos' ||
      clean.includes('help') ||
      clean === 'parent_action_help'
    ) {
      return ParentWhatsAppAction.HELP;
    }

    // Menu / Greeting keywords
    if (
      clean === '0' ||
      clean === 'menu' ||
      clean === 'hi' ||
      clean === 'hello' ||
      clean === 'hey' ||
      clean === 'namaste' ||
      clean === 'start' ||
      clean === 'home'
    ) {
      return 'MENU';
    }

    return 'UNKNOWN_COMMAND';
  }

  /**
   * Orchestrates inbound WhatsApp message from a parent
   */
  public static async handleInboundMessage(
    req: ParentWhatsAppInboundRequest
  ): Promise<ParentWhatsAppInboundResponse> {
    const { from, text, action, schoolId } = req;
    const normalizedPhone = normalizeIndianPhoneNumber(from);

    // 1. Resolve Parent Context
    const parent = await this.findParentByPhone(from, schoolId);

    if (!parent) {
      const replyText =
        `Namaste! We could not find a registered student linked to your WhatsApp number (*${normalizedPhone}*).\n\n` +
        `If you are a parent or guardian, please contact your school administration to update your registered mobile number for school bus transport.\n\n` +
        `_School Bus Transportation Safety Platform_`;

      // Try sending response
      await MessagingService.sendMessage({
        recipientPhone: normalizedPhone,
        directText: replyText,
        recipientRole: 'PARENT',
      }).catch((err) => {
        logger.warn(`Failed to dispatch unregistered parent notice: ${err.message}`);
      });

      return {
        handled: true,
        actionTriggered: 'UNREGISTERED',
        replyText,
        whatsappDelivered: true,
      };
    }

    // 2. Direct GPS location submission via WhatsApp live location pin or API
    if (
      req.location &&
      req.location.latitude !== undefined &&
      req.location.longitude !== undefined
    ) {
      const updateResult = await this.handlePickupLocationUpdate(parent, {
        latitude: req.location.latitude,
        longitude: req.location.longitude,
        stopName: req.location.name || undefined,
        landmark: req.location.address || undefined,
      });

      let whatsappDelivered = false;
      try {
        const sendResult = await MessagingService.sendMessage({
          recipientPhone: normalizedPhone,
          directText: updateResult.formattedMessage,
          recipientRole: 'PARENT',
          schoolId: parent.schoolId,
        });
        whatsappDelivered = sendResult.status === 'sent' || sendResult.status === 'queued';
      } catch (err: any) {
        logger.warn(`Failed to dispatch WhatsApp reply to parent ${normalizedPhone}: ${err.message}`);
      }

      return {
        handled: true,
        parentId: parent.parentId,
        studentId: parent.studentId,
        schoolId: parent.schoolId,
        actionTriggered: ParentWhatsAppAction.MY_PICKUP,
        replyText: updateResult.formattedMessage,
        data: updateResult as any,
        whatsappDelivered,
      };
    }

    // 3. Resolve Active Trip Context
    const activeTrip = await this.getParentTripContext(parent.schoolId, parent.pickupStop?.id);

    // 4. Resolve Target Action
    const targetAction: ParentWhatsAppAction | 'MENU' | 'UNKNOWN_COMMAND' =
      action || this.parseParentAction(text);

    let replyText = '';
    let actionData: any = undefined;

    switch (targetAction) {
      case ParentWhatsAppAction.TRACK_MY_BUS: {
        const res = await this.handleTrackMyBus(parent, activeTrip);
        replyText = res.replyText;
        actionData = res.data;
        break;
      }
      case ParentWhatsAppAction.MY_ETA: {
        const res = await this.handleMyEta(parent, activeTrip);
        replyText = res.replyText;
        actionData = res.data;
        break;
      }
      case ParentWhatsAppAction.MY_CHILD: {
        const res = await this.handleMyChild(parent, activeTrip);
        replyText = res.replyText;
        actionData = res.data;
        break;
      }
      case ParentWhatsAppAction.MY_PICKUP: {
        const res = await this.handleMyPickup(parent, activeTrip);
        replyText = res.replyText;
        actionData = res.data;
        break;
      }
      case ParentWhatsAppAction.NOTIFICATIONS: {
        const res = await this.handleNotifications(parent);
        replyText = res.replyText;
        actionData = res.data;
        break;
      }
      case ParentWhatsAppAction.HELP: {
        const res = await this.handleHelp(parent);
        replyText = res.replyText;
        actionData = res.data;
        break;
      }
      case 'MENU': {
        const menu = await this.getParentMenu(from, schoolId);
        replyText = menu?.formattedText || this.formatParentMenuText({
          parentName: parent.parentName,
          studentName: parent.studentName,
          classGrade: parent.classGrade,
          section: parent.section,
          schoolName: parent.schoolName,
          activeTrip,
          pickupStopName: parent.pickupStop?.stopName,
        });
        break;
      }
      case 'UNKNOWN_COMMAND':
      default: {
        replyText =
          `We didn’t understand: "${text?.substring(0, 30)}".\n\n` +
          this.formatParentMenuText({
            parentName: parent.parentName,
            studentName: parent.studentName,
            classGrade: parent.classGrade,
            section: parent.section,
            schoolName: parent.schoolName,
            activeTrip,
            pickupStopName: parent.pickupStop?.stopName,
          });
        break;
      }
    }

    // 5. Send Outbound WhatsApp Reply
    let whatsappDelivered = false;
    try {
      const sendResult = await MessagingService.sendMessage({
        recipientPhone: normalizedPhone,
        directText: replyText,
        recipientRole: 'PARENT',
        schoolId: parent.schoolId,
      });
      whatsappDelivered = sendResult.status === 'sent' || sendResult.status === 'queued';
    } catch (err: any) {
      logger.warn(`Failed to dispatch WhatsApp reply to parent ${normalizedPhone}: ${err.message}`);
    }

    const menu = targetAction === 'MENU' ? await this.getParentMenu(from, schoolId) || undefined : undefined;

    return {
      handled: true,
      parentId: parent.parentId,
      studentId: parent.studentId,
      schoolId: parent.schoolId,
      actionTriggered: targetAction,
      replyText,
      menu,
      data: actionData,
      whatsappDelivered,
    };
  }

  /**
   * Inbound WhatsApp Cloud API / Webhook payload processor
   */
  public static async handleWebhookPayload(
    body: any
  ): Promise<ParentWhatsAppInboundResponse | { handled: boolean }> {
    // 1. Meta Cloud API format: entry[].changes[].value.messages[]
    if (body?.entry && Array.isArray(body.entry)) {
      for (const entry of body.entry) {
        if (!entry.changes || !Array.isArray(entry.changes)) continue;
        for (const change of entry.changes) {
          const value = change.value;
          if (!value || !value.messages || !Array.isArray(value.messages)) continue;

          for (const msg of value.messages) {
            const from = msg.from;
            let text = '';

            if (msg.type === 'location' && msg.location && from) {
              return await this.handleInboundMessage({
                from,
                location: {
                  latitude: Number(msg.location.latitude),
                  longitude: Number(msg.location.longitude),
                  name: msg.location.name,
                  address: msg.location.address,
                },
              });
            }

            if (msg.type === 'text' && msg.text?.body) {
              text = msg.text.body;
            } else if (msg.type === 'interactive') {
              if (msg.interactive?.button_reply?.id) {
                text = msg.interactive.button_reply.id;
              } else if (msg.interactive?.list_reply?.id) {
                text = msg.interactive.list_reply.id;
              }
            } else if (msg.type === 'button' && msg.button?.text) {
              text = msg.button.text;
            }

            if (from) {
              return await this.handleInboundMessage({
                from,
                text,
              });
            }
          }
        }
      }
    }

    // 2. Direct format { from, text, location } for test simulator or generic provider
    if (body?.from) {
      return await this.handleInboundMessage({
        from: body.from,
        text: body.text,
        action: body.action,
        schoolId: body.schoolId,
        location: body.location,
      });
    }

    return { handled: false };
  }
}

