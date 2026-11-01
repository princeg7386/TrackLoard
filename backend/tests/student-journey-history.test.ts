/**
 * student-journey-history.test.ts — Phase 32.2: Student Journey History
 *
 * Covers:
 *   - StudentJourneyService.getStudentMultiTripHistory (Unit)
 *   - Route 120 GET /api/v1/schools/:schoolId/students/:studentId/journey/history (HTTP)
 *   - Parent Route GET /api/v1/parent/journey/history/:token (HTTP)
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

vi.mock('../src/middlewares/parent-token.middleware.js', () => ({
  authenticateParentTrackingToken: (req: any, _res: any, next: any) => {
    req.parentTrackingSession = {
      tokenId: 'token-uuid-1234',
      school: { id: 'school-1111-aaaa', name: 'Delhi Public School', timezone: 'Asia/Kolkata' },
      student: { id: 'student-2222-bbbb', fullName: 'Aarav Sharma' },
      parent: { id: 'parent-3333-cccc', fullName: 'Raj Sharma', phone: '+919876543210' },
      activeTrip: { id: 'trip-4444-dddd', busNumber: 'DL-01-AB-1234' },
      pickupStop: { id: 'stop-5555-eeee', stopName: 'Sector 14' },
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    next();
  },
}));

vi.mock('../src/services/student-journey.service.js', () => ({
  StudentJourneyService: {
    getStudentJourneyTimeline: vi.fn(),
    getStudentMultiTripHistory: vi.fn(),
  },
}));

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
vi.mock('../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { StudentJourneyService } from '../src/services/student-journey.service.js';
import app from '../src/app.js';

const SCHOOL_ID = 'school-1111-aaaa';
const STUDENT_ID = 'student-2222-bbbb';

function makeAdminToken(schoolId = SCHOOL_ID) {
  return (
    'Bearer ' +
    Buffer.from(
      JSON.stringify({ id: 'admin-0001', schoolId, role: 'SCHOOL_ADMIN' })
    ).toString('base64')
  );
}

const mockMultiTripResponse = {
  student: {
    id: STUDENT_ID,
    fullName: 'Aarav Sharma',
    admissionNumber: 'DPS-2024-001',
    classGrade: '5',
    section: 'A',
    emergencyPhone: '+919876543210',
  },
  summary: {
    totalTrips: 2,
    totalBoarded: 2,
    totalAbsent: 0,
    totalDeboarded: 2,
    attendanceRatePercent: 100,
    lastRodeAt: '2026-11-01T08:05:00.000Z',
  },
  trips: [
    {
      tripId: 'trip-1111',
      scheduledDate: '2026-11-01',
      routeType: 'MORNING_PICKUP',
      routeName: 'North Route A',
      routeCode: 'NR-A',
      busNumber: 'BUS-12',
      registrationNumber: 'DL-01-AB-1234',
      driverName: 'Ramesh Kumar',
      driverPhone: '+919811111111',
      tripStatus: 'COMPLETED',
      currentStage: 'DROPPED',
      stages: [
        {
          stage: 'PICKUP',
          title: 'Pickup Scheduled',
          status: 'COMPLETED',
          timestamp: '07:30 AM',
          description: 'Sector 14',
          stopName: 'Sector 14',
          stopSequence: 1,
        },
        {
          stage: 'BUS_ARRIVAL',
          title: 'Bus Arrival',
          status: 'COMPLETED',
          timestamp: '2026-11-01T07:29:00.000Z',
          description: 'Bus arrived at Sector 14',
        },
        {
          stage: 'BOARDING',
          title: 'Boarded',
          status: 'COMPLETED',
          timestamp: '2026-11-01T07:31:00.000Z',
          description: 'Student safely boarded the bus',
        },
        {
          stage: 'ON_ROUTE',
          title: 'On Route',
          status: 'COMPLETED',
          description: 'Transit completed',
        },
        {
          stage: 'SCHOOL_ARRIVAL',
          title: 'School Arrival',
          status: 'COMPLETED',
          timestamp: '2026-11-01T08:00:00.000Z',
          description: 'Bus reached destination campus',
        },
        {
          stage: 'DROPPED',
          title: 'Safely Dropped',
          status: 'COMPLETED',
          timestamp: '2026-11-01T08:05:00.000Z',
          description: 'Deboarded safely at school',
        },
      ],
      attendance: {
        boardingStatus: 'BOARDED',
        boardedAt: '2026-11-01T07:31:00.000Z',
        pickupStopName: 'Sector 14',
        pickupStopSequence: 1,
        boardingMarkedBy: 'Ramesh Kumar',
        dropStatus: 'DEBOARDED',
        droppedAt: '2026-11-01T08:05:00.000Z',
        dropStopName: 'School Campus',
        dropStopSequence: 10,
        dropMarkedBy: 'Ramesh Kumar',
      },
      corrections: [],
    },
  ],
  totalCount: 1,
};

describe('Student Journey History API (Micro-phase 32.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Route 120 — GET /api/v1/schools/:schoolId/students/:studentId/journey/history', () => {
    it('returns 200 with multi-trip transport and attendance history', async () => {
      vi.mocked(StudentJourneyService.getStudentMultiTripHistory).mockResolvedValueOnce(
        mockMultiTripResponse as any
      );

      const res = await request(app)
        .get(`/api/v1/schools/${SCHOOL_ID}/students/${STUDENT_ID}/journey/history`)
        .set('Authorization', makeAdminToken())
        .query({ limit: 10, offset: 0 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.student.id).toBe(STUDENT_ID);
      expect(res.body.data.summary.totalTrips).toBe(2);
      expect(res.body.data.summary.attendanceRatePercent).toBe(100);
      expect(res.body.data.trips).toHaveLength(1);
      expect(res.body.data.trips[0].attendance.boardingStatus).toBe('BOARDED');
      expect(res.body.data.trips[0].stages).toHaveLength(6);
    });

    it('passes date filter query parameters to domain service', async () => {
      vi.mocked(StudentJourneyService.getStudentMultiTripHistory).mockResolvedValueOnce(
        mockMultiTripResponse as any
      );

      const res = await request(app)
        .get(`/api/v1/schools/${SCHOOL_ID}/students/${STUDENT_ID}/journey/history`)
        .set('Authorization', makeAdminToken())
        .query({ startDate: '2026-11-01', endDate: '2026-11-07', limit: 25, offset: 5 });

      expect(res.status).toBe(200);
      expect(StudentJourneyService.getStudentMultiTripHistory).toHaveBeenCalledWith(
        SCHOOL_ID,
        STUDENT_ID,
        {
          startDate: '2026-11-01',
          endDate: '2026-11-07',
          limit: 25,
          offset: 5,
        }
      );
    });

    it('propagates domain NotFoundError with 404 status', async () => {
      const { NotFoundError } = await import('../src/middlewares/error.middleware.js');
      vi.mocked(StudentJourneyService.getStudentMultiTripHistory).mockRejectedValueOnce(
        new NotFoundError(`Student ${STUDENT_ID} not found in this school`)
      );

      const res = await request(app)
        .get(`/api/v1/schools/${SCHOOL_ID}/students/${STUDENT_ID}/journey/history`)
        .set('Authorization', makeAdminToken());

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('not found');
    });
  });

  describe('Parent Route — GET /api/v1/parent/journey/history/:token', () => {
    it('returns 200 with student journey history for the authenticated parent token', async () => {
      vi.mocked(StudentJourneyService.getStudentMultiTripHistory).mockResolvedValueOnce(
        mockMultiTripResponse as any
      );

      const res = await request(app)
        .get('/api/v1/parent/journey/history/valid-test-token')
        .query({ limit: 10 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.student.fullName).toBe('Aarav Sharma');
      expect(res.body.data.summary.totalBoarded).toBe(2);
      expect(StudentJourneyService.getStudentMultiTripHistory).toHaveBeenCalledWith(
        'school-1111-aaaa',
        'student-2222-bbbb',
        expect.objectContaining({ limit: 10 })
      );
    });
  });
});
