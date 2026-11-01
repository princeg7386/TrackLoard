/**
 * student-absence-system-response.test.ts — Phase 33.2: Student Not Going Today (System Response)
 *
 * Covers:
 *   1. Mark transport absence: Synchronizing absence records with boarding_events for active/scheduled trips
 *   2. Notify school & driver: Dispatching driver WhatsApp alert and recording operational audit log
 *   3. Update driver's student list: Flagging isAbsentToday in DriverAttendanceService, WhatsApp student roster, and PickupArrivalService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────
vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
vi.mock('../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/services/messaging/messaging.service.js', () => ({
  MessagingService: {
    sendMessage: vi.fn().mockResolvedValue({ status: 'sent', messageId: 'msg-mock-123' }),
  },
}));

import { query } from '../src/config/database.js';
import { MessagingService } from '../src/services/messaging/messaging.service.js';
import { StudentAbsenceService } from '../src/services/student-absence.service.js';
import { DriverAttendanceService } from '../src/services/driver-attendance.service.js';
import { PickupArrivalService } from '../src/services/pickup-arrival.service.js';
import { AttendanceStatus } from '@school-bus/shared';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockSendMessage = MessagingService.sendMessage as unknown as ReturnType<typeof vi.fn>;

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';
const STUDENT_ID = '22222222-2222-2222-2222-222222222222';
const TRIP_ID = '33333333-3333-3333-3333-333333333333';
const ROUTE_ID = '44444444-4444-4444-4444-444444444444';
const STOP_ID = '55555555-5555-5555-5555-555555555555';
const DRIVER_PHONE = '+919811122233';
const PARENT_PHONE = '+919876543210';

describe('Phase 33.2 — Student Absence System Response', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Task 1 & 2: Mark transport absence & notify driver/school', () => {
    it('synchronizes boarding_events with ABSENT state and dispatches WhatsApp alert to assigned driver', async () => {
      const today = new Date().toISOString().slice(0, 10);

      // 1. Student check query
      mockQuery.mockResolvedValueOnce([
        {
          id: STUDENT_ID,
          full_name: 'Vihaan Verma',
          admission_number: 'ADM-101',
          class_grade: '6',
          section: 'C',
        },
      ]);

      // 2. Absence record upsert query
      mockQuery.mockResolvedValueOnce([
        {
          id: 'abs-record-1',
          school_id: SCHOOL_ID,
          student_id: STUDENT_ID,
          absence_date: today,
          trip_type: 'FULL_DAY',
          reported_via: 'PARENT_WEB',
          reported_by_phone: PARENT_PHONE,
          reason: 'Severe migraine',
          driver_notified: false,
          created_at: new Date().toISOString(),
        },
      ]);

      // 3. Student assignment query (stop & route)
      mockQuery.mockResolvedValueOnce([
        {
          stop_id: STOP_ID,
          stop_name: 'Sector 21 Community Center',
          route_id: ROUTE_ID,
        },
      ]);

      // 4. Active trip query for the route
      mockQuery.mockResolvedValueOnce([
        {
          trip_id: TRIP_ID,
          driver_id: 'driver-uuid-1',
          driver_phone: DRIVER_PHONE,
          driver_name: 'Harpreet Singh',
        },
      ]);

      // 5. Boarding events sync upsert query
      mockQuery.mockResolvedValueOnce([]);

      // 6. Update driver_notified = true in absence_records
      mockQuery.mockResolvedValueOnce([]);

      // 7. Audit log insertion
      mockQuery.mockResolvedValueOnce([]);

      const result = await StudentAbsenceService.recordAbsence({
        schoolId: SCHOOL_ID,
        studentId: STUDENT_ID,
        absenceDate: today,
        tripType: 'FULL_DAY',
        reportedVia: 'PARENT_WEB',
        reportedByPhone: PARENT_PHONE,
        reason: 'Severe migraine',
      });

      expect(result.id).toBe('abs-record-1');
      expect(result.driverNotified).toBe(true);

      // Verify driver WhatsApp notification call
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientRole: 'DRIVER',
          recipientPhone: DRIVER_PHONE,
          schoolId: SCHOOL_ID,
          directText: expect.stringContaining('Vihaan Verma'),
        })
      );

      // Verify boarding_events sync query was called
      const syncCall = mockQuery.mock.calls.find((call) =>
        typeof call[0] === 'string' && call[0].includes('INSERT INTO boarding_events')
      );
      expect(syncCall).toBeDefined();
      expect(syncCall![1]).toEqual([SCHOOL_ID, TRIP_ID, STUDENT_ID, STOP_ID]);

      // Verify audit_logs query was called
      const auditCall = mockQuery.mock.calls.find((call) =>
        typeof call[0] === 'string' && call[0].includes('INSERT INTO audit_logs')
      );
      expect(auditCall).toBeDefined();
      expect(auditCall![0]).toContain('STUDENT_ABSENCE_RECORDED');
    });

    it('cancels absence, cleans up synced boarding event, and logs withdrawal in audit trail', async () => {
      const today = new Date().toISOString().slice(0, 10);

      // 1. Delete absence record query
      mockQuery.mockResolvedValueOnce([
        {
          id: 'abs-record-1',
          absence_date: today,
          trip_type: 'FULL_DAY',
        },
      ]);

      // 2. Delete synced boarding_events
      mockQuery.mockResolvedValueOnce([]);

      // 3. Audit log withdrawal query
      mockQuery.mockResolvedValueOnce([]);

      const res = await StudentAbsenceService.cancelAbsence(SCHOOL_ID, STUDENT_ID, 'abs-record-1');
      expect(res.cancelled).toBe(true);

      // Verify cleanup of boarding_events where scan_method = PARENT_ABSENCE
      const cleanCall = mockQuery.mock.calls.find((call) =>
        typeof call[0] === 'string' && call[0].includes('DELETE FROM boarding_events')
      );
      expect(cleanCall).toBeDefined();
      expect(cleanCall![0]).toContain("scan_method = 'PARENT_ABSENCE'");
    });
  });

  describe("Task 3: Update driver's student list & roster", () => {
    it('getDriverStudentList flags absent student, marks status ABSENT, and increments absentCount', async () => {
      // 1. Trip query
      mockQuery.mockResolvedValueOnce([
        {
          id: TRIP_ID,
          school_id: SCHOOL_ID,
          bus_id: 'bus-1',
          route_id: ROUTE_ID,
          driver_id: 'driver-1',
          bus_number: 'DL-01-AB-1234',
          registration_number: 'DL-01-AB-1234',
          route_name: 'North Route',
          route_code: 'R-01',
        },
      ]);

      // 2. Students query with absence_records joined
      mockQuery.mockResolvedValueOnce([
        {
          student_id: STUDENT_ID,
          admission_number: 'ADM-101',
          full_name: 'Vihaan Verma',
          grade: '6',
          section: 'C',
          emergency_phone: '+919876543210',
          pickup_stop_id: STOP_ID,
          pickup_stop_name: 'Sector 21',
          pickup_sequence_order: 1,
          pickup_expected_offset: null,
          pickup_latitude: 28.61,
          pickup_longitude: 77.21,
          pickup_address: null,
          drop_stop_id: null,
          drop_stop_name: null,
          drop_sequence_order: null,
          drop_expected_offset: null,
          drop_latitude: null,
          drop_longitude: null,
          drop_address: null,
          parent_full_name: 'Geeta Verma',
          parent_phone: PARENT_PHONE,
          parent_relationship: 'Mother',
          boarding_status: null,
          boarded_at: null,
          boarding_marked_by: null,
          drop_status: null,
          dropped_at: null,
          drop_marked_by: null,
          absence_id: 'abs-record-1',
          absence_reason: 'Viral fever',
          absence_trip_type: 'FULL_DAY',
        },
      ]);

      const res = await DriverAttendanceService.getStudentsForAssignedBus(
        SCHOOL_ID,
        { tripId: TRIP_ID }
      );

      expect(res.totalStudents).toBe(1);
      expect(res.absentCount).toBe(1);
      expect(res.pendingCount).toBe(0);
      expect(res.students[0].isAbsentToday).toBe(true);
      expect(res.students[0].absenceReason).toBe('Viral fever');
      expect(res.students[0].attendanceStatus).toBe(AttendanceStatus.ABSENT);
      expect(res.students[0].markedBy).toBe('PARENT');
    });

    it('formatWhatsAppStudentList clearly annotates absent students with NOT GOING TODAY banner', () => {
      const formatted = DriverAttendanceService.formatWhatsAppStudentList({
        busNumber: 'DL-01-AB-1234',
        routeName: 'North Route',
        routeCode: 'R-01',
        totalStudents: 1,
        boardedCount: 0,
        droppedCount: 0,
        absentCount: 1,
        pendingCount: 0,
        students: [
          {
            studentId: STUDENT_ID,
            admissionNumber: 'ADM-101',
            fullName: 'Vihaan Verma',
            grade: '6',
            section: 'C',
            pickupStop: {
              id: STOP_ID,
              name: 'Sector 21',
              sequenceOrder: 1,
              latitude: 28.61,
              longitude: 77.21,
            },
            attendanceStatus: AttendanceStatus.ABSENT,
            isAbsentToday: true,
            absenceReason: 'Viral fever',
          },
        ],
      });

      expect(formatted).toContain('Vihaan Verma');
      expect(formatted).toContain('[NOT GOING TODAY - Viral fever]');
      expect(formatted).toContain('❌');
    });

    it('PickupArrivalService marks upcoming absent student as ABSENT and excludes from totalPending', async () => {
      // 1. Trip query
      mockQuery.mockResolvedValueOnce([
        {
          id: TRIP_ID,
          school_id: SCHOOL_ID,
          route_id: ROUTE_ID,
          bus_id: 'bus-1',
          status: 'IN_TRANSIT',
          current_stop_sequence: 0,
        },
      ]);

      // 2. Stops query
      mockQuery.mockResolvedValueOnce([
        {
          id: STOP_ID,
          stop_name: 'Sector 21',
          sequence_order: 1,
          latitude: 28.61,
          longitude: 77.21,
          scheduled_time: '08:00:00',
          geofence_radius_meters: 50,
          geofence_status: 'INSIDE',
          stop_entered_at: '2026-11-01T08:00:00Z',
        },
      ]);

      // 3. Students at stop (1 absent student, 1 normal pending student)
      mockQuery.mockResolvedValueOnce([
        {
          student_id: STUDENT_ID,
          full_name: 'Vihaan Verma',
          admission_number: 'ADM-101',
          grade: '6',
          section: 'C',
          parent_phone: PARENT_PHONE,
          boarding_status: null,
          boarded_at: null,
          absence_id: 'abs-record-1',
          absence_reason: 'Migraine',
        },
        {
          student_id: 'student-regular-2',
          full_name: 'Rohan Mehra',
          admission_number: 'ADM-102',
          grade: '6',
          section: 'C',
          parent_phone: '+919811199999',
          boarding_status: null,
          boarded_at: null,
          absence_id: null,
          absence_reason: null,
        },
      ]);

      const upcoming = await PickupArrivalService.getUpcomingStudents(TRIP_ID, SCHOOL_ID);

      expect(upcoming.nextStop?.name).toBe('Sector 21');
      expect(upcoming.students).toHaveLength(2);

      // Vihaan is absent
      const absentStudent = upcoming.students.find((s) => s.studentId === STUDENT_ID);
      expect(absentStudent?.attendanceStatus).toBe('ABSENT');
      expect(absentStudent?.isAbsentToday).toBe(true);
      expect(absentStudent?.absenceReason).toBe('Migraine');

      // Rohan is pending
      const pendingStudent = upcoming.students.find((s) => s.studentId === 'student-regular-2');
      expect(pendingStudent?.attendanceStatus).toBe('PENDING');

      // Only 1 student is pending (absent student is excluded from totalPending!)
      expect(upcoming.totalPending).toBe(1);
    });
  });
});
