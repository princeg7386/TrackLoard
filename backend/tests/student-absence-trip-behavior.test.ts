/**
 * Micro-Phase 33.3: Student Not Going Today — Trip Behavior & Audit Record Tests
 *
 * Tasks:
 * 1. Do not expect boarding alert for absent student:
 *    - Suppress boarding expectation, arrival alerts, approach alerts for absent students
 *    - Suppress missing student / missed boarding alerts for absent students
 *    - Journey timeline reflects absence recorded and boarding not expected
 * 2. Keep audit record:
 *    - BOARDING_SUPPRESSED_ABSENCE immutable audit logs
 *    - School admin absence audit ledger endpoint & operational summary
 *    - Admin phone absence recording with SCHOOL_ADMIN audit trail
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '@school-bus/shared';
import * as database from '../src/config/database.js';
import { MessagingService } from '../src/services/messaging/messaging.service.js';
import { ParentNotificationService } from '../src/services/parent-notification.service.js';
import { GeofenceNotificationService } from '../src/services/geofence-notification.service.js';
import { StudentJourneyService } from '../src/services/student-journey.service.js';
import { StudentAbsenceService } from '../src/services/student-absence.service.js';
import apiRouter from '../src/routes/api.routes.js';

// Mocks
vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('../src/services/messaging/messaging.service.js', () => ({
  MessagingService: {
    sendMessage: vi.fn().mockResolvedValue({ messageId: 'msg-mock-123', status: 'SENT' }),
  },
}));

vi.mock('../src/config/env.js', () => ({
  env: {
    JWT_SECRET: 'test-jwt-secret-key-32-chars-minimum-length!',
    JWT_EXPIRY: '1h',
    PARENT_TRACKING_BASE_URL: 'https://track.schoolbus.internal',
    DATABASE_URL: 'postgres://test:test@localhost:5432/testdb',
    NODE_ENV: 'test',
  },
}));

function generateAdminToken(schoolId: string, role: string = UserRole.SCHOOL_ADMIN): string {
  return jwt.sign(
    {
      id: 'admin-uuid-1',
      userId: 'admin-uuid-1',
      schoolId,
      role,
      userRole: role,
      roles: [role],
    },
    'test-jwt-secret-key-32-chars-minimum-length!',
    { expiresIn: '1h' }
  );
}

describe('Phase 33.3: Trip Behavior for Absent Student & Audit Ledger', () => {
  const schoolId = '11111111-1111-1111-1111-111111111111';
  const tripId = '22222222-2222-2222-2222-222222222222';
  const stopId = '33333333-3333-3333-3333-333333333333';
  const studentId = '44444444-4444-4444-4444-444444444444';
  const parentId = '55555555-5555-5555-5555-555555555555';

  const app = express();
  app.use(express.json());
  app.use('/api/v1', apiRouter);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('1. Parent Arrival & Approach Notification Suppression', () => {
    const mockAbsentCandidateRow = {
      tripId,
      schoolId,
      busNumber: 'DL-01-AB-1234',
      routeName: 'Morning Route 4',
      parentId,
      parentPhone: '+919876543210',
      parentName: 'Sunita Sharma',
      studentId,
      studentName: 'Aarav Sharma',
      stopName: 'Green Park Main Gate',
      trackingToken: 'valid-token-xyz',
      notificationsEnabled: true,
      isAbsent: true,
      absenceReason: 'High fever and doctor appointment',
    };

    it('suppresses BUS_ARRIVED_STOP alert and creates audit log when student is marked absent', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      // 1st query: candidates with isAbsent: true
      mockQuery.mockResolvedValueOnce([mockAbsentCandidateRow]);
      // 2nd query: logSuppressedBoardingAlert audit insertion
      mockQuery.mockResolvedValueOnce([]);

      const result = await ParentNotificationService.notifyBusArrivedStop({
        schoolId,
        tripId,
        stopId,
        stopName: 'Green Park Main Gate',
      });

      expect(result.eventType).toBe('BUS_ARRIVED_STOP');
      expect(result.parentsChecked).toBe(1);
      expect(result.notificationsSent).toBe(0);
      expect(result.suppressedAbsent).toBe(1);
      expect(mockSend).not.toHaveBeenCalled();

      // Verify audit log call
      expect(mockQuery).toHaveBeenCalledTimes(2);
      const auditCall = mockQuery.mock.calls[1];
      expect(auditCall[0]).toContain('BOARDING_SUPPRESSED_ABSENCE');
      expect(auditCall[1]).toContain(schoolId);
      expect(auditCall[1]).toContain(studentId);
    });

    it('suppresses BUS_APPROACHING_10M alert when student is absent', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      mockQuery.mockResolvedValueOnce([mockAbsentCandidateRow]);
      mockQuery.mockResolvedValueOnce([]);

      const result = await ParentNotificationService.notifyApproaching10Min({
        schoolId,
        tripId,
        stopId,
        etaMinutes: 10,
      });

      expect(result.eventType).toBe('BUS_APPROACHING_10M');
      expect(result.notificationsSent).toBe(0);
      expect(result.suppressedAbsent).toBe(1);
      expect(mockSend).not.toHaveBeenCalled();

      const auditCall = mockQuery.mock.calls[1];
      expect(auditCall[0]).toContain('BOARDING_SUPPRESSED_ABSENCE');
    });

    it('suppresses BUS_APPROACHING_3M alert when student is absent', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      mockQuery.mockResolvedValueOnce([mockAbsentCandidateRow]);
      mockQuery.mockResolvedValueOnce([]);

      const result = await ParentNotificationService.notifyApproaching3Min({
        schoolId,
        tripId,
        stopId,
        etaMinutes: 3,
      });

      expect(result.eventType).toBe('BUS_APPROACHING_3M');
      expect(result.notificationsSent).toBe(0);
      expect(result.suppressedAbsent).toBe(1);
      expect(mockSend).not.toHaveBeenCalled();

      const auditCall = mockQuery.mock.calls[1];
      expect(auditCall[0]).toContain('BOARDING_SUPPRESSED_ABSENCE');
    });
  });

  describe('2. Geofence Missed Boarding Suppression', () => {
    it('skips sending missed boarding alert for students with active absence or ABSENT status', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      // Query returns student with boardingStatus = 'ABSENT'
      mockQuery.mockResolvedValueOnce([
        {
          parentId: 'parent-1',
          studentId: 'student-1',
          schoolId,
          parentPhone: '+919876543210',
          parentName: 'Sunita Sharma',
          studentName: 'Aarav Sharma',
          boardingStatus: 'ABSENT',
          trackingToken: 'token-123',
        },
      ]);

      const result = await GeofenceNotificationService.notifyMissedBoarding({
        tripId,
        stopId,
        schoolId,
        busId: 'bus-1',
        stopName: 'Green Park Main Gate',
      });

      expect(result.studentsAtStop).toBe(1);
      expect(result.alreadyBoarded).toBe(1); // Treated as handled/skipped
      expect(result.missedBoardingNotificationsSent).toBe(0);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('3. Student Journey Timeline Reflects Absence', () => {
    it('marks Boarding stage as SKIPPED and reflects that pickup is not expected when student is absent', async () => {
      const mockQuery = vi.mocked(database.query);

      // 1. Student check query
      mockQuery.mockResolvedValueOnce([{ id: studentId }]);

      // 2. Journey query returning absent record
      mockQuery.mockResolvedValueOnce([
        {
          student_id: studentId,
          full_name: 'Aarav Sharma',
          admission_number: 'ADM-001',
          grade: '5',
          section: 'A',
          emergency_phone: '+919876543210',
          parent_name: 'Sunita Sharma',
          parent_phone: '+919876543210',
          trip_id: tripId,
          trip_status: 'IN_TRANSIT',
          current_stop_sequence: 2,
          scheduled_date: '2026-11-01',
          bus_number: 'DL-01-AB-1234',
          registration_number: 'DL-01-AB-1234',
          route_name: 'Morning Route 4',
          route_code: 'MR-4',
          route_type: 'MORNING_PICKUP',
          driver_name: 'Rajesh Kumar',
          driver_phone: '+919811122233',
          pickup_stop_id: stopId,
          pickup_stop_name: 'Green Park Gate',
          pickup_stop_sequence: 1,
          pickup_scheduled_time: '07:30:00',
          pickup_lat: 28.55,
          pickup_lng: 77.20,
          drop_stop_id: 'drop-stop-1',
          drop_stop_name: 'DPS RK Puram',
          drop_stop_sequence: 5,
          drop_lat: 28.56,
          drop_lng: 77.18,
          pickup_geofence_status: 'OUTSIDE',
          pickup_bus_arrived_at: null,
          boarding_event_id: null,
          boarding_status: null,
          boarded_at: null,
          boarding_marked_by: null,
          boarding_lat: null,
          boarding_lng: null,
          drop_event_id: null,
          drop_status: null,
          dropped_at: null,
          drop_marked_by: null,
          drop_lat_recorded: null,
          drop_lng_recorded: null,
          school_arrival_at: null,
          absence_record_id: 'absence-rec-1',
          absence_reason: 'Viral fever',
          absence_reported_via: 'PARENT_WEB',
        },
      ]);

      // 3. Corrections query
      mockQuery.mockResolvedValueOnce([]);

      const journey = await StudentJourneyService.getStudentJourneyTimeline(schoolId, studentId, tripId);

      expect(journey).toBeDefined();
      expect(journey.stages).toHaveLength(6);

      // Stage 1: Pickup
      const pickupStage = journey.stages.find((s) => s.stage === 'PICKUP');
      expect(pickupStage?.description).toContain('Pickup not expected - student absent today');

      // Stage 2: Bus Arrival
      const arrivalStage = journey.stages.find((s) => s.stage === 'BUS_ARRIVAL');
      expect(arrivalStage?.description).toContain('Pickup skipped - student absent');

      // Stage 3: Boarding
      const boardingStage = journey.stages.find((s) => s.stage === 'BOARDING');
      expect(boardingStage?.status).toBe('SKIPPED');
      expect(boardingStage?.title).toBe('Not Boarded (ABSENT)');
      expect(boardingStage?.description).toContain('Absence recorded: Viral fever (Not traveling today)');

      // Subsequent stages skipped
      const onRouteStage = journey.stages.find((s) => s.stage === 'ON_ROUTE');
      expect(onRouteStage?.status).toBe('SKIPPED');
      const schoolArrivalStage = journey.stages.find((s) => s.stage === 'SCHOOL_ARRIVAL');
      expect(schoolArrivalStage?.status).toBe('SKIPPED');
      const dropStage = journey.stages.find((s) => s.stage === 'DROPPED');
      expect(dropStage?.status).toBe('SKIPPED');
    });
  });

  describe('4. School Admin Absence Audit Ledger & API Endpoints', () => {
    it('retrieves absence audit ledger with suppressed alerts counts', async () => {
      const mockQuery = vi.mocked(database.query);

      // 1. Absence rows with suppressed alert counts
      mockQuery.mockResolvedValueOnce([
        {
          id: 'abs-1',
          school_id: schoolId,
          student_id: studentId,
          student_name: 'Aarav Sharma',
          admission_number: 'ADM-001',
          class_grade: '5',
          section: 'A',
          absence_date: '2026-11-01',
          trip_type: 'FULL_DAY',
          reported_via: 'PARENT_WEB',
          reported_by_phone: '+919876543210',
          reason: 'Fever',
          driver_notified: true,
          created_at: '2026-11-01T06:30:00.000Z',
          suppressed_alerts_count: '2',
        },
      ]);
      // 2. Count matching filter
      mockQuery.mockResolvedValueOnce([{ total: '1' }]);
      // 3. Today absent summary
      mockQuery.mockResolvedValueOnce([{ cnt: '1' }]);
      // 4. Suppressed today summary
      mockQuery.mockResolvedValueOnce([{ cnt: '2' }]);

      const ledger = await StudentAbsenceService.getSchoolAbsenceAuditLedger(schoolId, {
        date: '2026-11-01',
      });

      expect(ledger.absences).toHaveLength(1);
      expect(ledger.absences[0].studentName).toBe('Aarav Sharma');
      expect(ledger.absences[0].suppressedAlertsCount).toBe(2);
      expect(ledger.totalCount).toBe(1);
      expect(ledger.totalAbsentToday).toBe(1);
      expect(ledger.totalSuppressedAlertsToday).toBe(2);
    });

    it('GET /api/v1/schools/:schoolId/absences returns 200 for authenticated School Admin', async () => {
      const mockQuery = vi.mocked(database.query);
      const token = generateAdminToken(schoolId);

      // 1. Absence rows
      mockQuery.mockResolvedValueOnce([
        {
          id: 'abs-1',
          school_id: schoolId,
          student_id: studentId,
          student_name: 'Aarav Sharma',
          admission_number: 'ADM-001',
          class_grade: '5',
          section: 'A',
          absence_date: '2026-11-01',
          trip_type: 'FULL_DAY',
          reported_via: 'WHATSAPP',
          reported_by_phone: '+919876543210',
          reason: 'Family wedding',
          driver_notified: true,
          created_at: '2026-11-01T06:00:00.000Z',
          suppressed_alerts_count: '1',
        },
      ]);
      // 2. Total count
      mockQuery.mockResolvedValueOnce([{ total: '1' }]);
      // 3. Today absent
      mockQuery.mockResolvedValueOnce([{ cnt: '1' }]);
      // 4. Suppressed today
      mockQuery.mockResolvedValueOnce([{ cnt: '1' }]);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolId}/absences`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.absences).toHaveLength(1);
      expect(res.body.data.totalAbsentToday).toBe(1);
    });

    it('POST /api/v1/schools/:schoolId/absences allows admin to record phone absence', async () => {
      const mockQuery = vi.mocked(database.query);
      const token = generateAdminToken(schoolId);

      // 1. Verify student exists
      mockQuery.mockResolvedValueOnce([
        {
          id: studentId,
          full_name: 'Aarav Sharma',
          admission_number: 'ADM-001',
          class_grade: '5',
          section: 'A',
        },
      ]);
      // 2. Upsert absence_records
      mockQuery.mockResolvedValueOnce([
        {
          id: 'abs-admin-1',
          school_id: schoolId,
          student_id: studentId,
          absence_date: '2026-11-01',
          trip_type: 'FULL_DAY',
          reported_via: 'ADMIN_PHONE',
          reported_by_phone: '+919876543210',
          reason: '[Admin Desk] Parent called coordinator',
          driver_notified: false,
          created_at: new Date().toISOString(),
        },
      ]);
      // 3. Stop assignments
      mockQuery.mockResolvedValueOnce([]);
      // 4. Audit log
      mockQuery.mockResolvedValueOnce([]);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolId}/absences`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          studentId,
          absenceDate: '2026-11-01',
          tripType: 'FULL_DAY',
          reason: 'Parent called coordinator',
          reportedByPhone: '+919876543210',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reportedVia).toBe('ADMIN_PHONE');
    });

    it('enforces tenant isolation and forbids access from a different school token', async () => {
      const foreignSchoolId = '99999999-9999-9999-9999-999999999999';
      const foreignToken = generateAdminToken(foreignSchoolId);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolId}/absences`)
        .set('Authorization', `Bearer ${foreignToken}`);

      expect(res.status).toBe(403);
    });
  });
});
