import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { StudentService } from '../src/services/student.service.js';
import { AuthService } from '../src/services/auth.service.js';
import { UserRole, StudentWithDetails } from '@school-bus/shared';
import { ConflictError, NotFoundError } from '../src/middlewares/error.middleware.js';

describe('Student Management (Micro-phase 8.1: Create Student)', () => {
  const app = createApp();

  const schoolIdA = '111e4567-e89b-12d3-a456-426614174001';
  const schoolIdB = '999e4567-e89b-12d3-a456-426614174999';
  const studentIdA = '33333333-e89b-12d3-a456-426614174001';

  const adminUserA = {
    id: 'aaa11111-e89b-12d3-a456-426614174001',
    schoolId: schoolIdA,
    email: 'admin.a@dpa.edu.in',
    fullName: 'Principal Sharma',
    role: UserRole.SCHOOL_ADMIN,
  };

  const mockStudent: StudentWithDetails = {
    id: studentIdA,
    schoolId: schoolIdA,
    fullName: 'Aarav Sharma',
    admissionNumber: 'ADM-2026-0042',
    classGrade: 'Class 5',
    section: 'A',
    rollNumber: '14',
    emergencyContactPhone: '+919876543210',
    pickupStopId: '44444444-e89b-12d3-a456-426614174001',
    pickupStopName: 'Greenwood Heights Gate 1',
    dropStopId: '44444444-e89b-12d3-a456-426614174001',
    dropStopName: 'Greenwood Heights Gate 1',
    assignedRouteId: '55555555-e89b-12d3-a456-426614174001',
    assignedRouteName: 'North Campus Morning Express',
    assignedRouteCode: 'NC-AM-01',
    parentName: 'Vikram Sharma',
    parentPhone: '+919876543210',
    parentRelationship: 'FATHER',
    parentCount: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  describe('1. POST /api/v1/schools/:schoolId/students (Create Student)', () => {
    it('successfully registers a new student record', async () => {
      const token = AuthService.generateToken(adminUserA);
      const spy = vi.spyOn(StudentService, 'createStudent').mockResolvedValueOnce(mockStudent);

      const payload = {
        fullName: 'Aarav Sharma',
        admissionNumber: 'ADM-2026-0042',
        classGrade: 'Class 5',
        section: 'A',
        rollNumber: '14',
        emergencyContactPhone: '9876543210',
      };

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/students`)
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fullName).toBe('Aarav Sharma');
      expect(res.body.data.admissionNumber).toBe('ADM-2026-0042');
      expect(res.body.data.classGrade).toBe('Class 5');
      expect(res.body.data.section).toBe('A');

      spy.mockRestore();
    });

    it('rejects duplicate admission number with 409 Conflict', async () => {
      const token = AuthService.generateToken(adminUserA);
      const spy = vi.spyOn(StudentService, 'createStudent').mockRejectedValueOnce(
        new ConflictError('Student with Admission Number / Student ID "ADM-2026-0042" already exists in your school roster.')
      );

      const payload = {
        fullName: 'Aarav Sharma',
        admissionNumber: 'ADM-2026-0042',
        classGrade: 'Class 5',
        section: 'A',
      };

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/students`)
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('already exists');

      spy.mockRestore();
    });

    it('fails validation when mandatory fields are missing', async () => {
      const token = AuthService.generateToken(adminUserA);

      const payload = {
        fullName: '', // Invalid empty name
        admissionNumber: '',
        classGrade: '',
        section: '',
      };

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/students`)
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/students`)
        .send({
          fullName: 'Aarav Sharma',
          admissionNumber: 'ADM-2026-0042',
          classGrade: 'Class 5',
          section: 'A',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects cross-tenant student creation with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdB}/students`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          fullName: 'Aarav Sharma',
          admissionNumber: 'ADM-2026-0042',
          classGrade: 'Class 5',
          section: 'A',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
    });
  });

  describe('2. GET /api/v1/schools/:schoolId/students (List Students)', () => {
    it('returns list of students for tenant school', async () => {
      const token = AuthService.generateToken(adminUserA);
      const spy = vi.spyOn(StudentService, 'getStudents').mockResolvedValueOnce([mockStudent]);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/students?search=Aarav&classGrade=Class%205&section=A`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].fullName).toBe('Aarav Sharma');

      expect(spy).toHaveBeenCalledWith(schoolIdA, {
        search: 'Aarav',
        classGrade: 'Class 5',
        section: 'A',
      });

      spy.mockRestore();
    });

    it('rejects cross-tenant student listing with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdB}/students`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('3. GET /api/v1/schools/:schoolId/students/:studentId (Get Student)', () => {
    it('returns student details by ID', async () => {
      const token = AuthService.generateToken(adminUserA);
      const spy = vi.spyOn(StudentService, 'getStudentById').mockResolvedValueOnce(mockStudent);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/students/${studentIdA}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(studentIdA);
      expect(res.body.data.admissionNumber).toBe('ADM-2026-0042');

      spy.mockRestore();
    });

    it('returns 404 for non-existent student', async () => {
      const token = AuthService.generateToken(adminUserA);
      const spy = vi.spyOn(StudentService, 'getStudentById').mockRejectedValueOnce(
        new NotFoundError('Student record not found or does not belong to your school.')
      );

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/students/${studentIdA}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);

      spy.mockRestore();
    });

    it('rejects cross-tenant get student with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdB}/students/${studentIdA}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });
});
