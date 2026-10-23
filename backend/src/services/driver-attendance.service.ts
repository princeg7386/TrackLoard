import {
  AttendanceStatus,
  DriverStudentAttendanceItem,
  DriverStudentListResponse,
  RecordBoardingRequest,
  RecordBoardingResponse,
  RecordBoardingBatchRequest,
  RecordBoardingBatchResponse,
  RecordBoardingStatus,
  BoardingEventRecord,
} from '@school-bus/shared';
import { query } from '../config/database.js';
import { logger } from './logger.service.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../middlewares/error.middleware.js';

export interface DriverAttendanceActorContext {
  userId?: string;
  isDriver?: boolean;
  userRole?: string;
  schoolId?: string;
}

export class DriverAttendanceService {
  /**
   * Retrieves registered students and pickup stop details for a driver's assigned bus or trip.
   * Multi-tenant isolated, ordered by pickup stop sequence order.
   */
  public static async getStudentsForAssignedBus(
    schoolId: string,
    params: {
      busId?: string;
      driverId?: string;
      tripId?: string;
    },
    actor?: DriverAttendanceActorContext
  ): Promise<DriverStudentListResponse> {
    if (actor?.schoolId && actor.schoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant driver attendance access attempt');
    }

    if (actor?.isDriver && actor.userId) {
      if (params.driverId && params.driverId !== actor.userId) {
        throw new ForbiddenError('Driver cannot access other driver student records');
      }
    }

    let targetBusId: string | undefined = params.busId;
    let targetRouteId: string | undefined;
    let targetTripId: string | undefined = params.tripId;
    let busNumber = '';
    let registrationNumber = '';
    let routeName: string | undefined;
    let routeCode: string | undefined;

    // 1. If tripId is provided, resolve directly from the trip
    if (targetTripId) {
      const tripRows = await query<{
        id: string;
        school_id: string;
        bus_id: string;
        route_id: string;
        driver_id: string;
        bus_number: string | null;
        registration_number: string | null;
        route_name: string | null;
        route_code: string | null;
      }>(
        `SELECT t.id, t.school_id, t.bus_id, t.route_id, t.driver_id,
                b.bus_number, b.registration_number,
                r.name AS route_name, r.code AS route_code
         FROM trips t
         JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
         JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
         WHERE t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
         LIMIT 1`,
        [targetTripId, schoolId]
      );

      if (tripRows.length === 0 || !tripRows[0]) {
        throw new NotFoundError(`Trip ${targetTripId} not found in this school context`);
      }

      const trip = tripRows[0];
      if (actor?.isDriver && actor.userId && trip.driver_id !== actor.userId) {
        throw new ForbiddenError('Driver is not assigned to this trip');
      }

      targetBusId = trip.bus_id;
      targetRouteId = trip.route_id;
      busNumber = trip.bus_number || '';
      registrationNumber = trip.registration_number || '';
      routeName = trip.route_name || undefined;
      routeCode = trip.route_code || undefined;
    }

    // 2. If targetBusId not resolved, resolve from driver or bus query
    if (!targetBusId) {
      const effectiveDriverId = params.driverId || (actor?.isDriver ? actor.userId : undefined);

      if (effectiveDriverId) {
        // Resolve driver's active trip or default assigned bus
        const driverRows = await query<{
          driver_id: string;
          bus_id: string | null;
          bus_number: string | null;
          registration_number: string | null;
          active_trip_id: string | null;
          active_route_id: string | null;
          active_route_name: string | null;
          active_route_code: string | null;
        }>(
          `SELECT d.id AS driver_id, b.id AS bus_id, b.bus_number, b.registration_number,
                  t.id AS active_trip_id, t.route_id AS active_route_id,
                  r.name AS active_route_name, r.code AS active_route_code
           FROM drivers d
           LEFT JOIN buses b ON b.default_driver_id = d.id AND b.deleted_at IS NULL
           LEFT JOIN trips t ON t.driver_id = d.id AND t.school_id = d.school_id
                             AND (t.status = 'IN_TRANSIT' OR t.status = 'DELAYED' OR t.status = 'ARRIVED_SCHOOL')
                             AND t.deleted_at IS NULL
           LEFT JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
           WHERE d.id = $1 AND d.school_id = $2 AND d.deleted_at IS NULL
           ORDER BY t.created_at DESC
           LIMIT 1`,
          [effectiveDriverId, schoolId]
        );

        if (driverRows.length === 0 || !driverRows[0]) {
          throw new NotFoundError(`Driver ${effectiveDriverId} not found in this school context`);
        }

        const dRow = driverRows[0];
        if (dRow.active_trip_id) {
          targetTripId = dRow.active_trip_id;
          targetRouteId = dRow.active_route_id || undefined;
          routeName = dRow.active_route_name || undefined;
          routeCode = dRow.active_route_code || undefined;
        }

        if (dRow.bus_id) {
          targetBusId = dRow.bus_id;
          busNumber = dRow.bus_number || '';
          registrationNumber = dRow.registration_number || '';
        }
      }
    }

    // 3. If targetBusId is provided explicitly, fetch vehicle details
    if (targetBusId && !busNumber) {
      const bRows = await query<{
        id: string;
        bus_number: string;
        registration_number: string;
      }>(
        `SELECT id, bus_number, registration_number
         FROM buses
         WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
         LIMIT 1`,
        [targetBusId, schoolId]
      );

      if (bRows.length === 0 || !bRows[0]) {
        throw new NotFoundError(`Bus ${targetBusId} not found in this school context`);
      }

      busNumber = bRows[0].bus_number;
      registrationNumber = bRows[0].registration_number;
    }

    if (!targetBusId) {
      throw new BadRequestError('No assigned bus or active trip specified for student list lookup');
    }

    // 4. If targetRouteId is not yet resolved, lookup route assigned to this bus
    if (!targetRouteId) {
      const routeRows = await query<{
        id: string;
        name: string;
        code: string;
      }>(
        `SELECT id, name, code
         FROM routes
         WHERE default_bus_id = $1 AND school_id = $2 AND deleted_at IS NULL
         ORDER BY created_at ASC
         LIMIT 1`,
        [targetBusId, schoolId]
      );

      if (routeRows.length > 0 && routeRows[0]) {
        targetRouteId = routeRows[0].id;
        routeName = routeRows[0].name;
        routeCode = routeRows[0].code;
      }
    }

    // 5. If no route is associated, return empty student list with bus metadata
    if (!targetRouteId) {
      return {
        tripId: targetTripId,
        busId: targetBusId,
        busNumber,
        registrationNumber,
        routeId: undefined,
        routeName: undefined,
        routeCode: undefined,
        totalStudents: 0,
        boardedCount: 0,
        droppedCount: 0,
        absentCount: 0,
        pendingCount: 0,
        students: [],
      };
    }

    // 6. Query registered students mapped to this route's pickup locations
    const studentRows = await query<{
      student_id: string;
      admission_number: string;
      full_name: string;
      grade: string | null;
      section: string | null;
      emergency_phone: string | null;
      pickup_stop_id: string;
      pickup_stop_name: string;
      pickup_sequence_order: number;
      pickup_expected_offset: number | null;
      pickup_latitude: number;
      pickup_longitude: number;
      pickup_address: string | null;
      drop_stop_id: string | null;
      drop_stop_name: string | null;
      drop_sequence_order: number | null;
      drop_expected_offset: number | null;
      drop_latitude: number | null;
      drop_longitude: number | null;
      drop_address: string | null;
      parent_full_name: string | null;
      parent_phone: string | null;
      parent_relationship: string | null;
      boarding_status: string | null;
      boarded_at: string | null;
      boarding_marked_by: string | null;
      drop_status: string | null;
      dropped_at: string | null;
      drop_marked_by: string | null;
    }>(
      `SELECT
         s.id AS student_id,
         s.admission_number,
         s.full_name,
         s.class_grade AS grade,
         s.section,
         s.emergency_contact_phone AS emergency_phone,
         pl_pickup.id AS pickup_stop_id,
         pl_pickup.stop_name AS pickup_stop_name,
         pl_pickup.sequence_order AS pickup_sequence_order,
         NULL::integer AS pickup_expected_offset,
         pl_pickup.latitude AS pickup_latitude,
         pl_pickup.longitude AS pickup_longitude,
         NULL::text AS pickup_address,
         pl_drop.id AS drop_stop_id,
         pl_drop.stop_name AS drop_stop_name,
         pl_drop.sequence_order AS drop_sequence_order,
         NULL::integer AS drop_expected_offset,
         pl_drop.latitude AS drop_latitude,
         pl_drop.longitude AS drop_longitude,
         NULL::text AS drop_address,
         p.full_name AS parent_full_name,
         p.phone AS parent_phone,
         p.relationship AS parent_relationship,
         be.status AS boarding_status,
         be.recorded_at::text AS boarded_at,
         be.marked_by AS boarding_marked_by,
         de.status AS drop_status,
         de.recorded_at::text AS dropped_at,
         de.marked_by AS drop_marked_by
       FROM students s
       JOIN student_stop_assignments ssa ON ssa.student_id = s.id AND ssa.deleted_at IS NULL
       JOIN pickup_locations pl_pickup ON ssa.pickup_stop_id = pl_pickup.id AND pl_pickup.deleted_at IS NULL
       LEFT JOIN pickup_locations pl_drop ON ssa.drop_stop_id = pl_drop.id AND pl_drop.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT p1.full_name, p1.phone, p1.relationship
         FROM parents p1
         WHERE p1.student_id = s.id AND p1.deleted_at IS NULL
         ORDER BY p1.created_at ASC
         LIMIT 1
       ) p ON true
       LEFT JOIN boarding_events be ON be.student_id = s.id AND ($3::uuid IS NOT NULL AND be.trip_id = $3::uuid)
       LEFT JOIN drop_events de ON de.student_id = s.id AND ($3::uuid IS NOT NULL AND de.trip_id = $3::uuid)
       WHERE s.school_id = $1
         AND (pl_pickup.route_id = $2 OR pl_drop.route_id = $2)
         AND s.deleted_at IS NULL
       ORDER BY pl_pickup.sequence_order ASC, s.full_name ASC`,
      [schoolId, targetRouteId, targetTripId || null]
    );

    let boardedCount = 0;
    let droppedCount = 0;
    let absentCount = 0;
    let pendingCount = 0;

    const students: DriverStudentAttendanceItem[] = studentRows.map((row) => {
      let attendanceStatus = AttendanceStatus.PENDING;
      let markedBy: string | undefined;

      if (row.drop_status === 'DEBOARDED' || row.drop_status === 'HANDOVER_CONFIRMED') {
        attendanceStatus = AttendanceStatus.DEBOARDED;
        markedBy = row.drop_marked_by || undefined;
        droppedCount++;
      } else if (row.boarding_status === 'BOARDED') {
        attendanceStatus = AttendanceStatus.BOARDED;
        markedBy = row.boarding_marked_by || undefined;
        boardedCount++;
      } else if (row.boarding_status === 'ABSENT') {
        attendanceStatus = AttendanceStatus.ABSENT;
        markedBy = row.boarding_marked_by || undefined;
        absentCount++;
      } else if (row.boarding_status === 'SKIPPED') {
        attendanceStatus = AttendanceStatus.SKIPPED;
        markedBy = row.boarding_marked_by || undefined;
      } else {
        pendingCount++;
      }

      return {
        studentId: row.student_id,
        admissionNumber: row.admission_number,
        fullName: row.full_name,
        grade: row.grade || undefined,
        section: row.section || undefined,
        emergencyPhone: row.emergency_phone || undefined,
        pickupStop: {
          id: row.pickup_stop_id,
          name: row.pickup_stop_name,
          sequenceOrder: Number(row.pickup_sequence_order),
          expectedTimeOffsetMinutes: row.pickup_expected_offset != null ? Number(row.pickup_expected_offset) : undefined,
          latitude: Number(row.pickup_latitude),
          longitude: Number(row.pickup_longitude),
          address: row.pickup_address || undefined,
        },
        dropStop: row.drop_stop_id
          ? {
              id: row.drop_stop_id,
              name: row.drop_stop_name || 'School Drop',
              sequenceOrder: row.drop_sequence_order != null ? Number(row.drop_sequence_order) : 999,
              expectedTimeOffsetMinutes: row.drop_expected_offset != null ? Number(row.drop_expected_offset) : undefined,
              latitude: Number(row.drop_latitude || 0),
              longitude: Number(row.drop_longitude || 0),
              address: row.drop_address || undefined,
            }
          : undefined,
        parent: row.parent_full_name && row.parent_phone
          ? {
              fullName: row.parent_full_name,
              phone: row.parent_phone,
              relationship: row.parent_relationship || undefined,
            }
          : undefined,
        attendanceStatus,
        boardedAt: row.boarded_at || undefined,
        droppedAt: row.dropped_at || undefined,
        markedBy,
      };
    });

    return {
      tripId: targetTripId,
      busId: targetBusId,
      busNumber,
      registrationNumber,
      routeId: targetRouteId,
      routeName,
      routeCode,
      totalStudents: students.length,
      boardedCount,
      droppedCount,
      absentCount,
      pendingCount,
      students,
    };
  }

  /**
   * Formats student roster summary for driver WhatsApp interaction
   */
  public static formatWhatsAppStudentList(response: DriverStudentListResponse): string {
    const { busNumber, routeName, routeCode, totalStudents, students } = response;
    const routeLabel = routeCode ? `${routeCode} - ${routeName || 'Assigned Route'}` : routeName || 'Assigned Route';

    if (totalStudents === 0) {
      return (
        `📋 *Student Manifest — Bus ${busNumber}*\n\n` +
        `Route: *${routeLabel}*\n` +
        `No registered students found assigned to this route.\n\n` +
        `Please contact your School Transport Coordinator if students are missing.`
      );
    }

    // Group students by pickup stop
    const stopsMap = new Map<string, { stopName: string; seq: number; students: typeof students }>();
    for (const student of students) {
      const stopKey = student.pickupStop.id;
      if (!stopsMap.has(stopKey)) {
        stopsMap.set(stopKey, {
          stopName: student.pickupStop.name,
          seq: student.pickupStop.sequenceOrder,
          students: [],
        });
      }
      stopsMap.get(stopKey)!.students.push(student);
    }

    const sortedStops = Array.from(stopsMap.values()).sort((a, b) => a.seq - b.seq);

    let text =
      `📋 *Student Manifest — Bus ${busNumber}*\n` +
      `Route: *${routeLabel}*\n` +
      `Total Registered: *${totalStudents} students*\n\n`;

    for (const stop of sortedStops) {
      text += `🚏 *Stop #${stop.seq}: ${stop.stopName}* (${stop.students.length})\n`;
      for (const st of stop.students) {
        let statusIcon = '⏳';
        if (st.attendanceStatus === AttendanceStatus.BOARDED) statusIcon = '✅';
        else if (st.attendanceStatus === AttendanceStatus.ABSENT) statusIcon = '❌';
        else if (st.attendanceStatus === AttendanceStatus.DEBOARDED) statusIcon = '🏫';

        const gradeSection = st.grade ? ` (${st.grade}${st.section ? '-' + st.section : ''})` : '';
        const phone = st.parent?.phone || st.emergencyPhone || '';
        const phoneStr = phone ? ` • 📞 ${phone}` : '';
        text += `  ${statusIcon} ${st.fullName}${gradeSection}${phoneStr}\n`;
      }
      text += '\n';
    }

    text += `_Legend: ⏳ Pending • ✅ Boarded • ❌ Absent • 🏫 Deboarded_\nReply *3 <Name>* to search a specific student.`;
    return text;
  }

  /**
   * Micro-phase 18.2: Record Student Boarding Attendance
   * Tasks: Boarded, Not boarded (Absent), Timestamp, Location
   * Idempotent upsert into boarding_events ledger with PostGIS coordinates.
   */
  public static async recordBoarding(
    schoolId: string,
    payload: RecordBoardingRequest,
    actor?: DriverAttendanceActorContext
  ): Promise<RecordBoardingResponse> {
    if (actor?.schoolId && actor.schoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant driver attendance access attempt');
    }

    // 1. Fetch trip and verify existence, tenant isolation, status, and driver assignment
    const tripRows = await query<{
      id: string;
      school_id: string;
      bus_id: string;
      route_id: string;
      driver_id: string;
      status: string;
    }>(
      `SELECT id, school_id, bus_id, route_id, driver_id, status
       FROM trips
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [payload.tripId, schoolId]
    );

    if (tripRows.length === 0 || !tripRows[0]) {
      throw new NotFoundError(`Trip ${payload.tripId} not found in this school context`);
    }

    const trip = tripRows[0];

    // Driver verification
    if (actor?.isDriver && actor.userId && trip.driver_id !== actor.userId) {
      throw new ForbiddenError('Driver is not authorized to mark attendance for another driver\'s trip');
    }

    // Attendance ledger lock verification
    if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED') {
      throw new BadRequestError(`Cannot mark attendance on a ${trip.status.toLowerCase()} trip. Attendance ledger is permanently locked.`);
    }

    // 2. Fetch and verify student belongs to this school
    const studentRows = await query<{
      id: string;
      full_name: string;
      admission_number: string;
      school_id: string;
    }>(
      `SELECT id, full_name, admission_number, school_id
       FROM students
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [payload.studentId, schoolId]
    );

    if (studentRows.length === 0 || !studentRows[0]) {
      throw new NotFoundError(`Student ${payload.studentId} not found in this school context`);
    }

    const student = studentRows[0];

    // 3. Resolve pickup stop ID
    let resolvedStopId: string | undefined = payload.stopId;

    if (resolvedStopId) {
      const stopCheck = await query<{ id: string }>(
        `SELECT id
         FROM pickup_locations
         WHERE id = $1 AND route_id = $2 AND school_id = $3 AND deleted_at IS NULL
         LIMIT 1`,
        [resolvedStopId, trip.route_id, schoolId]
      );
      if (stopCheck.length === 0) {
        throw new BadRequestError(`Pickup stop ${resolvedStopId} is not on route ${trip.route_id}`);
      }
    } else {
      // Lookup assigned pickup stop for this student on this route
      const assignmentRows = await query<{ stop_id: string }>(
        `SELECT pl.id AS stop_id
         FROM student_stop_assignments ssa
         JOIN pickup_locations pl ON (ssa.pickup_stop_id = pl.id OR ssa.drop_stop_id = pl.id)
         WHERE ssa.student_id = $1 AND pl.route_id = $2 AND ssa.deleted_at IS NULL AND pl.deleted_at IS NULL
         ORDER BY pl.sequence_order ASC
         LIMIT 1`,
        [payload.studentId, trip.route_id]
      );

      if (assignmentRows.length > 0 && assignmentRows[0]) {
        resolvedStopId = assignmentRows[0].stop_id;
      } else {
        // Fallback to first stop of route if assignment not explicitly mapped
        const routeStops = await query<{ id: string }>(
          `SELECT id
           FROM pickup_locations
           WHERE route_id = $1 AND school_id = $2 AND deleted_at IS NULL
           ORDER BY sequence_order ASC
           LIMIT 1`,
          [trip.route_id, schoolId]
        );
        if (routeStops.length > 0 && routeStops[0]) {
          resolvedStopId = routeStops[0].id;
        } else {
          throw new BadRequestError(`No valid pickup stops found for route ${trip.route_id}`);
        }
      }
    }

    // 4. Upsert into boarding_events ledger (Idempotent per trip + student)
    const markedBy = actor?.userRole || (actor?.isDriver ? 'DRIVER' : 'SCHOOL_ADMIN');
    const recordedAt = payload.recordedAt || new Date().toISOString();
    const lat = payload.latitude != null ? payload.latitude : null;
    const lng = payload.longitude != null ? payload.longitude : null;

    const eventRows = await query<{
      id: string;
      trip_id: string;
      student_id: string;
      stop_id: string;
      status: string;
      marked_by: string;
      latitude: number | null;
      longitude: number | null;
      recorded_at: string;
    }>(
      `INSERT INTO boarding_events (
         trip_id,
         student_id,
         stop_id,
         status,
         marked_by,
         latitude,
         longitude,
         location,
         recorded_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         CASE WHEN $6::double precision IS NOT NULL AND $7::double precision IS NOT NULL
              THEN ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography
              ELSE NULL END,
         $8::timestamptz
       )
       ON CONFLICT (trip_id, student_id)
       DO UPDATE SET
         stop_id = EXCLUDED.stop_id,
         status = EXCLUDED.status,
         marked_by = EXCLUDED.marked_by,
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         location = EXCLUDED.location,
         recorded_at = EXCLUDED.recorded_at
       RETURNING id, trip_id, student_id, stop_id, status, marked_by, latitude, longitude, recorded_at::text`,
      [
        payload.tripId,
        payload.studentId,
        resolvedStopId,
        payload.status,
        markedBy,
        lat,
        lng,
        recordedAt,
      ]
    );

    const event = eventRows[0]!;

    logger.info(
      `[DriverAttendance] Recorded boarding for student ${student.full_name} (${student.admission_number}): ${payload.status} at stop ${resolvedStopId} (Trip: ${payload.tripId})`
    );

    // 5. Query updated attendance summary counts for this trip
    const countsRows = await query<{
      total_students: number;
      boarded_count: number;
      absent_count: number;
    }>(
      `SELECT
         (SELECT COUNT(DISTINCT ssa.student_id)::int
          FROM student_stop_assignments ssa
          JOIN pickup_locations pl ON (ssa.pickup_stop_id = pl.id OR ssa.drop_stop_id = pl.id)
          WHERE pl.route_id = $2 AND ssa.deleted_at IS NULL AND pl.deleted_at IS NULL) AS total_students,
         (SELECT COUNT(DISTINCT be.student_id)::int
          FROM boarding_events be
          WHERE be.trip_id = $1 AND be.status = 'BOARDED') AS boarded_count,
         (SELECT COUNT(DISTINCT be.student_id)::int
          FROM boarding_events be
          WHERE be.trip_id = $1 AND be.status = 'ABSENT') AS absent_count`,
      [payload.tripId, trip.route_id]
    );

    const totalStudents = Number(countsRows[0]?.total_students || 0);
    const boardedCount = Number(countsRows[0]?.boarded_count || 0);
    const absentCount = Number(countsRows[0]?.absent_count || 0);
    const pendingCount = Math.max(0, totalStudents - boardedCount - absentCount);

    return {
      event: {
        id: event.id,
        tripId: event.trip_id,
        studentId: event.student_id,
        stopId: event.stop_id,
        status: event.status as RecordBoardingStatus,
        markedBy: event.marked_by,
        latitude: event.latitude != null ? Number(event.latitude) : undefined,
        longitude: event.longitude != null ? Number(event.longitude) : undefined,
        recordedAt: new Date(event.recorded_at).toISOString(),
      },
      student: {
        id: student.id,
        fullName: student.full_name,
        admissionNumber: student.admission_number,
      },
      summary: {
        totalStudents,
        boardedCount,
        absentCount,
        pendingCount,
      },
    };
  }

  /**
   * Micro-phase 18.2: Batch Record Student Boarding Attendance
   * Records multiple students boarding at a designated pickup stop.
   */
  public static async recordBoardingBatch(
    schoolId: string,
    payload: RecordBoardingBatchRequest,
    actor?: DriverAttendanceActorContext
  ): Promise<RecordBoardingBatchResponse> {
    if (actor?.schoolId && actor.schoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant driver attendance access attempt');
    }

    if (!payload.records || payload.records.length === 0) {
      throw new BadRequestError('At least one boarding record is required in batch payload');
    }

    const events: BoardingEventRecord[] = [];

    for (const item of payload.records) {
      const res = await this.recordBoarding(
        schoolId,
        {
          tripId: payload.tripId,
          studentId: item.studentId,
          stopId: item.stopId || payload.stopId,
          status: item.status,
          latitude: item.latitude,
          longitude: item.longitude,
          recordedAt: item.recordedAt,
        },
        actor
      );
      events.push(res.event);
    }

    // Retrieve final summary from the last record or trip
    const countsRows = await query<{
      total_students: number;
      boarded_count: number;
      absent_count: number;
    }>(
      `SELECT
         (SELECT COUNT(DISTINCT ssa.student_id)::int
          FROM student_stop_assignments ssa
          JOIN pickup_locations pl ON (ssa.pickup_stop_id = pl.id OR ssa.drop_stop_id = pl.id)
          JOIN trips t ON t.route_id = pl.route_id
          WHERE t.id = $1 AND ssa.deleted_at IS NULL AND pl.deleted_at IS NULL) AS total_students,
         (SELECT COUNT(DISTINCT be.student_id)::int
          FROM boarding_events be
          WHERE be.trip_id = $1 AND be.status = 'BOARDED') AS boarded_count,
         (SELECT COUNT(DISTINCT be.student_id)::int
          FROM boarding_events be
          WHERE be.trip_id = $1 AND be.status = 'ABSENT') AS absent_count`,
      [payload.tripId]
    );

    const totalStudents = Number(countsRows[0]?.total_students || 0);
    const boardedCount = Number(countsRows[0]?.boarded_count || 0);
    const absentCount = Number(countsRows[0]?.absent_count || 0);
    const pendingCount = Math.max(0, totalStudents - boardedCount - absentCount);

    return {
      events,
      updatedCount: events.length,
      summary: {
        totalStudents,
        boardedCount,
        absentCount,
        pendingCount,
      },
    };
  }
}
