import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import * as db from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { DynamicPickupService } from '../src/services/dynamic-pickup/dynamic-pickup.service.js';
import { MapService } from '../src/services/maps/map.service.js';
import { RoutingService } from '../src/services/routing/routing.service.js';
import { MessagingService } from '../src/services/messaging/messaging.service.js';
import { UserRole } from '@school-bus/shared';

const schoolA = '111e4567-e89b-12d3-a456-426614174001';
const schoolB = '999e4567-e89b-12d3-a456-426614174999';

const adminAId = 'aaa11111-e89b-12d3-a456-426614174001';
const adminBId = 'bbb22222-e89b-12d3-a456-426614174002';
const driverAId = 'ddd11111-e89b-12d3-a456-426614174001';

const routeAId = '555e4567-e89b-12d3-a456-426614174555';
const stopAId = '666e4567-e89b-12d3-a456-426614174666';
const stopBId = '777e4567-e89b-12d3-a456-426614174777';
const studentAId = '444e4567-e89b-12d3-a456-426614174444';

describe('Phase 14.4: Safety/Quality Checks & Stop Management', () => {
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

  describe('1. Reject Clearly Invalid Locations (Task 1)', () => {
    it('evaluates location safety and flags Null Island (0,0)', async () => {
      const res = await request(app)
        .post('/api/v1/parent/pickup/safety-check')
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          latitude: 0,
          longitude: 0,
          schoolId: schoolA,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isSafe).toBe(false);
      expect(res.body.data.safetyScore).toBe(0);
      expect(res.body.data.reasons[0]).toMatch(/Null Island/i);
    });

    it('evaluates location safety and flags coordinates outside India (e.g. London)', async () => {
      const res = await request(app)
        .post('/api/v1/parent/pickup/safety-check')
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          latitude: 51.5074,
          longitude: -0.1278,
          schoolId: schoolA,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isSafe).toBe(false);
      expect(res.body.data.isWithinIndia).toBe(false);
      expect(res.body.data.reasons[0]).toMatch(/outside the territory of India/i);
    });

    it('evaluates location safety and approves valid Delhi coordinates', async () => {
      const res = await request(app)
        .post('/api/v1/parent/pickup/safety-check')
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          latitude: 28.5672,
          longitude: 77.2100,
          schoolId: schoolA,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isSafe).toBe(true);
      expect(res.body.data.isWithinIndia).toBe(true);
      expect(res.body.data.safetyScore).toBeGreaterThanOrEqual(70);
    });

    it('rejects creating pickup point at Null Island with 422 ValidationError', async () => {
      const mockRoute = [{ id: routeAId, name: 'Route A', code: 'R-01' }];
      vi.spyOn(db, 'query').mockResolvedValueOnce(mockRoute as any);

      const res = await request(app)
        .post('/api/v1/parent/pickup/create-point')
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          schoolId: schoolA,
          routeId: routeAId,
          latitude: 0,
          longitude: 0,
          stopName: 'Invalid Stop',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/Null Island/i);
    });

    it('rejects creating pickup point outside India with 422 ValidationError', async () => {
      const mockRoute = [{ id: routeAId, name: 'Route A', code: 'R-01' }];
      vi.spyOn(db, 'query').mockResolvedValueOnce(mockRoute as any);

      const res = await request(app)
        .post('/api/v1/parent/pickup/create-point')
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          schoolId: schoolA,
          routeId: routeAId,
          latitude: 51.5074,
          longitude: -0.1278,
          stopName: 'London Stop',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/outside the territory of India/i);
    });
  });

  describe('2. Detect Duplicate/Nearby Pickup Points (Task 2)', () => {
    it('detects duplicate stop within 50m and recommends REUSE_EXISTING', async () => {
      const mockNearbyRows = [
        {
          id: stopAId,
          stop_name: 'AIIMS Metro Station Gate 2',
          sequence_order: 2,
          latitude: 28.5670,
          longitude: 77.2100,
          scheduled_time: '07:30:00',
          geofence_radius_meters: 300,
          route_id: routeAId,
          route_name: 'South Ex Route',
          route_code: 'RTE-S01',
          distance_meters: 22.4, // within 50m!
          assigned_students_count: 5,
        },
      ];

      vi.spyOn(db, 'query').mockResolvedValueOnce(mockNearbyRows as any);

      const res = await request(app)
        .post('/api/v1/parent/pickup/detect-duplicates')
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          schoolId: schoolA,
          routeId: routeAId,
          latitude: 28.5672,
          longitude: 77.2100,
          radiusMeters: 500,
          duplicateThresholdMeters: 50,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hasNearbyDuplicates).toBe(true);
      expect(res.body.data.duplicateCount).toBe(1);
      expect(res.body.data.recommendation).toBe('REUSE_EXISTING');
      expect(res.body.data.nearbyStops[0].id).toBe(stopAId);
      expect(res.body.data.nearbyStops[0].isDuplicate).toBe(true);
      expect(res.body.data.nearbyStops[0].assignedStudentsCount).toBe(5);
    });

    it('reports no duplicate when closest stop is 200m away (recommend CREATE_NEW)', async () => {
      const mockNearbyRows = [
        {
          id: stopAId,
          stop_name: 'Safdarjung Enclave Market',
          sequence_order: 3,
          latitude: 28.5650,
          longitude: 77.2080,
          scheduled_time: '07:35:00',
          geofence_radius_meters: 300,
          route_id: routeAId,
          route_name: 'South Ex Route',
          route_code: 'RTE-S01',
          distance_meters: 210.0, // > 50m!
          assigned_students_count: 2,
        },
      ];

      vi.spyOn(db, 'query').mockResolvedValueOnce(mockNearbyRows as any);

      const res = await request(app)
        .post('/api/v1/parent/pickup/detect-duplicates')
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          schoolId: schoolA,
          routeId: routeAId,
          latitude: 28.5672,
          longitude: 77.2100,
          radiusMeters: 500,
          duplicateThresholdMeters: 50,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hasNearbyDuplicates).toBe(false);
      expect(res.body.data.duplicateCount).toBe(0);
      expect(res.body.data.recommendation).toBe('CREATE_NEW');
      expect(res.body.data.nearbyStops[0].isDuplicate).toBe(false);
    });

    it('audits route for duplicate stop clusters within 50m', async () => {
      const mockAuditRows = [
        {
          stop1_id: stopAId,
          stop1_name: 'South Extension Metro Gate 1',
          stop1_seq: 1,
          stop2_id: stopBId,
          stop2_name: 'South Extension Part 1 Main Road',
          stop2_seq: 2,
          route_id: routeAId,
          route_name: 'Morning South Ex Route',
          route_code: 'RTE-S01',
          distance_meters: 35.0,
          stop1_students: 4,
          stop2_students: 2,
        },
      ];

      vi.spyOn(db, 'query').mockResolvedValueOnce(mockAuditRows as any);

      const res = await request(app)
        .get(`/api/v1/parent/pickup/audit-duplicates?routeId=${routeAId}&thresholdMeters=50`)
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.duplicatePairsCount).toBe(1);
      expect(res.body.data.duplicateClusters[0].distanceMeters).toBe(35);
      expect(res.body.data.duplicateClusters[0].stop1.studentsCount).toBe(4);
    });

    it('rejects cross-tenant duplicate inspection with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/parent/pickup/detect-duplicates')
        .set('Authorization', `Bearer ${adminBToken}`)
        .send({
          schoolId: schoolA,
          latitude: 28.5672,
          longitude: 77.2100,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('3. Allow School to Edit/Change Pickup (Task 3)', () => {
    it('retrieves detailed stop information including assigned students', async () => {
      const mockStop = [
        {
          id: stopAId,
          school_id: schoolA,
          route_id: routeAId,
          route_name: 'Morning South Ex Route',
          route_code: 'RTE-S01',
          stop_name: 'Green Park Metro Station',
          sequence_order: 1,
          latitude: 28.5580,
          longitude: 77.2060,
          scheduled_time: '07:15:00',
          geofence_radius_meters: 300,
        },
      ];

      const mockStudents = [
        {
          id: studentAId,
          full_name: 'Aarav Sharma',
          admission_number: 'ADM-101',
          class_grade: 'Class 6',
          section: 'A',
          parent_name: 'Rajesh Sharma',
          parent_phone: '+919876543210',
        },
      ];

      vi.spyOn(db, 'query')
        .mockResolvedValueOnce(mockStop as any)
        .mockResolvedValueOnce(mockStudents as any);

      const res = await request(app)
        .get(`/api/v1/parent/pickup/stops/${stopAId}`)
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(stopAId);
      expect(res.body.data.stopName).toBe('Green Park Metro Station');
      expect(res.body.data.assignedStudents.length).toBe(1);
      expect(res.body.data.assignedStudents[0].fullName).toBe('Aarav Sharma');
    });

    it('updates stop details, reassigns students, and dispatches WhatsApp notification', async () => {
      const mockCurrentStop = [
        {
          id: stopAId,
          school_id: schoolA,
          route_id: routeAId,
          stop_name: 'Green Park Metro',
          latitude: 28.5580,
          longitude: 77.2060,
          scheduled_time: '07:15:00',
          geofence_radius_meters: 300,
        },
      ];

      const mockTargetStop = [{ id: stopBId }];
      const mockParents = [
        {
          parent_phone: '+919876543210',
          parent_name: 'Rajesh Sharma',
          student_name: 'Aarav Sharma',
          student_id: studentAId,
        },
      ];

      const sendSpy = vi.spyOn(MessagingService, 'sendMessage').mockResolvedValue({
        messageId: 'msg-whatsapp-edit',
        provider: 'mock',
        status: 'SENT',
        timestamp: new Date().toISOString(),
      });

      vi.spyOn(db, 'query')
        .mockResolvedValueOnce(mockCurrentStop as any) // 1. fetch current stop
        .mockResolvedValueOnce([] as any) // 2. update pickup_locations
        .mockResolvedValueOnce(mockTargetStop as any) // 3. check target stop
        .mockResolvedValueOnce({ rowCount: 1 } as any) // 4. update student_stop_assignments
        .mockResolvedValueOnce(mockParents as any); // 5. query parents for WhatsApp

      const res = await request(app)
        .put(`/api/v1/parent/pickup/stops/${stopAId}`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          stopName: 'Green Park Metro Gate 2 Revised',
          scheduledTime: '07:20:00',
          reassignStudentsToStopId: stopBId,
          notifyParents: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.stopName).toBe('Green Park Metro Gate 2 Revised');
      expect(res.body.data.scheduledTime).toBe('07:20:00');
      expect(res.body.data.reassignedStudentsCount).toBe(1);
      expect(res.body.data.parentsNotifiedCount).toBe(1);
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects stop deletion when students are assigned without forceReassignToStopId', async () => {
      const mockStop = [{ id: stopAId, stop_name: 'Green Park Metro' }];
      const mockCount = [{ count: 3 }]; // 3 students assigned!

      vi.spyOn(db, 'query')
        .mockResolvedValueOnce(mockStop as any)
        .mockResolvedValueOnce(mockCount as any);

      const res = await request(app)
        .delete(`/api/v1/parent/pickup/stops/${stopAId}`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({});

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toMatch(/Cannot delete pickup stop because 3 student\(s\) are currently assigned/i);
    });

    it('successfully soft-deletes pickup stop when students are safely migrated to another stop', async () => {
      const mockStop = [{ id: stopAId, stop_name: 'Green Park Metro' }];
      const mockCount = [{ count: 1 }];
      const mockTarget = [{ id: stopBId, stop_name: 'Hauz Khas Gate 1', scheduled_time: '07:30:00' }];
      const mockParents = [
        {
          parent_phone: '+919876543210',
          parent_name: 'Rajesh Sharma',
          student_name: 'Aarav Sharma',
          student_id: studentAId,
        },
      ];

      const sendSpy = vi.spyOn(MessagingService, 'sendMessage').mockResolvedValue({
        messageId: 'msg-whatsapp-del',
        provider: 'mock',
        status: 'SENT',
        timestamp: new Date().toISOString(),
      });

      vi.spyOn(db, 'query')
        .mockResolvedValueOnce(mockStop as any) // 1. stop check
        .mockResolvedValueOnce(mockCount as any) // 2. student count check
        .mockResolvedValueOnce(mockTarget as any) // 3. target stop check
        .mockResolvedValueOnce({ rowCount: 1 } as any) // 4. update student_stop_assignments
        .mockResolvedValueOnce(mockParents as any) // 5. parent lookup for notification
        .mockResolvedValueOnce([] as any); // 6. soft-delete stop

      const res = await request(app)
        .delete(`/api/v1/parent/pickup/stops/${stopAId}`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          forceReassignToStopId: stopBId,
          notifyParents: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reassignedStudentsCount).toBe(1);
      expect(res.body.data.parentsNotifiedCount).toBe(1);
    });

    it('rejects driver token from editing or deleting stops with 403 Forbidden', async () => {
      const resPut = await request(app)
        .put(`/api/v1/parent/pickup/stops/${stopAId}`)
        .set('Authorization', `Bearer ${driverAToken}`)
        .send({ stopName: 'Driver Edit Attempt' });

      expect(resPut.status).toBe(403);

      const resDel = await request(app)
        .delete(`/api/v1/parent/pickup/stops/${stopAId}`)
        .set('Authorization', `Bearer ${driverAToken}`)
        .send({});

      expect(resDel.status).toBe(403);
    });
  });

  describe('4. Real-DB PostGIS Spatial Quality & Duplicate Verification', () => {
    it('executes spatial queries against real database when available', async () => {
      let isDbUp = false;
      try {
        const check = await db.query<{ reg: string }>("SELECT to_regclass('pickup_locations') as reg");
        isDbUp = Boolean(check.length > 0 && check[0]?.reg);
      } catch {
        isDbUp = false;
      }

      if (!isDbUp) {
        return; // Mocked environment, pass
      }

      const testSchoolId = '111e4567-e89b-12d3-a456-426614174001';
      const testRouteId = '555e4567-e89b-12d3-a456-426614174555';
      const realStop1Id = '911e4567-e89b-12d3-a456-426614174911';
      const realStop2Id = '922e4567-e89b-12d3-a456-426614174922';

      await db.query(
        `INSERT INTO schools (id, name, code, city, state)
         VALUES ($1, 'Delhi Public School R.K. Puram', 'DPS-SAFE-911', 'New Delhi', 'Delhi')
         ON CONFLICT (id) DO NOTHING`,
        [testSchoolId]
      );

      await db.query(
        `INSERT INTO routes (id, school_id, name, code, route_type)
         VALUES ($1, $2, 'South Delhi Morning Route', 'RTE-SD01', 'MORNING_PICKUP')
         ON CONFLICT (id) DO NOTHING`,
        [testRouteId, testSchoolId]
      );

      // Stop 1: AIIMS Metro (28.5672, 77.2100)
      await db.query(
        `INSERT INTO pickup_locations (
           id, school_id, route_id, stop_name, sequence_order, latitude, longitude, location, scheduled_time, geofence_radius_meters
         ) VALUES (
           $1, $2, $3, 'Real Stop AIIMS', 1, 28.5672, 77.2100, ST_SetSRID(ST_MakePoint(77.2100, 28.5672), 4326)::geography, '07:15:00', 300
         ) ON CONFLICT (id) DO NOTHING`,
        [realStop1Id, testSchoolId, testRouteId]
      );

      // Stop 2: 30 meters away from Stop 1 (duplicate candidate)
      await db.query(
        `INSERT INTO pickup_locations (
           id, school_id, route_id, stop_name, sequence_order, latitude, longitude, location, scheduled_time, geofence_radius_meters
         ) VALUES (
           $1, $2, $3, 'Real Stop AIIMS Gate 2', 2, 28.5674, 77.2101, ST_SetSRID(ST_MakePoint(77.2101, 28.5674), 4326)::geography, '07:18:00', 300
         ) ON CONFLICT (id) DO NOTHING`,
        [realStop2Id, testSchoolId, testRouteId]
      );

      // 1. Detect duplicates at Stop 1's location
      const dupResult = await DynamicPickupService.detectNearbyOrDuplicateStops({
        latitude: 28.5672,
        longitude: 77.2100,
        schoolId: testSchoolId,
        routeId: testRouteId,
        radiusMeters: 200,
        duplicateThresholdMeters: 50,
      });

      expect(dupResult.hasNearbyDuplicates).toBe(true);
      expect(dupResult.duplicateCount).toBeGreaterThanOrEqual(1);

      // 2. Audit duplicates
      const auditResult = await DynamicPickupService.auditRouteStopDuplicates({
        schoolId: testSchoolId,
        routeId: testRouteId,
        thresholdMeters: 50,
      });

      expect(auditResult.duplicatePairsCount).toBeGreaterThanOrEqual(1);

      // 3. Edit stop
      const editResult = await DynamicPickupService.editPickupStop(realStop1Id, {
        schoolId: testSchoolId,
        stopName: 'AIIMS Main Road Terminal',
        scheduledTime: '07:10:00',
        notifyParents: false,
      });

      expect(editResult.success).toBe(true);
      expect(editResult.stopName).toBe('AIIMS Main Road Terminal');
    });
  });
});
