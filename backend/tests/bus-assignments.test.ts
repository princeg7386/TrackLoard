import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { BusService } from '../src/services/bus.service.js';
import { DriverService } from '../src/services/driver.service.js';
import { AuthService } from '../src/services/auth.service.js';
import { UserRole, BusWithDriver, Driver, Route } from '@school-bus/shared';
import { BadRequestError } from '../src/middlewares/error.middleware.js';

describe('Bus Assignments (Micro-phase 6.2: Driver & Route Pairing)', () => {
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

  const mockBusWithAssignments: BusWithDriver = {
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
  };

  describe('PUT /api/v1/schools/:schoolId/buses/:busId/assignments', () => {
    it('successfully assigns both driver and route to bus and returns 200 OK', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi
        .spyOn(BusService, 'assignDriverAndRoute')
        .mockResolvedValueOnce(mockBusWithAssignments);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/buses/${busIdA}/assignments`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          driverId: driverIdA,
          routeId: routeIdA,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.defaultDriverId).toBe(driverIdA);
      expect(res.body.data.driverName).toBe('Ramesh Kumar');
      expect(res.body.data.assignedRouteId).toBe(routeIdA);
      expect(res.body.data.assignedRouteName).toBe('North Campus Morning Express');
      expect(res.body.message).toContain('successfully');

      spy.mockRestore();
    });

    it('successfully unassigns driver or route when passed null', async () => {
      const token = AuthService.generateToken(adminUserA);

      const unassignedBus: BusWithDriver = {
        ...mockBusWithAssignments,
        defaultDriverId: null,
        driverName: null,
        assignedRouteId: null,
        assignedRouteName: null,
      };

      const spy = vi
        .spyOn(BusService, 'assignDriverAndRoute')
        .mockResolvedValueOnce(unassignedBus);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/buses/${busIdA}/assignments`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          driverId: null,
          routeId: null,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.defaultDriverId).toBeNull();
      expect(res.body.data.assignedRouteId).toBeNull();

      spy.mockRestore();
    });

    it('rejects cross-tenant driver assignment with 400 Bad Request', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi.spyOn(BusService, 'assignDriverAndRoute').mockRejectedValueOnce(
        new BadRequestError('Selected driver does not exist or does not belong to this school.')
      );

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/buses/${busIdA}/assignments`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          driverId: '88888888-e89b-12d3-a456-426614174999',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('BadRequestError');
      expect(res.body.error.message).toContain('belong to this school');

      spy.mockRestore();
    });

    it('rejects cross-tenant route assignment with 400 Bad Request', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi.spyOn(BusService, 'assignDriverAndRoute').mockRejectedValueOnce(
        new BadRequestError('Selected route does not exist or does not belong to this school.')
      );

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/buses/${busIdA}/assignments`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          routeId: '99999999-e89b-12d3-a456-426614174999',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('BadRequestError');

      spy.mockRestore();
    });

    it('rejects cross-tenant access to another school with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdB}/buses/${busIdA}/assignments`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          driverId: driverIdA,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
    });

    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/buses/${busIdA}/assignments`)
        .send({
          driverId: driverIdA,
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/schools/:schoolId/drivers & /routes dropdown helpers', () => {
    it('returns list of drivers for school tenant', async () => {
      const token = AuthService.generateToken(adminUserA);

      const mockDrivers: Driver[] = [
        {
          id: driverIdA,
          schoolId: schoolIdA,
          fullName: 'Ramesh Kumar',
          phone: '+919876543210',
          licenseNumber: 'DL-RTO-2022-9901',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const spy = vi.spyOn(DriverService, 'getDrivers').mockResolvedValueOnce(mockDrivers as any);
      const busSpy = vi.spyOn(BusService, 'getDrivers').mockResolvedValueOnce(mockDrivers);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/drivers`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].fullName).toBe('Ramesh Kumar');

      spy.mockRestore();
      busSpy.mockRestore();
    });

    it('returns list of routes for school tenant', async () => {
      const token = AuthService.generateToken(adminUserA);

      const mockRoutes: Route[] = [
        {
          id: routeIdA,
          schoolId: schoolIdA,
          name: 'North Campus Morning Express',
          code: 'NC-AM-01',
          routeType: 'MORNING_PICKUP' as any,
          defaultBusId: busIdA,
          defaultDriverId: driverIdA,
          estimatedDurationMinutes: 45,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const spy = vi.spyOn(BusService, 'getRoutes').mockResolvedValueOnce(mockRoutes);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/routes`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].name).toBe('North Campus Morning Express');

      spy.mockRestore();
    });
  });
});
