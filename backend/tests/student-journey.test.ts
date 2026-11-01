/**
 * student-journey.test.ts — Phase 32.1: Student Journey Timeline Record (HTTP)
 *
 * Tests: mocked StudentJourneyService + real Express app HTTP layer.
 * Covers: Route 119 GET /api/v1/schools/:schoolId/students/:studentId/journey
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ─── Mocks ───────────────────────────────────────────────────────────────────
vi.mock('../src/middlewares/auth.middleware.js', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    const auth: string = req.headers.authorization ?? '';
    try {
      req.user = JSON.parse(
        Buffer.from(auth.replace('Bearer ', ''), 'base64').toString()
      );
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

vi.mock('../src/services/student-journey.service.js', () => ({
  StudentJourneyService: {
    getStudentJourneyTimeline: vi.fn(),
  },
}));

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
vi.mock('../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/services/operational-notification.service.js', () => ({
  OperationalNotificationService: { notifyEmergencySos: vi.fn() },
}));

import { StudentJourneyService } from '../src/services/student-journey.service.js';
import app from '../src/app.js';

const SCHOOL_ID = 'school-1111-aaaa';
const STUDENT_ID = 'student-2222-bbbb';
const TRIP_ID = 'trip-3333-cccc';

function makeAdminToken(schoolId = SCHOOL_ID) {
  return (
    'Bearer ' +
    Buffer.from(
      JSON.stringify({ id: 'admin-0001', schoolId, role: 'SCHOOL_ADMIN' })
    ).toString('base64')
  );
}

function makeDriverToken(schoolId = SCHOOL_ID) {
  return (
    'Bearer ' +
    Buffer.from(
      JSON.stringify({ id: 'driver-0001', schoolId, role: 'DRIVER' })
    ).toString('base64')
  );
}

function makeMockJourneyResponse() {
  return {
    student: {
      id: STUDENT_ID,
      fullName: 'Aarav Sharma',
      admissionNumber: 'ADM-001',
      classGrade: '5',
      section: 'A',
      emergencyPhone: '+919876543210',
    },
    trip: {
      id: TRIP_ID,
      busNumber: 'BUS-07',
      registrationNumber: 'DL-01-AB-1234',
      routeName: 'North Route',
      routeCode: 'R-01',
      scheduledDate: '2026-11-01',
      status: 'IN_TRANSIT',
      driverName: 'Ramesh Kumar',
    },
    currentStatus: 'IN_TRANSIT',
    currentStage: 'ON_ROUTE',
    stages: [
      { stage: 'PICKUP', title: 'Pickup Scheduled', status: 'COMPLETED', description: 'Assigned stop' },
      { stage: 'BUS_ARRIVAL', title: 'Bus Arrival', status: 'COMPLETED', description: 'Bus arrived' },
      { stage: 'BOARDING', title: 'Boarded', status: 'COMPLETED', description: 'Student boarded' },
      { stage: 'ON_ROUTE', title: 'On Route', status: 'IN_PROGRESS', description: 'Travelling on bus' },
      { stage: 'SCHOOL_ARRIVAL', title: 'School Arrival', status: 'IN_PROGRESS', description: 'En route' },
      { stage: 'DROPPED', title: 'Drop Off', status: 'PENDING', description: 'Scheduled drop' },
    ],
    timeline: [
      { id: '1', type: 'PICKUP', status: 'SCHEDULED', timestamp: '2026-11-01T07:30:00Z' },
      { id: '2', type: 'BUS_ARRIVAL', status: 'ARRIVED', timestamp: '2026-11-01T07:32:00Z' },
      { id: '3', type: 'BOARDING', status: 'BOARDED', timestamp: '2026-11-01T07:33:00Z' },
    ],
    corrections: [],
  };
}

const mockGetTimeline = StudentJourneyService.getStudentJourneyTimeline as ReturnType<
  typeof vi.fn
>;

beforeEach(() => mockGetTimeline.mockReset());

describe('GET /api/v1/schools/:schoolId/students/:studentId/journey', () => {
  it('200 — returns 6-stage journey timeline for school admin', async () => {
    mockGetTimeline.mockResolvedValueOnce(makeMockJourneyResponse());

    const res = await request(app)
      .get(`/api/v1/schools/${SCHOOL_ID}/students/${STUDENT_ID}/journey`)
      .set('Authorization', makeAdminToken());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.student.fullName).toBe('Aarav Sharma');
    expect(res.body.data.stages).toHaveLength(6);
    expect(res.body.data.currentStage).toBe('ON_ROUTE');
    expect(res.body.message).toMatch(/journey timeline retrieved successfully/i);
    expect(mockGetTimeline).toHaveBeenCalledWith(SCHOOL_ID, STUDENT_ID, undefined);
  });

  it('200 — accepts optional tripId query param and allows DRIVER role', async () => {
    mockGetTimeline.mockResolvedValueOnce(makeMockJourneyResponse());

    const res = await request(app)
      .get(`/api/v1/schools/${SCHOOL_ID}/students/${STUDENT_ID}/journey?tripId=${TRIP_ID}`)
      .set('Authorization', makeDriverToken());

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockGetTimeline).toHaveBeenCalledWith(SCHOOL_ID, STUDENT_ID, TRIP_ID);
  });

  it('404 — when service throws NotFoundError (student or trip not found)', async () => {
    const { NotFoundError } = await import('../src/middlewares/error.middleware.js');
    mockGetTimeline.mockRejectedValueOnce(
      new NotFoundError(`Student ${STUDENT_ID} not found in this school context`)
    );

    const res = await request(app)
      .get(`/api/v1/schools/${SCHOOL_ID}/students/${STUDENT_ID}/journey`)
      .set('Authorization', makeAdminToken());

    expect(res.status).toBe(404);
  });
});
