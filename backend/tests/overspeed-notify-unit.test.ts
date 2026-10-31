/**
 * Phase 29.3 — Overspeed Notification: Unit tests for dispatchOverspeedNotifications
 *
 * Only mocks: database.js + messaging service + logger
 * Real OverspeedRuleService implementation is exercised directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
const msg = vi.hoisted(() => ({ send: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../src/config/database.js', () => ({ query: db.query, transaction: vi.fn() }));
vi.mock('../src/services/messaging/messaging.service.js', () => ({
  MessagingService: { sendMessage: msg.send },
}));
vi.mock('../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Import real service ───────────────────────────────────────────────────────
const { OverspeedRuleService } = await import('../src/services/overspeed-rule.service.js');

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    school_id: 'school-001',
    trip_id: 'trip-abc',
    bus_id: 'bus-1',
    driver_id: 'driver-1',
    route_id: 'route-1',
    started_at: new Date(Date.now() - 60_000).toISOString(),
    duration_seconds: 15,
    speed_limit_kmh: 40,
    max_speed_kmh: '65',
    peak_latitude: 28.61234,
    peak_longitude: 77.20987,
    school_notified_at: null,
    driver_notified_at: null,
    bus_number: 'DL-01-AA-1234',
    route_name: 'Route A',
    ...overrides,
  };
}

const SID = 'school-001';
const EID = 'oe-event-001';

describe('Phase 29.3 — Overspeed Notify: Unit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    msg.send.mockResolvedValue(undefined);
  });

  // ── 1. School + driver both notified ─────────────────────────────────────
  it('1. Sends school + driver WhatsApp on first trigger', async () => {
    db.query
      .mockResolvedValueOnce([makeRow()])
      .mockResolvedValueOnce([{ phone: '+911234567890', name: 'Admin' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ phone: '+919876543210' }])
      .mockResolvedValueOnce([]);

    const result = await OverspeedRuleService.dispatchOverspeedNotifications(EID, SID);

    expect(result.schoolNotified).toBe(true);
    expect(result.driverNotified).toBe(true);
    expect(result.schoolRecipientsCount).toBe(1);
    expect(msg.send).toHaveBeenCalledTimes(2);
  });

  // ── 2. School cooldown respected ──────────────────────────────────────────
  it('2. School notification skipped when within 5-min cooldown', async () => {
    const recentNotify = new Date(Date.now() - 60_000).toISOString();
    db.query
      .mockResolvedValueOnce([makeRow({ school_notified_at: recentNotify })])
      // driver check still runs
      .mockResolvedValueOnce([{ phone: '+919876543210' }])
      .mockResolvedValueOnce([]);

    const result = await OverspeedRuleService.dispatchOverspeedNotifications(EID, SID);

    expect(result.schoolNotified).toBe(false);
    expect(result.schoolCooldownSkipped).toBe(true);
    const schoolCalls = msg.send.mock.calls.filter((c: any[]) => c[0]?.recipientRole === 'SCHOOL_ADMIN');
    expect(schoolCalls).toHaveLength(0);
  });

  // ── 3. forceNotify bypasses cooldown ──────────────────────────────────────
  it('3. forceNotify=true sends even within cooldown window', async () => {
    const recentNotify = new Date(Date.now() - 60_000).toISOString();
    db.query
      .mockResolvedValueOnce([makeRow({ school_notified_at: recentNotify })])
      .mockResolvedValueOnce([{ phone: '+911234567890', name: 'Admin' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ phone: '+919876543210' }])
      .mockResolvedValueOnce([]);

    const result = await OverspeedRuleService.dispatchOverspeedNotifications(EID, SID, true);

    expect(result.schoolNotified).toBe(true);
    expect(msg.send).toHaveBeenCalled();
  });

  // ── 4. Driver message content ─────────────────────────────────────────────
  it('4. Driver WhatsApp message contains speed and limit', async () => {
    db.query
      .mockResolvedValueOnce([makeRow()])
      .mockResolvedValueOnce([{ phone: '+911234567890', name: 'Admin' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ phone: '+919876543210' }])
      .mockResolvedValueOnce([]);

    await OverspeedRuleService.dispatchOverspeedNotifications(EID, SID);

    const driverCall = msg.send.mock.calls.find((c: any[]) => c[0]?.recipientRole === 'DRIVER');
    expect(driverCall).toBeDefined();
    expect(driverCall![0].directText).toContain('65 km/h');
    expect(driverCall![0].directText).toContain('40 km/h');
    expect(driverCall![0].eventType).toBe('OVERSPEED_ALERT');
  });

  // ── 5. No driver phone ────────────────────────────────────────────────────
  it('5. Driver notification skipped when no phone found', async () => {
    db.query
      .mockResolvedValueOnce([makeRow()])
      .mockResolvedValueOnce([{ phone: '+911234567890', name: 'Admin' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]); // empty driver phone

    const result = await OverspeedRuleService.dispatchOverspeedNotifications(EID, SID);

    expect(result.driverNotified).toBe(false);
    expect(result.schoolNotified).toBe(true);
    const driverCalls = msg.send.mock.calls.filter((c: any[]) => c[0]?.recipientRole === 'DRIVER');
    expect(driverCalls).toHaveLength(0);
  });

  // ── 6. No school recipients ───────────────────────────────────────────────
  it('6. School notification skipped gracefully when no admin phones found', async () => {
    db.query
      .mockResolvedValueOnce([makeRow()])
      .mockResolvedValueOnce([]) // empty recipients
      .mockResolvedValueOnce([{ phone: '+919876543210' }])
      .mockResolvedValueOnce([]);

    const result = await OverspeedRuleService.dispatchOverspeedNotifications(EID, SID);

    expect(result.schoolNotified).toBe(false);
    expect(result.schoolRecipientsCount).toBe(0);
    const schoolCalls = msg.send.mock.calls.filter((c: any[]) => c[0]?.recipientRole === 'SCHOOL_ADMIN');
    expect(schoolCalls).toHaveLength(0);
  });

  // ── 7. Event not found ────────────────────────────────────────────────────
  it('7. Event not found — graceful result, no throw', async () => {
    db.query.mockResolvedValueOnce([]);

    const result = await OverspeedRuleService.dispatchOverspeedNotifications('unknown-id', SID);

    expect(result.schoolNotified).toBe(false);
    expect(result.driverNotified).toBe(false);
    expect(result.message).toContain('not found');
    expect(msg.send).not.toHaveBeenCalled();
  });

  // ── 8. School message has all 4 required fields ───────────────────────────
  it('8. School WhatsApp contains: speed, limit, time, location, duration', async () => {
    db.query
      .mockResolvedValueOnce([makeRow()])
      .mockResolvedValueOnce([{ phone: '+911234567890', name: 'Admin' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ phone: '+919876543210' }])
      .mockResolvedValueOnce([]);

    await OverspeedRuleService.dispatchOverspeedNotifications(EID, SID);

    const schoolCall = msg.send.mock.calls.find((c: any[]) => c[0]?.recipientRole === 'SCHOOL_ADMIN');
    expect(schoolCall).toBeDefined();
    const text: string = schoolCall![0].directText;
    expect(text).toContain('65 km/h');   // speed
    expect(text).toContain('40 km/h');   // limit
    expect(text).toContain('28.61234');  // location lat
    expect(text).toContain('77.20987');  // location lng
    expect(text).toContain('min');       // duration
    expect(schoolCall![0].eventType).toBe('OVERSPEED_ALERT');
  });
});
