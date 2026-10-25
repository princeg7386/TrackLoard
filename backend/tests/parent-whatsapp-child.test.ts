import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import * as db from '../src/config/database.js';
import { ParentWhatsappService } from '../src/services/parent-whatsapp.service.js';
import { ParentMyChildResponseSchema, TripStatus } from '@school-bus/shared';

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
  gps_recorded_at: new Date().toISOString(),
};

describe('Phase 22.4: Parent WhatsApp — My Child', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Current Journey Status & Boarding Status', () => {
    it('reports ON_BUS journey status and BOARDED attendance when student has boarded in-transit bus', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext (active trip)
      querySpy.mockResolvedValueOnce([mockInTransitTripDbRow]);
      // 3. handleMyChild attendance query: boarding event only
      const boardingTime = new Date('2026-10-25T07:42:00+05:30').toISOString();
      querySpy.mockResolvedValueOnce([
        {
          event_type: 'BOARDING',
          status: 'BOARDED',
          recorded_at: boardingTime,
          marked_by: 'DRIVER',
          stop_name: 'Sector 4 Market',
        },
      ]);

      const res = await ParentWhatsappService.getMyChildDetails(mockParentPhone, mockSchoolId);

      expect(res).not.toBeNull();
      const validated = ParentMyChildResponseSchema.parse(res);

      // Student info
      expect(validated.student.fullName).toBe('Aarav Sharma');
      expect(validated.student.admissionNumber).toBe('DPS-2024-042');
      expect(validated.student.classGrade).toBe('Class 5');
      expect(validated.student.section).toBe('A');

      // Journey status
      expect(validated.journey.status).toBe('ON_BUS');
      expect(validated.journey.statusLabel).toContain('On Bus — In Transit');

      // Boarding status
      expect(validated.boarding.isBoarded).toBe(true);
      expect(validated.boarding.status).toBe('BOARDED');
      expect(validated.boarding.stopName).toBe('Sector 4 Market');
      expect(validated.boarding.markedBy).toBe('DRIVER');

      // Drop status (pending)
      expect(validated.drop.isDropped).toBe(false);
      expect(validated.drop.status).toBe('PENDING');

      // Formatted WhatsApp message
      expect(validated.formattedMessage).toContain('🎒 *Student Profile & Attendance*');
      expect(validated.formattedMessage).toContain('Aarav Sharma');
      expect(validated.formattedMessage).toContain('On Bus — In Transit');
      expect(validated.formattedMessage).toContain('Boarded Bus at');
      expect(validated.formattedMessage).toContain('Sector 4 Market');
      expect(validated.formattedMessage).toContain('Bus *#12*');
    });

    it('reports AWAITING_BOARDING when trip is active but student has not yet boarded', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext (active trip)
      querySpy.mockResolvedValueOnce([mockInTransitTripDbRow]);
      // 3. handleMyChild: no attendance records yet
      querySpy.mockResolvedValueOnce([]);

      const res = await ParentWhatsappService.getMyChildDetails(mockParentPhone, mockSchoolId);

      expect(res).not.toBeNull();
      const validated = ParentMyChildResponseSchema.parse(res);

      expect(validated.journey.status).toBe('AWAITING_BOARDING');
      expect(validated.journey.statusLabel).toContain('Awaiting Boarding');
      expect(validated.boarding.isBoarded).toBe(false);
      expect(validated.boarding.status).toBe('NOT_BOARDED');
      expect(validated.drop.isDropped).toBe(false);
      expect(validated.formattedMessage).toContain('Awaiting boarding');
    });

    it('reports ABSENT when student has been marked absent by driver', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext (active trip)
      querySpy.mockResolvedValueOnce([mockInTransitTripDbRow]);
      // 3. handleMyChild: boarding event marked ABSENT
      querySpy.mockResolvedValueOnce([
        {
          event_type: 'BOARDING',
          status: 'ABSENT',
          recorded_at: new Date().toISOString(),
          marked_by: 'DRIVER',
          stop_name: 'Sector 4 Market',
        },
      ]);

      const res = await ParentWhatsappService.getMyChildDetails(mockParentPhone, mockSchoolId);

      expect(res).not.toBeNull();
      const validated = ParentMyChildResponseSchema.parse(res);

      expect(validated.journey.status).toBe('ABSENT');
      expect(validated.journey.statusLabel).toContain('Marked Absent');
      expect(validated.boarding.status).toBe('ABSENT');
      expect(validated.boarding.isBoarded).toBe(false);
      expect(validated.formattedMessage).toContain('Marked Absent for today’s trip');
    });
  });

  describe('2. Drop Status & Completed Journey', () => {
    it('reports SAFELY_DROPPED when drop event is recorded with DEBOARDED status', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext
      querySpy.mockResolvedValueOnce([mockInTransitTripDbRow]);
      // 3. handleMyChild: both boarding and drop events
      const dropTime = new Date('2026-10-25T08:15:00+05:30').toISOString();
      const boardTime = new Date('2026-10-25T07:42:00+05:30').toISOString();
      querySpy.mockResolvedValueOnce([
        {
          event_type: 'DROP',
          status: 'DEBOARDED',
          recorded_at: dropTime,
          marked_by: 'DRIVER',
          stop_name: 'DPS School Main Gate',
        },
        {
          event_type: 'BOARDING',
          status: 'BOARDED',
          recorded_at: boardTime,
          marked_by: 'DRIVER',
          stop_name: 'Sector 4 Market',
        },
      ]);

      const res = await ParentWhatsappService.getMyChildDetails(mockParentPhone, mockSchoolId);

      expect(res).not.toBeNull();
      const validated = ParentMyChildResponseSchema.parse(res);

      expect(validated.journey.status).toBe('SAFELY_DROPPED');
      expect(validated.journey.statusLabel).toContain('Safely Dropped');

      // Drop status details
      expect(validated.drop.isDropped).toBe(true);
      expect(validated.drop.status).toBe('DEBOARDED');
      expect(validated.drop.stopName).toBe('DPS School Main Gate');
      expect(validated.drop.markedBy).toBe('DRIVER');

      // Boarding status details preserved
      expect(validated.boarding.isBoarded).toBe(true);
      expect(validated.boarding.status).toBe('BOARDED');

      // WhatsApp reply formatting
      expect(validated.formattedMessage).toContain('Safely Dropped at');
      expect(validated.formattedMessage).toContain('DPS School Main Gate');
    });
  });

  describe('3. Scheduled & Inactive Trip States', () => {
    it('reports SCHEDULED journey status when trip has not yet started', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext (SCHEDULED trip)
      querySpy.mockResolvedValueOnce([
        {
          ...mockInTransitTripDbRow,
          status: TripStatus.SCHEDULED,
        },
      ]);
      // 3. handleMyChild: no attendance events yet
      querySpy.mockResolvedValueOnce([]);

      const res = await ParentWhatsappService.getMyChildDetails(mockParentPhone, mockSchoolId);

      expect(res).not.toBeNull();
      const validated = ParentMyChildResponseSchema.parse(res);

      expect(validated.journey.status).toBe('SCHEDULED');
      expect(validated.journey.statusLabel).toContain('Trip Scheduled');
      expect(validated.boarding.isBoarded).toBe(false);
      expect(validated.drop.isDropped).toBe(false);
      expect(validated.formattedMessage).toContain('Trip Scheduled');
    });

    it('reports NOT_IN_TRANSIT when no active or scheduled trip exists', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext: no active trip, no scheduled trip
      querySpy.mockResolvedValueOnce([]);
      querySpy.mockResolvedValueOnce([]);
      // 3. handleMyChild: no attendance events
      querySpy.mockResolvedValueOnce([]);

      const res = await ParentWhatsappService.getMyChildDetails(mockParentPhone, mockSchoolId);

      expect(res).not.toBeNull();
      const validated = ParentMyChildResponseSchema.parse(res);

      expect(validated.journey.status).toBe('NOT_IN_TRANSIT');
      expect(validated.bus).toBeNull();
      expect(validated.boarding.isBoarded).toBe(false);
    });
  });

  describe('4. Dedicated API Endpoint: GET /api/v1/parent/whatsapp/child', () => {
    it('returns structured JSON payload matching ParentMyChildResponseSchema via GET /child', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext
      querySpy.mockResolvedValueOnce([mockInTransitTripDbRow]);
      // 3. handleMyChild: boarding event
      querySpy.mockResolvedValueOnce([
        {
          event_type: 'BOARDING',
          status: 'BOARDED',
          recorded_at: new Date().toISOString(),
          marked_by: 'DRIVER',
          stop_name: 'Sector 4 Market',
        },
      ]);

      const res = await request(app)
        .get('/api/v1/parent/whatsapp/child')
        .query({
          phone: mockParentPhone,
          schoolId: mockSchoolId,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.student.fullName).toBe('Aarav Sharma');
      expect(res.body.data.journey.status).toBe('ON_BUS');
      expect(res.body.data.boarding.isBoarded).toBe(true);
      expect(res.body.data.drop.isDropped).toBe(false);
      expect(res.body.data.pickupStop.stopName).toBe('Sector 4 Market');

      // Strict schema validation of response body
      const validated = ParentMyChildResponseSchema.parse(res.body.data);
      expect(validated.student.admissionNumber).toBe('DPS-2024-042');
    });

    it('returns 400 Bad Request when phone query parameter is missing', async () => {
      const res = await request(app).get('/api/v1/parent/whatsapp/child');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('phone number');
    });

    it('returns 404 Not Found when parent does not exist', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([]); // no parent found

      const res = await request(app)
        .get('/api/v1/parent/whatsapp/child')
        .query({ phone: '+919999999999' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });
});
