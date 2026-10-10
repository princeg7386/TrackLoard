import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { StudentService } from '../src/services/student.service.js';
import { AuthService } from '../src/services/auth.service.js';
import { UserRole, StudentWithDetails, RouteWithStopsOption } from '@school-bus/shared';
import { NotFoundError } from '../src/middlewares/error.middleware.js';

describe('Student Transport & Bus/Stop Assignment (Micro-phase 8.3)', () => {
  const app = createApp();

  const schoolIdA = '111e4567-e89b-12d3-a456-426614174001';
  const schoolIdB = '999e4567-e89b-12d3-a456-426614174999';
  const studentIdA = '33333333-e89b-12d3-a456-426614174001';
  const routeIdA = '44444444-e89b-12d3-a456-426614174001';
  const busIdA = '55555555-e89b-12d3-a456-426614174001';
  const pickupStopIdA = '66666666-e89b-12d3-a456-426614174001';
  const dropStopIdA = '66666666-e89b-12d3-a456-426614174002';

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

  const mockTransportOptions: RouteWithStopsOption[] = [
    {
      routeId: routeIdA,
      routeName: 'North Campus Express',
      routeCode: 'R-01',
      busId: busIdA,
      busNumber: 'BUS-01',
      busRegistrationNumber: 'DL 01 AB 1234',
      stops: [
        {
          id: pickupStopIdA,
          name: 'Sector 14 Main Gate',
          stopOrder: 1,
          morningPickupTime: '07:15',
          eveningDropTime: '15:45',
        },
        {
          id: dropStopIdA,
          name: 'Sector 16 Market',
          stopOrder: 2,
          morningPickupTime: '07:25',
          eveningDropTime: '15:35',
        },
      ],
    },
  ];

  const mockAssignedStudent: StudentWithDetails = {
    id: studentIdA,
    schoolId: schoolIdA,
    fullName: 'Aarav Sharma',
    admissionNumber: 'ADM-2026-0042',
    classGrade: 'Class 5',
    section: 'A',
    rollNumber: '14',
    emergencyContactPhone: '+919876543299',
    routeId: routeIdA,
    routeName: 'North Campus Express',
    routeCode: 'R-01',
    assignedBusId: busIdA,
    assignedBusNumber: 'BUS-01',
    assignedBusRegistrationNumber: 'DL 01 AB 1234',
    pickupStopId: pickupStopIdA,
    pickupStopName: 'Sector 14 Main Gate',
    pickupScheduledTime: '07:15',
    dropStopId: dropStopIdA,
    dropStopName: 'Sector 16 Market',
    dropScheduledTime: '15:35',
    transportStatus: 'ASSIGNED',
    parentCount: 0,
    parents: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockUnassignedStudent: StudentWithDetails = {
    ...mockAssignedStudent,
    routeId: null,
    routeName: null,
    routeCode: null,
    assignedBusId: null,
    assignedBusNumber: null,
    assignedBusRegistrationNumber: null,
    pickupStopId: null,
    pickupStopName: null,
    pickupScheduledTime: null,
    dropStopId: null,
    dropStopName: null,
    dropScheduledTime: null,
    transportStatus: 'UNASSIGNED',
  };

  describe('1. GET /api/v1/schools/:schoolId/students/transport-options', () => {
    it('returns list of routes and linked stops for school', async () => {
      const token = AuthService.generateToken(adminUserA);
      const spy = vi.spyOn(StudentService, 'getTransportOptions').mockResolvedValueOnce(mockTransportOptions);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/students/transport-options`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].routeCode).toBe('R-01');
      expect(res.body.data[0].stops).toHaveLength(2);
      expect(spy).toHaveBeenCalledWith(schoolIdA);
    });

    it('rejects cross-tenant access to transport-options with 403', async () => {
      const token = AuthService.generateToken(adminUserA); // schoolIdA

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdB}/students/transport-options`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });
  });

  describe('2. PUT /api/v1/schools/:schoolId/students/:studentId/transport (Assign / Unassign)', () => {
    it('allows school admin to assign pickup and drop stops', async () => {
      const token = AuthService.generateToken(adminUserA);
      const spy = vi.spyOn(StudentService, 'assignTransport').mockResolvedValueOnce(mockAssignedStudent);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/students/${studentIdA}/transport`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          pickupStopId: pickupStopIdA,
          dropStopId: dropStopIdA,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.transportStatus).toBe('ASSIGNED');
      expect(res.body.data.assignedBusNumber).toBe('BUS-01');
      expect(res.body.data.pickupStopName).toBe('Sector 14 Main Gate');
      expect(spy).toHaveBeenCalledWith(
        schoolIdA,
        studentIdA,
        { pickupStopId: pickupStopIdA, dropStopId: dropStopIdA },
        adminUserA.id,
        expect.anything()
      );
    });

    it('allows transport coordinator to assign transport', async () => {
      const token = AuthService.generateToken(coordinatorUserA);
      vi.spyOn(StudentService, 'assignTransport').mockResolvedValueOnce(mockAssignedStudent);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/students/${studentIdA}/transport`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          pickupStopId: pickupStopIdA,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('allows unassigning transport by sending null pickup and drop stop IDs', async () => {
      const token = AuthService.generateToken(adminUserA);
      const spy = vi.spyOn(StudentService, 'assignTransport').mockResolvedValueOnce(mockUnassignedStudent);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/students/${studentIdA}/transport`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          pickupStopId: null,
          dropStopId: null,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.transportStatus).toBe('UNASSIGNED');
      expect(res.body.data.assignedBusId).toBeNull();
      expect(spy).toHaveBeenCalledWith(
        schoolIdA,
        studentIdA,
        { pickupStopId: null, dropStopId: null },
        adminUserA.id,
        expect.anything()
      );
    });

    it('rejects unauthorized driver role with 403', async () => {
      const token = AuthService.generateToken(driverUserA);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/students/${studentIdA}/transport`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          pickupStopId: pickupStopIdA,
        });

      expect(res.status).toBe(403);
    });

    it('rejects invalid uuid in pickupStopId with 422 validation error', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/students/${studentIdA}/transport`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          pickupStopId: 'not-a-uuid',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when student or stop is not found', async () => {
      const token = AuthService.generateToken(adminUserA);
      vi.spyOn(StudentService, 'assignTransport').mockRejectedValueOnce(
        new NotFoundError('Pickup stop not found or does not belong to this school')
      );

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/students/${studentIdA}/transport`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          pickupStopId: '12345678-e89b-12d3-a456-426614174099',
        });

      expect(res.status).toBe(404);
      expect(res.body.error.message).toContain('Pickup stop not found');
    });

    it('enforces tenant isolation across schools with 403', async () => {
      const token = AuthService.generateToken(adminUserA); // schoolIdA

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdB}/students/${studentIdA}/transport`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          pickupStopId: pickupStopIdA,
        });

      expect(res.status).toBe(403);
    });
  });
});
