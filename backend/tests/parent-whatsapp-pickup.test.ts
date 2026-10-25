import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import * as db from '../src/config/database.js';
import { ParentWhatsappService } from '../src/services/parent-whatsapp.service.js';
import {
  ParentMyPickupResponseSchema,
  ParentPickupUpdateResultSchema,
  ParentWhatsAppAction,
  TripStatus,
} from '@school-bus/shared';
import { DynamicPickupService } from '../src/services/dynamic-pickup/dynamic-pickup.service.js';

const mockSchoolId = '11111111-1111-1111-1111-111111111111';
const mockParentId = '22222222-2222-2222-2222-222222222222';
const mockStudentId = '33333333-3333-3333-3333-333333333333';
const mockStopId = '44444444-4444-4444-4444-444444444444';
const mockTripId = '55555555-5555-5555-5555-555555555555';
const mockRouteId = '77777777-7777-7777-7777-777777777777';
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
  bus_id: '66666666-6666-6666-6666-666666666666',
  bus_number: '12',
  registration_number: 'DL-01-AB-1234',
  driver_id: '88888888-8888-8888-8888-888888888888',
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

describe('Phase 22.5: Parent WhatsApp — My Pickup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Task 1: View Pickup Stop Details', () => {
    it('returns complete stop information with coordinates, geofence radius, schedule, and route', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext (active trip)
      querySpy.mockResolvedValueOnce([mockInTransitTripDbRow]);

      const res = await ParentWhatsappService.getMyPickupDetails(mockParentPhone, mockSchoolId);

      expect(res).not.toBeNull();
      const validated = ParentMyPickupResponseSchema.parse(res);

      expect(validated.student.fullName).toBe('Aarav Sharma');
      expect(validated.pickupStop).not.toBeNull();
      expect(validated.pickupStop?.stopName).toBe('Sector 4 Market');
      expect(validated.pickupStop?.scheduledTime).toBe('07:35:00');
      expect(validated.pickupStop?.sequenceOrder).toBe(3);
      expect(validated.pickupStop?.geofenceRadiusMeters).toBe(150);
      expect(validated.pickupStop?.latitude).toBe(28.5678);
      expect(validated.pickupStop?.longitude).toBe(77.189);
      expect(validated.pickupStop?.coordinatesFormatted).toBe('28.5678° N, 77.1890° E');

      expect(validated.route).not.toBeNull();
      expect(validated.route?.name).toBe('Route 4 - South Delhi');
      expect(validated.route?.code).toBe('R-04');
      expect(validated.route?.totalStops).toBe(8);

      expect(validated.updateFlow.canUpdate).toBe(true);
      expect(validated.updateFlow.instructions).toContain('GPS pin');

      // WhatsApp message formatting
      expect(validated.formattedMessage).toContain('📍 *Assigned Pickup Stop*');
      expect(validated.formattedMessage).toContain('Sector 4 Market* (Stop #3)');
      expect(validated.formattedMessage).toContain('07:35:00');
      expect(validated.formattedMessage).toContain('150 meters');
      expect(validated.formattedMessage).toContain('28.5678° N, 77.1890° E');
      expect(validated.formattedMessage).toContain('Route 4 - South Delhi [R-04]');
      expect(validated.formattedMessage).toContain('share your live GPS pin directly in this WhatsApp chat');
    });

    it('handles student with no pickup stop assigned gracefully', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // Parent with no stop_id
      querySpy.mockResolvedValueOnce([
        {
          ...mockParentDbRow,
          stop_id: null,
          stop_name: null,
          scheduled_time: null,
          sequence_order: null,
          geofence_radius_meters: null,
          stop_lat: null,
          stop_lon: null,
        },
      ]);
      // getParentTripContext returns null because no stopId
      const res = await ParentWhatsappService.getMyPickupDetails(mockParentPhone, mockSchoolId);

      expect(res).not.toBeNull();
      const validated = ParentMyPickupResponseSchema.parse(res);
      expect(validated.pickupStop).toBeNull();
      expect(validated.route).toBeNull();
      expect(validated.formattedMessage).toContain('No stop currently assigned');
      expect(validated.formattedMessage).toContain('transport administration to assign your pickup stop');
    });
  });

  describe('2. Task 2: Request Pickup Update Flow', () => {
    it('successfully processes coordinate update request and directly updates pickup stop', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);

      // Mock coordinate validation (within catchment)
      vi.spyOn(DynamicPickupService, 'validateCoordinates').mockResolvedValueOnce({
        isValid: true,
        latitude: 28.5712,
        longitude: 77.1925,
        formattedAddress: 'Near Hauz Khas Metro Gate 2, New Delhi',
        distanceToSchoolKm: 4.2,
        suggestedStopName: 'Hauz Khas Metro Gate 2',
        schoolId: mockSchoolId,
      });

      // Mock DynamicPickupService.updateStudentPickup
      vi.spyOn(DynamicPickupService, 'updateStudentPickup').mockResolvedValueOnce({
        success: true,
        studentId: mockStudentId,
        studentName: 'Aarav Sharma',
        pickupStopId: '99999999-9999-9999-9999-999999999999',
        pickupStopName: 'Hauz Khas Metro Gate 2',
        formattedAddress: 'Near Hauz Khas Metro Gate 2, New Delhi',
        reusedExistingStop: false,
        parentNotified: true,
      });

      const res = await ParentWhatsappService.requestPickupUpdate({
        phone: mockParentPhone,
        latitude: 28.5712,
        longitude: 77.1925,
        schoolId: mockSchoolId,
      });

      expect(res).not.toBeNull();
      const validated = ParentPickupUpdateResultSchema.parse(res);

      expect(validated.success).toBe(true);
      expect(validated.pickupStopName).toBe('Hauz Khas Metro Gate 2');
      expect(validated.latitude).toBe(28.5712);
      expect(validated.longitude).toBe(77.1925);
      expect(validated.formattedMessage).toContain('Pickup Location Updated Successfully');
      expect(validated.formattedMessage).toContain('Hauz Khas Metro Gate 2');
      expect(validated.formattedMessage).toContain('4.2 km');
    });

    it('handles out-of-catchment location submission with polite rejection warning', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);

      // Mock coordinate validation as out of catchment
      vi.spyOn(DynamicPickupService, 'validateCoordinates').mockResolvedValueOnce({
        isValid: false,
        latitude: 29.85,
        longitude: 78.5,
        formattedAddress: 'Haridwar Highway, Uttarakhand',
        distanceToSchoolKm: 185.0,
        suggestedStopName: 'Outside Area',
        schoolId: mockSchoolId,
      });

      const res = await ParentWhatsappService.requestPickupUpdate({
        phone: mockParentPhone,
        latitude: 29.85,
        longitude: 78.5,
        schoolId: mockSchoolId,
      });

      expect(res.success).toBe(false);
      expect(res.formattedMessage).toContain('Unable to Update Pickup Location');
      expect(res.formattedMessage).toContain('outside our bus service zone');
      expect(res.formattedMessage).toContain('185 km away');
    });

    it('processes Meta Cloud API location message webhook', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);

      vi.spyOn(DynamicPickupService, 'validateCoordinates').mockResolvedValueOnce({
        isValid: true,
        latitude: 28.568,
        longitude: 77.19,
        formattedAddress: 'Sector 4 Community Centre',
        distanceToSchoolKm: 3.5,
        suggestedStopName: 'Sector 4 Community Centre',
        schoolId: mockSchoolId,
      });

      vi.spyOn(DynamicPickupService, 'updateStudentPickup').mockResolvedValueOnce({
        success: true,
        studentId: mockStudentId,
        studentName: 'Aarav Sharma',
        pickupStopId: '88888888-8888-8888-8888-888888888888',
        pickupStopName: 'Sector 4 Community Centre',
        reusedExistingStop: true,
        parentNotified: true,
      });

      const res = await request(app)
        .post('/api/v1/parent/whatsapp/webhook')
        .send({
          entry: [
            {
              changes: [
                {
                  value: {
                    messages: [
                      {
                        from: mockParentPhone,
                        type: 'location',
                        location: {
                          latitude: 28.568,
                          longitude: 77.19,
                          name: 'Sector 4 Community Centre',
                          address: 'New Delhi, India',
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(ParentWhatsAppAction.MY_PICKUP);
      expect(res.body.data.replyText).toContain('Pickup Location Updated Successfully');
      expect(res.body.data.replyText).toContain('Sector 4 Community Centre');
    });
  });

  describe('3. Dedicated API Endpoints: GET /pickup & POST /pickup/update', () => {
    it('GET /api/v1/parent/whatsapp/pickup returns structured pickup stop details', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext
      querySpy.mockResolvedValueOnce([mockInTransitTripDbRow]);

      const res = await request(app)
        .get('/api/v1/parent/whatsapp/pickup')
        .query({
          phone: mockParentPhone,
          schoolId: mockSchoolId,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.student.fullName).toBe('Aarav Sharma');
      expect(res.body.data.pickupStop.stopName).toBe('Sector 4 Market');
      expect(res.body.data.route.name).toBe('Route 4 - South Delhi');

      const validated = ParentMyPickupResponseSchema.parse(res.body.data);
      expect(validated.pickupStop?.geofenceRadiusMeters).toBe(150);
    });

    it('GET /api/v1/parent/whatsapp/pickup returns 400 when phone is missing', async () => {
      const res = await request(app).get('/api/v1/parent/whatsapp/pickup');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('GET /api/v1/parent/whatsapp/pickup returns 404 when parent does not exist', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([]); // no parent

      const res = await request(app)
        .get('/api/v1/parent/whatsapp/pickup')
        .query({ phone: '+919999999999' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('POST /api/v1/parent/whatsapp/pickup/update updates stop via validated endpoint', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([mockParentDbRow]);

      vi.spyOn(DynamicPickupService, 'validateCoordinates').mockResolvedValueOnce({
        isValid: true,
        latitude: 28.565,
        longitude: 77.185,
        formattedAddress: 'Near Sector 4 Park',
        distanceToSchoolKm: 3.1,
        suggestedStopName: 'Sector 4 Park',
        schoolId: mockSchoolId,
      });

      vi.spyOn(DynamicPickupService, 'updateStudentPickup').mockResolvedValueOnce({
        success: true,
        studentId: mockStudentId,
        studentName: 'Aarav Sharma',
        pickupStopId: '77777777-7777-7777-7777-777777777777',
        pickupStopName: 'Sector 4 Park',
        reusedExistingStop: false,
        parentNotified: true,
      });

      const res = await request(app)
        .post('/api/v1/parent/whatsapp/pickup/update')
        .send({
          phone: mockParentPhone,
          latitude: 28.565,
          longitude: 77.185,
          stopName: 'Sector 4 Park',
          schoolId: mockSchoolId,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.success).toBe(true);
      expect(res.body.data.pickupStopName).toBe('Sector 4 Park');
      expect(res.body.data.formattedMessage).toContain('Pickup Location Updated Successfully');
    });

    it('POST /api/v1/parent/whatsapp/pickup/update rejects missing coordinates with 422 Unprocessable Entity', async () => {
      const res = await request(app)
        .post('/api/v1/parent/whatsapp/pickup/update')
        .send({
          phone: mockParentPhone,
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });
});
