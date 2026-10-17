import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import * as db from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { UserRole, TripStatus, TripLifecycleStage } from '@school-bus/shared';
import { RealtimeFeedService } from '../src/services/realtime-feed.service.js';
import { TripService } from '../src/services/trip.service.js';

const schoolA = '111e4567-e89b-12d3-a456-426614174001';
const schoolB = '999e4567-e89b-12d3-a456-426614174999';

const adminAId = 'aaa11111-e89b-12d3-a456-426614174001';
const adminBId = 'bbb22222-e89b-12d3-a456-426614174002';
const driverAId = 'ddd11111-e89b-12d3-a456-426614174001';
const driverBId = 'ddd22222-e89b-12d3-a456-426614174002';

const routeAId = '555e4567-e89b-12d3-a456-426614174555';
const busAId = '222e4567-e89b-12d3-a456-426614174222';
const tripAId = '777e4567-e89b-12d3-a456-426614174777';

describe('Phase 16.4: Trip Engine — Trip End (End Timestamp, Stop State, Lock Attendance, Summary)', () => {
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

  describe('1. Trip Completion & End Timestamp Recording', () => {
    it('completes trip, records actual_end_time, detaches tracking session, and writes lock audit', async () => {
      const querySpy = vi.spyOn(db, 'query');
      const publishSpy = vi.spyOn(RealtimeFeedService, 'publish');

      // 1. Fetch current trip state & bus cache
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.IN_TRANSIT,
          actual_start_time: '2026-10-17T07:30:00Z',
          actual_end_time: null,
          last_latitude: 12.9716,
          last_longitude: 77.5946,
          last_speed_kmh: 15,
          last_bearing_degrees: 180,
          gps_health_status: 'HEALTHY',
        },
      ] as any);

      // 2. Update trip status to COMPLETED
      querySpy.mockResolvedValueOnce([{ id: tripAId }] as any);

      // 3. Detach parent tracking tokens
      querySpy.mockResolvedValueOnce([{ id: 'tok-1' }] as any);

      // 4. Audit log: TRIP_COMPLETED
      querySpy.mockResolvedValueOnce([{ id: 'audit-comp' }] as any);

      // 5. Audit log: TRIP_ATTENDANCE_LOCKED
      querySpy.mockResolvedValueOnce([{ id: 'audit-lock' }] as any);

      // 6. getTripById query
      const endTime = '2026-10-17T08:15:00Z';
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
          actual_end_time: endTime,
          current_stop_sequence: 5,
          delay_minutes: 0,
          total_stops: 5,
          is_arrived_school: true,
          arrived_school_time: '2026-10-17T08:10:00Z',
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/complete`)
        .set('Authorization', `Bearer ${driverAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(TripStatus.COMPLETED);
      expect(res.body.data.lifecycleStage).toBe(TripLifecycleStage.COMPLETED);
      expect(res.body.data.actualEndTime).toBe(endTime);
      expect(res.body.data.trackingSessionActive).toBe(false);
      expect(res.body.data.attendanceLocked).toBe(true);

      // Verify real-time broadcast of completion
      expect(publishSpy).toHaveBeenCalledTimes(1);
      const event = publishSpy.mock.calls[0]?.[0];
      expect(event?.schoolId).toBe(schoolA);
      expect(event?.tripId).toBe(tripAId);
      expect(event?.speedKmh).toBe(0);
      expect(event?.healthStatus).toBe('OFFLINE');
    });

    it('supports ending trip via /end alias with explicit client endedAt and summary notes', async () => {
      const querySpy = vi.spyOn(db, 'query');
      const explicitEndedAt = '2026-10-17T08:20:00.000Z';

      // 1. Current trip
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

      // 2. Update trip
      querySpy.mockResolvedValueOnce([{ id: tripAId }] as any);
      // 3. Detach tokens
      querySpy.mockResolvedValueOnce([] as any);
      // 4. Audit TRIP_COMPLETED
      querySpy.mockResolvedValueOnce([{ id: 'audit-comp' }] as any);
      // 5. Audit TRIP_ATTENDANCE_LOCKED
      querySpy.mockResolvedValueOnce([{ id: 'audit-lock' }] as any);
      // 6. getTripById
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
          actual_end_time: explicitEndedAt,
          current_stop_sequence: 5,
          delay_minutes: 0,
          total_stops: 5,
          is_arrived_school: true,
          arrived_school_time: '2026-10-17T08:15:00Z',
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/end`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ endedAt: explicitEndedAt, summaryNotes: 'Smooth morning transit' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actualEndTime).toBe(explicitEndedAt);
    });

    it('rejects invalid endedAt format with 422 Unprocessable Entity', async () => {
      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/complete`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({ endedAt: 'invalid-time-format' });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. State Machine Restrictions on Trip Completion', () => {
    it('rejects completing a trip that has not been started (SCHEDULED)', async () => {
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

    it('rejects completing an already completed trip', async () => {
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
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/complete`)
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      const msg = res.body.error?.message || res.body.message;
      expect(msg).toContain('already completed');
    });

    it('rejects completing a cancelled trip', async () => {
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
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/complete`)
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      const msg = res.body.error?.message || res.body.message;
      expect(msg).toContain('cancelled');
    });
  });

  describe('3. Attendance Locking Behavior', () => {
    it('assertAttendanceNotLocked throws 400 when trip status is COMPLETED', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          status: TripStatus.COMPLETED,
        },
      ] as any);

      await expect(
        TripService.assertAttendanceNotLocked(schoolA, tripAId)
      ).rejects.toThrow('Trip attendance is locked because trip has completed');
    });

    it('assertAttendanceNotLocked succeeds when trip status is IN_TRANSIT', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          status: TripStatus.IN_TRANSIT,
        },
      ] as any);

      await expect(
        TripService.assertAttendanceNotLocked(schoolA, tripAId)
      ).resolves.toBeUndefined();
    });
  });

  describe('4. Operational Summary Generation (GET /trips/:tripId/summary)', () => {
    it('generates full operational trip summary with calculated duration, stops, and attendance', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          trip_id: tripAId,
          school_id: schoolA,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.COMPLETED,
          scheduled_date: '2026-10-17',
          scheduled_start_time: '2026-10-17T07:30:00Z',
          actual_start_time: '2026-10-17T07:30:00Z',
          actual_end_time: '2026-10-17T08:15:00Z',
          current_stop_sequence: 5,
          delay_minutes: 3,
          route_name: 'North Campus Express',
          route_code: 'RT-101',
          bus_number: 'Bus 12',
          registration_number: 'KA-01-AB-1234',
          driver_name: 'Ramesh Kumar',
          driver_phone: '+919876543210',
          total_stops: 5,
          total_expected: 25,
          total_boarded: 23,
          total_deboarded: 23,
          total_absent: 2,
          completed_at: '2026-10-17T08:15:05Z',
        },
      ] as any);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolA}/trips/${tripAId}/summary`)
        .set('Authorization', `Bearer ${adminAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const summary = res.body.data;
      expect(summary.tripId).toBe(tripAId);
      expect(summary.routeName).toBe('North Campus Express');
      expect(summary.busNumber).toBe('Bus 12');
      expect(summary.driverName).toBe('Ramesh Kumar');
      expect(summary.status).toBe(TripStatus.COMPLETED);
      expect(summary.lifecycleStage).toBe(TripLifecycleStage.COMPLETED);
      expect(summary.durationMinutes).toBe(45); // 07:30 to 08:15 = 45 mins
      expect(summary.totalStops).toBe(5);
      expect(summary.stopsCompleted).toBe(5);
      expect(summary.delayMinutes).toBe(3);
      expect(summary.attendanceLocked).toBe(true);
      expect(summary.attendance).toEqual({
        totalExpected: 25,
        totalBoarded: 23,
        totalDeboarded: 23,
        totalAbsent: 2,
      });
      expect(summary.completedAt).toBe('2026-10-17T08:15:05Z');
    });
  });

  describe('5. Role & Tenant Isolation Security', () => {
    it('rejects unassigned driver attempting to complete trip with 403 Forbidden', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId, // assigned to driverA
          status: TripStatus.IN_TRANSIT,
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/complete`)
        .set('Authorization', `Bearer ${driverBToken}`); // driverB attempts to complete

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      const msg = res.body.error?.message || res.body.message;
      expect(msg).toContain('another driver');
    });

    it('rejects cross-tenant trip completion with 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/complete`)
        .set('Authorization', `Bearer ${adminBToken}`); // School B admin

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('rejects cross-tenant trip summary access with 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/v1/schools/${schoolA}/trips/${tripAId}/summary`)
        .set('Authorization', `Bearer ${adminBToken}`); // School B admin

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });
});
