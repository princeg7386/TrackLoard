import { describe, it, expect, vi } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from '../src/app.js';
import { DriverAuthService } from '../src/services/driver-auth.service.js';
import {
  authenticateDriver,
  requireAssignedBus,
} from '../src/middlewares/driver-auth.middleware.js';
import { errorHandler } from '../src/middlewares/error.middleware.js';
import { UserRole } from '@school-bus/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Driver Authentication & Assigned Bus Authorization', () => {
  const app = createApp();

  const mockDriverPayload = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    schoolId: '223e4567-e89b-12d3-a456-426614174001',
    phone: '+919876543210',
    fullName: 'Ramesh Kumar Singh',
    role: UserRole.DRIVER as const,
    assignedBusId: '323e4567-e89b-12d3-a456-426614174002',
  };

  it('generates and verifies driver-scoped JWT tokens correctly', () => {
    const token = DriverAuthService.generateDriverToken(mockDriverPayload);
    expect(token).toBeDefined();

    const decoded = DriverAuthService.verifyDriverToken(token);
    expect(decoded.id).toBe(mockDriverPayload.id);
    expect(decoded.phone).toBe(mockDriverPayload.phone);
    expect(decoded.role).toBe(UserRole.DRIVER);
    expect(decoded.assignedBusId).toBe(mockDriverPayload.assignedBusId);
  });

  it('POST /api/v1/driver/auth/login validates required phone number', async () => {
    const res = await request(app).post('/api/v1/driver/auth/login').send({});
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/v1/driver/auth/logout returns 200 OK', async () => {
    const res = await request(app).post('/api/v1/driver/auth/logout').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.loggedOut).toBe(true);
  });

  it('GET /api/v1/driver/auth/me requires valid Driver Bearer token', async () => {
    // 1. Missing token -> 401
    const resNoAuth = await request(app).get('/api/v1/driver/auth/me');
    expect(resNoAuth.status).toBe(401);
    expect(resNoAuth.body.error.code).toBe('UnauthorizedError');

    // 2. Valid token with mocked profile resolution
    const token = DriverAuthService.generateDriverToken(mockDriverPayload);
    const getProfileSpy = vi
      .spyOn(DriverAuthService, 'getDriverProfile')
      .mockResolvedValueOnce({
        driver: mockDriverPayload,
        assignedBus: {
          id: '323e4567-e89b-12d3-a456-426614174002',
          registrationNumber: 'DL-01-AB-1234',
          busNumber: 'Bus 04 (South Route)',
        },
        activeTrip: null,
        todayTrips: [],
      });

    const resAuth = await request(app)
      .get('/api/v1/driver/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(resAuth.status).toBe(200);
    expect(resAuth.body.success).toBe(true);
    expect(resAuth.body.data.driver.phone).toBe('+919876543210');
    expect(resAuth.body.data.assignedBus.registrationNumber).toBe('DL-01-AB-1234');

    getProfileSpy.mockRestore();
  });

  it('requireAssignedBus middleware authorizes assigned driver and rejects unassigned driver', async () => {
    const testApp = express();
    testApp.use(express.json());

    testApp.post(
      '/api/v1/test-bus/:busId/telemetry',
      authenticateDriver,
      requireAssignedBus('params', 'busId'),
      (_req: Request, res: Response) => {
        res.json({ success: true, message: 'Authorized to transmit telemetry for bus' });
      }
    );

    testApp.use(errorHandler);

    const token = DriverAuthService.generateDriverToken(mockDriverPayload);
    const assignedBusId = '323e4567-e89b-12d3-a456-426614174002';
    const unassignedBusId = '999e4567-e89b-12d3-a456-426614174999';

    // Mock verifyAssignedBus
    const verifySpy = vi
      .spyOn(DriverAuthService, 'verifyAssignedBus')
      .mockImplementation(async (_driverId, busId) => busId === assignedBusId);

    // 1. Authorized access to assigned bus
    const authRes = await request(testApp)
      .post(`/api/v1/test-bus/${assignedBusId}/telemetry`)
      .set('Authorization', `Bearer ${token}`);

    expect(authRes.status).toBe(200);
    expect(authRes.body.success).toBe(true);

    // 2. Forbidden access to unassigned bus
    const unauthRes = await request(testApp)
      .post(`/api/v1/test-bus/${unassignedBusId}/telemetry`)
      .set('Authorization', `Bearer ${token}`);

    expect(unauthRes.status).toBe(403);
    expect(unauthRes.body.success).toBe(false);
    expect(unauthRes.body.error.code).toBe('ForbiddenError');
    expect(unauthRes.body.error.message).toContain('not assigned to operate Bus ID');

    verifySpy.mockRestore();
  });

  it('verifies migration 006_driver_auth_credentials.sql exists and contains required fields', () => {
    const migrationPath = path.join(
      __dirname,
      '../src/db/migrations/006_driver_auth_credentials.sql'
    );
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('pin_hash');
    expect(sql).toContain('last_active_at');
  });
});
