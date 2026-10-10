import { query } from '../config/database.js';
import {
  CreateStudentRequest,
  UpdateStudentRequest,
  UpsertParentGuardianRequest,
  ParentGuardianRecord,
  StudentWithDetails,
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
   * Retrieves all students belonging to a school tenant with route and parent associations
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
        ssa.drop_stop_id,
        pl_drop.stop_name AS drop_stop_name,
        r.id AS assigned_route_id,
        r.name AS assigned_route_name,
        r.code AS assigned_route_code,
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
        dropStopId: r.drop_stop_id,
        dropStopName: r.drop_stop_name,
        assignedRouteId: r.assigned_route_id,
        assignedRouteName: r.assigned_route_name,
        assignedRouteCode: r.assigned_route_code,
        parentName: parent?.fullName || null,
        parentPhone: parent?.phone || null,
        parentRelationship: parent?.relationship || null,
        parentEmail: parent?.email || null,
        parentCount: r.parent_count || 0,
      };
    });
  }

  /**
   * Retrieves single student details by ID including parent list
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
        ssa.drop_stop_id,
        pl_drop.stop_name AS drop_stop_name,
        r.id AS assigned_route_id,
        r.name AS assigned_route_name,
        r.code AS assigned_route_code,
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
      dropStopId: r.drop_stop_id,
      dropStopName: r.drop_stop_name,
      assignedRouteId: r.assigned_route_id,
      assignedRouteName: r.assigned_route_name,
      assignedRouteCode: r.assigned_route_code,
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
}
