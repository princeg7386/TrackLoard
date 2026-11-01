/**
 * Phase 30.1 — SOS Trigger: HTTP integration tests
 *
 * SosService is fully mocked. Auth middleware mocked with base64-JSON tokens
 * (established pattern for HTTP tests in this codebase).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ── Mocks (hoisted) ──────────────────────────────────────────────────────────

const mockSosService = vi.hoisted(() => ({
  triggerSos: vi.fn(),
  getActiveSosEvents: vi.fn(),
  getSosEventById: vi.fn(),
  acknowledgeSos: vi.fn(),
  resolveSos: vi.fn(),
}));

vi.mock('../src/services/sos.service.js', () => ({ SosService: mockSosService }));
vi.mock('../src/config/database.js', () => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock('../src/services/messaging/messaging.service.js', () => ({
  MessagingService: { sendMessage: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/services/operational-notification.service.js', () => ({
  OperationalNotificationService: { notifyEmergencySos: vi.fn().mockResolvedValue({ notificationsSent: 2 }) },
}));

// Auth middleware mock — base64-JSON token pattern (established by Phase 22+)
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
}));

vi.mock('../src/middlewares/tenant-isolation.middleware.js', () => ({
  requireTenantScope:
    (source: string, field: string) => (req: any, res: any, next: any) => {
      const paramValue = req.params[field];
      if (req.user?.schoolId && req.user.schoolId !== paramValue) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
      next();
    },
  requireActorTenantScope: (_req: any, _res: any, next: any) => next(),
}));

// Driver auth middleware mock — populates req.driver
vi.mock('../src/middlewares/driver-auth.middleware.js', () => ({
  authenticateDriver: (req: any, _res: any, next: any) => {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      return _res.status(401).json({ success: false, message: 'Driver auth required' });
    }
    req.driver = JSON.parse(Buffer.from(auth.replace('Bearer ', ''), 'base64').toString());
    next();
  },
  authenticateDriverOptional: (_req: any, _res: any, next: any) => next(),
  requireAssignedBus: () => (_req: any, _res: any, next: any) => next(),
}));

// ── App (imported AFTER mocks) ────────────────────────────────────────────────

const { default: app } = await import('../src/app.js');

// ── Token helpers ─────────────────────────────────────────────────────────────

const SCHOOL_ID = 'school-sos-001';
const TRIP_ID   = 'trip-sos-001';
const SOS_ID    = 'sos-event-001';

function makeAdminToken(schoolId = SCHOOL_ID) {
  return 'Bearer ' + Buffer.from(JSON.stringify({ id: 'admin-1', schoolId, role: 'SCHOOL_ADMIN' })).toString('base64');
}

function makeDriverToken(schoolId = SCHOOL_ID) {
  return 'Bearer ' + Buffer.from(JSON.stringify({ id: 'driver-1', schoolId, role: 'DRIVER', phone: '+919876543210', fullName: 'Test Driver' })).toString('base64');
}

function makeSosRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: SOS_ID,
    schoolId: SCHOOL_ID,
    tripId: TRIP_ID,
    busId: 'bus-1',
    driverId: 'driver-1',
    triggerSource: 'APP_SOS_BUTTON',
    latitude: 28.6139,
    longitude: 77.209,
    speedKmh: 42,
    status: 'TRIGGERED',
    acknowledgedBy: null,
    acknowledgedAt: null,
    resolvedAt: null,
    resolutionNotes: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Phase 30.1 — SOS Trigger: HTTP routes', () => {

  // ── Admin: GET active SOS events ──────────────────────────────────────────

  describe('GET /api/v1/schools/:schoolId/sos-events', () => {
    it('returns active SOS events for admin', async () => {
      mockSosService.getActiveSosEvents.mockResolvedValue([makeSosRecord()]);

      const res = await request(app)
        .get(`/api/v1/schools/${SCHOOL_ID}/sos-events`)
        .set('Authorization', makeAdminToken());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data[0].id).toBe(SOS_ID);
    });

    it('returns 401 without token', async () => {
      const res = await request(app)
        .get(`/api/v1/schools/${SCHOOL_ID}/sos-events`);

      expect(res.status).toBe(401);
    });

    it('returns 403 when admin schoolId does not match school param (tenant isolation)', async () => {
      const res = await request(app)
        .get(`/api/v1/schools/other-school/sos-events`)
        .set('Authorization', makeAdminToken(SCHOOL_ID)); // token for SCHOOL_ID, path for other-school

      expect(res.status).toBe(403);
    });
  });

  // ── Admin: Acknowledge ───────────────────────────────────────────────────

  describe('POST /api/v1/schools/:schoolId/sos-events/:sosId/acknowledge', () => {
    it('acknowledges SOS for admin', async () => {
      mockSosService.acknowledgeSos.mockResolvedValue(
        makeSosRecord({ status: 'ACKNOWLEDGED', acknowledgedBy: 'admin-1' })
      );

      const res = await request(app)
        .post(`/api/v1/schools/${SCHOOL_ID}/sos-events/${SOS_ID}/acknowledge`)
        .set('Authorization', makeAdminToken());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ACKNOWLEDGED');
    });

    it('returns 404 when service throws not found', async () => {
      mockSosService.acknowledgeSos.mockRejectedValue(
        new Error('SOS event not found or already acknowledged')
      );

      const res = await request(app)
        .post(`/api/v1/schools/${SCHOOL_ID}/sos-events/${SOS_ID}/acknowledge`)
        .set('Authorization', makeAdminToken());

      expect(res.status).toBe(404);
    });
  });

  // ── Admin: Resolve ───────────────────────────────────────────────────────

  describe('POST /api/v1/schools/:schoolId/sos-events/:sosId/resolve', () => {
    it('resolves SOS for admin with notes', async () => {
      mockSosService.resolveSos.mockResolvedValue(
        makeSosRecord({ status: 'RESOLVED', resolutionNotes: 'All safe' })
      );

      const res = await request(app)
        .post(`/api/v1/schools/${SCHOOL_ID}/sos-events/${SOS_ID}/resolve`)
        .set('Authorization', makeAdminToken())
        .send({ notes: 'All safe' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('RESOLVED');
    });

    it('returns 404 when SOS already resolved', async () => {
      mockSosService.resolveSos.mockRejectedValue(
        new Error('SOS event not found or already resolved')
      );

      const res = await request(app)
        .post(`/api/v1/schools/${SCHOOL_ID}/sos-events/${SOS_ID}/resolve`)
        .set('Authorization', makeAdminToken());

      expect(res.status).toBe(404);
    });
  });

  // ── Driver app: trigger SOS ──────────────────────────────────────────────

  describe('POST /api/v1/telemetry/trips/:tripId/sos', () => {
    it('driver can trigger SOS — 201 with sosEventId', async () => {
      mockSosService.triggerSos.mockResolvedValue({
        sosEventId: SOS_ID,
        status: 'TRIGGERED',
        latitude: 28.6139,
        longitude: 77.209,
        notificationsSent: 0,
      });

      const res = await request(app)
        .post(`/api/v1/telemetry/trips/${TRIP_ID}/sos`)
        .set('Authorization', makeDriverToken());

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.sosEventId).toBe(SOS_ID);
      expect(res.body.data.status).toBe('TRIGGERED');
    });

    it('returns 401 when driver token is missing', async () => {
      const res = await request(app)
        .post(`/api/v1/telemetry/trips/${TRIP_ID}/sos`);

      expect(res.status).toBe(401);
    });
  });
});
