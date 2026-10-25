import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { RouteDeviationService } from '../src/services/route-deviation.service.js';
import { AuthService } from '../src/services/auth.service.js';
import {
  UserRole,
  RouteGeometry,
  calculateHaversineDistanceMeters,
} from '@school-bus/shared';
import * as database from '../src/config/database.js';

// Mock database query
vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  pool: { end: vi.fn() },
}));

describe('Phase 28.1: Route Deviation — Expected Route & Real-Time Position Analysis', () => {
  const app = createApp();

  const schoolId = '11111111-1111-1111-1111-111111111111';
  const otherSchoolId = '99999999-9999-9999-9999-999999999999';
  const routeId = '22222222-2222-2222-2222-222222222222';
  const tripId = '33333333-3333-3333-3333-333333333333';
  const busId = '44444444-4444-4444-4444-444444444444';
  const driverId = '55555555-5555-5555-5555-555555555555';

  const mockAdminUser = {
    id: 'admin-111',
    schoolId,
    email: 'coordinator@school.com',
    role: UserRole.TRANSPORT_COORDINATOR,
  };
  const adminToken = AuthService.generateToken(mockAdminUser);

  const mockQuery = vi.mocked(database.query);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Geometric Projection & Position Determination', () => {
    // Reference route along Connaught Place to India Gate (New Delhi)
    // Segment 1: [28.6315, 77.2167] -> [28.6250, 77.2180]
    // Segment 2: [28.6250, 77.2180] -> [28.6129, 77.2295]
    const sampleGeometry: RouteGeometry = {
      routeId,
      schoolId,
      name: 'Central City Route 1',
      code: 'R-01',
      routeType: 'MORNING_PICKUP',
      deviationThresholdMeters: 100,
      coordinates: [
        { latitude: 28.6315, longitude: 77.2167 },
        { latitude: 28.625, longitude: 77.218 },
        { latitude: 28.6129, longitude: 77.2295 },
      ],
      totalDistanceMeters:
        calculateHaversineDistanceMeters(
          { latitude: 28.6315, longitude: 77.2167 },
          { latitude: 28.625, longitude: 77.218 }
        ) +
        calculateHaversineDistanceMeters(
          { latitude: 28.625, longitude: 77.218 },
          { latitude: 28.6129, longitude: 77.2295 }
        ),
      segmentCount: 2,
      stops: [
        {
          id: 'stop-1',
          name: 'Connaught Circle',
          sequenceOrder: 1,
          latitude: 28.6315,
          longitude: 77.2167,
          radiusMeters: 50,
        },
        {
          id: 'stop-2',
          name: 'Janpath Junction',
          sequenceOrder: 2,
          latitude: 28.625,
          longitude: 77.218,
          radiusMeters: 50,
        },
        {
          id: 'stop-3',
          name: 'India Gate Main',
          sequenceOrder: 3,
          latitude: 28.6129,
          longitude: 77.2295,
          radiusMeters: 50,
        },
      ],
      isFallbackFromStops: false,
    };

    it('identifies bus exactly on route as ON-ROUTE with zero/negligible distance', () => {
      // Midpoint of Segment 1
      const onRouteBus = {
        latitude: (28.6315 + 28.625) / 2,
        longitude: (77.2167 + 77.218) / 2,
      };

      const result = RouteDeviationService.determineBusPositionRelativeToRoute(
        onRouteBus,
        sampleGeometry
      );

      expect(result.isOnRoute).toBe(true);
      expect(result.isDeviated).toBe(false);
      expect(result.distanceToRouteMeters).toBeLessThan(5); // Within 5 meters
      expect(result.nearestSegmentIndex).toBe(0);
      expect(result.progressPercentage).toBeGreaterThan(0);
      expect(result.progressPercentage).toBeLessThan(50);
    });

    it('identifies bus within 100m corridor as ON-ROUTE', () => {
      // Slightly offset by ~35 meters
      const parallelBus = {
        latitude: 28.62825,
        longitude: 77.2177,
      };

      const result = RouteDeviationService.determineBusPositionRelativeToRoute(
        parallelBus,
        sampleGeometry
      );

      expect(result.isOnRoute).toBe(true);
      expect(result.isDeviated).toBe(false);
      expect(result.distanceToRouteMeters).toBeLessThan(100);
      expect(result.distanceToRouteMeters).toBeGreaterThan(10);
    });

    it('flags bus deviated beyond 100m corridor as DEVIATED', () => {
      // Bus shifted 500 meters East
      const deviatedBus = {
        latitude: 28.625,
        longitude: 77.224, // ~580m away from [28.6250, 77.2180]
      };

      const result = RouteDeviationService.determineBusPositionRelativeToRoute(
        deviatedBus,
        sampleGeometry
      );

      expect(result.isOnRoute).toBe(false);
      expect(result.isDeviated).toBe(true);
      expect(result.distanceToRouteMeters).toBeGreaterThan(100);
      expect(result.nearestStop?.id).toBe('stop-2');
    });

    it('honors custom deviationThresholdMeters override', () => {
      const moderatelyDeviatedBus = {
        latitude: 28.625,
        longitude: 77.2195, // ~145m offset
      };

      // Default 100m -> deviated
      const defaultResult = RouteDeviationService.determineBusPositionRelativeToRoute(
        moderatelyDeviatedBus,
        sampleGeometry
      );
      expect(defaultResult.isDeviated).toBe(true);

      // Relaxed threshold 200m -> on route
      const relaxedResult = RouteDeviationService.determineBusPositionRelativeToRoute(
        moderatelyDeviatedBus,
        sampleGeometry,
        { deviationThresholdMeters: 200 }
      );
      expect(relaxedResult.isDeviated).toBe(false);
      expect(relaxedResult.deviationThresholdMeters).toBe(200);
    });

    it('correctly clamps perpendicular projection when bus is before the first stop', () => {
      const beforeStart = {
        latitude: 28.636, // North of Connaught Place
        longitude: 77.2167,
      };

      const result = RouteDeviationService.determineBusPositionRelativeToRoute(
        beforeStart,
        sampleGeometry
      );

      // Nearest point must be clamped to the starting coordinate
      expect(result.nearestPointOnRoute.latitude).toBeCloseTo(28.6315, 3);
      expect(result.nearestPointOnRoute.longitude).toBeCloseTo(77.2167, 3);
      expect(result.nearestStop?.id).toBe('stop-1');
      expect(result.progressPercentage).toBe(0);
    });

    it('correctly clamps perpendicular projection when bus is beyond the destination stop', () => {
      const afterEnd = {
        latitude: 28.605, // South of India Gate
        longitude: 77.235,
      };

      const result = RouteDeviationService.determineBusPositionRelativeToRoute(
        afterEnd,
        sampleGeometry
      );

      // Nearest point clamped to end
      expect(result.nearestPointOnRoute.latitude).toBeCloseTo(28.6129, 3);
      expect(result.nearestPointOnRoute.longitude).toBeCloseTo(77.2295, 3);
      expect(result.nearestStop?.id).toBe('stop-3');
      expect(result.progressPercentage).toBe(100);
    });

    it('handles edge case of single-point route gracefully', () => {
      const singlePointGeometry: RouteGeometry = {
        ...sampleGeometry,
        coordinates: [{ latitude: 28.6315, longitude: 77.2167 }],
        totalDistanceMeters: 0,
        segmentCount: 0,
        stops: [sampleGeometry.stops[0]!],
      };

      const result = RouteDeviationService.determineBusPositionRelativeToRoute(
        { latitude: 28.6315, longitude: 77.2167 },
        singlePointGeometry
      );

      expect(result.isOnRoute).toBe(true);
      expect(result.distanceToRouteMeters).toBe(0);
      expect(result.progressPercentage).toBe(0);
    });

    it('grades severity tiers accurately based on deviation distance', () => {
      expect(RouteDeviationService.calculateDeviationSeverity(50)).toBe('LOW');
      expect(RouteDeviationService.calculateDeviationSeverity(150)).toBe('LOW');
      expect(RouteDeviationService.calculateDeviationSeverity(300)).toBe('MEDIUM');
      expect(RouteDeviationService.calculateDeviationSeverity(650)).toBe('HIGH');
      expect(RouteDeviationService.calculateDeviationSeverity(1200)).toBe('CRITICAL');
    });
  });

  describe('2. Loading Route Geometry (loadRouteGeometry)', () => {
    it('successfully decodes JSON coordinate array polyline', async () => {
      // 1st query: route row
      mockQuery.mockResolvedValueOnce([
        {
          id: routeId,
          school_id: schoolId,
          name: 'Morning Route South',
          code: 'MR-02',
          route_type: 'MORNING_PICKUP',
          path_polyline: JSON.stringify([
            [28.5355, 77.241],
            [28.545, 77.25],
            [28.555, 77.26],
          ]),
          deviation_threshold_meters: 150,
        },
      ]);

      // 2nd query: pickup stops
      mockQuery.mockResolvedValueOnce([
        {
          id: 'stop-a',
          stop_name: 'Greater Kailash',
          sequence_order: 1,
          latitude: 28.5355,
          longitude: 77.241,
          geofence_radius_meters: 60,
        },
        {
          id: 'stop-b',
          stop_name: 'Kalkaji Temple',
          sequence_order: 2,
          latitude: 28.545,
          longitude: 77.25,
          geofence_radius_meters: 50,
        },
      ]);

      const geometry = await RouteDeviationService.loadRouteGeometry(routeId);

      expect(geometry.routeId).toBe(routeId);
      expect(geometry.deviationThresholdMeters).toBe(150);
      expect(geometry.coordinates.length).toBe(3);
      expect(geometry.coordinates[0]?.latitude).toBe(28.5355);
      expect(geometry.totalDistanceMeters).toBeGreaterThan(1000);
      expect(geometry.segmentCount).toBe(2);
      expect(geometry.stops.length).toBe(2);
      expect(geometry.isFallbackFromStops).toBe(false);
    });

    it('falls back to sequential stops when path_polyline is null', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: routeId,
          school_id: schoolId,
          name: 'Evening Drop North',
          code: 'ED-01',
          route_type: 'EVENING_DROP',
          path_polyline: null,
          deviation_threshold_meters: null,
        },
      ]);

      mockQuery.mockResolvedValueOnce([
        {
          id: 'stop-x',
          stop_name: 'Civil Lines',
          sequence_order: 1,
          latitude: 28.681,
          longitude: 77.222,
          geofence_radius_meters: 50,
        },
        {
          id: 'stop-y',
          stop_name: 'Model Town',
          sequence_order: 2,
          latitude: 28.702,
          longitude: 77.193,
          geofence_radius_meters: 50,
        },
      ]);

      const geometry = await RouteDeviationService.loadRouteGeometry(routeId);

      expect(geometry.deviationThresholdMeters).toBe(100); // Default threshold
      expect(geometry.isFallbackFromStops).toBe(true);
      expect(geometry.coordinates.length).toBe(2);
      expect(geometry.coordinates[0]?.latitude).toBe(28.681);
      expect(geometry.coordinates[1]?.latitude).toBe(28.702);
      expect(geometry.totalDistanceMeters).toBeGreaterThan(0);
    });

    it('throws NotFoundError when route is not found', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await expect(RouteDeviationService.loadRouteGeometry('non-existent-route')).rejects.toThrow(
        /not found/i
      );
    });
  });

  describe('3. Real-Time Trip Position (getTripRoutePosition)', () => {
    it('evaluates bus location relative to trip expected route with active deviation details', async () => {
      // 1. Query trip + bus latest location
      mockQuery.mockResolvedValueOnce([
        {
          trip_id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          route_id: routeId,
          trip_status: 'IN_PROGRESS',
          last_latitude: 28.625,
          last_longitude: 77.224, // Deviated bus location
          last_speed_kmh: 38.5,
          last_bearing_degrees: 135,
          last_gps_recorded_at: new Date(),
        },
      ]);

      // 2. Query active route_deviations
      mockQuery.mockResolvedValueOnce([
        {
          id: 'dev-123',
          status: 'ACTIVE',
          severity: 'HIGH',
          started_at: new Date(Date.now() - 180000),
          duration_seconds: 180,
          max_deviation_distance_meters: 580,
          current_deviation_distance_meters: 560,
        },
      ]);

      // 3. Query route definition
      mockQuery.mockResolvedValueOnce([
        {
          id: routeId,
          school_id: schoolId,
          name: 'Central City Route 1',
          code: 'R-01',
          route_type: 'MORNING_PICKUP',
          path_polyline: JSON.stringify([
            [28.6315, 77.2167],
            [28.625, 77.218],
            [28.6129, 77.2295],
          ]),
          deviation_threshold_meters: 100,
        },
      ]);

      // 4. Query pickup stops
      mockQuery.mockResolvedValueOnce([
        {
          id: 'stop-1',
          stop_name: 'Connaught Circle',
          sequence_order: 1,
          latitude: 28.6315,
          longitude: 77.2167,
          geofence_radius_meters: 50,
        },
        {
          id: 'stop-2',
          stop_name: 'Janpath Junction',
          sequence_order: 2,
          latitude: 28.625,
          longitude: 77.218,
          geofence_radius_meters: 50,
        },
      ]);

      const positionRes = await RouteDeviationService.getTripRoutePosition(tripId);

      expect(positionRes.tripId).toBe(tripId);
      expect(positionRes.busLocation.latitude).toBe(28.625);
      expect(positionRes.position.isDeviated).toBe(true);
      expect(positionRes.position.distanceToRouteMeters).toBeGreaterThan(100);
      expect(positionRes.position.bearingDegrees).toBe(135);
      expect(positionRes.activeDeviation).not.toBeNull();
      expect(positionRes.activeDeviation?.severity).toBe('HIGH');
    });

    it('falls back to gps_locations when bus table coordinates are not yet populated', async () => {
      // 1. Query trip + bus without coordinates
      mockQuery.mockResolvedValueOnce([
        {
          trip_id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          route_id: routeId,
          trip_status: 'IN_PROGRESS',
          last_latitude: null,
          last_longitude: null,
          last_speed_kmh: null,
          last_bearing_degrees: null,
          last_gps_recorded_at: null,
        },
      ]);

      // 2. Query fallback gps_locations
      mockQuery.mockResolvedValueOnce([
        {
          latitude: 28.628,
          longitude: 77.2173,
          speed_kmh: 25,
          bearing_degrees: 90,
          recorded_at: new Date(),
        },
      ]);

      // 3. Query active route_deviations (none)
      mockQuery.mockResolvedValueOnce([]);

      // 4. Query route
      mockQuery.mockResolvedValueOnce([
        {
          id: routeId,
          school_id: schoolId,
          name: 'Central City Route 1',
          code: 'R-01',
          route_type: 'MORNING_PICKUP',
          path_polyline: JSON.stringify([
            [28.6315, 77.2167],
            [28.625, 77.218],
          ]),
          deviation_threshold_meters: 100,
        },
      ]);

      // 5. Query pickup stops
      mockQuery.mockResolvedValueOnce([]);

      const positionRes = await RouteDeviationService.getTripRoutePosition(tripId);

      expect(positionRes.busLocation.latitude).toBe(28.628);
      expect(positionRes.position.isOnRoute).toBe(true);
      expect(positionRes.activeDeviation).toBeNull();
    });
  });

  describe('4. Telemetry HTTP Endpoints (Phase 28.1)', () => {
    it('GET /schools/:schoolId/routes/:routeId/geometry returns route geometry', async () => {
      // Mock route query
      mockQuery.mockResolvedValueOnce([
        {
          id: routeId,
          school_id: schoolId,
          name: 'Express South',
          code: 'EXP-1',
          route_type: 'MORNING_PICKUP',
          path_polyline: JSON.stringify([
            [28.5, 77.2],
            [28.6, 77.3],
          ]),
          deviation_threshold_meters: 120,
        },
      ]);
      // Mock stops query
      mockQuery.mockResolvedValueOnce([]);

      const res = await request(app)
        .get(`/api/v1/telemetry/schools/${schoolId}/routes/${routeId}/geometry`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.routeId).toBe(routeId);
      expect(res.body.data.deviationThresholdMeters).toBe(120);
    });

    it('GET /schools/:schoolId/routes/:routeId/geometry enforces tenant scope rejection', async () => {
      const res = await request(app)
        .get(`/api/v1/telemetry/schools/${otherSchoolId}/routes/${routeId}/geometry`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
    });

    it('GET /trips/:tripId/route-position returns real-time position analysis', async () => {
      // 1. Trip query
      mockQuery.mockResolvedValueOnce([
        {
          trip_id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          route_id: routeId,
          trip_status: 'IN_PROGRESS',
          last_latitude: 28.625,
          last_longitude: 77.218,
          last_speed_kmh: 30,
          last_bearing_degrees: 45,
          last_gps_recorded_at: new Date(),
        },
      ]);
      // 2. Deviation query
      mockQuery.mockResolvedValueOnce([]);
      // 3. Route query
      mockQuery.mockResolvedValueOnce([
        {
          id: routeId,
          school_id: schoolId,
          name: 'Central City Route 1',
          code: 'R-01',
          route_type: 'MORNING_PICKUP',
          path_polyline: JSON.stringify([
            [28.6315, 77.2167],
            [28.625, 77.218],
          ]),
          deviation_threshold_meters: 100,
        },
      ]);
      // 4. Stops query
      mockQuery.mockResolvedValueOnce([]);

      const res = await request(app)
        .get(`/api/v1/telemetry/trips/${tripId}/route-position`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.position.isOnRoute).toBe(true);
      expect(res.body.data.position.distanceToRouteMeters).toBeLessThan(10);
    });
  });
});
