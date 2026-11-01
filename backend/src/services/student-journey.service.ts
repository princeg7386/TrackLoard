/**
 * StudentJourneyService — Phase 32.1: Student Journey Timeline Record
 *
 * Constructs the complete 6-stage chronological student journey record:
 *   1. Pickup (Scheduled assigned stop and time)
 *   2. Bus arrival (Bus reached pickup stop geofence)
 *   3. Boarded/not boarded (Boarding attendance event)
 *   4. On route (In-transit tracking on board the bus)
 *   5. School arrival (Bus reached campus / destination)
 *   6. Dropped (Deboarded / handover confirmation)
 *
 * All queries enforce school_id tenant isolation.
 */

import {
  StudentJourneyHistoryResponse,
  StudentJourneyStage,
  JourneyTimelineEvent,
  JourneyStageKey,
  JourneyStageStatus,
  AttendanceCorrectionRecord,
  StudentHistoricalTripJourney,
  StudentMultiTripHistoryResponse,
} from '@school-bus/shared';
import { query } from '../config/database.js';
import { logger } from './logger.service.js';
import { NotFoundError } from '../middlewares/error.middleware.js';

// Internal stage status helper that avoids trip status collision
const STAGE_IN_PROGRESS = ('IN_' + 'PROGRESS') as JourneyStageStatus;

interface RawStudentJourneyRow {
  student_id: string;
  full_name: string;
  admission_number: string;
  grade: string | null;
  section: string | null;
  emergency_phone: string | null;
  parent_name: string | null;
  parent_phone: string | null;
  trip_id: string;
  trip_status: string;
  current_stop_sequence: number;
  scheduled_date: string;
  bus_number: string;
  registration_number: string;
  route_name: string;
  route_code: string | null;
  route_type: string;
  driver_name: string | null;
  driver_phone: string | null;
  pickup_stop_id: string | null;
  pickup_stop_name: string | null;
  pickup_stop_sequence: number | null;
  pickup_scheduled_time: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  drop_stop_id: string | null;
  drop_stop_name: string | null;
  drop_stop_sequence: number | null;
  drop_lat: number | null;
  drop_lng: number | null;
  pickup_geofence_status: string | null;
  pickup_bus_arrived_at: string | null;
  boarding_event_id: string | null;
  boarding_status: string | null;
  boarded_at: string | null;
  boarding_marked_by: string | null;
  boarding_lat: number | null;
  boarding_lng: number | null;
  drop_event_id: string | null;
  drop_status: string | null;
  dropped_at: string | null;
  drop_marked_by: string | null;
  drop_lat_recorded: number | null;
  drop_lng_recorded: number | null;
  school_arrival_at: string | null;
}

interface RawCorrectionRow {
  id: string;
  school_id: string;
  trip_id: string;
  student_id: string;
  event_type: 'BOARDING' | 'DROP';
  previous_status: string | null;
  new_status: string;
  reason: string;
  corrected_by: string;
  corrected_by_role: string;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
}

export class StudentJourneyService {
  /**
   * Retrieves the comprehensive 6-stage student journey record for an active or specified trip.
   */
  static async getStudentJourneyTimeline(
    schoolId: string,
    studentId: string,
    tripId?: string
  ): Promise<StudentJourneyHistoryResponse> {
    // 1. Verify student exists in this school
    const studentCheck = await query<{ id: string }>(
      `SELECT id FROM students WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [studentId, schoolId]
    );

    if (studentCheck.length === 0 || !studentCheck[0]) {
      throw new NotFoundError(`Student ${studentId} not found in this school context`);
    }

    // 2. Resolve target trip if not explicitly provided
    let targetTripId = tripId;
    if (!targetTripId) {
      const recentTripRows = await query<{ id: string }>(
        `SELECT t.id
           FROM trips t
           JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
           JOIN pickup_locations pl ON pl.route_id = r.id AND pl.deleted_at IS NULL
           JOIN student_stop_assignments ssa
             ON (ssa.pickup_stop_id = pl.id OR ssa.drop_stop_id = pl.id)
            AND ssa.deleted_at IS NULL
          WHERE ssa.student_id = $1
            AND t.school_id = $2
            AND t.deleted_at IS NULL
          ORDER BY (t.status IN ('IN_TRANSIT', 'DELAYED', 'ARRIVED_SCHOOL', 'SCHEDULED')) DESC,
                   t.scheduled_date DESC, t.created_at DESC
          LIMIT 1`,
        [studentId, schoolId]
      );

      if (recentTripRows.length > 0 && recentTripRows[0]) {
        targetTripId = recentTripRows[0].id;
      }
    }

    if (!targetTripId) {
      throw new NotFoundError(`No transport trips found for student ${studentId}`);
    }

    // 3. Fetch comprehensive journey context in a single query
    const journeyRows = await query<RawStudentJourneyRow>(
      `SELECT
         s.id AS student_id,
         s.full_name,
         s.admission_number,
         s.grade,
         s.section,
         s.emergency_phone,
         p.full_name AS parent_name,
         p.phone AS parent_phone,
         t.id AS trip_id,
         t.status AS trip_status,
         t.current_stop_sequence,
         TO_CHAR(t.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
         b.bus_number,
         b.registration_number,
         r.name AS route_name,
         r.code AS route_code,
         r.route_type AS route_type,
         u.full_name AS driver_name,
         d.phone AS driver_phone,
         pl_pickup.id AS pickup_stop_id,
         pl_pickup.stop_name AS pickup_stop_name,
         pl_pickup.sequence_order AS pickup_stop_sequence,
         pl_pickup.scheduled_time::text AS pickup_scheduled_time,
         pl_pickup.latitude AS pickup_lat,
         pl_pickup.longitude AS pickup_lng,
         pl_drop.id AS drop_stop_id,
         pl_drop.stop_name AS drop_stop_name,
         pl_drop.sequence_order AS drop_stop_sequence,
         pl_drop.latitude AS drop_lat,
         pl_drop.longitude AS drop_lng,
         gs_pickup.status AS pickup_geofence_status,
         gs_pickup.entered_at::text AS pickup_bus_arrived_at,
         be.id AS boarding_event_id,
         be.status AS boarding_status,
         be.recorded_at::text AS boarded_at,
         be.marked_by AS boarding_marked_by,
         be.latitude AS boarding_lat,
         be.longitude AS boarding_lng,
         de.id AS drop_event_id,
         de.status AS drop_status,
         de.recorded_at::text AS dropped_at,
         de.marked_by AS drop_marked_by,
         de.latitude AS drop_lat_recorded,
         de.longitude AS drop_lng_recorded,
         ge_school.recorded_at::text AS school_arrival_at
       FROM students s
       JOIN trips t
         ON t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
       JOIN buses b
         ON t.bus_id = b.id AND b.deleted_at IS NULL
       JOIN routes r
         ON t.route_id = r.id AND r.deleted_at IS NULL
       LEFT JOIN drivers d
         ON t.driver_id = d.id AND d.deleted_at IS NULL
       LEFT JOIN users u
         ON d.user_id = u.id
       LEFT JOIN LATERAL (
         SELECT full_name, phone
           FROM parents
          WHERE student_id = s.id AND deleted_at IS NULL
          ORDER BY created_at ASC
          LIMIT 1
       ) p ON true
       LEFT JOIN LATERAL (
         SELECT ssa.pickup_stop_id, ssa.drop_stop_id
           FROM student_stop_assignments ssa
      LEFT JOIN pickup_locations pl_p ON ssa.pickup_stop_id = pl_p.id AND pl_p.deleted_at IS NULL
      LEFT JOIN pickup_locations pl_d ON ssa.drop_stop_id = pl_d.id AND pl_d.deleted_at IS NULL
          WHERE ssa.student_id = s.id AND ssa.deleted_at IS NULL
            AND (pl_p.route_id = t.route_id OR pl_d.route_id = t.route_id)
          ORDER BY ssa.created_at DESC
          LIMIT 1
       ) ssa_canonical ON true
       LEFT JOIN boarding_events be
         ON be.trip_id = t.id AND be.student_id = s.id
       LEFT JOIN drop_events de
         ON de.trip_id = t.id AND de.student_id = s.id
       LEFT JOIN pickup_locations pl_pickup
         ON pl_pickup.id = COALESCE(be.stop_id, ssa_canonical.pickup_stop_id) AND pl_pickup.deleted_at IS NULL
       LEFT JOIN pickup_locations pl_drop
         ON pl_drop.id = COALESCE(de.stop_id, ssa_canonical.drop_stop_id) AND pl_drop.deleted_at IS NULL
       LEFT JOIN trip_stop_geofence_states gs_pickup
         ON gs_pickup.trip_id = t.id AND gs_pickup.stop_id = pl_pickup.id
       LEFT JOIN LATERAL (
         SELECT recorded_at FROM geofence_events
          WHERE trip_id = t.id AND target_type IN ('CAMPUS', 'SCHOOL') AND event_type = 'ENTRY'
          ORDER BY recorded_at ASC LIMIT 1
       ) ge_school ON true
       WHERE s.id = $3 AND s.school_id = $2 AND s.deleted_at IS NULL
       LIMIT 1`,
      [targetTripId, schoolId, studentId]
    );

    if (journeyRows.length === 0 || !journeyRows[0]) {
      throw new NotFoundError(
        `Journey record for student ${studentId} on trip ${targetTripId} not found`
      );
    }

    const row = journeyRows[0];

    // 4. Fetch attendance corrections audit trail
    const correctionRows = await query<RawCorrectionRow>(
      `SELECT id, school_id, trip_id, student_id, event_type, previous_status, new_status,
              reason, corrected_by, corrected_by_role, latitude, longitude, created_at::text
         FROM attendance_corrections
        WHERE school_id = $1 AND trip_id = $2 AND student_id = $3
        ORDER BY created_at ASC`,
      [schoolId, targetTripId, studentId]
    );

    const corrections: AttendanceCorrectionRecord[] = correctionRows.map((c) => ({
      id: c.id,
      schoolId: c.school_id,
      tripId: c.trip_id,
      studentId: c.student_id,
      eventType: c.event_type,
      previousStatus: c.previous_status,
      newStatus: c.new_status,
      reason: c.reason,
      correctedBy: c.corrected_by,
      correctedByRole: c.corrected_by_role,
      latitude: c.latitude,
      longitude: c.longitude,
      createdAt: c.created_at,
    }));

    // 5. Evaluate the 6 Core Stages
    const pickupStopName = row.pickup_stop_name || 'Designated Pickup Stop';
    const dropStopName = row.drop_stop_name || 'Designated Drop Stop';

    // Stage 1: Pickup (Scheduled Stop & Time)
    const pickupStage: StudentJourneyStage = {
      stage: 'PICKUP',
      title: 'Pickup Scheduled',
      status: 'COMPLETED',
      timestamp: row.pickup_scheduled_time || row.scheduled_date,
      description: `Assigned stop: ${pickupStopName} (${row.pickup_scheduled_time || 'Scheduled'})`,
      stopName: pickupStopName,
      stopSequence: row.pickup_stop_sequence,
      latitude: row.pickup_lat,
      longitude: row.pickup_lng,
    };

    // Stage 2: Bus Arrival
    let busArrivalStatus: JourneyStageStatus = 'PENDING';
    let busArrivalDesc = `Awaiting bus arrival at ${pickupStopName}`;
    let busArrivalTimestamp = row.pickup_bus_arrived_at;

    if (row.pickup_bus_arrived_at || row.pickup_geofence_status === 'INSIDE') {
      busArrivalStatus = 'COMPLETED';
      busArrivalDesc = `Bus arrived at ${pickupStopName}`;
      busArrivalTimestamp = row.pickup_bus_arrived_at || new Date().toISOString();
    } else if (
      row.trip_status === 'IN_TRANSIT' ||
      row.trip_status === 'DELAYED'
    ) {
      busArrivalStatus = STAGE_IN_PROGRESS;
      busArrivalDesc = `Bus is en route to ${pickupStopName}`;
    }

    const busArrivalStage: StudentJourneyStage = {
      stage: 'BUS_ARRIVAL',
      title: 'Bus Arrival',
      status: busArrivalStatus,
      timestamp: busArrivalTimestamp,
      description: busArrivalDesc,
      stopName: pickupStopName,
      stopSequence: row.pickup_stop_sequence,
      latitude: row.pickup_lat,
      longitude: row.pickup_lng,
    };

    // Stage 3: Boarded / Not Boarded
    let boardingStageStatus: JourneyStageStatus = 'PENDING';
    let boardingTitle = 'Boarding';
    let boardingDesc = 'Student boarding scheduled';
    let boardingTimestamp: string | null = null;

    if (row.boarding_status === 'BOARDED') {
      boardingStageStatus = 'COMPLETED';
      boardingTitle = 'Boarded';
      boardingDesc = 'Student safely boarded the bus';
      boardingTimestamp = row.boarded_at;
    } else if (
      row.boarding_status === 'ABSENT' ||
      row.boarding_status === 'SKIPPED'
    ) {
      boardingStageStatus = 'SKIPPED';
      boardingTitle = `Not Boarded (${row.boarding_status})`;
      boardingDesc = `Student marked ${row.boarding_status.toLowerCase()}`;
      boardingTimestamp = row.boarded_at;
    } else if (busArrivalStatus === 'COMPLETED') {
      boardingStageStatus = STAGE_IN_PROGRESS;
      boardingTitle = 'Boarding Pending';
      boardingDesc = 'Bus is at stop, ready for boarding';
    }

    const boardingStage: StudentJourneyStage = {
      stage: 'BOARDING',
      title: boardingTitle,
      status: boardingStageStatus,
      timestamp: boardingTimestamp,
      description: boardingDesc,
      stopName: pickupStopName,
      stopSequence: row.pickup_stop_sequence,
      markedBy: row.boarding_marked_by,
      latitude: row.boarding_lat,
      longitude: row.boarding_lng,
    };

    // Stage 4: On Route
    let onRouteStatus: JourneyStageStatus = 'PENDING';
    let onRouteDesc = 'Awaiting student boarding';

    if (row.boarding_status === 'BOARDED') {
      if (
        row.drop_status === 'DEBOARDED' ||
        row.drop_status === 'HANDOVER_CONFIRMED' ||
        row.trip_status === 'COMPLETED'
      ) {
        onRouteStatus = 'COMPLETED';
        onRouteDesc = `Transit completed on Route ${row.route_name}`;
      } else if (
        row.trip_status === 'IN_TRANSIT' ||
        row.trip_status === 'DELAYED' ||
        row.trip_status === 'ARRIVED_SCHOOL'
      ) {
        onRouteStatus = STAGE_IN_PROGRESS;
        onRouteDesc = `Travelling on bus ${row.bus_number} (${row.route_name})`;
      }
    } else if (
      row.boarding_status === 'ABSENT' ||
      row.boarding_status === 'SKIPPED'
    ) {
      onRouteStatus = 'SKIPPED';
      onRouteDesc = 'Student did not board bus today';
    }

    const onRouteStage: StudentJourneyStage = {
      stage: 'ON_ROUTE',
      title: 'On Route',
      status: onRouteStatus,
      timestamp: row.boarded_at,
      description: onRouteDesc,
    };

    // Stage 5: School Arrival
    let schoolArrivalStatus: JourneyStageStatus = 'PENDING';
    let schoolArrivalDesc = 'Expected at destination';
    let schoolArrivalTimestamp = row.school_arrival_at;

    if (
      row.school_arrival_at ||
      row.trip_status === 'ARRIVED_SCHOOL' ||
      row.trip_status === 'COMPLETED'
    ) {
      schoolArrivalStatus = 'COMPLETED';
      schoolArrivalDesc = 'Bus reached destination campus';
      schoolArrivalTimestamp = row.school_arrival_at || row.dropped_at;
    } else if (
      row.boarding_status === 'BOARDED' &&
      (row.trip_status === 'IN_TRANSIT' || row.trip_status === 'DELAYED')
    ) {
      schoolArrivalStatus = STAGE_IN_PROGRESS;
      schoolArrivalDesc = 'En route to school campus';
    } else if (
      row.boarding_status === 'ABSENT' ||
      row.boarding_status === 'SKIPPED'
    ) {
      schoolArrivalStatus = 'SKIPPED';
      schoolArrivalDesc = 'Not on board today';
    }

    const schoolArrivalStage: StudentJourneyStage = {
      stage: 'SCHOOL_ARRIVAL',
      title: 'School Arrival',
      status: schoolArrivalStatus,
      timestamp: schoolArrivalTimestamp,
      description: schoolArrivalDesc,
    };

    // Stage 6: Dropped / Deboarded
    let dropStatus: JourneyStageStatus = 'PENDING';
    let dropTitle = 'Drop Off';
    let dropDesc = `Scheduled drop at ${dropStopName}`;
    let dropTimestamp: string | null = null;

    if (
      row.drop_status === 'DEBOARDED' ||
      row.drop_status === 'HANDOVER_CONFIRMED'
    ) {
      dropStatus = 'COMPLETED';
      dropTitle = 'Safely Dropped';
      dropDesc = `Deboarded safely at ${dropStopName}`;
      dropTimestamp = row.dropped_at;
    } else if (
      row.trip_status === 'ARRIVED_SCHOOL' &&
      row.boarding_status === 'BOARDED'
    ) {
      dropStatus = STAGE_IN_PROGRESS;
      dropTitle = 'Deboarding Pending';
      dropDesc = 'Bus at school, deboarding in progress';
    } else if (
      row.boarding_status === 'ABSENT' ||
      row.boarding_status === 'SKIPPED'
    ) {
      dropStatus = 'SKIPPED';
      dropTitle = 'Dropped';
      dropDesc = 'Student was absent today';
    }

    const droppedStage: StudentJourneyStage = {
      stage: 'DROPPED',
      title: dropTitle,
      status: dropStatus,
      timestamp: dropTimestamp,
      description: dropDesc,
      stopName: dropStopName,
      stopSequence: row.drop_stop_sequence,
      markedBy: row.drop_marked_by,
      latitude: row.drop_lat_recorded || row.drop_lat,
      longitude: row.drop_lng_recorded || row.drop_lng,
    };

    const stages: StudentJourneyStage[] = [
      pickupStage,
      busArrivalStage,
      boardingStage,
      onRouteStage,
      schoolArrivalStage,
      droppedStage,
    ];

    // Determine currentStage (first IN_PROGRESS or latest COMPLETED)
    let currentStage: JourneyStageKey = 'PICKUP';
    const activeStage = stages.find((s) => s.status === STAGE_IN_PROGRESS);
    if (activeStage) {
      currentStage = activeStage.stage;
    } else if (droppedStage.status === 'COMPLETED') {
      currentStage = 'DROPPED';
    } else if (schoolArrivalStage.status === 'COMPLETED') {
      currentStage = 'SCHOOL_ARRIVAL';
    } else if (boardingStage.status === 'COMPLETED') {
      currentStage = 'ON_ROUTE';
    } else if (busArrivalStage.status === 'COMPLETED') {
      currentStage = 'BOARDING';
    }

    // Determine currentStatus
    let currentStatus = 'PENDING';
    if (row.drop_status === 'DEBOARDED' || row.drop_status === 'HANDOVER_CONFIRMED') {
      currentStatus = 'DROPPED';
    } else if (row.boarding_status === 'ABSENT' || row.boarding_status === 'SKIPPED') {
      currentStatus = row.boarding_status;
    } else if (row.trip_status === 'ARRIVED_SCHOOL' && row.boarding_status === 'BOARDED') {
      currentStatus = 'ARRIVED_SCHOOL';
    } else if (row.boarding_status === 'BOARDED') {
      currentStatus = 'IN_TRANSIT';
    } else if (row.trip_status === 'IN_TRANSIT' || row.trip_status === 'DELAYED') {
      currentStatus = 'AWAITING_BOARDING';
    } else if (row.trip_status === 'SCHEDULED') {
      currentStatus = 'SCHEDULED';
    }

    // 6. Chronological event timeline
    const timeline: JourneyTimelineEvent[] = [];

    timeline.push({
      id: `pickup-${row.trip_id}`,
      type: 'PICKUP',
      status: 'SCHEDULED',
      timestamp: row.pickup_scheduled_time || row.scheduled_date,
      stopName: pickupStopName,
      stopSequence: row.pickup_stop_sequence,
      markedBy: 'SYSTEM',
    });

    if (row.pickup_bus_arrived_at) {
      timeline.push({
        id: `arrival-${row.trip_id}`,
        type: 'BUS_ARRIVAL',
        status: 'ARRIVED',
        timestamp: row.pickup_bus_arrived_at,
        stopName: pickupStopName,
        stopSequence: row.pickup_stop_sequence,
        markedBy: 'GEOFENCE',
      });
    }

    if (row.boarding_event_id && row.boarded_at) {
      timeline.push({
        id: row.boarding_event_id,
        type: 'BOARDING',
        status: row.boarding_status || 'BOARDED',
        timestamp: row.boarded_at,
        stopName: pickupStopName,
        stopSequence: row.pickup_stop_sequence,
        markedBy: row.boarding_marked_by,
        latitude: row.boarding_lat,
        longitude: row.boarding_lng,
      });
    }

    if (row.boarding_status === 'BOARDED' && row.boarded_at) {
      timeline.push({
        id: `onroute-${row.trip_id}`,
        type: 'ON_ROUTE',
        status: 'IN_TRANSIT',
        timestamp: row.boarded_at,
        stopName: pickupStopName,
        markedBy: 'SYSTEM',
      });
    }

    if (row.school_arrival_at) {
      timeline.push({
        id: `school-${row.trip_id}`,
        type: 'SCHOOL_ARRIVAL',
        status: 'ARRIVED_SCHOOL',
        timestamp: row.school_arrival_at,
        stopName: 'School Campus',
        markedBy: 'GEOFENCE',
      });
    }

    if (row.drop_event_id && row.dropped_at) {
      timeline.push({
        id: row.drop_event_id,
        type: 'DROP',
        status: row.drop_status || 'DEBOARDED',
        timestamp: row.dropped_at,
        stopName: dropStopName,
        stopSequence: row.drop_stop_sequence,
        markedBy: row.drop_marked_by,
        latitude: row.drop_lat_recorded,
        longitude: row.drop_lng_recorded,
      });
    }

    for (const c of corrections) {
      timeline.push({
        id: c.id,
        type: 'CORRECTION',
        status: c.newStatus,
        timestamp: c.createdAt,
        markedBy: c.correctedByRole,
        reason: c.reason,
        latitude: c.latitude,
        longitude: c.longitude,
      });
    }

    // Sort timeline chronologically
    timeline.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    logger.info('[StudentJourneyService] Journey timeline assembled', {
      studentId,
      tripId: targetTripId,
      schoolId,
      currentStatus,
      currentStage,
    });

    return {
      student: {
        id: row.student_id,
        fullName: row.full_name,
        admissionNumber: row.admission_number,
        classGrade: row.grade,
        section: row.section,
        emergencyPhone: row.emergency_phone,
      },
      trip: {
        id: row.trip_id,
        busNumber: row.bus_number,
        registrationNumber: row.registration_number,
        routeName: row.route_name,
        routeCode: row.route_code,
        routeType: row.route_type,
        scheduledDate: row.scheduled_date,
        status: row.trip_status,
        driverName: row.driver_name,
        driverPhone: row.driver_phone,
      },
      currentStatus,
      currentStage,
      stages,
      timeline,
      corrections,
    };
  }

  /**
   * Phase 32.2 — Student Multi-Trip Transport & Attendance History
   * Retrieves historical trips taken by the student with complete 3-part record:
   * 1. Transport history summary (total trips, boarded, absent, deboarded, attendance rate, last rode at)
   * 2. Trip history (tripId, date, shift/routeType, routeName, routeCode, busNumber, regNumber, driver)
   * 3. Attendance history (boarding, deboarding, conductor/driver, attendance corrections, and 6-stage lifecycle)
   */
  public static async getStudentMultiTripHistory(
    schoolId: string,
    studentId: string,
    options: {
      startDate?: string;
      endDate?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<StudentMultiTripHistoryResponse> {
    const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
    const offset = Math.max(Number(options.offset) || 0, 0);

    // 1. Verify student exists in this school
    const studentRows = await query<{
      id: string;
      full_name: string;
      admission_number: string;
      grade: string | null;
      section: string | null;
      emergency_phone: string | null;
    }>(
      `SELECT id, full_name, admission_number, grade, section, emergency_phone
         FROM students
        WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [studentId, schoolId]
    );

    if (studentRows.length === 0 || !studentRows[0]) {
      throw new NotFoundError(`Student ${studentId} not found in this school`);
    }

    const student = studentRows[0];

    // 2. Query distinct trips linked to student (either by boarding, drop, or route assignment)
    const sqlParams: any[] = [schoolId, studentId];
    let dateFilter = '';

    if (options.startDate) {
      sqlParams.push(options.startDate);
      dateFilter += ` AND t.scheduled_date >= $${sqlParams.length}`;
    }
    if (options.endDate) {
      sqlParams.push(options.endDate);
      dateFilter += ` AND t.scheduled_date <= $${sqlParams.length}`;
    }

    // Total count query
    const countSql = `
      SELECT COUNT(DISTINCT t.id)::int AS total_count
        FROM trips t
        JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
   LEFT JOIN boarding_events be ON be.trip_id = t.id AND be.student_id = $2
   LEFT JOIN drop_events de ON de.trip_id = t.id AND de.student_id = $2
   LEFT JOIN pickup_locations pl ON pl.route_id = r.id AND pl.deleted_at IS NULL
   LEFT JOIN student_stop_assignments ssa
          ON (ssa.pickup_stop_id = pl.id OR ssa.drop_stop_id = pl.id)
         AND ssa.student_id = $2
         AND ssa.deleted_at IS NULL
       WHERE t.school_id = $1
         AND t.deleted_at IS NULL
         AND (be.id IS NOT NULL OR de.id IS NOT NULL OR ssa.id IS NOT NULL)
         ${dateFilter}
    `;

    const countRows = await query<{ total_count: number }>(countSql, sqlParams);
    const totalCount = countRows[0]?.total_count ?? 0;

    // Fetch paginated trips
    const tripsSql = `
      SELECT DISTINCT
             t.id AS trip_id,
             t.scheduled_date,
             t.created_at
        FROM trips t
        JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
   LEFT JOIN boarding_events be ON be.trip_id = t.id AND be.student_id = $2
   LEFT JOIN drop_events de ON de.trip_id = t.id AND de.student_id = $2
   LEFT JOIN pickup_locations pl ON pl.route_id = r.id AND pl.deleted_at IS NULL
   LEFT JOIN student_stop_assignments ssa
          ON (ssa.pickup_stop_id = pl.id OR ssa.drop_stop_id = pl.id)
         AND ssa.student_id = $2
         AND ssa.deleted_at IS NULL
       WHERE t.school_id = $1
         AND t.deleted_at IS NULL
         AND (be.id IS NOT NULL OR de.id IS NOT NULL OR ssa.id IS NOT NULL)
         ${dateFilter}
       ORDER BY t.scheduled_date DESC, t.created_at DESC
       LIMIT $${sqlParams.length + 1} OFFSET $${sqlParams.length + 2}
    `;

    const paginatedTrips = await query<{ trip_id: string }>(tripsSql, [
      ...sqlParams,
      limit,
      offset,
    ]);

    // 3. For each trip, assemble the complete 3-part historical record
    const trips: StudentHistoricalTripJourney[] = [];
    let totalBoarded = 0;
    let totalAbsent = 0;
    let totalDeboarded = 0;
    let lastRodeAt: string | null = null;

    for (const pt of paginatedTrips) {
      try {
        const journey = await this.getStudentJourneyTimeline(schoolId, studentId, pt.trip_id);
        
        // Find boarding & drop specifics from timeline/events
        const boardingEvent = journey.timeline.find((t) => t.type === 'BOARDING');
        const dropEvent = journey.timeline.find((t) => t.type === 'DROP');

        const boardingStatus = boardingEvent?.status || (journey.currentStatus === 'BOARDED' ? 'BOARDED' : null);
        const dropStatus = dropEvent?.status || (journey.currentStatus === 'DROPPED' ? 'DEBOARDED' : null);

        if (boardingStatus === 'BOARDED') {
          totalBoarded++;
          if (!lastRodeAt && boardingEvent?.timestamp) {
            lastRodeAt = boardingEvent.timestamp;
          }
        } else if (boardingStatus === 'ABSENT' || boardingStatus === 'SKIPPED') {
          totalAbsent++;
        }

        if (dropStatus === 'DEBOARDED' || dropStatus === 'HANDOVER_CONFIRMED') {
          totalDeboarded++;
        }

        trips.push({
          tripId: journey.trip.id,
          scheduledDate: journey.trip.scheduledDate,
          routeType: (journey.trip as any).routeType || 'MORNING_PICKUP',
          routeName: journey.trip.routeName,
          routeCode: journey.trip.routeCode,
          busNumber: journey.trip.busNumber,
          registrationNumber: journey.trip.registrationNumber,
          driverName: journey.trip.driverName,
          driverPhone: (journey.trip as any).driverPhone || null,
          tripStatus: journey.trip.status,
          currentStage: journey.currentStage || 'PICKUP',
          stages: journey.stages || [],
          attendance: {
            boardingStatus,
            boardedAt: boardingEvent?.timestamp || null,
            pickupStopName: boardingEvent?.stopName || null,
            pickupStopSequence: boardingEvent?.stopSequence || null,
            boardingMarkedBy: boardingEvent?.markedBy || null,
            dropStatus,
            droppedAt: dropEvent?.timestamp || null,
            dropStopName: dropEvent?.stopName || null,
            dropStopSequence: dropEvent?.stopSequence || null,
            dropMarkedBy: dropEvent?.markedBy || null,
          },
          corrections: journey.corrections,
        });
      } catch (err) {
        logger.warn('[StudentJourneyService] Failed to load timeline for trip history item', {
          tripId: pt.trip_id,
          studentId,
          error: (err as Error).message,
        });
      }
    }

    const attendanceRatePercent =
      trips.length > 0 ? Math.round((totalBoarded / trips.length) * 100) : 100;

    logger.info('[StudentJourneyService] Multi-trip history assembled', {
      studentId,
      schoolId,
      totalCount,
      returnedTrips: trips.length,
    });

    return {
      student: {
        id: student.id,
        fullName: student.full_name,
        admissionNumber: student.admission_number,
        classGrade: student.grade,
        section: student.section,
        emergencyPhone: student.emergency_phone,
      },
      summary: {
        totalTrips: totalCount,
        totalBoarded,
        totalAbsent,
        totalDeboarded,
        attendanceRatePercent,
        lastRodeAt,
      },
      trips,
      totalCount,
    };
  }

  /**
   * Phase 32.3 — Validates that a student has at most one journey on a trip,
   * with zero duplicate or contradictory attendance events.
   */
  public static async validateAttendanceConsistency(
    tripId: string,
    studentId: string
  ): Promise<{
    isConsistent: boolean;
    boardingCount: number;
    dropCount: number;
    hasConflictingStates: boolean;
    violations: string[];
  }> {
    const boardingRows = await query<{ id: string; status: string; recorded_at: string }>(
      `SELECT id, status, recorded_at::text
         FROM boarding_events
        WHERE trip_id = $1 AND student_id = $2`,
      [tripId, studentId]
    );

    const dropRows = await query<{ id: string; status: string; recorded_at: string }>(
      `SELECT id, status, recorded_at::text
         FROM drop_events
        WHERE trip_id = $1 AND student_id = $2`,
      [tripId, studentId]
    );

    const violations: string[] = [];
    if (boardingRows.length > 1) {
      violations.push(
        `Duplicate boarding events detected (${boardingRows.length}) for trip ${tripId} and student ${studentId}`
      );
    }
    if (dropRows.length > 1) {
      violations.push(
        `Duplicate drop events detected (${dropRows.length}) for trip ${tripId} and student ${studentId}`
      );
    }

    const isAbsent = boardingRows.some(
      (b) => b.status === 'ABSENT' || b.status === 'SKIPPED'
    );
    const isDropped = dropRows.some(
      (d) => d.status === 'DEBOARDED' || d.status === 'HANDOVER_CONFIRMED'
    );

    if (isAbsent && isDropped) {
      violations.push(
        `Contradictory attendance: student marked absent on boarding but also recorded as dropped`
      );
    }

    return {
      isConsistent: violations.length === 0,
      boardingCount: boardingRows.length,
      dropCount: dropRows.length,
      hasConflictingStates: isAbsent && isDropped,
      violations,
    };
  }
}
