/**
 * pickup-arrival.test.ts — Phase 31.1: Upcoming Student Pickup (HTTP)
 *
 * Tests: mocked PickupArrivalService + real Express app HTTP layer.
 * Covers: Route 117 GET /api/v1/schools/:schoolId/trips/:tripId/upcoming-students
 *
 * Auth mock pattern: base64-JSON tokens (established since Phase 22).
 * Do NOT import real PickupArrivalService here — service is mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ─── Mocks (must hoist before app import) ────────────────────────────────────

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

vi.mock('../src/services/pickup-arrival.service.js', () => ({
  PickupArrivalService: {
    getUpcomingStudents: vi.fn(),
  },
}));

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
vi.mock('../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/services/operational-notification.service.js', () => ({
  OperationalNotificationService: { notifyEmergencySos: vi.fn() },
}));

import { PickupArrivalService } from '../src/services/pickup-arrival.service.js';
import app from '../src/app.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SCHOOL_ID = 'school-aaaa-1111';
const TRIP_ID   = 'trip-aaaa-1111';

function makeAdminToken(schoolId = SCHOOL_ID) {
  return (
    'Bearer ' +
    Buffer.from(
      JSON.stringify({ id: 'admin-0001', schoolId, role: 'SCHOOL_ADMIN' })
    ).toString('base64')
  );
}

function makeResult(allPickupsComplete = false) {
  return {
    tripId: TRIP_ID,
    schoolId: SCHOOL_ID,
    tripStatus: 'IN_TRANSIT',
    currentStopSequence: 0,
    nextStop: allPickupsComplete
      ? null
      : {
          id: 'stop-0001',
          name: 'Gate No. 3 - Sector 7',
          sequenceOrder: 1,
          latitude: 28.6,
          longitude: 77.2,
          scheduledTime: '07:30:00',
          geofenceRadiusMeters: 300,
        },
    students: allPickupsComplete
      ? []
      : [
          {
            studentId: 'stu-0001',
            fullName: 'Aarav Sharma',
            admissionNumber: 'ADM-001',
            classGrade: '5',
            section: 'A',
            parentPhone: '+919876543210',
            attendanceStatus: 'PENDING',
            boardedAt: null,
          },
        ],
    totalPending: allPickupsComplete ? 0 : 1,
    totalAtStop: allPickupsComplete ? 0 : 1,
    allPickupsComplete,
  };
}

const mockGetUpcomingStudents = PickupArrivalService.getUpcomingStudents as ReturnType<
  typeof vi.fn
>;

beforeEach(() => mockGetUpcomingStudents.mockReset());

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/v1/schools/:schoolId/trips/:tripId/upcoming-students', () => {
  it('200 — returns next stop and students', async () => {
    mockGetUpcomingStudents.mockResolvedValueOnce(makeResult(false));

    const res = await request(app)
      .get(`/api/v1/schools/${SCHOOL_ID}/trips/${TRIP_ID}/upcoming-students`)
      .set('Authorization', makeAdminToken());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.allPickupsComplete).toBe(false);
    expect(res.body.data.nextStop).not.toBeNull();
    expect(res.body.data.students).toHaveLength(1);
    expect(res.body.message).toMatch(/next pickup/i);
  });

  it('200 — returns allPickupsComplete message when no pending stops', async () => {
    mockGetUpcomingStudents.mockResolvedValueOnce(makeResult(true));

    const res = await request(app)
      .get(`/api/v1/schools/${SCHOOL_ID}/trips/${TRIP_ID}/upcoming-students`)
      .set('Authorization', makeAdminToken());

    expect(res.status).toBe(200);
    expect(res.body.data.allPickupsComplete).toBe(true);
    expect(res.body.data.nextStop).toBeNull();
    expect(res.body.message).toMatch(/all pickups complete/i);
  });

  it('404 — when service throws NotFoundError', async () => {
    const { NotFoundError } = await import('../src/middlewares/error.middleware.js');
    mockGetUpcomingStudents.mockRejectedValueOnce(
      new NotFoundError(`Trip ${TRIP_ID} not found in this school`)
    );

    const res = await request(app)
      .get(`/api/v1/schools/${SCHOOL_ID}/trips/${TRIP_ID}/upcoming-students`)
      .set('Authorization', makeAdminToken());

    expect(res.status).toBe(404);
  });

  it('400 — when service throws BadRequestError (inactive trip)', async () => {
    const { BadRequestError } = await import('../src/middlewares/error.middleware.js');
    mockGetUpcomingStudents.mockRejectedValueOnce(
      new BadRequestError('Trip is not active (status: SCHEDULED)')
    );

    const res = await request(app)
      .get(`/api/v1/schools/${SCHOOL_ID}/trips/${TRIP_ID}/upcoming-students`)
      .set('Authorization', makeAdminToken());

    expect(res.status).toBe(400);
  });

  it('passes schoolId and tripId to service', async () => {
    mockGetUpcomingStudents.mockResolvedValueOnce(makeResult(false));

    await request(app)
      .get(`/api/v1/schools/${SCHOOL_ID}/trips/${TRIP_ID}/upcoming-students`)
      .set('Authorization', makeAdminToken());

    expect(mockGetUpcomingStudents).toHaveBeenCalledWith(TRIP_ID, SCHOOL_ID);
  });
});
