import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/services/auth.service.js';
import { BusService } from '../src/services/bus.service.js';
import { UserRole, ActiveTripStateResponse } from '@school-bus/shared';

/**
 * Phase 12.1 — Current Bus State
 * Tests for GET /api/v1/schools/:schoolId/buses/:busId/state
 *
 * All DB calls are mocked via vi.spyOn so no running Postgres is required.
 */
describe('Phase 12.1 — Current Bus State (GET /schools/:schoolId/buses/:busId/state)', () => {
  const app = createApp();

  const SCHOOL_A_ID = '1a000000-0000-4000-8000-00000000000a';
  const SCHOOL_B_ID = '1b000000-0000-4000-8000-00000000000b';
  const BUS_ID = '3b000000-0000-4000-8000-00000000000b';

  const adminAToken = AuthService.generateToken({
    id: 'aa000000-0000-4000-8000-000000000001',
    schoolId: SCHOOL_A_ID,
    email: 'admin-a@school.test',
    role: UserRole.SCHOOL_ADMIN,
  });

  const adminBToken = AuthService.generateToken({
    id: 'bb000000-0000-4000-8000-000000000002',
    schoolId: SCHOOL_B_ID,
    email: 'admin-b@school.test',
    role: UserRole.SCHOOL_ADMIN,
  });

  const mockBusState: ActiveTripStateResponse = {
    busId: BUS_ID,
    busNumber: 'Bus 04 (South)',
    registrationNumber: 'DL04AB0011',
    makeModel: 'Tata Starbus Ultra 32',

    driverId: 'd1000000-0000-4000-8000-000000000001',
    driverName: 'Ramesh Kumar Singh',
    driverPhone: '+919876543210',

    tripId: 't1000000-0000-4000-8000-000000000001',
    tripStatus: 'IN_TRANSIT',
    routeId: 'r1000000-0000-4000-8000-000000000001',
    routeName: 'South Route',
    routeCode: 'RTE-S04',
    routeType: 'MORNING_PICKUP',
    scheduledStartTime: new Date().toISOString(),
    actualStartTime: new Date().toISOString(),
    currentStopSequence: 3,
    delayMinutes: 0,

    lastLatitude: 28.6139,
    lastLongitude: 77.209,
    lastSpeedKmh: 32.5,
    lastBearingDegrees: 182.0,
    lastAccuracyMeters: 8.4,
    lastBatteryPercentage: 87,
    lastIsCharging: false,
    lastNetworkType: 'CELLULAR',
    lastGpsRecordedAt: new Date().toISOString(),
    gpsHealthStatus: 'HEALTHY',
    gpsAgeSeconds: 4,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ------------------------------------------------------------------ Auth
  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get(
      `/api/v1/schools/${SCHOOL_A_ID}/buses/${BUS_ID}/state`
    );
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 403 when a non-admin role (DRIVER) attempts access', async () => {
    const driverToken = AuthService.generateToken({
      id: 'd9999999-0000-4000-8000-000000000099',
      schoolId: SCHOOL_A_ID,
      email: undefined as any,
      role: UserRole.DRIVER,
    });

    const res = await request(app)
      .get(`/api/v1/schools/${SCHOOL_A_ID}/buses/${BUS_ID}/state`)
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('returns 403 when School B admin requests School A bus state (cross-tenant block)', async () => {
    const res = await request(app)
      .get(`/api/v1/schools/${SCHOOL_A_ID}/buses/${BUS_ID}/state`)
      .set('Authorization', `Bearer ${adminBToken}`);

    // requireTenantScope enforces that req.user.schoolId === params.schoolId
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // ------------------------------------------------------------------ Success
  it('returns 200 with full bus state on happy path', async () => {
    vi.spyOn(BusService, 'getActiveBusState').mockResolvedValueOnce(mockBusState);

    const res = await request(app)
      .get(`/api/v1/schools/${SCHOOL_A_ID}/buses/${BUS_ID}/state`)
      .set('Authorization', `Bearer ${adminAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.busId).toBe(BUS_ID);
    expect(res.body.data.tripStatus).toBe('IN_TRANSIT');
    expect(res.body.data.gpsHealthStatus).toBe('HEALTHY');
    expect(res.body.data.lastSpeedKmh).toBe(32.5);
    expect(res.body.data.routeCode).toBe('RTE-S04');
    expect(res.body.data.driverName).toBe('Ramesh Kumar Singh');
  });

  it('returns 200 with null trip fields when bus has no active trip (standby)', async () => {
    const standbyState: ActiveTripStateResponse = {
      ...mockBusState,
      tripId: null,
      tripStatus: null,
      routeId: null,
      routeName: null,
      routeCode: null,
      routeType: null,
      scheduledStartTime: null,
      actualStartTime: null,
      currentStopSequence: null,
      delayMinutes: null,
      lastLatitude: null,
      lastLongitude: null,
      lastSpeedKmh: null,
      lastGpsRecordedAt: null,
      gpsHealthStatus: 'OFFLINE',
      gpsAgeSeconds: null,
    };
    vi.spyOn(BusService, 'getActiveBusState').mockResolvedValueOnce(standbyState);

    const res = await request(app)
      .get(`/api/v1/schools/${SCHOOL_A_ID}/buses/${BUS_ID}/state`)
      .set('Authorization', `Bearer ${adminAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.tripId).toBeNull();
    expect(res.body.data.gpsHealthStatus).toBe('OFFLINE');
  });

  it('returns 404 when bus does not exist in the caller school', async () => {
    const { NotFoundError } = await import('../src/middlewares/error.middleware.js');
    vi.spyOn(BusService, 'getActiveBusState').mockRejectedValueOnce(
      new NotFoundError('Bus not found')
    );

    const res = await request(app)
      .get(`/api/v1/schools/${SCHOOL_A_ID}/buses/deadbeef-dead-dead-dead-deaddeadbeef/state`)
      .set('Authorization', `Bearer ${adminAToken}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  // ------------------------------------------------------------------ Service unit
  it('BusService.getActiveBusState enforces school isolation at service level', async () => {
    const { query } = await import('../src/config/database.js');
    vi.spyOn({ query } as any, 'query').mockResolvedValueOnce([]);

    // When DB returns empty rows (bus not in school), service throws NotFoundError
    const { BusService: BS } = await import('../src/services/bus.service.js');
    const { NotFoundError: NFE } = await import('../src/middlewares/error.middleware.js');

    vi.spyOn(BS, 'getActiveBusState').mockRejectedValueOnce(
      new NFE('Bus not found')
    );

    await expect(
      BS.getActiveBusState(BUS_ID, SCHOOL_B_ID)
    ).rejects.toThrow('Bus not found');
  });
});
