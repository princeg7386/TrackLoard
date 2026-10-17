import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import * as db from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { UserRole, RouteType } from '@school-bus/shared';
import { RouteService } from '../src/services/route.service.js';

const schoolA = '111e4567-e89b-12d3-a456-426614174001';
const schoolB = '999e4567-e89b-12d3-a456-426614174999';

const adminAId = 'aaa11111-e89b-12d3-a456-426614174001';
const adminBId = 'bbb22222-e89b-12d3-a456-426614174002';
const driverAId = 'ddd11111-e89b-12d3-a456-426614174001';

const routeAId = '555e4567-e89b-12d3-a456-426614174555';
const busAId = '222e4567-e89b-12d3-a456-426614174222';
const driverObjId = '333e4567-e89b-12d3-a456-426614174333';
const stop1Id = '666e4567-e89b-12d3-a456-426614174661';
const stop2Id = '666e4567-e89b-12d3-a456-426614174662';

describe('Phase 15.4: Route Management — Route History & Change Tracking', () => {
  let app: any;
  let adminAToken: string;
  let adminBToken: string;
  let driverAToken: string;

  beforeEach(() => {
    app = createApp();

    adminAToken = jwt.sign(
      {
        sub: adminAId,
        id: adminAId,
        schoolId: schoolA,
        role: UserRole.SCHOOL_ADMIN,
      },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    adminBToken = jwt.sign(
      {
        sub: adminBId,
        id: adminBId,
        schoolId: schoolB,
        role: UserRole.SCHOOL_ADMIN,
      },
      env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    driverAToken = jwt.sign(
      {
        sub: driverAId,
        id: driverAId,
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

  describe('1. Track Changes & Audit Trail Recording', () => {
    it('records ROUTE_UPDATED in audit_logs when updating route specifications', async () => {
      const mockCurrent = [
        {
          id: routeAId,
          name: 'Morning Express Route',
          code: 'RTE-MORNING-01',
          route_type: RouteType.MORNING_PICKUP,
          default_bus_id: busAId,
          default_driver_id: driverObjId,
          estimated_duration_minutes: 40,
        },
      ];

      const mockUpdated = [
        {
          id: routeAId,
          school_id: schoolA,
          name: 'Updated Express Route',
          code: 'RTE-MORNING-01-REV',
          route_type: RouteType.MORNING_PICKUP,
          default_bus_id: busAId,
          default_driver_id: driverObjId,
          bus_number: 'BUS-01',
          registration_number: 'DL-01-AB-1234',
          driver_name: 'Rajesh Kumar',
          driver_phone: '+919876543210',
          path_polyline: null,
          estimated_duration_minutes: 50,
          stops_count: 2,
          students_count: 5,
          created_at: '2026-10-17T06:00:00.000Z',
          updated_at: '2026-10-17T08:00:00.000Z',
        },
      ];

      const querySpy = vi.spyOn(db, 'query').mockImplementation(async (sql: string, params?: any[]) => {
        if (sql.includes('LEFT JOIN buses') && sql.includes('WHERE r.id = $1')) {
          return mockUpdated as any;
        }
        if (sql.includes('FROM routes') && sql.includes('WHERE id = $1 AND school_id = $2')) {
          return mockCurrent as any;
        }
        if (sql.includes('SELECT id FROM routes WHERE school_id = $1 AND code = $2 AND id != $3')) {
          return [] as any; // No duplicate code
        }
        if (sql.includes('UPDATE routes SET')) {
          return [] as any;
        }
        if (sql.includes('INSERT INTO audit_logs')) {
          return [] as any;
        }
        return [] as any;
      });

      const res = await request(app)
        .put(`/api/v1/schools/${schoolA}/routes/${routeAId}`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          name: 'Updated Express Route',
          code: 'RTE-MORNING-01-REV',
          estimatedDurationMinutes: 50,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Updated Express Route');
      expect(res.body.data.code).toBe('RTE-MORNING-01-REV');

      // Verify audit_logs insert call
      const auditCalls = querySpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('INSERT INTO audit_logs')
      );
      expect(auditCalls.length).toBe(1);
      const auditParams = auditCalls[0]![1];
      expect(auditParams[0]).toBe(schoolA);
      expect(auditParams[1]).toBe(adminAId);
      expect(auditParams[3]).toBe('ROUTE_UPDATED');
      expect(auditParams[4]).toBe(routeAId);

      const parsedDiff = JSON.parse(auditParams[5]);
      expect(parsedDiff.previousState.name).toBe('Morning Express Route');
      expect(parsedDiff.newState.name).toBe('Updated Express Route');
      expect(parsedDiff.newState.estimatedDurationMinutes).toBe(50);
    });

    it('records ROUTE_STOP_ADDED in audit_logs when adding a stop to a route', async () => {
      const mockRoute = [{ id: routeAId }];
      const mockMax = [{ next_order: 1 }];
      const mockInsertStop = [
        {
          id: stop1Id,
          school_id: schoolA,
          route_id: routeAId,
          stop_name: 'Metro Gate 3',
          sequence_order: 1,
          latitude: 28.5355,
          longitude: 77.241,
          scheduled_time: '07:30:00',
          geofence_radius_meters: 300,
          created_at: '2026-10-17T06:00:00.000Z',
          updated_at: '2026-10-17T06:00:00.000Z',
        },
      ];

      const querySpy = vi.spyOn(db, 'query').mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM routes WHERE id = $1 AND school_id = $2')) {
          return mockRoute as any;
        }
        if (sql.includes('SELECT COALESCE(MAX(sequence_order), 0) + 1 AS next_order')) {
          return mockMax as any;
        }
        if (sql.includes('INSERT INTO pickup_locations')) {
          return mockInsertStop as any;
        }
        if (sql.includes('INSERT INTO audit_logs')) {
          return [] as any;
        }
        return [] as any;
      });

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/routes/${routeAId}/stops`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          stopName: 'Metro Gate 3',
          latitude: 28.5355,
          longitude: 77.241,
          scheduledTime: '07:30:00',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.stopName).toBe('Metro Gate 3');

      const auditCalls = querySpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('INSERT INTO audit_logs')
      );
      expect(auditCalls.length).toBe(1);
      expect(auditCalls[0]![1][3]).toBe('ROUTE_STOP_ADDED');
      const diff = JSON.parse(auditCalls[0]![1][5]);
      expect(diff.newState.stopName).toBe('Metro Gate 3');
      expect(diff.newState.sequenceOrder).toBe(1);
    });

    it('records ROUTE_STOPS_REORDERED in audit_logs when reordering pickup sequence', async () => {
      const mockRoute = [{ id: routeAId }];
      const mockActiveStops = [
        { id: stop1Id, stop_name: 'Metro Gate 3', sequence_order: 1 },
        { id: stop2Id, stop_name: 'City Mall', sequence_order: 2 },
      ];
      const mockReorderedStops = [
        {
          id: stop2Id,
          school_id: schoolA,
          route_id: routeAId,
          stop_name: 'City Mall',
          sequence_order: 1,
          latitude: 28.54,
          longitude: 77.25,
          scheduled_time: '07:25:00',
          geofence_radius_meters: 300,
          assigned_students_count: 0,
          created_at: '2026-10-17T06:00:00.000Z',
          updated_at: '2026-10-17T08:00:00.000Z',
        },
        {
          id: stop1Id,
          school_id: schoolA,
          route_id: routeAId,
          stop_name: 'Metro Gate 3',
          sequence_order: 2,
          latitude: 28.5355,
          longitude: 77.241,
          scheduled_time: '07:35:00',
          geofence_radius_meters: 300,
          assigned_students_count: 0,
          created_at: '2026-10-17T06:00:00.000Z',
          updated_at: '2026-10-17T08:00:00.000Z',
        },
      ];

      const querySpy = vi.spyOn(db, 'query').mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM routes WHERE id = $1 AND school_id = $2')) {
          return mockRoute as any;
        }
        if (sql.includes('SELECT id, stop_name, sequence_order FROM pickup_locations')) {
          return mockActiveStops as any;
        }
        if (sql.includes('UPDATE pickup_locations')) {
          return [] as any;
        }
        if (sql.includes('SELECT pl.id, pl.school_id, pl.route_id, pl.stop_name')) {
          return mockReorderedStops as any;
        }
        if (sql.includes('INSERT INTO audit_logs')) {
          return [] as any;
        }
        return [] as any;
      });

      const res = await request(app)
        .put(`/api/v1/schools/${schoolA}/routes/${routeAId}/stops/reorder`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          stopIds: [stop2Id, stop1Id],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const auditCalls = querySpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('INSERT INTO audit_logs')
      );
      expect(auditCalls.length).toBe(1);
      expect(auditCalls[0]![1][3]).toBe('ROUTE_STOPS_REORDERED');
      const diff = JSON.parse(auditCalls[0]![1][5]);
      expect(diff.previousState.stopOrder[0].id).toBe(stop1Id);
      expect(diff.newState.stopOrder[0].id).toBe(stop2Id);
    });

    it('records ROUTE_STOP_REMOVED in audit_logs when soft-deleting a stop', async () => {
      const mockStop = [
        {
          id: stop1Id,
          stop_name: 'Metro Gate 3',
          sequence_order: 1,
          latitude: 28.5355,
          longitude: 77.241,
          scheduled_time: '07:30:00',
          geofence_radius_meters: 300,
        },
      ];
      const mockNeg = [{ next_neg: 10001 }];
      const mockRemaining = [{ id: stop2Id }];

      const querySpy = vi.spyOn(db, 'query').mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id, stop_name, sequence_order, latitude, longitude') && sql.includes('FROM pickup_locations')) {
          return mockStop as any;
        }
        if (sql.includes('SELECT COALESCE(MAX(ABS(sequence_order)), 10000) + 1 AS next_neg')) {
          return mockNeg as any;
        }
        if (sql.includes('UPDATE pickup_locations SET deleted_at = NOW()')) {
          return [] as any;
        }
        if (sql.includes('SELECT id FROM pickup_locations WHERE route_id = $1 AND school_id = $2 AND deleted_at IS NULL')) {
          return mockRemaining as any;
        }
        if (sql.includes('UPDATE pickup_locations SET sequence_order =')) {
          return [] as any;
        }
        if (sql.includes('INSERT INTO audit_logs')) {
          return [] as any;
        }
        return [] as any;
      });

      const res = await request(app)
        .delete(`/api/v1/schools/${schoolA}/routes/${routeAId}/stops/${stop1Id}`)
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.removedStopId).toBe(stop1Id);

      const auditCalls = querySpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('INSERT INTO audit_logs')
      );
      expect(auditCalls.length).toBe(1);
      expect(auditCalls[0]![1][3]).toBe('ROUTE_STOP_REMOVED');
      const diff = JSON.parse(auditCalls[0]![1][5]);
      expect(diff.previousState.stopId).toBe(stop1Id);
      expect(diff.previousState.stopName).toBe('Metro Gate 3');
      expect(diff.newState).toBeNull();
    });
  });

  describe('2. Show Previous Route State Where Required (Task 2)', () => {
    it('retrieves chronological route history with previous and new state diffs', async () => {
      const mockRouteDetail = [
        {
          id: routeAId,
          school_id: schoolA,
          name: 'Morning Express Route',
          code: 'RTE-MORNING-01',
          route_type: RouteType.MORNING_PICKUP,
          default_bus_id: busAId,
          default_driver_id: driverObjId,
          bus_number: 'BUS-01',
          registration_number: 'DL-01-AB-1234',
          driver_name: 'Rajesh Kumar',
          driver_phone: '+919876543210',
          path_polyline: null,
          estimated_duration_minutes: 45,
          stops_count: 2,
          students_count: 5,
          created_at: '2026-10-17T06:00:00.000Z',
          updated_at: '2026-10-17T08:00:00.000Z',
        },
      ];

      const mockAuditLogs = [
        {
          id: 'aud-333',
          school_id: schoolA,
          user_id: adminAId,
          user_role: 'SCHOOL_ADMIN',
          action: 'ROUTE_UPDATED',
          entity_type: 'ROUTE',
          entity_id: routeAId,
          diff_json: JSON.stringify({
            changeSummary: 'Route specifications updated for "Morning Express Route"',
            previousState: {
              name: 'Old Express Route',
              code: 'RTE-OLD',
              estimatedDurationMinutes: 30,
            },
            newState: {
              name: 'Morning Express Route',
              code: 'RTE-MORNING-01',
              estimatedDurationMinutes: 45,
            },
          }),
          created_at: '2026-10-17T08:00:00.000Z',
          user_name: 'Principal Sharma',
          user_email: 'principal@school.edu',
        },
        {
          id: 'aud-222',
          school_id: schoolA,
          user_id: adminAId,
          user_role: 'SCHOOL_ADMIN',
          action: 'ROUTE_STOP_ADDED',
          entity_type: 'ROUTE',
          entity_id: routeAId,
          diff_json: JSON.stringify({
            changeSummary: 'Added stop "Metro Gate 3" at sequence #1',
            previousState: null,
            newState: {
              stopId: stop1Id,
              stopName: 'Metro Gate 3',
              sequenceOrder: 1,
            },
          }),
          created_at: '2026-10-17T07:00:00.000Z',
          user_name: 'Principal Sharma',
          user_email: 'principal@school.edu',
        },
        {
          id: 'aud-111',
          school_id: schoolA,
          user_id: adminAId,
          user_role: 'SCHOOL_ADMIN',
          action: 'ROUTE_CREATED',
          entity_type: 'ROUTE',
          entity_id: routeAId,
          diff_json: JSON.stringify({
            changeSummary: 'Route "Old Express Route" (RTE-OLD) created',
            previousState: null,
            newState: {
              name: 'Old Express Route',
              code: 'RTE-OLD',
              estimatedDurationMinutes: 30,
            },
          }),
          created_at: '2026-10-17T06:00:00.000Z',
          user_name: 'Principal Sharma',
          user_email: 'principal@school.edu',
        },
      ];

      vi.spyOn(db, 'query').mockImplementation(async (sql: string) => {
        if (sql.includes('FROM routes r') && sql.includes('WHERE r.id = $1 AND r.school_id = $2')) {
          return mockRouteDetail as any;
        }
        if (sql.includes('FROM audit_logs al') && sql.includes('al.entity_type = \'ROUTE\'')) {
          return mockAuditLogs as any;
        }
        return [] as any;
      });

      const res = await request(app)
        .get(`/api/v1/schools/${schoolA}/routes/${routeAId}/history`)
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.route.id).toBe(routeAId);
      expect(res.body.data.totalChanges).toBe(3);
      expect(res.body.data.history).toHaveLength(3);

      const latestUpdate = res.body.data.history[0];
      expect(latestUpdate.action).toBe('ROUTE_UPDATED');
      expect(latestUpdate.userName).toBe('Principal Sharma');
      expect(latestUpdate.previousState).toBeDefined();
      expect(latestUpdate.previousState.name).toBe('Old Express Route');
      expect(latestUpdate.newState.name).toBe('Morning Express Route');

      const stopAdded = res.body.data.history[1];
      expect(stopAdded.action).toBe('ROUTE_STOP_ADDED');
      expect(stopAdded.previousState).toBeNull();
      expect(stopAdded.newState.stopName).toBe('Metro Gate 3');
    });
  });

  describe('3. Multi-Tenant Authorization & Security', () => {
    it('rejects cross-tenant route update with 403 Forbidden', async () => {
      const res = await request(app)
        .put(`/api/v1/schools/${schoolA}/routes/${routeAId}`)
        .set('Authorization', `Bearer ${adminBToken}`) // Admin B calling School A
        .send({
          name: 'Cross Tenant Hack',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('rejects cross-tenant route history access with 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/v1/schools/${schoolA}/routes/${routeAId}/history`)
        .set('Authorization', `Bearer ${adminBToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('rejects driver token from accessing route history with 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/v1/schools/${schoolA}/routes/${routeAId}/history`)
        .set('Authorization', `Bearer ${driverAToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('rejects unauthenticated request with 401 Unauthorized', async () => {
      const res = await request(app)
        .get(`/api/v1/schools/${schoolA}/routes/${routeAId}/history`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('4. Real-DB Route History & Audit Verification', () => {
    it('persists audit logs on live PostgreSQL and verifies previous/new state diffs', async () => {
      let isDbUp = false;
      try {
        const check = await db.query<{ reg: string }>("SELECT to_regclass('audit_logs') as reg");
        isDbUp = Boolean(check.length > 0 && check[0]?.reg);
      } catch {
        isDbUp = false;
      }

      if (!isDbUp) {
        return; // Mocked environment, pass
      }

      const testSchoolId = '111e4567-e89b-12d3-a456-426614174001';
      const testRouteCode = `RTE-HIST-${Date.now().toString().slice(-4)}`;

      // Seed school
      await db.query(
        `INSERT INTO schools (id, name, code, city, state)
         VALUES ($1, 'Delhi Public School R.K. Puram', 'DPS-RKP', 'New Delhi', 'Delhi')
         ON CONFLICT (id) DO NOTHING`,
        [testSchoolId]
      );

      // 1. Create Route
      const created = await RouteService.createRoute(
        testSchoolId,
        {
          name: 'History Integration Route',
          code: testRouteCode,
          routeType: RouteType.MORNING_PICKUP,
          estimatedDurationMinutes: 40,
        },
        testSchoolId,
        adminAId,
        UserRole.SCHOOL_ADMIN
      );

      expect(created.id).toBeDefined();

      // 2. Update Route specifications
      const updated = await RouteService.updateRoute(
        testSchoolId,
        created.id,
        {
          name: 'History Integration Route (Updated)',
          estimatedDurationMinutes: 55,
        },
        testSchoolId,
        adminAId,
        UserRole.SCHOOL_ADMIN
      );

      expect(updated.name).toBe('History Integration Route (Updated)');
      expect(updated.estimatedDurationMinutes).toBe(55);

      // 3. Add a stop
      const stop = await RouteService.addRouteStop(
        testSchoolId,
        created.id,
        {
          stopName: 'Audit Stop Alpha',
          latitude: 28.5355,
          longitude: 77.241,
          scheduledTime: '07:30:00',
        },
        testSchoolId,
        adminAId,
        UserRole.SCHOOL_ADMIN
      );

      expect(stop.id).toBeDefined();

      // 4. Update the stop
      await RouteService.updateRouteStop(
        testSchoolId,
        created.id,
        stop.id,
        {
          stopName: 'Audit Stop Alpha (Modified)',
          geofenceRadiusMeters: 450,
        },
        testSchoolId,
        adminAId,
        UserRole.SCHOOL_ADMIN
      );

      // 5. Query Route History
      const historyRes = await RouteService.getRouteHistory(testSchoolId, created.id, testSchoolId);

      expect(historyRes.route.id).toBe(created.id);
      expect(historyRes.totalChanges).toBeGreaterThanOrEqual(4);

      // Verify audit entries are present
      const actions = historyRes.history.map((h) => h.action);
      expect(actions).toContain('ROUTE_CREATED');
      expect(actions).toContain('ROUTE_UPDATED');
      expect(actions).toContain('ROUTE_STOP_ADDED');
      expect(actions).toContain('ROUTE_STOP_UPDATED');

      // Verify diff in ROUTE_UPDATED
      const updateLog = historyRes.history.find((h) => h.action === 'ROUTE_UPDATED');
      expect(updateLog).toBeDefined();
      expect(updateLog?.previousState?.name).toBe('History Integration Route');
      expect(updateLog?.previousState?.estimatedDurationMinutes).toBe(40);
      expect(updateLog?.newState?.name).toBe('History Integration Route (Updated)');
      expect(updateLog?.newState?.estimatedDurationMinutes).toBe(55);
    });
  });
});
