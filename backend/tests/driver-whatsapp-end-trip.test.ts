import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import * as db from '../src/config/database.js';
import { MessagingService } from '../src/services/messaging/messaging.service.js';
import { MockMessagingAdapter } from '../src/services/messaging/mock-messaging.adapter.js';
import { RealtimeFeedService } from '../src/services/realtime-feed.service.js';
import { TripStatus } from '@school-bus/shared';

const schoolA = '111e4567-e89b-12d3-a456-426614174001';
const driverAId = 'ddd11111-e89b-12d3-a456-426614174001';
const busAId = '222e4567-e89b-12d3-a456-426614174222';
const routeAId = '555e4567-e89b-12d3-a456-426614174555';
const tripAId = '777e4567-e89b-12d3-a456-426614174777';

describe('Phase 17.3: Driver WhatsApp Core — End Trip Flow', () => {
  let app: any;

  beforeEach(() => {
    app = createApp();
    MessagingService.resetProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    MessagingService.resetProvider();
  });

  describe('1. Driver Identification & Active Trip Resolution', () => {
    it('rejects end trip when driver is not registered', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([]); // No driver found

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/end-trip')
        .send({
          from: '+919999900000',
          schoolId: schoolA,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('not registered');
    });

    it('rejects end trip when driver has no active in-transit trip', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Driver lookup
      querySpy.mockResolvedValueOnce([
        {
          id: driverAId,
          school_id: schoolA,
          full_name: 'Rajesh Driver',
          phone: '+919876543210',
          license_number: 'DL-01',
          bus_id: busAId,
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
        },
      ] as any);

      // 2. Active trip query (none)
      querySpy.mockResolvedValueOnce([]);

      // 3. Recently completed query (none)
      querySpy.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/end-trip')
        .send({
          from: '9876543210',
          schoolId: schoolA,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('do not currently have an active trip');
    });
  });

  describe('2. End Trip Execution, Attendance Locking & Summary Generation', () => {
    it('ends active trip, unlinks tokens, locks attendance, broadcasts offline, and returns operational summary', async () => {
      const querySpy = vi.spyOn(db, 'query');
      const publishSpy = vi.spyOn(RealtimeFeedService, 'publish');

      // 1. Driver lookup
      querySpy.mockResolvedValueOnce([
        {
          id: driverAId,
          school_id: schoolA,
          full_name: 'Rajesh Driver',
          phone: '+919876543210',
          license_number: 'DL-01',
          bus_id: busAId,
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
        },
      ] as any);

      // 2. Active trip lookup (found active trip tripAId)
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          bus_id: busAId,
          status: TripStatus.IN_TRANSIT,
        },
      ] as any);

      // 3. In TripService.completeTrip: fetch current trip state & bus cache
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
          last_speed_kmh: 0,
          last_bearing_degrees: 90,
          gps_health_status: 'HEALTHY',
        },
      ] as any);

      // 4. In TripService.completeTrip: update trips status to COMPLETED
      querySpy.mockResolvedValueOnce([]);

      // 5. In TripService.completeTrip: update parent_tracking_tokens (set trip_id = NULL)
      querySpy.mockResolvedValueOnce([]);

      // 6. In TripService.completeTrip: recordTripAudit (TRIP_COMPLETED)
      querySpy.mockResolvedValueOnce([]);

      // 7. In TripService.completeTrip: recordTripAudit (TRIP_ATTENDANCE_LOCKED)
      querySpy.mockResolvedValueOnce([]);

      // 8. In TripService.completeTrip -> getTripById
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
          actual_end_time: '2026-10-17T08:15:00Z',
          current_stop_sequence: 5,
          delay_minutes: 0,
          created_at: '2026-10-17T06:00:00Z',
          updated_at: '2026-10-17T08:15:00Z',
          route_name: 'North Campus Express',
          route_code: 'R-101',
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
          driver_name: 'Rajesh Driver',
          driver_phone: '+919876543210',
          total_stops: 5,
          is_arrived_school: true,
          arrived_school_time: '2026-10-17T08:12:00Z',
        },
      ] as any);

      // 9. In startTripViaWhatsApp / getTripSummary: query summary details
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
          delay_minutes: 0,
          route_name: 'North Campus Express',
          route_code: 'R-101',
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
          driver_name: 'Rajesh Driver',
          driver_phone: '+919876543210',
          total_stops: 5,
          total_expected: 20,
          total_boarded: 18,
          total_deboarded: 18,
          total_absent: 2,
          completed_at: '2026-10-17T08:15:00Z',
        },
      ] as any);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/end-trip')
        .send({
          from: '+919876543210',
          schoolId: schoolA,
          summaryNotes: 'All students safely reached campus',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.alreadyCompleted).toBe(false);
      expect(res.body.data.trip.status).toBe(TripStatus.COMPLETED);
      expect(res.body.data.attendanceLocked).toBe(true);
      expect(res.body.data.trackingSessionActive).toBe(false);

      // Verify summary fields
      expect(res.body.data.summary.durationMinutes).toBe(45);
      expect(res.body.data.summary.stopsCompleted).toBe(5);
      expect(res.body.data.summary.attendance.totalExpected).toBe(20);
      expect(res.body.data.summary.attendance.totalBoarded).toBe(18);
      expect(res.body.data.summary.attendance.totalAbsent).toBe(2);

      // Verify formatted replyText contains key operational details
      expect(res.body.data.replyText).toContain('Trip Completed Successfully!');
      expect(res.body.data.replyText).toContain('R-101');
      expect(res.body.data.replyText).toContain('45 minutes');
      expect(res.body.data.replyText).toContain('18');
      expect(res.body.data.replyText).toContain('Attendance ledger is locked');

      // Verify dashboard broadcast indicating bus went OFFLINE / finished
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'LOCATION_UPDATE',
          tripId: tripAId,
          busId: busAId,
          healthStatus: 'OFFLINE',
        })
      );
    });
  });

  describe('3. Idempotency & Safe Retries', () => {
    it('returns alreadyCompleted idempotently when trip was already completed', async () => {
      const querySpy = vi.spyOn(db, 'query');
      const publishSpy = vi.spyOn(RealtimeFeedService, 'publish');

      // 1. Driver lookup
      querySpy.mockResolvedValueOnce([
        {
          id: driverAId,
          school_id: schoolA,
          full_name: 'Rajesh Driver',
          phone: '+919876543210',
          license_number: 'DL-01',
          bus_id: busAId,
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
        },
      ] as any);

      // 2. Active trip check (none in transit)
      querySpy.mockResolvedValueOnce([]);

      // 3. Recently completed query (found tripAId completed today)
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
        },
      ] as any);

      // 4. In TripService.getTripById
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
          actual_end_time: '2026-10-17T08:15:00Z',
          current_stop_sequence: 5,
          delay_minutes: 0,
          created_at: '2026-10-17T06:00:00Z',
          updated_at: '2026-10-17T08:15:00Z',
          route_name: 'North Campus Express',
          route_code: 'R-101',
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
          driver_name: 'Rajesh Driver',
          driver_phone: '+919876543210',
          total_stops: 5,
          is_arrived_school: true,
          arrived_school_time: '2026-10-17T08:12:00Z',
        },
      ] as any);

      // 5. In TripService.getTripSummary
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
          delay_minutes: 0,
          route_name: 'North Campus Express',
          route_code: 'R-101',
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
          driver_name: 'Rajesh Driver',
          driver_phone: '+919876543210',
          total_stops: 5,
          total_expected: 20,
          total_boarded: 18,
          total_deboarded: 18,
          total_absent: 2,
          completed_at: '2026-10-17T08:15:00Z',
        },
      ] as any);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/end-trip')
        .send({
          from: '+919876543210',
          schoolId: schoolA,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.alreadyCompleted).toBe(true);
      expect(res.body.data.replyText).toContain('Trip Already Completed');
      expect(res.body.data.replyText).toContain('18 / 20 boarded');

      // No new broadcast on idempotent completion
      expect(publishSpy).not.toHaveBeenCalled();
    });
  });

  describe('4. Inbound WhatsApp Message Flow', () => {
    it('processes inbound command "2" / "end trip" from driver and sends summary WhatsApp reply', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Inbound handler: driver lookup
      querySpy.mockResolvedValueOnce([
        {
          id: driverAId,
          school_id: schoolA,
          full_name: 'Rajesh Driver',
          phone: '+919876543210',
          license_number: 'DL-01',
          bus_id: busAId,
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
        },
      ] as any);

      // 2. In getDriverMenu -> getDriverTripContext: active trip check
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          status: TripStatus.IN_TRANSIT,
          current_stop_sequence: 5,
          route_name: 'North Campus Express',
          route_code: 'R-101',
          bus_number: 'BUS-01',
          total_stops: 5,
        },
      ] as any);

      // 3. In endTripViaWhatsApp: driver lookup
      querySpy.mockResolvedValueOnce([
        {
          id: driverAId,
          school_id: schoolA,
          full_name: 'Rajesh Driver',
          phone: '+919876543210',
          license_number: 'DL-01',
          bus_id: busAId,
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
        },
      ] as any);

      // 4. In endTripViaWhatsApp: active trip check
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          bus_id: busAId,
          status: TripStatus.IN_TRANSIT,
        },
      ] as any);

      // 5. In TripService.completeTrip: fetch current trip state
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.IN_TRANSIT,
          actual_start_time: '2026-10-17T07:30:00Z',
          actual_end_time: null,
          last_latitude: 12.97,
          last_longitude: 77.59,
          last_speed_kmh: 0,
          last_bearing_degrees: 0,
          gps_health_status: 'HEALTHY',
        },
      ] as any);

      // 6. In TripService.completeTrip: update trips
      querySpy.mockResolvedValueOnce([]);

      // 7. In TripService.completeTrip: unlink tokens
      querySpy.mockResolvedValueOnce([]);

      // 8. In TripService.completeTrip: audit log (TRIP_COMPLETED)
      querySpy.mockResolvedValueOnce([]);

      // 9. In TripService.completeTrip: audit log (TRIP_ATTENDANCE_LOCKED)
      querySpy.mockResolvedValueOnce([]);

      // 10. In TripService.completeTrip -> getTripById
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
          actual_end_time: '2026-10-17T08:15:00Z',
          current_stop_sequence: 5,
          delay_minutes: 0,
          created_at: '2026-10-17T06:00:00Z',
          updated_at: '2026-10-17T08:15:00Z',
          route_name: 'North Campus Express',
          route_code: 'R-101',
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
          driver_name: 'Rajesh Driver',
          driver_phone: '+919876543210',
          total_stops: 5,
          is_arrived_school: true,
          arrived_school_time: '2026-10-17T08:12:00Z',
        },
      ] as any);

      // 11. In TripService.getTripSummary
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
          delay_minutes: 0,
          route_name: 'North Campus Express',
          route_code: 'R-101',
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
          driver_name: 'Rajesh Driver',
          driver_phone: '+919876543210',
          total_stops: 5,
          total_expected: 15,
          total_boarded: 15,
          total_deboarded: 15,
          total_absent: 0,
          completed_at: '2026-10-17T08:15:00Z',
        },
      ] as any);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/message')
        .send({
          from: '+919876543210',
          text: 'end trip',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe('END_TRIP');
      expect(res.body.data.replyText).toContain('Trip Completed Successfully!');

      // Outbound WhatsApp message sent to driver
      const sent = MockMessagingAdapter.getSentMessages();
      const driverReply = sent.find((m) => m.recipientPhone === '+919876543210');
      expect(driverReply).toBeDefined();
      expect(driverReply?.recipientRole).toBe('DRIVER');
      expect(driverReply?.directText).toContain('Trip Completed Successfully!');
      expect(driverReply?.directText).toContain('Attendance Summary:');
      expect(driverReply?.directText).toContain('15');
    });
  });
});
