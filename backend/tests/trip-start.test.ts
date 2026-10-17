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

describe('Phase 16.3: Trip Engine — Trip Start (Start Timestamp, Tracking Session, Real-Time Dispatch)', () => {
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

  describe('1. Start Timestamp Recording & Default Fallback', () => {
    it('starts trip recording server timestamp and transitions to IN_TRANSIT stage', async () => {
      const querySpy = vi.spyOn(db, 'query');
      const publishSpy = vi.spyOn(RealtimeFeedService, 'publish');

      // 1. Fetch current trip state & bus cache
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.SCHEDULED,
          actual_start_time: null,
          actual_end_time: null,
          last_latitude: 12.9716,
          last_longitude: 77.5946,
          last_speed_kmh: 0,
          last_bearing_degrees: 90,
          gps_health_status: 'HEALTHY',
        },
      ] as any);

      // 2. Update trip status
      querySpy.mockResolvedValueOnce([{ id: tripAId }] as any);

      // 3. Activate parent tracking tokens
      querySpy.mockResolvedValueOnce([{ id: 'tok-1' }, { id: 'tok-2' }] as any);

      // 4. Audit log
      querySpy.mockResolvedValueOnce([{ id: 'audit-1' }] as any);

      // 5. getTripById query
      const nowIso = new Date().toISOString();
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
          actual_start_time: nowIso,
          actual_end_time: null,
          current_stop_sequence: 0,
          delay_minutes: 0,
          total_stops: 6,
          is_arrived_school: false,
          arrived_school_time: null,
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/start`)
        .set('Authorization', `Bearer ${driverAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(TripStatus.IN_TRANSIT);
      expect(res.body.data.lifecycleStage).toBe(TripLifecycleStage.STARTED);
      expect(res.body.data.actualStartTime).toBe(nowIso);
      expect(res.body.data.trackingSessionActive).toBe(true);
      expect(res.body.data.activatedTrackingTokens).toBe(2);

      // Verify real-time feed published
      expect(publishSpy).toHaveBeenCalledTimes(1);
      const event = publishSpy.mock.calls[0]?.[0];
      expect(event?.type).toBe('INITIAL_STATE');
      expect(event?.schoolId).toBe(schoolA);
      expect(event?.tripId).toBe(tripAId);
      expect(event?.busId).toBe(busAId);
      expect(event?.latitude).toBe(12.9716);
      expect(event?.longitude).toBe(77.5946);
    });

    it('records explicit client-provided startedAt timestamp', async () => {
      const querySpy = vi.spyOn(db, 'query');
      const publishSpy = vi.spyOn(RealtimeFeedService, 'publish');
      const clientStartedAt = '2026-10-17T07:15:30.000Z';

      // 1. Fetch current trip state
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.SCHEDULED,
          actual_start_time: null,
          actual_end_time: null,
          last_latitude: null,
          last_longitude: null,
          last_speed_kmh: null,
          last_bearing_degrees: null,
          gps_health_status: null,
        },
      ] as any);

      // 2. Update trip status
      querySpy.mockResolvedValueOnce([{ id: tripAId }] as any);

      // 3. Activate parent tracking tokens
      querySpy.mockResolvedValueOnce([] as any);

      // 4. Audit log
      querySpy.mockResolvedValueOnce([{ id: 'audit-2' }] as any);

      // 5. getTripById query
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
          actual_start_time: clientStartedAt,
          actual_end_time: null,
          current_stop_sequence: 0,
          delay_minutes: 0,
          total_stops: 4,
          is_arrived_school: false,
          arrived_school_time: null,
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/start`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ startedAt: clientStartedAt });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actualStartTime).toBe(clientStartedAt);

      // Verify explicit timestamp used in feed
      expect(publishSpy).toHaveBeenCalledTimes(1);
      expect(publishSpy.mock.calls[0]?.[0]?.recordedAt).toBe(clientStartedAt);
    });

    it('rejects invalid startedAt timestamp format with 422 Unprocessable Entity', async () => {
      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/start`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ startedAt: 'not-a-valid-iso-date' });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. State Machine Restrictions on Trip Start', () => {
    it('rejects starting a trip that is already in transit', async () => {
      const querySpy = vi.spyOn(db, 'query');

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
        .set('Authorization', `Bearer ${driverAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      const msg = res.body.error?.message || res.body.message;
      expect(msg).toContain('already started');
    });

    it('rejects starting a trip that is already completed', async () => {
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
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      const msg = res.body.error?.message || res.body.message;
      expect(msg).toContain('already completed');
    });

    it('rejects starting a trip that has been cancelled', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.CANCELLED,
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/start`)
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      const msg = res.body.error?.message || res.body.message;
      expect(msg).toContain('cancelled');
    });
  });

  describe('3. Role & Tenant Isolation Security', () => {
    it('allows school admin to start trip', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.SCHEDULED,
          actual_start_time: null,
          actual_end_time: null,
        },
      ] as any);

      querySpy.mockResolvedValueOnce([{ id: tripAId }] as any);
      querySpy.mockResolvedValueOnce([] as any);
      querySpy.mockResolvedValueOnce([{ id: 'audit-admin' }] as any);
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
          actual_start_time: new Date().toISOString(),
          actual_end_time: null,
          current_stop_sequence: 0,
          delay_minutes: 0,
          total_stops: 5,
          is_arrived_school: false,
          arrived_school_time: null,
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/start`)
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(TripStatus.IN_TRANSIT);
    });

    it('rejects unassigned driver attempting to start trip with 403 Forbidden', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId, // assigned to driverA
          status: TripStatus.SCHEDULED,
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/start`)
        .set('Authorization', `Bearer ${driverBToken}`); // driverB attempts to start

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      const msg = res.body.error?.message || res.body.message;
      expect(msg).toContain('another driver');
    });

    it('rejects cross-tenant trip start with 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/start`)
        .set('Authorization', `Bearer ${adminBToken}`); // School B admin

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });
});
