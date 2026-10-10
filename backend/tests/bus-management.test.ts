import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { BusService } from '../src/services/bus.service.js';
import { AuthService } from '../src/services/auth.service.js';
import { UserRole, BusWithDriver } from '@school-bus/shared';
import { ConflictError, NotFoundError } from '../src/middlewares/error.middleware.js';

describe('Bus & Fleet Management (Micro-phase 6.1: Create Bus)', () => {
  const app = createApp();

  const schoolIdA = '111e4567-e89b-12d3-a456-426614174001';
  const schoolIdB = '999e4567-e89b-12d3-a456-426614174999';

  const adminUserA = {
    id: 'aaa11111-e89b-12d3-a456-426614174001',
    schoolId: schoolIdA,
    email: 'admin.a@dpa.edu.in',
    fullName: 'Principal Sharma',
    role: UserRole.SCHOOL_ADMIN,
  };

  const coordinatorUserA = {
    id: 'aaa22222-e89b-12d3-a456-426614174002',
    schoolId: schoolIdA,
    email: 'coord.a@dpa.edu.in',
    fullName: 'Transport Coordinator',
    role: UserRole.TRANSPORT_COORDINATOR,
  };

  const mockCreatedBus: BusWithDriver = {
    id: 'bus-11111-e89b-12d3-a456-426614174001',
    schoolId: schoolIdA,
    busNumber: 'Bus-01',
    registrationNumber: 'DL-01-AB-1234',
    makeModel: 'Tata Starbus 32',
    deviceIdentifier: 'IMEI-9988776655',
    defaultDriverId: null,
    driverName: null,
    driverPhone: null,
    driverLicenseNumber: null,
    assignedRouteName: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  describe('1. POST /api/v1/schools/:schoolId/buses (Create Bus)', () => {
    it('creates a bus successfully with valid Indian registration and returns 201 Created', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi
        .spyOn(BusService, 'createBus')
        .mockResolvedValueOnce(mockCreatedBus);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/buses`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          busNumber: 'Bus-01',
          registrationNumber: 'DL-01-AB-1234',
          makeModel: 'Tata Starbus 32',
          deviceIdentifier: 'IMEI-9988776655',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.busNumber).toBe('Bus-01');
      expect(res.body.data.registrationNumber).toBe('DL-01-AB-1234');
      expect(res.body.message).toContain('successfully');

      spy.mockRestore();
    });

    it('allows transport coordinator to register a bus', async () => {
      const token = AuthService.generateToken(coordinatorUserA);

      const spy = vi
        .spyOn(BusService, 'createBus')
        .mockResolvedValueOnce(mockCreatedBus);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/buses`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          busNumber: 'Bus-01',
          registrationNumber: 'DL 01 AB 1234',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      spy.mockRestore();
    });

    it('rejects duplicate registration number with 409 Conflict', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi.spyOn(BusService, 'createBus').mockRejectedValueOnce(
        new ConflictError(
          'Vehicle with registration number "DL-01-AB-1234" is already registered in your fleet.'
        )
      );

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/buses`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          busNumber: 'Bus-02',
          registrationNumber: 'DL-01-AB-1234',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ConflictError');
      expect(res.body.error.message).toContain('already registered');

      spy.mockRestore();
    });

    it('rejects invalid Indian vehicle registration format with 422 Validation Error', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/buses`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          busNumber: 'Bus-01',
          registrationNumber: 'INVALID-XYZ',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects missing busNumber with 422 Validation Error', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/buses`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          registrationNumber: 'DL-01-AB-1234',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('rejects cross-tenant bus creation to another school with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdB}/buses`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          busNumber: 'Bus-01',
          registrationNumber: 'DL-01-AB-1234',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
    });

    it('rejects unauthenticated request with 401 Unauthorized', async () => {
      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/buses`)
        .send({
          busNumber: 'Bus-01',
          registrationNumber: 'DL-01-AB-1234',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. GET /api/v1/schools/:schoolId/buses (List Buses)', () => {
    it('returns 200 OK with list of buses for authorized tenant', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi
        .spyOn(BusService, 'getBuses')
        .mockResolvedValueOnce([mockCreatedBus]);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/buses`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].busNumber).toBe('Bus-01');

      spy.mockRestore();
    });

    it('rejects cross-tenant listing with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdB}/buses`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
    });
  });

  describe('3. GET /api/v1/schools/:schoolId/buses/:busId (Get Bus Details)', () => {
    it('returns 200 OK with single bus details', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi
        .spyOn(BusService, 'getBusById')
        .mockResolvedValueOnce(mockCreatedBus);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/buses/${mockCreatedBus.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.registrationNumber).toBe('DL-01-AB-1234');

      spy.mockRestore();
    });

    it('returns 404 when bus does not exist', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi
        .spyOn(BusService, 'getBusById')
        .mockRejectedValueOnce(new NotFoundError('Vehicle not found'));

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/buses/non-existent-id`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);

      spy.mockRestore();
    });
  });
});
