/**
 * sos-resolution-unit.test.ts — Phase 30.4: SOS Resolution (Unit)
 *
 * Tests: real SosService methods + mock DB.
 * Covers getSosHistory() pagination, tenant isolation, empty results,
 * and regression-checks for acknowledgeSos() and resolveSos().
 *
 * Pattern: real service import + vi.mock for DB/logger/notification.
 * Do NOT import HTTP app here — HTTP tests are in sos-resolution.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock DB before importing service ────────────────────────────────────────
vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
vi.mock('../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/services/operational-notification.service.js', () => ({
  OperationalNotificationService: {
    notifyEmergencySos: vi.fn().mockResolvedValue(undefined),
  },
}));

import { query } from '../src/config/database.js';
import { SosService } from '../src/services/sos.service.js';
import { SosStatus } from '@school-bus/shared';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SCHOOL_ID = 'school-aaaa-bbbb';
const SOS_ID_1 = 'sos-0001-0001';
const SOS_ID_2 = 'sos-0002-0002';
const ADMIN_ID = 'admin-0001-0001';

function makeSosDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SOS_ID_1,
    school_id: SCHOOL_ID,
    trip_id: 'trip-0001',
    bus_id: 'bus-0001',
    driver_id: 'drv-0001',
    trigger_source: 'APP_SOS_BUTTON',
    latitude: 28.6139,
    longitude: 77.2090,
    speed_kmh: '35.5',
    status: 'RESOLVED',
    acknowledged_by: ADMIN_ID,
    acknowledged_at: '2026-10-31T08:00:00Z',
    resolved_at: '2026-10-31T09:00:00Z',
    resolution_notes: 'Tyre puncture handled, children safe.',
    created_at: '2026-10-31T07:55:00Z',
    bus_number: 'KA-01-AB-1234',
    driver_name: 'Ramesh Kumar',
    driver_phone: '+919876543210',
    route_name: 'Route A - Sector 7',
    gps_accuracy_m: '8.5',
    gps_recorded_at: '2026-10-31T07:54:50Z',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockQuery.mockReset();
});

describe('SosService.getSosHistory', () => {
  it('returns resolved events with all snapshot fields mapped', async () => {
    const row = makeSosDbRow();
    mockQuery.mockResolvedValueOnce([row]);

    const result = await SosService.getSosHistory(SCHOOL_ID);

    expect(result).toHaveLength(1);
    const ev = result[0]!;
    expect(ev.id).toBe(SOS_ID_1);
    expect(ev.status).toBe(SosStatus.RESOLVED);
    expect(ev.resolvedAt).toBe('2026-10-31T09:00:00Z');
    expect(ev.resolutionNotes).toBe('Tyre puncture handled, children safe.');
    // Snapshot fields
    expect(ev.busNumber).toBe('KA-01-AB-1234');
    expect(ev.driverName).toBe('Ramesh Kumar');
    expect(ev.driverPhone).toBe('+919876543210');
    expect(ev.routeName).toBe('Route A - Sector 7');
    expect(ev.gpsAccuracyM).toBe(8.5);
    expect(ev.gpsRecordedAt).toBe('2026-10-31T07:54:50Z');
  });

  it('returns empty array when no resolved events exist', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const result = await SosService.getSosHistory(SCHOOL_ID);

    expect(result).toHaveLength(0);
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns multiple resolved events ordered by resolved_at DESC', async () => {
    const row1 = makeSosDbRow({ id: SOS_ID_1, resolved_at: '2026-10-31T09:00:00Z' });
    const row2 = makeSosDbRow({ id: SOS_ID_2, resolved_at: '2026-10-30T12:00:00Z' });
    mockQuery.mockResolvedValueOnce([row1, row2]);

    const result = await SosService.getSosHistory(SCHOOL_ID);

    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe(SOS_ID_1);
    expect(result[1]!.id).toBe(SOS_ID_2);
  });

  it('passes schoolId as $1 for tenant isolation', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await SosService.getSosHistory(SCHOOL_ID, 50, 0);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('school_id = $1');
    expect(params[0]).toBe(SCHOOL_ID);
  });

  it('passes limit as $2 to DB query', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await SosService.getSosHistory(SCHOOL_ID, 25, 0);

    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toBe(25);
  });

  it('passes offset as $3 to DB query', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await SosService.getSosHistory(SCHOOL_ID, 50, 75);

    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params[2]).toBe(75);
  });

  it('only queries RESOLVED status events', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await SosService.getSosHistory(SCHOOL_ID);

    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("status = 'RESOLVED'");
  });

  it('defaults limit=50 and offset=0 when not provided', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await SosService.getSosHistory(SCHOOL_ID);

    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toBe(50);
    expect(params[2]).toBe(0);
  });
});

describe('SosService.acknowledgeSos — regression', () => {
  it('updates status to ACKNOWLEDGED and returns the updated record', async () => {
    // UPDATE returns [{ id }]
    mockQuery.mockResolvedValueOnce([{ id: SOS_ID_1 }]);
    // getSosEventById SELECT returns full row
    mockQuery.mockResolvedValueOnce([makeSosDbRow({ status: 'ACKNOWLEDGED' })]);

    const result = await SosService.acknowledgeSos(SOS_ID_1, SCHOOL_ID, ADMIN_ID);

    expect(result.id).toBe(SOS_ID_1);
    // Service returns whatever getSosEventById returns (mocked as ACKNOWLEDGED)
    expect(result.status).toBe(SosStatus.ACKNOWLEDGED);
  });

  it('throws when SOS not found or already acknowledged', async () => {
    mockQuery.mockResolvedValueOnce([]); // UPDATE returns nothing

    await expect(
      SosService.acknowledgeSos('nonexistent-id', SCHOOL_ID, ADMIN_ID)
    ).rejects.toThrow('not found');
  });
});

describe('SosService.resolveSos — regression', () => {
  it('updates status to RESOLVED with optional notes', async () => {
    mockQuery.mockResolvedValueOnce([{ id: SOS_ID_1 }]);
    mockQuery.mockResolvedValueOnce([makeSosDbRow({ status: 'RESOLVED', resolution_notes: 'All clear.' })]);

    const result = await SosService.resolveSos(SOS_ID_1, SCHOOL_ID, 'All clear.');

    expect(result.status).toBe(SosStatus.RESOLVED);
    expect(result.resolutionNotes).toBe('All clear.');
  });

  it('throws when SOS not found or already resolved', async () => {
    mockQuery.mockResolvedValueOnce([]); // UPDATE returns nothing

    await expect(
      SosService.resolveSos('nonexistent-id', SCHOOL_ID, 'notes')
    ).rejects.toThrow('not found');
  });
});
