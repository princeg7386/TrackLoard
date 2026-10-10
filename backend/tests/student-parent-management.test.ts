import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { StudentService } from '../src/services/student.service.js';
import { AuthService } from '../src/services/auth.service.js';
import { UserRole, StudentWithDetails, ParentGuardianRecord } from '@school-bus/shared';
import { NotFoundError } from '../src/middlewares/error.middleware.js';

describe('Student Parent & Guardian Management (Micro-phase 8.2)', () => {
  const app = createApp();

  const schoolIdA = '111e4567-e89b-12d3-a456-426614174001';
  const schoolIdB = '999e4567-e89b-12d3-a456-426614174999';
  const studentIdA = '33333333-e89b-12d3-a456-426614174001';
  const parentIdA = '77777777-e89b-12d3-a456-426614174001';

  const adminUserA = {
    id: 'aaa11111-e89b-12d3-a456-426614174001',
    schoolId: schoolIdA,
    email: 'admin.a@dpa.edu.in',
    fullName: 'Principal Sharma',
    role: UserRole.SCHOOL_ADMIN,
  };

  const mockParent: ParentGuardianRecord = {
    id: parentIdA,
    schoolId: schoolIdA,
    studentId: studentIdA,
    fullName: 'Vikram Sharma',
    relationship: 'FATHER',
    phone: '+919876543210',
    email: 'vikram.sharma@example.com',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockStudentWithParent: StudentWithDetails = {
    id: studentIdA,
    schoolId: schoolIdA,
    fullName: 'Aarav Sharma',
    admissionNumber: 'ADM-2026-0042',
    classGrade: 'Class 5',
    section: 'A',
    rollNumber: '14',
    emergencyContactPhone: '+919876543299',
    parentName: 'Vikram Sharma',
    parentPhone: '+919876543210',
    parentRelationship: 'FATHER',
    parentEmail: 'vikram.sharma@example.com',
    parentCount: 1,
    parents: [mockParent],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  describe('1. POST /api/v1/schools/:schoolId/students/:studentId/parents (Upsert Parent)', () => {
    it('successfully links or updates parent/guardian details and emergency contact', async () => {
      const token = AuthService.generateToken(adminUserA);
      const spy = vi.spyOn(StudentService, 'upsertParentGuardian').mockResolvedValueOnce(mockStudentWithParent);

      const payload = {
        fullName: 'Vikram Sharma',
        relationship: 'FATHER',
        phone: '9876543210',
        email: 'vikram.sharma@example.com',
        emergencyContactPhone: '9876543299',
      };

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/students/${studentIdA}/parents`)
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.parentName).toBe('Vikram Sharma');
      expect(res.body.data.parentPhone).toBe('+919876543210');
      expect(res.body.data.emergencyContactPhone).toBe('+919876543299');

      spy.mockRestore();
    });

    it('rejects invalid payload with 422 Unprocessable Entity', async () => {
      const token = AuthService.generateToken(adminUserA);

      const payload = {
        fullName: 'V', // Too short
        relationship: 'INVALID_RELATION',
        phone: '123', // Invalid phone
      };

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/students/${studentIdA}/parents`)
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects cross-tenant parent update with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdB}/students/${studentIdA}/parents`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          fullName: 'Vikram Sharma',
          relationship: 'FATHER',
          phone: '9876543210',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
    });
  });

  describe('2. GET /api/v1/schools/:schoolId/students/:studentId/parents (List Parents)', () => {
    it('returns parent records linked to student', async () => {
      const token = AuthService.generateToken(adminUserA);
      const spy = vi.spyOn(StudentService, 'getParentsByStudentId').mockResolvedValueOnce([mockParent]);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/students/${studentIdA}/parents`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data[0].fullName).toBe('Vikram Sharma');
      expect(res.body.data[0].phone).toBe('+919876543210');

      spy.mockRestore();
    });

    it('returns 404 for non-existent student', async () => {
      const token = AuthService.generateToken(adminUserA);
      const spy = vi.spyOn(StudentService, 'getParentsByStudentId').mockRejectedValueOnce(
        new NotFoundError('Student record not found or does not belong to your school.')
      );

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/students/${studentIdA}/parents`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);

      spy.mockRestore();
    });

    it('rejects cross-tenant get parents with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdB}/students/${studentIdA}/parents`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('3. DELETE /api/v1/schools/:schoolId/students/:studentId/parents/:parentId (Remove Parent)', () => {
    it('successfully removes parent guardian link', async () => {
      const token = AuthService.generateToken(adminUserA);
      const spy = vi.spyOn(StudentService, 'deleteParent').mockResolvedValueOnce();

      const res = await request(app)
        .delete(`/api/v1/schools/${schoolIdA}/students/${studentIdA}/parents/${parentIdA}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('removed successfully');

      spy.mockRestore();
    });

    it('rejects cross-tenant deletion with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .delete(`/api/v1/schools/${schoolIdB}/students/${studentIdA}/parents/${parentIdA}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });
});
