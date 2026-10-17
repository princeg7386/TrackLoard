import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { RoutingService } from '../src/services/routing/routing.service.js';
import { ValhallaRoutingAdapter } from '../src/services/routing/valhalla-routing.adapter.js';
import { OsrmRoutingAdapter } from '../src/services/routing/osrm-routing.adapter.js';
import { MockRoutingAdapter } from '../src/services/routing/mock-routing.adapter.js';
import {
  decodePolyline,
  calculateHaversineDistanceMeters,
  UserRole,
} from '@school-bus/shared';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';
import * as db from '../src/config/database.js';

describe('Phase 13.3: Routing (OSRM/Valhalla Evaluation, Route Distance, Road Path, Fallbacks)', () => {
  const app = createApp();
  const schoolA = '111e4567-e89b-12d3-a456-426614174001';
  const schoolB = '999e4567-e89b-12d3-a456-426614174999';

  const adminToken = jwt.sign(
    {
      sub: 'adm-123',
      userId: 'adm-123',
      schoolId: schoolA,
      role: UserRole.SCHOOL_ADMIN,
    },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const driverToken = jwt.sign(
    {
      sub: 'drv-123',
      userId: 'drv-123',
      schoolId: schoolA,
      role: UserRole.DRIVER,
    },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const schoolBToken = jwt.sign(
    {
      sub: 'adm-999',
      userId: 'adm-999',
      schoolId: schoolB,
      role: UserRole.SCHOOL_ADMIN,
    },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  beforeEach(() => {
    RoutingService.resetProvider();
  });

  afterEach(() => {
    RoutingService.resetProvider();
  });

  describe('1. Engine Evaluation & Benchmarking (OSRM vs Valhalla vs Mock)', () => {
    it('evaluates and benchmarks routing engines over standardized transit coordinates', async () => {
      const evaluation = await RoutingService.evaluateEngines();

      expect(evaluation).toBeDefined();
      expect(evaluation.evaluations.length).toBeGreaterThanOrEqual(3);
      expect(evaluation.recommendedEngine).toBeDefined();
      expect(evaluation.activeEngine).toBeDefined();
      expect(evaluation.evaluatedAt).toBeDefined();

      const engines = evaluation.evaluations.map((e) => e.engine);
      expect(engines).toContain('osrm');
      expect(engines).toContain('valhalla');
      expect(engines).toContain('mock');

      // Verify each evaluation item has latency, features and status
      for (const item of evaluation.evaluations) {
        expect(typeof item.latencyMs).toBe('number');
        expect(item.features).toBeDefined();
        expect(typeof item.features.turnByTurn).toBe('boolean');
        expect(typeof item.features.matrix).toBe('boolean');
      }
    });

    it('GET /api/v1/routing/evaluate returns benchmark report to authorized admins', async () => {
      const res = await request(app)
        .get('/api/v1/routing/evaluate')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.evaluations).toBeInstanceOf(Array);
      expect(res.body.data.recommendedEngine).toBeDefined();
    });

    it('rejects unauthenticated requests to /api/v1/routing/evaluate with 401', async () => {
      const res = await request(app).get('/api/v1/routing/evaluate');
      expect(res.status).toBe(401);
    });

    it('rejects drivers from accessing /api/v1/routing/evaluate with 403', async () => {
      const res = await request(app)
        .get('/api/v1/routing/evaluate')
        .set('Authorization', `Bearer ${driverToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('2. Valhalla Adapter & Tiered Fallback Behavior', () => {
    it('instantiates Valhalla adapter and defaults to Mock fallback when offline', async () => {
      const valhalla = new ValhallaRoutingAdapter('http://127.0.0.1:9999'); // non-existent port to test fallback
      expect(valhalla.providerName).toBe('VALHALLA_ROUTING_PROVIDER');

      const waypoints = [
        { latitude: 28.6139, longitude: 77.209 },
        { latitude: 28.628, longitude: 77.222 },
      ];

      // calculateRoute should catch network failure and seamlessly return fallback result without throwing
      const result = await valhalla.calculateRoute(waypoints);
      expect(result).toBeDefined();
      expect(result.distanceMeters).toBeGreaterThan(0);
      expect(result.durationSeconds).toBeGreaterThan(0);
      expect(result.coordinates.length).toBeGreaterThanOrEqual(2);
    });

    it('falls back seamlessly in distance matrix when Valhalla is unreachable', async () => {
      const valhalla = new ValhallaRoutingAdapter('http://127.0.0.1:9999');
      const matrix = await valhalla.calculateDistanceMatrix({
        origins: [{ latitude: 28.6139, longitude: 77.209 }],
        destinations: [{ latitude: 28.628, longitude: 77.222 }],
      });

      expect(matrix.rows.length).toBe(1);
      expect(matrix.rows[0].elements[0].distanceMeters).toBeGreaterThan(0);
      expect(matrix.rows[0].elements[0].status).toBe('OK');
    });

    it('falls back seamlessly in road snapping when Valhalla is unreachable', async () => {
      const valhalla = new ValhallaRoutingAdapter('http://127.0.0.1:9999');
      const snapped = await valhalla.snapToRoad([{ latitude: 28.6139, longitude: 77.209 }]);

      expect(snapped.snappedPoints.length).toBe(1);
      expect(snapped.snappedPoints[0].latitude).toBeCloseTo(28.6139, 2);
    });
  });

  describe('3. Route Distance & Polyline Geometry Decoding', () => {
    it('verifies route road distance exceeds straight-line distance due to urban road winding', async () => {
      const start = { latitude: 28.6139, longitude: 77.209 };
      const end = { latitude: 28.6300, longitude: 77.225 };

      const straightDistance = calculateHaversineDistanceMeters(start, end);
      const routeResult = await RoutingService.calculateRoute([start, end]);

      expect(routeResult.distanceMeters).toBeGreaterThan(straightDistance);
      expect(routeResult.durationSeconds).toBeGreaterThan(0);
    });

    it('decodes encoded polylines into valid [lat, lng] coordinate arrays', () => {
      // Known test polyline for Delhi coordinate sequence
      const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
      const coordinates = decodePolyline(encoded, 5);

      expect(coordinates.length).toBeGreaterThan(0);
      for (const [lat, lng] of coordinates) {
        expect(typeof lat).toBe('number');
        expect(typeof lng).toBe('number');
        expect(lat).toBeGreaterThanOrEqual(-90);
        expect(lat).toBeLessThanOrEqual(90);
        expect(lng).toBeGreaterThanOrEqual(-180);
        expect(lng).toBeLessThanOrEqual(180);
      }
    });
  });

  describe('4. Real-DB Route Directions, Sequencing & Tenant Isolation (Rule 8)', () => {
    it('persists calculated road paths to the routes table and enforces school ownership', async () => {
      const testSchoolId = schoolA;
      const testRouteId = '444e4567-e89b-12d3-a456-426614174004';

      const dbStatus = await db.verifyPostGisConnection();
      const tablesExist = dbStatus.connected
        ? await db.query<{ tbl: string | null }>(`SELECT to_regclass('public.pickup_locations') as tbl;`).catch(() => [{ tbl: null }])
        : [{ tbl: null }];

      if (dbStatus.connected && tablesExist[0]?.tbl) {
        try {
          await db.query(
            `INSERT INTO schools (id, name, code, phone, email, address, city, state, timezone)
             VALUES ($1, 'Routing Test Academy', 'ROUT-P13', '+911126177000', 'routing@academy.edu', 'Sector 14', 'New Delhi', 'Delhi', 'Asia/Kolkata')
             ON CONFLICT (id) DO NOTHING;`,
            [testSchoolId]
          );

          await db.query(
            `INSERT INTO routes (id, school_id, name, code, estimated_duration_minutes)
             VALUES ($1, $2, 'South Route 13.3', 'RTE-133-01', 30)
             ON CONFLICT (id) DO NOTHING;`,
            [testRouteId, testSchoolId]
          );

          await db.query(`DELETE FROM pickup_locations WHERE route_id = $1`, [testRouteId]);
          await db.query(
            `INSERT INTO pickup_locations (school_id, route_id, stop_name, sequence_order, latitude, longitude, location, scheduled_time, geofence_radius_meters)
             VALUES
               ($1, $2, 'Green Park Metro', 1, 28.5589, 77.2065, ST_SetSRID(ST_MakePoint(77.2065, 28.5589), 4326)::geography, '07:05:00', 300),
               ($1, $2, 'Hauz Khas Gate 1', 2, 28.5494, 77.2001, ST_SetSRID(ST_MakePoint(77.2001, 28.5494), 4326)::geography, '07:20:00', 300),
               ($1, $2, 'IIT Gate Flyover', 3, 28.5450, 77.1926, ST_SetSRID(ST_MakePoint(77.1926, 28.5450), 4326)::geography, '07:35:00', 300);`,
            [testSchoolId, testRouteId]
          );

          const res = await request(app)
            .get(`/api/v1/routing/schools/${testSchoolId}/routes/${testRouteId}/directions`)
            .set('Authorization', `Bearer ${adminToken}`);

          expect(res.status).toBe(200);
          expect(res.body.success).toBe(true);
          expect(res.body.data.stopsCount).toBe(3);
          expect(res.body.data.totalDistanceMeters).toBeGreaterThan(0);
          expect(res.body.data.estimatedDurationMinutes).toBeGreaterThan(0);
          expect(res.body.data.pathPolyline).toBeDefined();

          const updated = await db.query<{ path_polyline: string; estimated_duration_minutes: number }>(
            `SELECT path_polyline, estimated_duration_minutes FROM routes WHERE id = $1`,
            [testRouteId]
          );
          expect(updated.length).toBe(1);
          expect(updated[0].path_polyline).toBe(res.body.data.pathPolyline);

          // Tenant check: School B admin cannot read School A route directions
          const crossRes = await request(app)
            .get(`/api/v1/routing/schools/${testSchoolId}/routes/${testRouteId}/directions`)
            .set('Authorization', `Bearer ${schoolBToken}`);

          expect(crossRes.status).toBe(403);
        } finally {
          await db.query(`DELETE FROM pickup_locations WHERE route_id = $1`, [testRouteId]);
          await db.query(`DELETE FROM routes WHERE id = $1`, [testRouteId]);
          await db.query(`DELETE FROM schools WHERE id = $1`, [testSchoolId]);
        }
      } else {
        const mockRoute = [{ id: testRouteId, name: 'South Route 13.3', school_id: testSchoolId }];
        const mockStops = [
          { id: 'st-1', stop_name: 'Stop 1', sequence_order: 1, latitude: 28.5589, longitude: 77.2065 },
          { id: 'st-2', stop_name: 'Stop 2', sequence_order: 2, latitude: 28.5494, longitude: 77.2001 },
        ];

        vi.spyOn(db, 'query')
          .mockResolvedValueOnce(mockRoute as any)
          .mockResolvedValueOnce(mockStops as any)
          .mockResolvedValueOnce([] as any);

        const result = await RoutingService.calculateAndPersistRouteForStops(testSchoolId, testRouteId);
        expect(result.routeId).toBe(testRouteId);
        expect(result.stopsCount).toBe(2);
        expect(result.totalDistanceMeters).toBeGreaterThan(0);
      }
    });
  });
});
