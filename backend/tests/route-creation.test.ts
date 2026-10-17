import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import * as db from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { RouteService } from '../src/services/route.service.js';
import { UserRole, RouteType } from '@school-bus/shared';

const schoolA = '111e4567-e89b-12d3-a456-426614174001';
const schoolB = '999e4567-e89b-12d3-a456-426614174999';

const adminAId = 'aaa11111-e89b-12d3-a456-426614174001';
const adminBId = 'bbb22222-e89b-12d3-a456-426614174002';
const driverAId = 'ddd11111-e89b-12d3-a456-426614174001';

const busAId = '222e4567-e89b-12d3-a456-426614174222';
const driverObjAId = '333e4567-e89b-12d3-a456-426614174333';
const routeAId = '555e4567-e89b-12d3-a456-426614174555';

describe('Phase 15.1: Route Management — Create Route', () => {
  let app: any;
  let adminAToken: string;
  let adminBToken: string;
  let driverAToken: string;

  beforeEach(() => {
    app = createApp();

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

  describe('1. Route Name & Operational Fields (Task 1)', () => {
    it('creates a new transit route with name, normalized code, route type, and duration', async () => {
      const mockSchool = [{ id: schoolA }];
      const mockExistingCode: any[] = []; // No duplicate
      const mockInsertedRoute = [
        {
          id: routeAId,
          school_id: schoolA,
          name: 'South Delhi Morning Express',
          code: 'RTE-SD01',
          route_type: RouteType.MORNING_PICKUP,
          default_bus_id: null,
          default_driver_id: null,
          path_polyline: null,
          estimated_duration_minutes: 50,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      vi.spyOn(db, 'query')
        .mockResolvedValueOnce(mockSchool as any) // 1. school existence check
        .mockResolvedValueOnce(mockExistingCode as any) // 2. duplicate code check
        .mockResolvedValueOnce(mockInsertedRoute as any); // 3. insert query

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/routes`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          name: 'South Delhi Morning Express',
          code: 'rte-sd01', // Lowercase to test normalization
          routeType: RouteType.MORNING_PICKUP,
          estimatedDurationMinutes: 50,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(routeAId);
      expect(res.body.data.name).toBe('South Delhi Morning Express');
      expect(res.body.data.code).toBe('RTE-SD01');
      expect(res.body.data.routeType).toBe(RouteType.MORNING_PICKUP);
      expect(res.body.data.estimatedDurationMinutes).toBe(50);
      expect(res.body.data.stopsCount).toBe(0);
      expect(res.body.data.studentsCount).toBe(0);
    });

    it('rejects duplicate route code within the same school with 409 Conflict', async () => {
      const mockSchool = [{ id: schoolA }];
      const mockExistingCode = [{ id: 'existing-route-id' }]; // Duplicate exists!

      vi.spyOn(db, 'query')
        .mockResolvedValueOnce(mockSchool as any)
        .mockResolvedValueOnce(mockExistingCode as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/routes`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          name: 'Duplicate Route Test',
          code: 'RTE-DUP',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/already in use/i);
    });

    it('validates required fields and rejects invalid payload with 422', async () => {
      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/routes`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          name: '', // Empty name
          code: 'R', // Too short
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Assign Bus & Assign Driver (Tasks 2 & 3)', () => {
    it('creates route with assigned bus and driver, returning enriched metadata', async () => {
      const mockSchool = [{ id: schoolA }];
      const mockExistingCode: any[] = [];
      const mockBus = [
        {
          id: busAId,
          bus_number: 'BUS-101',
          registration_number: 'DL-01-AB-1234',
        },
      ];
      const mockDriver = [
        {
          id: driverObjAId,
          full_name: 'Rajinder Singh',
          phone: '+919811223344',
        },
      ];
      const mockInsertedRoute = [
        {
          id: routeAId,
          school_id: schoolA,
          name: 'Rohini Express',
          code: 'RTE-ROH',
          route_type: RouteType.AFTERNOON_DROP,
          default_bus_id: busAId,
          default_driver_id: driverObjAId,
          path_polyline: null,
          estimated_duration_minutes: 40,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      vi.spyOn(db, 'query')
        .mockResolvedValueOnce(mockSchool as any) // 1. school check
        .mockResolvedValueOnce(mockExistingCode as any) // 2. code check
        .mockResolvedValueOnce(mockBus as any) // 3. bus lookup
        .mockResolvedValueOnce(mockDriver as any) // 4. driver lookup
        .mockResolvedValueOnce(mockInsertedRoute as any); // 5. insert query

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/routes`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          name: 'Rohini Express',
          code: 'RTE-ROH',
          routeType: RouteType.AFTERNOON_DROP,
          defaultBusId: busAId,
          defaultDriverId: driverObjAId,
          estimatedDurationMinutes: 40,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.defaultBusId).toBe(busAId);
      expect(res.body.data.busNumber).toBe('BUS-101');
      expect(res.body.data.busRegistrationNumber).toBe('DL-01-AB-1234');
      expect(res.body.data.defaultDriverId).toBe(driverObjAId);
      expect(res.body.data.driverName).toBe('Rajinder Singh');
      expect(res.body.data.driverPhone).toBe('+919811223344');
    });

    it('rejects assigning bus that does not exist or belongs to another school with 404', async () => {
      const mockSchool = [{ id: schoolA }];
      const mockExistingCode: any[] = [];
      const mockEmptyBus: any[] = []; // Bus not found in school A

      vi.spyOn(db, 'query')
        .mockResolvedValueOnce(mockSchool as any)
        .mockResolvedValueOnce(mockExistingCode as any)
        .mockResolvedValueOnce(mockEmptyBus as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/routes`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          name: 'Invalid Bus Route',
          code: 'RTE-INVB',
          defaultBusId: '00000000-0000-0000-0000-000000000000',
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/Bus .* not found/i);
    });

    it('rejects assigning driver that does not exist or belongs to another school with 404', async () => {
      const mockSchool = [{ id: schoolA }];
      const mockExistingCode: any[] = [];
      const mockEmptyDriver: any[] = []; // Driver not found in school A

      vi.spyOn(db, 'query')
        .mockResolvedValueOnce(mockSchool as any)
        .mockResolvedValueOnce(mockExistingCode as any)
        .mockResolvedValueOnce(mockEmptyDriver as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/routes`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          name: 'Invalid Driver Route',
          code: 'RTE-INVD',
          defaultDriverId: '00000000-0000-0000-0000-000000000000',
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/Driver .* not found/i);
    });
  });

  describe('3. Route Detail Retrieval & Multi-tenant Authorization', () => {
    it('retrieves route details by routeId with aggregate counts', async () => {
      const mockRouteDetail = [
        {
          id: routeAId,
          school_id: schoolA,
          name: 'South Delhi Morning Express',
          code: 'RTE-SD01',
          route_type: RouteType.MORNING_PICKUP,
          default_bus_id: busAId,
          default_driver_id: driverObjAId,
          bus_number: 'BUS-101',
          registration_number: 'DL-01-AB-1234',
          driver_name: 'Rajinder Singh',
          driver_phone: '+919811223344',
          path_polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
          estimated_duration_minutes: 50,
          stops_count: 6,
          students_count: 24,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      vi.spyOn(db, 'query').mockResolvedValueOnce(mockRouteDetail as any);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolA}/routes/${routeAId}`)
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(routeAId);
      expect(res.body.data.stopsCount).toBe(6);
      expect(res.body.data.studentsCount).toBe(24);
      expect(res.body.data.busNumber).toBe('BUS-101');
      expect(res.body.data.driverName).toBe('Rajinder Singh');
    });

    it('rejects cross-tenant route creation with 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/routes`)
        .set('Authorization', `Bearer ${adminBToken}`) // Admin B calling School A
        .send({
          name: 'Cross Tenant Route',
          code: 'RTE-XT',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('rejects driver token from creating routes with 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/routes`)
        .set('Authorization', `Bearer ${driverAToken}`)
        .send({
          name: 'Driver Route Attempt',
          code: 'RTE-DRV',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('4. Real-DB Route Management Integration', () => {
    it('creates and verifies route in PostgreSQL when database is available', async () => {
      let isDbUp = false;
      try {
        const check = await db.query<{ reg: string }>("SELECT to_regclass('routes') as reg");
        isDbUp = Boolean(check.length > 0 && check[0]?.reg);
      } catch {
        isDbUp = false;
      }

      if (!isDbUp) {
        return; // Mocked environment, pass
      }

      const testSchoolId = '111e4567-e89b-12d3-a456-426614174001';
      const testBusId = '222e4567-e89b-12d3-a456-426614174222';
      const testDriverId = '333e4567-e89b-12d3-a456-426614174333';
      const testRouteCode = `RTE-RDB-${Date.now().toString().slice(-4)}`;

      await db.query(
        `INSERT INTO schools (id, name, code, city, state)
         VALUES ($1, 'Delhi Public School R.K. Puram', 'DPS-RKP', 'New Delhi', 'Delhi')
         ON CONFLICT (id) DO NOTHING`,
        [testSchoolId]
      );

      await db.query(
        `INSERT INTO buses (id, school_id, bus_number, registration_number)
         VALUES ($1, $2, 'BUS-RDB-01', 'DL-01-XX-9999')
         ON CONFLICT (id) DO NOTHING`,
        [testBusId, testSchoolId]
      );

      await db.query(
        `INSERT INTO drivers (id, school_id, full_name, phone, license_number, pin_hash)
         VALUES ($1, $2, 'Sukhwinder Singh', '+919811009988', 'DL-RTO-2022-7777', 'dummy_hash')
         ON CONFLICT (id) DO NOTHING`,
        [testDriverId, testSchoolId]
      );

      // Create Route via Service/API
      const createdRoute = await RouteService.createRoute(testSchoolId, {
        name: 'Real DB Test Route',
        code: testRouteCode,
        routeType: RouteType.MORNING_PICKUP,
        defaultBusId: testBusId,
        defaultDriverId: testDriverId,
        estimatedDurationMinutes: 45,
      });

      expect(createdRoute.id).toBeDefined();
      expect(createdRoute.code).toBe(testRouteCode);
      expect(createdRoute.busNumber).toBe('BUS-RDB-01');
      expect(createdRoute.driverName).toBe('Sukhwinder Singh');

      // Fetch via getRouteById
      const fetchedRoute = await RouteService.getRouteById(testSchoolId, createdRoute.id);
      expect(fetchedRoute.id).toBe(createdRoute.id);
      expect(fetchedRoute.name).toBe('Real DB Test Route');
      expect(fetchedRoute.defaultBusId).toBe(testBusId);
      expect(fetchedRoute.defaultDriverId).toBe(testDriverId);

      // Verify duplicate code check on Real DB throws ConflictError
      await expect(
        RouteService.createRoute(testSchoolId, {
          name: 'Duplicate Real DB Route',
          code: testRouteCode,
        })
      ).rejects.toThrow(/already in use/i);
    });
  });
});
