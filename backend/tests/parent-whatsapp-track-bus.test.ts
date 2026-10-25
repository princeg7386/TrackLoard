import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import * as db from '../src/config/database.js';
import { MessagingService } from '../src/services/messaging/messaging.service.js';
import { MockMessagingAdapter } from '../src/services/messaging/mock-messaging.adapter.js';
import { ParentWhatsappService } from '../src/services/parent-whatsapp.service.js';
import { ParentWhatsAppAction, ParentTrackBusResponseSchema, TripStatus } from '@school-bus/shared';
import { EtaService } from '../src/services/eta.service.js';

const mockSchoolId = '11111111-1111-1111-1111-111111111111';
const mockParentId = '22222222-2222-2222-2222-222222222222';
const mockStudentId = '33333333-3333-3333-3333-333333333333';
const mockStopId = '44444444-4444-4444-4444-444444444444';
const mockTripId = '55555555-5555-5555-5555-555555555555';
const mockBusId = '66666666-6666-6666-6666-666666666666';
const mockParentPhone = '+919876543210';

const mockParentDbRow = {
  parent_id: mockParentId,
  parent_name: 'Sunita Sharma',
  parent_phone: mockParentPhone,
  parent_email: 'sunita.sharma@example.com',
  relationship: 'Mother',
  school_id: mockSchoolId,
  school_name: 'Delhi Public School R.K. Puram',
  school_code: 'DPS-RKP',
  school_phone: '+91-11-26174567',
  school_emergency_phone: '+91-11-26179999',
  student_id: mockStudentId,
  student_name: 'Aarav Sharma',
  admission_number: 'ADM-2024-889',
  class_grade: '5',
  section: 'B',
  roll_number: '14',
  stop_id: mockStopId,
  stop_name: 'Vasant Vihar C-Block Market',
  scheduled_time: '07:35:00',
  sequence_order: 3,
  geofence_radius_meters: 300,
  stop_lat: 28.5584,
  stop_lon: 77.1623,
};

describe('Phase 22.2: Parent WhatsApp — Track My Bus', () => {
  let app: any;

  beforeEach(() => {
    app = createApp();
    MessagingService.resetProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    MessagingService.resetProvider();
  });

  describe('1. Active In-Transit Bus Tracking (All 7 Tasks)', () => {
    it('returns complete live bus tracking with current bus, location, route, pickup, ETA, trip status, and secure link', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);

      // 2. getParentTripContext (active trip query with lateral GPS)
      querySpy.mockResolvedValueOnce([
        {
          id: mockTripId,
          route_id: 'route-south-delhi',
          status: 'IN_TRANSIT',
          bus_id: mockBusId,
          driver_id: 'driver-rajesh',
          delay_minutes: 0,
          current_stop_sequence: 3,
          bus_number: 'DL-01-AB-1234',
          registration_number: 'DL1CAB1234',
          driver_name: 'Rajesh Kumar',
          driver_phone: '+919811122233',
          route_name: 'South Delhi Morning Route',
          route_code: 'R-12',
          route_type: 'PICKUP',
          total_stops: 8,
          latitude: 28.5584,
          longitude: 77.1623,
          speed_kmh: 32,
          bearing_degrees: 145,
          gps_recorded_at: new Date(Date.now() - 30 * 1000).toISOString(),
        },
      ]);

      // 3. getOrCreateTrackingUrl: createTrackingToken parent check
      querySpy.mockResolvedValueOnce([{ id: mockParentId }]);

      // 4. getOrCreateTrackingUrl: createTrackingToken insert token
      const futureExpiry = new Date(Date.now() + 8 * 60 * 60 * 1000);
      querySpy.mockResolvedValueOnce([{ id: 'tok-active-1', expires_at: futureExpiry }]);

      // Mock EtaService.calculateParentEta
      const etaSpy = vi.spyOn(EtaService, 'calculateParentEta').mockResolvedValueOnce({
        tripId: mockTripId,
        schoolId: mockSchoolId,
        stopId: mockStopId,
        stopName: 'Vasant Vihar C-Block Market',
        status: 'APPROACHING' as any,
        isAvailable: true,
        etaMinutes: 4,
        distanceMeters: 1200,
        isApproaching: true,
        isPassed: false,
        estimatedArrivalAt: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
      });

      const res = await request(app)
        .post('/api/v1/parent/whatsapp/message')
        .send({
          from: mockParentPhone,
          text: 'track',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(ParentWhatsAppAction.TRACK_MY_BUS);

      const reply = res.body.data.replyText;

      // Task 1: Current bus
      expect(reply).toContain('DL-01-AB-1234');
      expect(reply).toContain('Rajesh Kumar');
      expect(reply).toContain('+919811122233');

      // Task 2: Location
      expect(reply).toContain('Current Bus Location');
      expect(reply).toContain('Moving at 32 km/h');
      expect(reply).toContain('28.5584° N, 77.1623° E');

      // Task 3: Route
      expect(reply).toContain('South Delhi Morning Route');
      expect(reply).toContain('[R-12]');
      expect(reply).toContain('Stop 3 of 8');

      // Task 4: Pickup
      expect(reply).toContain('Vasant Vihar C-Block Market');
      expect(reply).toContain('07:35:00');

      // Task 5: ETA
      expect(reply).toContain('Expected in *4 mins*');
      expect(reply).toContain('1.2 km away');
      expect(reply).toContain('Bus is Approaching!');

      // Task 6: Trip status
      expect(reply).toContain('In Transit 🟢 (On Time)');

      // Task 7: Secure live link & expiry
      expect(reply).toContain('trk_');
      expect(reply).toContain('Link valid for today until');

      // Validate structured payload schema
      const parsed = ParentTrackBusResponseSchema.safeParse(res.body.data.data);
      expect(parsed.success).toBe(true);
      expect(parsed.data?.bus?.busNumber).toBe('DL-01-AB-1234');
      expect(parsed.data?.location?.speedKmh).toBe(32);
      expect(parsed.data?.eta?.isApproaching).toBe(true);

      expect(etaSpy).toHaveBeenCalledWith({
        tripId: mockTripId,
        schoolId: mockSchoolId,
        stopId: mockStopId,
      });
    });
  });

  describe('2. Delay State Reporting', () => {
    it('correctly reports traffic delay and updated status in Track My Bus response', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);

      // 2. getParentTripContext (active trip query with delay and lateral GPS)
      querySpy.mockResolvedValueOnce([
        {
          id: mockTripId,
          route_id: 'route-south-delhi',
          status: 'DELAYED',
          bus_id: mockBusId,
          driver_id: 'driver-rajesh',
          delay_minutes: 15,
          current_stop_sequence: 2,
          bus_number: 'DL-01-AB-1234',
          registration_number: 'DL1CAB1234',
          driver_name: 'Rajesh Kumar',
          driver_phone: '+919811122233',
          route_name: 'South Delhi Morning Route',
          route_code: 'R-12',
          route_type: 'PICKUP',
          total_stops: 8,
          latitude: 28.5512,
          longitude: 77.1554,
          speed_kmh: 0,
          bearing_degrees: 0,
          gps_recorded_at: new Date(Date.now() - 120 * 1000).toISOString(),
        },
      ]);

      // 3. createTrackingToken parent check
      querySpy.mockResolvedValueOnce([{ id: mockParentId }]);

      // 4. createTrackingToken insert token
      querySpy.mockResolvedValueOnce([{ id: 'tok-delay-1', expires_at: new Date() }]);

      // Mock EtaService.calculateParentEta
      vi.spyOn(EtaService, 'calculateParentEta').mockResolvedValueOnce({
        tripId: mockTripId,
        schoolId: mockSchoolId,
        stopId: mockStopId,
        stopName: 'Vasant Vihar C-Block Market',
        status: 'AVAILABLE' as any,
        isAvailable: true,
        etaMinutes: 19,
        distanceMeters: 4500,
        isApproaching: false,
        isPassed: false,
        estimatedArrivalAt: new Date(Date.now() + 19 * 60 * 1000).toISOString(),
      });

      const res = await request(app)
        .post('/api/v1/parent/whatsapp/message')
        .send({
          from: mockParentPhone,
          text: '1',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.replyText).toContain('Delayed 🟡 (15m)');
      expect(res.body.data.replyText).toContain('Stationary (0 km/h)');
      expect(res.body.data.replyText).toContain('Expected in *19 mins*');
    });
  });

  describe('3. Idle / Scheduled State Handling', () => {
    it('returns calm scheduled notice and persistent tracking link when bus has not yet started trip', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);

      // 2. getParentTripContext (active trip query: empty)
      querySpy.mockResolvedValueOnce([]);

      // 3. getParentTripContext (scheduled trip query: today's upcoming trip)
      querySpy.mockResolvedValueOnce([
        {
          id: mockTripId,
          route_id: 'route-south-delhi',
          status: 'SCHEDULED',
          bus_id: mockBusId,
          driver_id: 'driver-rajesh',
          scheduled_start_time: '07:15:00',
          bus_number: 'DL-01-AB-1234',
          registration_number: 'DL1CAB1234',
          driver_name: 'Rajesh Kumar',
          driver_phone: '+919811122233',
          route_name: 'South Delhi Morning Route',
          route_code: 'R-12',
          route_type: 'PICKUP',
          total_stops: 8,
        },
      ]);

      // 4. createTrackingToken parent check
      querySpy.mockResolvedValueOnce([{ id: mockParentId }]);

      // 5. createTrackingToken insert token
      querySpy.mockResolvedValueOnce([{ id: 'tok-sched-1', expires_at: new Date() }]);

      const res = await request(app)
        .post('/api/v1/parent/whatsapp/message')
        .send({
          from: mockParentPhone,
          text: 'track my bus',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.replyText).toContain('Idle / Not in Transit');
      expect(res.body.data.replyText).toContain('Scheduled for Today');
      expect(res.body.data.replyText).toContain('07:35:00');
      expect(res.body.data.replyText).toContain('DL-01-AB-1234');
      expect(res.body.data.replyText).toContain('trk_');
    });
  });

  describe('4. Dedicated API Endpoint: GET /api/v1/parent/whatsapp/track-bus', () => {
    it('returns structured 7-task JSON payload via GET /track-bus', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);

      // 2. getParentTripContext (active trip with lateral GPS)
      querySpy.mockResolvedValueOnce([
        {
          id: mockTripId,
          route_id: 'route-south-delhi',
          status: 'IN_TRANSIT',
          bus_id: mockBusId,
          driver_id: 'driver-rajesh',
          delay_minutes: 0,
          current_stop_sequence: 3,
          bus_number: 'DL-01-AB-1234',
          registration_number: 'DL1CAB1234',
          driver_name: 'Rajesh Kumar',
          driver_phone: '+919811122233',
          route_name: 'South Delhi Morning Route',
          route_code: 'R-12',
          route_type: 'PICKUP',
          total_stops: 8,
          latitude: 28.5584,
          longitude: 77.1623,
          speed_kmh: 24,
          bearing_degrees: 90,
          gps_recorded_at: new Date().toISOString(),
        },
      ]);

      // 3. createTrackingToken parent check
      querySpy.mockResolvedValueOnce([{ id: mockParentId }]);

      // 4. createTrackingToken insert token
      querySpy.mockResolvedValueOnce([{ id: 'tok-api-1', expires_at: new Date() }]);

      const res = await request(app)
        .get('/api/v1/parent/whatsapp/track-bus')
        .query({ phone: mockParentPhone });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data.student.fullName).toBe('Aarav Sharma');
      expect(data.bus.busNumber).toBe('DL-01-AB-1234');
      expect(data.bus.driverName).toBe('Rajesh Kumar');
      expect(data.location.latitude).toBe(28.5584);
      expect(data.location.speedKmh).toBe(24);
      expect(data.route.name).toBe('South Delhi Morning Route');
      expect(data.route.totalStops).toBe(8);
      expect(data.pickup.stopName).toBe('Vasant Vihar C-Block Market');
      expect(data.trip.status).toBe('IN_TRANSIT');
      expect(data.secureLink.trackingUrl).toContain('trk_');
      expect(data.formattedMessage).toContain('Live Bus Tracking');
    });

    it('rejects missing phone query parameter with 400 Bad Request', async () => {
      const res = await request(app).get('/api/v1/parent/whatsapp/track-bus');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('phone number query parameter is required');
    });

    it('returns 404 Not Found for unregistered phone number', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([]); // No parent found

      const res = await request(app)
        .get('/api/v1/parent/whatsapp/track-bus')
        .query({ phone: '+919999900000' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('Parent not found');
    });
  });
});
