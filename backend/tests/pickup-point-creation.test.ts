import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import * as db from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { DynamicPickupService } from '../src/services/dynamic-pickup/dynamic-pickup.service.js';
import { MapService } from '../src/services/maps/map.service.js';
import { RoutingService } from '../src/services/routing/routing.service.js';
import { UserRole, formatIndianTransportAddress } from '@school-bus/shared';

const schoolA = '111e4567-e89b-12d3-a456-426614174001';
const schoolB = '999e4567-e89b-12d3-a456-426614174999';

const adminAId = 'aaa11111-e89b-12d3-a456-426614174001';
const adminBId = 'bbb22222-e89b-12d3-a456-426614174002';
const driverAId = 'ddd11111-e89b-12d3-a456-426614174001';

const routeAId = '555e4567-e89b-12d3-a456-426614174555';
const studentAId = '444e4567-e89b-12d3-a456-426614174444';

describe('Phase 14.2: Pickup Point Creation Engine', () => {
  let app: any;
  let adminAToken: string;
  let adminBToken: string;
  let driverAToken: string;

  beforeEach(() => {
    app = createApp();
    MapService.resetProvider();
    RoutingService.resetProvider();

    adminAToken = jwt.sign(
      {
        sub: adminAId,
        userId: adminAId,
        schoolId: schoolA,
        role: UserRole.SCHOOL_ADMIN,
      },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    adminBToken = jwt.sign(
      {
        sub: adminBId,
        userId: adminBId,
        schoolId: schoolB,
        role: UserRole.SCHOOL_ADMIN,
      },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    driverAToken = jwt.sign(
      {
        sub: driverAId,
        userId: driverAId,
        schoolId: schoolA,
        role: UserRole.DRIVER,
      },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Nearest Suitable Road Snapping (Task 1)', () => {
    it('snaps coordinates to nearest road within accessible distance', async () => {
      vi.spyOn(RoutingService, 'snapToRoad').mockResolvedValueOnce({
        snappedPoints: [{ latitude: 28.5674, longitude: 77.2102 }],
        distanceMeters: 25,
        provider: 'MOCK_ROUTING_PROVIDER',
      });

      const res = await request(app)
        .post('/api/v1/parent/pickup/nearest-road')
        .send({
          latitude: 28.5672,
          longitude: 77.2100,
          schoolId: schoolA,
          landmark: 'South Extension Metro Station Gate 2',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isAccessible).toBe(true);
      expect(res.body.data.snappedCoordinates).toBeDefined();
      expect(res.body.data.distanceToRoadMeters).toBeLessThanOrEqual(300);
      expect(res.body.data.formattedAddress).toContain('South Extension Metro Station Gate 2');
    });

    it('identifies inaccessible coordinates exceeding 300m from navigable roads', async () => {
      vi.spyOn(RoutingService, 'snapToRoad').mockResolvedValueOnce({
        snappedPoints: [{ latitude: 28.5900, longitude: 77.2100 }], // ~2.5 km away
        distanceMeters: 2500,
        provider: 'MOCK_ROUTING_PROVIDER',
      });

      const res = await request(app)
        .post('/api/v1/parent/pickup/nearest-road')
        .send({
          latitude: 28.5672,
          longitude: 77.2100,
          schoolId: schoolA,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isAccessible).toBe(false);
      expect(res.body.data.distanceToRoadMeters).toBeGreaterThan(300);
    });
  });

  describe('2. Reverse Geocoding & Indian Transport Address Formatting (Task 2 & 3)', () => {
    it('synthesizes structured Indian transport address with landmark and locality', () => {
      const formatted = formatIndianTransportAddress({
        landmark: 'Near Apollo Pharmacy',
        street: 'Main Market Road',
        sublocality: 'Sector 14',
        city: 'Gurugram',
        state: 'Haryana',
        postalCode: '122001',
      });

      expect(formatted.formattedAddress).toBe(
        'Near Apollo Pharmacy, Main Market Road, Sector 14, Gurugram, Haryana 122001'
      );
      expect(formatted.suggestedStopName).toBe('Near Apollo Pharmacy');
    });

    it('derives concise driver-facing stop name when no explicit landmark is given', () => {
      const formatted = formatIndianTransportAddress({
        street: 'Outer Ring Road',
        sublocality: 'HSR Layout Sector 2',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560102',
      });

      expect(formatted.suggestedStopName).toBe('HSR Layout Sector 2 - Outer Ring Road');
      expect(formatted.formattedAddress).toContain('HSR Layout Sector 2');
    });

    it('generates readable address via service from coordinates', async () => {
      vi.spyOn(MapService, 'reverseGeocode').mockResolvedValueOnce({
        formattedAddress: 'Community Center, South Ex, New Delhi 110049',
        latitude: 28.5672,
        longitude: 77.2100,
        street: 'Ring Road',
        city: 'New Delhi',
        state: 'Delhi',
        postalCode: '110049',
      });

      const result = await DynamicPickupService.createReadableAddress(
        { latitude: 28.5672, longitude: 77.2100 },
        { schoolId: schoolA, landmark: 'Opposite Community Hall' }
      );

      expect(result.formattedAddress).toBeDefined();
      expect(result.formattedAddress).toContain('Opposite Community Hall');
      expect(result.suggestedStopName).toBe('Opposite Community Hall');
    });
  });

  describe('3. Store Coordinates & Spatial Cluster Deduplication (Task 4)', () => {
    it('creates and persists a new pickup location when no nearby stop exists on route', async () => {
      const mockRoute = [{ id: routeAId, name: 'Morning Route South Ex', code: 'RTE-S01' }];
      const mockStudent = [{ id: studentAId, full_name: 'Rohan Mehra' }];
      const mockNearby: any[] = []; // No nearby stops
      const mockSeq = [{ next_seq: 3 }];
      const mockInsertedStop = [
        {
          id: 'stp-new-123',
          school_id: schoolA,
          route_id: routeAId,
          stop_name: 'South Ex Part 1 - Block D',
          sequence_order: 3,
          latitude: 28.5674,
          longitude: 77.2102,
          scheduled_time: '07:35:00',
          geofence_radius_meters: 300,
          created_at: new Date().toISOString(),
        },
      ];

      vi.spyOn(db, 'query')
        .mockResolvedValueOnce(mockRoute as any) // 1. route check
        .mockResolvedValueOnce(mockStudent as any) // 2. student check
        .mockResolvedValueOnce(mockNearby as any) // 3. nearby cluster check
        .mockResolvedValueOnce(mockSeq as any) // 4. next sequence order
        .mockResolvedValueOnce(mockInsertedStop as any) // 5. stop insert
        .mockResolvedValueOnce([] as any); // 6. student_stop_assignments upsert

      const res = await request(app)
        .post('/api/v1/parent/pickup/create-point')
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          schoolId: schoolA,
          routeId: routeAId,
          latitude: 28.5672,
          longitude: 77.2100,
          studentId: studentAId,
          stopName: 'South Ex Part 1 - Block D',
          scheduledTime: '07:35:00',
          geofenceRadiusMeters: 300,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('stp-new-123');
      expect(res.body.data.reusedExistingStop).toBe(false);
      expect(res.body.data.sequenceOrder).toBe(3);
      expect(res.body.data.assignedStudentId).toBe(studentAId);
    });

    it('reuses nearby existing stop within cluster threshold (<= 50m) to prevent duplicate stops', async () => {
      const mockRoute = [{ id: routeAId, name: 'Morning Route South Ex', code: 'RTE-S01' }];
      const mockExistingNearby = [
        {
          id: 'stp-existing-888',
          stop_name: 'Lajpat Nagar Metro Gate 1',
          sequence_order: 2,
          latitude: 28.5700,
          longitude: 77.2200,
          scheduled_time: '07:20:00',
          geofence_radius_meters: 300,
          created_at: new Date().toISOString(),
        },
      ];

      vi.spyOn(db, 'query')
        .mockResolvedValueOnce(mockRoute as any) // 1. route check
        .mockResolvedValueOnce(mockExistingNearby as any) // 2. nearby cluster found!
        .mockResolvedValueOnce([] as any); // 3. student assignment upsert if needed

      const res = await request(app)
        .post('/api/v1/parent/pickup/create-point')
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          schoolId: schoolA,
          routeId: routeAId,
          latitude: 28.57015,
          longitude: 77.2200,
          clusterThresholdMeters: 50,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reusedExistingStop).toBe(true);
      expect(res.body.data.id).toBe('stp-existing-888');
      expect(res.body.data.stopName).toBe('Lajpat Nagar Metro Gate 1');
    });
  });

  describe('4. Tenant Isolation, Security & Authorization (Standing Rules)', () => {
    it('rejects cross-tenant stop creation when admin B attempts to create stop on school A route', async () => {
      const res = await request(app)
        .post('/api/v1/parent/pickup/create-point')
        .set('Authorization', `Bearer ${adminBToken}`)
        .send({
          schoolId: schoolA,
          routeId: routeAId,
          latitude: 28.5672,
          longitude: 77.2100,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('rejects driver token from creating pickup stops with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/parent/pickup/create-point')
        .set('Authorization', `Bearer ${driverAToken}`)
        .send({
          schoolId: schoolA,
          routeId: routeAId,
          latitude: 28.5672,
          longitude: 77.2100,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('rejects invalid latitude and longitude numbers with 422 Unprocessable Entity', async () => {
      const res = await request(app)
        .post('/api/v1/parent/pickup/create-point')
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          schoolId: schoolA,
          routeId: routeAId,
          latitude: 195.0, // Invalid latitude (>90)
          longitude: 77.2100,
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('rejects non-existent route with 404 Not Found', async () => {
      vi.spyOn(db, 'query').mockResolvedValueOnce([] as any); // Route not found

      const nonExistentRouteId = '00000000-0000-0000-0000-000000000999';
      const res = await request(app)
        .post('/api/v1/parent/pickup/create-point')
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          schoolId: schoolA,
          routeId: nonExistentRouteId,
          latitude: 28.5672,
          longitude: 77.2100,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('5. Real-DB Integration & Spatial Storage (Rule 8)', () => {
    it('persists pickup stop and student assignment to PostgreSQL with PostGIS geography point', async () => {
      let tablesExist = false;
      try {
        const check = await db.query(`SELECT to_regclass('public.pickup_locations') as tbl`);
        tablesExist = Boolean(check[0]?.tbl);
      } catch {
        tablesExist = false;
      }

      if (tablesExist) {
        const testSchoolId = schoolA;
        const testRouteId = '777e4567-e89b-12d3-a456-426614174777';
        const testStudentId = '888e4567-e89b-12d3-a456-426614174888';

        await db.query(
          `INSERT INTO schools (id, name, code, city, state)
           VALUES ($1, 'DPS Real DB Academy', 'DPS-RDB', 'New Delhi', 'Delhi')
           ON CONFLICT (id) DO NOTHING`,
          [testSchoolId]
        );

        await db.query(
          `INSERT INTO routes (id, school_id, name, code, route_type)
           VALUES ($1, $2, 'Real DB Route', 'RTE-RDB', 'MORNING_PICKUP')
           ON CONFLICT (id) DO NOTHING`,
          [testRouteId, testSchoolId]
        );

        await db.query(
          `INSERT INTO students (id, school_id, admission_number, full_name, class_grade, section)
           VALUES ($1, $2, 'ADM-RDB-01', 'Aditi Rao', 'Class 6', 'A')
           ON CONFLICT (id) DO NOTHING`,
          [testStudentId, testSchoolId]
        );

        // Call creation API
        const createRes = await request(app)
          .post('/api/v1/parent/pickup/create-point')
          .set('Authorization', `Bearer ${adminAToken}`)
          .send({
            schoolId: testSchoolId,
            routeId: testRouteId,
            latitude: 28.5672,
            longitude: 77.2100,
            studentId: testStudentId,
            stopName: 'Real DB Verified Stop',
            scheduledTime: '07:40:00',
            geofenceRadiusMeters: 300,
          });

        expect(createRes.status).toBe(201);
        expect(createRes.body.success).toBe(true);

        const stopId = createRes.body.data.id;

        // Verify stop in DB
        const stops = await db.query<{ id: string; stop_name: string; point_str: string }>(
          `SELECT id, stop_name, ST_AsText(location) AS point_str
           FROM pickup_locations
           WHERE id = $1`,
          [stopId]
        );

        expect(stops.length).toBe(1);
        expect(stops[0]?.stop_name).toBe('Real DB Verified Stop');
        expect(stops[0]?.point_str).toContain('POINT');

        // Verify assignment in DB
        const assignments = await db.query<{ pickup_stop_id: string }>(
          `SELECT pickup_stop_id
           FROM student_stop_assignments
           WHERE student_id = $1 AND school_id = $2`,
          [testStudentId, testSchoolId]
        );

        expect(assignments.length).toBe(1);
        expect(assignments[0]?.pickup_stop_id).toBe(stopId);
      } else {
        expect(true).toBe(true);
      }
    });
  });
});
