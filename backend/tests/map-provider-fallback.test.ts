import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { RoutingService } from '../src/services/routing/routing.service.js';
import { MapService } from '../src/services/maps/map.service.js';
import { MapUsageTracker } from '../src/services/maps/map-usage-tracker.service.js';
import { GoogleMapsRoutingAdapter } from '../src/services/routing/google-maps-routing.adapter.js';
import { GoogleMapsGeocodingAdapter } from '../src/services/maps/google-maps-geocoding.adapter.js';
import { UserRole } from '@school-bus/shared';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';
import * as db from '../src/config/database.js';

describe('Phase 13.4: Provider Fallback & Map API Usage Tracking', () => {
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
    MapService.resetProvider();
    MapUsageTracker.reset();
  });

  afterEach(() => {
    RoutingService.resetProvider();
    MapService.resetProvider();
    MapUsageTracker.reset();
  });

  describe('1. Paid Map Trigger Policy & Guidelines (Task 1)', () => {
    it('returns machine-readable policy with 4 objective triggers and free-first baseline', async () => {
      const res = await request(app)
        .get('/api/v1/routing/policy')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const policy = res.body.data;
      expect(policy.isFreeFirstDefault).toBe(true);
      expect(policy.dailyQuotaBudget).toBe(500);
      expect(Array.isArray(policy.triggers)).toBe(true);
      expect(policy.triggers.length).toBe(4);

      const triggerCategories = policy.triggers.map((t: any) => t.triggerCategory);
      expect(triggerCategories).toContain('address_ambiguity');
      expect(triggerCategories).toContain('traffic_congestion');
      expect(triggerCategories).toContain('rate_limit');
      expect(triggerCategories).toContain('safety_audit');

      expect(policy.fallbackHierarchy).toBeDefined();
      expect(policy.supportedCommercialProviders).toContain('google_maps');
    });

    it('requires authentication for policy endpoint (401 when absent)', async () => {
      const res = await request(app).get('/api/v1/routing/policy');
      expect(res.status).toBe(401);
    });

    it('allows driver role to inspect policy for transparency', async () => {
      const res = await request(app)
        .get('/api/v1/routing/policy')
        .set('Authorization', `Bearer ${driverToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('2. Keep Provider Switch Possible & Commercial Adapters (Task 2)', () => {
    it('allows school admin to switch routing and geocoding options dynamically', async () => {
      const res = await request(app)
        .post('/api/v1/routing/options/select')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          routingProvider: 'google_maps',
          geocodingProvider: 'google_maps',
          tileLayer: 'google_streets',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.activeRoutingProvider).toBe('google_maps');
      expect(res.body.data.activeGeocodingProvider).toBe('google_maps');
      expect(res.body.data.activeTileLayer).toBe('google_streets');

      expect(RoutingService.getRoutingOption()).toBe('google_maps');
      expect(MapService.getGeocodingOption()).toBe('google_maps');
    });

    it('blocks drivers from changing system map provider options (403)', async () => {
      const res = await request(app)
        .post('/api/v1/routing/options/select')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ routingProvider: 'google_maps' });

      expect(res.status).toBe(403);
    });

    it('GoogleMapsRoutingAdapter gracefully falls back to free engine when unconfigured', async () => {
      const adapter = new GoogleMapsRoutingAdapter('');
      expect(adapter.providerName).toBe('GOOGLE_MAPS_ROUTING_PROVIDER');
      expect(adapter.hasValidKey()).toBe(false);

      const waypoints = [
        { latitude: 28.6139, longitude: 77.2090 },
        { latitude: 28.5355, longitude: 77.3910 },
      ];

      const route = await adapter.calculateRoute(waypoints);
      expect(route).toBeDefined();
      expect(route.distanceMeters).toBeGreaterThan(0);
      expect(route.durationSeconds).toBeGreaterThan(0);
      expect(route.provider).toContain('GOOGLE_MAPS_ROUTING_PROVIDER_FALLBACK_');
    });

    it('GoogleMapsGeocodingAdapter gracefully falls back to free geocoder when unconfigured', async () => {
      const adapter = new GoogleMapsGeocodingAdapter('');
      expect(adapter.providerName).toBe('GOOGLE_MAPS_GEOCODING_PROVIDER');
      expect(adapter.hasValidKey()).toBe(false);

      const results = await adapter.geocode({ query: 'Connaught Place, New Delhi' });
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      const reverse = await adapter.reverseGeocode({ latitude: 28.6315, longitude: 77.2167 });
      expect(reverse.formattedAddress).toBeDefined();
    });
  });

  describe('3. Map & Routing API Usage Tracking (Task 3)', () => {
    it('tracks API usage, counts operations, and computes free-first savings in INR', async () => {
      // 1. Reset counters
      const resetRes = await request(app)
        .post('/api/v1/routing/usage/reset')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(resetRes.status).toBe(200);

      // 2. Perform a route calculation via API
      const routeRes = await request(app)
        .post('/api/v1/routing/calculate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          waypoints: [
            { latitude: 28.6139, longitude: 77.2090 },
            { latitude: 28.6200, longitude: 77.2150 },
          ],
        });
      expect(routeRes.status).toBe(200);

      // 3. Perform an ETA calculation via API
      const etaRes = await request(app)
        .post('/api/v1/routing/eta')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          origin: { latitude: 28.6139, longitude: 77.2090 },
          destination: { latitude: 28.6200, longitude: 77.2150 },
        });
      expect(etaRes.status).toBe(200);

      // 4. Query usage summary
      const usageRes = await request(app)
        .get('/api/v1/routing/usage')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(usageRes.status).toBe(200);
      expect(usageRes.body.success).toBe(true);

      const summary = usageRes.body.data;
      expect(summary.schoolId).toBe(schoolA);
      expect(summary.totalRequests).toBeGreaterThanOrEqual(2);
      expect(summary.successfulRequests).toBeGreaterThanOrEqual(2);
      expect(summary.totalSavedInr).toBeGreaterThan(0); // Cost saved by using Free-First
      expect(summary.requestsByOperation.route_calculate).toBeGreaterThanOrEqual(1);
      expect(summary.requestsByOperation.eta).toBeGreaterThanOrEqual(1);
    });

    it('enforces strict tenant isolation on usage metrics (School B cannot see School A metrics)', async () => {
      // School A performs a geocode
      await request(app)
        .post('/api/v1/routing/geocode')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ query: 'Rohini Sector 9, Delhi' });

      // School B queries its usage
      const schoolBUsage = await request(app)
        .get('/api/v1/routing/usage')
        .set('Authorization', `Bearer ${schoolBToken}`);

      expect(schoolBUsage.status).toBe(200);
      expect(schoolBUsage.body.data.schoolId).toBe(schoolB);
      // School B has not performed requests in this test block, so requests for schoolB should be 0
      expect(schoolBUsage.body.data.totalRequests).toBe(0);
    });
  });

  describe('4. Real-DB Integration & Route Persistence with Fallback Provider', () => {
    it('persists calculated polyline to routes table with tenant ownership verification', async () => {
      const testSchoolId = schoolA;
      const testRouteId = '777e4567-e89b-12d3-a456-426614174777';

      // Switch to Google Maps (which will transparently fallback to Valhalla/OSRM/Mock)
      RoutingService.setRoutingOption('google_maps');

      let tablesExist = false;
      try {
        const check = await db.query(
          `SELECT to_regclass('public.pickup_locations') as tbl`
        );
        tablesExist = Boolean(check[0]?.tbl);
      } catch {
        tablesExist = false;
      }

      if (tablesExist) {
        try {
          await db.query(
            `INSERT INTO schools (id, name, domain, address, contact_phone, contact_email)
             VALUES ($1, 'Fallback Test Academy', 'fallback.edu', 'Delhi', '+919876543210', 'fallback@school.edu')
             ON CONFLICT (id) DO NOTHING;`,
            [testSchoolId]
          );

          await db.query(
            `INSERT INTO routes (id, school_id, name, code, estimated_duration_minutes)
             VALUES ($1, $2, 'Fallback Test Route 13.4', 'RTE-134-01', 25)
             ON CONFLICT (id) DO NOTHING;`,
            [testRouteId, testSchoolId]
          );

          await db.query(`DELETE FROM pickup_locations WHERE route_id = $1`, [testRouteId]);
          await db.query(
            `INSERT INTO pickup_locations (school_id, route_id, stop_name, sequence_order, latitude, longitude, location, scheduled_time, geofence_radius_meters)
             VALUES
               ($1, $2, 'AIIMS Flyover', 1, 28.5672, 77.2100, ST_SetSRID(ST_MakePoint(77.2100, 28.5672), 4326)::geography, '07:10:00', 300),
               ($1, $2, 'INA Metro', 2, 28.5750, 77.2080, ST_SetSRID(ST_MakePoint(77.2080, 28.5750), 4326)::geography, '07:25:00', 300);`,
            [testSchoolId, testRouteId]
          );

          const res = await request(app)
            .get(`/api/v1/routing/schools/${testSchoolId}/routes/${testRouteId}/directions`)
            .set('Authorization', `Bearer ${adminToken}`);

          expect(res.status).toBe(200);
          expect(res.body.success).toBe(true);
          expect(res.body.data.stopsCount).toBe(2);
          expect(res.body.data.totalDistanceMeters).toBeGreaterThan(0);
          expect(res.body.data.estimatedDurationMinutes).toBeGreaterThan(0);
          expect(res.body.data.pathPolyline).toBeDefined();

          // Verify updated record in DB
          const rows = await db.query<{ path_polyline: string }>(
            `SELECT path_polyline FROM routes WHERE id = $1`,
            [testRouteId]
          );
          expect(rows.length).toBe(1);
          expect(rows[0].path_polyline).toBe(res.body.data.pathPolyline);

          // Tenant check: School B admin cannot access School A directions
          const unauthorizedRes = await request(app)
            .get(`/api/v1/routing/schools/${testSchoolId}/routes/${testRouteId}/directions`)
            .set('Authorization', `Bearer ${schoolBToken}`);

          expect(unauthorizedRes.status).toBe(403);
        } finally {
          await db.query(`DELETE FROM pickup_locations WHERE route_id = $1`, [testRouteId]);
          await db.query(`DELETE FROM routes WHERE id = $1`, [testRouteId]);
          await db.query(`DELETE FROM schools WHERE id = $1`, [testSchoolId]);
        }
      } else {
        const mockRoute = [{ id: testRouteId, name: 'Fallback Test Route 13.4', school_id: testSchoolId }];
        const mockStops = [
          { id: 'st-1', stop_name: 'AIIMS Flyover', sequence_order: 1, latitude: 28.5672, longitude: 77.2100 },
          { id: 'st-2', stop_name: 'INA Metro', sequence_order: 2, latitude: 28.5750, longitude: 77.2080 },
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
