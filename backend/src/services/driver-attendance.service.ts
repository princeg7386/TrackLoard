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
  RecordDropRequest,
  RecordDropResponse,
  RecordDropBatchRequest,
  RecordDropBatchResponse,
  RecordDropStatus,
  DropEventRecord,
  DropSummaryCounts,
  CorrectAttendanceRequest,
  CorrectAttendanceResponse,
  AttendanceCorrectionRecord,
  StudentJourneyHistoryResponse,
  JourneyTimelineEvent,
  TripAttendanceHistoryResponse,
  TripAttendanceStudentItem,
  DateAttendanceHistoryQuery,
  DateAttendanceHistoryResponse,
} from '@school-bus/shared';
import { query } from '../config/database.js';
import { logger } from './logger.service.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../middlewares/error.middleware.js';
import { ParentNotificationService } from './parent-notification.service.js';

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
      /** Optional search query — matches full_name or admission_number (case-insensitive, partial) */
      search?: string;
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
         AND (
           $4::text IS NULL
           OR LOWER(s.full_name) LIKE LOWER($4::text)
           OR LOWER(s.admission_number) LIKE LOWER($4::text)
         )
       ORDER BY pl_pickup.sequence_order ASC, s.full_name ASC`,
      [
        schoolId,
        targetRouteId,
        targetTripId || null,
        params.search?.trim() ? `%${params.search.trim()}%` : null,
      ]
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

    // Notify parent on WhatsApp when student is marked BOARDED (non-blocking)
    if (payload.status === 'BOARDED') {
      setImmediate(() => {
        ParentNotificationService.notifyStudentBoarded({
          schoolId,
          tripId: payload.tripId,
          studentId: payload.studentId,
          stopId: resolvedStopId,
          recordedAt,
        }).catch((err: unknown) => {
          logger.warn('[DriverAttendanceService] Failed to notify parent of student boarding (suppressed)', {
            tripId: payload.tripId,
            studentId: payload.studentId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      });
    }

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

  /**
   * Micro-phase 18.3: Record Student Drop (Deboarding) Attendance
   * Tasks: Dropped; Timestamp; Location
   * Idempotently records student deboarding/drop event in drop_events PostGIS ledger.
   */
  public static async recordDrop(
    schoolId: string,
    payload: RecordDropRequest,
    actor?: DriverAttendanceActorContext
  ): Promise<RecordDropResponse> {
    if (actor?.schoolId && actor.schoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant driver attendance access attempt');
    }

    // 1. Validate target trip
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

    // Attendance ledger is permanently locked once a trip is completed or cancelled
    if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED') {
      throw new BadRequestError(`Cannot mark attendance: Trip ${payload.tripId} is already ${trip.status} and locked`);
    }

    // Enforce driver-trip assignment validation
    if (actor?.isDriver && actor.userId && trip.driver_id !== actor.userId) {
      throw new ForbiddenError("Driver is not authorized to mark attendance for another driver's trip");
    }

    // 2. Validate student exists in this school
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

    // 3. Resolve drop stop ID
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
        throw new BadRequestError(`Drop stop ${resolvedStopId} is not on route ${trip.route_id}`);
      }
    } else {
      // Lookup assigned drop stop (or pickup stop) for this student on this route
      const assignmentRows = await query<{ stop_id: string }>(
        `SELECT COALESCE(pl_drop.id, pl_pickup.id) AS stop_id
         FROM student_stop_assignments ssa
         LEFT JOIN pickup_locations pl_drop ON ssa.drop_stop_id = pl_drop.id AND pl_drop.route_id = $2 AND pl_drop.deleted_at IS NULL
         LEFT JOIN pickup_locations pl_pickup ON ssa.pickup_stop_id = pl_pickup.id AND pl_pickup.route_id = $2 AND pl_pickup.deleted_at IS NULL
         WHERE ssa.student_id = $1 AND ssa.deleted_at IS NULL
         ORDER BY (CASE WHEN pl_drop.id IS NOT NULL THEN 0 ELSE 1 END), pl_drop.sequence_order DESC NULLS LAST
         LIMIT 1`,
        [payload.studentId, trip.route_id]
      );

      if (assignmentRows.length > 0 && assignmentRows[0]?.stop_id) {
        resolvedStopId = assignmentRows[0].stop_id;
      } else {
        // Fallback to last stop of the route
        const routeStops = await query<{ id: string }>(
          `SELECT id
           FROM pickup_locations
           WHERE route_id = $1 AND school_id = $2 AND deleted_at IS NULL
           ORDER BY sequence_order DESC
           LIMIT 1`,
          [trip.route_id, schoolId]
        );
        if (routeStops.length > 0 && routeStops[0]) {
          resolvedStopId = routeStops[0].id;
        } else {
          throw new BadRequestError(`No valid drop stops found for route ${trip.route_id}`);
        }
      }
    }

    // 4. Upsert into drop_events ledger (Idempotent per trip + student)
    const status = payload.status || 'DEBOARDED';
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
      `INSERT INTO drop_events (
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
        status,
        markedBy,
        lat,
        lng,
        recordedAt,
      ]
    );

    const event = eventRows[0]!;

    logger.info(
      `[DriverAttendance] Recorded drop for student ${student.full_name} (${student.admission_number}): ${status} at stop ${resolvedStopId} (Trip: ${payload.tripId})`
    );

    // Notify parent on WhatsApp when student is marked DEBOARDED (non-blocking)
    if (status === 'DEBOARDED') {
      setImmediate(() => {
        ParentNotificationService.notifyStudentDropped({
          schoolId,
          tripId: payload.tripId,
          studentId: payload.studentId,
          stopId: resolvedStopId,
          recordedAt,
        }).catch((err: unknown) => {
          logger.warn('[DriverAttendanceService] Failed to notify parent of student drop (suppressed)', {
            tripId: payload.tripId,
            studentId: payload.studentId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      });
    }

    // 5. Query updated attendance summary counts for this trip
    const countsRows = await query<{
      total_students: number;
      boarded_count: number;
      dropped_count: number;
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
         (SELECT COUNT(DISTINCT de.student_id)::int
          FROM drop_events de
          WHERE de.trip_id = $1 AND (de.status = 'DEBOARDED' OR de.status = 'HANDOVER_CONFIRMED')) AS dropped_count,
         (SELECT COUNT(DISTINCT be.student_id)::int
          FROM boarding_events be
          WHERE be.trip_id = $1 AND be.status = 'ABSENT') AS absent_count`,
      [payload.tripId, trip.route_id]
    );

    const totalStudents = Number(countsRows[0]?.total_students || 0);
    const boardedCount = Number(countsRows[0]?.boarded_count || 0);
    const droppedCount = Number(countsRows[0]?.dropped_count || 0);
    const absentCount = Number(countsRows[0]?.absent_count || 0);
    const inBusCount = Math.max(0, boardedCount - droppedCount);
    const pendingCount = Math.max(0, totalStudents - boardedCount - absentCount);

    return {
      event: {
        id: event.id,
        tripId: event.trip_id,
        studentId: event.student_id,
        stopId: event.stop_id,
        status: event.status as RecordDropStatus,
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
        droppedCount,
        absentCount,
        pendingCount,
        inBusCount,
      },
    };
  }

  /**
   * Micro-phase 18.3: Batch Record Student Drop Attendance
   * Records multiple students deboarding at a designated drop stop.
   */
  public static async recordDropBatch(
    schoolId: string,
    payload: RecordDropBatchRequest,
    actor?: DriverAttendanceActorContext
  ): Promise<RecordDropBatchResponse> {
    if (actor?.schoolId && actor.schoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant driver attendance access attempt');
    }

    if (!payload.records || payload.records.length === 0) {
      throw new BadRequestError('At least one drop record is required in batch payload');
    }

    const events: DropEventRecord[] = [];

    for (const item of payload.records) {
      const res = await this.recordDrop(
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

    // Retrieve final summary from trip
    const countsRows = await query<{
      total_students: number;
      boarded_count: number;
      dropped_count: number;
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
         (SELECT COUNT(DISTINCT de.student_id)::int
          FROM drop_events de
          WHERE de.trip_id = $1 AND (de.status = 'DEBOARDED' OR de.status = 'HANDOVER_CONFIRMED')) AS dropped_count,
         (SELECT COUNT(DISTINCT be.student_id)::int
          FROM boarding_events be
          WHERE be.trip_id = $1 AND be.status = 'ABSENT') AS absent_count`,
      [payload.tripId]
    );

    const totalStudents = Number(countsRows[0]?.total_students || 0);
    const boardedCount = Number(countsRows[0]?.boarded_count || 0);
    const droppedCount = Number(countsRows[0]?.dropped_count || 0);
    const absentCount = Number(countsRows[0]?.absent_count || 0);
    const inBusCount = Math.max(0, boardedCount - droppedCount);
    const pendingCount = Math.max(0, totalStudents - boardedCount - absentCount);

    return {
      events,
      updatedCount: events.length,
      summary: {
        totalStudents,
        boardedCount,
        droppedCount,
        absentCount,
        pendingCount,
        inBusCount,
      },
    };
  }

  /**
   * Micro-phase 18.4: Correct attendance records with strict safety rules and immutable audit trail.
   */
  public static async correctAttendance(
    schoolId: string,
    payload: CorrectAttendanceRequest,
    actor?: DriverAttendanceActorContext
  ): Promise<CorrectAttendanceResponse> {
    if (actor?.schoolId && actor.schoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant driver attendance access attempt');
    }

    // 1. Fetch trip details & verify state/permissions
    const tripRows = await query<{
      id: string;
      school_id: string;
      status: string;
      driver_id: string;
      bus_id: string;
      route_id: string;
    }>(
      `SELECT id, school_id, status, driver_id, bus_id, route_id
       FROM trips
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [payload.tripId, schoolId]
    );

    if (tripRows.length === 0 || !tripRows[0]) {
      throw new NotFoundError(`Trip ${payload.tripId} not found in this school context`);
    }

    const trip = tripRows[0];
    const isLocked = trip.status === 'COMPLETED' || trip.status === 'CANCELLED';

    // Correction Rule 1: Completed trips can only be corrected by school admins or coordinators
    if (isLocked && actor?.isDriver) {
      throw new ForbiddenError(
        'Attendance locked: completed trips can only be corrected by school administrators or transport coordinators'
      );
    }

    // Active trips: driver can only correct their own assigned trip
    if (!isLocked && actor?.isDriver && actor.userId && trip.driver_id !== actor.userId) {
      throw new ForbiddenError('Driver is not assigned to this trip');
    }

    // 2. Fetch student details
    const studentRows = await query<{
      id: string;
      full_name: string;
      admission_number: string;
    }>(
      `SELECT id, full_name, admission_number
       FROM students
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [payload.studentId, schoolId]
    );

    if (studentRows.length === 0 || !studentRows[0]) {
      throw new NotFoundError(`Student ${payload.studentId} not found in this school context`);
    }
    const student = studentRows[0];

    // 3. Fetch current boarding & drop status for this student on this trip
    const currentRows = await query<{
      boarding_id: string | null;
      boarding_status: string | null;
      boarding_stop_id: string | null;
      drop_id: string | null;
      drop_status: string | null;
      drop_stop_id: string | null;
      pickup_stop_id: string | null;
      assigned_drop_stop_id: string | null;
    }>(
      `SELECT 
         be.id AS boarding_id, be.status AS boarding_status, be.stop_id AS boarding_stop_id,
         de.id AS drop_id, de.status AS drop_status, de.stop_id AS drop_stop_id,
         ssa.pickup_stop_id, ssa.drop_stop_id AS assigned_drop_stop_id
       FROM students s
       LEFT JOIN student_stop_assignments ssa ON ssa.student_id = s.id AND ssa.deleted_at IS NULL
       LEFT JOIN boarding_events be ON be.student_id = s.id AND be.trip_id = $1
       LEFT JOIN drop_events de ON de.student_id = s.id AND de.trip_id = $1
       WHERE s.id = $2
       LIMIT 1`,
      [payload.tripId, payload.studentId]
    );

    const current = currentRows[0];
    let previousStatus: string | null = null;
    let newJourneyStatus = 'PENDING';

    const correctedBy = actor?.userId || '00000000-0000-0000-0000-000000000000';
    const correctedByRole = actor?.userRole || (actor?.isDriver ? 'DRIVER' : 'SCHOOL_ADMIN');

    // 4. Apply correction rules based on eventType
    if (payload.eventType === 'BOARDING') {
      previousStatus = current?.boarding_status || 'PENDING';

      if (payload.newStatus === 'PENDING') {
        // Reset boarding: delete boarding event and any dependent drop event
        await query(
          `DELETE FROM drop_events WHERE trip_id = $1 AND student_id = $2`,
          [payload.tripId, payload.studentId]
        );
        await query(
          `DELETE FROM boarding_events WHERE trip_id = $1 AND student_id = $2`,
          [payload.tripId, payload.studentId]
        );
        newJourneyStatus = 'PENDING';
      } else if (payload.newStatus === 'ABSENT' || payload.newStatus === 'SKIPPED') {
        // If marked absent or skipped, student cannot remain marked as dropped
        await query(
          `DELETE FROM drop_events WHERE trip_id = $1 AND student_id = $2`,
          [payload.tripId, payload.studentId]
        );
        const targetStopId = current?.boarding_stop_id || current?.pickup_stop_id;
        if (!targetStopId) {
          throw new BadRequestError('Student has no assigned pickup stop');
        }
        await query(
          `INSERT INTO boarding_events (
             trip_id, student_id, stop_id, status, marked_by, latitude, longitude, location, recorded_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             CASE WHEN $6::float IS NOT NULL AND $7::float IS NOT NULL
                  THEN ST_SetSRID(ST_MakePoint($7::float, $6::float), 4326)::geography
                  ELSE NULL END,
             NOW()
           )
           ON CONFLICT (trip_id, student_id) DO UPDATE SET
             status = EXCLUDED.status,
             marked_by = EXCLUDED.marked_by,
             latitude = COALESCE(EXCLUDED.latitude, boarding_events.latitude),
             longitude = COALESCE(EXCLUDED.longitude, boarding_events.longitude),
             location = COALESCE(EXCLUDED.location, boarding_events.location),
             recorded_at = EXCLUDED.recorded_at`,
          [
            payload.tripId,
            payload.studentId,
            targetStopId,
            payload.newStatus,
            correctedByRole,
            payload.latitude || null,
            payload.longitude || null,
          ]
        );
        newJourneyStatus = payload.newStatus;
      } else if (payload.newStatus === 'BOARDED') {
        const targetStopId = current?.boarding_stop_id || current?.pickup_stop_id;
        if (!targetStopId) {
          throw new BadRequestError('Student has no assigned pickup stop');
        }
        await query(
          `INSERT INTO boarding_events (
             trip_id, student_id, stop_id, status, marked_by, latitude, longitude, location, recorded_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             CASE WHEN $6::float IS NOT NULL AND $7::float IS NOT NULL
                  THEN ST_SetSRID(ST_MakePoint($7::float, $6::float), 4326)::geography
                  ELSE NULL END,
             NOW()
           )
           ON CONFLICT (trip_id, student_id) DO UPDATE SET
             status = EXCLUDED.status,
             marked_by = EXCLUDED.marked_by,
             latitude = COALESCE(EXCLUDED.latitude, boarding_events.latitude),
             longitude = COALESCE(EXCLUDED.longitude, boarding_events.longitude),
             location = COALESCE(EXCLUDED.location, boarding_events.location),
             recorded_at = EXCLUDED.recorded_at`,
          [
            payload.tripId,
            payload.studentId,
            targetStopId,
            'BOARDED',
            correctedByRole,
            payload.latitude || null,
            payload.longitude || null,
          ]
        );
        newJourneyStatus = current?.drop_status ? current.drop_status : 'IN_TRANSIT';
      }
    } else if (payload.eventType === 'DROP') {
      previousStatus = current?.drop_status || 'PENDING';

      if (payload.newStatus === 'PENDING') {
        // Resetting drop restores student to on-bus / BOARDED state
        await query(
          `DELETE FROM drop_events WHERE trip_id = $1 AND student_id = $2`,
          [payload.tripId, payload.studentId]
        );
        newJourneyStatus = current?.boarding_status === 'BOARDED' ? 'IN_TRANSIT' : 'PENDING';
      } else {
        // Correction Rule 2: Cannot record drop unless student is in BOARDED state
        if (current?.boarding_status !== 'BOARDED') {
          throw new BadRequestError(
            'Cannot record drop status: student must be in BOARDED state before drop can be recorded'
          );
        }

        const targetStopId = current?.drop_stop_id || current?.assigned_drop_stop_id || current?.pickup_stop_id;
        if (!targetStopId) {
          throw new BadRequestError('Student has no assigned drop or pickup stop');
        }

        await query(
          `INSERT INTO drop_events (
             trip_id, student_id, stop_id, status, marked_by, latitude, longitude, location, recorded_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             CASE WHEN $6::float IS NOT NULL AND $7::float IS NOT NULL
                  THEN ST_SetSRID(ST_MakePoint($7::float, $6::float), 4326)::geography
                  ELSE NULL END,
             NOW()
           )
           ON CONFLICT (trip_id, student_id) DO UPDATE SET
             status = EXCLUDED.status,
             marked_by = EXCLUDED.marked_by,
             latitude = COALESCE(EXCLUDED.latitude, drop_events.latitude),
             longitude = COALESCE(EXCLUDED.longitude, drop_events.longitude),
             location = COALESCE(EXCLUDED.location, drop_events.location),
             recorded_at = EXCLUDED.recorded_at`,
          [
            payload.tripId,
            payload.studentId,
            targetStopId,
            payload.newStatus,
            correctedByRole,
            payload.latitude || null,
            payload.longitude || null,
          ]
        );
        newJourneyStatus = payload.newStatus;
      }
    }

    // 5. Insert immutable audit entry in attendance_corrections table
    const auditRows = await query<{
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
    }>(
      `INSERT INTO attendance_corrections (
         school_id, trip_id, student_id, event_type, previous_status, new_status, reason,
         corrected_by, corrected_by_role, latitude, longitude, location, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11,
         CASE WHEN $10::float IS NOT NULL AND $11::float IS NOT NULL
              THEN ST_SetSRID(ST_MakePoint($11::float, $10::float), 4326)::geography
              ELSE NULL END,
         NOW()
       )
       RETURNING id, school_id, trip_id, student_id, event_type, previous_status, new_status,
                 reason, corrected_by, corrected_by_role, latitude, longitude, created_at::text`,
      [
        schoolId,
        payload.tripId,
        payload.studentId,
        payload.eventType,
        previousStatus,
        payload.newStatus,
        payload.reason,
        correctedBy,
        correctedByRole,
        payload.latitude || null,
        payload.longitude || null,
      ]
    );

    const auditRecord = auditRows[0]!;

    // 6. Recalculate summary headcounts
    const countsRows = await query<{
      total_students: number;
      boarded_count: number;
      dropped_count: number;
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
         (SELECT COUNT(DISTINCT de.student_id)::int
          FROM drop_events de
          WHERE de.trip_id = $1 AND (de.status = 'DEBOARDED' OR de.status = 'HANDOVER_CONFIRMED')) AS dropped_count,
         (SELECT COUNT(DISTINCT be.student_id)::int
          FROM boarding_events be
          WHERE be.trip_id = $1 AND be.status = 'ABSENT') AS absent_count`,
      [payload.tripId]
    );

    const totalStudents = Number(countsRows[0]?.total_students || 0);
    const boardedCount = Number(countsRows[0]?.boarded_count || 0);
    const droppedCount = Number(countsRows[0]?.dropped_count || 0);
    const absentCount = Number(countsRows[0]?.absent_count || 0);
    const inBusCount = Math.max(0, boardedCount - droppedCount);
    const pendingCount = Math.max(0, totalStudents - boardedCount - absentCount);

    logger.info(`[DriverAttendance] Corrected attendance for student ${student.id} on trip ${payload.tripId}`, {
      eventType: payload.eventType,
      previousStatus,
      newStatus: payload.newStatus,
      reason: payload.reason,
      correctedBy,
    });

    return {
      success: true,
      correction: {
        id: auditRecord.id,
        schoolId: auditRecord.school_id,
        tripId: auditRecord.trip_id,
        studentId: auditRecord.student_id,
        eventType: auditRecord.event_type,
        previousStatus: auditRecord.previous_status,
        newStatus: auditRecord.new_status,
        reason: auditRecord.reason,
        correctedBy: auditRecord.corrected_by,
        correctedByRole: auditRecord.corrected_by_role,
        latitude: auditRecord.latitude,
        longitude: auditRecord.longitude,
        createdAt: auditRecord.created_at,
      },
      student: {
        id: student.id,
        fullName: student.full_name,
        admissionNumber: student.admission_number,
      },
      newJourneyStatus,
      summary: {
        totalStudents,
        boardedCount,
        droppedCount,
        absentCount,
        pendingCount,
        inBusCount,
      },
    };
  }

  /**
   * Micro-phase 18.4: Retrieve student journey timeline across stops, boarding, drop, and corrections.
   */
  public static async getStudentJourneyHistory(
    schoolId: string,
    studentId: string,
    tripId?: string,
    actor?: DriverAttendanceActorContext
  ): Promise<StudentJourneyHistoryResponse> {
    if (actor?.schoolId && actor.schoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant student journey access attempt');
    }

    // 1. Fetch student
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
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [studentId, schoolId]
    );

    if (studentRows.length === 0 || !studentRows[0]) {
      throw new NotFoundError(`Student ${studentId} not found in this school context`);
    }
    const student = studentRows[0];

    // 2. Resolve target trip
    let targetTripId = tripId;
    if (!targetTripId) {
      // Find the most recent active or completed trip for this student's assigned route
      const recentTripRows = await query<{ id: string }>(
        `SELECT t.id
         FROM trips t
         JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
         JOIN pickup_locations pl ON pl.route_id = r.id AND pl.deleted_at IS NULL
         JOIN student_stop_assignments ssa ON (ssa.pickup_stop_id = pl.id OR ssa.drop_stop_id = pl.id) AND ssa.deleted_at IS NULL
         WHERE ssa.student_id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
         ORDER BY (t.status = 'IN_TRANSIT' OR t.status = 'SCHEDULED' OR t.status = 'DELAYED') DESC,
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

    const tripRows = await query<{
      id: string;
      bus_number: string;
      registration_number: string;
      route_name: string;
      route_code: string | null;
      scheduled_date: string;
      status: string;
      driver_name: string | null;
    }>(
      `SELECT t.id, b.bus_number, b.registration_number, r.name AS route_name, r.code AS route_code,
              TO_CHAR(t.scheduled_date, 'YYYY-MM-DD') AS scheduled_date, t.status,
              u.full_name AS driver_name
       FROM trips t
       JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
       JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
       LEFT JOIN drivers d ON t.driver_id = d.id AND d.deleted_at IS NULL
       LEFT JOIN users u ON d.user_id = u.id
       WHERE t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
       LIMIT 1`,
      [targetTripId, schoolId]
    );

    if (tripRows.length === 0 || !tripRows[0]) {
      throw new NotFoundError(`Trip ${targetTripId} not found in this school context`);
    }
    const trip = tripRows[0];

    // 3. Fetch boarding & drop records for this student on this trip
    const eventRows = await query<{
      be_id: string | null;
      be_status: string | null;
      be_recorded_at: string | null;
      be_marked_by: string | null;
      be_lat: number | null;
      be_lng: number | null;
      pickup_stop_name: string | null;
      pickup_sequence: number | null;
      de_id: string | null;
      de_status: string | null;
      de_recorded_at: string | null;
      de_marked_by: string | null;
      de_lat: number | null;
      de_lng: number | null;
      drop_stop_name: string | null;
      drop_sequence: number | null;
    }>(
      `SELECT 
         be.id AS be_id, be.status AS be_status, be.recorded_at::text AS be_recorded_at,
         be.marked_by AS be_marked_by, be.latitude AS be_lat, be.longitude AS be_lng,
         pl_pickup.stop_name AS pickup_stop_name, pl_pickup.sequence_order AS pickup_sequence,
         de.id AS de_id, de.status AS de_status, de.recorded_at::text AS de_recorded_at,
         de.marked_by AS de_marked_by, de.latitude AS de_lat, de.longitude AS de_lng,
         pl_drop.stop_name AS drop_stop_name, pl_drop.sequence_order AS drop_sequence
       FROM students s
       LEFT JOIN student_stop_assignments ssa ON ssa.student_id = s.id AND ssa.deleted_at IS NULL
       LEFT JOIN pickup_locations pl_pickup ON ssa.pickup_stop_id = pl_pickup.id
       LEFT JOIN pickup_locations pl_drop ON ssa.drop_stop_id = pl_drop.id
       LEFT JOIN boarding_events be ON be.student_id = s.id AND be.trip_id = $1
       LEFT JOIN drop_events de ON de.student_id = s.id AND de.trip_id = $1
       WHERE s.id = $2
       LIMIT 1`,
      [targetTripId, studentId]
    );

    const ev = eventRows[0];

    // 4. Fetch corrections audit trail for this student on this trip
    const correctionRows = await query<{
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
    }>(
      `SELECT id, school_id, trip_id, student_id, event_type, previous_status, new_status,
              reason, corrected_by, corrected_by_role, latitude, longitude, created_at::text
       FROM attendance_corrections
       WHERE school_id = $1 AND trip_id = $2 AND student_id = $3
       ORDER BY created_at ASC`,
      [schoolId, targetTripId, studentId]
    );

    const corrections: AttendanceCorrectionRecord[] = correctionRows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      tripId: r.trip_id,
      studentId: r.student_id,
      eventType: r.event_type,
      previousStatus: r.previous_status,
      newStatus: r.new_status,
      reason: r.reason,
      correctedBy: r.corrected_by,
      correctedByRole: r.corrected_by_role,
      latitude: r.latitude,
      longitude: r.longitude,
      createdAt: r.created_at,
    }));

    // 5. Assemble chronological timeline
    const timeline: JourneyTimelineEvent[] = [];

    // Initial Scheduled Event
    timeline.push({
      id: `sched-${trip.id}`,
      type: 'SCHEDULED',
      status: 'SCHEDULED',
      timestamp: trip.scheduled_date,
      stopName: ev?.pickup_stop_name || 'Assigned Pickup Stop',
      stopSequence: ev?.pickup_sequence || 1,
      markedBy: 'SYSTEM',
    });

    if (ev?.be_id && ev.be_recorded_at) {
      timeline.push({
        id: ev.be_id,
        type: 'BOARDING',
        status: ev.be_status || 'BOARDED',
        timestamp: ev.be_recorded_at,
        stopName: ev.pickup_stop_name || 'Pickup Stop',
        stopSequence: ev.pickup_sequence,
        markedBy: ev.be_marked_by,
        latitude: ev.be_lat,
        longitude: ev.be_lng,
      });
    }

    if (ev?.de_id && ev.de_recorded_at) {
      timeline.push({
        id: ev.de_id,
        type: 'DROP',
        status: ev.de_status || 'DEBOARDED',
        timestamp: ev.de_recorded_at,
        stopName: ev.drop_stop_name || 'Drop Stop',
        stopSequence: ev.drop_sequence,
        markedBy: ev.de_marked_by,
        latitude: ev.de_lat,
        longitude: ev.de_lng,
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
    timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Current journey status
    let currentStatus = 'PENDING';
    if (ev?.de_status) {
      currentStatus = ev.de_status;
    } else if (ev?.be_status === 'BOARDED') {
      currentStatus = 'IN_TRANSIT';
    } else if (ev?.be_status) {
      currentStatus = ev.be_status;
    }

    return {
      student: {
        id: student.id,
        fullName: student.full_name,
        admissionNumber: student.admission_number,
        classGrade: student.grade,
        section: student.section,
        emergencyPhone: student.emergency_phone,
      },
      trip: {
        id: trip.id,
        busNumber: trip.bus_number,
        registrationNumber: trip.registration_number,
        routeName: trip.route_name,
        routeCode: trip.route_code,
        scheduledDate: trip.scheduled_date,
        status: trip.status,
        driverName: trip.driver_name,
      },
      currentStatus,
      timeline,
      corrections,
    };
  }

  /**
   * Micro-phase 18.4: Retrieve complete attendance history for a single trip.
   */
  public static async getTripAttendanceHistory(
    schoolId: string,
    tripId: string,
    actor?: DriverAttendanceActorContext
  ): Promise<TripAttendanceHistoryResponse> {
    if (actor?.schoolId && actor.schoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant trip attendance history access attempt');
    }

    // 1. Fetch trip
    const tripRows = await query<{
      id: string;
      school_id: string;
      bus_id: string;
      bus_number: string;
      registration_number: string;
      route_id: string;
      route_name: string;
      route_code: string | null;
      driver_id: string;
      driver_name: string | null;
      scheduled_date: string;
      status: string;
      started_at: string | null;
      completed_at: string | null;
    }>(
      `SELECT t.id, t.school_id, t.bus_id, b.bus_number, b.registration_number,
              t.route_id, r.name AS route_name, r.code AS route_code,
              t.driver_id, u.full_name AS driver_name,
              TO_CHAR(t.scheduled_date, 'YYYY-MM-DD') AS scheduled_date,
              t.status, t.started_at::text, t.completed_at::text
       FROM trips t
       JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
       JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
       LEFT JOIN drivers d ON t.driver_id = d.id AND d.deleted_at IS NULL
       LEFT JOIN users u ON d.user_id = u.id
       WHERE t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
       LIMIT 1`,
      [tripId, schoolId]
    );

    if (tripRows.length === 0 || !tripRows[0]) {
      throw new NotFoundError(`Trip ${tripId} not found in this school context`);
    }
    const trip = tripRows[0];

    if (actor?.isDriver && actor.userId && trip.driver_id !== actor.userId) {
      throw new ForbiddenError('Driver is not assigned to this trip');
    }

    // 2. Fetch all students assigned to this trip's route with attendance & corrections count
    const studentRows = await query<{
      student_id: string;
      admission_number: string;
      full_name: string;
      grade: string | null;
      section: string | null;
      emergency_phone: string | null;
      pickup_stop_id: string;
      pickup_stop_name: string;
      pickup_sequence: number;
      drop_stop_id: string | null;
      drop_stop_name: string | null;
      drop_sequence: number | null;
      boarding_status: string | null;
      boarded_at: string | null;
      boarding_marked_by: string | null;
      boarding_lat: number | null;
      boarding_lng: number | null;
      drop_status: string | null;
      dropped_at: string | null;
      drop_marked_by: string | null;
      drop_lat: number | null;
      drop_lng: number | null;
      corrections_count: number;
    }>(
      `SELECT 
         s.id AS student_id,
         s.admission_number,
         s.full_name,
         s.grade,
         s.section,
         s.emergency_phone,
         pl_pickup.id AS pickup_stop_id,
         pl_pickup.stop_name AS pickup_stop_name,
         pl_pickup.sequence_order AS pickup_sequence,
         pl_drop.id AS drop_stop_id,
         pl_drop.stop_name AS drop_stop_name,
         pl_drop.sequence_order AS drop_sequence,
         be.status AS boarding_status,
         be.recorded_at::text AS boarded_at,
         be.marked_by AS boarding_marked_by,
         be.latitude AS boarding_lat,
         be.longitude AS boarding_lng,
         de.status AS drop_status,
         de.recorded_at::text AS dropped_at,
         de.marked_by AS drop_marked_by,
         de.latitude AS drop_lat,
         de.longitude AS drop_lng,
         (SELECT COUNT(*)::int FROM attendance_corrections ac
          WHERE ac.trip_id = $1 AND ac.student_id = s.id) AS corrections_count
       FROM students s
       JOIN student_stop_assignments ssa ON ssa.student_id = s.id AND ssa.deleted_at IS NULL
       JOIN pickup_locations pl_pickup ON ssa.pickup_stop_id = pl_pickup.id AND pl_pickup.deleted_at IS NULL
       LEFT JOIN pickup_locations pl_drop ON ssa.drop_stop_id = pl_drop.id AND pl_drop.deleted_at IS NULL
       LEFT JOIN boarding_events be ON be.student_id = s.id AND be.trip_id = $1
       LEFT JOIN drop_events de ON de.student_id = s.id AND de.trip_id = $1
       WHERE s.school_id = $2
         AND (pl_pickup.route_id = $3 OR pl_drop.route_id = $3)
         AND s.deleted_at IS NULL
       ORDER BY pl_pickup.sequence_order ASC, s.full_name ASC`,
      [tripId, schoolId, trip.route_id]
    );

    let boardedCount = 0;
    let droppedCount = 0;
    let absentCount = 0;
    let pendingCount = 0;

    const students: TripAttendanceStudentItem[] = studentRows.map((r) => {
      let journeyStatus = 'PENDING';

      if (r.drop_status) {
        journeyStatus = r.drop_status;
        droppedCount++;
      } else if (r.boarding_status === 'BOARDED') {
        journeyStatus = 'IN_TRANSIT';
        boardedCount++;
      } else if (r.boarding_status === 'ABSENT') {
        journeyStatus = 'ABSENT';
        absentCount++;
      } else if (r.boarding_status === 'SKIPPED') {
        journeyStatus = 'SKIPPED';
      } else {
        pendingCount++;
      }

      return {
        studentId: r.student_id,
        fullName: r.full_name,
        admissionNumber: r.admission_number,
        classGrade: r.grade,
        section: r.section,
        emergencyPhone: r.emergency_phone,
        pickupStop: {
          id: r.pickup_stop_id,
          name: r.pickup_stop_name,
          sequenceOrder: Number(r.pickup_sequence),
        },
        dropStop: r.drop_stop_id
          ? {
              id: r.drop_stop_id,
              name: r.drop_stop_name || '',
              sequenceOrder: Number(r.drop_sequence || 0),
            }
          : null,
        boarding: r.boarding_status && r.boarded_at
          ? {
              status: r.boarding_status,
              recordedAt: r.boarded_at,
              markedBy: r.boarding_marked_by || 'DRIVER',
              latitude: r.boarding_lat,
              longitude: r.boarding_lng,
            }
          : null,
        drop: r.drop_status && r.dropped_at
          ? {
              status: r.drop_status,
              recordedAt: r.dropped_at,
              markedBy: r.drop_marked_by || 'DRIVER',
              latitude: r.drop_lat,
              longitude: r.drop_lng,
            }
          : null,
        journeyStatus,
        correctionsCount: Number(r.corrections_count || 0),
      };
    });

    const totalStudents = students.length;
    const inBusCount = Math.max(0, boardedCount - droppedCount);

    return {
      trip: {
        id: trip.id,
        schoolId: trip.school_id,
        busId: trip.bus_id,
        busNumber: trip.bus_number,
        registrationNumber: trip.registration_number,
        routeId: trip.route_id,
        routeName: trip.route_name,
        routeCode: trip.route_code,
        driverId: trip.driver_id,
        driverName: trip.driver_name,
        scheduledDate: trip.scheduled_date,
        status: trip.status,
        startedAt: trip.started_at,
        completedAt: trip.completed_at,
      },
      summary: {
        totalStudents,
        boardedCount,
        droppedCount,
        absentCount,
        pendingCount,
        inBusCount,
      },
      students,
    };
  }

  /**
   * Micro-phase 18.4: Retrieve aggregate attendance history for all trips on a specified date.
   */
  public static async getDateAttendanceHistory(
    schoolId: string,
    queryFilters: DateAttendanceHistoryQuery,
    actor?: DriverAttendanceActorContext
  ): Promise<DateAttendanceHistoryResponse> {
    if (actor?.schoolId && actor.schoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant date attendance history access attempt');
    }

    let filterSql = 'WHERE t.school_id = $1 AND t.scheduled_date = $2 AND t.deleted_at IS NULL';
    const params: any[] = [schoolId, queryFilters.date];
    let pIdx = 3;

    if (queryFilters.busId) {
      filterSql += ` AND t.bus_id = $${pIdx++}`;
      params.push(queryFilters.busId);
    }
    if (queryFilters.routeId) {
      filterSql += ` AND t.route_id = $${pIdx++}`;
      params.push(queryFilters.routeId);
    }
    if (queryFilters.driverId) {
      filterSql += ` AND t.driver_id = $${pIdx++}`;
      params.push(queryFilters.driverId);
    }
    if (actor?.isDriver && actor.userId) {
      filterSql += ` AND t.driver_id = $${pIdx++}`;
      params.push(actor.userId);
    }

    const tripRows = await query<{ id: string }>(
      `SELECT t.id FROM trips t ${filterSql} ORDER BY t.created_at ASC`,
      params
    );

    const trips: TripAttendanceHistoryResponse[] = [];
    let totalStudents = 0;
    let boardedCount = 0;
    let droppedCount = 0;
    let absentCount = 0;
    let pendingCount = 0;
    let inBusCount = 0;

    for (const row of tripRows) {
      const tripHist = await this.getTripAttendanceHistory(schoolId, row.id, actor);
      trips.push(tripHist);
      totalStudents += tripHist.summary.totalStudents;
      boardedCount += tripHist.summary.boardedCount;
      droppedCount += tripHist.summary.droppedCount;
      absentCount += tripHist.summary.absentCount;
      pendingCount += tripHist.summary.pendingCount;
      inBusCount += tripHist.summary.inBusCount;
    }

    return {
      date: queryFilters.date,
      tripsCount: trips.length,
      overallSummary: {
        totalStudents,
        boardedCount,
        droppedCount,
        absentCount,
        pendingCount,
        inBusCount,
      },
      trips,
    };
  }
}

