import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { BusService } from '../src/services/bus.service.js';
import { AuthService } from '../src/services/auth.service.js';
import { UserRole, BusDetailView } from '@school-bus/shared';
import { BadRequestError, ConflictError } from '../src/middlewares/error.middleware.js';

describe('Bus Details, Edit & Remove (Micro-phase 6.3)', () => {
  const app = createApp();

  const schoolIdA = '111e4567-e89b-12d3-a456-426614174001';
  const schoolIdB = '999e4567-e89b-12d3-a456-426614174999';
  const busIdA = '11111111-e89b-12d3-a456-426614174001';
  const driverIdA = '22222222-e89b-12d3-a456-426614174001';
  const routeIdA = '33333333-e89b-12d3-a456-426614174001';

  const adminUserA = {
    id: 'aaa11111-e89b-12d3-a456-426614174001',
    schoolId: schoolIdA,
    email: 'admin.a@dpa.edu.in',
    fullName: 'Principal Sharma',
    role: UserRole.SCHOOL_ADMIN,
  };

  const mockBusDetail: BusDetailView = {
    id: busIdA,
    schoolId: schoolIdA,
    busNumber: 'Bus-01',
    registrationNumber: 'DL-01-AB-1234',
    makeModel: 'Tata Starbus 32',
    deviceIdentifier: 'IMEI-9988776655',
    defaultDriverId: driverIdA,
    driverName: 'Ramesh Kumar',
    driverPhone: '+919876543210',
    driverLicenseNumber: 'DL-RTO-2022-9901',
    assignedRouteId: routeIdA,
    assignedRouteName: 'North Campus Morning Express',
    assignedRouteCode: 'NC-AM-01',
    assignedRouteType: 'MORNING_PICKUP',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentLocation: {
      latitude: 28.5355,
      longitude: 77.1555,
      speedKmh: 28.5,
      bearingDegrees: 135,
      accuracyMeters: 4.2,
      recordedAt: new Date().toISOString(),
    },
    currentTrip: {
      id: 'trip-11111111-e89b-12d3-a456-426614174001',
      routeId: routeIdA,
      routeName: 'North Campus Morning Express',
      routeCode: 'NC-AM-01',
      routeType: 'MORNING_PICKUP',
      status: 'IN_PROGRESS',
      scheduledStartTime: new Date().toISOString(),
      actualStartTime: new Date().toISOString(),
      currentStopSequence: 3,
      delayMinutes: 2,
    },
  };

  describe('1. GET /api/v1/schools/:schoolId/buses/:busId (View Bus Details)', () => {
    it('returns 200 OK with full vehicle telemetry, driver info, and active trip', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi
        .spyOn(BusService, 'getBusDetail')
        .mockResolvedValueOnce(mockBusDetail);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/buses/${busIdA}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.busNumber).toBe('Bus-01');
      expect(res.body.data.currentLocation.latitude).toBe(28.5355);
      expect(res.body.data.currentTrip.status).toBe('IN_PROGRESS');
      expect(res.body.data.driverName).toBe('Ramesh Kumar');

      spy.mockRestore();
    });

    it('rejects cross-tenant access with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdB}/buses/${busIdA}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
    });
  });

  describe('2. PUT /api/v1/schools/:schoolId/buses/:busId (Edit Bus)', () => {
    it('successfully updates bus specifications and returns 200 OK', async () => {
      const token = AuthService.generateToken(adminUserA);

      const updated = {
        ...mockBusDetail,
        busNumber: 'Bus-01 Premium',
        makeModel: 'Tata Starbus Ultra 36',
      };

      const spy = vi.spyOn(BusService, 'updateBus').mockResolvedValueOnce(updated);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/buses/${busIdA}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          busNumber: 'Bus-01 Premium',
          makeModel: 'Tata Starbus Ultra 36',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.busNumber).toBe('Bus-01 Premium');
      expect(res.body.data.makeModel).toBe('Tata Starbus Ultra 36');

      spy.mockRestore();
    });

    it('rejects duplicate registration number during update with 409 Conflict', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi.spyOn(BusService, 'updateBus').mockRejectedValueOnce(
        new ConflictError('Vehicle registration number "DL-01-AB-9999" is already registered to another bus.')
      );

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/buses/${busIdA}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          registrationNumber: 'DL-01-AB-9999',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ConflictError');

      spy.mockRestore();
    });
  });

  describe('3. DELETE /api/v1/schools/:schoolId/buses/:busId (Remove Bus)', () => {
    it('successfully soft-deletes bus when no active trip is in progress', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi.spyOn(BusService, 'deleteBus').mockResolvedValueOnce({
        success: true,
        message: 'Vehicle Bus-01 (DL-01-AB-1234) was removed from your fleet.',
      });

      const res = await request(app)
        .delete(`/api/v1/schools/${schoolIdA}/buses/${busIdA}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('removed');

      spy.mockRestore();
    });

    it('rejects removal with 400 Bad Request when an active trip is currently in progress', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi.spyOn(BusService, 'deleteBus').mockRejectedValueOnce(
        new BadRequestError('Cannot remove vehicle while an active trip is currently in progress.')
      );

      const res = await request(app)
        .delete(`/api/v1/schools/${schoolIdA}/buses/${busIdA}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('BadRequestError');
      expect(res.body.error.message).toContain('active trip is currently in progress');

      spy.mockRestore();
    });

    it('rejects cross-tenant bus deletion with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .delete(`/api/v1/schools/${schoolIdB}/buses/${busIdA}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
    });
  });
});
