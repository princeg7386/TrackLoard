/**
 * Phase 29.3 — Overspeed Notify: HTTP endpoint tests
 *
 * Tests:
 *   9.  POST /schools/:id/overspeed-events/:eventId/notify — 200, forceNotify=true
 *   10. POST /schools/:otherId/... — 403 tenant isolation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  queryDb: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  dispatchOverspeedNotifications: vi.fn().mockResolvedValue({
    eventId: 'oe-001',
    schoolNotified: true,
    driverNotified: false,
    schoolCooldownSkipped: false,
    driverCooldownSkipped: false,
    schoolRecipientsCount: 1,
    message: 'Notifications dispatched — school: true, driver: false',
  }),
  getActiveEventsForSchool: vi.fn().mockResolvedValue([]),
  _getActiveEventForTrip: vi.fn().mockResolvedValue(null),
  evaluateSpeed: vi.fn().mockResolvedValue({ status: 'SAFE' }),
}));

vi.mock('../src/config/database.js', () => ({ query: mocks.queryDb, transaction: vi.fn() }));
vi.mock('../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/services/messaging/messaging.service.js', () => ({
  MessagingService: { sendMessage: mocks.sendMessage },
}));
vi.mock('../src/services/overspeed-rule.service.js', () => ({
  OverspeedRuleService: {
    evaluateSpeed: mocks.evaluateSpeed,
    getActiveEventsForSchool: mocks.getActiveEventsForSchool,
    _getActiveEventForTrip: mocks._getActiveEventForTrip,
    dispatchOverspeedNotifications: mocks.dispatchOverspeedNotifications,
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

function makeToken(schoolId: string, role = 'SCHOOL_ADMIN') {
  return 'Bearer ' + Buffer.from(JSON.stringify({ schoolId, role, userId: 'u1' })).toString('base64');
}

const { default: app } = await import('../src/app.js');
const SCHOOL_ID = 'school-001';
const EVENT_ID = 'oe-001';

describe('Phase 29.3 — HTTP: Manual Notify Overspeed Endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dispatchOverspeedNotifications.mockResolvedValue({
      eventId: EVENT_ID,
      schoolNotified: true,
      driverNotified: false,
      schoolCooldownSkipped: false,
      driverCooldownSkipped: false,
      schoolRecipientsCount: 1,
      message: 'Notifications dispatched — school: true, driver: false',
    });
  });

  // ── 9. POST manual notify — 200 ──────────────────────────────────────────
  it('9. POST /schools/:id/overspeed-events/:eventId/notify returns 200 with forceNotify=true', async () => {
    const res = await request(app)
      .post(`/api/v1/telemetry/schools/${SCHOOL_ID}/overspeed-events/${EVENT_ID}/notify`)
      .set('Authorization', makeToken(SCHOOL_ID));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.eventId).toBe(EVENT_ID);
    expect(mocks.dispatchOverspeedNotifications).toHaveBeenCalledWith(EVENT_ID, SCHOOL_ID, true);
  });

  // ── 10. 403 tenant isolation ──────────────────────────────────────────────
  it('10. POST manual notify with wrong schoolId returns 403', async () => {
    const res = await request(app)
      .post(`/api/v1/telemetry/schools/school-999/overspeed-events/${EVENT_ID}/notify`)
      .set('Authorization', makeToken(SCHOOL_ID));

    expect(res.status).toBe(403);
    expect(mocks.dispatchOverspeedNotifications).not.toHaveBeenCalled();
  });
});
