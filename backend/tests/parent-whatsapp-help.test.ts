import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import * as db from '../src/config/database.js';
import { ParentWhatsappService } from '../src/services/parent-whatsapp.service.js';
import { MessagingService } from '../src/services/messaging/messaging.service.js';
import {
  ParentHelpResponseSchema,
  ParentReportIssueResponseSchema,
  ParentWhatsAppAction,
  TripStatus,
} from '@school-bus/shared';

const mockSchoolId = '11111111-1111-1111-1111-111111111111';
const mockParentId = '22222222-2222-2222-2222-222222222222';
const mockStudentId = '33333333-3333-3333-3333-333333333333';
const mockStopId = '44444444-4444-4444-4444-444444444444';
const mockTripId = '55555555-5555-5555-5555-555555555555';
const mockBusId = '66666666-6666-6666-6666-666666666666';
const mockDriverId = '88888888-8888-8888-8888-888888888888';
const mockIncidentId = '99999999-9999-9999-9999-999999999999';
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

const mockActiveTripDbRow = {
  id: mockTripId,
  route_id: '77777777-7777-7777-7777-777777777777',
  status: TripStatus.IN_TRANSIT,
  bus_id: mockBusId,
  bus_number: 'Bus 14',
  registration_number: 'DL-01-AB-1234',
  driver_id: mockDriverId,
  driver_name: 'Suresh Kumar',
  driver_phone: '+919811122233',
  route_name: 'Route 4 - South Delhi',
  route_code: 'R-04',
  route_type: 'MORNING_PICKUP',
  delay_minutes: 0,
};

describe('Phase 22.6: Parent WhatsApp — Help (FAQs, Support Contacts, Issue Reporting)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Task 1 & 2: FAQs, Support Contacts & Driver Details', () => {
    it('returns structured FAQs, support contacts, operating hours, and active driver info', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext (active trip)
      querySpy.mockResolvedValueOnce([mockActiveTripDbRow]);

      const res = await ParentWhatsappService.getHelpDetails(mockParentPhone, mockSchoolId);

      expect(res).not.toBeNull();
      const validated = ParentHelpResponseSchema.parse(res);

      expect(validated.schoolName).toBe('Delhi Public School, R.K. Puram');
      expect(validated.schoolPhone).toBe('+91-11-26174567');
      expect(validated.emergencyPhone).toBe('+91-11-26179999');
      expect(validated.supportEmail).toContain('@');
      expect(validated.operatingHours).toBe('Monday to Saturday: 06:30 AM – 06:30 PM');

      // Driver info
      expect(validated.driver).not.toBeNull();
      expect(validated.driver?.name).toBe('Suresh Kumar');
      expect(validated.driver?.phone).toBe('+919811122233');
      expect(validated.driver?.busNumber).toBe('Bus 14');

      // FAQs
      expect(validated.faqs.length).toBeGreaterThanOrEqual(5);
      const trackingFaq = validated.faqs.find((f) => f.category === 'TRACKING');
      expect(trackingFaq).toBeDefined();
      expect(trackingFaq?.answer).toContain('TRACK');

      const etaFaq = validated.faqs.find((f) => f.category === 'ETA');
      expect(etaFaq).toBeDefined();
      expect(etaFaq?.answer).toContain('ETA');

      // Available commands
      expect(validated.availableCommands.length).toBeGreaterThanOrEqual(6);
      expect(validated.availableCommands.some((c) => c.command.includes('TRACK'))).toBe(true);
      expect(validated.availableCommands.some((c) => c.command.includes('REPORT'))).toBe(true);

      // Reply text
      expect(validated.replyText).toContain('School Transport Help & Support');
      expect(validated.replyText).toContain('Type *1* or *TRACK*');
      expect(validated.replyText).toContain('+91-11-26174567');
      expect(validated.replyText).toContain('+91-11-26179999');
      expect(validated.replyText).toContain('Bus 14');
      expect(validated.replyText).toContain('Suresh Kumar');
    });

    it('returns null if parent phone number is not registered', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([]); // not found

      const res = await ParentWhatsappService.getHelpDetails('+919999999999');
      expect(res).toBeNull();
    });

    it('handles parent when no active trip is currently running', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext (active trip: none, scheduled: none)
      querySpy.mockResolvedValueOnce([]);
      querySpy.mockResolvedValueOnce([]);

      const res = await ParentWhatsappService.getHelpDetails(mockParentPhone);
      expect(res).not.toBeNull();
      expect(res?.driver).toBeNull();
      expect(res?.schoolPhone).toBe('+91-11-26174567');
      expect(res?.emergencyPhone).toBe('+91-11-26179999');
    });
  });

  describe('2. Task 3: Issue Reporting Domain Logic', () => {
    it('creates an incident record in database and returns formatted ticket confirmation', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext (active trip)
      querySpy.mockResolvedValueOnce([mockActiveTripDbRow]);
      // 3. INSERT INTO incidents
      querySpy.mockResolvedValueOnce([
        {
          id: mockIncidentId,
          school_id: mockSchoolId,
          trip_id: mockTripId,
          bus_id: mockBusId,
          driver_id: mockDriverId,
          incident_type: 'BUS_DELAY',
          severity: 'LOW',
          status: 'OPEN',
          description: '[Parent: Rajesh Sharma (FATHER) - Student: Aarav Sharma] Bus is delayed by 15 mins at main junction',
          created_at: new Date().toISOString(),
        },
      ]);

      const result = await ParentWhatsappService.reportIssue({
        phone: mockParentPhone,
        schoolId: mockSchoolId,
        category: 'BUS_DELAY',
        description: 'Bus is delayed by 15 mins at main junction',
      });

      expect(result.success).toBe(true);
      const validated = ParentReportIssueResponseSchema.parse(result);

      expect(validated.incidentId).toBe(mockIncidentId);
      expect(validated.ticketNumber).toBe(`TKT-${mockIncidentId.substring(0, 8).toUpperCase()}`);
      expect(validated.category).toBe('BUS_DELAY');
      expect(validated.severity).toBe('LOW');
      expect(validated.status).toBe('OPEN');
      expect(validated.description).toBe('Bus is delayed by 15 mins at main junction');
      expect(validated.formattedMessage).toContain('Transport Issue Logged Successfully');
      expect(validated.formattedMessage).toContain('TKT-99999999');
      expect(validated.formattedMessage).toContain('Aarav Sharma');
      expect(validated.formattedMessage).toContain('+91-11-26179999');

      // Verify INSERT parameters
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO incidents'),
        [
          mockSchoolId,
          mockTripId,
          mockBusId,
          mockDriverId,
          'BUS_DELAY',
          'LOW',
          expect.stringContaining('Rajesh Sharma'),
        ]
      );
    });

    it('correctly maps severity based on issue categories', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // Test RASH_DRIVING -> HIGH severity
      querySpy.mockResolvedValueOnce([mockParentDbRow]); // findParentByPhone
      querySpy.mockResolvedValueOnce([]); // trip active
      querySpy.mockResolvedValueOnce([]); // trip scheduled
      querySpy.mockResolvedValueOnce([
        {
          id: mockIncidentId,
          school_id: mockSchoolId,
          trip_id: null,
          bus_id: null,
          driver_id: null,
          incident_type: 'RASH_DRIVING',
          severity: 'HIGH',
          status: 'OPEN',
          description: 'Rash driving',
          created_at: new Date().toISOString(),
        },
      ]);

      const rashResult = await ParentWhatsappService.reportIssue({
        phone: mockParentPhone,
        category: 'RASH_DRIVING',
        description: 'Bus was speeding near colony turn',
      });
      expect(rashResult.severity).toBe('HIGH');
    });

    it('throws NotFoundError if parent is not registered', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([]); // not found

      await expect(
        ParentWhatsappService.reportIssue({
          phone: '+919999999999',
          category: 'OTHER',
          description: 'Any report',
        })
      ).rejects.toThrow('No registered student transport profile found');
    });
  });

  describe('3. REST API Endpoints: GET /help & POST /help/report-issue', () => {
    it('GET /api/v1/parent/whatsapp/help returns 200 with structured response', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      querySpy.mockResolvedValueOnce([mockActiveTripDbRow]);

      const res = await request(app)
        .get('/api/v1/parent/whatsapp/help')
        .query({ phone: mockParentPhone });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.schoolName).toBe('Delhi Public School, R.K. Puram');
      expect(res.body.data.faqs.length).toBeGreaterThanOrEqual(5);
      expect(res.body.data.driver.busNumber).toBe('Bus 14');
    });

    it('GET /api/v1/parent/whatsapp/help returns 400 when phone query param is missing', async () => {
      const res = await request(app).get('/api/v1/parent/whatsapp/help');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('phone number query parameter is required');
    });

    it('GET /api/v1/parent/whatsapp/help returns 404 when phone is not registered', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([]);

      const res = await request(app)
        .get('/api/v1/parent/whatsapp/help')
        .query({ phone: '+919999999999' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('POST /api/v1/parent/whatsapp/help/report-issue returns 200 and incident confirmation', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      querySpy.mockResolvedValueOnce([mockActiveTripDbRow]);
      querySpy.mockResolvedValueOnce([
        {
          id: mockIncidentId,
          school_id: mockSchoolId,
          trip_id: mockTripId,
          bus_id: mockBusId,
          driver_id: mockDriverId,
          incident_type: 'MISSED_STOP',
          severity: 'HIGH',
          status: 'OPEN',
          description: 'Bus did not stop at Sector 4',
          created_at: new Date().toISOString(),
        },
      ]);

      const res = await request(app)
        .post('/api/v1/parent/whatsapp/help/report-issue')
        .send({
          phone: mockParentPhone,
          category: 'MISSED_STOP',
          description: 'Bus did not stop at Sector 4 Market stop this morning',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ticketNumber).toContain('TKT-');
      expect(res.body.data.category).toBe('MISSED_STOP');
      expect(res.body.data.status).toBe('OPEN');
    });

    it('POST /api/v1/parent/whatsapp/help/report-issue returns 422 on invalid issue category', async () => {
      const res = await request(app)
        .post('/api/v1/parent/whatsapp/help/report-issue')
        .send({
          phone: mockParentPhone,
          category: 'INVALID_CATEGORY',
          description: 'Valid description text',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('POST /api/v1/parent/whatsapp/help/report-issue returns 422 when description is too short', async () => {
      const res = await request(app)
        .post('/api/v1/parent/whatsapp/help/report-issue')
        .send({
          phone: mockParentPhone,
          category: 'OTHER',
          description: 'No',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe('4. Inbound WhatsApp Natural Language & Menu Integration', () => {
    it('returns Help overview when parent sends "6" or "help"', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      querySpy.mockResolvedValueOnce([]); // trip active
      querySpy.mockResolvedValueOnce([]); // trip scheduled

      const res = await request(app)
        .post('/api/v1/parent/whatsapp/message')
        .send({
          from: mockParentPhone,
          text: 'help',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(ParentWhatsAppAction.HELP);
      expect(res.body.data.replyText).toContain('School Transport Help & Support');
      expect(res.body.data.replyText).toContain('+91-11-26174567');
      expect(res.body.data.replyText).toContain('+91-11-26179999');
    });

    it('automatically detects and logs an issue when parent sends natural language "REPORT ..."', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. reportIssue -> findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 3. getParentTripContext (active trip)
      querySpy.mockResolvedValueOnce([mockActiveTripDbRow]);
      // 4. INSERT INTO incidents
      querySpy.mockResolvedValueOnce([
        {
          id: mockIncidentId,
          school_id: mockSchoolId,
          trip_id: mockTripId,
          bus_id: mockBusId,
          driver_id: mockDriverId,
          incident_type: 'BUS_DELAY',
          severity: 'LOW',
          status: 'OPEN',
          description: '[Parent: Rajesh Sharma (FATHER) - Student: Aarav Sharma] Bus is delayed by 20 minutes',
          created_at: new Date().toISOString(),
        },
      ]);

      const sendSpy = vi.spyOn(MessagingService, 'sendMessage').mockResolvedValueOnce({
        id: 'msg-1',
        status: 'sent',
      } as any);

      const res = await request(app)
        .post('/api/v1/parent/whatsapp/message')
        .send({
          from: mockParentPhone,
          text: 'REPORT Bus is delayed by 20 minutes due to flat tire',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(ParentWhatsAppAction.HELP);
      expect(res.body.data.replyText).toContain('Transport Issue Logged Successfully');
      expect(res.body.data.replyText).toContain('TKT-');
      expect(res.body.data.replyText).toContain('Aarav Sharma');
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientPhone: mockParentPhone,
          directText: expect.stringContaining('Transport Issue Logged Successfully'),
        })
      );
    });

    it('detects rash driving from natural language "ISSUE rash driving near bridge"', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. reportIssue -> findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 3. getParentTripContext (active trip)
      querySpy.mockResolvedValueOnce([mockActiveTripDbRow]);
      // 4. INSERT INTO incidents
      querySpy.mockResolvedValueOnce([
        {
          id: mockIncidentId,
          school_id: mockSchoolId,
          trip_id: mockTripId,
          bus_id: mockBusId,
          driver_id: mockDriverId,
          incident_type: 'RASH_DRIVING',
          severity: 'HIGH',
          status: 'OPEN',
          description: 'Rash driving',
          created_at: new Date().toISOString(),
        },
      ]);

      const res = await request(app)
        .post('/api/v1/parent/whatsapp/message')
        .send({
          from: mockParentPhone,
          text: 'ISSUE driver rash driving at high speed near flyover',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.data.category).toBe('RASH_DRIVING');
      expect(res.body.data.data.severity).toBe('HIGH');
    });
  });
});
