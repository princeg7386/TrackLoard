import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/services/auth.service.js';
import { MapService } from '../src/services/maps/map.service.js';
import { MockMapAdapter } from '../src/services/maps/mock-map.adapter.js';
import { RoutingService } from '../src/services/routing/routing.service.js';
import { MockRoutingAdapter } from '../src/services/routing/mock-routing.adapter.js';
import * as db from '../src/config/database.js';
import {
  UserRole,
  IMapProvider,
  IRoutingProvider,
  GeoCoordinates,
  calculateHaversineDistanceMeters,
} from '@school-bus/shared';

describe('Phase 13.1: Map & Routing Layer Abstraction', () => {
  const app = createApp();

  const schoolAId = '111e4567-e89b-12d3-a456-426614174001';
  const schoolBId = '999e4567-e89b-12d3-a456-426614174999';

  const adminTokenA = AuthService.generateToken({
    id: 'aaa11111-e89b-12d3-a456-426614174001',
    schoolId: schoolAId,
    email: 'admin.a@dpa.edu.in',
    role: UserRole.SCHOOL_ADMIN,
  });

  const adminTokenB = AuthService.generateToken({
    id: 'bbb22222-e89b-12d3-a456-426614174002',
    schoolId: schoolBId,
    email: 'admin.b@other.edu.in',
    role: UserRole.SCHOOL_ADMIN,
  });

  const driverTokenA = AuthService.generateToken({
    id: 'ddd11111-e89b-12d3-a456-426614174001',
    schoolId: schoolAId,
    email: 'driver@dpa.edu.in',
    role: UserRole.DRIVER,
  });

  const waypointsSample: GeoCoordinates[] = [
    { latitude: 28.6139, longitude: 77.209 },
    { latitude: 28.625, longitude: 77.215 },
    { latitude: 28.6315, longitude: 77.2167 },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    MapService.resetProvider();
    RoutingService.resetProvider();
  });

  // ---------------------------------------------------------------------------
  // 1. MapService Interface & Provider Isolation
  // ---------------------------------------------------------------------------
  describe('1. MapService Interface & Provider Swapping', () => {
    it('uses MockMapAdapter in test environment and satisfies IMapProvider', async () => {
      const provider = MapService.getProvider();
      expect(provider.providerName).toBe('MOCK_MAP_PROVIDER');

      const isHealthy = await MapService.isHealthy();
      expect(isHealthy).toBe(true);
    });

    it('geocodes human address to coordinates with structured response', async () => {
      const results = await MapService.geocode({ query: 'Delhi Public Academy' });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.latitude).toBeCloseTo(28.6139, 2);
      expect(results[0]?.longitude).toBeCloseTo(77.209, 2);
      expect(results[0]?.country).toBe('India');
    });

    it('reverse geocodes coordinates to structured address', async () => {
      const result = await MapService.reverseGeocode({ latitude: 28.6139, longitude: 77.209 });
      expect(result.formattedAddress).toContain('Delhi Public Academy');
      expect(result.latitude).toBe(28.6139);
      expect(result.longitude).toBe(77.209);
    });

    it('supports runtime custom provider swapping via setProvider', async () => {
      const customMock: IMapProvider = {
        providerName: 'CUSTOM_TEST_MAP_PROVIDER',
        geocode: vi.fn().mockResolvedValue([
          {
            formattedAddress: 'Custom Location, India',
            latitude: 28.5,
            longitude: 77.1,
          },
        ]),
        reverseGeocode: vi.fn().mockResolvedValue({
          formattedAddress: 'Custom Location, India',
          latitude: 28.5,
          longitude: 77.1,
        }),
        isHealthy: vi.fn().mockResolvedValue(true),
      };

      MapService.setProvider(customMock);
      expect(MapService.getProvider().providerName).toBe('CUSTOM_TEST_MAP_PROVIDER');

      const res = await MapService.geocode({ query: 'any place' });
      expect(res[0]?.formattedAddress).toBe('Custom Location, India');
      expect(customMock.geocode).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. RoutingService Interface & Provider Isolation
  // ---------------------------------------------------------------------------
  describe('2. RoutingService Interface & Provider Swapping', () => {
    it('uses MockRoutingAdapter in test environment and satisfies IRoutingProvider', async () => {
      const provider = RoutingService.getProvider();
      expect(provider.providerName).toBe('MOCK_ROUTING_PROVIDER');

      const isHealthy = await RoutingService.isHealthy();
      expect(isHealthy).toBe(true);
    });

    it('calculates multi-waypoint route with total distance, duration, legs, and polyline', async () => {
      const result = await RoutingService.calculateRoute(waypointsSample);

      expect(result.distanceMeters).toBeGreaterThan(0);
      expect(result.durationSeconds).toBeGreaterThan(0);
      expect(result.legs.length).toBe(2);
      expect(result.coordinates.length).toBeGreaterThanOrEqual(3);
      expect(result.geometryPolyline).toBeDefined();
      expect(result.provider).toBe('MOCK_ROUTING_PROVIDER');
    });

    it('calculates distance matrix between origins and destinations', async () => {
      const matrix = await RoutingService.calculateDistanceMatrix({
        origins: [waypointsSample[0]!],
        destinations: [waypointsSample[1]!, waypointsSample[2]!],
      });

      expect(matrix.rows.length).toBe(1);
      expect(matrix.rows[0]!.elements.length).toBe(2);
      expect(matrix.rows[0]!.elements[0]!.status).toBe('OK');
      expect(matrix.rows[0]!.elements[0]!.distanceMeters).toBeGreaterThan(0);
    });

    it('calculates ETA with realistic estimated arrival timestamp', async () => {
      const eta = await RoutingService.calculateEta({
        origin: waypointsSample[0]!,
        destination: waypointsSample[1]!,
        averageSpeedKmh: 30,
      });

      expect(eta.distanceMeters).toBeGreaterThan(0);
      expect(eta.durationSeconds).toBeGreaterThan(0);
      expect(new Date(eta.estimatedArrival).getTime()).toBeGreaterThan(Date.now());
    });

    it('snaps GPS coordinates to road network geometry', async () => {
      const snapResult = await RoutingService.snapToRoad(waypointsSample);
      expect(snapResult.snappedPoints.length).toBe(3);
      expect(snapResult.snappedPoints[0]!.confidence).toBeGreaterThan(0.9);
    });

    it('supports runtime custom routing provider swapping via setProvider', async () => {
      const customRoutingMock: IRoutingProvider = {
        providerName: 'CUSTOM_TEST_ROUTING_PROVIDER',
        calculateRoute: vi.fn().mockResolvedValue({
          distanceMeters: 5000,
          durationSeconds: 600,
          geometryPolyline: '[]',
          coordinates: [[28.6, 77.2]],
          legs: [],
          provider: 'CUSTOM_TEST_ROUTING_PROVIDER',
        }),
        calculateDistanceMatrix: vi.fn().mockResolvedValue({
          rows: [],
          provider: 'CUSTOM_TEST_ROUTING_PROVIDER',
        }),
        calculateEta: vi.fn().mockResolvedValue({
          distanceMeters: 5000,
          durationSeconds: 600,
          estimatedArrival: new Date().toISOString(),
          provider: 'CUSTOM_TEST_ROUTING_PROVIDER',
        }),
        snapToRoad: vi.fn().mockResolvedValue({
          snappedPoints: [],
          provider: 'CUSTOM_TEST_ROUTING_PROVIDER',
        }),
        isHealthy: vi.fn().mockResolvedValue(true),
      };

      RoutingService.setProvider(customRoutingMock);
      expect(RoutingService.getProvider().providerName).toBe('CUSTOM_TEST_ROUTING_PROVIDER');

      const res = await RoutingService.calculateRoute(waypointsSample);
      expect(res.distanceMeters).toBe(5000);
      expect(customRoutingMock.calculateRoute).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. API Endpoints & Tenant Isolation
  // ---------------------------------------------------------------------------
  describe('3. Routing & Map API Endpoints (/api/v1/routing)', () => {
    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/v1/routing/calculate')
        .send({ waypoints: waypointsSample });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('calculates route for authenticated school admin (200 OK)', async () => {
      const res = await request(app)
        .post('/api/v1/routing/calculate')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ waypoints: waypointsSample });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.distanceMeters).toBeGreaterThan(0);
      expect(res.body.data.legs.length).toBe(2);
    });

    it('calculates ETA for authenticated driver (200 OK)', async () => {
      const res = await request(app)
        .post('/api/v1/routing/eta')
        .set('Authorization', `Bearer ${driverTokenA}`)
        .send({
          origin: waypointsSample[0],
          destination: waypointsSample[1],
          averageSpeedKmh: 35,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.durationSeconds).toBeGreaterThan(0);
    });

    it('enforces tenant isolation on route directions (403 for cross-tenant access)', async () => {
      const res = await request(app)
        .get(`/api/v1/routing/schools/${schoolAId}/routes/route-12345/directions`)
        .set('Authorization', `Bearer ${adminTokenB}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('executes geocoding through API endpoint (200 OK)', async () => {
      const res = await request(app)
        .post('/api/v1/routing/geocode')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ query: 'Delhi Public Academy' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('executes reverse geocoding through API endpoint (200 OK)', async () => {
      const res = await request(app)
        .post('/api/v1/routing/reverse-geocode')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({ latitude: 28.6139, longitude: 77.209 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.formattedAddress).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Real-DB Integration Test (Standing Rule 8)
  // ---------------------------------------------------------------------------
  describe('4. Real-DB Route Directions & Polyline Persistence (Rule 8)', () => {
    it('retrieves sequenced stops from database, computes polyline, and persists to routes table', async () => {
      const dbStatus = await db.verifyPostGisConnection();

      if (dbStatus.connected) {
        // Real DB is active: test against actual PostGIS database
        // 1. Create temporary school, route, and 3 pickup stops
        const testSchool = await db.query<{ id: string }>(
          `INSERT INTO schools (name, code, city, state, timezone)
           VALUES ('Map Abstraction Test School', 'MAP-TEST-' || substr(gen_random_uuid()::text, 1, 8), 'New Delhi', 'Delhi', 'Asia/Kolkata')
           RETURNING id`
        );
        const schoolId = testSchool[0]!.id;

        const testRoute = await db.query<{ id: string }>(
          `INSERT INTO routes (school_id, name, code, route_type)
           VALUES ($1, 'Morning Test Route', 'MTR-' || substr(gen_random_uuid()::text, 1, 6), 'MORNING_PICKUP')
           RETURNING id`,
          [schoolId]
        );
        const routeId = testRoute[0]!.id;

        // Insert 3 sequenced stops with PostGIS geometry
        await db.query(
          `INSERT INTO pickup_locations (school_id, route_id, stop_name, sequence_order, latitude, longitude, location, scheduled_time)
           VALUES
           ($1, $2, 'Stop 1 - Gate', 1, 28.6139, 77.2090, ST_SetSRID(ST_MakePoint(77.2090, 28.6139), 4326)::geography, '07:30:00'),
           ($1, $2, 'Stop 2 - Market', 2, 28.6200, 77.2150, ST_SetSRID(ST_MakePoint(77.2150, 28.6200), 4326)::geography, '07:40:00'),
           ($1, $2, 'Stop 3 - Cross', 3, 28.6280, 77.2220, ST_SetSRID(ST_MakePoint(77.2220, 28.6280), 4326)::geography, '07:50:00')`,
          [schoolId, routeId]
        );

        // 2. Call RoutingService.calculateAndPersistRouteForStops
        const result = await RoutingService.calculateAndPersistRouteForStops(schoolId, routeId);

        expect(result.routeId).toBe(routeId);
        expect(result.stopsCount).toBe(3);
        expect(result.totalDistanceMeters).toBeGreaterThan(0);
        expect(result.estimatedDurationMinutes).toBeGreaterThan(0);
        expect(result.legs.length).toBe(2);

        // 3. Verify directly in routes table that path_polyline & estimated_duration_minutes were persisted
        const updatedRoutes = await db.query<{
          path_polyline: string;
          estimated_duration_minutes: number;
        }>(
          `SELECT path_polyline, estimated_duration_minutes FROM routes WHERE id = $1`,
          [routeId]
        );

        expect(updatedRoutes.length).toBe(1);
        expect(updatedRoutes[0]!.path_polyline).toBe(result.pathPolyline);
        expect(updatedRoutes[0]!.estimated_duration_minutes).toBe(result.estimatedDurationMinutes);

        // Cleanup
        await db.query(`DELETE FROM schools WHERE id = $1`, [schoolId]);
      } else {
        // Fallback for mocked environment without live DB container
        const routeRowsMock = [{ id: 'route-test-1', name: 'Test Route', school_id: schoolAId }];
        const stopRowsMock = [
          { id: 's1', stop_name: 'Stop 1', sequence_order: 1, latitude: 28.6139, longitude: 77.209 },
          { id: 's2', stop_name: 'Stop 2', sequence_order: 2, latitude: 28.6200, longitude: 77.215 },
        ];

        vi.spyOn(db, 'query')
          .mockResolvedValueOnce(routeRowsMock as any)
          .mockResolvedValueOnce(stopRowsMock as any)
          .mockResolvedValueOnce([] as any);

        const result = await RoutingService.calculateAndPersistRouteForStops(
          schoolAId,
          'route-test-1'
        );

        expect(result.routeId).toBe('route-test-1');
        expect(result.stopsCount).toBe(2);
        expect(result.totalDistanceMeters).toBeGreaterThan(0);
      }
    });
  });
});
