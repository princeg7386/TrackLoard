/**
 * Phase 30.1 — SOS Trigger: Unit tests
 *
 * Real SosService + real DB function — only DB and messaging mocked.
 * Keep this file FREE of vi.mock('../src/services/sos.service.js')
 * so the real service is used (not a mock).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../src/config/database.js', () => ({ query: db.query, transaction: vi.fn() }));
vi.mock('../src/services/messaging/messaging.service.js', () => ({
  MessagingService: { sendMessage: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/services/operational-notification.service.js', () => ({
  OperationalNotificationService: {
    notifyEmergencySos: vi.fn().mockResolvedValue({ notificationsSent: 2 }),
  },
}));

const { SosService } = await import('../src/services/sos.service.js');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';
const TRIP_ID   = '22222222-2222-2222-2222-222222222222';
const BUS_ID    = '33333333-3333-3333-3333-333333333333';
const DRIVER_ID = '44444444-4444-4444-4444-444444444444';
const SOS_ID    = '55555555-5555-5555-5555-555555555555';
const ADMIN_ID  = '66666666-6666-6666-6666-666666666666';

function makeTripRow() {
  return { id: TRIP_ID, busId: BUS_ID, driverId: DRIVER_ID, schoolId: SCHOOL_ID, status: 'IN_TRANSIT' };
}

function makeGpsRow() {
  return { latitude: 28.6139, longitude: 77.209, speedKmh: 42 };
}

function makeSosRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SOS_ID,
    school_id: SCHOOL_ID,
    trip_id: TRIP_ID,
    bus_id: BUS_ID,
    driver_id: DRIVER_ID,
    trigger_source: 'APP_SOS_BUTTON',
    latitude: '28.6139',
    longitude: '77.2090',
    speed_kmh: '42.00',
    status: 'TRIGGERED',
    acknowledged_by: null,
    acknowledged_at: null,
    resolved_at: null,
    resolution_notes: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Phase 30.1 — SOS Trigger: SosService unit tests', () => {

  it('triggerSos — happy path: fetches last GPS, inserts sos_events, fires notification', async () => {
    db.query
      .mockResolvedValueOnce([makeTripRow()])    // trip ownership check
      .mockResolvedValueOnce([makeGpsRow()])     // last GPS point
      .mockResolvedValueOnce([{ id: SOS_ID }]); // INSERT sos_events

    const result = await SosService.triggerSos({
      schoolId: SCHOOL_ID,
      tripId: TRIP_ID,
    });

    expect(result.sosEventId).toBe(SOS_ID);
    expect(result.latitude).toBe(28.6139);
    expect(result.longitude).toBe(77.209);
    expect(result.status).toBe('TRIGGERED');
    // 3 queries: trip, GPS, insert
    expect(db.query).toHaveBeenCalledTimes(3);
  });

  it('triggerSos — uses provided lat/lng when given (no GPS fetch)', async () => {
    db.query
      .mockResolvedValueOnce([makeTripRow()])    // trip check
      .mockResolvedValueOnce([{ id: SOS_ID }]); // INSERT

    const result = await SosService.triggerSos({
      schoolId: SCHOOL_ID,
      tripId: TRIP_ID,
      latitude: 19.076,
      longitude: 72.877,
      speedKmh: 30,
    });

    // Only 2 queries when coords are provided (no GPS fetch)
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(result.latitude).toBe(19.076);
    expect(result.longitude).toBe(72.877);
  });

  it('triggerSos — falls back to 0,0 when no GPS record exists', async () => {
    db.query
      .mockResolvedValueOnce([makeTripRow()])    // trip check
      .mockResolvedValueOnce([])                 // no GPS rows
      .mockResolvedValueOnce([{ id: SOS_ID }]); // INSERT

    const result = await SosService.triggerSos({
      schoolId: SCHOOL_ID,
      tripId: TRIP_ID,
    });

    expect(result.latitude).toBe(0);
    expect(result.longitude).toBe(0);
  });

  it('triggerSos — throws when trip not found for school (tenant isolation)', async () => {
    db.query.mockResolvedValueOnce([]); // no trip rows

    await expect(
      SosService.triggerSos({ schoolId: SCHOOL_ID, tripId: TRIP_ID })
    ).rejects.toThrow(/not found or does not belong/);
  });

  it('getActiveSosEvents — returns TRIGGERED events for school', async () => {
    db.query.mockResolvedValueOnce([makeSosRow()]);

    const events = await SosService.getActiveSosEvents(SCHOOL_ID);
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe('TRIGGERED');
    expect(events[0]!.schoolId).toBe(SCHOOL_ID);
    expect(events[0]!.latitude).toBe(28.6139);
  });

  it('getActiveSosEvents — returns empty array when no active events', async () => {
    db.query.mockResolvedValueOnce([]);

    const events = await SosService.getActiveSosEvents(SCHOOL_ID);
    expect(events).toHaveLength(0);
  });

  it('acknowledgeSos — updates status to ACKNOWLEDGED and returns updated record', async () => {
    db.query
      .mockResolvedValueOnce([{ id: SOS_ID }])            // UPDATE
      .mockResolvedValueOnce([makeSosRow({ status: 'ACKNOWLEDGED', acknowledged_by: ADMIN_ID })]);

    const updated = await SosService.acknowledgeSos(SOS_ID, SCHOOL_ID, ADMIN_ID);
    expect(updated.status).toBe('ACKNOWLEDGED');
    expect(updated.acknowledgedBy).toBe(ADMIN_ID);
  });

  it('acknowledgeSos — throws when SOS not found or already resolved', async () => {
    db.query.mockResolvedValueOnce([]); // UPDATE returns nothing

    await expect(
      SosService.acknowledgeSos(SOS_ID, SCHOOL_ID, ADMIN_ID)
    ).rejects.toThrow(/not found/);
  });

  it('resolveSos — updates status to RESOLVED with notes', async () => {
    db.query
      .mockResolvedValueOnce([{ id: SOS_ID }])
      .mockResolvedValueOnce([makeSosRow({ status: 'RESOLVED', resolution_notes: 'Situation cleared', resolved_at: new Date().toISOString() })]);

    const updated = await SosService.resolveSos(SOS_ID, SCHOOL_ID, 'Situation cleared');
    expect(updated.status).toBe('RESOLVED');
    expect(updated.resolutionNotes).toBe('Situation cleared');
  });
});
