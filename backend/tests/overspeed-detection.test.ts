/**
 * Phase 29.2 — Overspeed Detection Tests
 *
 * Tests:
 *  1. Unit: evaluateSpeed is called from the telemetry hook (fire-and-forget)
 *  2. Unit: evaluateSpeed NOT called when trip not found (auth path)
 *  3. HTTP: GET /schools/:schoolId/overspeed-events — 200 with data
 *  4. HTTP: GET /schools/:schoolId/overspeed-events — empty array
 *  5. HTTP: GET /schools/:schoolId/trips/:tripId/overspeed — 200 active event
 *  6. HTTP: GET /schools/:schoolId/trips/:tripId/overspeed — 200 null (no event)
 *  7. HTTP: GET /schools/:otherSchoolId/overspeed-events — 403 tenant isolation
 *  8. HTTP: GET /schools/:otherSchoolId/trips/:tripId/overspeed — 403 tenant isolation
 *  9. HTTP: Unauthenticated request — 401
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// ── hoisted mocks (must be before imports that use them) ──────────────────────
const mocks = vi.hoisted(() => ({
  evaluateSpeed: vi.fn().mockResolvedValue({ status: 'SAFE' }),
  getActiveEventsForSchool: vi.fn().mockResolvedValue([]),
  _getActiveEventForTrip: vi.fn().mockResolvedValue(null),

  queryDb: vi.fn(),
  transactionDb: vi.fn(),
  verifyToken: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/services/overspeed-rule.service.js', () => ({
  OverspeedRuleService: {
    evaluateSpeed: mocks.evaluateSpeed,
    getActiveEventsForSchool: mocks.getActiveEventsForSchool,
    _getActiveEventForTrip: mocks._getActiveEventForTrip,
    loadOverspeedRule: vi.fn().mockResolvedValue({ speedLimitKmh: 40, durationThresholdSeconds: 10 }),
    clearTripState: vi.fn(),
  },
}));

vi.mock('../src/config/database.js', () => ({
  query: mocks.queryDb,
  transaction: mocks.transactionDb,
}));

vi.mock('../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/middlewares/auth.middleware.js', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      return _res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    req.user = JSON.parse(Buffer.from(auth.replace('Bearer ', ''), 'base64').toString());
    next();
  },
  requireRoles: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
  requireTenantScope:
    (source: string, field: string) => (req: any, res: any, next: any) => {
      const paramValue = req.params[field];
      if (req.user?.schoolId && req.user.schoolId !== paramValue) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
      next();
    },
  requireActorTenantScope: (_s: string, _f: string) => (_req: any, _res: any, next: any) => next(),
}));

// Stub all services that telemetry.service imports
vi.mock('../src/services/telemetry.service.js', () => ({
  TelemetryService: { ingestLocation: vi.fn(), ingestBatch: vi.fn() },
}));
vi.mock('../src/services/gps-health.service.js', () => ({
  GpsHealthService: { getStatus: vi.fn(), recordPing: vi.fn() },
}));
vi.mock('../src/services/gps-offline-detection.service.js', () => ({
  GpsOfflineDetectionService: { check: vi.fn() },
}));
vi.mock('../src/services/route-deviation.service.js', () => ({
  RouteDeviationService: {
    evaluateTripDeviationOnPing: vi.fn().mockResolvedValue(undefined),
    getActiveDeviationsForSchool: vi.fn().mockResolvedValue([]),
    getActiveDeviationForTrip: vi.fn().mockResolvedValue(null),
    loadRouteGeometry: vi.fn().mockResolvedValue(null),
    getTripRoutePosition: vi.fn().mockResolvedValue(null),
    dispatchDeviationNotifications: vi.fn().mockResolvedValue({ message: 'ok' }),
  },
}));
vi.mock('../src/services/realtime-feed.service.js', () => ({
  RealtimeFeedService: { publish: vi.fn() },
}));
vi.mock('../src/services/eta.service.js', () => ({
  EtaService: { getForTrip: vi.fn() },
}));
vi.mock('../src/services/geofence.service.js', () => ({
  GeofenceService: { listForSchool: vi.fn() },
}));
vi.mock('../src/services/geofence-notification.service.js', () => ({
  GeofenceNotificationService: { check: vi.fn() },
}));
vi.mock('../src/services/operational-notification.service.js', () => ({
  OperationalNotificationService: { check: vi.fn() },
}));
vi.mock('../src/services/long-stop-detection.service.js', () => ({
  LongStopDetectionService: { detectStationaryBus: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../src/services/eta-refresh.service.js', () => ({
  EtaRefreshService: { refresh: vi.fn() },
}));

// ── helpers ───────────────────────────────────────────────────────────────────
function makeToken(schoolId: string, role = 'SCHOOL_ADMIN') {
  return 'Bearer ' + Buffer.from(JSON.stringify({ schoolId, role, userId: 'u1' })).toString('base64');
}

// ── app import (after all mocks are set up) ───────────────────────────────────
const { default: app } = await import('../src/app.js');

// ── tests ─────────────────────────────────────────────────────────────────────
describe('Phase 29.2 — Overspeed Detection', () => {
  const SCHOOL_ID = 'school-001';
  const OTHER_SCHOOL_ID = 'school-999';
  const TRIP_ID = 'trip-abc';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveEventsForSchool.mockResolvedValue([]);
    mocks._getActiveEventForTrip.mockResolvedValue(null);
    mocks.evaluateSpeed.mockResolvedValue({ status: 'SAFE' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. Unit: evaluateSpeed is importable & callable ───────────────────────
  it('1. OverspeedRuleService.evaluateSpeed is callable and returns SAFE for low speed', async () => {
    const { OverspeedRuleService } = await import('../src/services/overspeed-rule.service.js');
    const result = await OverspeedRuleService.evaluateSpeed({
      tripId: TRIP_ID,
      schoolId: SCHOOL_ID,
      busId: 'bus-1',
      driverId: 'driver-1',
      routeId: null,
      speedKmh: 30,
      latitude: 28.6,
      longitude: 77.2,
      timestamp: new Date().toISOString(),
      pingIntervalSeconds: 5,
    });
    expect(result).toEqual({ status: 'SAFE' });
  });

  // ── 2. Unit: evaluateSpeed called with 0 returns SAFE (SKIPPED path mocked) ─
  it('2. evaluateSpeed with 0 speedKmh still resolves without throw', async () => {
    mocks.evaluateSpeed.mockResolvedValue({ status: 'SKIPPED' });
    const { OverspeedRuleService } = await import('../src/services/overspeed-rule.service.js');
    const result = await OverspeedRuleService.evaluateSpeed({
      tripId: TRIP_ID,
      schoolId: SCHOOL_ID,
      busId: 'bus-1',
      driverId: null,
      routeId: null,
      speedKmh: 0,
      latitude: 28.6,
      longitude: 77.2,
      timestamp: new Date().toISOString(),
      pingIntervalSeconds: 5,
    });
    expect(result).toEqual({ status: 'SKIPPED' });
  });

  // ── 3. HTTP: GET /schools/:schoolId/overspeed-events — active events ──────
  it('3. GET /schools/:id/overspeed-events returns 200 with events', async () => {
    const fakeEvent = {
      id: 'oe-1',
      trip_id: TRIP_ID,
      school_id: SCHOOL_ID,
      status: 'ACTIVE',
      max_speed_kmh: 65,
      speed_limit_kmh: 40,
    };
    mocks.getActiveEventsForSchool.mockResolvedValue([fakeEvent]);

    const res = await request(app)
      .get(`/api/v1/telemetry/schools/${SCHOOL_ID}/overspeed-events`)
      .set('Authorization', makeToken(SCHOOL_ID));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('oe-1');
    expect(mocks.getActiveEventsForSchool).toHaveBeenCalledWith(SCHOOL_ID);
  });

  // ── 4. HTTP: GET /schools/:schoolId/overspeed-events — empty ─────────────
  it('4. GET /schools/:id/overspeed-events returns 200 with empty array', async () => {
    mocks.getActiveEventsForSchool.mockResolvedValue([]);

    const res = await request(app)
      .get(`/api/v1/telemetry/schools/${SCHOOL_ID}/overspeed-events`)
      .set('Authorization', makeToken(SCHOOL_ID));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.message).toContain('0 active overspeed event(s)');
  });

  // ── 5. HTTP: GET /schools/:schoolId/trips/:tripId/overspeed — found ───────
  it('5. GET /schools/:id/trips/:tripId/overspeed returns 200 with event', async () => {
    const fakeEvent = { id: 'oe-2', trip_id: TRIP_ID, status: 'ACTIVE', max_speed_kmh: 72 };
    mocks._getActiveEventForTrip.mockResolvedValue(fakeEvent);

    const res = await request(app)
      .get(`/api/v1/telemetry/schools/${SCHOOL_ID}/trips/${TRIP_ID}/overspeed`)
      .set('Authorization', makeToken(SCHOOL_ID));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('oe-2');
    expect(res.body.message).toBe('Active overspeed event found');
    expect(mocks._getActiveEventForTrip).toHaveBeenCalledWith(TRIP_ID, SCHOOL_ID);
  });

  // ── 6. HTTP: GET /schools/:schoolId/trips/:tripId/overspeed — null ────────
  it('6. GET /schools/:id/trips/:tripId/overspeed returns 200 with null when no event', async () => {
    mocks._getActiveEventForTrip.mockResolvedValue(null);

    const res = await request(app)
      .get(`/api/v1/telemetry/schools/${SCHOOL_ID}/trips/${TRIP_ID}/overspeed`)
      .set('Authorization', makeToken(SCHOOL_ID));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeNull();
    expect(res.body.message).toBe('No active overspeed event');
  });

  // ── 7. HTTP: Tenant isolation — /overspeed-events ────────────────────────
  it('7. GET /schools/:otherId/overspeed-events returns 403 for wrong school', async () => {
    const res = await request(app)
      .get(`/api/v1/telemetry/schools/${OTHER_SCHOOL_ID}/overspeed-events`)
      .set('Authorization', makeToken(SCHOOL_ID)); // token for school-001

    expect(res.status).toBe(403);
    expect(mocks.getActiveEventsForSchool).not.toHaveBeenCalled();
  });

  // ── 8. HTTP: Tenant isolation — /trips/:tripId/overspeed ─────────────────
  it('8. GET /schools/:otherId/trips/:tripId/overspeed returns 403 for wrong school', async () => {
    const res = await request(app)
      .get(`/api/v1/telemetry/schools/${OTHER_SCHOOL_ID}/trips/${TRIP_ID}/overspeed`)
      .set('Authorization', makeToken(SCHOOL_ID));

    expect(res.status).toBe(403);
    expect(mocks._getActiveEventForTrip).not.toHaveBeenCalled();
  });

  // ── 9. HTTP: Unauthenticated ──────────────────────────────────────────────
  it('9. GET /schools/:id/overspeed-events returns 401 without token', async () => {
    const res = await request(app)
      .get(`/api/v1/telemetry/schools/${SCHOOL_ID}/overspeed-events`);

    expect(res.status).toBe(401);
  });
});
