import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { DriverService } from '../src/services/driver.service.js';
import { AuthService } from '../src/services/auth.service.js';
import { UserRole, DriverWithBus } from '@school-bus/shared';
import { ConflictError, BadRequestError } from '../src/middlewares/error.middleware.js';

describe('Driver Management (Micro-phase 7.1: Create Driver)', () => {
  const app = createApp();

  const schoolIdA = '111e4567-e89b-12d3-a456-426614174001';
  const schoolIdB = '999e4567-e89b-12d3-a456-426614174999';
  const driverIdA = '22222222-e89b-12d3-a456-426614174001';
  const busIdA = '11111111-e89b-12d3-a456-426614174001';

  const adminUserA = {
    id: 'aaa11111-e89b-12d3-a456-426614174001',
    schoolId: schoolIdA,
    email: 'admin.a@dpa.edu.in',
    fullName: 'Principal Sharma',
    role: UserRole.SCHOOL_ADMIN,
  };

  const mockDriver: DriverWithBus = {
    id: driverIdA,
    schoolId: schoolIdA,
    fullName: 'Ramesh Kumar',
    phone: '+919876543210',
    licenseNumber: 'DL-RTO-2022-9901',
    licenseExpiry: '2028-12-31',
    photoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d',
    assignedBusId: busIdA,
    assignedBusNumber: 'Bus-01',
    assignedRegistrationNumber: 'DL-01-AB-1234',
    assignedRouteName: 'North Campus Morning Express',
    assignedRouteCode: 'NC-AM-01',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  describe('1. POST /api/v1/schools/:schoolId/drivers (Create Driver)', () => {
    it('successfully registers a new driver with hashed PIN and bus pairing', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi.spyOn(DriverService, 'createDriver').mockResolvedValueOnce(mockDriver);

      const payload = {
        fullName: 'Ramesh Kumar',
        phone: '9876543210',
        licenseNumber: 'DL-RTO-2022-9901',
        licenseExpiry: '2028-12-31',
        pin: '1234',
        photoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d',
        assignedBusId: busIdA,
      };

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/drivers`)
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fullName).toBe('Ramesh Kumar');
      expect(res.body.data.phone).toBe('+919876543210');
      expect(res.body.data.assignedBusNumber).toBe('Bus-01');

      spy.mockRestore();
    });

    it('rejects duplicate mobile number with 409 Conflict', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi.spyOn(DriverService, 'createDriver').mockRejectedValueOnce(
        new ConflictError('Driver with mobile number "+919876543210" is already registered in your school.')
      );

      const payload = {
        fullName: 'Ramesh Kumar',
        phone: '9876543210',
        licenseNumber: 'DL-RTO-2022-9901',
      };

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/drivers`)
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ConflictError');

      spy.mockRestore();
    });

    it('rejects non-existent assigned bus with 400 Bad Request', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi.spyOn(DriverService, 'createDriver').mockRejectedValueOnce(
        new BadRequestError('Selected fleet vehicle does not exist or belongs to another school.')
      );

      const payload = {
        fullName: 'Ramesh Kumar',
        phone: '9876543210',
        licenseNumber: 'DL-RTO-2022-9901',
        assignedBusId: '99999999-e89b-12d3-a456-426614174999',
      };

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/drivers`)
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('BadRequestError');

      spy.mockRestore();
    });

    it('rejects cross-tenant driver creation with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdB}/drivers`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          fullName: 'Ramesh Kumar',
          phone: '9876543210',
          licenseNumber: 'DL-RTO-2022-9901',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
    });

    it('validates schema and rejects invalid payload with 422 Unprocessable Entity', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/drivers`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          fullName: 'A', // too short
          phone: '123', // invalid phone
          licenseNumber: '', // required
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. GET /api/v1/schools/:schoolId/drivers (List Drivers)', () => {
    it('returns 200 OK with list of drivers and assigned bus info', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi.spyOn(DriverService, 'getDrivers').mockResolvedValueOnce([mockDriver]);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/drivers`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].fullName).toBe('Ramesh Kumar');

      spy.mockRestore();
    });

    it('rejects cross-tenant listing with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdB}/drivers`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
    });
  });

  describe('3. GET /api/v1/schools/:schoolId/drivers/:driverId (Get Driver Detail)', () => {
    it('returns 200 OK with single driver profile', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi.spyOn(DriverService, 'getDriverById').mockResolvedValueOnce(mockDriver);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/drivers/${driverIdA}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fullName).toBe('Ramesh Kumar');

      spy.mockRestore();
    });

    it('rejects cross-tenant get driver with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdB}/drivers/${driverIdA}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
    });
  });

  describe('4. PUT /api/v1/schools/:schoolId/drivers/:driverId/assignments (Assign / Unassign Bus)', () => {
    it('successfully pairs a bus to a driver', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi.spyOn(DriverService, 'assignBus').mockResolvedValueOnce(mockDriver);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/drivers/${driverIdA}/assignments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ busId: busIdA });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Driver bus assignment updated successfully');
      expect(res.body.data.assignedBusId).toBe(busIdA);
      expect(res.body.data.assignedBusNumber).toBe('Bus-01');

      spy.mockRestore();
    });

    it('successfully unassigns a bus from a driver (busId: null)', async () => {
      const token = AuthService.generateToken(adminUserA);

      const unassignedDriver: DriverWithBus = {
        ...mockDriver,
        assignedBusId: null,
        assignedBusNumber: null,
        assignedRegistrationNumber: null,
        assignedRouteId: null,
        assignedRouteName: null,
        assignedRouteCode: null,
      };

      const spy = vi.spyOn(DriverService, 'assignBus').mockResolvedValueOnce(unassignedDriver);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/drivers/${driverIdA}/assignments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ busId: null });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.assignedBusId).toBeNull();
      expect(res.body.data.assignedBusNumber).toBeNull();

      spy.mockRestore();
    });

    it('rejects invalid bus UUID with 422 Unprocessable Entity', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/drivers/${driverIdA}/assignments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ busId: 'not-a-valid-uuid' });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('rejects non-existent bus with 400 Bad Request', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi.spyOn(DriverService, 'assignBus').mockRejectedValueOnce(
        new BadRequestError('Selected fleet vehicle does not exist or belongs to another school.')
      );

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/drivers/${driverIdA}/assignments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ busId: '33333333-e89b-12d3-a456-426614174001' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('BadRequestError');

      spy.mockRestore();
    });

    it('rejects cross-tenant driver assignment with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdB}/drivers/${driverIdA}/assignments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ busId: busIdA });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
    });
  });
});

