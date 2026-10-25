import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import * as db from '../src/config/database.js';
import { ParentWhatsappService } from '../src/services/parent-whatsapp.service.js';
import { ParentMyEtaResponseSchema, TripStatus } from '@school-bus/shared';
import { EtaService } from '../src/services/eta.service.js';
import { ParentIdentityService } from '../src/services/parent-identity.service.js';

const mockSchoolId = '11111111-1111-1111-1111-111111111111';
const mockParentId = '22222222-2222-2222-2222-222222222222';
const mockStudentId = '33333333-3333-3333-3333-333333333333';
const mockStopId = '44444444-4444-4444-4444-444444444444';
const mockTripId = '55555555-5555-5555-5555-555555555555';
const mockBusId = '66666666-6666-6666-6666-666666666666';
const mockRouteId = '77777777-7777-7777-7777-777777777777';
const mockDriverId = '88888888-8888-8888-8888-888888888888';
const mockParentPhone = '+919876543210';

const mockParentDbRow = {
  parent_id: mockParentId,
  parent_name: 'Rajesh Sharma',
  parent_phone: mockParentPhone,
  parent_email: 'rajesh.sharma@example.com',
  relationship: 'FATHER',
  school_id: mockSchoolId,
  school_name: 'Delhi Public School, R.K. Puram',
  school_code: 'DPS-RKP',
  school_phone: '+91-11-26174567',
  school_emergency_phone: '+91-11-26179999',
  student_id: mockStudentId,
  student_name: 'Aarav Sharma',
  admission_number: 'DPS-2024-042',
  class_grade: 'Class 5',
  section: 'A',
  roll_number: '14',
  stop_id: mockStopId,
  stop_name: 'Sector 4 Market',
  scheduled_time: '07:35:00',
  sequence_order: 3,
  geofence_radius_meters: 150,
  stop_lat: '28.5678',
  stop_lon: '77.1890',
};

const mockInTransitTripDbRow = {
  id: mockTripId,
  route_id: mockRouteId,
  status: TripStatus.IN_TRANSIT,
  bus_id: mockBusId,
  bus_number: '12',
  registration_number: 'DL-01-AB-1234',
  driver_id: mockDriverId,
  driver_name: 'Suresh Kumar',
  driver_phone: '+919811122233',
  route_name: 'Route 4 - South Delhi',
  route_code: 'R-04',
  route_type: 'MORNING_PICKUP',
  delay_minutes: 0,
  current_stop_sequence: 2,
  total_stops: 8,
  latitude: 28.5601,
  longitude: 77.1802,
  speed_kmh: 32.5,
  bearing_degrees: 45.0,
  gps_recorded_at: new Date(Date.now() - 30 * 1000).toISOString(), // 30s ago
};

describe('Phase 22.3: Parent WhatsApp — My ETA', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(ParentIdentityService, 'createTrackingToken').mockResolvedValue({
      token: 'mock-secure-token-12345',
      trackingUrl: 'https://tracking.schoolbus.in/track/mock-secure-token-12345',
      expiresAt: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    });
  });

  describe('1. Return Latest ETA (Task 1)', () => {
    it('returns calculated arrival minutes, distance, arrival timestamp, and approaching indicator', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext (atomic in-transit trip with GPS)
      querySpy.mockResolvedValueOnce([mockInTransitTripDbRow]);

      const etaSpy = vi.spyOn(EtaService, 'calculateParentEta').mockResolvedValueOnce({
        tripId: mockTripId,
        schoolId: mockSchoolId,
        stopId: mockStopId,
        stopName: 'Sector 4 Market',
        sequenceOrder: 3,
        durationSeconds: 240,
        distanceMeters: 1200,
        etaMinutes: 4,
        estimatedArrivalAt: new Date(Date.now() + 4 * 60 * 1000).toISOString(),
        status: 'APPROACHING' as any,
        isAvailable: true,
        isApproaching: true,
        isPassed: false,
        unavailableReason: null,
        unavailableMessage: null,
        effectiveSpeedKmh: 30,
        lastUpdatedAt: new Date().toISOString(),
        calculatedAt: new Date().toISOString(),
      });

      const res = await ParentWhatsappService.getMyEtaDetails(mockParentPhone, mockSchoolId);

      expect(res).not.toBeNull();
      // Validate schema compliance
      const validated = ParentMyEtaResponseSchema.parse(res);
      expect(validated.eta.isAvailable).toBe(true);
      expect(validated.eta.etaMinutes).toBe(4);
      expect(validated.eta.distanceMeters).toBe(1200);
      expect(validated.eta.isApproaching).toBe(true);
      expect(validated.eta.isPassed).toBe(false);
      expect(validated.eta.status).toBe('APPROACHING');
      expect(validated.eta.estimatedArrivalAt).toBeDefined();

      // Formatted WhatsApp message checks
      expect(validated.formattedMessage).toContain('⏱️ *Bus Arrival ETA* ⚠️ *Bus is Approaching!*');
      expect(validated.formattedMessage).toContain('Expected Arrival: *4 mins*');
      expect(validated.formattedMessage).toContain('1.2 km away');
      expect(validated.formattedMessage).toContain('Bus: *#12*');
      expect(validated.formattedMessage).toContain('Sector 4 Market');

      expect(etaSpy).toHaveBeenCalledWith({
        tripId: mockTripId,
        schoolId: mockSchoolId,
        stopId: mockStopId,
      });
    });
  });

  describe('2. Return Last Update Recency & Telemetry (Task 2)', () => {
    it('returns formatted recency, movement status, and speed when telemetry is fresh', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext with 2-minute old GPS reading moving at 28 km/h
      const twoMinutesAgoIso = new Date(Date.now() - 130 * 1000).toISOString();
      querySpy.mockResolvedValueOnce([
        {
          ...mockInTransitTripDbRow,
          speed_kmh: 28.4,
          gps_recorded_at: twoMinutesAgoIso,
        },
      ]);

      vi.spyOn(EtaService, 'calculateParentEta').mockResolvedValueOnce({
        tripId: mockTripId,
        schoolId: mockSchoolId,
        stopId: mockStopId,
        stopName: 'Sector 4 Market',
        sequenceOrder: 3,
        durationSeconds: 480,
        distanceMeters: 2800,
        etaMinutes: 8,
        estimatedArrivalAt: new Date(Date.now() + 8 * 60 * 1000).toISOString(),
        status: 'EN_ROUTE' as any,
        isAvailable: true,
        isApproaching: false,
        isPassed: false,
        unavailableReason: null,
        unavailableMessage: null,
        effectiveSpeedKmh: 28,
        lastUpdatedAt: twoMinutesAgoIso,
        calculatedAt: new Date().toISOString(),
      });

      const res = await ParentWhatsappService.getMyEtaDetails(mockParentPhone, mockSchoolId);

      expect(res).not.toBeNull();
      const validated = ParentMyEtaResponseSchema.parse(res);

      expect(validated.lastUpdate).not.toBeNull();
      expect(validated.lastUpdate?.recordedAt).toBe(twoMinutesAgoIso);
      expect(validated.lastUpdate?.isMoving).toBe(true);
      expect(validated.lastUpdate?.speedKmh).toBe(28.4);
      expect(validated.lastUpdate?.recencyText).toBe('Updated 2m ago');

      // Message includes telemetry line
      expect(validated.formattedMessage).toContain('📡 *Last Update:* Updated 2m ago • Moving at 28 km/h');
    });

    it('reports stationary when speed is 0 or below movement threshold', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      querySpy.mockResolvedValueOnce([
        {
          ...mockInTransitTripDbRow,
          speed_kmh: 0,
          gps_recorded_at: new Date().toISOString(),
        },
      ]);

      vi.spyOn(EtaService, 'calculateParentEta').mockResolvedValueOnce({
        tripId: mockTripId,
        schoolId: mockSchoolId,
        stopId: mockStopId,
        durationSeconds: 600,
        distanceMeters: 3000,
        etaMinutes: 10,
        status: 'EN_ROUTE' as any,
        isAvailable: true,
        isApproaching: false,
        isPassed: false,
      } as any);

      const res = await ParentWhatsappService.getMyEtaDetails(mockParentPhone, mockSchoolId);

      expect(res).not.toBeNull();
      const validated = ParentMyEtaResponseSchema.parse(res);
      expect(validated.lastUpdate?.isMoving).toBe(false);
      expect(validated.formattedMessage).toContain('Stationary');
    });
  });

  describe('3. Handle Unavailable ETA (Task 3)', () => {
    it('handles bus idle / trip not started with scheduled pickup time and calm status', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext with SCHEDULED trip
      querySpy.mockResolvedValueOnce([
        {
          ...mockInTransitTripDbRow,
          status: TripStatus.SCHEDULED,
        },
      ]);

      const res = await ParentWhatsappService.getMyEtaDetails(mockParentPhone, mockSchoolId);

      expect(res).not.toBeNull();
      const validated = ParentMyEtaResponseSchema.parse(res);
      expect(validated.eta.isAvailable).toBe(false);
      expect(validated.eta.status).toBe('TRIP_NOT_STARTED');
      expect(validated.eta.unavailableReason).toBe('TRIP_NOT_STARTED');
      expect(validated.formattedMessage).toContain('Bus Not Currently in Transit');
      expect(validated.formattedMessage).toContain('07:35:00');
    });

    it('handles stop already passed gracefully with clear departed notice', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext (in-transit trip)
      querySpy.mockResolvedValueOnce([mockInTransitTripDbRow]);

      // EtaService indicates stop is passed
      vi.spyOn(EtaService, 'calculateParentEta').mockResolvedValueOnce({
        tripId: mockTripId,
        schoolId: mockSchoolId,
        stopId: mockStopId,
        stopName: 'Sector 4 Market',
        sequenceOrder: 3,
        durationSeconds: null,
        distanceMeters: null,
        etaMinutes: null,
        estimatedArrivalAt: null,
        status: 'PASSED' as any,
        isAvailable: false,
        unavailableReason: 'STOP_ALREADY_PASSED',
        unavailableMessage: 'The bus has already passed Sector 4 Market.',
        isApproaching: false,
        isPassed: true,
        effectiveSpeedKmh: 0,
        lastUpdatedAt: new Date().toISOString(),
        calculatedAt: new Date().toISOString(),
      });

      const res = await ParentWhatsappService.getMyEtaDetails(mockParentPhone, mockSchoolId);

      expect(res).not.toBeNull();
      const validated = ParentMyEtaResponseSchema.parse(res);
      expect(validated.eta.isAvailable).toBe(false);
      expect(validated.eta.isPassed).toBe(true);
      expect(validated.eta.status).toBe('PASSED');
      expect(validated.eta.unavailableReason).toBe('STOP_ALREADY_PASSED');
      expect(validated.formattedMessage).toContain('Bus Already Passed Your Stop');
      expect(validated.formattedMessage).toContain('already departed from *Sector 4 Market*');
    });

    it('handles GPS telemetry synchronizing or offline', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext
      querySpy.mockResolvedValueOnce([mockInTransitTripDbRow]);

      // EtaService indicates GPS offline / stale
      vi.spyOn(EtaService, 'calculateParentEta').mockResolvedValueOnce({
        tripId: mockTripId,
        schoolId: mockSchoolId,
        stopId: mockStopId,
        stopName: 'Sector 4 Market',
        sequenceOrder: 3,
        durationSeconds: null,
        distanceMeters: null,
        etaMinutes: null,
        estimatedArrivalAt: null,
        status: 'GPS_OFFLINE' as any,
        isAvailable: false,
        unavailableReason: 'GPS_OFFLINE',
        unavailableMessage: 'GPS signal is currently offline. Telemetry is synchronizing.',
        isApproaching: false,
        isPassed: false,
        effectiveSpeedKmh: 0,
        lastUpdatedAt: null,
        calculatedAt: new Date().toISOString(),
      });

      const res = await ParentWhatsappService.getMyEtaDetails(mockParentPhone, mockSchoolId);

      expect(res).not.toBeNull();
      const validated = ParentMyEtaResponseSchema.parse(res);
      expect(validated.eta.isAvailable).toBe(false);
      expect(validated.eta.status).toBe('GPS_OFFLINE');
      expect(validated.formattedMessage).toContain('GPS signal is currently offline');
    });

    it('handles parent with no pickup stop assigned', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // Parent with no stop_id
      querySpy.mockResolvedValueOnce([
        {
          ...mockParentDbRow,
          stop_id: null,
          stop_name: null,
          scheduled_time: null,
        },
      ]);
      // Trip context returns null because no stopId
      const res = await ParentWhatsappService.getMyEtaDetails(mockParentPhone, mockSchoolId);

      expect(res).not.toBeNull();
      const validated = ParentMyEtaResponseSchema.parse(res);
      expect(validated.stop).toBeNull();
      expect(validated.eta.isAvailable).toBe(false);
      expect(validated.eta.status).toBe('NO_STOP_ASSIGNED');
      expect(validated.formattedMessage).toContain('No Pickup Stop Assigned');
      expect(validated.formattedMessage).toContain('coordinator to configure your pickup stop');
    });
  });

  describe('4. Dedicated API Endpoint: GET /api/v1/parent/whatsapp/eta', () => {
    it('returns structured JSON payload via GET /eta', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext
      querySpy.mockResolvedValueOnce([mockInTransitTripDbRow]);

      vi.spyOn(EtaService, 'calculateParentEta').mockResolvedValueOnce({
        tripId: mockTripId,
        schoolId: mockSchoolId,
        stopId: mockStopId,
        stopName: 'Sector 4 Market',
        sequenceOrder: 3,
        durationSeconds: 300,
        distanceMeters: 1500,
        etaMinutes: 5,
        estimatedArrivalAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        status: 'APPROACHING' as any,
        isAvailable: true,
        isApproaching: true,
        isPassed: false,
        unavailableReason: null,
        unavailableMessage: null,
        effectiveSpeedKmh: 30,
        lastUpdatedAt: new Date().toISOString(),
        calculatedAt: new Date().toISOString(),
      });

      const res = await request(app)
        .get('/api/v1/parent/whatsapp/eta')
        .query({
          phone: mockParentPhone,
          schoolId: mockSchoolId,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.student.fullName).toBe('Aarav Sharma');
      expect(res.body.data.stop.stopName).toBe('Sector 4 Market');
      expect(res.body.data.eta.isAvailable).toBe(true);
      expect(res.body.data.eta.etaMinutes).toBe(5);
      expect(res.body.data.trackingUrl).toContain('https://tracking.schoolbus.in');

      // Schema verification on API output
      const validated = ParentMyEtaResponseSchema.parse(res.body.data);
      expect(validated.eta.etaMinutes).toBe(5);
    });

    it('returns 400 Bad Request when phone query parameter is omitted', async () => {
      const res = await request(app).get('/api/v1/parent/whatsapp/eta');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('phone number');
    });

    it('returns 404 Not Found when parent does not exist', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([]); // no parent found

      const res = await request(app)
        .get('/api/v1/parent/whatsapp/eta')
        .query({ phone: '+919999999999' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
