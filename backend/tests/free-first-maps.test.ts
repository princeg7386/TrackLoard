import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { MapService } from '../src/services/maps/map.service.js';
import { RoutingService } from '../src/services/routing/routing.service.js';
import { MockMapAdapter } from '../src/services/maps/mock-map.adapter.js';
import { MockRoutingAdapter } from '../src/services/routing/mock-routing.adapter.js';
import { OsmMapAdapter } from '../src/services/maps/osm-map.adapter.js';
import { OsrmRoutingAdapter } from '../src/services/routing/osrm-routing.adapter.js';
import {
  latLngToTile,
  tileToLatLng,
  getOsmTileUrl,
  FREE_MAP_TILE_PROVIDERS,
  UserRole,
} from '@school-bus/shared';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';
import * as db from '../src/config/database.js';

describe('Phase 13.2: Free-First Maps (OpenStreetMap, Routing & Geocoding Options)', () => {
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
    MapService.resetProvider();
    RoutingService.resetProvider();
  });

  afterEach(() => {
    MapService.resetProvider();
    RoutingService.resetProvider();
  });

  describe('1. OpenStreetMap Spherical Mercator & Tile Calculations', () => {
    it('accurately projects lat/lng coordinates to Slippy Map tile coordinates', () => {
      // New Delhi: ~28.6139, 77.2090 at zoom 12
      const tile = latLngToTile(28.6139, 77.209, 12);
      expect(tile.x).toBeGreaterThan(0);
      expect(tile.y).toBeGreaterThan(0);
      expect(tile.x).toBeLessThan(Math.pow(2, 12));
      expect(tile.y).toBeLessThan(Math.pow(2, 12));

      // Inverse projection to lat/lng should be close to original
      const coords = tileToLatLng(tile.x, tile.y, 12);
      expect(coords.lat).toBeCloseTo(28.6139, 0);
      expect(coords.lng).toBeCloseTo(77.209, 0);
    });

    it('generates valid OpenStreetMap tile URLs with subdomains', () => {
      const urlStandard = getOsmTileUrl(
        FREE_MAP_TILE_PROVIDERS.osm_standard.urlTemplate,
        2925,
        1708,
        12
      );
      expect(urlStandard).toBe('https://tile.openstreetmap.org/12/2925/1708.png');

      const urlCarto = getOsmTileUrl(
        FREE_MAP_TILE_PROVIDERS.carto_light.urlTemplate,
        2925,
        1708,
        12,
        FREE_MAP_TILE_PROVIDERS.carto_light.subdomains
      );
      expect(urlCarto).toMatch(/^https:\/\/[a-d]\.basemaps\.cartocdn\.com\/light_all\/12\/2925\/1708\.png$/);
    });

    it('contains valid free-first tile provider configurations', () => {
      expect(FREE_MAP_TILE_PROVIDERS.osm_standard.name).toBe('OpenStreetMap Standard');
      expect(FREE_MAP_TILE_PROVIDERS.osm_standard.attribution).toContain('OpenStreetMap');
      expect(FREE_MAP_TILE_PROVIDERS.carto_light.attribution).toContain('CARTO');
      expect(FREE_MAP_TILE_PROVIDERS.canvas.isVectorCanvas).toBe(true);
    });
  });

  describe('2. Geocoding & Routing Option Switching', () => {
    it('switches geocoding option between osm_nominatim and mock', () => {
      MapService.setGeocodingOption('osm_nominatim');
      expect(MapService.getGeocodingOption()).toBe('osm_nominatim');
      expect(MapService.getProvider() instanceof OsmMapAdapter).toBe(true);

      MapService.setGeocodingOption('mock');
      expect(MapService.getGeocodingOption()).toBe('mock');
      expect(MapService.getProvider() instanceof MockMapAdapter).toBe(true);
    });

    it('switches routing option between osrm and mock', () => {
      RoutingService.setRoutingOption('osrm');
      expect(RoutingService.getRoutingOption()).toBe('osrm');
      expect(RoutingService.getProvider() instanceof OsrmRoutingAdapter).toBe(true);

      RoutingService.setRoutingOption('mock');
      expect(RoutingService.getRoutingOption()).toBe('mock');
      expect(RoutingService.getProvider() instanceof MockRoutingAdapter).toBe(true);
    });

    it('switches and tracks active tile layer options', () => {
      MapService.setTileLayerOption('carto_light');
      expect(MapService.getTileLayerOption()).toBe('carto_light');

      MapService.setTileLayerOption('canvas');
      expect(MapService.getTileLayerOption()).toBe('canvas');
    });
  });

  describe('3. Free Map Configuration API Endpoints', () => {
    it('GET /api/v1/routing/options returns active free-first options and providers', async () => {
      const res = await request(app)
        .get('/api/v1/routing/options')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isFreeFirst).toBe(true);
      expect(res.body.data.availableTileLayers.length).toBeGreaterThanOrEqual(3);
      expect(res.body.data.availableGeocodingProviders).toContain('osm_nominatim');
      expect(res.body.data.availableRoutingProviders).toContain('osrm');
      expect(res.body.data.defaultCenter.latitude).toBeCloseTo(28.6139, 1);
      expect(res.body.data.defaultCenter.longitude).toBeCloseTo(77.209, 1);
    });

    it('POST /api/v1/routing/options/select updates active map configuration', async () => {
      const res = await request(app)
        .post('/api/v1/routing/options/select')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tileLayer: 'carto_light',
          geocodingProvider: 'mock',
          routingProvider: 'mock',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.activeTileLayer).toBe('carto_light');
      expect(res.body.data.activeGeocodingProvider).toBe('mock');
      expect(res.body.data.activeRoutingProvider).toBe('mock');
    });

    it('rejects unauthenticated requests to /api/v1/routing/options with 401', async () => {
      const res = await request(app).get('/api/v1/routing/options');
      expect(res.status).toBe(401);
    });

    it('rejects invalid option selection payloads with 422', async () => {
      const res = await request(app)
        .post('/api/v1/routing/options/select')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          tileLayer: 'non_existent_provider',
        });

      expect(res.status).toBe(422);
    });
  });

  describe('4. Real-DB Route Directions & Sequenced OSM/OSRM Stops (Rule 8)', () => {
    it('computes free-first routing for database stops and enforces tenant isolation', async () => {
      const testSchoolId = schoolA;
      const testRouteId = '333e4567-e89b-12d3-a456-426614174003';

      const dbStatus = await db.verifyPostGisConnection();
      const tablesExist = dbStatus.connected
        ? await db.query<{ tbl: string | null }>(`SELECT to_regclass('public.pickup_locations') as tbl;`).catch(() => [{ tbl: null }])
        : [{ tbl: null }];

      if (dbStatus.connected && tablesExist[0]?.tbl) {
        try {
          // Ensure parent school exists
          await db.query(
            `INSERT INTO schools (id, name, code, phone, email, address, city, state, timezone)
             VALUES ($1, 'Delhi Public School Phase 13', 'DPS-P13', '+911126177000', 'p13@dps.edu', 'Sector 12', 'New Delhi', 'Delhi', 'Asia/Kolkata')
             ON CONFLICT (id) DO NOTHING;`,
            [testSchoolId]
          );

          // Insert route
          await db.query(
            `INSERT INTO routes (id, school_id, name, code, estimated_duration_minutes)
             VALUES ($1, $2, 'North Delhi Loop', 'RTE-NDL-01', 35)
             ON CONFLICT (id) DO NOTHING;`,
            [testRouteId, testSchoolId]
          );

          // Insert stops in sequence
          await db.query(`DELETE FROM pickup_locations WHERE route_id = $1`, [testRouteId]);
          await db.query(
            `INSERT INTO pickup_locations (school_id, route_id, stop_name, sequence_order, latitude, longitude, location, scheduled_time, geofence_radius_meters)
             VALUES
               ($1, $2, 'Kashmere Gate Metro', 1, 28.6675, 77.2285, ST_SetSRID(ST_MakePoint(77.2285, 28.6675), 4326)::geography, '07:00:00', 300),
               ($1, $2, 'Civil Lines Gate 3', 2, 28.6800, 77.2250, ST_SetSRID(ST_MakePoint(77.2250, 28.6800), 4326)::geography, '07:15:00', 300),
               ($1, $2, 'Vishwa Vidyalaya Metro', 3, 28.6940, 77.2150, ST_SetSRID(ST_MakePoint(77.2150, 28.6940), 4326)::geography, '07:30:00', 300);`,
            [testSchoolId, testRouteId]
          );

          // Execute API call for route directions
          const res = await request(app)
            .get(`/api/v1/routing/schools/${testSchoolId}/routes/${testRouteId}/directions`)
            .set('Authorization', `Bearer ${adminToken}`);

          expect(res.status).toBe(200);
          expect(res.body.success).toBe(true);
          expect(res.body.data.stopsCount).toBe(3);
          expect(res.body.data.totalDistanceMeters).toBeGreaterThan(0);
          expect(res.body.data.estimatedDurationMinutes).toBeGreaterThan(0);
          expect(res.body.data.pathPolyline).toBeDefined();

          // Verify database persistence in routes table
          const routeRows = await db.query<{ path_polyline: string; estimated_duration_minutes: number }>(
            `SELECT path_polyline, estimated_duration_minutes FROM routes WHERE id = $1`,
            [testRouteId]
          );
          expect(routeRows.length).toBe(1);
          expect(routeRows[0].path_polyline).toBe(res.body.data.pathPolyline);
          expect(routeRows[0].estimated_duration_minutes).toBe(res.body.data.estimatedDurationMinutes);

          // Verify Cross-Tenant Isolation (School B cannot access School A directions)
          const crossTenantRes = await request(app)
            .get(`/api/v1/routing/schools/${testSchoolId}/routes/${testRouteId}/directions`)
            .set('Authorization', `Bearer ${schoolBToken}`);

          expect(crossTenantRes.status).toBe(403);
        } finally {
          await db.query(`DELETE FROM pickup_locations WHERE route_id = $1`, [testRouteId]);
          await db.query(`DELETE FROM routes WHERE id = $1`, [testRouteId]);
          await db.query(`DELETE FROM schools WHERE id = $1`, [testSchoolId]);
        }
      } else {
        // Mock fallback for unit-testing before DB container is booted
        const mockRoute = [{ id: testRouteId, name: 'North Delhi Loop', school_id: testSchoolId }];
        const mockStops = [
          { id: 's1', stop_name: 'Stop 1', sequence_order: 1, latitude: 28.6675, longitude: 77.2285 },
          { id: 's2', stop_name: 'Stop 2', sequence_order: 2, latitude: 28.6800, longitude: 77.2250 },
        ];

        vi.spyOn(db, 'query')
          .mockResolvedValueOnce(mockRoute as any)
          .mockResolvedValueOnce(mockStops as any)
          .mockResolvedValueOnce([] as any);

        const result = await RoutingService.calculateAndPersistRouteForStops(testSchoolId, testRouteId);
        expect(result.routeId).toBe(testRouteId);
        expect(result.stopsCount).toBe(2);
        expect(result.totalDistanceMeters).toBeGreaterThan(0);
        expect(result.pathPolyline).toBeDefined();
      }
    });
  });
});

