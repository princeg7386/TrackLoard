import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { DriverService } from '../src/services/driver.service.js';
import { AuthService } from '../src/services/auth.service.js';
import { UserRole, DriverWithBus } from '@school-bus/shared';
import { ConflictError, BadRequestError } from '../src/middlewares/error.middleware.js';

describe('Driver Profile & Credentials (Micro-phase 7.4: View, Edit & Credential Controls)', () => {
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

  describe('1. PUT /api/v1/schools/:schoolId/drivers/:driverId (Edit Profile)', () => {
    it('successfully updates driver details', async () => {
      const token = AuthService.generateToken(adminUserA);

      const updatedDriver: DriverWithBus = {
        ...mockDriver,
        fullName: 'Ramesh Kumar Sharma',
        licenseExpiry: '2029-06-30',
      };

      const spy = vi.spyOn(DriverService, 'updateDriver').mockResolvedValueOnce(updatedDriver);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/drivers/${driverIdA}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          fullName: 'Ramesh Kumar Sharma',
          licenseExpiry: '2029-06-30',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fullName).toBe('Ramesh Kumar Sharma');
      expect(res.body.message).toBe('Driver profile updated successfully');

      spy.mockRestore();
    });

    it('rejects duplicate phone number with 409 Conflict', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi.spyOn(DriverService, 'updateDriver').mockRejectedValueOnce(
        new ConflictError('Another driver in your school is already registered with mobile number "+919876543210".')
      );

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/drivers/${driverIdA}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          phone: '9876543210',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ConflictError');

      spy.mockRestore();
    });

    it('rejects cross-tenant driver update with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdB}/drivers/${driverIdA}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'Ramesh Kumar' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
    });
  });

  describe('2. POST /api/v1/schools/:schoolId/drivers/:driverId/reset-pin (Reset PIN)', () => {
    it('successfully resets driver login PIN', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi.spyOn(DriverService, 'resetDriverPin').mockResolvedValueOnce();

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/drivers/${driverIdA}/reset-pin`)
        .set('Authorization', `Bearer ${token}`)
        .send({ pin: '5678' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Driver login PIN reset successfully');

      spy.mockRestore();
    });

    it('rejects invalid PIN format (<4 or >6 digits) with 422 Unprocessable Entity', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/drivers/${driverIdA}/reset-pin`)
        .set('Authorization', `Bearer ${token}`)
        .send({ pin: '12' });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('rejects cross-tenant PIN reset with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdB}/drivers/${driverIdA}/reset-pin`)
        .set('Authorization', `Bearer ${token}`)
        .send({ pin: '1234' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('3. POST /api/v1/schools/:schoolId/drivers/:driverId/revoke-sessions (Revoke Sessions)', () => {
    it('successfully revokes driver mobile sessions', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi.spyOn(DriverService, 'revokeDriverSessions').mockResolvedValueOnce();

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/drivers/${driverIdA}/revoke-sessions`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Driver sessions revoked successfully');

      spy.mockRestore();
    });

    it('rejects cross-tenant session revocation with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdB}/drivers/${driverIdA}/revoke-sessions`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('4. DELETE /api/v1/schools/:schoolId/drivers/:driverId (Remove Driver)', () => {
    it('successfully soft-deletes driver and unbinds from bus', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi.spyOn(DriverService, 'removeDriver').mockResolvedValueOnce();

      const res = await request(app)
        .delete(`/api/v1/schools/${schoolIdA}/drivers/${driverIdA}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Driver profile removed successfully');

      spy.mockRestore();
    });

    it('rejects cross-tenant driver deletion with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .delete(`/api/v1/schools/${schoolIdB}/drivers/${driverIdA}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });
});
