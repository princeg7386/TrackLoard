import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import * as db from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { UserRole, TripStatus, TripLifecycleStage } from '@school-bus/shared';
import { RealtimeFeedService } from '../src/services/realtime-feed.service.js';

const schoolA = '111e4567-e89b-12d3-a456-426614174001';
const schoolB = '999e4567-e89b-12d3-a456-426614174999';

const adminAId = 'aaa11111-e89b-12d3-a456-426614174001';
const adminBId = 'bbb22222-e89b-12d3-a456-426614174002';
const driverAId = 'ddd11111-e89b-12d3-a456-426614174001';
const driverBId = 'ddd22222-e89b-12d3-a456-426614174002';

const routeAId = '555e4567-e89b-12d3-a456-426614174555';
const busAId = '222e4567-e89b-12d3-a456-426614174222';
const tripAId = '777e4567-e89b-12d3-a456-426614174777';

describe('Phase 16.5: Trip Engine — Idempotency & Safe Retry Handling', () => {
  let app: any;
  let adminAToken: string;
  let adminBToken: string;
  let driverAToken: string;
  let driverBToken: string;

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

    driverBToken = jwt.sign(
      {
        sub: driverBId,
        id: driverBId,
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

  describe('1. Prevent Duplicate Starts & Safe Retries', () => {
    it('returns HTTP 200 idempotently when starting an already started trip without duplicate queries or audit logs', async () => {
      const querySpy = vi.spyOn(db, 'query');
      const publishSpy = vi.spyOn(RealtimeFeedService, 'publish');

      // 1. Current trip query returns already IN_TRANSIT
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.IN_TRANSIT,
          actual_start_time: '2026-10-17T07:32:00Z',
          actual_end_time: null,
          last_latitude: 12.9716,
          last_longitude: 77.5946,
          last_speed_kmh: 25,
          last_bearing_degrees: 180,
          gps_health_status: 'HEALTHY',
        },
      ] as any);

      // 2. getTripById query
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.IN_TRANSIT,
          scheduled_date: '2026-10-17',
          scheduled_start_time: '2026-10-17T07:30:00Z',
          actual_start_time: '2026-10-17T07:32:00Z',
          actual_end_time: null,
          current_stop_sequence: 1,
          delay_minutes: 0,
          total_stops: 5,
          is_arrived_school: false,
          arrived_school_time: null,
          route_name: 'North Campus Express',
          route_code: 'R-101',
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
          driver_name: 'Rajesh Driver',
          driver_phone: '+919876543210',
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/start`)
        .set('Authorization', `Bearer ${driverAToken}`)
        .set('Idempotency-Key', 'retry-start-key-001')
        .send({ idempotencyKey: 'retry-start-key-001' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(tripAId);
      expect(res.body.data.status).toBe(TripStatus.IN_TRANSIT);
      expect(res.body.data.trackingSessionActive).toBe(true);
      expect(res.body.data.actualStartTime).toBe('2026-10-17T07:32:00Z');

      // Verify no duplicate UPDATE trips or token updates or feed broadcasts executed
      expect(publishSpy).not.toHaveBeenCalled();
      const executedSqls = querySpy.mock.calls.map((c) => String(c[0]));
      const updateTripsCalls = executedSqls.filter((s) => s.includes('UPDATE trips'));
      const updateTokensCalls = executedSqls.filter((s) => s.includes('UPDATE parent_tracking_tokens'));
      const insertAuditCalls = executedSqls.filter((s) => s.includes('INSERT INTO audit_logs'));

      expect(updateTripsCalls.length).toBe(0);
      expect(updateTokensCalls.length).toBe(0);
      expect(insertAuditCalls.length).toBe(0);
    });

    it('handles idempotent start retry with X-Idempotency-Key header', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.IN_TRANSIT,
          actual_start_time: '2026-10-17T07:30:00Z',
          actual_end_time: null,
          last_latitude: null,
          last_longitude: null,
          last_speed_kmh: null,
          last_bearing_degrees: null,
          gps_health_status: null,
        },
      ] as any);

      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.IN_TRANSIT,
          scheduled_date: '2026-10-17',
          scheduled_start_time: '2026-10-17T07:30:00Z',
          actual_start_time: '2026-10-17T07:30:00Z',
          actual_end_time: null,
          current_stop_sequence: 0,
          delay_minutes: 0,
          total_stops: 3,
          is_arrived_school: false,
          arrived_school_time: null,
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/start`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .set('X-Idempotency-Key', 'x-custom-key-123');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.trackingSessionActive).toBe(true);
    });

    it('rejects starting a completed trip even with retry key', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.COMPLETED,
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/start`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .set('Idempotency-Key', 'invalid-retry-on-completed');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      const msg = res.body.error?.message || res.body.message;
      expect(msg).toContain('already completed');
    });
  });

  describe('2. Prevent Duplicate Ends & Safe Retries', () => {
    it('returns HTTP 200 idempotently when completing an already completed trip without duplicate side effects', async () => {
      const querySpy = vi.spyOn(db, 'query');
      const publishSpy = vi.spyOn(RealtimeFeedService, 'publish');

      // 1. Current trip query returns already COMPLETED
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.COMPLETED,
          actual_start_time: '2026-10-17T07:30:00Z',
          actual_end_time: '2026-10-17T08:20:00Z',
          last_latitude: 12.9716,
          last_longitude: 77.5946,
          last_speed_kmh: 0,
          last_bearing_degrees: 0,
          gps_health_status: 'OFFLINE',
        },
      ] as any);

      // 2. getTripById query
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.COMPLETED,
          scheduled_date: '2026-10-17',
          scheduled_start_time: '2026-10-17T07:30:00Z',
          actual_start_time: '2026-10-17T07:30:00Z',
          actual_end_time: '2026-10-17T08:20:00Z',
          current_stop_sequence: 5,
          delay_minutes: 0,
          total_stops: 5,
          is_arrived_school: true,
          arrived_school_time: '2026-10-17T08:15:00Z',
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/complete`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .set('Idempotency-Key', 'retry-complete-key-002')
        .send({ summaryNotes: 'Repeated end call' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(tripAId);
      expect(res.body.data.status).toBe(TripStatus.COMPLETED);
      expect(res.body.data.attendanceLocked).toBe(true);
      expect(res.body.data.trackingSessionActive).toBe(false);

      // Verify no duplicate UPDATE trips or token detachment or feed events executed
      expect(publishSpy).not.toHaveBeenCalled();
      const executedSqls = querySpy.mock.calls.map((c) => String(c[0]));
      const updateTripsCalls = executedSqls.filter((s) => s.includes('UPDATE trips'));
      const updateTokensCalls = executedSqls.filter((s) => s.includes('UPDATE parent_tracking_tokens'));
      const insertAuditCalls = executedSqls.filter((s) => s.includes('INSERT INTO audit_logs'));

      expect(updateTripsCalls.length).toBe(0);
      expect(updateTokensCalls.length).toBe(0);
      expect(insertAuditCalls.length).toBe(0);
    });

    it('supports /end alias endpoint with idempotent completion retry', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.COMPLETED,
          actual_start_time: '2026-10-17T07:30:00Z',
          actual_end_time: '2026-10-17T08:20:00Z',
          last_latitude: null,
          last_longitude: null,
          last_speed_kmh: null,
          last_bearing_degrees: null,
          gps_health_status: null,
        },
      ] as any);

      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.COMPLETED,
          scheduled_date: '2026-10-17',
          scheduled_start_time: '2026-10-17T07:30:00Z',
          actual_start_time: '2026-10-17T07:30:00Z',
          actual_end_time: '2026-10-17T08:20:00Z',
          current_stop_sequence: 5,
          delay_minutes: 0,
          total_stops: 5,
          is_arrived_school: true,
          arrived_school_time: '2026-10-17T08:15:00Z',
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/end`)
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(TripStatus.COMPLETED);
      expect(res.body.data.attendanceLocked).toBe(true);
    });

    it('rejects completing a trip that has not been started', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.SCHEDULED,
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/complete`)
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      const msg = res.body.error?.message || res.body.message;
      expect(msg).toContain('not been started');
    });
  });

  describe('3. Idempotent Progress & School Arrival Milestones', () => {
    it('short-circuits progress update when sequence and delay match current state', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // Current trip has sequence 2, delay 5
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          driver_id: driverAId,
          status: TripStatus.IN_TRANSIT,
          current_stop_sequence: 2,
          delay_minutes: 5,
        },
      ] as any);

      // getTripById query
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.IN_TRANSIT,
          scheduled_date: '2026-10-17',
          scheduled_start_time: '2026-10-17T07:30:00Z',
          actual_start_time: '2026-10-17T07:30:00Z',
          actual_end_time: null,
          current_stop_sequence: 2,
          delay_minutes: 5,
          total_stops: 5,
          is_arrived_school: false,
          arrived_school_time: null,
        },
      ] as any);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolA}/trips/${tripAId}/progress`)
        .set('Authorization', `Bearer ${driverAToken}`)
        .send({ currentStopSequence: 2, delayMinutes: 5 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.currentStopSequence).toBe(2);

      // Verify no UPDATE trips or INSERT audit_logs were executed
      const executedSqls = querySpy.mock.calls.map((c) => String(c[0]));
      const updateCalls = executedSqls.filter((s) => s.includes('UPDATE trips'));
      const auditCalls = executedSqls.filter((s) => s.includes('INSERT INTO audit_logs'));
      expect(updateCalls.length).toBe(0);
      expect(auditCalls.length).toBe(0);
    });

    it('short-circuits arrival at school when arrival was already recorded', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Current trip is IN_TRANSIT
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          driver_id: driverAId,
          status: TripStatus.IN_TRANSIT,
          current_stop_sequence: 4,
        },
      ] as any);

      // 2. Existing arrival audit log check returns 1 row
      querySpy.mockResolvedValueOnce([
        {
          id: 'audit-log-existing-arrival-id',
        },
      ] as any);

      // 3. getTripById query
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.IN_TRANSIT,
          scheduled_date: '2026-10-17',
          scheduled_start_time: '2026-10-17T07:30:00Z',
          actual_start_time: '2026-10-17T07:30:00Z',
          actual_end_time: null,
          current_stop_sequence: 4,
          delay_minutes: 0,
          total_stops: 4,
          is_arrived_school: true,
          arrived_school_time: '2026-10-17T08:05:00Z',
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/arrive-school`)
        .set('Authorization', `Bearer ${driverAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.lifecycleStage).toBe(TripLifecycleStage.ARRIVED_SCHOOL);

      // Verify no duplicate audit log was inserted
      const executedSqls = querySpy.mock.calls.map((c) => String(c[0]));
      const auditInserts = executedSqls.filter((s) => s.includes('INSERT INTO audit_logs'));
      expect(auditInserts.length).toBe(0);
    });
  });

  describe('4. Security & Tenant Boundaries on Retries', () => {
    it('strictly enforces multi-tenant isolation even on idempotent retries (403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/start`)
        .set('Authorization', `Bearer ${adminBToken}`)
        .set('Idempotency-Key', 'cross-tenant-retry-key');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('strictly blocks unauthorized driver from starting another driver trip even on retries', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // Trip belongs to driverA, but driverB calls start
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.IN_TRANSIT,
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/start`)
        .set('Authorization', `Bearer ${driverBToken}`)
        .set('Idempotency-Key', 'unauthorized-driver-key');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      const msg = res.body.error?.message || res.body.message;
      expect(msg).toContain('not authorized');
    });

    it('strictly blocks unauthorized driver from completing another driver trip even on retries', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // Trip belongs to driverA, but driverB calls complete
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.COMPLETED,
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/complete`)
        .set('Authorization', `Bearer ${driverBToken}`)
        .set('Idempotency-Key', 'unauthorized-driver-complete-key');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      const msg = res.body.error?.message || res.body.message;
      expect(msg).toContain('not authorized');
    });
  });
});
