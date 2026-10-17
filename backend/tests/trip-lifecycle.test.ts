import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import * as db from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { UserRole, TripStatus, TripLifecycleStage } from '@school-bus/shared';
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

describe('Phase 16.1: Trip Engine — Trip Lifecycle State Machine', () => {
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

  describe('1. Lifecycle Stage Computation Unit Logic', () => {
    it('computes NOT_STARTED when scheduled with no start time', () => {
      const stage = TripService.computeLifecycleStage({
        status: TripStatus.SCHEDULED,
        actualStartTime: null,
      });
      expect(stage).toBe(TripLifecycleStage.NOT_STARTED);
    });

    it('computes STARTED when in transit with actualStartTime and currentStopSequence = 0', () => {
      const stage = TripService.computeLifecycleStage({
        status: TripStatus.IN_TRANSIT,
        actualStartTime: new Date(),
        currentStopSequence: 0,
      });
      expect(stage).toBe(TripLifecycleStage.STARTED);
    });

    it('computes IN_TRANSIT when in transit with stop sequence > 0', () => {
      const stage = TripService.computeLifecycleStage({
        status: TripStatus.IN_TRANSIT,
        actualStartTime: new Date(),
        currentStopSequence: 2,
      });
      expect(stage).toBe(TripLifecycleStage.IN_TRANSIT);
    });

    it('computes ARRIVED_SCHOOL when marked as arrived school while in transit', () => {
      const stage = TripService.computeLifecycleStage({
        status: TripStatus.IN_TRANSIT,
        actualStartTime: new Date(),
        currentStopSequence: 5,
        isArrivedSchool: true,
      });
      expect(stage).toBe(TripLifecycleStage.ARRIVED_SCHOOL);
    });

    it('computes COMPLETED when trip status is COMPLETED', () => {
      const stage = TripService.computeLifecycleStage({
        status: TripStatus.COMPLETED,
        actualStartTime: new Date(Date.now() - 3600000),
        actualEndTime: new Date(),
      });
      expect(stage).toBe(TripLifecycleStage.COMPLETED);
    });
  });

  describe('2. POST /api/v1/schools/:schoolId/trips (Trip Scheduling - NOT_STARTED)', () => {
    it('schedules a new trip and returns NOT_STARTED lifecycle stage', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. School validation
      querySpy.mockResolvedValueOnce([{ id: schoolA }] as any);
      // 2. Route validation
      querySpy.mockResolvedValueOnce([
        { id: routeAId, name: 'Morning North Route', code: 'RTE-NORTH-01' },
      ] as any);
      // 3. Bus validation
      querySpy.mockResolvedValueOnce([
        { id: busAId, bus_number: 'BUS-101', registration_number: 'DL01AB1234' },
      ] as any);
      // 4. Driver validation
      querySpy.mockResolvedValueOnce([
        { id: driverAId, full_name: 'Rajesh Kumar', phone: '+919876543210' },
      ] as any);
      // 5. Insert trip RETURNING ...
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.SCHEDULED,
          scheduled_date: '2026-10-17',
          scheduled_start_time: '2026-10-17T07:30:00Z',
          actual_start_time: null,
          actual_end_time: null,
          current_stop_sequence: 0,
          delay_minutes: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ] as any);
      // 6. Insert audit log
      querySpy.mockResolvedValueOnce([{ id: 'audit-1' }] as any);
      // 7. getTripById query
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          route_id: routeAId,
          route_name: 'Morning North Route',
          route_code: 'RTE-NORTH-01',
          bus_id: busAId,
          bus_number: 'BUS-101',
          registration_number: 'DL01AB1234',
          driver_id: driverAId,
          driver_name: 'Rajesh Kumar',
          driver_phone: '+919876543210',
          status: TripStatus.SCHEDULED,
          scheduled_date: '2026-10-17',
          scheduled_start_time: '2026-10-17T07:30:00Z',
          actual_start_time: null,
          actual_end_time: null,
          current_stop_sequence: 0,
          delay_minutes: 0,
          total_stops: 5,
          is_arrived_school: false,
          arrived_school_time: null,
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          routeId: routeAId,
          busId: busAId,
          driverId: driverAId,
          scheduledStartTime: '2026-10-17T07:30:00Z',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(tripAId);
      expect(res.body.data.status).toBe(TripStatus.SCHEDULED);
      expect(res.body.data.lifecycleStage).toBe(TripLifecycleStage.NOT_STARTED);
    });

    it('rejects scheduling if driver belongs to a different school', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([{ id: schoolA }] as any); // school ok
      querySpy.mockResolvedValueOnce([{ id: routeAId, name: 'Route', code: 'R1' }] as any); // route ok
      querySpy.mockResolvedValueOnce([{ id: busAId, bus_number: 'B1', registration_number: 'DL1' }] as any); // bus ok
      querySpy.mockResolvedValueOnce([] as any); // driver not found in school

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          routeId: routeAId,
          busId: busAId,
          driverId: driverAId,
          scheduledStartTime: '2026-10-17T07:30:00Z',
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      const msg = res.body.error?.message || res.body.message;
      expect(msg).toContain('Driver');
    });
  });

  describe('3. POST /api/v1/schools/:schoolId/trips/:tripId/start (Transition to STARTED)', () => {
    it('starts trip and transitions to STARTED stage', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Fetch current trip state
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          driver_id: driverAId,
          bus_id: busAId,
          status: TripStatus.SCHEDULED,
          actual_start_time: null,
          current_stop_sequence: 0,
        },
      ] as any);

      // 2. Update trip to IN_TRANSIT
      querySpy.mockResolvedValueOnce([{ id: tripAId }] as any);

      // 3. Audit log
      querySpy.mockResolvedValueOnce([{ id: 'audit-start' }] as any);

      // 4. getTripById query
      const startTime = new Date().toISOString();
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
          actual_start_time: startTime,
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
        .set('Authorization', `Bearer ${driverAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(TripStatus.IN_TRANSIT);
      expect(res.body.data.lifecycleStage).toBe(TripLifecycleStage.STARTED);
    });

    it('rejects start if unassigned driver attempts to start trip', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          driver_id: driverAId, // assigned to driverA
          bus_id: busAId,
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

    it('rejects start if trip is already COMPLETED', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          driver_id: driverAId,
          bus_id: busAId,
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
  });

  describe('4. PUT /api/v1/schools/:schoolId/trips/:tripId/progress (Transition to IN_TRANSIT)', () => {
    it('updates stop sequence and transitions to IN_TRANSIT stage', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Fetch current trip
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          driver_id: driverAId,
          status: TripStatus.IN_TRANSIT,
          current_stop_sequence: 1,
          delay_minutes: 0,
        },
      ] as any);

      // 2. Update progress
      querySpy.mockResolvedValueOnce([{ id: tripAId }] as any);
      // 3. Audit log
      querySpy.mockResolvedValueOnce([{ id: 'audit-prog' }] as any);

      // 4. getTripById
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
        .send({
          currentStopSequence: 2,
          delayMinutes: 5,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.currentStopSequence).toBe(2);
      expect(res.body.data.delayMinutes).toBe(5);
      expect(res.body.data.lifecycleStage).toBe(TripLifecycleStage.IN_TRANSIT);
    });

    it('rejects progress update on a NOT_STARTED trip', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          driver_id: driverAId,
          status: TripStatus.SCHEDULED,
          current_stop_sequence: 0,
          delay_minutes: 0,
        },
      ] as any);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolA}/trips/${tripAId}/progress`)
        .set('Authorization', `Bearer ${driverAToken}`)
        .send({
          currentStopSequence: 1,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      const msg = res.body.error?.message || res.body.message;
      expect(msg).toContain('SCHEDULED');
    });
  });

  describe('5. POST /api/v1/schools/:schoolId/trips/:tripId/arrive-school (ARRIVED_SCHOOL)', () => {
    it('records arrival at school and returns ARRIVED_SCHOOL stage', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Fetch current trip
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          driver_id: driverAId,
          status: TripStatus.IN_TRANSIT,
        },
      ] as any);

      // 2. Audit log
      querySpy.mockResolvedValueOnce([{ id: 'audit-arrive' }] as any);

      const arrivalTime = new Date().toISOString();
      // 3. getTripById
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
          current_stop_sequence: 5,
          delay_minutes: 0,
          total_stops: 5,
          is_arrived_school: true,
          arrived_school_time: arrivalTime,
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/arrive-school`)
        .set('Authorization', `Bearer ${driverAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.lifecycleStage).toBe(TripLifecycleStage.ARRIVED_SCHOOL);
      expect(res.body.data.arrivedSchoolTime).toBe(arrivalTime);
    });
  });

  describe('6. POST /api/v1/schools/:schoolId/trips/:tripId/complete (COMPLETED)', () => {
    it('completes trip, records actual_end_time, and returns COMPLETED stage', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Fetch current trip
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          driver_id: driverAId,
          status: TripStatus.IN_TRANSIT,
          actual_start_time: new Date(),
        },
      ] as any);

      // 2. Update trip to COMPLETED
      querySpy.mockResolvedValueOnce([{ id: tripAId }] as any);
      // 3. Audit log
      querySpy.mockResolvedValueOnce([{ id: 'audit-complete' }] as any);

      const endTime = new Date().toISOString();
      // 4. getTripById
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
          actual_start_time: new Date(Date.now() - 1800000).toISOString(),
          actual_end_time: endTime,
          current_stop_sequence: 5,
          delay_minutes: 0,
          total_stops: 5,
          is_arrived_school: true,
          arrived_school_time: endTime,
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
    });

    it('rejects complete on a trip that was never started (SCHEDULED)', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          driver_id: driverAId,
          status: TripStatus.SCHEDULED,
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/complete`)
        .set('Authorization', `Bearer ${driverAToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      const msg = res.body.error?.message || res.body.message;
      expect(msg).toContain('not been started');
    });
  });

  describe('7. POST /api/v1/schools/:schoolId/trips/:tripId/cancel (Trip Cancellation)', () => {
    it('cancels trip with reason and writes audit log', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Fetch current trip
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          status: TripStatus.SCHEDULED,
        },
      ] as any);

      // 2. Update query
      querySpy.mockResolvedValueOnce([{ id: tripAId }] as any);
      // 3. Audit log
      querySpy.mockResolvedValueOnce([{ id: 'audit-cancel' }] as any);

      // 4. getTripById
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.CANCELLED,
          scheduled_date: '2026-10-17',
          scheduled_start_time: '2026-10-17T07:30:00Z',
          actual_start_time: null,
          actual_end_time: null,
          current_stop_sequence: 0,
          delay_minutes: 0,
          is_arrived_school: false,
          arrived_school_time: null,
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/cancel`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          reason: 'Severe weather condition / heavy rain',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(TripStatus.CANCELLED);
    });

    it('rejects cancellation on an already COMPLETED trip', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          status: TripStatus.COMPLETED,
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/${tripAId}/cancel`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          reason: 'Attempt cancel after completion',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      const msg = res.body.error?.message || res.body.message;
      expect(msg).toContain('Cannot cancel an already completed trip');
    });
  });

  describe('8. Tenant Isolation & Security Boundary', () => {
    it('rejects School B admin accessing School A trip endpoints with 403 Forbidden', async () => {
      const res = await request(app)
        .get(`/api/v1/schools/${schoolA}/trips`)
        .set('Authorization', `Bearer ${adminBToken}`); // School B token calling School A URL

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('rejects unauthenticated request with 401 Unauthorized', async () => {
      const res = await request(app).get(`/api/v1/schools/${schoolA}/trips`);
      expect(res.status).toBe(401);
    });
  });
});
