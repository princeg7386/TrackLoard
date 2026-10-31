/**
 * Phase 29.4 — Overspeed Reporting: Unit tests
 *
 * Real OverspeedRuleService + DashboardService; only DB + messaging mocked.
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

const { OverspeedRuleService } = await import('../src/services/overspeed-rule.service.js');
const { DashboardService } = await import('../src/services/dashboard.service.js');

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'oe-001',
    school_id: 'school-001',
    trip_id: 'trip-abc',
    bus_id: 'bus-1',
    driver_id: 'driver-1',
    route_id: 'route-1',
    status: 'RESOLVED',
    started_at: new Date('2026-10-31T08:00:00Z').toISOString(),
    ended_at: new Date('2026-10-31T08:05:00Z').toISOString(),
    duration_seconds: 300,
    speed_limit_kmh: 40,
    max_speed_kmh: '65.00',
    current_speed_kmh: '0.00',
    peak_latitude: 28.61,
    peak_longitude: 77.21,
    school_notified_at: null,
    driver_notified_at: null,
    created_at: new Date('2026-10-31T08:00:00Z').toISOString(),
    ...overrides,
  };
}

const SID = 'school-001';

describe('Phase 29.4 — Overspeed History: Unit', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // ── 1. Returns paginated results ──────────────────────────────────────────
  it('1. getOverspeedHistory returns paginated results with tenant filter', async () => {
    db.query
      .mockResolvedValueOnce([{ total: '2' }])
      .mockResolvedValueOnce([makeRow(), makeRow({ id: 'oe-002' })]);

    const result = await OverspeedRuleService.getOverspeedHistory({ schoolId: SID });

    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(2);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    const countParams = db.query.mock.calls[0]![1] as unknown[];
    expect(countParams).toContain(SID);
  });

  // ── 2. Filters by status=RESOLVED ─────────────────────────────────────────
  it('2. Filters by status=RESOLVED', async () => {
    db.query
      .mockResolvedValueOnce([{ total: '1' }])
      .mockResolvedValueOnce([makeRow({ status: 'RESOLVED' })]);

    const result = await OverspeedRuleService.getOverspeedHistory({ schoolId: SID, status: 'RESOLVED' });

    expect(result.data[0]!.status).toBe('RESOLVED');
    const countParams = db.query.mock.calls[0]![1] as unknown[];
    expect(countParams).toContain('RESOLVED');
  });

  // ── 3. Filters by status=ACTIVE ───────────────────────────────────────────
  it('3. Filters by status=ACTIVE', async () => {
    db.query
      .mockResolvedValueOnce([{ total: '1' }])
      .mockResolvedValueOnce([makeRow({ status: 'ACTIVE', ended_at: null })]);

    const result = await OverspeedRuleService.getOverspeedHistory({ schoolId: SID, status: 'ACTIVE' });

    expect(result.data[0]!.status).toBe('ACTIVE');
    const countParams = db.query.mock.calls[0]![1] as unknown[];
    expect(countParams).toContain('ACTIVE');
  });

  // ── 4. Filters by dateFrom/dateTo ─────────────────────────────────────────
  it('4. Filters by dateFrom and dateTo', async () => {
    db.query
      .mockResolvedValueOnce([{ total: '1' }])
      .mockResolvedValueOnce([makeRow()]);

    await OverspeedRuleService.getOverspeedHistory({
      schoolId: SID, dateFrom: '2026-10-31', dateTo: '2026-10-31',
    });

    const countParams = db.query.mock.calls[0]![1] as unknown[];
    expect(countParams).toContain('2026-10-31');
    // Both dateFrom and dateTo same value → appears twice
    expect(countParams.filter((p) => p === '2026-10-31')).toHaveLength(2);
  });

  // ── 5. Defaults page=1, pageSize=20 ──────────────────────────────────────
  it('5. Defaults page=1 and pageSize=20', async () => {
    db.query
      .mockResolvedValueOnce([{ total: '5' }])
      .mockResolvedValueOnce(Array(5).fill(makeRow()));

    const result = await OverspeedRuleService.getOverspeedHistory({ schoolId: SID });

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    const dataParams = db.query.mock.calls[1]![1] as unknown[];
    expect(dataParams.at(-2)).toBe(20);  // LIMIT
    expect(dataParams.at(-1)).toBe(0);   // OFFSET
  });

  // ── 6. Clamps pageSize to 100 ─────────────────────────────────────────────
  it('6. pageSize clamped to max 100', async () => {
    db.query
      .mockResolvedValueOnce([{ total: '10' }])
      .mockResolvedValueOnce(Array(10).fill(makeRow()));

    const result = await OverspeedRuleService.getOverspeedHistory({ schoolId: SID, pageSize: 999 });

    expect(result.pageSize).toBe(100);
    const dataParams = db.query.mock.calls[1]![1] as unknown[];
    expect(dataParams.at(-2)).toBe(100);
  });

  // ── 7. Empty result skips data query ──────────────────────────────────────
  it('7. Returns empty array when total=0, skips data query', async () => {
    db.query.mockResolvedValueOnce([{ total: '0' }]);

    const result = await OverspeedRuleService.getOverspeedHistory({ schoolId: SID });

    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
    expect(db.query).toHaveBeenCalledTimes(1); // count only
  });

  // ── 8. Dashboard includes overspeed fields ────────────────────────────────
  it('8. DashboardService summary includes overspeedEventsToday + activeOverspeedCount', async () => {
    db.query
      // 1. counts
      .mockResolvedValueOnce([{
        totalBuses: 5, totalDrivers: 3, totalRoutes: 2, totalStudents: 50,
        activeTripsCount: 2, activeIncidentsCount: 0, activeDelaysCount: 1,
        activeSosCount: 0, notificationsTodayCount: 10,
        overspeedEventsToday: 3, activeOverspeedCount: 1,
      }])
      // 2. trips breakdown
      .mockResolvedValueOnce([{ status: 'IN_TRANSIT', count: 2 }])
      // 3. morning/evening
      .mockResolvedValueOnce([{ morningPickupCount: 2, eveningDropCount: 0 }])
      // 4. critical alerts (empty)
      .mockResolvedValueOnce([])
      // 5. recent activity (empty — avoids action.replace issue)
      .mockResolvedValueOnce([]);

    const summary = await DashboardService.getSchoolDashboardSummary(SID);

    expect(summary.alertSummary.overspeedEventsToday).toBe(3);
    expect(summary.alertSummary.activeOverspeedCount).toBe(1);
  });
});
