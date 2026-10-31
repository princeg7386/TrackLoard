import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { RouteDeviationService } from '../src/services/route-deviation.service.js';
import { AuthService } from '../src/services/auth.service.js';
import { UserRole, RouteGeometry } from '@school-bus/shared';
import * as database from '../src/config/database.js';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  pool: { end: vi.fn() },
}));

describe('Phase 28.2: Route Deviation — Detection Engine', () => {
  const app = createApp();

  const schoolId = '11111111-1111-1111-1111-111111111111';
  const otherSchoolId = '99999999-9999-9999-9999-999999999999';
  const routeId = '22222222-2222-2222-2222-222222222222';
  const tripId = '33333333-3333-3333-3333-333333333333';
  const busId = '44444444-4444-4444-4444-444444444444';
  const driverId = '55555555-5555-5555-5555-555555555555';
  const deviationId = '66666666-6666-6666-6666-666666666666';
  const stopId = '77777777-7777-7777-7777-777777777777';

  const adminToken = AuthService.generateToken({
    id: 'admin-111',
    schoolId,
    email: 'coord@school.com',
    role: UserRole.TRANSPORT_COORDINATOR,
  });

  const mockQuery = vi.mocked(database.query);

  // Shared straight-line route geometry for reuse
  const straightGeometry: RouteGeometry = {
    routeId,
    schoolId,
    name: 'Route Alpha',
    code: 'RA-01',
    routeType: 'MORNING_PICKUP',
    deviationThresholdMeters: 100,
    coordinates: [
      { latitude: 28.61, longitude: 77.20 },
      { latitude: 28.63, longitude: 77.22 },
    ],
    totalDistanceMeters: 3000,
    segmentCount: 1,
    stops: [
      { id: stopId, name: 'Stop A', sequenceOrder: 1, latitude: 28.61, longitude: 77.20, radiusMeters: 50 },
      { id: 'stop-b', name: 'Stop B', sequenceOrder: 2, latitude: 28.63, longitude: 77.22, radiusMeters: 50 },
    ],
    isFallbackFromStops: false,
  };

  /** Helper: stub loadRouteGeometry + active deviation (none) */
  function mockRouteLoad(geometry = straightGeometry) {
    // route row
    mockQuery.mockResolvedValueOnce([{
      id: geometry.routeId,
      school_id: geometry.schoolId,
      name: geometry.name,
      code: geometry.code,
      route_type: geometry.routeType,
      path_polyline: JSON.stringify(geometry.coordinates.map(c => [c.latitude, c.longitude])),
      deviation_threshold_meters: geometry.deviationThresholdMeters,
    }]);
    // stops
    mockQuery.mockResolvedValueOnce(geometry.stops.map(s => ({
      id: s.id,
      stop_name: s.name,
      sequence_order: s.sequenceOrder,
      latitude: s.latitude,
      longitude: s.longitude,
      geofence_radius_meters: s.radiusMeters,
    })));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset in-process debounce maps between tests by clearing them
    (RouteDeviationService as any)._deviationDebounce.clear();
    (RouteDeviationService as any)._resolveDebounce.clear();
  });

  // =========================================================================
  // 1. Debounce logic — opening a new deviation
  // =========================================================================
  describe('1. Debounce logic (OPEN_DEBOUNCE_POINTS = 3)', () => {
    it('first deviated ping: action = DEBOUNCING, count = 1, no DB insert', async () => {
      mockRouteLoad();
      // No active event
      mockQuery.mockResolvedValueOnce([]);

      const result = await RouteDeviationService.evaluateTripDeviationOnPing({
        tripId, schoolId, busId, driverId,
        routeId,
        busCoords: { latitude: 28.615, longitude: 77.235 }, // ~1300m off-route
        timestamp: new Date().toISOString(),
      });

      expect(result.action).toBe('DEBOUNCING');
      expect(result.debounceCount).toBe(1);
      expect(result.isDeviated).toBe(true);
      expect(result.activeDeviationId).toBeNull();
    });

    it('second deviated ping: still debouncing, count = 2', async () => {
      // Simulate 1 already in counter
      (RouteDeviationService as any)._deviationDebounce.set(tripId, 1);

      mockRouteLoad();
      mockQuery.mockResolvedValueOnce([]);

      const result = await RouteDeviationService.evaluateTripDeviationOnPing({
        tripId, schoolId, busId, driverId, routeId,
        busCoords: { latitude: 28.615, longitude: 77.235 },
        timestamp: new Date().toISOString(),
      });

      expect(result.action).toBe('DEBOUNCING');
      expect(result.debounceCount).toBe(2);
    });

    it('third deviated ping: opens deviation event (action = OPENED)', async () => {
      (RouteDeviationService as any)._deviationDebounce.set(tripId, 2);

      mockRouteLoad();
      // No active event
      mockQuery.mockResolvedValueOnce([]);
      // INSERT returns new id
      mockQuery.mockResolvedValueOnce([{ id: deviationId }]);

      const result = await RouteDeviationService.evaluateTripDeviationOnPing({
        tripId, schoolId, busId, driverId, routeId,
        busCoords: { latitude: 28.615, longitude: 77.235 },
        timestamp: new Date().toISOString(),
      });

      expect(result.action).toBe('OPENED');
      expect(result.activeDeviationId).toBe(deviationId);
      expect(result.severity).not.toBeNull();
      expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(result.severity);
      // Debounce counter should have been cleared
      expect((RouteDeviationService as any)._deviationDebounce.has(tripId)).toBe(false);
    });
  });

  // =========================================================================
  // 2. Active event update
  // =========================================================================
  describe('2. Active event update (action = UPDATED)', () => {
    it('updates current distance, max distance, duration, and severity when active event exists', async () => {
      mockRouteLoad();

      // Active event in DB
      const startedAt = new Date(Date.now() - 90_000).toISOString();
      mockQuery.mockResolvedValueOnce([{
        id: deviationId,
        school_id: schoolId,
        trip_id: tripId,
        bus_id: busId,
        driver_id: driverId,
        route_id: routeId,
        status: 'ACTIVE',
        severity: 'LOW',
        started_at: startedAt,
        resolved_at: null,
        duration_seconds: 90,
        max_deviation_distance_meters: 120,
        current_deviation_distance_meters: 120,
        threshold_distance_meters: 100,
        debounce_count: 3,
        deviation_latitude: 28.615,
        deviation_longitude: 77.235,
        nearest_route_latitude: 28.616,
        nearest_route_longitude: 77.221,
        nearest_stop_id: stopId,
        school_notified_at: null,
        driver_notified_at: null,
        notes: null,
      }]);

      // UPDATE query
      mockQuery.mockResolvedValueOnce([]);

      const result = await RouteDeviationService.evaluateTripDeviationOnPing({
        tripId, schoolId, busId, driverId, routeId,
        busCoords: { latitude: 28.615, longitude: 77.235 },
        timestamp: new Date().toISOString(),
      });

      expect(result.action).toBe('UPDATED');
      expect(result.activeDeviationId).toBe(deviationId);
      expect(result.isDeviated).toBe(true);
    });

    it('upgrades severity from LOW to MEDIUM when bus moves further away', async () => {
      mockRouteLoad();

      const startedAt = new Date(Date.now() - 60_000).toISOString();
      mockQuery.mockResolvedValueOnce([{
        id: deviationId,
        school_id: schoolId, trip_id: tripId, bus_id: busId,
        driver_id: driverId, route_id: routeId,
        status: 'ACTIVE', severity: 'LOW',
        started_at: startedAt, resolved_at: null,
        duration_seconds: 60,
        max_deviation_distance_meters: 110,
        current_deviation_distance_meters: 110,
        threshold_distance_meters: 100, debounce_count: 3,
        deviation_latitude: 28.615, deviation_longitude: 77.235,
        nearest_route_latitude: null, nearest_route_longitude: null,
        nearest_stop_id: null, school_notified_at: null,
        driver_notified_at: null, notes: null,
      }]);
      mockQuery.mockResolvedValueOnce([]);

      // ~300m deviation → MEDIUM
      const result = await RouteDeviationService.evaluateTripDeviationOnPing({
        tripId, schoolId, busId, driverId, routeId,
        busCoords: { latitude: 28.615, longitude: 77.228 }, // ~600m off
        timestamp: new Date().toISOString(),
      });

      expect(result.action).toBe('UPDATED');
      // The severity should be upgraded based on the new max distance
      expect(['MEDIUM', 'HIGH', 'CRITICAL']).toContain(result.severity);
    });
  });

  // =========================================================================
  // 3. Auto-resolve when bus returns to corridor
  // =========================================================================
  describe('3. Auto-resolve with return debounce (RESOLVE_DEBOUNCE_POINTS = 2)', () => {
    it('first on-route ping with active event: still debouncing resolve', async () => {
      mockRouteLoad();

      const startedAt = new Date(Date.now() - 180_000).toISOString();
      mockQuery.mockResolvedValueOnce([{
        id: deviationId,
        school_id: schoolId, trip_id: tripId, bus_id: busId,
        driver_id: driverId, route_id: routeId,
        status: 'ACTIVE', severity: 'MEDIUM',
        started_at: startedAt, resolved_at: null,
        duration_seconds: 180,
        max_deviation_distance_meters: 280,
        current_deviation_distance_meters: 60,
        threshold_distance_meters: 100, debounce_count: 3,
        deviation_latitude: 28.615, deviation_longitude: 77.228,
        nearest_route_latitude: null, nearest_route_longitude: null,
        nearest_stop_id: null, school_notified_at: null,
        driver_notified_at: null, notes: null,
      }]);

      // Bus is back on route (midpoint of segment)
      const result = await RouteDeviationService.evaluateTripDeviationOnPing({
        tripId, schoolId, busId, driverId, routeId,
        busCoords: { latitude: 28.62, longitude: 77.21 }, // on-route
        timestamp: new Date().toISOString(),
      });

      expect(result.action).toBe('DEBOUNCING');
      expect(result.isDeviated).toBe(false);
      expect(result.activeDeviationId).toBe(deviationId);
    });

    it('second on-route ping resolves the deviation event (action = RESOLVED)', async () => {
      // Pre-set resolve counter at 1
      (RouteDeviationService as any)._resolveDebounce.set(tripId, 1);

      mockRouteLoad();

      const startedAt = new Date(Date.now() - 200_000).toISOString();
      mockQuery.mockResolvedValueOnce([{
        id: deviationId,
        school_id: schoolId, trip_id: tripId, bus_id: busId,
        driver_id: driverId, route_id: routeId,
        status: 'ACTIVE', severity: 'MEDIUM',
        started_at: startedAt, resolved_at: null,
        duration_seconds: 200,
        max_deviation_distance_meters: 280,
        current_deviation_distance_meters: 50,
        threshold_distance_meters: 100, debounce_count: 3,
        deviation_latitude: 28.615, deviation_longitude: 77.228,
        nearest_route_latitude: null, nearest_route_longitude: null,
        nearest_stop_id: null, school_notified_at: null,
        driver_notified_at: null, notes: null,
      }]);

      // UPDATE query (resolve)
      mockQuery.mockResolvedValueOnce([]);

      const result = await RouteDeviationService.evaluateTripDeviationOnPing({
        tripId, schoolId, busId, driverId, routeId,
        busCoords: { latitude: 28.62, longitude: 77.21 },
        timestamp: new Date().toISOString(),
      });

      expect(result.action).toBe('RESOLVED');
      expect(result.isDeviated).toBe(false);
      expect(result.activeDeviationId).toBe(deviationId);
      // Resolve counter cleared
      expect((RouteDeviationService as any)._resolveDebounce.has(tripId)).toBe(false);
    });
  });

  // =========================================================================
  // 4. Healthy ping (no active event, bus on route)
  // =========================================================================
  describe('4. Healthy state (no event, on-route)', () => {
    it('returns action NONE when bus is on route and no active deviation', async () => {
      mockRouteLoad();
      mockQuery.mockResolvedValueOnce([]); // no active event

      const result = await RouteDeviationService.evaluateTripDeviationOnPing({
        tripId, schoolId, busId, driverId, routeId,
        busCoords: { latitude: 28.62, longitude: 77.21 }, // on-route
        timestamp: new Date().toISOString(),
      });

      expect(result.action).toBe('NONE');
      expect(result.isDeviated).toBe(false);
      expect(result.activeDeviationId).toBeUndefined();
    });

    it('debounce counter resets when bus returns to route between pings', async () => {
      // Start with counter = 2 (almost at threshold)
      (RouteDeviationService as any)._deviationDebounce.set(tripId, 2);

      mockRouteLoad();
      mockQuery.mockResolvedValueOnce([]); // no active event

      // On-route ping
      await RouteDeviationService.evaluateTripDeviationOnPing({
        tripId, schoolId, busId, driverId, routeId,
        busCoords: { latitude: 28.62, longitude: 77.21 }, // on-route
        timestamp: new Date().toISOString(),
      });

      // Counter must be cleared
      expect((RouteDeviationService as any)._deviationDebounce.has(tripId)).toBe(false);
    });
  });

  // =========================================================================
  // 5. getActiveDeviationForTrip
  // =========================================================================
  describe('5. getActiveDeviationForTrip', () => {
    it('returns null when no active deviation in DB', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const result = await RouteDeviationService.getActiveDeviationForTrip(tripId);
      expect(result).toBeNull();
    });

    it('returns mapped deviation record when active event exists', async () => {
      mockQuery.mockResolvedValueOnce([{
        id: deviationId,
        school_id: schoolId, trip_id: tripId, bus_id: busId,
        driver_id: driverId, route_id: routeId,
        status: 'ACTIVE', severity: 'HIGH',
        started_at: new Date(Date.now() - 300_000),
        resolved_at: null,
        duration_seconds: 300,
        max_deviation_distance_meters: 550,
        current_deviation_distance_meters: 500,
        threshold_distance_meters: 100, debounce_count: 3,
        deviation_latitude: 28.62, deviation_longitude: 77.24,
        nearest_route_latitude: 28.62, nearest_route_longitude: 77.22,
        nearest_stop_id: stopId, school_notified_at: null,
        driver_notified_at: null, notes: null,
      }]);

      const result = await RouteDeviationService.getActiveDeviationForTrip(tripId);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(deviationId);
      expect(result!.severity).toBe('HIGH');
      expect(result!.durationSeconds).toBe(300);
      expect(result!.nearestStopId).toBe(stopId);
    });
  });

  // =========================================================================
  // 6. getActiveDeviationsForSchool
  // =========================================================================
  describe('6. getActiveDeviationsForSchool', () => {
    it('returns empty array when no active deviations', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const result = await RouteDeviationService.getActiveDeviationsForSchool(schoolId);
      expect(result).toHaveLength(0);
    });

    it('returns all active deviations for the school', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: deviationId,
          school_id: schoolId, trip_id: tripId, bus_id: busId,
          driver_id: null, route_id: routeId,
          status: 'ACTIVE', severity: 'MEDIUM',
          started_at: new Date(), resolved_at: null,
          duration_seconds: 120, max_deviation_distance_meters: 220,
          current_deviation_distance_meters: 200,
          threshold_distance_meters: 100, debounce_count: 3,
          deviation_latitude: 28.62, deviation_longitude: 77.24,
          nearest_route_latitude: null, nearest_route_longitude: null,
          nearest_stop_id: null, school_notified_at: null,
          driver_notified_at: null, notes: null,
        },
      ]);

      const result = await RouteDeviationService.getActiveDeviationsForSchool(schoolId);
      expect(result).toHaveLength(1);
      expect(result[0]!.severity).toBe('MEDIUM');
    });
  });

  // =========================================================================
  // 7. HTTP Endpoints (Phase 28.2)
  // =========================================================================
  describe('7. HTTP Endpoints', () => {
    it('GET /schools/:schoolId/trips/:tripId/deviation — returns 200 with active deviation', async () => {
      mockQuery.mockResolvedValueOnce([{
        id: deviationId,
        school_id: schoolId, trip_id: tripId, bus_id: busId,
        driver_id: null, route_id: routeId,
        status: 'ACTIVE', severity: 'LOW',
        started_at: new Date(), resolved_at: null,
        duration_seconds: 30, max_deviation_distance_meters: 115,
        current_deviation_distance_meters: 110,
        threshold_distance_meters: 100, debounce_count: 3,
        deviation_latitude: 28.62, deviation_longitude: 77.21,
        nearest_route_latitude: null, nearest_route_longitude: null,
        nearest_stop_id: null, school_notified_at: null,
        driver_notified_at: null, notes: null,
      }]);

      const res = await request(app)
        .get(`/api/v1/telemetry/schools/${schoolId}/trips/${tripId}/deviation`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(deviationId);
      expect(res.body.data.severity).toBe('LOW');
    });

    it('GET /schools/:schoolId/trips/:tripId/deviation — returns null when no active deviation', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const res = await request(app)
        .get(`/api/v1/telemetry/schools/${schoolId}/trips/${tripId}/deviation`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it('GET /schools/:schoolId/deviations — returns school deviation list', async () => {
      mockQuery.mockResolvedValueOnce([{
        id: deviationId,
        school_id: schoolId, trip_id: tripId, bus_id: busId,
        driver_id: null, route_id: routeId,
        status: 'ACTIVE', severity: 'HIGH',
        started_at: new Date(), resolved_at: null,
        duration_seconds: 200, max_deviation_distance_meters: 520,
        current_deviation_distance_meters: 500,
        threshold_distance_meters: 100, debounce_count: 3,
        deviation_latitude: 28.62, deviation_longitude: 77.24,
        nearest_route_latitude: null, nearest_route_longitude: null,
        nearest_stop_id: null, school_notified_at: null,
        driver_notified_at: null, notes: null,
      }]);

      const res = await request(app)
        .get(`/api/v1/telemetry/schools/${schoolId}/deviations`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].severity).toBe('HIGH');
    });

    it('GET /schools/:otherSchoolId/deviations — 403 tenant isolation', async () => {
      const res = await request(app)
        .get(`/api/v1/telemetry/schools/${otherSchoolId}/deviations`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
    });

    it('GET /schools/:otherSchoolId/trips/:tripId/deviation — 403 tenant isolation', async () => {
      const res = await request(app)
        .get(`/api/v1/telemetry/schools/${otherSchoolId}/trips/${tripId}/deviation`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
    });
  });
});
