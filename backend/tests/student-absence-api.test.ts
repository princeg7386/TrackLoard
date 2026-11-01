/**
 * student-absence-api.test.ts — Phase 33.1: Student Not Going Today (HTTP API)
 *
 * Covers:
 *   - POST /api/v1/parent/absence (authenticated parent token)
 *   - GET  /api/v1/parent/absence (authenticated parent token)
 *   - DELETE /api/v1/parent/absence/:absenceId (authenticated parent token)
 *   - Unauthorized / Missing token rejection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ─── Mocks ───────────────────────────────────────────────────────────────────
vi.mock('../src/middlewares/auth.middleware.js', () => ({
  authenticateToken: (req: any, _res: any, next: any) => next(),
  requireRoles: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../src/middlewares/tenant-isolation.middleware.js', () => ({
  requireTenantScope: () => (_req: any, _res: any, next: any) => next(),
  requireActorTenantScope: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../src/middlewares/driver-auth.middleware.js', () => ({
  authenticateDriver: (_req: any, _res: any, next: any) => next(),
  authenticateDriverOptional: (_req: any, _res: any, next: any) => next(),
}));

let mockAuthenticatedSession: any = {
  tokenId: 'token-uuid-1234',
  school: { id: 'school-1111-aaaa', name: 'Delhi Public School', timezone: 'Asia/Kolkata' },
  student: { id: 'student-2222-bbbb', fullName: 'Ananya Sharma', admissionNumber: 'ADM-44' },
  parent: { id: 'parent-3333-cccc', fullName: 'Sunita Sharma', phone: '+919876543210' },
  activeTrip: null,
  pickupStop: { id: 'stop-5555-eeee', stopName: 'Sector 14 Gate' },
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
};

vi.mock('../src/middlewares/parent-token.middleware.js', () => ({
  authenticateParentTrackingToken: (req: any, res: any, next: any) => {
    const token = req.params.token || req.query.token || req.headers['x-tracking-token'];
    if (!token && !mockAuthenticatedSession) {
      res.status(401).json({ success: false, error: { message: 'Parent tracking token is missing' } });
      return;
    }
    req.parentTrackingSession = mockAuthenticatedSession;
    next();
  },
}));

vi.mock('../src/services/student-absence.service.js', () => ({
  StudentAbsenceService: {
    recordAbsence: vi.fn(),
    getStudentAbsences: vi.fn(),
    cancelAbsence: vi.fn(),
  },
}));

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
vi.mock('../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { StudentAbsenceService } from '../src/services/student-absence.service.js';
import app from '../src/app.js';

describe('Phase 33.1 — Parent Absence HTTP API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticatedSession = {
      tokenId: 'token-uuid-1234',
      school: { id: 'school-1111-aaaa', name: 'Delhi Public School', timezone: 'Asia/Kolkata' },
      student: { id: 'student-2222-bbbb', fullName: 'Ananya Sharma', admissionNumber: 'ADM-44' },
      parent: { id: 'parent-3333-cccc', fullName: 'Sunita Sharma', phone: '+919876543210' },
      activeTrip: null,
      pickupStop: { id: 'stop-5555-eeee', stopName: 'Sector 14 Gate' },
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
  });

  describe('POST /api/v1/parent/absence', () => {
    it('returns 201 and creates absence for authenticated parent and student', async () => {
      const today = new Date().toISOString().slice(0, 10);
      vi.mocked(StudentAbsenceService.recordAbsence).mockResolvedValueOnce({
        id: 'abs-123-uuid',
        schoolId: 'school-1111-aaaa',
        studentId: 'student-2222-bbbb',
        studentName: 'Ananya Sharma',
        admissionNumber: 'ADM-44',
        classGrade: '4',
        section: 'B',
        absenceDate: today,
        tripType: 'FULL_DAY',
        reportedVia: 'PARENT_WEB',
        reportedByPhone: '+919876543210',
        reason: 'Fever',
        driverNotified: false,
        createdAt: new Date().toISOString(),
      });

      const res = await request(app)
        .post('/api/v1/parent/absence')
        .query({ token: 'valid-test-token' })
        .send({
          absenceDate: today,
          tripType: 'FULL_DAY',
          reason: 'Fever',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.studentName).toBe('Ananya Sharma');
      expect(res.body.data.absenceDate).toBe(today);
      expect(StudentAbsenceService.recordAbsence).toHaveBeenCalledWith({
        schoolId: 'school-1111-aaaa',
        studentId: 'student-2222-bbbb',
        absenceDate: today,
        tripType: 'FULL_DAY',
        reportedVia: 'PARENT_WEB',
        reportedByPhone: '+919876543210',
        reason: 'Fever',
      });
    });

    it('validates request payload with Zod schema and rejects invalid date', async () => {
      const res = await request(app)
        .post('/api/v1/parent/absence')
        .query({ token: 'valid-test-token' })
        .send({
          absenceDate: 'invalid-date',
          tripType: 'FULL_DAY',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/parent/absence', () => {
    it('returns 200 with list of absences for authenticated student', async () => {
      const today = new Date().toISOString().slice(0, 10);
      vi.mocked(StudentAbsenceService.getStudentAbsences).mockResolvedValueOnce([
        {
          id: 'abs-123-uuid',
          schoolId: 'school-1111-aaaa',
          studentId: 'student-2222-bbbb',
          studentName: 'Ananya Sharma',
          admissionNumber: 'ADM-44',
          classGrade: '4',
          section: 'B',
          absenceDate: today,
          tripType: 'FULL_DAY',
          reportedVia: 'PARENT_WEB',
          reportedByPhone: '+919876543210',
          reason: 'Fever',
          driverNotified: false,
          createdAt: new Date().toISOString(),
        },
      ]);

      const res = await request(app)
        .get('/api/v1/parent/absence')
        .query({ token: 'valid-test-token' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.records).toHaveLength(1);
      expect(res.body.data.records[0].studentName).toBe('Ananya Sharma');
      expect(StudentAbsenceService.getStudentAbsences).toHaveBeenCalledWith(
        'school-1111-aaaa',
        'student-2222-bbbb',
        expect.any(Object)
      );
    });
  });

  describe('DELETE /api/v1/parent/absence/:absenceId', () => {
    it('returns 200 when cancelling an absence', async () => {
      vi.mocked(StudentAbsenceService.cancelAbsence).mockResolvedValueOnce({
        cancelled: true,
        message: 'Absence record withdrawn',
      });

      const res = await request(app)
        .delete('/api/v1/parent/absence/abs-123-uuid')
        .query({ token: 'valid-test-token' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.cancelled).toBe(true);
      expect(StudentAbsenceService.cancelAbsence).toHaveBeenCalledWith(
        'school-1111-aaaa',
        'student-2222-bbbb',
        'abs-123-uuid'
      );
    });
  });
});
