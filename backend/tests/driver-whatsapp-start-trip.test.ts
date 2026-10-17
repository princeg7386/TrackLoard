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
const parentAId = 'ppp11111-e89b-12d3-a456-426614174001';
const studentAId = 'sss11111-e89b-12d3-a456-426614174001';

describe('Phase 17.2: Driver WhatsApp Core — Start Trip Flow', () => {
  let app: any;

  beforeEach(() => {
    app = createApp();
    MessagingService.resetProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    MessagingService.resetProvider();
  });

  describe('1. Driver & Bus Identification', () => {
    it('rejects start trip when driver is not registered', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([]); // No driver found

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/start-trip')
        .send({
          from: '+919876500000',
          schoolId: schoolA,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('not registered');
    });

    it('rejects start trip when driver has no assigned bus and route has no bus', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Driver lookup: driver without assigned bus
      querySpy.mockResolvedValueOnce([
        {
          id: driverAId,
          school_id: schoolA,
          full_name: 'Suresh Driver',
          phone: '+919876543210',
          license_number: 'DL-01',
          bus_id: null,
          bus_number: null,
          registration_number: null,
        },
      ] as any);

      // 2. Active trip check: none
      querySpy.mockResolvedValueOnce([]);

      // 3. Scheduled trip check: none
      querySpy.mockResolvedValueOnce([]);

      // 4. Assigned route check: route without default bus
      querySpy.mockResolvedValueOnce([
        {
          id: routeAId,
          name: 'Route 101',
          code: 'R-101',
          default_bus_id: null,
        },
      ] as any);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/start-trip')
        .send({
          from: '9876543210',
          schoolId: schoolA,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('No assigned bus found');
    });
  });

  describe('2. Start Scheduled Trip Execution & Parent Notifications', () => {
    it('starts today scheduled trip, activates tracking session, notifies parents, and updates dashboard', async () => {
      const querySpy = vi.spyOn(db, 'query');
      const publishSpy = vi.spyOn(RealtimeFeedService, 'publish');

      // 1. Driver lookup
      querySpy.mockResolvedValueOnce([
        {
          id: driverAId,
          school_id: schoolA,
          full_name: 'Rajesh Driver',
          phone: '+919876543210',
          license_number: 'DL-KA-01',
          bus_id: busAId,
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
        },
      ] as any);

      // 2. Active trip check (none)
      querySpy.mockResolvedValueOnce([]);

      // 3. Today's scheduled trip check (found tripAId)
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
        },
      ] as any);

      // 4. In TripService.startTrip: fetch current trip state & bus cache
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
          last_bearing_degrees: 0,
          gps_health_status: 'HEALTHY',
        },
      ] as any);

      // 5. In TripService.startTrip: update trips status to IN_TRANSIT
      querySpy.mockResolvedValueOnce([]);

      // 6. In TripService.startTrip: update parent_tracking_tokens (activatedTokens)
      querySpy.mockResolvedValueOnce([{ id: 'tok-1' }] as any);

      // 7. In TripService.startTrip: recordTripAudit (INSERT INTO audit_logs)
      querySpy.mockResolvedValueOnce([]);

      // 8. In TripService.getTripById: fetch updated trip details
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
          actual_start_time: '2026-10-17T07:35:00Z',
          actual_end_time: null,
          current_stop_sequence: 0,
          delay_minutes: 0,
          created_at: '2026-10-17T06:00:00Z',
          updated_at: '2026-10-17T07:35:00Z',
          route_name: 'North Campus Express',
          route_code: 'R-101',
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
          driver_name: 'Rajesh Driver',
          driver_phone: '+919876543210',
          total_stops: 5,
          is_arrived_school: false,
          arrived_school_time: null,
        },
      ] as any);

      // 9. In startTripViaWhatsApp: query parents for route departure alerts
      querySpy.mockResolvedValueOnce([
        {
          parent_id: parentAId,
          parent_phone: '+919811122233',
          parent_name: 'Aarav Father',
          notifications_enabled: true,
          student_id: studentAId,
          student_name: 'Aarav Sharma',
          admission_number: 'ADM-101',
          stop_name: 'Koramangala 4th Block',
        },
      ] as any);

      // 10. In ParentIdentityService.createTrackingToken: verify parent & student relationship
      querySpy.mockResolvedValueOnce([{ id: parentAId }] as any);

      // 11. In ParentIdentityService.createTrackingToken: insert parent_tracking_tokens
      querySpy.mockResolvedValueOnce([
        {
          id: 'token-uuid-1',
          expires_at: new Date(Date.now() + 86400000),
          created_at: new Date(),
        },
      ] as any);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/start-trip')
        .send({
          from: '+919876543210',
          schoolId: schoolA,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.alreadyInTransit).toBe(false);
      expect(res.body.data.trip.id).toBe(tripAId);
      expect(res.body.data.trip.status).toBe(TripStatus.IN_TRANSIT);
      expect(res.body.data.bus.busNumber).toBe('BUS-01');
      expect(res.body.data.parentNotificationsSent).toBe(1);
      expect(res.body.data.trackingSessionActive).toBe(true);
      expect(res.body.data.replyText).toContain('Trip Started Successfully!');
      expect(res.body.data.replyText).toContain('BUS-01');

      // Verify dashboard broadcast
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'INITIAL_STATE',
          tripId: tripAId,
          busId: busAId,
          schoolId: schoolA,
        })
      );

      // Verify parent received WhatsApp alert with tracking token
      const sent = MockMessagingAdapter.getSentMessages();
      const parentAlert = sent.find((m) => m.recipientPhone === '+919811122233');
      expect(parentAlert).toBeDefined();
      expect(parentAlert?.recipientRole).toBe('PARENT');
      expect(parentAlert?.directText).toContain('School Bus Departed — Live Tracking Active');
      expect(parentAlert?.directText).toContain('Aarav Sharma');
      expect(parentAlert?.directText).toContain('BUS-01');
      expect(parentAlert?.directText).toContain('/track/');
    });
  });

  describe('3. Auto-Create Today Trip & Idempotency', () => {
    it('auto-creates today trip if no scheduled trip exists but route is assigned', async () => {
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

      // 2. Active trip check (none)
      querySpy.mockResolvedValueOnce([]);

      // 3. Today's scheduled trip check (none)
      querySpy.mockResolvedValueOnce([]);

      // 4. Assigned route check (found Route 101)
      querySpy.mockResolvedValueOnce([
        {
          id: routeAId,
          name: 'South Express',
          code: 'R-202',
          default_bus_id: busAId,
        },
      ] as any);

      // 5. In TripService.createTrip: verify school exists
      querySpy.mockResolvedValueOnce([
        {
          id: schoolA,
        },
      ] as any);

      // 6. In TripService.createTrip: verify route exists
      querySpy.mockResolvedValueOnce([
        {
          id: routeAId,
          name: 'South Express',
          code: 'R-202',
          default_bus_id: busAId,
          default_driver_id: driverAId,
        },
      ] as any);

      // 7. In TripService.createTrip: verify bus exists
      querySpy.mockResolvedValueOnce([
        {
          id: busAId,
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
        },
      ] as any);

      // 8. In TripService.createTrip: verify driver exists
      querySpy.mockResolvedValueOnce([
        {
          id: driverAId,
          full_name: 'Rajesh Driver',
          phone: '+919876543210',
        },
      ] as any);

      // 9. In TripService.createTrip: conflict check bus
      querySpy.mockResolvedValueOnce([]);

      // 10. In TripService.createTrip: conflict check driver
      querySpy.mockResolvedValueOnce([]);

      // 11. In TripService.createTrip: duplicate check
      querySpy.mockResolvedValueOnce([]);

      // 12. In TripService.createTrip: INSERT INTO trips
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
          created_at: '2026-10-17T07:00:00Z',
          updated_at: '2026-10-17T07:00:00Z',
        },
      ] as any);

      // 13. In TripService.createTrip: recordTripAudit
      querySpy.mockResolvedValueOnce([]);

      // 14. In TripService.createTrip -> getTripById
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
          created_at: '2026-10-17T07:00:00Z',
          updated_at: '2026-10-17T07:00:00Z',
          route_name: 'South Express',
          route_code: 'R-202',
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
          driver_name: 'Rajesh Driver',
          driver_phone: '+919876543210',
          total_stops: 3,
          is_arrived_school: false,
          arrived_school_time: null,
        },
      ] as any);

      // 15. In TripService.startTrip: fetch current trip state & bus cache
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
          last_bearing_degrees: 0,
          gps_health_status: 'HEALTHY',
        },
      ] as any);

      // 16. In TripService.startTrip: update trips status to IN_TRANSIT
      querySpy.mockResolvedValueOnce([]);

      // 17. In TripService.startTrip: update parent_tracking_tokens
      querySpy.mockResolvedValueOnce([]);

      // 18. In TripService.startTrip: audit log
      querySpy.mockResolvedValueOnce([]);

      // 19. In TripService.startTrip -> getTripById
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
          actual_start_time: '2026-10-17T07:31:00Z',
          actual_end_time: null,
          current_stop_sequence: 0,
          delay_minutes: 0,
          created_at: '2026-10-17T07:00:00Z',
          updated_at: '2026-10-17T07:31:00Z',
          route_name: 'South Express',
          route_code: 'R-202',
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
          driver_name: 'Rajesh Driver',
          driver_phone: '+919876543210',
          total_stops: 3,
          is_arrived_school: false,
          arrived_school_time: null,
        },
      ] as any);

      // 20. In startTripViaWhatsApp: query parents (empty for this test)
      querySpy.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/start-trip')
        .send({
          from: '9876543210',
          schoolId: schoolA,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.trip.routeCode).toBe('R-202');
      expect(res.body.data.trip.status).toBe(TripStatus.IN_TRANSIT);
    });

    it('returns alreadyInTransit idempotently without duplicate trip start or alerts', async () => {
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

      // 2. Active trip check: already IN_TRANSIT
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
          status: TripStatus.IN_TRANSIT,
          current_stop_sequence: 2,
          actual_start_time: '2026-10-17T07:30:00Z',
          route_name: 'North Campus Express',
          route_code: 'R-101',
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
          total_stops: 5,
        },
      ] as any);

      // 3. TripService.getTripById for active trip
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
          delay_minutes: 0,
          created_at: '2026-10-17T06:00:00Z',
          updated_at: '2026-10-17T07:30:00Z',
          route_name: 'North Campus Express',
          route_code: 'R-101',
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
          driver_name: 'Rajesh Driver',
          driver_phone: '+919876543210',
          total_stops: 5,
          is_arrived_school: false,
          arrived_school_time: null,
        },
      ] as any);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/start-trip')
        .send({
          from: '+919876543210',
          schoolId: schoolA,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.alreadyInTransit).toBe(true);
      expect(res.body.data.parentNotificationsSent).toBe(0);
      expect(res.body.data.replyText).toContain('Trip Already In Transit');
      expect(res.body.data.replyText).toContain('Stop #2 of 5');

      // Zero new dashboard events or parent notifications on idempotent duplicate
      expect(publishSpy).not.toHaveBeenCalled();
      const sent = MockMessagingAdapter.getSentMessages();
      expect(sent.length).toBe(0);
    });
  });

  describe('4. Inbound WhatsApp Message Integration', () => {
    it('processes command "1" or "start trip" from driver and replies with trip confirmation', async () => {
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

      // 2. In getDriverMenu -> getDriverTripContext: active trip check (none)
      querySpy.mockResolvedValueOnce([]);

      // 3. In getDriverMenu -> getDriverTripContext: scheduled trip check (none)
      querySpy.mockResolvedValueOnce([]);

      // 4. In startTripViaWhatsApp: driver lookup
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

      // 5. In startTripViaWhatsApp: active trip check (none)
      querySpy.mockResolvedValueOnce([]);

      // 6. In startTripViaWhatsApp: scheduled trip check (found)
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
        },
      ] as any);

      // 7. In TripService.startTrip: fetch current trip state
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          bus_id: busAId,
          driver_id: driverAId,
          status: TripStatus.SCHEDULED,
          actual_start_time: null,
          actual_end_time: null,
          last_latitude: 12.97,
          last_longitude: 77.59,
          last_speed_kmh: 0,
          last_bearing_degrees: 0,
          gps_health_status: 'HEALTHY',
        },
      ] as any);

      // 8. In TripService.startTrip: update trips table
      querySpy.mockResolvedValueOnce([]);

      // 9. In TripService.startTrip: update tokens
      querySpy.mockResolvedValueOnce([]);

      // 10. In TripService.startTrip: audit log
      querySpy.mockResolvedValueOnce([]);

      // 11. In TripService.startTrip -> getTripById
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
          current_stop_sequence: 0,
          delay_minutes: 0,
          created_at: '2026-10-17T06:00:00Z',
          updated_at: '2026-10-17T07:32:00Z',
          route_name: 'Campus Route 1',
          route_code: 'CR-01',
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
          driver_name: 'Rajesh Driver',
          driver_phone: '+919876543210',
          total_stops: 4,
          is_arrived_school: false,
          arrived_school_time: null,
        },
      ] as any);

      // 12. In startTripViaWhatsApp: query parents (empty for simplicity)
      querySpy.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/message')
        .send({
          from: '+919876543210',
          text: 'start trip',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe('START_TRIP');
      expect(res.body.data.replyText).toContain('Trip Started Successfully!');

      // Outbound message sent to driver via WhatsApp
      const sent = MockMessagingAdapter.getSentMessages();
      const driverReply = sent.find((m) => m.recipientPhone === '+919876543210');
      expect(driverReply).toBeDefined();
      expect(driverReply?.recipientRole).toBe('DRIVER');
      expect(driverReply?.directText).toContain('Trip Started Successfully!');
      expect(driverReply?.directText).toContain('BUS-01');
    });
  });
});
