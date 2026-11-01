/**
 * Phase 30.2 — SOS Capture: Unit Tests
 *
 * Tests the enriched triggerSos() logic:
 *  - Active trip guard (rejects SCHEDULED / COMPLETED / CANCELLED)
 *  - IN_PROGRESS trip is accepted
 *  - Snapshot columns captured (bus_number, driver_name, driver_phone, route_name)
 *  - GPS quality captured (gps_accuracy_m, gps_recorded_at)
 *  - Graceful fallback when GPS has no accuracy_meters
 *  - getActiveSosEvents returns new snapshot fields
 *  - getSosEventById returns new snapshot fields
 *
 * Pattern: real SosService + vi.spyOn(query) — no HTTP layer, no mocked modules.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the database module so no real DB connection is needed ────────────────
vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
}));

// ── Mock operational-notification so no WhatsApp / messaging calls happen ──────
vi.mock('../src/services/operational-notification.service.js', () => ({
  OperationalNotificationService: {
    notifyEmergencySos: vi.fn().mockResolvedValue({ notificationsSent: 0 }),
  },
}));

// ── Mock logger ────────────────────────────────────────────────────────────────
vi.mock('../src/services/logger.service.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { query } from '../src/config/database.js';
import { SosService } from '../src/services/sos.service.js';
import { SosStatus } from '@school-bus/shared';

const mockQuery = vi.mocked(query);

// ── Shared fixtures ────────────────────────────────────────────────────────────

const SCHOOL_ID = 'sch-001';
const TRIP_ID = 'trip-001';
const BUS_ID = 'bus-001';
const DRIVER_ID = 'drv-001';
const SOS_ID = 'sos-001';
const ADMIN_ID = 'admin-001';

/** A valid IN_TRANSIT trip row with enriched JOIN columns (Phase 30.2) */
const activeTripRow = {
  id: TRIP_ID,
  busId: BUS_ID,
  driverId: DRIVER_ID,
  schoolId: SCHOOL_ID,
  status: 'IN_TRANSIT',
  busNumber: 'MH-12-AB-1234',
  driverName: 'Rajesh Kumar',
  driverPhone: '+919876543210',
  routeName: 'Route A - Morning',
};

/** A valid GPS row with accuracy and recorded_at (Phase 30.2) */
const gpsRow = {
  latitude: 18.5204,
  longitude: 73.8567,
  speedKmh: 32,
  accuracyMeters: 8.5,
  recordedAt: '2026-11-01T05:00:00Z',
};

/** The SOS event DB row returned after INSERT (with snapshot columns) */
const sosDbRow = {
  id: SOS_ID,
  school_id: SCHOOL_ID,
  trip_id: TRIP_ID,
  bus_id: BUS_ID,
  driver_id: DRIVER_ID,
  trigger_source: 'APP_SOS_BUTTON',
  latitude: '18.5204',
  longitude: '73.8567',
  speed_kmh: '32',
  status: 'TRIGGERED',
  acknowledged_by: null,
  acknowledged_at: null,
  resolved_at: null,
  resolution_notes: null,
  created_at: '2026-11-01T05:00:10Z',
  bus_number: 'MH-12-AB-1234',
  driver_name: 'Rajesh Kumar',
  driver_phone: '+919876543210',
  route_name: 'Route A - Morning',
  gps_accuracy_m: '8.5',
  gps_recorded_at: '2026-11-01T05:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Phase 30.2 — SOS Capture', () => {
  describe('triggerSos — active trip guard', () => {
    it('rejects SOS when trip status is SCHEDULED', async () => {
      mockQuery.mockResolvedValueOnce([{ ...activeTripRow, status: 'SCHEDULED' }]);

      await expect(
        SosService.triggerSos({ schoolId: SCHOOL_ID, tripId: TRIP_ID })
      ).rejects.toThrow(/not active.*SCHEDULED/i);
    });

    it('rejects SOS when trip status is COMPLETED', async () => {
      mockQuery.mockResolvedValueOnce([{ ...activeTripRow, status: 'COMPLETED' }]);

      await expect(
        SosService.triggerSos({ schoolId: SCHOOL_ID, tripId: TRIP_ID })
      ).rejects.toThrow(/not active.*COMPLETED/i);
    });

    it('rejects SOS when trip status is CANCELLED', async () => {
      mockQuery.mockResolvedValueOnce([{ ...activeTripRow, status: 'CANCELLED' }]);

      await expect(
        SosService.triggerSos({ schoolId: SCHOOL_ID, tripId: TRIP_ID })
      ).rejects.toThrow(/not active.*CANCELLED/i);
    });

    it('accepts SOS when trip status is IN_TRANSIT', async () => {
      // trip query → GPS query → INSERT → (notification fire-and-forget suppressed)
      mockQuery
        .mockResolvedValueOnce([activeTripRow])          // trip JOIN
        .mockResolvedValueOnce([gpsRow])                  // GPS
        .mockResolvedValueOnce([{ id: SOS_ID }]);         // INSERT

      const result = await SosService.triggerSos({ schoolId: SCHOOL_ID, tripId: TRIP_ID });

      expect(result.sosEventId).toBe(SOS_ID);
      expect(result.status).toBe(SosStatus.TRIGGERED);
    });

    it('accepts SOS when trip status is DELAYED', async () => {
      mockQuery
        .mockResolvedValueOnce([{ ...activeTripRow, status: 'DELAYED' }])
        .mockResolvedValueOnce([gpsRow])
        .mockResolvedValueOnce([{ id: SOS_ID }]);

      const result = await SosService.triggerSos({ schoolId: SCHOOL_ID, tripId: TRIP_ID });

      expect(result.sosEventId).toBe(SOS_ID);
    });

    it('accepts SOS when trip status is ARRIVED_SCHOOL', async () => {
      mockQuery
        .mockResolvedValueOnce([{ ...activeTripRow, status: 'ARRIVED_SCHOOL' }])
        .mockResolvedValueOnce([gpsRow])
        .mockResolvedValueOnce([{ id: SOS_ID }]);

      const result = await SosService.triggerSos({ schoolId: SCHOOL_ID, tripId: TRIP_ID });

      expect(result.sosEventId).toBe(SOS_ID);
    });
  });

  describe('triggerSos — snapshot capture', () => {
    it('stores bus_number, driver_name, driver_phone, route_name from trip JOIN', async () => {
      mockQuery
        .mockResolvedValueOnce([activeTripRow])
        .mockResolvedValueOnce([gpsRow])
        .mockResolvedValueOnce([{ id: SOS_ID }]);

      const result = await SosService.triggerSos({ schoolId: SCHOOL_ID, tripId: TRIP_ID });

      // INSERT must receive the snapshot fields as parameters
      const insertCall = mockQuery.mock.calls[2]!;
      const insertParams = insertCall[1] as unknown[];

      expect(insertParams).toContain('MH-12-AB-1234');   // bus_number
      expect(insertParams).toContain('Rajesh Kumar');     // driver_name
      expect(insertParams).toContain('+919876543210');    // driver_phone
      expect(insertParams).toContain('Route A - Morning'); // route_name

      // Result also exposes snapshot
      expect(result.busNumber).toBe('MH-12-AB-1234');
      expect(result.driverName).toBe('Rajesh Kumar');
      expect(result.routeName).toBe('Route A - Morning');
    });

    it('stores gps_accuracy_m and gps_recorded_at from GPS row', async () => {
      mockQuery
        .mockResolvedValueOnce([activeTripRow])
        .mockResolvedValueOnce([gpsRow])
        .mockResolvedValueOnce([{ id: SOS_ID }]);

      await SosService.triggerSos({ schoolId: SCHOOL_ID, tripId: TRIP_ID });

      const insertParams = mockQuery.mock.calls[2]![1] as unknown[];

      expect(insertParams).toContain(8.5);                       // gps_accuracy_m
      expect(insertParams).toContain('2026-11-01T05:00:00Z');    // gps_recorded_at
    });

    it('stores null for gps_accuracy_m when GPS row has no accuracy', async () => {
      const gpsRowNoAccuracy = { ...gpsRow, accuracyMeters: null };

      mockQuery
        .mockResolvedValueOnce([activeTripRow])
        .mockResolvedValueOnce([gpsRowNoAccuracy])
        .mockResolvedValueOnce([{ id: SOS_ID }]);

      await SosService.triggerSos({ schoolId: SCHOOL_ID, tripId: TRIP_ID });

      const insertParams = mockQuery.mock.calls[2]![1] as unknown[];

      // $14 (index 13) = gps_accuracy_m — should be null
      expect(insertParams[13]).toBeNull();
    });

    it('uses explicit lat/lng when provided (skips GPS query) and captures provided speed', async () => {
      mockQuery
        .mockResolvedValueOnce([activeTripRow])   // trip
        .mockResolvedValueOnce([{ id: SOS_ID }]); // INSERT (no GPS query)

      const result = await SosService.triggerSos({
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        latitude: 18.9999,
        longitude: 72.8888,
        speedKmh: 55,
      });

      // Only 2 query calls: trip + INSERT (no GPS fetch)
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(result.latitude).toBeCloseTo(18.9999);
      expect(result.longitude).toBeCloseTo(72.8888);
    });
  });

  describe('getActiveSosEvents — snapshot fields', () => {
    it('returns snapshot fields from DB row', async () => {
      mockQuery.mockResolvedValueOnce([sosDbRow]);

      const events = await SosService.getActiveSosEvents(SCHOOL_ID);

      expect(events).toHaveLength(1);
      const ev = events[0]!;
      expect(ev.busNumber).toBe('MH-12-AB-1234');
      expect(ev.driverName).toBe('Rajesh Kumar');
      expect(ev.driverPhone).toBe('+919876543210');
      expect(ev.routeName).toBe('Route A - Morning');
      expect(ev.gpsAccuracyM).toBeCloseTo(8.5);
      expect(ev.gpsRecordedAt).toBe('2026-11-01T05:00:00Z');
    });

    it('returns null snapshot fields when columns are null', async () => {
      const nullSnapshotRow = {
        ...sosDbRow,
        bus_number: null,
        driver_name: null,
        driver_phone: null,
        route_name: null,
        gps_accuracy_m: null,
        gps_recorded_at: null,
      };
      mockQuery.mockResolvedValueOnce([nullSnapshotRow]);

      const events = await SosService.getActiveSosEvents(SCHOOL_ID);

      const ev = events[0]!;
      expect(ev.busNumber).toBeNull();
      expect(ev.gpsAccuracyM).toBeNull();
      expect(ev.gpsRecordedAt).toBeNull();
    });
  });

  describe('getSosEventById — snapshot fields', () => {
    it('returns full snapshot on single event fetch', async () => {
      mockQuery.mockResolvedValueOnce([sosDbRow]);

      const ev = await SosService.getSosEventById(SOS_ID, SCHOOL_ID);

      expect(ev).not.toBeNull();
      expect(ev!.busNumber).toBe('MH-12-AB-1234');
      expect(ev!.driverName).toBe('Rajesh Kumar');
      expect(ev!.routeName).toBe('Route A - Morning');
    });
  });

  describe('acknowledgeSos / resolveSos — snapshot preserved via getSosEventById', () => {
    it('acknowledgeSos returns enriched record', async () => {
      // UPDATE returning id
      mockQuery.mockResolvedValueOnce([{ id: SOS_ID }]);
      // getSosEventById SELECT
      mockQuery.mockResolvedValueOnce([{ ...sosDbRow, status: 'ACKNOWLEDGED', acknowledged_by: ADMIN_ID, acknowledged_at: '2026-11-01T05:05:00Z' }]);

      const result = await SosService.acknowledgeSos(SOS_ID, SCHOOL_ID, ADMIN_ID);

      expect(result.status).toBe(SosStatus.ACKNOWLEDGED);
      expect(result.busNumber).toBe('MH-12-AB-1234');
    });

    it('resolveSos returns enriched record with notes', async () => {
      mockQuery.mockResolvedValueOnce([{ id: SOS_ID }]);
      mockQuery.mockResolvedValueOnce([{ ...sosDbRow, status: 'RESOLVED', resolved_at: '2026-11-01T05:30:00Z', resolution_notes: 'Police arrived' }]);

      const result = await SosService.resolveSos(SOS_ID, SCHOOL_ID, 'Police arrived');

      expect(result.status).toBe(SosStatus.RESOLVED);
      expect(result.resolutionNotes).toBe('Police arrived');
      expect(result.driverName).toBe('Rajesh Kumar');
    });
  });
});
