import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as db from '../src/config/database.js';
import { TripService } from '../src/services/trip.service.js';
import { TripStatus, TripLifecycleStage } from '@school-bus/shared';
import { BadRequestError } from '../src/middlewares/error.middleware.js';

describe('Trip State Machine: ARRIVED_SCHOOL transitions (Task 1)', () => {
  const schoolId = '111e4567-e89b-12d3-a456-426614174001';
  const tripId = '777e4567-e89b-12d3-a456-426614174777';
  const driverId = 'ddd11111-e89b-12d3-a456-426614174001';
  const busId = '222e4567-e89b-12d3-a456-426614174222';
  const routeId = '555e4567-e89b-12d3-a456-426614174555';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Valid Transitions to and from ARRIVED_SCHOOL', () => {
    it('transitions from IN_TRANSIT to ARRIVED_SCHOOL', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Fetch current trip state
      querySpy.mockResolvedValueOnce([
        {
          id: tripId,
          driver_id: driverId,
          status: TripStatus.IN_TRANSIT,
          current_stop_sequence: 3,
        },
      ] as any);

      // 2. Check existing arrival audit log
      querySpy.mockResolvedValueOnce([] as any);

      // 3. Update trips table to ARRIVED_SCHOOL
      querySpy.mockResolvedValueOnce([] as any);

      // 4. Record audit log
      querySpy.mockResolvedValueOnce([] as any);

      // 5. getTripById query
      querySpy.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          route_id: routeId,
          bus_id: busId,
          driver_id: driverId,
          status: TripStatus.ARRIVED_SCHOOL,
          scheduled_date: '2026-10-17',
          scheduled_start_time: '2026-10-17T07:30:00Z',
          actual_start_time: '2026-10-17T07:35:00Z',
          actual_end_time: null,
          current_stop_sequence: 3,
          delay_minutes: 0,
          route_name: 'Main Route',
          route_code: 'R1',
          bus_number: 'B1',
          registration_number: 'KA-01-AB-1234',
          driver_name: 'Driver One',
          driver_phone: '+919876543210',
          total_stops: 5,
          active_tokens: 1,
          is_arrived_school: true,
          arrived_school_time: '2026-10-17T08:15:00Z',
        },
      ] as any);

      const result = await TripService.arriveAtSchool(schoolId, tripId, {
        userId: driverId,
        userRole: 'DRIVER',
        schoolId,
        isDriver: true,
      });

      expect(result.status).toBe(TripStatus.ARRIVED_SCHOOL);
      expect(result.lifecycleStage).toBe(TripLifecycleStage.ARRIVED_SCHOOL);
    });

    it('transitions from DELAYED to ARRIVED_SCHOOL', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: tripId,
          driver_id: driverId,
          status: TripStatus.DELAYED,
          current_stop_sequence: 4,
        },
      ] as any);
      querySpy.mockResolvedValueOnce([] as any); // no audit
      querySpy.mockResolvedValueOnce([] as any); // update
      querySpy.mockResolvedValueOnce([] as any); // record audit
      querySpy.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          route_id: routeId,
          bus_id: busId,
          driver_id: driverId,
          status: TripStatus.ARRIVED_SCHOOL,
          scheduled_date: '2026-10-17',
          scheduled_start_time: '2026-10-17T07:30:00Z',
          actual_start_time: '2026-10-17T07:45:00Z',
          actual_end_time: null,
          current_stop_sequence: 4,
          delay_minutes: 15,
          route_name: 'Main Route',
          route_code: 'R1',
          bus_number: 'B1',
          registration_number: 'KA-01-AB-1234',
          driver_name: 'Driver One',
          driver_phone: '+919876543210',
          total_stops: 5,
          active_tokens: 1,
          is_arrived_school: true,
          arrived_school_time: '2026-10-17T08:30:00Z',
        },
      ] as any);

      const result = await TripService.arriveAtSchool(schoolId, tripId, {
        userId: driverId,
        userRole: 'DRIVER',
        schoolId,
        isDriver: true,
      });

      expect(result.status).toBe(TripStatus.ARRIVED_SCHOOL);
      expect(result.lifecycleStage).toBe(TripLifecycleStage.ARRIVED_SCHOOL);
    });

    it('handles idempotent call when trip is already in ARRIVED_SCHOOL state', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: tripId,
          driver_id: driverId,
          status: TripStatus.ARRIVED_SCHOOL,
          current_stop_sequence: 5,
        },
      ] as any);
      querySpy.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          route_id: routeId,
          bus_id: busId,
          driver_id: driverId,
          status: TripStatus.ARRIVED_SCHOOL,
          scheduled_date: '2026-10-17',
          scheduled_start_time: '2026-10-17T07:30:00Z',
          actual_start_time: '2026-10-17T07:35:00Z',
          actual_end_time: null,
          current_stop_sequence: 5,
          delay_minutes: 0,
          route_name: 'Main Route',
          route_code: 'R1',
          bus_number: 'B1',
          registration_number: 'KA-01-AB-1234',
          driver_name: 'Driver One',
          driver_phone: '+919876543210',
          total_stops: 5,
          active_tokens: 0,
          is_arrived_school: true,
          arrived_school_time: '2026-10-17T08:15:00Z',
        },
      ] as any);

      const result = await TripService.arriveAtSchool(schoolId, tripId, {
        userId: driverId,
        userRole: 'DRIVER',
        schoolId,
        isDriver: true,
      });

      expect(result.status).toBe(TripStatus.ARRIVED_SCHOOL);
      expect(result.lifecycleStage).toBe(TripLifecycleStage.ARRIVED_SCHOOL);
    });

    it('transitions from ARRIVED_SCHOOL to COMPLETED', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Current trip query
      querySpy.mockResolvedValueOnce([
        {
          id: tripId,
          route_id: routeId,
          bus_id: busId,
          driver_id: driverId,
          status: TripStatus.ARRIVED_SCHOOL,
          actual_start_time: '2026-10-17T07:35:00Z',
          actual_end_time: null,
          last_latitude: 28.6139,
          last_longitude: 77.2090,
          last_speed_kmh: 0,
          last_bearing_degrees: 0,
          gps_health_status: 'HEALTHY',
        },
      ] as any);

      // 2. UPDATE trips status = COMPLETED
      querySpy.mockResolvedValueOnce([] as any);

      // 3. UPDATE parent_tracking_tokens
      querySpy.mockResolvedValueOnce([] as any);

      // 4. Record audit TRIP_COMPLETED
      querySpy.mockResolvedValueOnce([] as any);

      // 5. Record audit TRIP_ATTENDANCE_LOCKED
      querySpy.mockResolvedValueOnce([] as any);

      // 6. getTripById query
      querySpy.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          route_id: routeId,
          bus_id: busId,
          driver_id: driverId,
          status: TripStatus.COMPLETED,
          scheduled_date: '2026-10-17',
          scheduled_start_time: '2026-10-17T07:30:00Z',
          actual_start_time: '2026-10-17T07:35:00Z',
          actual_end_time: '2026-10-17T08:20:00Z',
          current_stop_sequence: 5,
          delay_minutes: 0,
          created_at: '2026-10-17T07:00:00Z',
          updated_at: '2026-10-17T08:20:00Z',
          route_name: 'Main Route',
          route_code: 'R1',
          bus_number: 'B1',
          registration_number: 'KA-01-AB-1234',
          driver_name: 'Driver One',
          driver_phone: '+919876543210',
          total_stops: 5,
          is_arrived_school: true,
          arrived_school_time: '2026-10-17T08:15:00Z',
        },
      ] as any);

      const result = await TripService.completeTrip(schoolId, tripId, {
        userId: driverId,
        userRole: 'DRIVER',
        schoolId,
        isDriver: true,
      });

      expect(result.status).toBe(TripStatus.COMPLETED);
      expect(result.lifecycleStage).toBe(TripLifecycleStage.COMPLETED);
    });
  });

  describe('Invalid Transitions to ARRIVED_SCHOOL', () => {
    it('rejects transition from SCHEDULED to ARRIVED_SCHOOL', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([
        {
          id: tripId,
          driver_id: driverId,
          status: TripStatus.SCHEDULED,
          current_stop_sequence: 0,
        },
      ] as any);

      await expect(
        TripService.arriveAtSchool(schoolId, tripId, {
          userId: driverId,
          userRole: 'DRIVER',
          schoolId,
          isDriver: true,
        })
      ).rejects.toThrow(BadRequestError);
    });

    it('rejects transition from COMPLETED to ARRIVED_SCHOOL', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([
        {
          id: tripId,
          driver_id: driverId,
          status: TripStatus.COMPLETED,
          current_stop_sequence: 5,
        },
      ] as any);

      await expect(
        TripService.arriveAtSchool(schoolId, tripId, {
          userId: driverId,
          userRole: 'DRIVER',
          schoolId,
          isDriver: true,
        })
      ).rejects.toThrow(BadRequestError);
    });

    it('rejects transition from CANCELLED to ARRIVED_SCHOOL', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([
        {
          id: tripId,
          driver_id: driverId,
          status: TripStatus.CANCELLED,
          current_stop_sequence: 1,
        },
      ] as any);

      await expect(
        TripService.arriveAtSchool(schoolId, tripId, {
          userId: driverId,
          userRole: 'DRIVER',
          schoolId,
          isDriver: true,
        })
      ).rejects.toThrow(BadRequestError);
    });
  });
});
