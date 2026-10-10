import { query } from '../config/database.js';
import {
  CreateStudentRequest,
  UpdateStudentRequest,
  UpsertParentGuardianRequest,
  AssignStudentTransportPayload,
  ParentGuardianRecord,
  RouteWithStopsOption,
  StudentWithDetails,
  StudentTransportHistoryResponse,
  StudentTransportHistoryItem,
  normalizeIndianPhoneNumber,
} from '@school-bus/shared';
import {
  ConflictError,
  BadRequestError,
  NotFoundError,
} from '../middlewares/error.middleware.js';
import { DbService } from './db.service.js';
import { AuditService } from './audit.service.js';
import { logger } from './logger.service.js';

export class StudentService {
  /**
   * Registers a new student in the school directory, with optional initial guardian linkage
   */
  public static async createStudent(
    schoolId: string,
    payload: CreateStudentRequest,
    userId?: string,
    ipAddress?: string
  ): Promise<StudentWithDetails> {
    const trimmedName = payload.fullName.trim();
    const cleanAdmissionNumber = payload.admissionNumber.trim().toUpperCase();
    const cleanClass = payload.classGrade.trim();
    const cleanSection = payload.section.trim().toUpperCase();
    const cleanRollNumber = payload.rollNumber?.trim() || null;
    const cleanEmergencyPhone = payload.emergencyContactPhone && payload.emergencyContactPhone.trim()
      ? normalizeIndianPhoneNumber(payload.emergencyContactPhone.trim())
      : null;

    // Optional guardian details
    const guardianName = payload.guardianName?.trim() || null;
    const guardianPhone = payload.guardianPhone && payload.guardianPhone.trim()
      ? normalizeIndianPhoneNumber(payload.guardianPhone.trim())
      : null;
    const guardianRelationship = payload.guardianRelationship || 'PARENT';
    const guardianEmail = payload.guardianEmail?.trim() || null;

    // 1. Check for duplicate admission number in this school tenant
    const duplicateSql = `
      SELECT id, full_name, admission_number
      FROM students
      WHERE school_id = $1 AND admission_number = $2 AND deleted_at IS NULL
    `;
    const existing = await query<{ id: string; full_name: string; admission_number: string }>(
      duplicateSql,
      [schoolId, cleanAdmissionNumber]
    );

    if (existing.length > 0) {
      throw new ConflictError(
        `Student with Admission Number / Student ID "${cleanAdmissionNumber}" already exists in your school roster.`
      );
    }

    let createdStudentId: string;

    // 2. Transaction: Insert student record and optional parent linkage
    await DbService.withTransaction(async (client) => {
      const insertSql = `
        INSERT INTO students (
          school_id,
          full_name,
          admission_number,
          class_grade,
          section,
          roll_number,
          emergency_contact_phone
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `;

      const insertRes = await client.query<{ id: string }>(insertSql, [
        schoolId,
        trimmedName,
        cleanAdmissionNumber,
        cleanClass,
        cleanSection,
        cleanRollNumber,
        cleanEmergencyPhone,
      ]);

      createdStudentId = insertRes.rows[0].id;

      if (guardianName && guardianPhone) {
        const insertParentSql = `
          INSERT INTO parents (
            school_id,
            student_id,
            full_name,
            relationship,
            phone,
            email
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `;
        await client.query(insertParentSql, [
          schoolId,
          createdStudentId,
          guardianName,
          guardianRelationship,
          guardianPhone,
          guardianEmail,
        ]);
      }
    });

    // 3. Security Audit Logging
    await AuditService.log({
      schoolId,
      userId: userId || null,
      userRole: 'SCHOOL_ADMIN',
      action: 'STUDENT_CREATED',
      entityType: 'STUDENT',
      entityId: createdStudentId!,
      diffJson: {
        fullName: trimmedName,
        admissionNumber: cleanAdmissionNumber,
        classGrade: cleanClass,
        section: cleanSection,
        rollNumber: cleanRollNumber,
        emergencyContactPhone: cleanEmergencyPhone,
        hasInitialGuardian: Boolean(guardianName && guardianPhone),
      },
      ipAddress,
    });

    logger.info('Student created successfully', {
      studentId: createdStudentId!,
      schoolId,
      admissionNumber: cleanAdmissionNumber,
      classGrade: cleanClass,
      section: cleanSection,
    });

    return await this.getStudentById(schoolId, createdStudentId!);
  }

  /**
   * Retrieves all students belonging to a school tenant with route, stop, bus, and parent associations
   */
  public static async getStudents(
    schoolId: string,
    filters?: {
      search?: string;
      classGrade?: string;
      section?: string;
    }
  ): Promise<StudentWithDetails[]> {
    let sql = `
      SELECT 
        s.id,
        s.school_id,
        s.full_name,
        s.admission_number,
        s.class_grade,
        s.section,
        s.roll_number,
        s.emergency_contact_phone,
        s.created_at,
        s.updated_at,
        ssa.pickup_stop_id,
        pl_pickup.stop_name AS pickup_stop_name,
        pl_pickup.scheduled_time::text AS pickup_scheduled_time,
        ssa.drop_stop_id,
        pl_drop.stop_name AS drop_stop_name,
        pl_drop.scheduled_time::text AS drop_scheduled_time,
        r.id AS assigned_route_id,
        r.name AS assigned_route_name,
        r.code AS assigned_route_code,
        b.id AS assigned_bus_id,
        b.bus_number AS assigned_bus_number,
        b.registration_number AS assigned_bus_registration_number,
        CASE 
          WHEN ssa.pickup_stop_id IS NOT NULL THEN 'ASSIGNED' 
          ELSE 'UNASSIGNED' 
        END AS transport_status,
        (
          SELECT json_build_object(
            'id', p.id,
            'fullName', p.full_name,
            'phone', p.phone,
            'relationship', p.relationship,
            'email', p.email
          )
          FROM parents p
          WHERE p.student_id = s.id AND p.deleted_at IS NULL
          ORDER BY p.created_at ASC
          LIMIT 1
        ) AS primary_parent,
        (
          SELECT COUNT(*)::int
          FROM parents p
          WHERE p.student_id = s.id AND p.deleted_at IS NULL
        ) AS parent_count
      FROM students s
      LEFT JOIN student_stop_assignments ssa 
        ON ssa.student_id = s.id
      LEFT JOIN pickup_locations pl_pickup 
        ON pl_pickup.id = ssa.pickup_stop_id
      LEFT JOIN pickup_locations pl_drop 
        ON pl_drop.id = ssa.drop_stop_id
      LEFT JOIN routes r 
        ON r.id = pl_pickup.route_id
      LEFT JOIN buses b 
        ON b.id = r.default_bus_id AND b.deleted_at IS NULL
      WHERE s.school_id = $1 AND s.deleted_at IS NULL
    `;

    const params: any[] = [schoolId];
    let paramIndex = 2;

    if (filters?.classGrade && filters.classGrade.trim()) {
      sql += ` AND LOWER(s.class_grade) = LOWER($${paramIndex})`;
      params.push(filters.classGrade.trim());
      paramIndex++;
    }

    if (filters?.section && filters.section.trim()) {
      sql += ` AND UPPER(s.section) = UPPER($${paramIndex})`;
      params.push(filters.section.trim());
      paramIndex++;
    }

    if (filters?.search && filters.search.trim()) {
      const searchPattern = `%${filters.search.trim().toLowerCase()}%`;
      sql += ` AND (
        LOWER(s.full_name) LIKE $${paramIndex} OR
        LOWER(s.admission_number) LIKE $${paramIndex} OR
        LOWER(COALESCE(s.roll_number, '')) LIKE $${paramIndex} OR
        LOWER(COALESCE(s.emergency_contact_phone, '')) LIKE $${paramIndex}
      )`;
      params.push(searchPattern);
      paramIndex++;
    }

    sql += ` ORDER BY s.class_grade ASC, s.section ASC, s.full_name ASC`;

    const rows = await query<any>(sql, params);

    return rows.map((r) => {
      const parent = r.primary_parent;
      return {
        id: r.id,
        schoolId: r.school_id,
        fullName: r.full_name,
        admissionNumber: r.admission_number,
        classGrade: r.class_grade,
        section: r.section,
        rollNumber: r.roll_number,
        emergencyContactPhone: r.emergency_contact_phone,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : undefined,
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : undefined,
        pickupStopId: r.pickup_stop_id,
        pickupStopName: r.pickup_stop_name,
        pickupScheduledTime: r.pickup_scheduled_time,
        dropStopId: r.drop_stop_id,
        dropStopName: r.drop_stop_name,
        dropScheduledTime: r.drop_scheduled_time,
        assignedRouteId: r.assigned_route_id,
        assignedRouteName: r.assigned_route_name,
        assignedRouteCode: r.assigned_route_code,
        assignedBusId: r.assigned_bus_id,
        assignedBusNumber: r.assigned_bus_number,
        assignedBusRegistrationNumber: r.assigned_bus_registration_number,
        transportStatus: r.transport_status,
        parentName: parent?.fullName || null,
        parentPhone: parent?.phone || null,
        parentRelationship: parent?.relationship || null,
        parentEmail: parent?.email || null,
        parentCount: r.parent_count || 0,
      };
    });
  }

  /**
   * Retrieves single student details by ID including parent list, assigned bus & stop times
   */
  public static async getStudentById(schoolId: string, studentId: string): Promise<StudentWithDetails> {
    const sql = `
      SELECT 
        s.id,
        s.school_id,
        s.full_name,
        s.admission_number,
        s.class_grade,
        s.section,
        s.roll_number,
        s.emergency_contact_phone,
        s.created_at,
        s.updated_at,
        ssa.pickup_stop_id,
        pl_pickup.stop_name AS pickup_stop_name,
        pl_pickup.scheduled_time::text AS pickup_scheduled_time,
        ssa.drop_stop_id,
        pl_drop.stop_name AS drop_stop_name,
        pl_drop.scheduled_time::text AS drop_scheduled_time,
        r.id AS assigned_route_id,
        r.name AS assigned_route_name,
        r.code AS assigned_route_code,
        b.id AS assigned_bus_id,
        b.bus_number AS assigned_bus_number,
        b.registration_number AS assigned_bus_registration_number,
        CASE 
          WHEN ssa.pickup_stop_id IS NOT NULL THEN 'ASSIGNED' 
          ELSE 'UNASSIGNED' 
        END AS transport_status,
        (
          SELECT json_build_object(
            'id', p.id,
            'fullName', p.full_name,
            'phone', p.phone,
            'relationship', p.relationship,
            'email', p.email
          )
          FROM parents p
          WHERE p.student_id = s.id AND p.deleted_at IS NULL
          ORDER BY p.created_at ASC
          LIMIT 1
        ) AS primary_parent,
        (
          SELECT COUNT(*)::int
          FROM parents p
          WHERE p.student_id = s.id AND p.deleted_at IS NULL
        ) AS parent_count
      FROM students s
      LEFT JOIN student_stop_assignments ssa 
        ON ssa.student_id = s.id
      LEFT JOIN pickup_locations pl_pickup 
        ON pl_pickup.id = ssa.pickup_stop_id
      LEFT JOIN pickup_locations pl_drop 
        ON pl_drop.id = ssa.drop_stop_id
      LEFT JOIN routes r 
        ON r.id = pl_pickup.route_id
      LEFT JOIN buses b 
        ON b.id = r.default_bus_id AND b.deleted_at IS NULL
      WHERE s.id = $1 AND s.school_id = $2 AND s.deleted_at IS NULL
    `;

    const rows = await query<any>(sql, [studentId, schoolId]);

    if (rows.length === 0) {
      throw new NotFoundError('Student record not found or does not belong to your school.');
    }

    const r = rows[0];
    const parent = r.primary_parent;

    // Fetch full parents array
    const parentsList = await this.getParentsByStudentId(schoolId, studentId);

    return {
      id: r.id,
      schoolId: r.school_id,
      fullName: r.full_name,
      admissionNumber: r.admission_number,
      classGrade: r.class_grade,
      section: r.section,
      rollNumber: r.roll_number,
      emergencyContactPhone: r.emergency_contact_phone,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : undefined,
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : undefined,
      pickupStopId: r.pickup_stop_id,
      pickupStopName: r.pickup_stop_name,
      pickupScheduledTime: r.pickup_scheduled_time,
      dropStopId: r.drop_stop_id,
      dropStopName: r.drop_stop_name,
      dropScheduledTime: r.drop_scheduled_time,
      assignedRouteId: r.assigned_route_id,
      assignedRouteName: r.assigned_route_name,
      assignedRouteCode: r.assigned_route_code,
      assignedBusId: r.assigned_bus_id,
      assignedBusNumber: r.assigned_bus_number,
      assignedBusRegistrationNumber: r.assigned_bus_registration_number,
      transportStatus: r.transport_status,
      parentName: parent?.fullName || null,
      parentPhone: parent?.phone || null,
      parentRelationship: parent?.relationship || null,
      parentEmail: parent?.email || null,
      parentCount: parentsList.length,
      parents: parentsList,
    };
  }

  /**
   * Retrieves all parents/guardians linked to a student
   */
  public static async getParentsByStudentId(
    schoolId: string,
    studentId: string
  ): Promise<ParentGuardianRecord[]> {
    // 1. Verify student exists in this school
    const studentCheck = await query<{ id: string }>(
      `SELECT id FROM students WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [studentId, schoolId]
    );
    if (studentCheck.length === 0) {
      throw new NotFoundError('Student record not found or does not belong to your school.');
    }

    // 2. Query parents
    const sql = `
      SELECT 
        id,
        school_id,
        student_id,
        full_name,
        relationship,
        phone,
        email,
        created_at,
        updated_at
      FROM parents
      WHERE student_id = $1 AND school_id = $2 AND deleted_at IS NULL
      ORDER BY created_at ASC
    `;

    const rows = await query<any>(sql, [studentId, schoolId]);

    return rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      studentId: r.student_id,
      fullName: r.full_name,
      relationship: r.relationship,
      phone: r.phone,
      email: r.email || null,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : undefined,
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : undefined,
    }));
  }

  /**
   * Adds or updates parent/guardian details and emergency contact for a student
   */
  public static async upsertParentGuardian(
    schoolId: string,
    studentId: string,
    payload: UpsertParentGuardianRequest,
    userId?: string,
    ipAddress?: string
  ): Promise<StudentWithDetails> {
    const trimmedName = payload.fullName.trim();
    const cleanRelationship = payload.relationship || 'PARENT';
    const normalizedPhone = normalizeIndianPhoneNumber(payload.phone.trim());
    const cleanEmail = payload.email?.trim() || null;
    const cleanEmergencyPhone = payload.emergencyContactPhone && payload.emergencyContactPhone.trim()
      ? normalizeIndianPhoneNumber(payload.emergencyContactPhone.trim())
      : null;

    // 1. Verify student exists in school
    const studentCheck = await query<{ id: string; emergency_contact_phone: string | null }>(
      `SELECT id, emergency_contact_phone FROM students WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [studentId, schoolId]
    );

    if (studentCheck.length === 0) {
      throw new NotFoundError('Student record not found or does not belong to your school.');
    }

    // 2. Transaction: Update emergency phone on student & upsert parent record
    await DbService.withTransaction(async (client) => {
      if (cleanEmergencyPhone !== null) {
        await client.query(
          `UPDATE students SET emergency_contact_phone = $1, updated_at = NOW() WHERE id = $2 AND school_id = $3`,
          [cleanEmergencyPhone, studentId, schoolId]
        );
      }

      // Check if this parent already exists for student (by phone or first existing parent)
      const existingParentRes = await client.query<{ id: string }>(
        `SELECT id FROM parents WHERE student_id = $1 AND school_id = $2 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
        [studentId, schoolId]
      );

      if (existingParentRes.rows.length > 0) {
        const parentId = existingParentRes.rows[0].id;
        const updateSql = `
          UPDATE parents
          SET
            full_name = $1,
            relationship = $2,
            phone = $3,
            email = $4,
            updated_at = NOW()
          WHERE id = $5 AND school_id = $6
        `;
        await client.query(updateSql, [
          trimmedName,
          cleanRelationship,
          normalizedPhone,
          cleanEmail,
          parentId,
          schoolId,
        ]);
      } else {
        const insertSql = `
          INSERT INTO parents (
            school_id,
            student_id,
            full_name,
            relationship,
            phone,
            email
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `;
        await client.query(insertSql, [
          schoolId,
          studentId,
          trimmedName,
          cleanRelationship,
          normalizedPhone,
          cleanEmail,
        ]);
      }
    });

    // 3. Security Audit Log
    await AuditService.log({
      schoolId,
      userId: userId || null,
      userRole: 'SCHOOL_ADMIN',
      action: 'STUDENT_PARENT_UPDATED',
      entityType: 'STUDENT',
      entityId: studentId,
      diffJson: {
        guardianName: trimmedName,
        relationship: cleanRelationship,
        guardianPhone: normalizedPhone,
        guardianEmail: cleanEmail,
        emergencyContactPhone: cleanEmergencyPhone,
      },
      ipAddress,
    });

    logger.info('Student parent/guardian updated successfully', {
      studentId,
      schoolId,
      guardianName: trimmedName,
      guardianPhone: normalizedPhone,
    });

    return await this.getStudentById(schoolId, studentId);
  }

  /**
   * Removes (soft-deletes) a parent/guardian link from a student
   */
  public static async deleteParent(
    schoolId: string,
    studentId: string,
    parentId: string,
    userId?: string,
    ipAddress?: string
  ): Promise<void> {
    // 1. Verify parent exists and belongs to student & school
    const parentRows = await query<{ id: string; full_name: string; phone: string }>(
      `SELECT id, full_name, phone FROM parents WHERE id = $1 AND student_id = $2 AND school_id = $3 AND deleted_at IS NULL`,
      [parentId, studentId, schoolId]
    );

    if (parentRows.length === 0) {
      throw new NotFoundError('Parent record not found or does not belong to this student.');
    }

    const parent = parentRows[0];

    // 2. Soft-delete parent
    await query(
      `UPDATE parents SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND student_id = $2 AND school_id = $3`,
      [parentId, studentId, schoolId]
    );

    // 3. Security Audit Log
    await AuditService.log({
      schoolId,
      userId: userId || null,
      userRole: 'SCHOOL_ADMIN',
      action: 'STUDENT_PARENT_REMOVED',
      entityType: 'STUDENT',
      entityId: studentId,
      diffJson: {
        deletedParentId: parentId,
        parentName: parent.full_name,
        parentPhone: parent.phone,
      },
      ipAddress,
    });

    logger.info('Parent record removed for student', {
      studentId,
      parentId,
      schoolId,
    });
  }

  /**
   * Assigns or unassigns bus pickup/drop stops for a student
   */
  public static async assignTransport(
    schoolId: string,
    studentId: string,
    payload: AssignStudentTransportPayload,
    userId?: string,
    ipAddress?: string
  ): Promise<StudentWithDetails> {
    // 1. Verify student exists in this school
    const studentCheck = await query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM students WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [studentId, schoolId]
    );
    if (studentCheck.length === 0) {
      throw new NotFoundError('Student record not found or does not belong to your school.');
    }
    const student = studentCheck[0];

    const pickupStopId = payload.pickupStopId && payload.pickupStopId.trim() ? payload.pickupStopId.trim() : null;
    const dropStopId = payload.dropStopId && payload.dropStopId.trim() ? payload.dropStopId.trim() : null;

    if (pickupStopId) {
      // 2. Verify pickup stop belongs to this school
      const stopCheck = await query<{ id: string; stop_name: string; route_id: string }>(
        `SELECT id, stop_name, route_id FROM pickup_locations WHERE id = $1 AND school_id = $2`,
        [pickupStopId, schoolId]
      );
      if (stopCheck.length === 0) {
        throw new BadRequestError('Selected pickup stop does not exist or belongs to another school.');
      }

      if (dropStopId) {
        const dropCheck = await query<{ id: string; stop_name: string }>(
          `SELECT id, stop_name FROM pickup_locations WHERE id = $1 AND school_id = $2`,
          [dropStopId, schoolId]
        );
        if (dropCheck.length === 0) {
          throw new BadRequestError('Selected drop stop does not exist or belongs to another school.');
        }
      }

      // Upsert into student_stop_assignments
      await DbService.withTransaction(async (client) => {
        const upsertSql = `
          INSERT INTO student_stop_assignments (
            school_id,
            student_id,
            pickup_stop_id,
            drop_stop_id
          )
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (school_id, student_id)
          DO UPDATE SET
            pickup_stop_id = EXCLUDED.pickup_stop_id,
            drop_stop_id = EXCLUDED.drop_stop_id,
            updated_at = NOW()
        `;
        await client.query(upsertSql, [schoolId, studentId, pickupStopId, dropStopId]);
      });

      // Audit Log
      await AuditService.log({
        schoolId,
        userId: userId || null,
        userRole: 'SCHOOL_ADMIN',
        action: 'STUDENT_TRANSPORT_ASSIGNED',
        entityType: 'STUDENT',
        entityId: studentId,
        diffJson: {
          studentName: student.full_name,
          pickupStopId,
          pickupStopName: stopCheck[0].stop_name,
          dropStopId,
        },
        ipAddress,
      });

      logger.info('Student transport assigned successfully', {
        studentId,
        schoolId,
        pickupStopId,
        dropStopId,
      });
    } else {
      // Unassign transport
      await DbService.withTransaction(async (client) => {
        await client.query(
          `DELETE FROM student_stop_assignments WHERE school_id = $1 AND student_id = $2`,
          [schoolId, studentId]
        );
      });

      // Audit Log
      await AuditService.log({
        schoolId,
        userId: userId || null,
        userRole: 'SCHOOL_ADMIN',
        action: 'STUDENT_TRANSPORT_UNASSIGNED',
        entityType: 'STUDENT',
        entityId: studentId,
        diffJson: {
          studentName: student.full_name,
        },
        ipAddress,
      });

      logger.info('Student transport unassigned successfully', {
        studentId,
        schoolId,
      });
    }

    return await this.getStudentById(schoolId, studentId);
  }

  /**
   * Retrieves all available routes and stops with linked fleet buses for a school
   */
  public static async getTransportOptions(schoolId: string): Promise<RouteWithStopsOption[]> {
    const routesSql = `
      SELECT 
        r.id,
        r.name,
        r.code,
        r.route_type,
        b.id AS bus_id,
        b.bus_number,
        b.registration_number AS bus_registration_number
      FROM routes r
      LEFT JOIN buses b ON b.id = r.default_bus_id AND b.deleted_at IS NULL
      WHERE r.school_id = $1 AND r.deleted_at IS NULL
      ORDER BY r.name ASC
    `;
    const routeRows = await query<any>(routesSql, [schoolId]);

    const stopsSql = `
      SELECT 
        id,
        route_id,
        stop_name,
        sequence_order,
        scheduled_time::text AS scheduled_time,
        latitude,
        longitude,
        geofence_radius_meters
      FROM pickup_locations
      WHERE school_id = $1
      ORDER BY route_id, sequence_order ASC
    `;
    const stopRows = await query<any>(stopsSql, [schoolId]);

    const stopsByRoute = new Map<string, any[]>();
    for (const stop of stopRows) {
      if (!stopsByRoute.has(stop.route_id)) {
        stopsByRoute.set(stop.route_id, []);
      }
      stopsByRoute.get(stop.route_id)!.push({
        id: stop.id,
        stopName: stop.stop_name,
        sequenceOrder: stop.sequence_order,
        scheduledTime: stop.scheduled_time,
        latitude: stop.latitude,
        longitude: stop.longitude,
        geofenceRadiusMeters: stop.geofence_radius_meters,
      });
    }

    return routeRows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      routeType: r.route_type,
      busId: r.bus_id || null,
      busNumber: r.bus_number || null,
      busRegistrationNumber: r.bus_registration_number || null,
      stops: stopsByRoute.get(r.id) || [],
    }));
  }

  /**
   * Updates student demographic and academic profile
   */
  public static async updateStudent(
    schoolId: string,
    studentId: string,
    payload: UpdateStudentRequest,
    userId?: string,
    ipAddress?: string
  ): Promise<StudentWithDetails> {
    // 1. Verify student exists in this school
    const currentStudent = await this.getStudentById(schoolId, studentId);

    const trimmedName = payload.fullName !== undefined ? payload.fullName.trim() : currentStudent.fullName;
    const trimmedAdm = payload.admissionNumber !== undefined ? payload.admissionNumber.trim().toUpperCase() : currentStudent.admissionNumber;
    const trimmedClass = payload.classGrade !== undefined ? payload.classGrade.trim() : currentStudent.classGrade;
    const trimmedSec = payload.section !== undefined ? payload.section.trim().toUpperCase() : currentStudent.section;
    const trimmedRoll = payload.rollNumber !== undefined ? (payload.rollNumber?.trim() || null) : currentStudent.rollNumber;
    const cleanEmergencyPhone = payload.emergencyContactPhone !== undefined
      ? (payload.emergencyContactPhone && payload.emergencyContactPhone.trim() ? normalizeIndianPhoneNumber(payload.emergencyContactPhone.trim()) : null)
      : currentStudent.emergencyContactPhone;

    // 2. Check admission number uniqueness if changed
    if (trimmedAdm !== currentStudent.admissionNumber) {
      const duplicateCheck = await query<{ id: string }>(
        `SELECT id FROM students WHERE school_id = $1 AND admission_number = $2 AND id != $3 AND deleted_at IS NULL`,
        [schoolId, trimmedAdm, studentId]
      );
      if (duplicateCheck.length > 0) {
        throw new ConflictError(`Admission number '${trimmedAdm}' is already registered for another student in this school.`);
      }
    }

    // 3. Update student record
    const updateSql = `
      UPDATE students
      SET
        full_name = $1,
        admission_number = $2,
        class_grade = $3,
        section = $4,
        roll_number = $5,
        emergency_contact_phone = $6,
        updated_at = NOW()
      WHERE id = $7 AND school_id = $8 AND deleted_at IS NULL
    `;
    await query(updateSql, [
      trimmedName,
      trimmedAdm,
      trimmedClass,
      trimmedSec,
      trimmedRoll,
      cleanEmergencyPhone,
      studentId,
      schoolId,
    ]);

    // 4. Audit Log
    await AuditService.log({
      schoolId,
      userId: userId || null,
      userRole: 'SCHOOL_ADMIN',
      action: 'STUDENT_UPDATED',
      entityType: 'STUDENT',
      entityId: studentId,
      diffJson: {
        before: {
          fullName: currentStudent.fullName,
          admissionNumber: currentStudent.admissionNumber,
          classGrade: currentStudent.classGrade,
          section: currentStudent.section,
          rollNumber: currentStudent.rollNumber,
          emergencyContactPhone: currentStudent.emergencyContactPhone,
        },
        after: {
          fullName: trimmedName,
          admissionNumber: trimmedAdm,
          classGrade: trimmedClass,
          section: trimmedSec,
          rollNumber: trimmedRoll,
          emergencyContactPhone: cleanEmergencyPhone,
        },
      },
      ipAddress,
    });

    logger.info('Student details updated successfully', {
      schoolId,
      studentId,
      updatedBy: userId,
    });

    return await this.getStudentById(schoolId, studentId);
  }

  /**
   * Soft-deletes a student and cleans up transport allocations
   */
  public static async deleteStudent(
    schoolId: string,
    studentId: string,
    userId?: string,
    ipAddress?: string
  ): Promise<void> {
    // 1. Verify student exists in this school
    const current = await this.getStudentById(schoolId, studentId);

    // 2. Transaction: soft delete student, remove transport stop assignments, delete parents
    await DbService.withTransaction(async (client) => {
      // Soft-delete student
      await client.query(
        `UPDATE students SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND school_id = $2`,
        [studentId, schoolId]
      );

      // Remove transport allocation
      await client.query(
        `DELETE FROM student_stop_assignments WHERE student_id = $1 AND school_id = $2`,
        [studentId, schoolId]
      );

      // Soft delete parents
      await client.query(
        `UPDATE parents SET deleted_at = NOW(), updated_at = NOW() WHERE student_id = $1 AND school_id = $2`,
        [studentId, schoolId]
      );
    });

    // 3. Audit Log
    await AuditService.log({
      schoolId,
      userId: userId || null,
      userRole: 'SCHOOL_ADMIN',
      action: 'STUDENT_DELETED',
      entityType: 'STUDENT',
      entityId: studentId,
      diffJson: {
        deletedStudentName: current.fullName,
        admissionNumber: current.admissionNumber,
        classGrade: current.classGrade,
        section: current.section,
      },
      ipAddress,
    });

    logger.info('Student deleted successfully', {
      schoolId,
      studentId,
      deletedBy: userId,
    });
  }

  /**
   * Retrieves chronological transport history (boarding and drop-off events) for a student
   */
  public static async getStudentTransportHistory(
    schoolId: string,
    studentId: string,
    limit = 50
  ): Promise<StudentTransportHistoryResponse> {
    // 1. Verify student exists in this school
    await this.getStudentById(schoolId, studentId);

    // 2. Query union of boarding and drop events
    const historySql = `
      SELECT 
        be.id,
        be.trip_id,
        'BOARDED'::text AS event_type,
        be.status,
        be.marked_by,
        be.recorded_at,
        pl.stop_name,
        pl.sequence_order AS stop_sequence,
        b.bus_number,
        b.registration_number AS bus_registration_number,
        r.name AS route_name,
        r.code AS route_code,
        TO_CHAR(t.scheduled_date, 'YYYY-MM-DD') AS scheduled_date
      FROM boarding_events be
      JOIN trips t ON t.id = be.trip_id AND t.school_id = $1
      JOIN routes r ON r.id = t.route_id
      JOIN buses b ON b.id = t.bus_id
      JOIN pickup_locations pl ON pl.id = be.stop_id
      WHERE be.student_id = $2
      
      UNION ALL
      
      SELECT 
        de.id,
        de.trip_id,
        'DEBOARDED'::text AS event_type,
        de.status,
        de.marked_by,
        de.recorded_at,
        pl.stop_name,
        pl.sequence_order AS stop_sequence,
        b.bus_number,
        b.registration_number AS bus_registration_number,
        r.name AS route_name,
        r.code AS route_code,
        TO_CHAR(t.scheduled_date, 'YYYY-MM-DD') AS scheduled_date
      FROM drop_events de
      JOIN trips t ON t.id = de.trip_id AND t.school_id = $1
      JOIN routes r ON r.id = t.route_id
      JOIN buses b ON b.id = t.bus_id
      JOIN pickup_locations pl ON pl.id = de.stop_id
      WHERE de.student_id = $2

      ORDER BY recorded_at DESC
      LIMIT $3
    `;

    const rows = await query<any>(historySql, [schoolId, studentId, limit]);

    let totalBoarded = 0;
    let totalAbsent = 0;
    let totalDeboarded = 0;
    let lastRodeAt: string | null = null;

    const history: StudentTransportHistoryItem[] = rows.map((r, index) => {
      if (index === 0) {
        lastRodeAt = r.recorded_at ? new Date(r.recorded_at).toISOString() : null;
      }
      if (r.event_type === 'BOARDED') {
        if (r.status === 'ABSENT') {
          totalAbsent++;
        } else {
          totalBoarded++;
        }
      } else if (r.event_type === 'DEBOARDED') {
        totalDeboarded++;
      }

      return {
        id: r.id,
        tripId: r.trip_id,
        eventType: r.status === 'ABSENT' ? 'ABSENT' : (r.event_type as 'BOARDED' | 'DEBOARDED'),
        status: r.status,
        markedBy: r.marked_by,
        recordedAt: r.recorded_at ? new Date(r.recorded_at).toISOString() : '',
        stopName: r.stop_name,
        stopSequence: r.stop_sequence !== null ? Number(r.stop_sequence) : null,
        busNumber: r.bus_number,
        busRegistrationNumber: r.bus_registration_number,
        routeName: r.route_name,
        routeCode: r.route_code,
        scheduledDate: r.scheduled_date,
      };
    });

    return {
      studentId,
      summary: {
        totalBoarded,
        totalAbsent,
        totalDeboarded,
        lastRodeAt,
      },
      history,
    };
  }
}

