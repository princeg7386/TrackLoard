import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import * as db from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { UserRole } from '@school-bus/shared';

const schoolA = '111e4567-e89b-12d3-a456-426614174001';
const schoolB = '999e4567-e89b-12d3-a456-426614174999';

const adminAId = 'aaa11111-e89b-12d3-a456-426614174001';
const adminBId = 'bbb22222-e89b-12d3-a456-426614174002';
const driverAId = 'ddd11111-e89b-12d3-a456-426614174001';

const routeAId = '555e4567-e89b-12d3-a456-426614174555';
const stop1Id = '666e4567-e89b-12d3-a456-426614174661';
const stop2Id = '666e4567-e89b-12d3-a456-426614174662';
const stop3Id = '666e4567-e89b-12d3-a456-426614174663';

describe('Phase 15.2: Route Management — Pickup Sequence', () => {
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

  describe('1. Add Pickup Locations (Task 1)', () => {
    it('adds a pickup stop with auto-assigned sequence order when sequenceOrder is omitted', async () => {
      const mockRoute = [{ id: routeAId }];
      const mockMax = [{ next_order: 1 }];
      const mockInsert = [
        {
          id: stop1Id,
          school_id: schoolA,
          route_id: routeAId,
          stop_name: 'Main Gate Stop',
          sequence_order: 1,
          latitude: 28.5355,
          longitude: 77.241,
          scheduled_time: '07:30:00',
          geofence_radius_meters: 300,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      vi.spyOn(db, 'query')
        .mockResolvedValueOnce(mockRoute as any) // 1. route exists
        .mockResolvedValueOnce(mockMax as any) // 2. max sequence
        .mockResolvedValueOnce(mockInsert as any); // 3. insert stop

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/routes/${routeAId}/stops`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          stopName: 'Main Gate Stop',
          latitude: 28.5355,
          longitude: 77.241,
          scheduledTime: '07:30',
          geofenceRadiusMeters: 300,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.stopName).toBe('Main Gate Stop');
      expect(res.body.data.sequenceOrder).toBe(1);
      expect(res.body.data.scheduledTime).toBe('07:30:00');
    });

    it('shifts existing stops when a stop is added at a specific sequence order', async () => {
      const mockRoute = [{ id: routeAId }];
      const mockInsert = [
        {
          id: stop2Id,
          school_id: schoolA,
          route_id: routeAId,
          stop_name: 'Sector 4 Market',
          sequence_order: 2,
          latitude: 28.54,
          longitude: 77.25,
          scheduled_time: '07:45:00',
          geofence_radius_meters: 300,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      const querySpy = vi.spyOn(db, 'query')
        .mockResolvedValueOnce(mockRoute as any) // 1. route exists
        .mockResolvedValueOnce([] as any) // 2. shift offset (+50000)
        .mockResolvedValueOnce([] as any) // 3. shift final (+1)
        .mockResolvedValueOnce(mockInsert as any); // 4. insert stop

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/routes/${routeAId}/stops`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          stopName: 'Sector 4 Market',
          latitude: 28.54,
          longitude: 77.25,
          scheduledTime: '07:45',
          geofenceRadiusMeters: 300,
          sequenceOrder: 2,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.sequenceOrder).toBe(2);
      expect(querySpy).toHaveBeenCalledTimes(5); // 1. route check, 2. shift offset, 3. shift final, 4. insert, 5. audit log
    });

    it('rejects invalid latitude and scheduled time with 422 Unprocessable Entity', async () => {
      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/routes/${routeAId}/stops`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          stopName: 'X', // Too short (min 2)
          latitude: 195.0, // Invalid lat (> 90)
          longitude: 77.241,
          scheduledTime: '25:99', // Invalid time
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Order Pickup Sequence (Task 2)', () => {
    it('retrieves pickup stops ordered by sequence_order ASC with assigned student counts', async () => {
      const mockRoute = [{ id: routeAId }];
      const mockStops = [
        {
          id: stop1Id,
          school_id: schoolA,
          route_id: routeAId,
          stop_name: 'Stop 1 - Colony Gate',
          sequence_order: 1,
          latitude: 28.53,
          longitude: 77.24,
          scheduled_time: '07:15:00',
          geofence_radius_meters: 300,
          assigned_students_count: 5,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: stop2Id,
          school_id: schoolA,
          route_id: routeAId,
          stop_name: 'Stop 2 - Metro Station',
          sequence_order: 2,
          latitude: 28.54,
          longitude: 77.25,
          scheduled_time: '07:30:00',
          geofence_radius_meters: 250,
          assigned_students_count: 12,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      vi.spyOn(db, 'query')
        .mockResolvedValueOnce(mockRoute as any) // 1. route exists
        .mockResolvedValueOnce(mockStops as any); // 2. list stops

      const res = await request(app)
        .get(`/api/v1/schools/${schoolA}/routes/${routeAId}/stops`)
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data[0].sequenceOrder).toBe(1);
      expect(res.body.data[0].assignedStudentsCount).toBe(5);
      expect(res.body.data[1].sequenceOrder).toBe(2);
      expect(res.body.data[1].assignedStudentsCount).toBe(12);
    });
  });

  describe('3. Edit Sequence & Reorder (Task 3)', () => {
    it('reorders pickup stops via drag-and-drop stopIds array without constraint violations', async () => {
      const mockRoute = [{ id: routeAId }];
      const mockActive = [{ id: stop1Id }, { id: stop2Id }, { id: stop3Id }];
      const reorderedResult = [
        {
          id: stop3Id,
          school_id: schoolA,
          route_id: routeAId,
          stop_name: 'Stop 3',
          sequence_order: 1,
          latitude: 28.55,
          longitude: 77.26,
          scheduled_time: '07:10:00',
          geofence_radius_meters: 300,
          assigned_students_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: stop1Id,
          school_id: schoolA,
          route_id: routeAId,
          stop_name: 'Stop 1',
          sequence_order: 2,
          latitude: 28.53,
          longitude: 77.24,
          scheduled_time: '07:25:00',
          geofence_radius_meters: 300,
          assigned_students_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: stop2Id,
          school_id: schoolA,
          route_id: routeAId,
          stop_name: 'Stop 2',
          sequence_order: 3,
          latitude: 28.54,
          longitude: 77.25,
          scheduled_time: '07:40:00',
          geofence_radius_meters: 300,
          assigned_students_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      vi.spyOn(db, 'query')
        .mockResolvedValueOnce(mockRoute as any) // 1. route exists
        .mockResolvedValueOnce(mockActive as any) // 2. active stops list
        .mockResolvedValueOnce([] as any) // 3. offset +50000
        .mockResolvedValueOnce([] as any) // 4. update stop3 -> 1
        .mockResolvedValueOnce([] as any) // 5. update stop1 -> 2
        .mockResolvedValueOnce([] as any) // 6. update stop2 -> 3
        .mockResolvedValueOnce(mockRoute as any) // 7. listRouteStops route check
        .mockResolvedValueOnce(reorderedResult as any); // 8. listRouteStops query

      const res = await request(app)
        .put(`/api/v1/schools/${schoolA}/routes/${routeAId}/stops/reorder`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          stopIds: [stop3Id, stop1Id, stop2Id],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0].id).toBe(stop3Id);
      expect(res.body.data[0].sequenceOrder).toBe(1);
      expect(res.body.data[1].id).toBe(stop1Id);
      expect(res.body.data[1].sequenceOrder).toBe(2);
      expect(res.body.data[2].id).toBe(stop2Id);
      expect(res.body.data[2].sequenceOrder).toBe(3);
    });

    it('rejects reordering with unknown stop IDs or mismatched length', async () => {
      const mockRoute = [{ id: routeAId }];
      const mockActive = [{ id: stop1Id }, { id: stop2Id }];

      vi.spyOn(db, 'query')
        .mockResolvedValueOnce(mockRoute as any)
        .mockResolvedValueOnce(mockActive as any);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolA}/routes/${routeAId}/stops/reorder`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          stopIds: [stop1Id], // Missing stop2Id
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('match exactly all active stops');
    });

    it('updates an individual stop details and changes its sequence', async () => {
      const mockStop = [{ id: stop1Id, sequence_order: 1 }];
      const mockAllActive = [{ id: stop1Id }, { id: stop2Id }];
      const updatedList = [
        {
          id: stop2Id,
          school_id: schoolA,
          route_id: routeAId,
          stop_name: 'Stop 2',
          sequence_order: 1,
          latitude: 28.54,
          longitude: 77.25,
          scheduled_time: '07:30:00',
          geofence_radius_meters: 300,
          assigned_students_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: stop1Id,
          school_id: schoolA,
          route_id: routeAId,
          stop_name: 'Main Gate Stop (Renamed)',
          sequence_order: 2,
          latitude: 28.5355,
          longitude: 77.241,
          scheduled_time: '07:45:00',
          geofence_radius_meters: 350,
          assigned_students_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      vi.spyOn(db, 'query')
        .mockResolvedValueOnce(mockStop as any) // 1. stop check
        .mockResolvedValueOnce(mockAllActive as any) // 2. active stops
        // In reorderRouteStops:
        .mockResolvedValueOnce([{ id: routeAId }] as any) // 3. route check
        .mockResolvedValueOnce(mockAllActive as any) // 4. active check
        .mockResolvedValueOnce([] as any) // 5. offset +50000
        .mockResolvedValueOnce([] as any) // 6. update 1
        .mockResolvedValueOnce([] as any) // 7. update 2
        .mockResolvedValueOnce([{ id: routeAId }] as any) // 8. list route check
        .mockResolvedValueOnce(updatedList as any) // 9. list result
        .mockResolvedValueOnce([] as any) // 9b. reorder audit log
        // Update details:
        .mockResolvedValueOnce([] as any) // 10. update non-sequence fields
        // Final list:
        .mockResolvedValueOnce([{ id: routeAId }] as any) // 11. list route check
        .mockResolvedValueOnce(updatedList as any) // 12. final list result
        .mockResolvedValueOnce([] as any); // 13. update audit log

      const res = await request(app)
        .put(`/api/v1/schools/${schoolA}/routes/${routeAId}/stops/${stop1Id}`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          stopName: 'Main Gate Stop (Renamed)',
          scheduledTime: '07:45',
          geofenceRadiusMeters: 350,
          sequenceOrder: 2,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.stopName).toBe('Main Gate Stop (Renamed)');
    });
  });

  describe('4. Remove Pickup (Task 4)', () => {
    it('soft-deletes a pickup stop, sets negative sequence order, and renumbers remaining stops consecutively', async () => {
      const mockStop = [{ id: stop2Id, sequence_order: 2 }];
      const mockNeg = [{ next_neg: 10001 }];
      const remainingStops = [{ id: stop1Id }, { id: stop3Id }];

      vi.spyOn(db, 'query')
        .mockResolvedValueOnce(mockStop as any) // 1. stop exists
        .mockResolvedValueOnce(mockNeg as any) // 2. get next negative
        .mockResolvedValueOnce([] as any) // 3. soft delete stop2 with negative sequence
        .mockResolvedValueOnce(remainingStops as any) // 4. remaining stops
        .mockResolvedValueOnce([] as any) // 5. offset remaining +50000
        .mockResolvedValueOnce([] as any) // 6. update stop1 -> 1
        .mockResolvedValueOnce([] as any); // 7. update stop3 -> 2

      const res = await request(app)
        .delete(`/api/v1/schools/${schoolA}/routes/${routeAId}/stops/${stop2Id}`)
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.removedStopId).toBe(stop2Id);
      expect(res.body.data.remainingStopsCount).toBe(2);
    });

    it('returns 404 if the stop to remove does not exist or is already soft-deleted', async () => {
      vi.spyOn(db, 'query').mockResolvedValueOnce([] as any);

      const res = await request(app)
        .delete(`/api/v1/schools/${schoolA}/routes/${routeAId}/stops/${stop1Id}`)
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('5. Security, Roles & Tenant Isolation', () => {
    it('blocks cross-tenant school B admin from managing school A route stops (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/schools/${schoolA}/routes/${routeAId}/stops`)
        .set('Authorization', `Bearer ${adminBToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('blocks driver JWT from adding or deleting route stops (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/routes/${routeAId}/stops`)
        .set('Authorization', `Bearer ${driverAToken}`)
        .send({
          stopName: 'Driver Added Stop',
          latitude: 28.53,
          longitude: 77.24,
          scheduledTime: '07:30',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('6. Real-DB Integration Test (Live Database)', () => {
    it('performs full lifecycle: add stops, reorder, update, and remove with live PostGIS coordinates', async () => {
      let isDbLive = false;
      try {
        const check = await db.query<{ tbl: string | null }>(
          `SELECT to_regclass('public.pickup_locations') as tbl;`
        ).catch(() => [{ tbl: null }]);
        isDbLive = Boolean(check.length > 0 && check[0]?.tbl);
      } catch {
        isDbLive = false;
      }

      if (!isDbLive) {
        console.log('Skipping Real-DB route pickup sequence test: PostgreSQL schema not migrated');
        return;
      }

      // 1. Get or create a test school
      const schoolResult = await db.query<{ id: string }>(
        `INSERT INTO schools (name, code, city, state, phone)
         VALUES ('Route Test Academy', 'RTA-${Date.now().toString().slice(-4)}', 'Bengaluru', 'Karnataka', '+919999000111')
         RETURNING id`
      );
      const testSchoolId = schoolResult[0]!.id;

      // Create admin token for testSchoolId
      const testAdminToken = jwt.sign(
        {
          sub: adminAId,
          userId: adminAId,
          schoolId: testSchoolId,
          role: UserRole.SCHOOL_ADMIN,
        },
        env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      // 2. Create test route
      const routeRes = await request(app)
        .post(`/api/v1/schools/${testSchoolId}/routes`)
        .set('Authorization', `Bearer ${testAdminToken}`)
        .send({
          name: 'Electronic City Express',
          code: `ECE-${Date.now().toString().slice(-4)}`,
        });
      expect(routeRes.status).toBe(201);
      const testRouteId = routeRes.body.data.id;

      try {
        // 3. Add 3 stops
        const addStop1 = await request(app)
          .post(`/api/v1/schools/${testSchoolId}/routes/${testRouteId}/stops`)
          .set('Authorization', `Bearer ${testAdminToken}`)
          .send({
            stopName: 'Wipro Gate',
            latitude: 12.845,
            longitude: 77.663,
            scheduledTime: '07:15',
            geofenceRadiusMeters: 300,
          });
        expect(addStop1.status).toBe(201);
        expect(addStop1.body.data.sequenceOrder).toBe(1);
        const s1Id = addStop1.body.data.id;

        const addStop2 = await request(app)
          .post(`/api/v1/schools/${testSchoolId}/routes/${testRouteId}/stops`)
          .set('Authorization', `Bearer ${testAdminToken}`)
          .send({
            stopName: 'Infosys Main Gate',
            latitude: 12.85,
            longitude: 77.667,
            scheduledTime: '07:30',
            geofenceRadiusMeters: 300,
          });
        expect(addStop2.status).toBe(201);
        expect(addStop2.body.data.sequenceOrder).toBe(2);
        const s2Id = addStop2.body.data.id;

        const addStop3 = await request(app)
          .post(`/api/v1/schools/${testSchoolId}/routes/${testRouteId}/stops`)
          .set('Authorization', `Bearer ${testAdminToken}`)
          .send({
            stopName: 'Velankani Tech Park',
            latitude: 12.855,
            longitude: 77.671,
            scheduledTime: '07:45',
            geofenceRadiusMeters: 300,
          });
        expect(addStop3.status).toBe(201);
        expect(addStop3.body.data.sequenceOrder).toBe(3);
        const s3Id = addStop3.body.data.id;

        // 4. List stops
        const listRes = await request(app)
          .get(`/api/v1/schools/${testSchoolId}/routes/${testRouteId}/stops`)
          .set('Authorization', `Bearer ${testAdminToken}`);
        expect(listRes.status).toBe(200);
        expect(listRes.body.data.length).toBe(3);
        expect(listRes.body.data.map((s: any) => s.sequenceOrder)).toEqual([1, 2, 3]);

        // 5. Reorder stops: [s3Id, s1Id, s2Id]
        const reorderRes = await request(app)
          .put(`/api/v1/schools/${testSchoolId}/routes/${testRouteId}/stops/reorder`)
          .set('Authorization', `Bearer ${testAdminToken}`)
          .send({
            stopIds: [s3Id, s1Id, s2Id],
          });
        expect(reorderRes.status).toBe(200);
        expect(reorderRes.body.data.map((s: any) => s.id)).toEqual([s3Id, s1Id, s2Id]);
        expect(reorderRes.body.data.map((s: any) => s.sequenceOrder)).toEqual([1, 2, 3]);

        // 6. Update stop details
        const updateRes = await request(app)
          .put(`/api/v1/schools/${testSchoolId}/routes/${testRouteId}/stops/${s3Id}`)
          .set('Authorization', `Bearer ${testAdminToken}`)
          .send({
            stopName: 'Velankani Campus Main Entrance',
            geofenceRadiusMeters: 400,
          });
        expect(updateRes.status).toBe(200);
        expect(updateRes.body.data.stopName).toBe('Velankani Campus Main Entrance');
        expect(updateRes.body.data.geofenceRadiusMeters).toBe(400);

        // 7. Remove stop (remove s1Id which is at sequence 2)
        const removeRes = await request(app)
          .delete(`/api/v1/schools/${testSchoolId}/routes/${testRouteId}/stops/${s1Id}`)
          .set('Authorization', `Bearer ${testAdminToken}`);
        expect(removeRes.status).toBe(200);
        expect(removeRes.body.data.remainingStopsCount).toBe(2);

        // Verify remaining stops are renumbered consecutively 1, 2
        const finalListRes = await request(app)
          .get(`/api/v1/schools/${testSchoolId}/routes/${testRouteId}/stops`)
          .set('Authorization', `Bearer ${testAdminToken}`);
        expect(finalListRes.status).toBe(200);
        expect(finalListRes.body.data.length).toBe(2);
        expect(finalListRes.body.data.map((s: any) => s.sequenceOrder)).toEqual([1, 2]);

        // Verify deleted stop has negative sequence in DB
        const deletedCheck = await db.query<{ sequence_order: number; deleted_at: string }>(
          `SELECT sequence_order, deleted_at FROM pickup_locations WHERE id = $1`,
          [s1Id]
        );
        expect(deletedCheck[0]!.deleted_at).not.toBeNull();
        expect(deletedCheck[0]!.sequence_order).toBeLessThan(0);
      } finally {
        // Cleanup test data
        await db.query(`DELETE FROM pickup_locations WHERE route_id = $1`, [testRouteId]);
        await db.query(`DELETE FROM routes WHERE id = $1`, [testRouteId]);
        await db.query(`DELETE FROM schools WHERE id = $1`, [testSchoolId]);
      }
    });
  });
});
