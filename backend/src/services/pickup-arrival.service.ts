/**
 * PickupArrivalService — Phase 31.1 & 31.3: Pickup Arrival Workflow
 *
 * Micro-phase 31.1: Upcoming Student Pickup (determine next stop + student list)
 * Micro-phase 31.3: Stop Arrival (geofence event, parent arrival WhatsApp notification, boarding available)
 *
 * All queries enforce school_id tenant isolation.
 */

import { query } from '../config/database.js';
import { logger } from './logger.service.js';
import { BadRequestError, NotFoundError } from '../middlewares/error.middleware.js';
import { ParentNotificationService } from './parent-notification.service.js';
import { RealtimeFeedService } from './realtime-feed.service.js';

// ─── Active trip statuses (canonical vocabulary — must match consistency.test.ts) ───
const ACTIVE_TRIP_STATUSES = ['IN_TRANSIT', 'DELAYED', 'ARRIVED_SCHOOL'] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type UpcomingStudentAttendanceStatus = 'PENDING' | 'BOARDED' | 'ABSENT' | 'SKIPPED';

export interface UpcomingStudentItem {
  studentId: string;
  fullName: string;
  admissionNumber: string;
  classGrade: string;
  section: string;
  /** Parent primary contact phone (from parents table, may be null if not linked) */
  parentPhone: string | null;
  attendanceStatus: UpcomingStudentAttendanceStatus;
  /** ISO timestamp of boarding, null if not yet boarded */
  boardedAt: string | null;
}

export interface UpcomingPickupStop {
  id: string;
  name: string;
  sequenceOrder: number;
  latitude: number;
  longitude: number;
  /** Scheduled time string from pickup_locations.scheduled_time (HH:MM:SS) */
  scheduledTime: string;
  geofenceRadiusMeters: number;
  /** True when bus is currently inside the stop geofence or arrived */
  isAtStop: boolean;
  /** ISO timestamp when stop was entered/arrived, or null if outside */
  arrivedAt: string | null;
}

export interface UpcomingPickupResult {
  tripId: string;
  schoolId: string;
  tripStatus: string;
  currentStopSequence: number;
  /** The next stop with at least one PENDING student — null if all pickups done */
  nextStop: UpcomingPickupStop | null;
  /** All students assigned to nextStop with their current attendance state */
  students: UpcomingStudentItem[];
  /** How many students at nextStop are still awaiting pickup */
  totalPending: number;
  /** Total students assigned to nextStop */
  totalAtStop: number;
  /** True when no remaining stops have pending students */
  allPickupsComplete: boolean;
  /** Phase 31.3: True when bus is at the next pickup stop */
  isAtStop: boolean;
  /** Phase 31.3: True when boarding can be recorded for the stop */
  boardingAvailable: boolean;
  /** Phase 31.3: ISO timestamp of arrival at stop, or null */
  arrivedAt: string | null;
}

export interface StopArrivalResult {
  tripId: string;
  schoolId: string;
  stopId: string;
  stopName: string;
  sequenceOrder: number;
  status: 'INSIDE';
  arrivedAt: string;
  boardingAvailable: boolean;
  parentNotificationsSent: number;
}

// ─── Internal DB row types ───────────────────────────────────────────────────

interface TripRow {
  id: string;
  school_id: string;
  route_id: string;
  bus_id: string;
  status: string;
  current_stop_sequence: number;
}

interface StopRow {
  id: string;
  stop_name: string;
  sequence_order: number;
  latitude: number;
  longitude: number;
  scheduled_time: string;
  geofence_radius_meters: number;
  geofence_status?: string | null;
  stop_entered_at?: string | null;
}

interface StudentAtStopRow {
  student_id: string;
  full_name: string;
  admission_number: string;
  grade: string;
  section: string;
  parent_phone: string | null;
  boarding_status: string | null;
  boarded_at: string | null;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class PickupArrivalService {
  /**
   * Phase 31.1 & 31.3: Returns the next pickup stop and its students for an active trip.
   * Also indicates whether the bus has reached the stop (isAtStop / boardingAvailable).
   *
   * @throws NotFoundError   if trip not found in the school
   * @throws BadRequestError if trip is not in an active state
   */
  static async getUpcomingStudents(
    tripId: string,
    schoolId: string
  ): Promise<UpcomingPickupResult> {
    // ─── 1. Validate trip exists, belongs to school, and is in active lifecycle state ───
    const tripRows = await query<TripRow>(
      `SELECT id, school_id, route_id, bus_id, status, current_stop_sequence
         FROM trips
        WHERE id = $1
          AND school_id = $2
          AND deleted_at IS NULL`,
      [tripId, schoolId]
    );

    if (tripRows.length === 0) {
      throw new NotFoundError(`Trip ${tripId} not found for this school`);
    }

    const trip = tripRows[0];
    if (!trip) {
      throw new NotFoundError(`Trip ${tripId} not found for this school`);
    }

    if (!ACTIVE_TRIP_STATUSES.includes(trip.status as (typeof ACTIVE_TRIP_STATUSES)[number])) {
      throw new BadRequestError(
        `Cannot get upcoming students for trip ${tripId}: trip is not active (status: '${trip.status}', must be one of: ${ACTIVE_TRIP_STATUSES.join(', ')})`
      );
    }

    // ─── 2. Fetch remaining stops in route sequence order (> current_stop_sequence) ───
    const stopRows = await query<StopRow>(
      `SELECT
        pl.id,
        pl.stop_name,
        pl.sequence_order,
        pl.latitude,
        pl.longitude,
        pl.scheduled_time,
        pl.geofence_radius_meters,
        gs.status AS geofence_status,
        gs.entered_at::text AS stop_entered_at
      FROM pickup_locations pl
      LEFT JOIN trip_stop_geofence_states gs
        ON gs.stop_id = pl.id
       AND gs.trip_id = $4
      WHERE pl.route_id       = $1
        AND pl.school_id      = $2
        AND pl.sequence_order > $3
        AND pl.deleted_at IS NULL
      ORDER BY pl.sequence_order ASC`,
      [trip.route_id, schoolId, trip.current_stop_sequence, tripId]
    );

    // ─── 3. Walk stops in order to find first one with pending students ───────
    for (const stop of stopRows) {
      const studentRows = await query<StudentAtStopRow>(
        `SELECT
            s.id              AS student_id,
            s.full_name,
            s.admission_number,
            s.grade,
            s.section,
            p.phone_number    AS parent_phone,
            be.status         AS boarding_status,
            be.recorded_at    AS boarded_at
           FROM student_stop_assignments ssa
           JOIN students s
             ON ssa.student_id = s.id
            AND s.deleted_at IS NULL
           LEFT JOIN parents p
             ON p.student_id = s.id
            AND p.deleted_at IS NULL
           LEFT JOIN boarding_events be
             ON be.student_id = s.id
            AND be.trip_id    = $3
           WHERE ssa.pickup_stop_id = $1
             AND ssa.school_id      = $2
           ORDER BY s.full_name ASC`,
        [stop.id, schoolId, tripId]
      );

      if (studentRows.length === 0) {
        // No students assigned to this stop — skip
        logger.info('[PickupArrivalService] Stop has no student assignments, skipping', {
          tripId,
          stopId: stop.id,
          stopName: stop.stop_name,
          sequenceOrder: stop.sequence_order,
        });
        continue;
      }

      const students: UpcomingStudentItem[] = studentRows.map((r) => ({
        studentId: r.student_id,
        fullName: r.full_name,
        admissionNumber: r.admission_number,
        classGrade: r.grade,
        section: r.section,
        parentPhone: r.parent_phone,
        attendanceStatus: mapBoardingStatus(r.boarding_status),
        boardedAt: r.boarded_at,
      }));

      const totalPending = students.filter((s) => s.attendanceStatus === 'PENDING').length;

      if (totalPending === 0) {
        // All students at this stop already have attendance recorded — advance
        continue;
      }

      // ─── Found the next pickup stop ─────────────────────────────────────────
      const isAtStop = stop.geofence_status === 'INSIDE';
      const arrivedAt = isAtStop ? (stop.stop_entered_at ?? null) : null;
      const boardingAvailable = isAtStop;

      const nextStop: UpcomingPickupStop = {
        id: stop.id,
        name: stop.stop_name,
        sequenceOrder: Number(stop.sequence_order),
        latitude: Number(stop.latitude),
        longitude: Number(stop.longitude),
        scheduledTime: stop.scheduled_time,
        geofenceRadiusMeters: Number(stop.geofence_radius_meters),
        isAtStop,
        arrivedAt,
      };

      logger.info('[PickupArrivalService] Next pickup stop identified', {
        tripId,
        stopId: stop.id,
        stopName: stop.stop_name,
        sequenceOrder: stop.sequence_order,
        totalPending,
        totalAtStop: students.length,
        isAtStop,
        boardingAvailable,
      });

      return {
        tripId: trip.id,
        schoolId: trip.school_id,
        tripStatus: trip.status,
        currentStopSequence: Number(trip.current_stop_sequence),
        nextStop,
        students,
        totalPending,
        totalAtStop: students.length,
        allPickupsComplete: false,
        isAtStop,
        boardingAvailable,
        arrivedAt,
      };
    }

    // ─── 4. No pending stop found — all pickups complete ─────────────────────
    logger.info('[PickupArrivalService] All pickups complete for trip', { tripId });

    return {
      tripId: trip.id,
      schoolId: trip.school_id,
      tripStatus: trip.status,
      currentStopSequence: Number(trip.current_stop_sequence),
      nextStop: null,
      students: [],
      totalPending: 0,
      totalAtStop: 0,
      allPickupsComplete: true,
      isAtStop: false,
      boardingAvailable: false,
      arrivedAt: null,
    };
  }

  /**
   * Phase 31.3: Record arrival at a pickup stop.
   *
   * 1. Validates trip is active and school-scoped.
   * 2. Validates stop exists on this trip's route.
   * 3. Upserts trip_stop_geofence_states ('INSIDE', entered_at = NOW()).
   * 4. Inserts geofence_events ENTRY ledger record (idempotent for this stop entry).
   * 5. Dispatches parent arrival WhatsApp notification via ParentNotificationService.notifyBusArrivedStop.
   * 6. Broadcasts real-time feed event.
   * 7. Returns status showing boarding is now available.
   */
  static async recordStopArrival(
    schoolId: string,
    tripId: string,
    stopId: string
  ): Promise<StopArrivalResult> {
    // 1. Validate trip exists and is active
    const tripRows = await query<TripRow>(
      `SELECT id, school_id, route_id, bus_id, status, current_stop_sequence
         FROM trips
        WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [tripId, schoolId]
    );

    if (tripRows.length === 0) {
      throw new NotFoundError(`Trip ${tripId} not found for this school`);
    }

    const trip = tripRows[0];
    if (!trip) {
      throw new NotFoundError(`Trip ${tripId} not found for this school`);
    }

    if (!ACTIVE_TRIP_STATUSES.includes(trip.status as (typeof ACTIVE_TRIP_STATUSES)[number])) {
      throw new BadRequestError(
        `Cannot record stop arrival for trip ${tripId}: trip is not active (status: '${trip.status}', must be one of: ${ACTIVE_TRIP_STATUSES.join(', ')})`
      );
    }

    // 2. Validate stop belongs to route and school
    const stopRows = await query<StopRow>(
      `SELECT id, stop_name, sequence_order, latitude, longitude, scheduled_time, geofence_radius_meters
         FROM pickup_locations
        WHERE id = $1 AND route_id = $2 AND school_id = $3 AND deleted_at IS NULL`,
      [stopId, trip.route_id, schoolId]
    );

    if (stopRows.length === 0) {
      throw new NotFoundError(`Stop ${stopId} not found on this trip's route`);
    }

    const stop = stopRows[0];
    if (!stop) {
      throw new NotFoundError(`Stop ${stopId} not found on this trip's route`);
    }

    const nowIso = new Date().toISOString();

    // 3. Upsert state in trip_stop_geofence_states
    const stateUpsert = await query<{ entered_at: string }>(
      `INSERT INTO trip_stop_geofence_states (
         trip_id, stop_id, status, entered_at, exited_at, dwell_time_seconds, last_evaluated_at, updated_at
       ) VALUES ($1, $2, 'INSIDE', NOW(), NULL, 0, NOW(), NOW())
       ON CONFLICT (trip_id, stop_id)
       DO UPDATE SET
         status = 'INSIDE',
         entered_at = COALESCE(trip_stop_geofence_states.entered_at, EXCLUDED.entered_at),
         exited_at = NULL,
         last_evaluated_at = NOW(),
         updated_at = NOW()
       RETURNING entered_at::text;`,
      [tripId, stopId]
    );

    const arrivedAt = stateUpsert[0]?.entered_at || nowIso;

    // 4. Record ENTRY in geofence_events ledger
    await query(
      `INSERT INTO geofence_events (
         school_id, trip_id, bus_id, stop_id, target_type, event_type,
         latitude, longitude, location, distance_to_center_meters, dwell_time_seconds, recorded_at
       ) VALUES (
         $1, $2, $3, $4, 'STOP', 'ENTRY',
         $5, $6, ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography, 0, 0, NOW()
       );`,
      [schoolId, tripId, trip.bus_id, stopId, stop.latitude, stop.longitude]
    );

    // 5. Parent WhatsApp arrival notification (non-blocking / error-suppressed)
    let notificationsSent = 0;
    try {
      const notifResult = await ParentNotificationService.notifyBusArrivedStop({
        schoolId,
        tripId,
        stopId,
        stopName: stop.stop_name,
      });
      notificationsSent = notifResult.notificationsSent;
    } catch (err) {
      logger.warn('[PickupArrivalService] Failed to notify parents of stop arrival (suppressed)', {
        tripId,
        stopId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 6. Broadcast real-time feed event
    try {
      RealtimeFeedService.publish({
        type: 'GEOFENCE_EVENT',
        schoolId,
        tripId,
        busId: trip.bus_id,
        stopId,
        stopName: stop.stop_name,
        sequenceOrder: stop.sequence_order,
        eventType: 'ENTRY',
        status: 'INSIDE',
        distanceMeters: 0,
        timestamp: arrivedAt,
      });
    } catch (_) {}

    logger.info('[PickupArrivalService] Stop arrival recorded — boarding available', {
      tripId,
      stopId,
      stopName: stop.stop_name,
      sequenceOrder: stop.sequence_order,
      notificationsSent,
    });

    return {
      tripId,
      schoolId,
      stopId,
      stopName: stop.stop_name,
      sequenceOrder: Number(stop.sequence_order),
      status: 'INSIDE',
      arrivedAt,
      boardingAvailable: true,
      parentNotificationsSent: notificationsSent,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Maps raw boarding_events.status (nullable) to the UpcomingStudentAttendanceStatus enum.
 * Null means no boarding_event row yet → PENDING.
 */
function mapBoardingStatus(raw: string | null): UpcomingStudentAttendanceStatus {
  if (!raw) return 'PENDING';
  switch (raw.toUpperCase()) {
    case 'BOARDED':
      return 'BOARDED';
    case 'ABSENT':
      return 'ABSENT';
    case 'SKIPPED':
      return 'SKIPPED';
    default:
      return 'PENDING';
  }
}
