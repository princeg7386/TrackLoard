/**
 * Phase 30.3 — SOS School Alert: Unit Tests
 *
 * Tests the enriched notifyEmergencySos() alert logic:
 *  - Staff message contains Google Maps URL with correct lat/lng
 *  - Staff message contains sosEventId as incident reference
 *  - Staff message contains driver name + phone
 *  - Staff message contains speed when speedKmh > 0
 *  - Falls back to fetchTripContext when snapshot fields are omitted
 *  - No INSERT INTO sos_events is made from the notification service
 *
 * Pattern: real OperationalNotificationService + vi.spyOn(query) — no HTTP layer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
}));

vi.mock('../src/services/messaging/messaging.service.js', () => ({
  MessagingService: {
    sendMessage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { query } from '../src/config/database.js';
import { MessagingService } from '../src/services/messaging/messaging.service.js';
import { OperationalNotificationService } from '../src/services/operational-notification.service.js';

const mockQuery = vi.mocked(query);
const mockSend = vi.mocked(MessagingService.sendMessage);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SCHOOL_ID = 'sch-001';
const TRIP_ID   = 'trip-001';
const SOS_ID    = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const SNAPSHOT = {
  busNumber:   'MH-12-AB-1234',
  driverName:  'Rajesh Kumar',
  driverPhone: '+919876543210',
  routeName:   'Route A - Morning',
  sosEventId:  SOS_ID,
  speedKmh:    45,
};

const LAT = 18.52040;
const LNG = 73.85670;

/** School phones + routeId row returned by the lightweight query (snapshot path) */
const schoolRow = {
  schoolPhone: '+9122001234',
  schoolEmergencyPhone: '+9122005678',
  routeId: 'route-001',
};

/** Staff contacts row */
const staffRow = {
  id: 'admin-001',
  phone: '+919000000001',
  name: 'Priya Nair',
  role: 'ADMIN',
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helper: capture all message texts sent to staff ───────────────────────────
function capturedStaffMessages(): string[] {
  return mockSend.mock.calls
    .filter((c) => c[0].templateId === 'STAFF_EMERGENCY_SOS')
    .map((c) => c[0].directText ?? '');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Phase 30.3 — SOS School Alert', () => {

  describe('enriched staff message (snapshot path)', () => {
    async function runWithSnapshot() {
      // schoolRow + staffRow, no parents
      mockQuery
        .mockResolvedValueOnce([schoolRow])  // school phones + routeId
        .mockResolvedValueOnce([staffRow])   // fetchStaffContacts
        .mockResolvedValueOnce([]);          // fetchTripParents → no parents

      await OperationalNotificationService.notifyEmergencySos({
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        latitude: LAT,
        longitude: LNG,
        ...SNAPSHOT,
      });
    }

    it('includes a Google Maps URL with the correct lat/lng', async () => {
      await runWithSnapshot();
      const msgs = capturedStaffMessages();
      expect(msgs.length).toBeGreaterThan(0);
      expect(msgs[0]).toContain(`https://maps.google.com/?q=${LAT.toFixed(5)},${LNG.toFixed(5)}`);
    });

    it('includes the incident reference derived from sosEventId', async () => {
      await runWithSnapshot();
      const msgs = capturedStaffMessages();
      // First 8 chars of SOS_ID uppercased
      expect(msgs[0]).toContain('SOS-A1B2C3D4');
    });

    it('includes driver name and direct phone number', async () => {
      await runWithSnapshot();
      const msgs = capturedStaffMessages();
      expect(msgs[0]).toContain('Rajesh Kumar');
      expect(msgs[0]).toContain('+919876543210');
    });

    it('includes speed when speedKmh > 0', async () => {
      await runWithSnapshot();
      const msgs = capturedStaffMessages();
      expect(msgs[0]).toContain('45');   // speed value
      expect(msgs[0]).toContain('km/h');
    });

    it('includes route name and bus number', async () => {
      await runWithSnapshot();
      const msgs = capturedStaffMessages();
      expect(msgs[0]).toContain('MH-12-AB-1234');
      expect(msgs[0]).toContain('Route A - Morning');
    });

    it('omits speed line when speedKmh is 0', async () => {
      mockQuery
        .mockResolvedValueOnce([schoolRow])
        .mockResolvedValueOnce([staffRow])
        .mockResolvedValueOnce([]);

      await OperationalNotificationService.notifyEmergencySos({
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        latitude: LAT,
        longitude: LNG,
        ...SNAPSHOT,
        speedKmh: 0,
      });

      const msgs = capturedStaffMessages();
      expect(msgs[0]).not.toContain('km/h');
    });
  });

  describe('fallback path (no snapshot fields)', () => {
    it('calls fetchTripContext when snapshot fields are omitted', async () => {
      // fetchTripContext JOIN result
      const tripRow = {
        tripId: TRIP_ID,
        schoolId: SCHOOL_ID,
        routeId: 'route-001',
        routeName: 'Route A - Morning',
        busId: 'bus-001',
        busNumber: 'MH-12-AB-1234',
        driverId: 'drv-001',
        driverName: 'Rajesh Kumar',
        driverPhone: '+919876543210',
        schoolPhone: '+9122001234',
        schoolEmergencyPhone: null,
      };

      mockQuery
        .mockResolvedValueOnce([tripRow])   // fetchTripContext
        .mockResolvedValueOnce([staffRow])  // fetchStaffContacts
        .mockResolvedValueOnce([]);         // fetchTripParents

      await OperationalNotificationService.notifyEmergencySos({
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        latitude: LAT,
        longitude: LNG,
        // No snapshot fields — should trigger DB JOIN
      });

      // fetchTripContext is the first query call
      const firstCallSql = (mockQuery.mock.calls[0]![0] as string).toLowerCase();
      expect(firstCallSql).toContain('join buses');

      const msgs = capturedStaffMessages();
      expect(msgs.length).toBeGreaterThan(0);
      expect(msgs[0]).toContain('MH-12-AB-1234');
    });
  });

  describe('stale INSERT guard', () => {
    it('does NOT issue INSERT INTO sos_events from notification service', async () => {
      mockQuery
        .mockResolvedValueOnce([schoolRow])
        .mockResolvedValueOnce([staffRow])
        .mockResolvedValueOnce([]);

      await OperationalNotificationService.notifyEmergencySos({
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        latitude: LAT,
        longitude: LNG,
        ...SNAPSHOT,
      });

      // No query call should contain INSERT INTO sos_events
      const allSqlCalls = mockQuery.mock.calls.map((c) =>
        (c[0] as string).toLowerCase()
      );
      const hasInsert = allSqlCalls.some((sql) => sql.includes('insert into sos_events'));
      expect(hasInsert).toBe(false);
    });
  });
});
