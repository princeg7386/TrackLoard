import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeofenceService } from '../src/services/geofence.service.js';
import { GeofenceNotificationService } from '../src/services/geofence-notification.service.js';
import { RealtimeFeedService } from '../src/services/realtime-feed.service.js';
import { MessagingService } from '../src/services/messaging/messaging.service.js';
import * as db from '../src/config/database.js';

// ---------------------------------------------------------------------------
// Phase 21.3 — Geofence Event Handling Tests
// Tasks: Debounce repeated events · Store timestamp/location · Trigger workflows
// ---------------------------------------------------------------------------

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';
const BUS_ID = '33333333-3333-3333-3333-333333333333';
const STOP_ID = '44444444-4444-4444-4444-444444444444';
const STUDENT_1_ID = '55555555-5555-5555-5555-555555555555';
const STUDENT_2_ID = '66666666-6666-6666-6666-666666666666';
const PARENT_1_ID = '77777777-7777-7777-7777-777777777777';

const MOCK_STOP = {
  id: STOP_ID,
  stopName: 'Vasant Vihar Central Market',
  sequenceOrder: 1,
  latitude: 28.5580,
  longitude: 77.1600,
  geofenceType: 'RADIUS' as const,
  geofenceRadiusMeters: 300,
  geofencePolygon: null,
};

describe('Phase 21.3 — Task 1: Debounce repeated events (DWELL Heartbeat)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('debounces stationary evaluations under 60 seconds (updates state without ledger insert)', async () => {
    const querySpy = vi.spyOn(db, 'query');

    // 1. Return route stops for trip
    querySpy.mockResolvedValueOnce([MOCK_STOP]);

    // 2. Existing states: Bus entered 30 seconds ago (dwell = 30s < 60s threshold)
    const enteredAt = '2026-10-25T08:00:00.000Z';
    querySpy.mockResolvedValueOnce([
      {
        stopId: STOP_ID,
        status: 'INSIDE',
        enteredAt,
        exitedAt: null,
        lastDwellEventAt: null,
        dwellTimeSeconds: 30,
      },
    ]);

    // 3. State update only (no geofence_events insert)
    querySpy.mockResolvedValueOnce([]);

    const publishSpy = vi.spyOn(RealtimeFeedService, 'publish').mockImplementation(() => {});

    // Telemetry ping 35 seconds after entry
    const recordedAt = new Date('2026-10-25T08:00:35.000Z');
    const result = await GeofenceService.evaluateTripStops({
      tripId: TRIP_ID,
      schoolId: SCHOOL_ID,
      busId: BUS_ID,
      latitude: 28.5582,
      longitude: 77.1601,
      recordedAt,
      emitDwellEvents: true,
    });

    expect(result.transitions.length).toBe(0); // Not a transition
    // Query calls: 1 (stops) + 1 (states) + 1 (update trip_stop_geofence_states) = 3
    expect(querySpy).toHaveBeenCalledTimes(3);
    const updateCall = querySpy.mock.calls[2]!;
    expect(updateCall[0]).toContain('UPDATE trip_stop_geofence_states');
    expect(updateCall[0]).not.toContain('INSERT INTO geofence_events');
    // Realtime feed should not be spammed with DWELL event under cooldown
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('emits debounced DWELL event when bus dwell reaches 60 seconds threshold', async () => {
    const querySpy = vi.spyOn(db, 'query');

    // 1. Return route stops for trip
    querySpy.mockResolvedValueOnce([MOCK_STOP]);

    // 2. Existing states: Bus entered 65 seconds ago, no prior DWELL event logged
    const enteredAt = '2026-10-25T08:00:00.000Z';
    querySpy.mockResolvedValueOnce([
      {
        stopId: STOP_ID,
        status: 'INSIDE',
        enteredAt,
        exitedAt: null,
        lastDwellEventAt: null,
        dwellTimeSeconds: 65,
      },
    ]);

    // 3. geofence_events INSERT for DWELL
    querySpy.mockResolvedValueOnce([{ id: 'dwell-event-001' }]);

    // 4. trip_stop_geofence_states UPDATE with last_dwell_event_at
    querySpy.mockResolvedValueOnce([]);

    const publishSpy = vi.spyOn(RealtimeFeedService, 'publish').mockImplementation(() => {});

    // Telemetry ping at 08:01:05 (65s dwell time)
    const recordedAt = new Date('2026-10-25T08:01:05.000Z');
    await GeofenceService.evaluateTripStops({
      tripId: TRIP_ID,
      schoolId: SCHOOL_ID,
      busId: BUS_ID,
      latitude: 28.5581,
      longitude: 77.1600,
      recordedAt,
      emitDwellEvents: true,
    });

    // 4 queries: stops + states + insert DWELL + update state with last_dwell_event_at
    expect(querySpy).toHaveBeenCalledTimes(4);

    const insertCall = querySpy.mock.calls[2]!;
    expect(insertCall[0]).toContain("INSERT INTO geofence_events");
    expect(insertCall[0]).toContain("'DWELL'");
    expect(insertCall[1]).toEqual([
      SCHOOL_ID,
      TRIP_ID,
      BUS_ID,
      STOP_ID,
      28.5581,
      77.1600,
      expect.any(Number),
      65,
      '2026-10-25T08:01:05.000Z',
    ]);

    // Realtime feed emitted DWELL event
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'GEOFENCE_EVENT',
        eventType: 'DWELL',
        status: 'INSIDE',
        stopId: STOP_ID,
        dwellTimeSeconds: 65,
      })
    );
  });

  it('debounces subsequent pings within 60 seconds after a DWELL event was emitted', async () => {
    const querySpy = vi.spyOn(db, 'query');

    // 1. Stops
    querySpy.mockResolvedValueOnce([MOCK_STOP]);

    // 2. States: DWELL event was just written 20 seconds ago at 08:01:00
    const enteredAt = '2026-10-25T08:00:00.000Z';
    const lastDwellEventAt = '2026-10-25T08:01:00.000Z';
    querySpy.mockResolvedValueOnce([
      {
        stopId: STOP_ID,
        status: 'INSIDE',
        enteredAt,
        exitedAt: null,
        lastDwellEventAt,
        dwellTimeSeconds: 80,
      },
    ]);

    // 3. State update only
    querySpy.mockResolvedValueOnce([]);

    const publishSpy = vi.spyOn(RealtimeFeedService, 'publish').mockImplementation(() => {});

    // Ping at 08:01:20 (only 20s elapsed since last DWELL)
    const recordedAt = new Date('2026-10-25T08:01:20.000Z');
    await GeofenceService.evaluateTripStops({
      tripId: TRIP_ID,
      schoolId: SCHOOL_ID,
      busId: BUS_ID,
      latitude: 28.5580,
      longitude: 77.1600,
      recordedAt,
      emitDwellEvents: true,
    });

    expect(querySpy).toHaveBeenCalledTimes(3); // No insert
    expect(publishSpy).not.toHaveBeenCalled();
  });
});

describe('Phase 21.3 — Task 2: Store timestamp and location coordinates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores exact GPS coordinates, PostGIS geometry, and ISO timestamp on ENTRY event', async () => {
    const querySpy = vi.spyOn(db, 'query');

    // 1. Stops
    querySpy.mockResolvedValueOnce([MOCK_STOP]);

    // 2. Existing states: OUTSIDE
    querySpy.mockResolvedValueOnce([
      { stopId: STOP_ID, status: 'OUTSIDE', enteredAt: null, exitedAt: null, dwellTimeSeconds: 0 },
    ]);

    // 3. geofence_events INSERT
    querySpy.mockResolvedValueOnce([{ id: 'event-entry-001' }]);

    // 4. trip_stop_geofence_states UPSERT
    querySpy.mockResolvedValueOnce([]);

    vi.spyOn(RealtimeFeedService, 'publish').mockImplementation(() => {});

    const testTime = new Date('2026-10-25T08:14:22.123Z');
    await GeofenceService.evaluateTripStops({
      tripId: TRIP_ID,
      schoolId: SCHOOL_ID,
      busId: BUS_ID,
      latitude: 28.5583,
      longitude: 77.1602,
      recordedAt: testTime,
    });

    const insertCall = querySpy.mock.calls[2]!;
    expect(insertCall[0]).toContain('ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography');
    expect(insertCall[1]).toEqual([
      SCHOOL_ID,
      TRIP_ID,
      BUS_ID,
      STOP_ID,
      28.5583, // latitude
      77.1602, // longitude
      expect.any(Number), // distance
      '2026-10-25T08:14:22.123Z', // timestamp
    ]);
  });

  it('retrieves stored geofence states with lastDwellEventAt and timestamps', async () => {
    const querySpy = vi.spyOn(db, 'query').mockResolvedValueOnce([
      {
        id: 'state-001',
        tripId: TRIP_ID,
        stopId: STOP_ID,
        stopName: 'Vasant Vihar Central Market',
        sequenceOrder: 1,
        status: 'INSIDE',
        enteredAt: '2026-10-25T08:00:00.000Z',
        exitedAt: null,
        lastDwellEventAt: '2026-10-25T08:01:00.000Z',
        dwellTimeSeconds: 120,
        lastEvaluatedAt: '2026-10-25T08:02:00.000Z',
      },
    ]);

    const states = await GeofenceService.getTripGeofenceStates(TRIP_ID);

    expect(states.length).toBe(1);
    expect(states[0]?.status).toBe('INSIDE');
    expect(states[0]?.lastDwellEventAt).toBe('2026-10-25T08:01:00.000Z');
    expect(states[0]?.dwellTimeSeconds).toBe(120);
    expect(querySpy).toHaveBeenCalledTimes(1);
  });
});

describe('Phase 21.3 — Task 3: Trigger workflows (Stop EXIT Missed Boarding)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('notifies parents of unboarded students when bus exits pickup stop', async () => {
    const querySpy = vi.spyOn(db, 'query');

    // 1. Candidate students query: Student 1 (PENDING/null), Student 2 (already BOARDED)
    querySpy.mockResolvedValueOnce([
      {
        parentId: PARENT_1_ID,
        studentId: STUDENT_1_ID,
        schoolId: SCHOOL_ID,
        parentPhone: '+919876543210',
        parentName: 'Sunita Mehra',
        studentName: 'Aarav Mehra',
        boardingStatus: null, // NOT boarded
        trackingToken: 'track-token-123',
      },
      {
        parentId: 'parent-2',
        studentId: STUDENT_2_ID,
        schoolId: SCHOOL_ID,
        parentPhone: '+919876543211',
        parentName: 'Rajesh Kumar',
        studentName: 'Rohan Kumar',
        boardingStatus: 'BOARDED', // already boarded
        trackingToken: 'track-token-456',
      },
    ]);

    const sendSpy = vi.spyOn(MessagingService, 'sendMessage').mockResolvedValueOnce({
      messageId: 'wa-msg-missed-001',
      status: 'sent',
      provider: 'mock',
      timestamp: new Date().toISOString(),
    });

    // 2. geofence_notification_log insert for Student 1
    querySpy.mockResolvedValueOnce([]);

    const result = await GeofenceNotificationService.notifyMissedBoarding({
      tripId: TRIP_ID,
      stopId: STOP_ID,
      schoolId: SCHOOL_ID,
      busId: BUS_ID,
      stopName: 'Vasant Vihar Central Market',
    });

    expect(result.studentsAtStop).toBe(2);
    expect(result.alreadyBoarded).toBe(1); // Student 2 skipped
    expect(result.missedBoardingNotificationsSent).toBe(1); // Student 1 notified

    // Verify WhatsApp template and copy
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientPhone: '+919876543210',
        templateId: 'GEOFENCE_MISSED_BOARDING',
        schoolId: SCHOOL_ID,
        studentId: STUDENT_1_ID,
        directText: expect.stringContaining('Stop Departure Alert'),
      })
    );

    // Verify notification log insert included MISSED_BOARDING type
    const logInsert = querySpy.mock.calls[1]!;
    expect(logInsert[0]).toContain("INSERT INTO geofence_notification_log");
    expect(logInsert[0]).toContain("'MISSED_BOARDING'");
  });

  it('skips notification when all students at stop are already marked BOARDED or ABSENT', async () => {
    const querySpy = vi.spyOn(db, 'query');

    querySpy.mockResolvedValueOnce([
      {
        parentId: PARENT_1_ID,
        studentId: STUDENT_1_ID,
        schoolId: SCHOOL_ID,
        parentPhone: '+919876543210',
        parentName: 'Sunita Mehra',
        studentName: 'Aarav Mehra',
        boardingStatus: 'ABSENT', // Marked absent beforehand
        trackingToken: null,
      },
    ]);

    const sendSpy = vi.spyOn(MessagingService, 'sendMessage');

    const result = await GeofenceNotificationService.notifyMissedBoarding({
      tripId: TRIP_ID,
      stopId: STOP_ID,
      schoolId: SCHOOL_ID,
      busId: BUS_ID,
      stopName: 'Vasant Vihar Central Market',
    });

    expect(result.studentsAtStop).toBe(1);
    expect(result.alreadyBoarded).toBe(1);
    expect(result.missedBoardingNotificationsSent).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('triggers missed boarding workflow when evaluateTripStops detects stop EXIT', async () => {
    const querySpy = vi.spyOn(db, 'query');

    // 1. Return route stops for trip
    querySpy.mockResolvedValueOnce([MOCK_STOP]);

    // 2. Existing states: was INSIDE
    const enteredAt = '2026-10-25T08:10:00.000Z';
    querySpy.mockResolvedValueOnce([
      { stopId: STOP_ID, status: 'INSIDE', enteredAt, exitedAt: null, dwellTimeSeconds: 0 },
    ]);

    // 3. geofence_events INSERT for EXIT
    querySpy.mockResolvedValueOnce([{ id: 'event-exit-001' }]);

    // 4. trip_stop_geofence_states UPSERT for OUTSIDE
    querySpy.mockResolvedValueOnce([]);

    // 5. notifyMissedBoarding query for candidate students (none unboarded)
    querySpy.mockResolvedValueOnce([]);

    vi.spyOn(RealtimeFeedService, 'publish').mockImplementation(() => {});
    const workflowSpy = vi.spyOn(GeofenceNotificationService, 'notifyMissedBoarding');

    // Position bus outside geofence (500m away)
    const result = await GeofenceService.evaluateTripStops({
      tripId: TRIP_ID,
      schoolId: SCHOOL_ID,
      busId: BUS_ID,
      latitude: 28.5700,
      longitude: 77.1600,
      recordedAt: new Date('2026-10-25T08:15:00.000Z'),
      triggerWorkflows: true,
    });

    expect(result.transitions.length).toBe(1);
    expect(result.transitions[0]?.eventType).toBe('EXIT');

    // Verify workflow was triggered
    expect(workflowSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: TRIP_ID,
        stopId: STOP_ID,
        schoolId: SCHOOL_ID,
        busId: BUS_ID,
        stopName: 'Vasant Vihar Central Market',
      })
    );
  });
});
