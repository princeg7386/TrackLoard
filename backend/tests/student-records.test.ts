import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { StudentService } from '../src/services/student.service.js';
import { AuthService } from '../src/services/auth.service.js';
import { UserRole, StudentWithDetails, StudentTransportHistoryResponse } from '@school-bus/shared';
import { NotFoundError, ConflictError } from '../src/middlewares/error.middleware.js';

describe('Student Records Management (Micro-phase 8.4: View, Edit, Remove, Transport History)', () => {
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

  const coordinatorUserA = {
    id: 'ccc11111-e89b-12d3-a456-426614174001',
    schoolId: schoolIdA,
    email: 'coord.a@dpa.edu.in',
    fullName: 'Coordinator Verma',
    role: UserRole.TRANSPORT_COORDINATOR,
  };

  const driverUserA = {
    id: 'ddd11111-e89b-12d3-a456-426614174001',
    schoolId: schoolIdA,
    email: 'driver.a@dpa.edu.in',
    fullName: 'Driver Singh',
    role: UserRole.DRIVER,
  };

  const mockStudent: StudentWithDetails = {
    id: studentIdA,
    schoolId: schoolIdA,
    fullName: 'Aarav Sharma',
    admissionNumber: 'ADM-2026-0042',
    classGrade: 'Class 5',
    section: 'A',
    rollNumber: '14',
    emergencyContactPhone: '+919876543299',
    transportStatus: 'ASSIGNED',
    assignedBusNumber: 'BUS-01',
    assignedBusRegistrationNumber: 'DL 01 AB 1234',
    pickupStopName: 'Sector 14 Main Gate',
    pickupScheduledTime: '07:15',
    dropStopName: 'Sector 14 Main Gate',
    dropScheduledTime: '15:45',
    parentCount: 1,
    parentName: 'Vikram Sharma',
    parentPhone: '+919876543210',
    parentRelationship: 'FATHER',
    parents: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockHistoryResponse: StudentTransportHistoryResponse = {
    studentId: studentIdA,
    summary: {
      totalBoarded: 12,
      totalAbsent: 1,
      totalDeboarded: 12,
      lastRodeAt: '2026-10-10T08:15:00.000Z',
    },
    history: [
      {
        id: 'hist-1',
        tripId: 'trip-1',
        eventType: 'BOARDED',
        status: 'BOARDED',
        markedBy: 'DRIVER',
        recordedAt: '2026-10-10T08:15:00.000Z',
        stopName: 'Sector 14 Main Gate',
        stopSequence: 1,
        busNumber: 'BUS-01',
        busRegistrationNumber: 'DL 01 AB 1234',
        routeName: 'North Campus Express',
        routeCode: 'R-01',
        scheduledDate: '2026-10-10',
      },
      {
        id: 'hist-2',
        tripId: 'trip-2',
        eventType: 'DEBOARDED',
        status: 'DEBOARDED',
        markedBy: 'DRIVER',
        recordedAt: '2026-10-09T16:05:00.000Z',
        stopName: 'Sector 14 Main Gate',
        stopSequence: 1,
        busNumber: 'BUS-01',
        busRegistrationNumber: 'DL 01 AB 1234',
        routeName: 'North Campus Express',
        routeCode: 'R-01',
        scheduledDate: '2026-10-09',
      },
    ],
  };

  describe('1. GET /api/v1/schools/:schoolId/students/:studentId (View Details)', () => {
    it('returns student details with transport and parent status', async () => {
      const token = AuthService.generateToken(adminUserA);
      const spy = vi.spyOn(StudentService, 'getStudentById').mockResolvedValueOnce(mockStudent);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/students/${studentIdA}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fullName).toBe('Aarav Sharma');
      expect(res.body.data.transportStatus).toBe('ASSIGNED');
      expect(res.body.data.assignedBusNumber).toBe('BUS-01');
      expect(spy).toHaveBeenCalledWith(schoolIdA, studentIdA);
    });

    it('rejects cross-tenant access with 403', async () => {
      const token = AuthService.generateToken(adminUserA); // schoolIdA

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdB}/students/${studentIdA}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });
  });

  describe('2. PUT /api/v1/schools/:schoolId/students/:studentId (Edit Student)', () => {
    it('allows school admin to update student profile', async () => {
      const token = AuthService.generateToken(adminUserA);
      const updatedMock = { ...mockStudent, fullName: 'Aarav V. Sharma', rollNumber: '15' };
      const spy = vi.spyOn(StudentService, 'updateStudent').mockResolvedValueOnce(updatedMock);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/students/${studentIdA}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          fullName: 'Aarav V. Sharma',
          rollNumber: '15',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fullName).toBe('Aarav V. Sharma');
      expect(res.body.data.rollNumber).toBe('15');
      expect(spy).toHaveBeenCalledWith(
        schoolIdA,
        studentIdA,
        expect.objectContaining({ fullName: 'Aarav V. Sharma', rollNumber: '15' }),
        adminUserA.id,
        expect.anything()
      );
    });

    it('rejects update when admission number is already taken (409 Conflict)', async () => {
      const token = AuthService.generateToken(adminUserA);
      vi.spyOn(StudentService, 'updateStudent').mockRejectedValueOnce(
        new ConflictError("Admission number 'ADM-2026-9999' is already registered for another student in this school.")
      );

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/students/${studentIdA}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          admissionNumber: 'ADM-2026-9999',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('already registered');
    });

    it('rejects unauthorized driver role with 403 Forbidden', async () => {
      const token = AuthService.generateToken(driverUserA);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/students/${studentIdA}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          fullName: 'Unauthorized Update',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('3. DELETE /api/v1/schools/:schoolId/students/:studentId (Remove Student)', () => {
    it('allows school admin to remove/soft-delete a student', async () => {
      const token = AuthService.generateToken(adminUserA);
      const spy = vi.spyOn(StudentService, 'deleteStudent').mockResolvedValueOnce();

      const res = await request(app)
        .delete(`/api/v1/schools/${schoolIdA}/students/${studentIdA}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Student removed successfully');
      expect(spy).toHaveBeenCalledWith(
        schoolIdA,
        studentIdA,
        adminUserA.id,
        expect.anything()
      );
    });

    it('rejects transport coordinator from deleting student with 403', async () => {
      const token = AuthService.generateToken(coordinatorUserA);

      const res = await request(app)
        .delete(`/api/v1/schools/${schoolIdA}/students/${studentIdA}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('rejects cross-tenant deletion attempt with 403', async () => {
      const token = AuthService.generateToken(adminUserA); // schoolIdA

      const res = await request(app)
        .delete(`/api/v1/schools/${schoolIdB}/students/${studentIdA}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });
  });

  describe('4. GET /api/v1/schools/:schoolId/students/:studentId/transport-history', () => {
    it('returns chronological boarding and drop-off records with summary', async () => {
      const token = AuthService.generateToken(adminUserA);
      const spy = vi.spyOn(StudentService, 'getStudentTransportHistory').mockResolvedValueOnce(mockHistoryResponse);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/students/${studentIdA}/transport-history`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.summary.totalBoarded).toBe(12);
      expect(res.body.data.history).toHaveLength(2);
      expect(res.body.data.history[0].busNumber).toBe('BUS-01');
      expect(res.body.data.history[0].eventType).toBe('BOARDED');
      expect(spy).toHaveBeenCalledWith(schoolIdA, studentIdA, 50);
    });

    it('returns 404 when student does not exist', async () => {
      const token = AuthService.generateToken(adminUserA);
      vi.spyOn(StudentService, 'getStudentTransportHistory').mockRejectedValueOnce(
        new NotFoundError('Student record not found or does not belong to your school.')
      );

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/students/${studentIdA}/transport-history`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });
});
