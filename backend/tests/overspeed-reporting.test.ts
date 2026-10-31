/**
 * Phase 29.4 — Overspeed Reporting: HTTP endpoint tests
 *
 * Tests:
 *  9.  GET /schools/:id/overspeed-events/history — 200 with data + pagination
 *  10. GET /history?status=RESOLVED — filter passed to service
 *  11. GET /history?page=2&pageSize=5 — pagination forwarded
 *  12. GET /schools/:otherId/history — 403 tenant isolation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  queryDb: vi.fn(),
  getOverspeedHistory: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 }),
  getActiveEventsForSchool: vi.fn().mockResolvedValue([]),
  _getActiveEventForTrip: vi.fn().mockResolvedValue(null),
  evaluateSpeed: vi.fn().mockResolvedValue({ status: 'SAFE' }),
  dispatchOverspeedNotifications: vi.fn().mockResolvedValue({ message: 'ok' }),
}));

vi.mock('../src/config/database.js', () => ({ query: mocks.queryDb, transaction: vi.fn() }));
vi.mock('../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/services/messaging/messaging.service.js', () => ({
  MessagingService: { sendMessage: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../src/services/overspeed-rule.service.js', () => ({
  OverspeedRuleService: {
    evaluateSpeed: mocks.evaluateSpeed,
    getActiveEventsForSchool: mocks.getActiveEventsForSchool,
    _getActiveEventForTrip: mocks._getActiveEventForTrip,
    dispatchOverspeedNotifications: mocks.dispatchOverspeedNotifications,
    getOverspeedHistory: mocks.getOverspeedHistory,
    loadOverspeedRule: vi.fn().mockResolvedValue({ speedLimitKmh: 40, durationThresholdSeconds: 10 }),
    clearTripState: vi.fn(),
  },
}));
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
vi.mock('../src/services/realtime-feed.service.js', () => ({ RealtimeFeedService: { publish: vi.fn() } }));
vi.mock('../src/services/eta.service.js', () => ({ EtaService: { getForTrip: vi.fn() } }));
vi.mock('../src/services/geofence.service.js', () => ({ GeofenceService: { listForSchool: vi.fn() } }));
vi.mock('../src/services/geofence-notification.service.js', () => ({
  GeofenceNotificationService: { check: vi.fn() },
}));
vi.mock('../src/services/operational-notification.service.js', () => ({
  OperationalNotificationService: { check: vi.fn() },
}));
vi.mock('../src/services/long-stop-detection.service.js', () => ({
  LongStopDetectionService: { detectStationaryBus: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../src/services/eta-refresh.service.js', () => ({ EtaRefreshService: { refresh: vi.fn() } }));
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

function makeToken(schoolId: string) {
  return 'Bearer ' + Buffer.from(JSON.stringify({ schoolId, role: 'SCHOOL_ADMIN', userId: 'u1' })).toString('base64');
}

const { default: app } = await import('../src/app.js');
const SID = 'school-001';

describe('Phase 29.4 — HTTP: Overspeed History Endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOverspeedHistory.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 });
  });

  // ── 9. GET /history — 200 + pagination ───────────────────────────────────
  it('9. GET /schools/:id/overspeed-events/history returns 200 with pagination meta', async () => {
    mocks.getOverspeedHistory.mockResolvedValue({
      data: [{ id: 'oe-1', schoolId: SID, status: 'RESOLVED' }],
      total: 1, page: 1, pageSize: 20,
    });

    const res = await request(app)
      .get(`/api/v1/telemetry/schools/${SID}/overspeed-events/history`)
      .set('Authorization', makeToken(SID));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({ total: 1, page: 1, pageSize: 20, totalPages: 1 });
    expect(mocks.getOverspeedHistory).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: SID })
    );
  });

  // ── 10. status filter forwarded ───────────────────────────────────────────
  it('10. GET /history?status=RESOLVED forwards status filter', async () => {
    const res = await request(app)
      .get(`/api/v1/telemetry/schools/${SID}/overspeed-events/history?status=RESOLVED`)
      .set('Authorization', makeToken(SID));

    expect(res.status).toBe(200);
    expect(mocks.getOverspeedHistory).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'RESOLVED' })
    );
  });

  // ── 11. Pagination params forwarded ──────────────────────────────────────
  it('11. GET /history?page=2&pageSize=5 forwards pagination to service', async () => {
    mocks.getOverspeedHistory.mockResolvedValue({ data: [], total: 10, page: 2, pageSize: 5 });

    const res = await request(app)
      .get(`/api/v1/telemetry/schools/${SID}/overspeed-events/history?page=2&pageSize=5`)
      .set('Authorization', makeToken(SID));

    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({ page: 2, pageSize: 5, total: 10, totalPages: 2 });
    expect(mocks.getOverspeedHistory).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, pageSize: 5 })
    );
  });

  // ── 12. 403 tenant isolation ──────────────────────────────────────────────
  it('12. GET /history with wrong schoolId returns 403', async () => {
    const res = await request(app)
      .get(`/api/v1/telemetry/schools/school-999/overspeed-events/history`)
      .set('Authorization', makeToken(SID));

    expect(res.status).toBe(403);
    expect(mocks.getOverspeedHistory).not.toHaveBeenCalled();
  });
});
