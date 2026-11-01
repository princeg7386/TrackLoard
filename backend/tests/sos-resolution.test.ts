/**
 * sos-resolution.test.ts — Phase 30.4: SOS Resolution (HTTP)
 *
 * Tests: mocked SosService + real Express app HTTP layer.
 * Covers Route 35: GET /api/v1/schools/:schoolId/sos-events/history
 *
 * Auth mock pattern: base64-JSON tokens (established since Phase 22).
 * Do NOT import real SosService here — service is mocked.
 * Do NOT copy getSosHistory unit tests here — that's sos-resolution-unit.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ─── Mocks (must be hoisted before any app import) ────────────────────────────

vi.mock('../src/middlewares/auth.middleware.js', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    const auth: string = req.headers.authorization ?? '';
    try {
      req.user = JSON.parse(Buffer.from(auth.replace('Bearer ', ''), 'base64').toString());
    } catch {
      req.user = null;
    }
    next();
  },
  requireRoles:
    (..._roles: string[]) =>
    (_req: any, _res: any, next: any) =>
      next(),
}));

vi.mock('../src/middlewares/tenant-isolation.middleware.js', () => ({
  requireTenantScope:
    () =>
    (_req: any, _res: any, next: any) =>
      next(),
  requireActorTenantScope: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../src/middlewares/driver-auth.middleware.js', () => ({
  authenticateDriver: (_req: any, _res: any, next: any) => next(),
  authenticateDriverOptional: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../src/services/sos.service.js', () => ({
  SosService: {
    triggerSos: vi.fn(),
    getActiveSosEvents: vi.fn(),
    getSosHistory: vi.fn(),
    acknowledgeSos: vi.fn(),
    resolveSos: vi.fn(),
  },
}));

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
vi.mock('../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/services/operational-notification.service.js', () => ({
  OperationalNotificationService: {
    notifyEmergencySos: vi.fn().mockResolvedValue(undefined),
  },
}));

import { SosService } from '../src/services/sos.service.js';
import app from '../src/app.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SCHOOL_ID = 'school-aaaa-bbbb';

function makeAdminToken(schoolId = SCHOOL_ID) {
  return (
    'Bearer ' +
    Buffer.from(
      JSON.stringify({ id: 'admin-0001', schoolId, role: 'SCHOOL_ADMIN' })
    ).toString('base64')
  );
}

function makeSosRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sos-0001',
    schoolId: SCHOOL_ID,
    tripId: 'trip-0001',
    busId: 'bus-0001',
    driverId: 'drv-0001',
    triggerSource: 'APP_SOS_BUTTON',
    latitude: 28.6139,
    longitude: 77.209,
    speedKmh: 35.5,
    status: 'RESOLVED',
    acknowledgedBy: 'admin-0001',
    acknowledgedAt: '2026-10-31T08:00:00Z',
    resolvedAt: '2026-10-31T09:00:00Z',
    resolutionNotes: 'Tyre puncture handled.',
    createdAt: '2026-10-31T07:55:00Z',
    busNumber: 'KA-01-AB-1234',
    driverName: 'Ramesh Kumar',
    driverPhone: '+919876543210',
    routeName: 'Route A - Sector 7',
    gpsAccuracyM: 8.5,
    gpsRecordedAt: '2026-10-31T07:54:50Z',
    ...overrides,
  };
}

const mockGetSosHistory = SosService.getSosHistory as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGetSosHistory.mockReset();
});

// ─── Route 35 Tests ───────────────────────────────────────────────────────────

describe('GET /api/v1/schools/:schoolId/sos-events/history', () => {
  it('200 — returns paginated resolved events', async () => {
    const events = [makeSosRecord(), makeSosRecord({ id: 'sos-0002' })];
    mockGetSosHistory.mockResolvedValueOnce(events);

    const res = await request(app)
      .get(`/api/v1/schools/${SCHOOL_ID}/sos-events/history`)
      .set('Authorization', makeAdminToken());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.count).toBe(2);
  });

  it('200 — returns empty array with "No resolved SOS events" message', async () => {
    mockGetSosHistory.mockResolvedValueOnce([]);

    const res = await request(app)
      .get(`/api/v1/schools/${SCHOOL_ID}/sos-events/history`)
      .set('Authorization', makeAdminToken());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.message).toMatch(/no resolved/i);
  });

  it('forwards ?limit and ?offset query params to SosService', async () => {
    mockGetSosHistory.mockResolvedValueOnce([]);

    await request(app)
      .get(`/api/v1/schools/${SCHOOL_ID}/sos-events/history?limit=10&offset=20`)
      .set('Authorization', makeAdminToken());

    expect(mockGetSosHistory).toHaveBeenCalledWith(SCHOOL_ID, 10, 20);
  });

  it('clamps limit to max 100', async () => {
    mockGetSosHistory.mockResolvedValueOnce([]);

    await request(app)
      .get(`/api/v1/schools/${SCHOOL_ID}/sos-events/history?limit=999`)
      .set('Authorization', makeAdminToken());

    expect(mockGetSosHistory).toHaveBeenCalledWith(SCHOOL_ID, 100, 0);
  });

  it('defaults limit=50 and offset=0 when not provided', async () => {
    mockGetSosHistory.mockResolvedValueOnce([]);

    await request(app)
      .get(`/api/v1/schools/${SCHOOL_ID}/sos-events/history`)
      .set('Authorization', makeAdminToken());

    expect(mockGetSosHistory).toHaveBeenCalledWith(SCHOOL_ID, 50, 0);
  });

  it('passes schoolId from URL param to SosService', async () => {
    const OTHER_SCHOOL = 'school-other-9999';
    mockGetSosHistory.mockResolvedValueOnce([]);

    await request(app)
      .get(`/api/v1/schools/${OTHER_SCHOOL}/sos-events/history`)
      .set('Authorization', makeAdminToken(OTHER_SCHOOL));

    expect(mockGetSosHistory).toHaveBeenCalledWith(OTHER_SCHOOL, expect.any(Number), expect.any(Number));
  });

  it('response includes pagination object with limit, offset, count', async () => {
    const events = [makeSosRecord()];
    mockGetSosHistory.mockResolvedValueOnce(events);

    const res = await request(app)
      .get(`/api/v1/schools/${SCHOOL_ID}/sos-events/history?limit=25&offset=0`)
      .set('Authorization', makeAdminToken());

    expect(res.body.pagination).toMatchObject({
      limit: 25,
      offset: 0,
      count: 1,
    });
  });
});
