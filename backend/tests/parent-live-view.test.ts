import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import * as db from '../src/config/database.js';
import { ParentIdentityService } from '../src/services/parent-identity.service.js';
import { EtaService } from '../src/services/eta.service.js';
import {
  ParentLiveTrackingSession,
  TripStatus,
  RouteType,
} from '@school-bus/shared';

const mockSchoolId = '11111111-1111-1111-1111-111111111111';
const mockParentId = '22222222-2222-2222-2222-222222222222';
const mockStudentId = '33333333-3333-3333-3333-333333333333';
const mockTokenId = '44444444-4444-4444-4444-444444444444';
const mockTripId = '66666666-6666-6666-6666-666666666666';
const mockRouteId = '77777777-7777-7777-7777-777777777777';
const mockStopId = '55555555-5555-5555-5555-555555555555';

describe('Phase 23.2: Parent Live Web Page — Live View (Bus Marker, Route, Pickup, ETA, Bus Number, Trip Status, Last Update)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(ParentIdentityService, 'recordTokenAccess').mockResolvedValue(undefined);
  });

  describe('1. Task: Bus marker, Route progression, Bus Number & Telemetry', () => {
    it('populates routeCode, totalStops, busNumber, bearing, and speed in activeTrip session', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Token lookup
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          trip_id: mockTripId,
          purpose: 'LIVE_TRACKING',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          revoked_at: null,
          deleted_at: null,
        },
      ]);

      // 2. Parent / student / school / stop details
      querySpy.mockResolvedValueOnce([
        {
          parent_id: mockParentId,
          parent_name: 'Pooja Verma',
          relationship: 'MOTHER',
          parent_phone: '+919876543210',
          student_id: mockStudentId,
          student_name: 'Aarav Sharma',
          admissionNumber: 'SCH-2026-089',
          class_grade: '5',
          section: 'B',
          roll_number: '12',
          emergency_contact_phone: '+919876543210',
          school_id: mockSchoolId,
          school_name: 'Delhi Public School',
          school_code: 'DPS-DELHI',
          school_timezone: 'Asia/Kolkata',
          stop_id: mockStopId,
          stop_name: 'Sector 4 Market',
          sequence_order: 3,
          scheduled_time: '07:35:00',
          stop_latitude: 28.5678,
          stop_longitude: 77.189,
          geofence_radius_meters: 150,
        },
      ]);

      // 4. Trip query with routeCode & totalStops
      querySpy.mockResolvedValueOnce([
        {
          trip_id: mockTripId,
          route_id: mockRouteId,
          trip_status: 'IN_TRANSIT',
          delay_minutes: 4,
          current_stop_sequence: 2,
          route_name: 'Route 4 - South Delhi',
          route_code: 'R-04',
          route_type: 'MORNING_PICKUP',
          total_stops: 8,
          bus_number: 'Bus 14',
          registration_number: 'DL-01-AB-1234',
          driver_name: 'Ramesh Kumar',
          driver_phone: '+919811122233',
        },
      ]);

      // 5. GPS location query
      querySpy.mockResolvedValueOnce([
        {
          latitude: 28.5601,
          longitude: 77.1802,
          speed_kmh: 38,
          bearing_degrees: 65,
          recorded_at: new Date().toISOString(),
        },
      ]);

      vi.spyOn(EtaService, 'calculateParentEta').mockResolvedValueOnce({
        isAvailable: true,
        status: 'ON_TIME',
        etaMinutes: 6,
        estimatedArrivalAt: new Date(Date.now() + 6 * 60000).toISOString(),
        distanceMeters: 1800,
        durationSeconds: 360,
        isApproaching: false,
        lastUpdatedAt: new Date().toISOString(),
      });

      const session = await ParentIdentityService.verifyTrackingToken('mock-raw-token-123');

      expect(session).toBeDefined();
      expect(session.isValid).toBe(true);
      expect(session.activeTrip).toBeDefined();

      const trip = session.activeTrip!;
      expect(trip.id).toBe(mockTripId);
      expect(trip.busNumber).toBe('Bus 14');
      expect(trip.registrationNumber).toBe('DL-01-AB-1234');
      expect(trip.routeName).toBe('Route 4 - South Delhi');
      expect(trip.routeCode).toBe('R-04');
      expect(trip.totalStops).toBe(8);
      expect(trip.currentStopSequence).toBe(2);
      expect(trip.status).toBe(TripStatus.IN_TRANSIT);
      expect(trip.delayMinutes).toBe(4);
      expect(trip.driverName).toBe('Ramesh Kumar');
      expect(trip.driverPhone).toBe('+919811122233');

      // Check GPS telemetry
      expect(trip.lastGpsLocation).toBeDefined();
      expect(trip.lastGpsLocation?.latitude).toBeCloseTo(28.5601);
      expect(trip.lastGpsLocation?.longitude).toBeCloseTo(77.1802);
      expect(trip.lastGpsLocation?.speedKmh).toBe(38);
      expect(trip.lastGpsLocation?.bearingDegrees).toBe(65);
    });

    it('handles stationary vehicle with null bearing correctly', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Token lookup
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          trip_id: mockTripId,
          purpose: 'LIVE_TRACKING',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          revoked_at: null,
          deleted_at: null,
        },
      ]);

      // 2. Parent / student / school / stop details
      querySpy.mockResolvedValueOnce([
        {
          parent_id: mockParentId,
          parent_name: 'Pooja Verma',
          relationship: 'MOTHER',
          parent_phone: '+919876543210',
          student_id: mockStudentId,
          student_name: 'Aarav Sharma',
          admissionNumber: 'SCH-2026-089',
          class_grade: '5',
          section: 'B',
          roll_number: '12',
          emergency_contact_phone: '+919876543210',
          school_id: mockSchoolId,
          school_name: 'Delhi Public School',
          school_code: 'DPS-DELHI',
          school_timezone: 'Asia/Kolkata',
          stop_id: mockStopId,
          stop_name: 'Sector 4 Market',
          sequence_order: 1,
          scheduled_time: '07:30:00',
          stop_latitude: 28.5678,
          stop_longitude: 77.189,
          geofence_radius_meters: 150,
        },
      ]);

      // 4. Trip query
      querySpy.mockResolvedValueOnce([
        {
          trip_id: mockTripId,
          route_id: mockRouteId,
          trip_status: 'DELAYED',
          delay_minutes: 12,
          current_stop_sequence: 1,
          route_name: 'Route 4 - South Delhi',
          route_code: null,
          route_type: 'MORNING_PICKUP',
          total_stops: 6,
          bus_number: 'Bus 08',
          registration_number: 'DL-01-XY-9999',
          driver_name: 'Sunil Singh',
          driver_phone: '+919800011122',
        },
      ]);

      // 5. GPS location query (stationary speed 0, no bearing)
      querySpy.mockResolvedValueOnce([
        {
          latitude: 28.5670,
          longitude: 77.1880,
          speed_kmh: 0,
          bearing_degrees: null,
          recorded_at: new Date().toISOString(),
        },
      ]);

      vi.spyOn(EtaService, 'calculateParentEta').mockResolvedValueOnce({
        isAvailable: true,
        status: 'DELAYED',
        etaMinutes: 14,
        estimatedArrivalAt: new Date(Date.now() + 14 * 60000).toISOString(),
        distanceMeters: 2400,
        durationSeconds: 840,
        isApproaching: false,
        lastUpdatedAt: new Date().toISOString(),
      });

      const session = await ParentIdentityService.verifyTrackingToken('mock-raw-token-stationary');
      expect(session.activeTrip?.status).toBe(TripStatus.DELAYED);
      expect(session.activeTrip?.delayMinutes).toBe(12);
      expect(session.activeTrip?.lastGpsLocation?.speedKmh).toBe(0);
      expect(session.activeTrip?.lastGpsLocation?.bearingDegrees).toBeUndefined();
    });
  });

  describe('2. Task: Trip Status handling & Verification Endpoint', () => {
    it('returns full Live View payload with active trip details via /api/v1/parent/track/:token/verify-entry', async () => {
      const mockSession: ParentLiveTrackingSession = {
        isValid: true,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        parent: {
          id: mockParentId,
          fullName: 'Pooja Verma',
          relationship: 'MOTHER',
          phone: '+919876543210',
        },
        student: {
          id: mockStudentId,
          schoolId: mockSchoolId,
          fullName: 'Aarav Sharma',
          admissionNumber: 'SCH-2026-089',
          classGrade: '5',
          section: 'B',
        },
        school: {
          id: mockSchoolId,
          name: 'Delhi Public School',
          code: 'DPS-DELHI',
          timezone: 'Asia/Kolkata',
        },
        pickupStop: {
          id: mockStopId,
          stopName: 'Sector 4 Market',
          sequenceOrder: 3,
          scheduledTime: '07:35:00',
          latitude: 28.5678,
          longitude: 77.189,
          geofenceRadiusMeters: 150,
        },
        activeTrip: {
          id: mockTripId,
          routeId: mockRouteId,
          routeName: 'Route 4 - South Delhi',
          routeCode: 'R-04',
          totalStops: 8,
          routeType: RouteType.MORNING_PICKUP,
          status: TripStatus.IN_TRANSIT,
          busNumber: 'Bus 14',
          registrationNumber: 'DL-01-AB-1234',
          driverName: 'Ramesh Kumar',
          driverPhone: '+919811122233',
          delayMinutes: 0,
          currentStopSequence: 2,
          lastGpsLocation: {
            latitude: 28.5601,
            longitude: 77.1802,
            speedKmh: 42,
            bearingDegrees: 90,
            recordedAt: new Date().toISOString(),
          },
        },
        parentEta: {
          isAvailable: true,
          status: 'ON_TIME',
          etaMinutes: 7,
          estimatedArrivalAt: new Date(Date.now() + 7 * 60000).toISOString(),
          distanceMeters: 1850,
          durationSeconds: 420,
          isApproaching: false,
          lastUpdatedAt: new Date().toISOString(),
        },
      };

      const querySpy = vi.spyOn(db, 'query');
      // validateTrackingTokenForWeb lookup
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          trip_id: mockTripId,
          purpose: 'LIVE_TRACKING',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          revoked_at: null,
          deleted_at: null,
          school_name: 'Delhi Public School',
          school_phone: '+91-11-26174567',
          school_emergency_phone: '+91-11-26179999',
        },
      ]);

      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockResolvedValueOnce(mockSession);

      const res = await request(app)
        .get('/api/v1/parent/track/valid-live-token/verify-entry')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('VALID');
      expect(res.body.data.session).toBeDefined();

      const s = res.body.data.session;
      expect(s.activeTrip.busNumber).toBe('Bus 14');
      expect(s.activeTrip.routeCode).toBe('R-04');
      expect(s.activeTrip.totalStops).toBe(8);
      expect(s.activeTrip.lastGpsLocation.bearingDegrees).toBe(90);
      expect(s.activeTrip.lastGpsLocation.speedKmh).toBe(42);
      expect(s.parentEta.etaMinutes).toBe(7);
      expect(s.pickupStop.stopName).toBe('Sector 4 Market');
    });

    it('correctly handles EMERGENCY status in session', async () => {
      const mockEmergencySession: ParentLiveTrackingSession = {
        isValid: true,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        parent: {
          id: mockParentId,
          fullName: 'Pooja Verma',
          relationship: 'MOTHER',
          phone: '+919876543210',
        },
        student: {
          id: mockStudentId,
          schoolId: mockSchoolId,
          fullName: 'Aarav Sharma',
          admissionNumber: 'SCH-2026-089',
        },
        school: {
          id: mockSchoolId,
          name: 'Delhi Public School',
          code: 'DPS-DELHI',
          timezone: 'Asia/Kolkata',
        },
        activeTrip: {
          id: mockTripId,
          routeId: mockRouteId,
          routeName: 'Route 4 - South Delhi',
          routeType: RouteType.MORNING_PICKUP,
          status: TripStatus.EMERGENCY,
          busNumber: 'Bus 14',
          registrationNumber: 'DL-01-AB-1234',
          driverName: 'Ramesh Kumar',
          driverPhone: '+919811122233',
          delayMinutes: 25,
          currentStopSequence: 1,
          lastGpsLocation: null,
        },
      };

      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          trip_id: mockTripId,
          purpose: 'LIVE_TRACKING',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          revoked_at: null,
          deleted_at: null,
          school_name: 'Delhi Public School',
          school_phone: '+91-11-26174567',
          school_emergency_phone: '+91-11-26179999',
        },
      ]);

      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockResolvedValueOnce(mockEmergencySession);

      const res = await request(app)
        .get('/api/v1/parent/track/emergency-token/verify-entry')
        .expect(200);

      expect(res.body.data.session.activeTrip.status).toBe(TripStatus.EMERGENCY);
      expect(res.body.data.schoolSupport.emergencyPhone).toBe('+91-11-26179999');
    });

    it('handles approaching bus status (within 500m) in parent session', async () => {
      const mockApproachingSession: ParentLiveTrackingSession = {
        isValid: true,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        parent: {
          id: mockParentId,
          fullName: 'Pooja Verma',
          relationship: 'MOTHER',
          phone: '+919876543210',
        },
        student: {
          id: mockStudentId,
          schoolId: mockSchoolId,
          fullName: 'Aarav Sharma',
          admissionNumber: 'SCH-2026-089',
        },
        school: {
          id: mockSchoolId,
          name: 'Delhi Public School',
          code: 'DPS-DELHI',
          timezone: 'Asia/Kolkata',
        },
        pickupStop: {
          id: mockStopId,
          stopName: 'Sector 4 Market',
          sequenceOrder: 3,
          scheduledTime: '07:35:00',
          latitude: 28.5678,
          longitude: 77.189,
          geofenceRadiusMeters: 150,
        },
        activeTrip: {
          id: mockTripId,
          routeId: mockRouteId,
          routeName: 'Route 4 - South Delhi',
          routeType: RouteType.MORNING_PICKUP,
          status: TripStatus.IN_TRANSIT,
          busNumber: 'Bus 14',
          registrationNumber: 'DL-01-AB-1234',
          driverName: 'Ramesh Kumar',
          driverPhone: '+919811122233',
          delayMinutes: 0,
          currentStopSequence: 2,
          lastGpsLocation: {
            latitude: 28.5670,
            longitude: 77.1885,
            speedKmh: 18,
            bearingDegrees: 45,
            recordedAt: new Date().toISOString(),
          },
        },
        parentEta: {
          isAvailable: true,
          status: 'ON_TIME',
          etaMinutes: 1,
          estimatedArrivalAt: new Date(Date.now() + 60000).toISOString(),
          distanceMeters: 180,
          durationSeconds: 50,
          isApproaching: true,
          lastUpdatedAt: new Date().toISOString(),
        },
      };

      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          trip_id: mockTripId,
          purpose: 'LIVE_TRACKING',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          revoked_at: null,
          deleted_at: null,
          school_name: 'Delhi Public School',
          school_phone: '+91-11-26174567',
          school_emergency_phone: '+91-11-26179999',
        },
      ]);

      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockResolvedValueOnce(mockApproachingSession);

      const res = await request(app)
        .get('/api/v1/parent/track/approaching-token/verify-entry')
        .expect(200);

      expect(res.body.data.session.parentEta.isApproaching).toBe(true);
      expect(res.body.data.session.parentEta.distanceMeters).toBe(180);
      expect(res.body.data.session.parentEta.durationSeconds).toBe(50);
    });

    it('handles session with ARRIVED_SCHOOL status', async () => {
      const mockArrivedSession: ParentLiveTrackingSession = {
        isValid: true,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        parent: {
          id: mockParentId,
          fullName: 'Pooja Verma',
          relationship: 'MOTHER',
          phone: '+919876543210',
        },
        student: {
          id: mockStudentId,
          schoolId: mockSchoolId,
          fullName: 'Aarav Sharma',
          admissionNumber: 'SCH-2026-089',
        },
        school: {
          id: mockSchoolId,
          name: 'Delhi Public School',
          code: 'DPS-DELHI',
          timezone: 'Asia/Kolkata',
        },
        activeTrip: {
          id: mockTripId,
          routeId: mockRouteId,
          routeName: 'Route 4 - South Delhi',
          routeType: RouteType.MORNING_PICKUP,
          status: TripStatus.ARRIVED_SCHOOL,
          busNumber: 'Bus 14',
          registrationNumber: 'DL-01-AB-1234',
          driverName: 'Ramesh Kumar',
          delayMinutes: 0,
          currentStopSequence: 8,
          lastGpsLocation: null,
        },
      };

      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          trip_id: mockTripId,
          purpose: 'LIVE_TRACKING',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          revoked_at: null,
          deleted_at: null,
          school_name: 'Delhi Public School',
        },
      ]);

      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockResolvedValueOnce(mockArrivedSession);

      const res = await request(app)
        .get('/api/v1/parent/track/arrived-token/verify-entry')
        .expect(200);

      expect(res.body.data.session.activeTrip.status).toBe(TripStatus.ARRIVED_SCHOOL);
    });

    it('handles session when no trip is currently in progress (activeTrip is null)', async () => {
      const mockNoTripSession: ParentLiveTrackingSession = {
        isValid: true,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        parent: {
          id: mockParentId,
          fullName: 'Pooja Verma',
          relationship: 'MOTHER',
          phone: '+919876543210',
        },
        student: {
          id: mockStudentId,
          schoolId: mockSchoolId,
          fullName: 'Aarav Sharma',
          admissionNumber: 'SCH-2026-089',
        },
        school: {
          id: mockSchoolId,
          name: 'Delhi Public School',
          code: 'DPS-DELHI',
          timezone: 'Asia/Kolkata',
        },
        pickupStop: {
          id: mockStopId,
          stopName: 'Sector 4 Market',
          sequenceOrder: 2,
          scheduledTime: '07:30:00',
          latitude: 28.5678,
          longitude: 77.189,
          geofenceRadiusMeters: 150,
        },
        activeTrip: null,
        parentEta: null,
      };

      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          trip_id: null,
          purpose: 'LIVE_TRACKING',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          revoked_at: null,
          deleted_at: null,
          school_name: 'Delhi Public School',
        },
      ]);

      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockResolvedValueOnce(mockNoTripSession);

      const res = await request(app)
        .get('/api/v1/parent/track/no-trip-token/verify-entry')
        .expect(200);

      expect(res.body.data.session.activeTrip).toBeNull();
      expect(res.body.data.session.pickupStop.stopName).toBe('Sector 4 Market');
    });
  });

  describe('3. Task: Micro-phase 23.3 Failure States (Bus offline, Stale location, Trip ended, Invalid link)', () => {
    it('handles bus offline state when GPS telemetry is older than 5 minutes (lost)', async () => {
      const querySpy = vi.spyOn(db, 'query');
      const fiveMinutesAgo = new Date(Date.now() - 360 * 1000).toISOString();

      // 1. Token lookup
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          trip_id: mockTripId,
          purpose: 'LIVE_TRACKING',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          revoked_at: null,
          deleted_at: null,
        },
      ]);

      // 2. Parent / student / school / stop details
      querySpy.mockResolvedValueOnce([
        {
          parent_id: mockParentId,
          parent_name: 'Pooja Verma',
          relationship: 'MOTHER',
          parent_phone: '+919876543210',
          student_id: mockStudentId,
          student_name: 'Aarav Sharma',
          school_id: mockSchoolId,
          school_name: 'Delhi Public School',
          school_code: 'DPS-DELHI',
          school_timezone: 'Asia/Kolkata',
          stop_id: mockStopId,
          stop_name: 'Sector 4 Market',
          sequence_order: 3,
          scheduled_time: '07:35:00',
          stop_latitude: 28.5678,
          stop_longitude: 77.189,
          geofence_radius_meters: 150,
        },
      ]);

      // 3. Trip query
      querySpy.mockResolvedValueOnce([
        {
          trip_id: mockTripId,
          route_id: mockRouteId,
          trip_status: 'IN_TRANSIT',
          delay_minutes: 0,
          current_stop_sequence: 2,
          route_name: 'Route 4 - South Delhi',
          route_code: 'R-04',
          route_type: 'MORNING_PICKUP',
          total_stops: 8,
          bus_number: 'Bus 14',
          registration_number: 'DL-01-AB-1234',
          driver_name: 'Ramesh Kumar',
          driver_phone: '+919811122233',
        },
      ]);

      // 4. GPS location query (6 minutes old telemetry)
      querySpy.mockResolvedValueOnce([
        {
          latitude: 28.5601,
          longitude: 77.1802,
          speed_kmh: 0,
          bearing_degrees: 0,
          recorded_at: fiveMinutesAgo,
        },
      ]);

      vi.spyOn(EtaService, 'calculateParentEta').mockResolvedValueOnce({
        isAvailable: false,
        status: 'UNAVAILABLE',
        etaMinutes: null,
        estimatedArrivalAt: null,
        distanceMeters: null,
        durationSeconds: null,
        isApproaching: false,
        unavailableReason: 'GPS_UNAVAILABLE',
        unavailableMessage: 'GPS offline',
        lastUpdatedAt: fiveMinutesAgo,
      });

      const session = await ParentIdentityService.verifyTrackingToken('mock-bus-offline-token');
      expect(session.activeTrip?.status).toBe(TripStatus.IN_TRANSIT);
      expect(session.activeTrip?.lastGpsLocation).toBeDefined();
      expect(session.activeTrip?.lastGpsLocation?.recordedAt).toBe(fiveMinutesAgo);

      // Verify age is greater than 300 seconds (5 minutes)
      const ageSec = (Date.now() - new Date(session.activeTrip!.lastGpsLocation!.recordedAt).getTime()) / 1000;
      expect(ageSec).toBeGreaterThan(300);
    });

    it('handles stale location state when GPS telemetry is between 2 and 5 minutes old', async () => {
      const querySpy = vi.spyOn(db, 'query');
      const threeMinutesAgo = new Date(Date.now() - 180 * 1000).toISOString();

      // 1. Token lookup
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          trip_id: mockTripId,
          purpose: 'LIVE_TRACKING',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          revoked_at: null,
          deleted_at: null,
        },
      ]);

      // 2. Parent / student / school / stop details
      querySpy.mockResolvedValueOnce([
        {
          parent_id: mockParentId,
          parent_name: 'Pooja Verma',
          relationship: 'MOTHER',
          parent_phone: '+919876543210',
          student_id: mockStudentId,
          student_name: 'Aarav Sharma',
          school_id: mockSchoolId,
          school_name: 'Delhi Public School',
          school_code: 'DPS-DELHI',
          school_timezone: 'Asia/Kolkata',
          stop_id: mockStopId,
          stop_name: 'Sector 4 Market',
          sequence_order: 3,
          scheduled_time: '07:35:00',
          stop_latitude: 28.5678,
          stop_longitude: 77.189,
          geofence_radius_meters: 150,
        },
      ]);

      // 3. Trip query
      querySpy.mockResolvedValueOnce([
        {
          trip_id: mockTripId,
          route_id: mockRouteId,
          trip_status: 'IN_TRANSIT',
          delay_minutes: 2,
          current_stop_sequence: 2,
          route_name: 'Route 4 - South Delhi',
          route_code: 'R-04',
          route_type: 'MORNING_PICKUP',
          total_stops: 8,
          bus_number: 'Bus 14',
          registration_number: 'DL-01-AB-1234',
          driver_name: 'Ramesh Kumar',
          driver_phone: '+919811122233',
        },
      ]);

      // 4. GPS location query (3 minutes old telemetry)
      querySpy.mockResolvedValueOnce([
        {
          latitude: 28.5620,
          longitude: 77.1830,
          speed_kmh: 22,
          bearing_degrees: 70,
          recorded_at: threeMinutesAgo,
        },
      ]);

      vi.spyOn(EtaService, 'calculateParentEta').mockResolvedValueOnce({
        isAvailable: true,
        status: 'ON_TIME',
        etaMinutes: 5,
        estimatedArrivalAt: new Date(Date.now() + 5 * 60000).toISOString(),
        distanceMeters: 1400,
        durationSeconds: 300,
        isApproaching: false,
        lastUpdatedAt: threeMinutesAgo,
      });

      const session = await ParentIdentityService.verifyTrackingToken('mock-stale-loc-token');
      expect(session.activeTrip?.lastGpsLocation).toBeDefined();

      const ageSec = (Date.now() - new Date(session.activeTrip!.lastGpsLocation!.recordedAt).getTime()) / 1000;
      expect(ageSec).toBeGreaterThanOrEqual(120);
      expect(ageSec).toBeLessThan(300);
    });

    it('handles trip ended (COMPLETED) state in parent session', async () => {
      const mockCompletedSession: ParentLiveTrackingSession = {
        isValid: true,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        parent: {
          id: mockParentId,
          fullName: 'Pooja Verma',
          relationship: 'MOTHER',
          phone: '+919876543210',
        },
        student: {
          id: mockStudentId,
          schoolId: mockSchoolId,
          fullName: 'Aarav Sharma',
          admissionNumber: 'SCH-2026-089',
        },
        school: {
          id: mockSchoolId,
          name: 'Delhi Public School',
          code: 'DPS-DELHI',
          timezone: 'Asia/Kolkata',
        },
        pickupStop: {
          id: mockStopId,
          stopName: 'Sector 4 Market',
          sequenceOrder: 3,
          scheduledTime: '07:35:00',
          latitude: 28.5678,
          longitude: 77.189,
          geofenceRadiusMeters: 150,
        },
        activeTrip: {
          id: mockTripId,
          routeId: mockRouteId,
          routeName: 'Route 4 - South Delhi',
          routeType: RouteType.MORNING_PICKUP,
          status: TripStatus.COMPLETED,
          busNumber: 'Bus 14',
          registrationNumber: 'DL-01-AB-1234',
          driverName: 'Ramesh Kumar',
          delayMinutes: 0,
          currentStopSequence: 8,
          lastGpsLocation: null,
        },
      };

      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          trip_id: mockTripId,
          purpose: 'LIVE_TRACKING',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          revoked_at: null,
          deleted_at: null,
          school_name: 'Delhi Public School',
        },
      ]);

      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockResolvedValueOnce(mockCompletedSession);

      const res = await request(app)
        .get('/api/v1/parent/track/completed-trip-token/verify-entry')
        .expect(200);

      expect(res.body.data.session.activeTrip.status).toBe(TripStatus.COMPLETED);
    });

    it('handles invalid link errors with distinct error reasons', async () => {
      // 1. Missing token
      const resMissing = await request(app)
        .get('/api/v1/parent/track/%20/verify-entry')
        .expect(200);
      expect(resMissing.body.data.status).toBe('MISSING');
      expect(resMissing.body.data.errorCode).toBe('TOKEN_MISSING');

      // 2. Invalid / Non-existent token
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([]); // No token row found

      const resInvalid = await request(app)
        .get('/api/v1/parent/track/non-existent-hash-token/verify-entry')
        .expect(200);
      expect(resInvalid.body.data.status).toBe('INVALID');
      expect(resInvalid.body.data.errorCode).toBe('TOKEN_INVALID');

      // 3. Expired token
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          trip_id: null,
          purpose: 'LIVE_TRACKING',
          expires_at: new Date(Date.now() - 3600000).toISOString(), // expired 1h ago
          revoked_at: null,
          deleted_at: null,
          school_name: 'Delhi Public School',
          school_phone: '+91-11-26174567',
        },
      ]);

      const resExpired = await request(app)
        .get('/api/v1/parent/track/expired-hash-token/verify-entry')
        .expect(200);
      expect(resExpired.body.data.status).toBe('EXPIRED');
      expect(resExpired.body.data.errorCode).toBe('TOKEN_EXPIRED');
      expect(resExpired.body.data.schoolSupport.supportPhone).toBe('+91-11-26174567');

      // 4. Revoked token
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          trip_id: null,
          purpose: 'LIVE_TRACKING',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          revoked_at: new Date(Date.now() - 1800000).toISOString(), // revoked 30m ago
          deleted_at: null,
          school_name: 'Delhi Public School',
          school_emergency_phone: '+91-11-26179999',
        },
      ]);

      const resRevoked = await request(app)
        .get('/api/v1/parent/track/revoked-hash-token/verify-entry')
        .expect(200);
      expect(resRevoked.body.data.status).toBe('REVOKED');
      expect(resRevoked.body.data.errorCode).toBe('TOKEN_REVOKED');
      expect(resRevoked.body.data.schoolSupport.emergencyPhone).toBe('+91-11-26179999');
    });
  });
});
