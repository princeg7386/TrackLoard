/**
 * student-journey-consistency.test.ts — Phase 32.3: Data Consistency
 *
 * Tests:
 *   1. One journey per trip/student (no Cartesian duplicate explosion on multi-parent or multi-stop assignments).
 *   2. Attendance consistency validator (StudentJourneyService.validateAttendanceConsistency).
 *   3. Prevent duplicate attendance events in DriverAttendanceService (idempotent duplicate submission, duplicate batch deduplication, conflict state rejection).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
vi.mock('../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/services/parent-notification.service.js', () => ({
  ParentNotificationService: {
    notifyStudentBoarded: vi.fn().mockResolvedValue(undefined),
    notifyStudentDropped: vi.fn().mockResolvedValue(undefined),
  },
}));

import { query } from '../src/config/database.js';
import { StudentJourneyService } from '../src/services/student-journey.service.js';
import { DriverAttendanceService } from '../src/services/driver-attendance.service.js';
import { ParentNotificationService } from '../src/services/parent-notification.service.js';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;

const SCHOOL_ID = 'school-1111-aaaa';
const STUDENT_ID = 'student-2222-bbbb';
const TRIP_ID = 'trip-3333-cccc';
const ROUTE_ID = 'route-4444-dddd';
const STOP_ID = 'stop-5555-eeee';

describe('Student Journey Data Consistency (Micro-phase 32.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. One journey per trip/student', () => {
    it('returns exactly one canonical journey record for a student on a trip', async () => {
      // 1. Student exists
      mockQuery.mockResolvedValueOnce([{ id: STUDENT_ID }]);
      // 2. Journey row with joined parents and canonical stop
      mockQuery.mockResolvedValueOnce([
        {
          student_id: STUDENT_ID,
          full_name: 'Aarav Sharma',
          admission_number: 'ADM-001',
          grade: '5',
          section: 'A',
          emergency_phone: '+919876543210',
          parent_name: 'Sunita Sharma',
          parent_phone: '+919876543210',
          trip_id: TRIP_ID,
          trip_status: 'IN_TRANSIT',
          current_stop_sequence: 1,
          scheduled_date: '2026-11-01',
          bus_number: 'BUS-07',
          registration_number: 'DL-01-AB-1234',
          route_name: 'North Route',
          route_code: 'R-01',
          route_type: 'MORNING_PICKUP',
          driver_name: 'Ramesh Kumar',
          driver_phone: '+919811122233',
          pickup_stop_id: STOP_ID,
          pickup_stop_name: 'Sector 14 Gate',
          pickup_stop_sequence: 1,
          pickup_scheduled_time: '07:30 AM',
          pickup_lat: 28.5,
          pickup_lng: 77.2,
          drop_stop_id: 'stop-drop-1',
          drop_stop_name: 'School Campus',
          drop_stop_sequence: 10,
          drop_lat: 28.6,
          drop_lng: 77.3,
          pickup_geofence_status: null,
          pickup_bus_arrived_at: null,
          boarding_event_id: 'be-01',
          boarding_status: 'BOARDED',
          boarded_at: '2026-11-01T07:32:00.000Z',
          boarding_marked_by: 'Ramesh Kumar',
          boarding_lat: 28.5001,
          boarding_lng: 77.2001,
          drop_event_id: null,
          drop_status: null,
          dropped_at: null,
          drop_marked_by: null,
          drop_lat_recorded: null,
          drop_lng_recorded: null,
          school_arrival_at: null,
        },
      ]);
      // 3. Corrections query
      mockQuery.mockResolvedValueOnce([]);

      const journey = await StudentJourneyService.getStudentJourneyTimeline(
        SCHOOL_ID,
        STUDENT_ID,
        TRIP_ID
      );

      expect(journey.student.id).toBe(STUDENT_ID);
      expect(journey.trip.id).toBe(TRIP_ID);
      expect(journey.currentStatus).toBe('IN_TRANSIT');
      expect(journey.stages).toHaveLength(6);
    });

    it('validateAttendanceConsistency returns isConsistent: true for valid single attendance trail', async () => {
      mockQuery
        .mockResolvedValueOnce([{ id: 'be-1', status: 'BOARDED', recorded_at: '2026-11-01T07:30:00Z' }]) // boarding
        .mockResolvedValueOnce([{ id: 'de-1', status: 'DEBOARDED', recorded_at: '2026-11-01T08:00:00Z' }]); // drop

      const result = await StudentJourneyService.validateAttendanceConsistency(TRIP_ID, STUDENT_ID);

      expect(result.isConsistent).toBe(true);
      expect(result.boardingCount).toBe(1);
      expect(result.dropCount).toBe(1);
      expect(result.hasConflictingStates).toBe(false);
      expect(result.violations).toHaveLength(0);
    });

    it('validateAttendanceConsistency flags contradictory states if student is marked absent and dropped', async () => {
      mockQuery
        .mockResolvedValueOnce([{ id: 'be-1', status: 'ABSENT', recorded_at: '2026-11-01T07:30:00Z' }]) // boarding absent
        .mockResolvedValueOnce([{ id: 'de-1', status: 'DEBOARDED', recorded_at: '2026-11-01T08:00:00Z' }]); // drop deboarded

      const result = await StudentJourneyService.validateAttendanceConsistency(TRIP_ID, STUDENT_ID);

      expect(result.isConsistent).toBe(false);
      expect(result.hasConflictingStates).toBe(true);
      expect(result.violations[0]).toContain('Contradictory attendance');
    });
  });

  describe('2. Prevent duplicate attendance events', () => {
    it('recordBoarding skips duplicate WhatsApp notification on idempotent identical status submission', async () => {
      // 1. Trip verification
      mockQuery.mockResolvedValueOnce([
        {
          id: TRIP_ID,
          school_id: SCHOOL_ID,
          bus_id: 'bus-1',
          route_id: ROUTE_ID,
          driver_id: 'driver-1',
          status: 'IN_TRANSIT',
        },
      ]);
      // 2. Student verification
      mockQuery.mockResolvedValueOnce([
        { id: STUDENT_ID, full_name: 'Aarav Sharma', admission_number: 'ADM-001', school_id: SCHOOL_ID },
      ]);
      // 3. Stop verification
      mockQuery.mockResolvedValueOnce([{ id: STOP_ID }]);
      // 4. Duplicate check: existing boarding event already marked BOARDED
      mockQuery.mockResolvedValueOnce([
        {
          id: 'be-existing',
          trip_id: TRIP_ID,
          student_id: STUDENT_ID,
          stop_id: STOP_ID,
          status: 'BOARDED',
          marked_by: 'DRIVER',
          latitude: 28.5,
          longitude: 77.2,
          recorded_at: '2026-11-01T07:30:00Z',
        },
      ]);
      // 5. Upsert returns row
      mockQuery.mockResolvedValueOnce([
        {
          id: 'be-existing',
          trip_id: TRIP_ID,
          student_id: STUDENT_ID,
          stop_id: STOP_ID,
          status: 'BOARDED',
          marked_by: 'DRIVER',
          latitude: 28.5,
          longitude: 77.2,
          recorded_at: '2026-11-01T07:30:00Z',
        },
      ]);
      // 6. Counts query
      mockQuery.mockResolvedValueOnce([
        { total_students: 20, boarded_count: 15, absent_count: 1 },
      ]);

      const res = await DriverAttendanceService.recordBoarding(SCHOOL_ID, {
        tripId: TRIP_ID,
        studentId: STUDENT_ID,
        stopId: STOP_ID,
        status: 'BOARDED',
      });

      expect(res.event.id).toBe('be-existing');
      expect(res.event.status).toBe('BOARDED');
      // Parent notification should NOT be re-dispatched for duplicate
      expect(ParentNotificationService.notifyStudentBoarded).not.toHaveBeenCalled();
    });

    it('recordBoarding rejects changing to ABSENT if student has already deboarded on this trip', async () => {
      // 1. Trip verification
      mockQuery.mockResolvedValueOnce([
        {
          id: TRIP_ID,
          school_id: SCHOOL_ID,
          bus_id: 'bus-1',
          route_id: ROUTE_ID,
          driver_id: 'driver-1',
          status: 'IN_TRANSIT',
        },
      ]);
      // 2. Student verification
      mockQuery.mockResolvedValueOnce([
        { id: STUDENT_ID, full_name: 'Aarav Sharma', admission_number: 'ADM-001', school_id: SCHOOL_ID },
      ]);
      // 3. Stop verification
      mockQuery.mockResolvedValueOnce([{ id: STOP_ID }]);
      // 4. Duplicate check: existing boarding
      mockQuery.mockResolvedValueOnce([]);
      // 5. Existing drop check: student already dropped!
      mockQuery.mockResolvedValueOnce([{ id: 'de-1', status: 'DEBOARDED' }]);

      await expect(
        DriverAttendanceService.recordBoarding(SCHOOL_ID, {
          tripId: TRIP_ID,
          studentId: STUDENT_ID,
          stopId: STOP_ID,
          status: 'ABSENT',
        })
      ).rejects.toThrow('Cannot mark student as ABSENT: student has already deboarded on this trip');
    });

    it('recordDrop rejects drop recording if student was marked ABSENT on this trip', async () => {
      // 1. Trip verification
      mockQuery.mockResolvedValueOnce([
        {
          id: TRIP_ID,
          school_id: SCHOOL_ID,
          bus_id: 'bus-1',
          route_id: ROUTE_ID,
          driver_id: 'driver-1',
          status: 'IN_TRANSIT',
        },
      ]);
      // 2. Student verification
      mockQuery.mockResolvedValueOnce([
        { id: STUDENT_ID, full_name: 'Aarav Sharma', admission_number: 'ADM-001', school_id: SCHOOL_ID },
      ]);
      // 3. Stop verification
      mockQuery.mockResolvedValueOnce([{ id: STOP_ID }]);
      // 4. Existing boarding check: student was marked ABSENT!
      mockQuery.mockResolvedValueOnce([{ id: 'be-1', status: 'ABSENT' }]);

      await expect(
        DriverAttendanceService.recordDrop(SCHOOL_ID, {
          tripId: TRIP_ID,
          studentId: STUDENT_ID,
          stopId: STOP_ID,
          status: 'DEBOARDED',
        })
      ).rejects.toThrow('Cannot record drop event: student was recorded as ABSENT on this trip');
    });

    it('recordBoardingBatch deduplicates multiple occurrences of the same studentId in the payload', async () => {
      // Mock final summary counts query in recordBoardingBatch
      mockQuery.mockResolvedValueOnce([
        { total_students: 10, boarded_count: 5, absent_count: 0 },
      ]);

      // Setup spy on recordBoarding
      const recordSpy = vi.spyOn(DriverAttendanceService, 'recordBoarding').mockResolvedValue({
        event: {
          id: 'be-1',
          tripId: TRIP_ID,
          studentId: STUDENT_ID,
          stopId: STOP_ID,
          status: 'BOARDED',
          markedBy: 'DRIVER',
          recordedAt: new Date().toISOString(),
        },
        counts: { totalStudents: 10, boardedCount: 5, absentCount: 0 },
        message: 'Success',
      });

      const batchPayload = {
        tripId: TRIP_ID,
        stopId: STOP_ID,
        records: [
          { studentId: STUDENT_ID, status: 'BOARDED' as const },
          { studentId: STUDENT_ID, status: 'BOARDED' as const }, // duplicate
          { studentId: 'student-3333-cccc', status: 'BOARDED' as const },
        ],
      };

      const res = await DriverAttendanceService.recordBoardingBatch(SCHOOL_ID, batchPayload);

      // Only 2 distinct students should be processed
      expect(recordSpy).toHaveBeenCalledTimes(2);
      expect(res.events).toHaveLength(2);

      recordSpy.mockRestore();
    });

    it('recordDropBatch deduplicates multiple occurrences of the same studentId in the payload', async () => {
      // Mock final summary counts query in recordDropBatch
      mockQuery.mockResolvedValueOnce([
        { total_students: 10, boarded_count: 5, dropped_count: 5, absent_count: 0 },
      ]);

      // Setup spy on recordDrop
      const recordSpy = vi.spyOn(DriverAttendanceService, 'recordDrop').mockResolvedValue({
        event: {
          id: 'de-1',
          tripId: TRIP_ID,
          studentId: STUDENT_ID,
          stopId: STOP_ID,
          status: 'DEBOARDED',
          markedBy: 'DRIVER',
          recordedAt: new Date().toISOString(),
        },
        counts: { totalStudents: 10, boardedCount: 5, droppedCount: 5, absentCount: 0 },
        message: 'Success',
      });

      const batchPayload = {
        tripId: TRIP_ID,
        stopId: STOP_ID,
        records: [
          { studentId: STUDENT_ID, status: 'DEBOARDED' as const },
          { studentId: STUDENT_ID, status: 'DEBOARDED' as const }, // duplicate
        ],
      };

      const res = await DriverAttendanceService.recordDropBatch(SCHOOL_ID, batchPayload);

      // Only 1 distinct student should be processed
      expect(recordSpy).toHaveBeenCalledTimes(1);
      expect(res.events).toHaveLength(1);

      recordSpy.mockRestore();
    });
  });
});
