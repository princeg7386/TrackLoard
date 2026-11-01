/**
 * pickup-arrival-unit.test.ts — Phase 31.1: Upcoming Student Pickup (Unit)
 *
 * Tests: real PickupArrivalService + mock DB.
 * Covers: next stop resolution, student attendance mapping,
 * empty stop skipping, all-pickups-complete, inactive trip guard,
 * tenant isolation, and not-found handling.
 *
 * Do NOT import HTTP app here — HTTP tests are in pickup-arrival.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks (must hoist before service import) ─────────────────────────────────
vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
vi.mock('../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { query } from '../src/config/database.js';
import { PickupArrivalService } from '../src/services/pickup-arrival.service.js';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SCHOOL_ID = 'school-aaaa-1111';
const TRIP_ID   = 'trip-aaaa-1111';
const ROUTE_ID  = 'route-aaaa-1111';
const STOP_1_ID = 'stop-aaaa-0001';
const STOP_2_ID = 'stop-aaaa-0002';

function makeTripRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TRIP_ID,
    school_id: SCHOOL_ID,
    route_id: ROUTE_ID,
    status: 'IN_TRANSIT',
    current_stop_sequence: 0,
    ...overrides,
  };
}

function makeStopRow(seq: number, id = STOP_1_ID) {
  return {
    id,
    stop_name: `Stop ${seq}`,
    sequence_order: seq,
    latitude: 28.6,
    longitude: 77.2,
    scheduled_time: '07:30:00',
    geofence_radius_meters: 300,
  };
}

function makeStudentRow(overrides: Record<string, unknown> = {}) {
  return {
    student_id: 'student-0001',
    full_name: 'Aarav Sharma',
    admission_number: 'ADM-001',
    grade: '5',
    section: 'A',
    parent_phone: '+919876543210',
    boarding_status: null, // PENDING by default
    boarded_at: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => mockQuery.mockReset());

describe('PickupArrivalService.getUpcomingStudents', () => {
  it('returns next stop and pending students for active trip', async () => {
    mockQuery
      .mockResolvedValueOnce([makeTripRow()])          // trip
      .mockResolvedValueOnce([makeStopRow(1)])          // stops remaining
      .mockResolvedValueOnce([makeStudentRow()]);       // students at stop 1

    const result = await PickupArrivalService.getUpcomingStudents(TRIP_ID, SCHOOL_ID);

    expect(result.allPickupsComplete).toBe(false);
    expect(result.nextStop).not.toBeNull();
    expect(result.nextStop!.sequenceOrder).toBe(1);
    expect(result.nextStop!.name).toBe('Stop 1');
    expect(result.students).toHaveLength(1);
    expect(result.students[0]!.attendanceStatus).toBe('PENDING');
    expect(result.totalPending).toBe(1);
    expect(result.totalAtStop).toBe(1);
  });

  it('skips stops where all students are already BOARDED', async () => {
    mockQuery
      .mockResolvedValueOnce([makeTripRow()])
      .mockResolvedValueOnce([makeStopRow(1, STOP_1_ID), makeStopRow(2, STOP_2_ID)])
      // stop 1: all boarded
      .mockResolvedValueOnce([makeStudentRow({ boarding_status: 'BOARDED', boarded_at: '2026-11-01T07:30:00Z' })])
      // stop 2: has pending
      .mockResolvedValueOnce([makeStudentRow({ student_id: 'student-0002', full_name: 'Priya Singh' })]);

    const result = await PickupArrivalService.getUpcomingStudents(TRIP_ID, SCHOOL_ID);

    expect(result.nextStop!.id).toBe(STOP_2_ID);
    expect(result.nextStop!.sequenceOrder).toBe(2);
    expect(result.totalPending).toBe(1);
  });

  it('skips stops that have no student assignments', async () => {
    mockQuery
      .mockResolvedValueOnce([makeTripRow()])
      .mockResolvedValueOnce([makeStopRow(1, STOP_1_ID), makeStopRow(2, STOP_2_ID)])
      .mockResolvedValueOnce([])   // stop 1: no students
      .mockResolvedValueOnce([makeStudentRow()]); // stop 2: pending student

    const result = await PickupArrivalService.getUpcomingStudents(TRIP_ID, SCHOOL_ID);

    expect(result.nextStop!.id).toBe(STOP_2_ID);
  });

  it('returns allPickupsComplete = true when all stops have been served', async () => {
    mockQuery
      .mockResolvedValueOnce([makeTripRow({ current_stop_sequence: 99 })])
      .mockResolvedValueOnce([]); // no remaining stops

    const result = await PickupArrivalService.getUpcomingStudents(TRIP_ID, SCHOOL_ID);

    expect(result.allPickupsComplete).toBe(true);
    expect(result.nextStop).toBeNull();
    expect(result.students).toHaveLength(0);
    expect(result.totalPending).toBe(0);
  });

  it('returns allPickupsComplete = true when remaining stops all have no pending students', async () => {
    mockQuery
      .mockResolvedValueOnce([makeTripRow()])
      .mockResolvedValueOnce([makeStopRow(1)])
      .mockResolvedValueOnce([
        makeStudentRow({ boarding_status: 'BOARDED', boarded_at: '2026-11-01T07:30:00Z' }),
        makeStudentRow({ student_id: 'student-0002', boarding_status: 'ABSENT', boarded_at: null }),
      ]);

    const result = await PickupArrivalService.getUpcomingStudents(TRIP_ID, SCHOOL_ID);

    expect(result.allPickupsComplete).toBe(true);
    expect(result.nextStop).toBeNull();
  });

  it('throws NotFoundError when trip not found', async () => {
    mockQuery.mockResolvedValueOnce([]); // no trip row

    await expect(
      PickupArrivalService.getUpcomingStudents('nonexistent-trip', SCHOOL_ID)
    ).rejects.toThrow('not found');
  });

  it('throws BadRequestError when trip is SCHEDULED (not active)', async () => {
    mockQuery.mockResolvedValueOnce([makeTripRow({ status: 'SCHEDULED' })]);

    await expect(
      PickupArrivalService.getUpcomingStudents(TRIP_ID, SCHOOL_ID)
    ).rejects.toThrow(/not active/i);
  });

  it('throws BadRequestError when trip is COMPLETED', async () => {
    mockQuery.mockResolvedValueOnce([makeTripRow({ status: 'COMPLETED' })]);

    await expect(
      PickupArrivalService.getUpcomingStudents(TRIP_ID, SCHOOL_ID)
    ).rejects.toThrow(/not active/i);
  });

  it('accepts DELAYED trip as active', async () => {
    mockQuery
      .mockResolvedValueOnce([makeTripRow({ status: 'DELAYED' })])
      .mockResolvedValueOnce([makeStopRow(1)])
      .mockResolvedValueOnce([makeStudentRow()]);

    const result = await PickupArrivalService.getUpcomingStudents(TRIP_ID, SCHOOL_ID);

    expect(result.tripStatus).toBe('DELAYED');
    expect(result.allPickupsComplete).toBe(false);
  });

  it('enforces school_id as $2 in trip query for tenant isolation', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await expect(
      PickupArrivalService.getUpcomingStudents(TRIP_ID, SCHOOL_ID)
    ).rejects.toThrow();

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('school_id = $2');
    expect(params[1]).toBe(SCHOOL_ID);
  });

  it('maps ABSENT boarding status correctly', async () => {
    mockQuery
      .mockResolvedValueOnce([makeTripRow()])
      .mockResolvedValueOnce([makeStopRow(1)])
      .mockResolvedValueOnce([
        makeStudentRow({ student_id: 'stu-pending', boarding_status: null }),
        makeStudentRow({ student_id: 'stu-absent', boarding_status: 'ABSENT' }),
      ]);

    const result = await PickupArrivalService.getUpcomingStudents(TRIP_ID, SCHOOL_ID);

    const pending = result.students.find((s) => s.studentId === 'stu-pending');
    const absent  = result.students.find((s) => s.studentId === 'stu-absent');

    expect(pending?.attendanceStatus).toBe('PENDING');
    expect(absent?.attendanceStatus).toBe('ABSENT');
    // Only the pending student counts toward totalPending
    expect(result.totalPending).toBe(1);
    expect(result.totalAtStop).toBe(2);
  });

  it('returns currentStopSequence from trip row', async () => {
    mockQuery
      .mockResolvedValueOnce([makeTripRow({ current_stop_sequence: 3 })])
      .mockResolvedValueOnce([makeStopRow(4)])
      .mockResolvedValueOnce([makeStudentRow()]);

    const result = await PickupArrivalService.getUpcomingStudents(TRIP_ID, SCHOOL_ID);

    expect(result.currentStopSequence).toBe(3);
    expect(result.nextStop!.sequenceOrder).toBe(4);
  });
});
