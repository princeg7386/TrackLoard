/**
 * PickupArrivalService — Phase 31.1: Upcoming Student Pickup
 *
 * Determines the next pickup stop for an active trip and identifies
 * all students assigned to that stop with their current attendance state.
 *
 * Logic:
 *  1. Validate trip is active (IN_TRANSIT | DELAYED | ARRIVED_SCHOOL) and school-scoped.
 *  2. Load all remaining stops in sequence order (> current_stop_sequence).
 *  3. For each stop, check student_stop_assignments + boarding_events for this trip.
 *  4. The first stop with at least one PENDING student is the "next pickup".
 *  5. Return all students for that stop (any attendance state) for driver context.
 *  6. If no pending stop exists, return allPickupsComplete = true.
 *
 * No DB migration needed — uses existing: trips, pickup_locations,
 * student_stop_assignments, boarding_events, students, parents tables.
 *
 * All queries enforce school_id tenant isolation.
 */

import { query } from '../config/database.js';
import { logger } from './logger.service.js';
import { BadRequestError, NotFoundError } from '../middlewares/error.middleware.js';

// ── Active trip statuses (canonical vocabulary — must match consistency.test.ts) ──
const ACTIVE_TRIP_STATUSES = ['IN_TRANSIT', 'DELAYED', 'ARRIVED_SCHOOL'] as const;

// ── Types ──────────────────────────────────────────────────────────────────────

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
}

// ── Internal DB row types ─────────────────────────────────────────────────────

interface TripRow {
  id: string;
  school_id: string;
  route_id: string;
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

// ── Service ───────────────────────────────────────────────────────────────────

export class PickupArrivalService {
  /**
   * Returns the next pickup stop and its students for an active trip.
   *
   * The "next" stop is the first stop in route sequence order (beyond
   * current_stop_sequence) that has at least one student without a
   * confirmed BOARDED, ABSENT, or SKIPPED status for this trip.
   *
   * @throws NotFoundError   if trip not found in the school
   * @throws BadRequestError if trip is not in an active state
   */
  static async getUpcomingStudents(
    tripId: string,
    schoolId: string
  ): Promise<UpcomingPickupResult> {
    // ── 1. Load and validate trip ────────────────────────────────────────────
    const tripRows = await query<TripRow>(
      `SELECT id, school_id, route_id, status, current_stop_sequence
         FROM trips
        WHERE id        = $1
          AND school_id = $2
          AND deleted_at IS NULL
        LIMIT 1`,
      [tripId, schoolId]
    );

    if (tripRows.length === 0) {
      throw new NotFoundError(`Trip ${tripId} not found in this school`);
    }

    const trip = tripRows[0]!;

    if (!(ACTIVE_TRIP_STATUSES as readonly string[]).includes(trip.status)) {
      throw new BadRequestError(
        `Trip ${tripId} is not active (status: ${trip.status}). ` +
          `Only ${ACTIVE_TRIP_STATUSES.join(', ')} trips have upcoming students.`
      );
    }

    // ── 2. Load remaining stops in sequence order ────────────────────────────
    const stopRows = await query<StopRow>(
      `SELECT id, stop_name, sequence_order, latitude, longitude,
              scheduled_time, geofence_radius_meters
         FROM pickup_locations
        WHERE route_id      = $1
          AND school_id     = $2
          AND sequence_order > $3
        ORDER BY sequence_order ASC`,
      [trip.route_id, schoolId, trip.current_stop_sequence]
    );

    // ── 3. Walk stops in order to find first one with pending students ────────
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

      // ── Found the next pickup stop ──────────────────────────────────────────
      const nextStop: UpcomingPickupStop = {
        id: stop.id,
        name: stop.stop_name,
        sequenceOrder: Number(stop.sequence_order),
        latitude: Number(stop.latitude),
        longitude: Number(stop.longitude),
        scheduledTime: stop.scheduled_time,
        geofenceRadiusMeters: Number(stop.geofence_radius_meters),
      };

      logger.info('[PickupArrivalService] Next pickup stop identified', {
        tripId,
        stopId: stop.id,
        stopName: stop.stop_name,
        sequenceOrder: stop.sequence_order,
        totalPending,
        totalAtStop: students.length,
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
      };
    }

    // ── 4. No pending stop found — all pickups complete ──────────────────────
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
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
