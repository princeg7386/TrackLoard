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

const routeAId = '555e4567-e89b-12d3-a456-426614174555';
const busAId = '222e4567-e89b-12d3-a456-426614174222';
const tripAId = '777e4567-e89b-12d3-a456-426614174777';

describe('Phase 16.2: Trip Engine — Trip Creation (Today Trip, Attach Bus, Driver, Route)', () => {
  let app: any;
  let adminAToken: string;
  let adminBToken: string;

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. POST /api/v1/schools/:schoolId/trips/today (Create Today\'s Trip)', () => {
    it('creates today\'s trip with attached route, bus, and driver', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. School check
      querySpy.mockResolvedValueOnce([{ id: schoolA }] as any);
      // 2. Route check
      querySpy.mockResolvedValueOnce([
        { id: routeAId, name: 'North Line', code: 'RTE-N1', default_bus_id: busAId, default_driver_id: driverAId },
      ] as any);
      // 3. Bus check
      querySpy.mockResolvedValueOnce([
        { id: busAId, bus_number: 'BUS-101', registration_number: 'DL01AB1234' },
      ] as any);
      // 4. Driver check
      querySpy.mockResolvedValueOnce([
        { id: driverAId, full_name: 'Rajesh Kumar', phone: '+919876543210' },
      ] as any);
      // 5. Active bus check
      querySpy.mockResolvedValueOnce([] as any);
      // 6. Active driver check
      querySpy.mockResolvedValueOnce([] as any);
      // 7. Duplicate check
      querySpy.mockResolvedValueOnce([] as any);
      // 8. Insert trip RETURNING ...
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.SCHEDULED,
          scheduled_date: today,
          scheduled_start_time: `${today}T07:30:00Z`,
          actual_start_time: null,
          actual_end_time: null,
          current_stop_sequence: 0,
          delay_minutes: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ] as any);
      // 9. Audit log
      querySpy.mockResolvedValueOnce([{ id: 'audit-today' }] as any);
      // 10. getTripById query
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          route_id: routeAId,
          route_name: 'North Line',
          route_code: 'RTE-N1',
          bus_id: busAId,
          bus_number: 'BUS-101',
          registration_number: 'DL01AB1234',
          driver_id: driverAId,
          driver_name: 'Rajesh Kumar',
          driver_phone: '+919876543210',
          status: TripStatus.SCHEDULED,
          scheduled_date: today,
          scheduled_start_time: `${today}T07:30:00Z`,
          actual_start_time: null,
          actual_end_time: null,
          current_stop_sequence: 0,
          delay_minutes: 0,
          total_stops: 8,
          is_arrived_school: false,
          arrived_school_time: null,
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/today`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          routeId: routeAId,
          busId: busAId,
          driverId: driverAId,
          scheduledStartTime: '07:30',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(tripAId);
      expect(res.body.data.scheduledDate).toBe(today);
      expect(res.body.data.lifecycleStage).toBe(TripLifecycleStage.NOT_STARTED);
    });

    it('creates today\'s trip inheriting default bus and driver attached to route when omitted in request', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. School check
      querySpy.mockResolvedValueOnce([{ id: schoolA }] as any);
      // 2. Route check (provides default_bus_id and default_driver_id)
      querySpy.mockResolvedValueOnce([
        { id: routeAId, name: 'North Line', code: 'RTE-N1', default_bus_id: busAId, default_driver_id: driverAId },
      ] as any);
      // 3. Bus check (auto-resolved from route)
      querySpy.mockResolvedValueOnce([
        { id: busAId, bus_number: 'BUS-101', registration_number: 'DL01AB1234' },
      ] as any);
      // 4. Driver check (auto-resolved from route)
      querySpy.mockResolvedValueOnce([
        { id: driverAId, full_name: 'Rajesh Kumar', phone: '+919876543210' },
      ] as any);
      // 5. Active bus check
      querySpy.mockResolvedValueOnce([] as any);
      // 6. Active driver check
      querySpy.mockResolvedValueOnce([] as any);
      // 7. Duplicate check
      querySpy.mockResolvedValueOnce([] as any);
      // 8. Insert trip
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.SCHEDULED,
          scheduled_date: today,
          scheduled_start_time: `${today}T07:30:00Z`,
          actual_start_time: null,
          actual_end_time: null,
          current_stop_sequence: 0,
          delay_minutes: 0,
        },
      ] as any);
      // 9. Audit log
      querySpy.mockResolvedValueOnce([{ id: 'audit-inherit' }] as any);
      // 10. getTripById
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.SCHEDULED,
          scheduled_date: today,
          scheduled_start_time: `${today}T07:30:00Z`,
          current_stop_sequence: 0,
          delay_minutes: 0,
          is_arrived_school: false,
        },
      ] as any);

      // Note: busId and driverId omitted in request payload
      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/today`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          routeId: routeAId,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.busId).toBe(busAId);
      expect(res.body.data.driverId).toBe(driverAId);
    });
  });

  describe('2. Safety & Conflict Checks (Bus and Driver Attachment)', () => {
    it('rejects trip creation if attached bus is currently IN_TRANSIT on another trip', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. School check
      querySpy.mockResolvedValueOnce([{ id: schoolA }] as any);
      // 2. Route check
      querySpy.mockResolvedValueOnce([
        { id: routeAId, name: 'North Line', code: 'RTE-N1', default_bus_id: busAId, default_driver_id: driverAId },
      ] as any);
      // 3. Bus check
      querySpy.mockResolvedValueOnce([
        { id: busAId, bus_number: 'BUS-101', registration_number: 'DL01AB1234' },
      ] as any);
      // 4. Driver check
      querySpy.mockResolvedValueOnce([
        { id: driverAId, full_name: 'Rajesh Kumar', phone: '+919876543210' },
      ] as any);
      // 5. Active bus check -> bus is currently running!
      querySpy.mockResolvedValueOnce([{ id: 'running-trip-bus' }] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/today`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          routeId: routeAId,
          busId: busAId,
          driverId: driverAId,
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      const msg = res.body.error?.message || res.body.message;
      expect(msg).toContain('Bus is currently in transit');
    });

    it('rejects trip creation if attached driver is currently IN_TRANSIT on another trip', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. School check
      querySpy.mockResolvedValueOnce([{ id: schoolA }] as any);
      // 2. Route check
      querySpy.mockResolvedValueOnce([
        { id: routeAId, name: 'North Line', code: 'RTE-N1', default_bus_id: busAId, default_driver_id: driverAId },
      ] as any);
      // 3. Bus check
      querySpy.mockResolvedValueOnce([
        { id: busAId, bus_number: 'BUS-101', registration_number: 'DL01AB1234' },
      ] as any);
      // 4. Driver check
      querySpy.mockResolvedValueOnce([
        { id: driverAId, full_name: 'Rajesh Kumar', phone: '+919876543210' },
      ] as any);
      // 5. Active bus check (bus ok)
      querySpy.mockResolvedValueOnce([] as any);
      // 6. Active driver check -> driver is currently running!
      querySpy.mockResolvedValueOnce([{ id: 'running-trip-driver' }] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/today`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          routeId: routeAId,
          busId: busAId,
          driverId: driverAId,
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      const msg = res.body.error?.message || res.body.message;
      expect(msg).toContain('Driver is currently in transit');
    });

    it('rejects duplicate trip if same route, date, and start time already scheduled', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. School check
      querySpy.mockResolvedValueOnce([{ id: schoolA }] as any);
      // 2. Route check
      querySpy.mockResolvedValueOnce([
        { id: routeAId, name: 'North Line', code: 'RTE-N1', default_bus_id: busAId, default_driver_id: driverAId },
      ] as any);
      // 3. Bus check
      querySpy.mockResolvedValueOnce([
        { id: busAId, bus_number: 'BUS-101', registration_number: 'DL01AB1234' },
      ] as any);
      // 4. Driver check
      querySpy.mockResolvedValueOnce([
        { id: driverAId, full_name: 'Rajesh Kumar', phone: '+919876543210' },
      ] as any);
      // 5. Active bus check
      querySpy.mockResolvedValueOnce([] as any);
      // 6. Active driver check
      querySpy.mockResolvedValueOnce([] as any);
      // 7. Duplicate check -> existing trip found!
      querySpy.mockResolvedValueOnce([{ id: 'existing-duplicate-trip' }] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/today`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          routeId: routeAId,
          busId: busAId,
          driverId: driverAId,
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      const msg = res.body.error?.message || res.body.message;
      expect(msg).toContain('already scheduled');
    });

    it('rejects trip creation when route has no default bus and none is provided', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([{ id: schoolA }] as any);
      // Route has default_bus_id: null
      querySpy.mockResolvedValueOnce([
        { id: routeAId, name: 'North Line', code: 'RTE-N1', default_bus_id: null, default_driver_id: driverAId },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/today`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({
          routeId: routeAId,
          // busId omitted
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      const msg = res.body.error?.message || res.body.message;
      expect(msg).toContain('Bus is required');
    });
  });

  describe('3. POST /api/v1/schools/:schoolId/trips/generate-daily (Bulk Today Trips Generation)', () => {
    it('generates daily trips for all active routes with attached bus & driver', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Fetch active routes with attached bus & driver
      querySpy.mockResolvedValueOnce([
        { id: routeAId, name: 'North Line', code: 'RTE-N1', default_bus_id: busAId, default_driver_id: driverAId },
      ] as any);

      // 2. Check if trip exists for routeA today -> not found
      querySpy.mockResolvedValueOnce([] as any);

      // Now createTrip is called for routeA:
      // School check
      querySpy.mockResolvedValueOnce([{ id: schoolA }] as any);
      // Route check
      querySpy.mockResolvedValueOnce([
        { id: routeAId, name: 'North Line', code: 'RTE-N1', default_bus_id: busAId, default_driver_id: driverAId },
      ] as any);
      // Bus check
      querySpy.mockResolvedValueOnce([
        { id: busAId, bus_number: 'BUS-101', registration_number: 'DL01AB1234' },
      ] as any);
      // Driver check
      querySpy.mockResolvedValueOnce([
        { id: driverAId, full_name: 'Rajesh Kumar', phone: '+919876543210' },
      ] as any);
      // Active bus check
      querySpy.mockResolvedValueOnce([] as any);
      // Active driver check
      querySpy.mockResolvedValueOnce([] as any);
      // Duplicate check
      querySpy.mockResolvedValueOnce([] as any);
      // Insert trip
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.SCHEDULED,
          scheduled_date: today,
          scheduled_start_time: `${today}T07:30:00Z`,
          current_stop_sequence: 0,
          delay_minutes: 0,
        },
      ] as any);
      // Audit log
      querySpy.mockResolvedValueOnce([{ id: 'audit-bulk' }] as any);
      // getTripById
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.SCHEDULED,
          lifecycleStage: TripLifecycleStage.NOT_STARTED,
          scheduled_date: today,
          scheduled_start_time: `${today}T07:30:00Z`,
          current_stop_sequence: 0,
          delay_minutes: 0,
        },
      ] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/generate-daily`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.scheduledCount).toBe(1);
      expect(res.body.data.skippedCount).toBe(0);
      expect(res.body.data.createdTrips.length).toBe(1);
    });

    it('skips routes that already have a scheduled trip for today', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Fetch active routes with attached bus & driver
      querySpy.mockResolvedValueOnce([
        { id: routeAId, name: 'North Line', code: 'RTE-N1', default_bus_id: busAId, default_driver_id: driverAId },
      ] as any);

      // 2. Check if trip exists for routeA today -> already exists!
      querySpy.mockResolvedValueOnce([{ id: 'already-scheduled-trip' }] as any);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/generate-daily`)
        .set('Authorization', `Bearer ${adminAToken}`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.scheduledCount).toBe(0);
      expect(res.body.data.skippedCount).toBe(1);
      expect(res.body.data.createdTrips.length).toBe(0);
    });
  });

  describe('4. Multi-Tenant Authorization', () => {
    it('rejects cross-tenant trip creation with 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/api/v1/schools/${schoolA}/trips/today`)
        .set('Authorization', `Bearer ${adminBToken}`) // School B admin calling School A
        .send({
          routeId: routeAId,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });
});
