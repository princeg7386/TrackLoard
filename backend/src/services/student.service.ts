import { query } from '../config/database.js';
import {
  CreateStudentRequest,
  UpdateStudentRequest,
  StudentWithDetails,
  normalizeIndianPhoneNumber,
} from '@school-bus/shared';
import {
  ConflictError,
  BadRequestError,
  NotFoundError,
} from '../middlewares/error.middleware.js';
import { AuditService } from './audit.service.js';
import { logger } from './logger.service.js';

export class StudentService {
  /**
   * Registers a new student in the school directory
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

    // 2. Insert student record
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
      RETURNING
        id,
        school_id,
        full_name,
        admission_number,
        class_grade,
        section,
        roll_number,
        emergency_contact_phone,
        created_at,
        updated_at
    `;

    const insertedRows = await query<any>(insertSql, [
      schoolId,
      trimmedName,
      cleanAdmissionNumber,
      cleanClass,
      cleanSection,
      cleanRollNumber,
      cleanEmergencyPhone,
    ]);

    const createdStudent = insertedRows[0];

    // 3. Security Audit Logging
    await AuditService.log({
      schoolId,
      userId: userId || null,
      userRole: 'SCHOOL_ADMIN',
      action: 'STUDENT_CREATED',
      entityType: 'STUDENT',
      entityId: createdStudent.id,
      diffJson: {
        fullName: trimmedName,
        admissionNumber: cleanAdmissionNumber,
        classGrade: cleanClass,
        section: cleanSection,
        rollNumber: cleanRollNumber,
        emergencyContactPhone: cleanEmergencyPhone,
      },
      ipAddress,
    });

    logger.info('Student created successfully', {
      studentId: createdStudent.id,
      schoolId,
      admissionNumber: cleanAdmissionNumber,
      classGrade: cleanClass,
      section: cleanSection,
    });

    return {
      id: createdStudent.id,
      schoolId: createdStudent.school_id,
      fullName: createdStudent.full_name,
      admissionNumber: createdStudent.admission_number,
      classGrade: createdStudent.class_grade,
      section: createdStudent.section,
      rollNumber: createdStudent.roll_number,
      emergencyContactPhone: createdStudent.emergency_contact_phone,
      createdAt: createdStudent.created_at ? new Date(createdStudent.created_at).toISOString() : undefined,
      updatedAt: createdStudent.updated_at ? new Date(createdStudent.updated_at).toISOString() : undefined,
      parentCount: 0,
    };
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
            'fullName', p.full_name,
            'phone', p.phone,
            'relationship', p.relationship
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
        parentCount: r.parent_count || 0,
      };
    });
  }

  /**
   * Retrieves single student details by ID
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
            'fullName', p.full_name,
            'phone', p.phone,
            'relationship', p.relationship
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
      parentCount: r.parent_count || 0,
    };
  }
}
