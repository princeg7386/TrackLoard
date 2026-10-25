import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeofenceService } from '../src/services/geofence.service.js';
import { SpatialService } from '../src/services/spatial.service.js';
import { RealtimeFeedService } from '../src/services/realtime-feed.service.js';
import * as db from '../src/config/database.js';

// ---------------------------------------------------------------------------
// Phase 21.1 — Pickup Geofence Engine Tests
// Tasks: Create radius/shape · Detect entry · Detect exit
// ---------------------------------------------------------------------------

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_SCHOOL_ID = '99999999-9999-9999-9999-999999999999';
const ROUTE_ID = '22222222-2222-2222-2222-222222222222';
const TRIP_ID = '33333333-3333-3333-3333-333333333333';
const BUS_ID = '44444444-4444-4444-4444-444444444444';
const STOP_1_ID = '55555555-5555-5555-5555-555555555555';
const STOP_2_ID = '66666666-6666-6666-6666-666666666666';

// Stop 1: Connaught Place center (Radius geofence 300m)
const STOP_1 = {
  id: STOP_1_ID,
  stopName: 'Connaught Place Inner Circle',
  sequenceOrder: 1,
  latitude: 28.6315,
  longitude: 77.2167,
  geofenceType: 'RADIUS' as const,
  geofenceRadiusMeters: 300,
  geofencePolygon: null,
};

// Stop 2: India Gate quadrangle (Custom Polygon Geofence)
const POLYGON_VERTICES = [
  { latitude: 28.614, longitude: 77.228 },
  { latitude: 28.614, longitude: 77.232 },
  { latitude: 28.611, longitude: 77.232 },
  { latitude: 28.611, longitude: 77.228 },
];

const STOP_2 = {
  id: STOP_2_ID,
  stopName: 'India Gate Lawns',
  sequenceOrder: 2,
  latitude: 28.6129,
  longitude: 77.2295,
  geofenceType: 'POLYGON' as const,
  geofenceRadiusMeters: 400,
  geofencePolygon: POLYGON_VERTICES,
};

describe('Phase 21.1 — SpatialService Geofence Algorithms (Task 1: Radius & Shape)', () => {
  it('correctly evaluates point-in-polygon ray casting algorithm', () => {
    // Point inside India Gate quadrangle
    const insidePoint = { latitude: 28.6125, longitude: 77.2300 };
    expect(SpatialService.isPointInPolygon(insidePoint, POLYGON_VERTICES)).toBe(true);

    // Point outside (further north)
    const outsidePoint = { latitude: 28.6200, longitude: 77.2300 };
    expect(SpatialService.isPointInPolygon(outsidePoint, POLYGON_VERTICES)).toBe(false);

    // Point outside (further east)
    const farEast = { latitude: 28.6125, longitude: 77.2450 };
    expect(SpatialService.isPointInPolygon(farEast, POLYGON_VERTICES)).toBe(false);

    // Invalid polygon with < 3 vertices returns false
    expect(SpatialService.isPointInPolygon(insidePoint, [{ latitude: 1, longitude: 1 }])).toBe(false);
  });

  it('generates valid PostGIS Polygon WKT and auto-closes unclosed rings', () => {
    const unclosed = [
      { latitude: 28.614, longitude: 77.228 },
      { latitude: 28.614, longitude: 77.232 },
      { latitude: 28.611, longitude: 77.232 },
    ];
    const sql = SpatialService.toGeographyPolygonSql(unclosed);
    expect(sql).toContain("ST_SetSRID(ST_GeogFromText('POLYGON((");
    // Verified that first vertex is appended at the end to close ring
    expect(sql).toContain('77.228 28.614))');

    // Throws on fewer than 3 vertices
    expect(() => SpatialService.toGeographyPolygonSql([{ latitude: 0, longitude: 0 }])).toThrow();
  });

  it('hybrid isPointInGeofenceShape evaluates both circular radius and polygon shapes', () => {
    // Test Stop 1 (Circular Radius)
    // 50m away from Connaught Place center
    const nearStop1 = { latitude: 28.6318, longitude: 77.2170 };
    const resNear1 = SpatialService.isPointInGeofenceShape(nearStop1, STOP_1);
    expect(resNear1.isInside).toBe(true);
    expect(resNear1.distanceMeters).toBeLessThan(100);

    // 1.5km away from Connaught Place center
    const farStop1 = { latitude: 28.6450, longitude: 77.2170 };
    const resFar1 = SpatialService.isPointInGeofenceShape(farStop1, STOP_1);
    expect(resFar1.isInside).toBe(false);
    expect(resFar1.distanceMeters).toBeGreaterThan(1000);

    // Test Stop 2 (Polygon Shape)
    const insideStop2 = { latitude: 28.6125, longitude: 77.2300 };
    const resInside2 = SpatialService.isPointInGeofenceShape(insideStop2, STOP_2);
    expect(resInside2.isInside).toBe(true);

    const outsideStop2 = { latitude: 28.6150, longitude: 77.2300 };
    const resOutside2 = SpatialService.isPointInGeofenceShape(outsideStop2, STOP_2);
    expect(resOutside2.isInside).toBe(false);
  });
});

describe('Phase 21.1 — GeofenceService: Entry & Exit Detection (Tasks 2 & 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects ENTRY transition when bus moves from OUTSIDE to INSIDE a stop geofence', async () => {
    const querySpy = vi.spyOn(db, 'query');

    // 1. Return route stops for trip (Stop 1 & Stop 2)
    querySpy.mockResolvedValueOnce([STOP_1, STOP_2]);

    // 2. Return existing states (both currently OUTSIDE)
    querySpy.mockResolvedValueOnce([
      { stopId: STOP_1_ID, status: 'OUTSIDE', enteredAt: null, exitedAt: null, dwellTimeSeconds: 0 },
      { stopId: STOP_2_ID, status: 'OUTSIDE', enteredAt: null, exitedAt: null, dwellTimeSeconds: 0 },
    ]);

    // 3. geofence_events INSERT for Stop 1
    querySpy.mockResolvedValueOnce([{ id: 'event-001' }]);

    // 4. trip_stop_geofence_states UPSERT for Stop 1
    querySpy.mockResolvedValueOnce([]);

    const publishSpy = vi.spyOn(RealtimeFeedService, 'publish').mockImplementation(() => {});

    // Position bus inside Stop 1 (~50m from center)
    const pingTime = new Date('2026-10-25T08:15:00.000Z');
    const result = await GeofenceService.evaluateTripStops({
      tripId: TRIP_ID,
      schoolId: SCHOOL_ID,
      busId: BUS_ID,
      latitude: 28.6318,
      longitude: 77.2170,
      recordedAt: pingTime,
    });

    expect(result.evaluatedStopsCount).toBe(2);
    expect(result.transitions.length).toBe(1);

    const t1 = result.transitions[0]!;
    expect(t1.stopId).toBe(STOP_1_ID);
    expect(t1.eventType).toBe('ENTRY');
    expect(t1.previousStatus).toBe('OUTSIDE');
    expect(t1.currentStatus).toBe('INSIDE');
    expect(t1.enteredAt).toBe('2026-10-25T08:15:00.000Z');
    expect(t1.distanceToCenterMeters).toBeLessThan(100);

    // Verify RealtimeFeedService emitted GEOFENCE_EVENT
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'GEOFENCE_EVENT',
        eventType: 'ENTRY',
        status: 'INSIDE',
        stopId: STOP_1_ID,
        tripId: TRIP_ID,
      })
    );
  });

  it('detects EXIT transition and calculates accurate dwell time in seconds', async () => {
    const querySpy = vi.spyOn(db, 'query');

    // 1. Return route stops for trip (Stop 1 & Stop 2)
    querySpy.mockResolvedValueOnce([STOP_1, STOP_2]);

    // 2. Existing states: Stop 1 was INSIDE since 08:10:00 (5 minutes ago)
    const enteredAt = '2026-10-25T08:10:00.000Z';
    querySpy.mockResolvedValueOnce([
      { stopId: STOP_1_ID, status: 'INSIDE', enteredAt, exitedAt: null, dwellTimeSeconds: 0 },
      { stopId: STOP_2_ID, status: 'OUTSIDE', enteredAt: null, exitedAt: null, dwellTimeSeconds: 0 },
    ]);

    // 3. geofence_events INSERT for Stop 1 EXIT
    querySpy.mockResolvedValueOnce([{ id: 'event-002' }]);

    // 4. trip_stop_geofence_states UPSERT for Stop 1
    querySpy.mockResolvedValueOnce([]);

    const publishSpy = vi.spyOn(RealtimeFeedService, 'publish').mockImplementation(() => {});

    // Position bus 1.2km away from Stop 1 at 08:15:00 (300 seconds dwell time)
    const exitTime = new Date('2026-10-25T08:15:00.000Z');
    const result = await GeofenceService.evaluateTripStops({
      tripId: TRIP_ID,
      schoolId: SCHOOL_ID,
      busId: BUS_ID,
      latitude: 28.6450,
      longitude: 77.2170,
      recordedAt: exitTime,
    });

    expect(result.transitions.length).toBe(1);
    const tExit = result.transitions[0]!;
    expect(tExit.stopId).toBe(STOP_1_ID);
    expect(tExit.eventType).toBe('EXIT');
    expect(tExit.previousStatus).toBe('INSIDE');
    expect(tExit.currentStatus).toBe('OUTSIDE');
    expect(tExit.dwellTimeSeconds).toBe(300); // 5 minutes = 300 seconds
    expect(tExit.exitedAt).toBe('2026-10-25T08:15:00.000Z');

    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'GEOFENCE_EVENT',
        eventType: 'EXIT',
        status: 'OUTSIDE',
        stopId: STOP_1_ID,
        dwellTimeSeconds: 300,
      })
    );
  });

  it('detects ENTRY into custom polygon shape geofence', async () => {
    const querySpy = vi.spyOn(db, 'query');

    // Return Stop 2 (Polygon)
    querySpy.mockResolvedValueOnce([STOP_2]);

    // Current state for Stop 2 is OUTSIDE
    querySpy.mockResolvedValueOnce([
      { stopId: STOP_2_ID, status: 'OUTSIDE', enteredAt: null, exitedAt: null, dwellTimeSeconds: 0 },
    ]);

    // Inserts for geofence_events and trip_stop_geofence_states
    querySpy.mockResolvedValueOnce([{ id: 'event-003' }]);
    querySpy.mockResolvedValueOnce([]);

    const pingTime = new Date('2026-10-25T08:20:00.000Z');
    const result = await GeofenceService.evaluateTripStops({
      tripId: TRIP_ID,
      schoolId: SCHOOL_ID,
      busId: BUS_ID,
      latitude: 28.6125, // Inside polygon
      longitude: 77.2300,
      recordedAt: pingTime,
    });

    expect(result.transitions.length).toBe(1);
    expect(result.transitions[0]?.stopId).toBe(STOP_2_ID);
    expect(result.transitions[0]?.eventType).toBe('ENTRY');
  });

  it('generates no transition events when bus remains inside the geofence (updates dwell time)', async () => {
    const querySpy = vi.spyOn(db, 'query');

    querySpy.mockResolvedValueOnce([STOP_1]);
    querySpy.mockResolvedValueOnce([
      {
        stopId: STOP_1_ID,
        status: 'INSIDE',
        enteredAt: '2026-10-25T08:10:00.000Z',
        exitedAt: null,
        dwellTimeSeconds: 60,
      },
    ]);
    // Heartbeat dwell time update
    querySpy.mockResolvedValueOnce([]);

    const pingTime = new Date('2026-10-25T08:12:00.000Z'); // 120s dwell
    const result = await GeofenceService.evaluateTripStops({
      tripId: TRIP_ID,
      schoolId: SCHOOL_ID,
      busId: BUS_ID,
      latitude: 28.6316,
      longitude: 77.2168,
      recordedAt: pingTime,
    });

    expect(result.transitions.length).toBe(0);
    // Verified that query called UPDATE trip_stop_geofence_states
    expect(querySpy).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE trip_stop_geofence_states'),
      expect.arrayContaining([120, '2026-10-25T08:12:00.000Z', TRIP_ID, STOP_1_ID])
    );
  });
});

describe('Phase 21.1 — Geofence Configuration & State Queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getTripGeofenceStates enforces tenant isolation and returns stop states', async () => {
    const querySpy = vi.spyOn(db, 'query');

    // 1. Cross-tenant check fails
    querySpy.mockResolvedValueOnce([{ id: TRIP_ID, school_id: OTHER_SCHOOL_ID }]);
    await expect(
      GeofenceService.getTripGeofenceStates(TRIP_ID, SCHOOL_ID)
    ).rejects.toThrow('Cross-tenant');

    // 2. Same tenant succeeds
    querySpy.mockResolvedValueOnce([{ id: TRIP_ID, school_id: SCHOOL_ID }]);
    querySpy.mockResolvedValueOnce([
      {
        id: 'state-1',
        tripId: TRIP_ID,
        stopId: STOP_1_ID,
        stopName: STOP_1.stopName,
        sequenceOrder: 1,
        status: 'INSIDE',
        enteredAt: '2026-10-25T08:10:00.000Z',
        exitedAt: null,
        dwellTimeSeconds: 120,
        lastEvaluatedAt: '2026-10-25T08:12:00.000Z',
      },
    ]);

    const states = await GeofenceService.getTripGeofenceStates(TRIP_ID, SCHOOL_ID);
    expect(states.length).toBe(1);
    expect(states[0]?.status).toBe('INSIDE');
    expect(states[0]?.dwellTimeSeconds).toBe(120);
  });

  it('getTripGeofenceEvents returns chronological event ledger for trip', async () => {
    const querySpy = vi.spyOn(db, 'query');

    querySpy.mockResolvedValueOnce([{ id: TRIP_ID, school_id: SCHOOL_ID }]);
    querySpy.mockResolvedValueOnce([
      {
        id: 'evt-1',
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        busId: BUS_ID,
        stopId: STOP_1_ID,
        stopName: STOP_1.stopName,
        sequenceOrder: 1,
        eventType: 'ENTRY',
        latitude: 28.6318,
        longitude: 77.2170,
        distanceToCenterMeters: 45,
        dwellTimeSeconds: null,
        recordedAt: '2026-10-25T08:10:00.000Z',
        createdAt: '2026-10-25T08:10:01.000Z',
      },
      {
        id: 'evt-2',
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        busId: BUS_ID,
        stopId: STOP_1_ID,
        stopName: STOP_1.stopName,
        sequenceOrder: 1,
        eventType: 'EXIT',
        latitude: 28.6450,
        longitude: 77.2170,
        distanceToCenterMeters: 1200,
        dwellTimeSeconds: 180,
        recordedAt: '2026-10-25T08:13:00.000Z',
        createdAt: '2026-10-25T08:13:01.000Z',
      },
    ]);

    const events = await GeofenceService.getTripGeofenceEvents(TRIP_ID, SCHOOL_ID);
    expect(events.length).toBe(2);
    expect(events[0]?.eventType).toBe('ENTRY');
    expect(events[1]?.eventType).toBe('EXIT');
    expect(events[1]?.dwellTimeSeconds).toBe(180);
  });

  it('updateStopGeofence updates stop to POLYGON shape and generates geometry', async () => {
    const querySpy = vi.spyOn(db, 'query');

    querySpy.mockResolvedValueOnce([
      {
        geofenceType: 'POLYGON',
        geofenceRadiusMeters: 400,
        geofencePolygon: POLYGON_VERTICES,
      },
    ]);

    const result = await GeofenceService.updateStopGeofence(SCHOOL_ID, ROUTE_ID, STOP_2_ID, {
      geofenceType: 'POLYGON',
      geofenceRadiusMeters: 400,
      geofencePolygon: POLYGON_VERTICES,
    });

    expect(result.geofenceType).toBe('POLYGON');
    expect(result.geofencePolygon?.length).toBe(4);
    expect(querySpy).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE pickup_locations'),
      expect.arrayContaining(['POLYGON', STOP_2_ID, ROUTE_ID, SCHOOL_ID, 400])
    );
  });

  it('updateStopGeofence rejects invalid polygon with fewer than 3 vertices', async () => {
    await expect(
      GeofenceService.updateStopGeofence(SCHOOL_ID, ROUTE_ID, STOP_2_ID, {
        geofenceType: 'POLYGON',
        geofencePolygon: [{ latitude: 28.614, longitude: 77.228 }],
      })
    ).rejects.toThrow('at least 3 vertices');
  });
});
