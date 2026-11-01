/**
 * student-journey-unit.test.ts — Phase 32.1: Student Journey Timeline Record (Unit)
 *
 * Tests: StudentJourneyService logic with mock DB.
 * Covers: 6-stage lifecycle evaluation (Pickup, Bus arrival, Boarded/not boarded,
 * On route, School arrival, Dropped), absent student handling, corrections audit trail,
 * and tenant isolation.
 *
 * Do NOT import HTTP app here — HTTP tests live in student-journey.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────
vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
vi.mock('../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { query } from '../src/config/database.js';
import { StudentJourneyService } from '../src/services/student-journey.service.js';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;

const SCHOOL_ID = 'school-1111-aaaa';
const STUDENT_ID = 'student-2222-bbbb';
const TRIP_ID = 'trip-3333-cccc';

function makeRawJourneyRow(overrides: Record<string, unknown> = {}) {
  return {
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
    driver_name: 'Ramesh Kumar',
    driver_phone: '+919811122233',
    pickup_stop_id: 'stop-pickup-1',
    pickup_stop_name: 'Sector 14 Gate',
    pickup_stop_sequence: 1,
    pickup_scheduled_time: '07:30:00',
    pickup_lat: 28.6139,
    pickup_lng: 77.209,
    drop_stop_id: 'stop-drop-2',
    drop_stop_name: 'Delhi Public School Campus',
    drop_stop_sequence: 10,
    drop_lat: 28.625,
    drop_lng: 77.215,
    pickup_geofence_status: 'INSIDE',
    pickup_bus_arrived_at: '2026-11-01T07:28:00.000Z',
    boarding_event_id: 'be-001',
    boarding_status: 'BOARDED',
    boarded_at: '2026-11-01T07:31:00.000Z',
    boarding_marked_by: 'DRIVER',
    boarding_lat: 28.6139,
    boarding_lng: 77.209,
    drop_event_id: null,
    drop_status: null,
    dropped_at: null,
    drop_marked_by: null,
    drop_lat_recorded: null,
    drop_lng_recorded: null,
    school_arrival_at: null,
    ...overrides,
  };
}

beforeEach(() => mockQuery.mockReset());

describe('StudentJourneyService.getStudentJourneyTimeline', () => {
  it('evaluates all 6 stages when student is on board in transit', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: STUDENT_ID }]) // student check
      .mockResolvedValueOnce([makeRawJourneyRow()]) // journey context
      .mockResolvedValueOnce([]);                  // corrections

    const result = await StudentJourneyService.getStudentJourneyTimeline(
      SCHOOL_ID,
      STUDENT_ID,
      TRIP_ID
    );

    expect(result.student.fullName).toBe('Aarav Sharma');
    expect(result.trip.busNumber).toBe('BUS-07');
    expect(result.stages).toBeDefined();
    expect(result.stages).toHaveLength(6);

    const stages = result.stages!;
    // 1. Pickup
    expect(stages[0]!.stage).toBe('PICKUP');
    expect(stages[0]!.status).toBe('COMPLETED');
    expect(stages[0]!.stopName).toBe('Sector 14 Gate');

    // 2. Bus arrival
    expect(stages[1]!.stage).toBe('BUS_ARRIVAL');
    expect(stages[1]!.status).toBe('COMPLETED');
    expect(stages[1]!.timestamp).toBe('2026-11-01T07:28:00.000Z');

    // 3. Boarded
    expect(stages[2]!.stage).toBe('BOARDING');
    expect(stages[2]!.status).toBe('COMPLETED');
    expect(stages[2]!.title).toBe('Boarded');

    // 4. On Route
    expect(stages[3]!.stage).toBe('ON_ROUTE');
    expect(stages[3]!.status).toBe('IN_PROGRESS');

    // 5. School arrival
    expect(stages[4]!.stage).toBe('SCHOOL_ARRIVAL');
    expect(stages[4]!.status).toBe('IN_PROGRESS');

    // 6. Dropped
    expect(stages[5]!.stage).toBe('DROPPED');
    expect(stages[5]!.status).toBe('PENDING');

    expect(result.currentStatus).toBe('IN_TRANSIT');
    expect(result.currentStage).toBe('ON_ROUTE');
  });

  it('marks stages SKIPPED when student is marked ABSENT', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: STUDENT_ID }])
      .mockResolvedValueOnce([
        makeRawJourneyRow({
          boarding_status: 'ABSENT',
          boarded_at: '2026-11-01T07:30:00.000Z',
          trip_status: 'IN_TRANSIT',
        }),
      ])
      .mockResolvedValueOnce([]);

    const result = await StudentJourneyService.getStudentJourneyTimeline(
      SCHOOL_ID,
      STUDENT_ID,
      TRIP_ID
    );

    const stages = result.stages!;
    expect(stages[2]!.stage).toBe('BOARDING');
    expect(stages[2]!.status).toBe('SKIPPED');
    expect(stages[2]!.title).toContain('ABSENT');

    expect(stages[3]!.stage).toBe('ON_ROUTE');
    expect(stages[3]!.status).toBe('SKIPPED');

    expect(stages[4]!.stage).toBe('SCHOOL_ARRIVAL');
    expect(stages[4]!.status).toBe('SKIPPED');

    expect(stages[5]!.stage).toBe('DROPPED');
    expect(stages[5]!.status).toBe('SKIPPED');

    expect(result.currentStatus).toBe('ABSENT');
  });

  it('marks all stages COMPLETED when student has been safely dropped', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: STUDENT_ID }])
      .mockResolvedValueOnce([
        makeRawJourneyRow({
          drop_event_id: 'de-001',
          drop_status: 'DEBOARDED',
          dropped_at: '2026-11-01T08:15:00.000Z',
          school_arrival_at: '2026-11-01T08:10:00.000Z',
          trip_status: 'ARRIVED_SCHOOL',
        }),
      ])
      .mockResolvedValueOnce([]);

    const result = await StudentJourneyService.getStudentJourneyTimeline(
      SCHOOL_ID,
      STUDENT_ID,
      TRIP_ID
    );

    const stages = result.stages!;
    expect(stages[0]!.status).toBe('COMPLETED'); // Pickup
    expect(stages[1]!.status).toBe('COMPLETED'); // Bus arrival
    expect(stages[2]!.status).toBe('COMPLETED'); // Boarded
    expect(stages[3]!.status).toBe('COMPLETED'); // On route
    expect(stages[4]!.status).toBe('COMPLETED'); // School arrival
    expect(stages[5]!.status).toBe('COMPLETED'); // Dropped

    expect(result.currentStatus).toBe('DROPPED');
    expect(result.currentStage).toBe('DROPPED');
  });

  it('includes attendance corrections in timeline and corrections audit trail', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: STUDENT_ID }])
      .mockResolvedValueOnce([makeRawJourneyRow()])
      .mockResolvedValueOnce([
        {
          id: 'corr-1',
          school_id: SCHOOL_ID,
          trip_id: TRIP_ID,
          student_id: STUDENT_ID,
          event_type: 'BOARDING',
          previous_status: 'ABSENT',
          new_status: 'BOARDED',
          reason: 'Parent brought child to bus stop directly',
          corrected_by: 'admin-001',
          corrected_by_role: 'SCHOOL_ADMIN',
          latitude: 28.6139,
          longitude: 77.209,
          created_at: '2026-11-01T07:35:00.000Z',
        },
      ]);

    const result = await StudentJourneyService.getStudentJourneyTimeline(
      SCHOOL_ID,
      STUDENT_ID,
      TRIP_ID
    );

    expect(result.corrections).toHaveLength(1);
    expect(result.corrections[0]!.reason).toBe(
      'Parent brought child to bus stop directly'
    );
    expect(result.corrections[0]!.newStatus).toBe('BOARDED');

    const correctionTimelineEvent = result.timeline.find(
      (e) => e.type === 'CORRECTION'
    );
    expect(correctionTimelineEvent).toBeDefined();
    expect(correctionTimelineEvent!.reason).toBe(
      'Parent brought child to bus stop directly'
    );
  });

  it('throws NotFoundError when student does not exist in the school context', async () => {
    mockQuery.mockResolvedValueOnce([]); // student not found

    await expect(
      StudentJourneyService.getStudentJourneyTimeline(SCHOOL_ID, 'invalid-student')
    ).rejects.toThrow(/not found in this school context/i);
  });

  it('resolves the latest active trip if tripId is not supplied', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: STUDENT_ID }])
      .mockResolvedValueOnce([{ id: 'auto-resolved-trip' }]) // recent trip lookup
      .mockResolvedValueOnce([makeRawJourneyRow({ trip_id: 'auto-resolved-trip' })])
      .mockResolvedValueOnce([]);

    const result = await StudentJourneyService.getStudentJourneyTimeline(
      SCHOOL_ID,
      STUDENT_ID
    );

    expect(result.trip.id).toBe('auto-resolved-trip');
  });

  it('enforces school_id tenant isolation in all queries', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: STUDENT_ID }])
      .mockResolvedValueOnce([makeRawJourneyRow()])
      .mockResolvedValueOnce([]);

    await StudentJourneyService.getStudentJourneyTimeline(
      SCHOOL_ID,
      STUDENT_ID,
      TRIP_ID
    );

    const [sql1, params1] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql1).toContain('school_id = $2');
    expect(params1[1]).toBe(SCHOOL_ID);

    const [sql2, params2] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(sql2).toContain('t.school_id = $2');
    expect(params2[1]).toBe(SCHOOL_ID);
  });
});
