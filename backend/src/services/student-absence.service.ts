/**
 * Student Absence Service (Phase 33.1)
 *
 * Micro-phase 33.1: Student Not Going Today — Parent Flow
 * Manages parent-reported student absences, date selection, validation,
 * idempotent conflict resolution, and confirmation dispatches.
 */

import { query } from '../config/database.js';
import { logger } from './logger.service.js';
import { MessagingService } from './messaging/messaging.service.js';
import { BadRequestError, NotFoundError } from '../middlewares/error.middleware.js';
import {
  ParentAbsenceDetails,
  SchoolAbsenceAuditResponse,
  SchoolAbsenceItem,
} from '@school-bus/shared';

export interface RecordAbsenceParams {
  schoolId: string;
  studentId: string;
  absenceDate: string; // YYYY-MM-DD
  tripType?: 'MORNING' | 'AFTERNOON' | 'FULL_DAY';
  reportedVia?: 'WHATSAPP' | 'PARENT_WEB' | 'ADMIN_PHONE';
  reportedByPhone: string;
  reason?: string;
}

export class StudentAbsenceService {
  /**
   * Record a student absence for today or a future date.
   * Upserts idempotently if an absence is already recorded for this student, date and trip type.
   */
  public static async recordAbsence(params: RecordAbsenceParams): Promise<ParentAbsenceDetails> {
    const {
      schoolId,
      studentId,
      absenceDate,
      tripType = 'FULL_DAY',
      reportedVia = 'PARENT_WEB',
      reportedByPhone,
      reason,
    } = params;

    // 1. Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(absenceDate)) {
      throw new BadRequestError('Invalid date format. Expected YYYY-MM-DD');
    }

    // 2. Reject past dates
    const today = new Date().toISOString().slice(0, 10);
    if (absenceDate < today) {
      throw new BadRequestError('Absence date cannot be in the past');
    }

    // 3. Verify student exists within this school tenant
    const studentRes = await query<{
      id: string;
      full_name: string;
      admission_number: string | null;
      class_grade: string | null;
      section: string | null;
    }>(
      `SELECT id, full_name, admission_number, class_grade, section
       FROM students
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [studentId, schoolId]
    );

    if (studentRes.length === 0 || !studentRes[0]) {
      throw new NotFoundError(`Student ${studentId} not found in this school`);
    }

    const student = studentRes[0];

    // 4. Idempotent upsert into absence_records
    const insertRes = await query<{
      id: string;
      school_id: string;
      student_id: string;
      absence_date: string;
      trip_type: 'MORNING' | 'AFTERNOON' | 'FULL_DAY';
      reported_via: string;
      reported_by_phone: string;
      reason: string | null;
      driver_notified: boolean;
      created_at: string;
    }>(
      `INSERT INTO absence_records (
         school_id, student_id, absence_date, trip_type, reported_via, reported_by_phone, reason, driver_notified
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, false
       )
       ON CONFLICT (student_id, absence_date, trip_type)
       DO UPDATE SET
         reported_via = EXCLUDED.reported_via,
         reported_by_phone = EXCLUDED.reported_by_phone,
         reason = COALESCE(EXCLUDED.reason, absence_records.reason),
         driver_notified = false
       RETURNING id, school_id, student_id, absence_date::text, trip_type, reported_via, reported_by_phone, reason, driver_notified, created_at::text`,
      [schoolId, studentId, absenceDate, tripType, reportedVia, reportedByPhone, reason?.trim() || null]
    );

    const record = insertRes[0];
    if (!record) {
      throw new BadRequestError('Failed to record student absence');
    }

    // 5. Outbound WhatsApp Confirmation Dispatch (safely caught so network issues don't fail the request)
    const scopeLabel =
      tripType === 'MORNING'
        ? 'Morning Pickup Only'
        : tripType === 'AFTERNOON'
          ? 'Afternoon Drop Only'
          : 'Full Day (Pickup & Drop)';

    const classLabel = student.class_grade
      ? `Class ${student.class_grade}${student.section ? `-${student.section}` : ''}`
      : '';

    try {
      const confirmText =
        `*School Bus Transport Notice*\n\n` +
        `Absence confirmed for *${student.full_name}*${classLabel ? ` (${classLabel})` : ''}.\n` +
        `• *Date:* ${absenceDate}\n` +
        `• *Scope:* ${scopeLabel}\n` +
        (reason ? `• *Reason:* ${reason}\n` : '') +
        `\nThe bus driver and school transport desk have been updated. The bus will not wait at your stop.\n\n` +
        `_Reply CANCEL ABSENCE if this was recorded by mistake._`;

      await MessagingService.sendMessage({
        recipientPhone: reportedByPhone,
        directText: confirmText,
        recipientRole: 'PARENT',
        schoolId,
      });
    } catch (err: any) {
      logger.warn(`Could not send WhatsApp absence confirmation to parent: ${err.message}`);
    }

    // 6. System Response: Synchronize with active trips, notify assigned driver, and log audit trail
    try {
      const assignmentRows = await query<{
        stop_id: string;
        stop_name: string;
        route_id: string;
      }>(
        `SELECT pl.id AS stop_id, pl.stop_name, pl.route_id
         FROM student_stop_assignments ssa
         JOIN pickup_locations pl ON pl.id = ssa.pickup_stop_id
         WHERE ssa.student_id = $1 AND ssa.school_id = $2 AND ssa.deleted_at IS NULL
         LIMIT 1`,
        [studentId, schoolId]
      );

      if (assignmentRows.length > 0 && assignmentRows[0]) {
        const assignedStopName = assignmentRows[0].stop_name;
        const assignedRouteId = assignmentRows[0].route_id;

        // Find active or scheduled trip for today on this route
        const tripRows = await query<{
          trip_id: string;
          driver_id: string | null;
          driver_phone: string | null;
          driver_name: string | null;
        }>(
          `SELECT t.id AS trip_id, t.driver_id, d.phone_number AS driver_phone, d.full_name AS driver_name
           FROM trips t
           LEFT JOIN drivers d ON d.id = t.driver_id
           WHERE t.route_id = $1 AND t.school_id = $2
             AND t.status IN ('IN_TRANSIT', 'DELAYED', 'SCHEDULED')
             AND t.deleted_at IS NULL
           ORDER BY CASE WHEN t.status = 'IN_TRANSIT' THEN 1 WHEN t.status = 'DELAYED' THEN 2 ELSE 3 END
           LIMIT 1`,
          [assignedRouteId, schoolId]
        );

        let driverPhone: string | null = null;
        let driverTripId: string | null = null;

        if (tripRows.length > 0 && tripRows[0]) {
          driverTripId = tripRows[0].trip_id;
          driverPhone = tripRows[0].driver_phone;

          // 6a. Synchronize boarding_events with ABSENT state
          await query(
            `INSERT INTO boarding_events (
               school_id, trip_id, student_id, stop_id, status, scan_method, marked_by
             ) VALUES (
               $1, $2, $3, $4, 'ABSENT', 'PARENT_ABSENCE', 'PARENT'
             )
             ON CONFLICT (trip_id, student_id)
             DO UPDATE SET
               status = 'ABSENT',
               scan_method = 'PARENT_ABSENCE',
               marked_by = 'PARENT'`,
            [schoolId, driverTripId, studentId, assignmentRows[0].stop_id]
          );
        }

        // If driver phone not found on active trip, resolve default driver for route
        if (!driverPhone) {
          const defaultDriverRows = await query<{
            driver_phone: string | null;
            driver_name: string | null;
          }>(
            `SELECT d.phone_number AS driver_phone, d.full_name AS driver_name
             FROM routes r
             JOIN drivers d ON d.id = r.default_driver_id
             WHERE r.id = $1 AND r.school_id = $2 AND d.deleted_at IS NULL
             LIMIT 1`,
            [assignedRouteId, schoolId]
          );
          if (defaultDriverRows.length > 0 && defaultDriverRows[0]) {
            driverPhone = defaultDriverRows[0].driver_phone;
          }
        }

        // 6b. Notify assigned driver via WhatsApp
        if (driverPhone) {
          const driverText =
            `🚏 *Bus Transport Alert — Student Absent*\n\n` +
            `Student *${student.full_name}*${classLabel ? ` (${classLabel})` : ''} will *NOT* be taking the bus on *${absenceDate}*.\n` +
            `• *Stop:* ${assignedStopName}\n` +
            `• *Scope:* ${scopeLabel}\n` +
            (reason ? `• *Reason:* ${reason}\n` : '') +
            `\nPlease do not wait for this student at the pickup stop.`;

          await MessagingService.sendMessage({
            recipientPhone: driverPhone,
            directText: driverText,
            recipientRole: 'DRIVER',
            schoolId,
          });

          await query(
            `UPDATE absence_records SET driver_notified = true WHERE id = $1`,
            [record.id]
          );
          record.driver_notified = true;
        }
      }

      // 6c. Operational audit log for school desk
      const auditRole = reportedVia === 'ADMIN_PHONE' ? 'SCHOOL_ADMIN' : 'PARENT';
      await query(
        `INSERT INTO audit_logs (
           school_id, user_role, action, entity_type, entity_id, diff_json
         ) VALUES (
           $1, $2, 'STUDENT_ABSENCE_RECORDED', 'STUDENT', $3, $4::jsonb
         )`,
        [
          schoolId,
          auditRole,
          studentId,
          JSON.stringify({
            absenceDate,
            tripType,
            reason: reason || null,
            reportedVia,
            reportedByPhone,
            driverNotified: record.driver_notified,
            driverNotifiedAt: record.driver_notified ? new Date().toISOString() : null,
          }),
        ]
      );
    } catch (err: any) {
      logger.warn(`Could not complete driver/school absence synchronization: ${err.message}`);
    }

    return {
      id: record.id,
      schoolId: record.school_id,
      studentId: record.student_id,
      studentName: student.full_name,
      admissionNumber: student.admission_number,
      classGrade: student.class_grade,
      section: student.section,
      absenceDate: record.absence_date,
      tripType: record.trip_type,
      reportedVia: record.reported_via,
      reportedByPhone: record.reported_by_phone,
      reason: record.reason,
      driverNotified: record.driver_notified,
      createdAt: record.created_at,
    };
  }

  /**
   * Retrieve active or upcoming absences for a student
   */
  public static async getStudentAbsences(
    schoolId: string,
    studentId: string,
    options?: { fromDate?: string; limit?: number }
  ): Promise<ParentAbsenceDetails[]> {
    const today = new Date().toISOString().slice(0, 10);
    const fromDate = options?.fromDate || today;
    const limit = options?.limit || 20;

    interface AbsenceRow {
      id: string;
      school_id: string;
      student_id: string;
      student_name: string;
      admission_number: string | null;
      class_grade: string | null;
      section: string | null;
      absence_date: string;
      trip_type: 'MORNING' | 'AFTERNOON' | 'FULL_DAY';
      reported_via: string;
      reported_by_phone: string;
      reason: string | null;
      driver_notified: boolean;
      created_at: string;
    }

    const rows = await query<AbsenceRow>(
      `SELECT
         ar.id,
         ar.school_id,
         ar.student_id,
         s.full_name AS student_name,
         s.admission_number,
         s.class_grade,
         s.section,
         ar.absence_date::text,
         ar.trip_type,
         ar.reported_via,
         ar.reported_by_phone,
         ar.reason,
         ar.driver_notified,
         ar.created_at::text
       FROM absence_records ar
       JOIN students s ON s.id = ar.student_id
       WHERE ar.school_id = $1
         AND ar.student_id = $2
         AND ar.absence_date >= $3::date
       ORDER BY ar.absence_date ASC, ar.created_at DESC
       LIMIT $4`,
      [schoolId, studentId, fromDate, limit]
    );

    return rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      studentId: r.student_id,
      studentName: r.student_name,
      admissionNumber: r.admission_number,
      classGrade: r.class_grade,
      section: r.section,
      absenceDate: r.absence_date,
      tripType: r.trip_type,
      reportedVia: r.reported_via,
      reportedByPhone: r.reported_by_phone,
      reason: r.reason,
      driverNotified: r.driver_notified,
      createdAt: r.created_at,
    }));
  }

  /**
   * Withdraw / cancel an absence record
   */
  public static async cancelAbsence(
    schoolId: string,
    studentId: string,
    absenceId: string
  ): Promise<{ cancelled: boolean; message: string }> {
    const deleteRes = await query<{ id: string; absence_date: string; trip_type: string }>(
      `DELETE FROM absence_records
       WHERE id = $1 AND student_id = $2 AND school_id = $3
       RETURNING id, absence_date::text, trip_type`,
      [absenceId, studentId, schoolId]
    );

    if (deleteRes.length === 0 || !deleteRes[0]) {
      throw new NotFoundError(`Absence record ${absenceId} not found or unauthorized`);
    }

    // Clean up synced boarding_events and record operational withdrawal audit log
    try {
      await query(
        `DELETE FROM boarding_events
         WHERE student_id = $1 AND school_id = $2 AND scan_method = 'PARENT_ABSENCE'`,
        [studentId, schoolId]
      );

      await query(
        `INSERT INTO audit_logs (
           school_id, user_role, action, entity_type, entity_id, diff_json
         ) VALUES (
           $1, 'PARENT', 'STUDENT_ABSENCE_WITHDRAWN', 'STUDENT', $2, $3::jsonb
         )`,
        [
          schoolId,
          studentId,
          JSON.stringify({
            absenceId,
            absenceDate: deleteRes[0].absence_date,
            tripType: deleteRes[0].trip_type,
          }),
        ]
      );
    } catch (err: any) {
      logger.warn(`Could not complete absence withdrawal cleanup: ${err.message}`);
    }

    return {
      cancelled: true,
      message: `Absence record for ${deleteRes[0].absence_date} (${deleteRes[0].trip_type}) has been withdrawn`,
    };
  }

  /**
   * Log an immutable audit entry when a boarding or arrival alert is suppressed due to verified student absence.
   */
  public static async logSuppressedBoardingAlert(params: {
    schoolId: string;
    tripId: string;
    studentId: string;
    eventType: string;
    reason?: string | null;
  }): Promise<void> {
    try {
      await query(
        `INSERT INTO audit_logs (
           school_id, user_role, action, entity_type, entity_id, diff_json
         ) VALUES (
           $1, 'SYSTEM', 'BOARDING_SUPPRESSED_ABSENCE', 'STUDENT', $2, $3::jsonb
         )`,
        [
          params.schoolId,
          params.studentId,
          JSON.stringify({
            tripId: params.tripId,
            eventType: params.eventType,
            reason: params.reason || 'Student marked absent',
            suppressedAt: new Date().toISOString(),
          }),
        ]
      );
    } catch (err: any) {
      logger.warn(`Could not log BOARDING_SUPPRESSED_ABSENCE audit entry: ${err.message}`);
    }
  }

  /**
   * Retrieve the school-wide absence audit ledger and operational impact stats.
   * Tenant-isolated to schoolId.
   */
  public static async getSchoolAbsenceAuditLedger(
    schoolId: string,
    options?: {
      date?: string;
      studentId?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<SchoolAbsenceAuditResponse> {
    const filterDate = options?.date;
    const studentId = options?.studentId;
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
    const offset = Math.max(options?.offset ?? 0, 0);

    const conditions: string[] = ['ar.school_id = $1'];
    const params: any[] = [schoolId];

    if (filterDate) {
      params.push(filterDate);
      conditions.push(`ar.absence_date = $${params.length}::date`);
    }

    if (studentId) {
      params.push(studentId);
      conditions.push(`ar.student_id = $${params.length}`);
    }

    const whereClause = conditions.join(' AND ');

    // 1. Fetch absence items with joined student info and suppressed alerts count
    const rows = await query<{
      id: string;
      school_id: string;
      student_id: string;
      student_name: string;
      admission_number: string | null;
      class_grade: string | null;
      section: string | null;
      absence_date: string;
      trip_type: 'MORNING' | 'AFTERNOON' | 'FULL_DAY';
      reported_via: string;
      reported_by_phone: string;
      reason: string | null;
      driver_notified: boolean;
      created_at: string;
      suppressed_alerts_count: string;
    }>(
      `SELECT
         ar.id,
         ar.school_id,
         ar.student_id,
         s.full_name AS student_name,
         s.admission_number,
         s.class_grade,
         s.section,
         ar.absence_date::text,
         ar.trip_type,
         ar.reported_via,
         ar.reported_by_phone,
         ar.reason,
         ar.driver_notified,
         ar.created_at::text,
         COALESCE(al_counts.cnt, 0)::text AS suppressed_alerts_count
       FROM absence_records ar
       JOIN students s ON s.id = ar.student_id AND s.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS cnt
         FROM audit_logs al
         WHERE al.school_id = ar.school_id
           AND al.entity_id = ar.student_id
           AND al.action = 'BOARDING_SUPPRESSED_ABSENCE'
           AND al.created_at::date = ar.absence_date
       ) al_counts ON true
       WHERE ${whereClause}
       ORDER BY ar.absence_date DESC, ar.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    // 2. Total count matching filter
    const countRes = await query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM absence_records ar
       WHERE ${whereClause}`,
      params
    );
    const totalCount = parseInt(countRes[0]?.total || '0', 10);

    // 3. School summary: Total absent today
    const todayRes = await query<{ cnt: string }>(
      `SELECT COUNT(DISTINCT student_id)::text AS cnt
       FROM absence_records
       WHERE school_id = $1 AND absence_date = CURRENT_DATE`,
      [schoolId]
    );
    const totalAbsentToday = parseInt(todayRes[0]?.cnt || '0', 10);

    // 4. School summary: Total suppressed boarding alerts today
    const suppressedRes = await query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
       FROM audit_logs
       WHERE school_id = $1
         AND action = 'BOARDING_SUPPRESSED_ABSENCE'
         AND created_at::date = CURRENT_DATE`,
      [schoolId]
    );
    const totalSuppressedAlertsToday = parseInt(suppressedRes[0]?.cnt || '0', 10);

    return {
      absences: rows.map((r) => ({
        id: r.id,
        schoolId: r.school_id,
        studentId: r.student_id,
        studentName: r.student_name,
        admissionNumber: r.admission_number,
        classGrade: r.class_grade,
        section: r.section,
        absenceDate: r.absence_date,
        tripType: r.trip_type,
        reportedVia: r.reported_via,
        reportedByPhone: r.reported_by_phone,
        reason: r.reason,
        driverNotified: r.driver_notified,
        createdAt: r.created_at,
        suppressedAlertsCount: parseInt(r.suppressed_alerts_count || '0', 10),
      })),
      totalCount,
      totalAbsentToday,
      totalSuppressedAlertsToday,
    };
  }
}
