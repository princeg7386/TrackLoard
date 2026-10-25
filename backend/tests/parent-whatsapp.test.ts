import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import * as db from '../src/config/database.js';
import { MessagingService } from '../src/services/messaging/messaging.service.js';
import { MockMessagingAdapter } from '../src/services/messaging/mock-messaging.adapter.js';
import { ParentWhatsappService } from '../src/services/parent-whatsapp.service.js';
import { ParentWhatsAppAction, TripStatus } from '@school-bus/shared';
import { EtaService } from '../src/services/eta.service.js';

const mockSchoolId = '11111111-1111-1111-1111-111111111111';
const mockParentId = '22222222-2222-2222-2222-222222222222';
const mockStudentId = '33333333-3333-3333-3333-333333333333';
const mockStopId = '44444444-4444-4444-4444-444444444444';
const mockTripId = '55555555-5555-5555-5555-555555555555';
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

describe('Phase 22.1: Parent WhatsApp — Menu & Quick Actions', () => {
  let app: any;

  beforeEach(() => {
    app = createApp();
    MessagingService.resetProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    MessagingService.resetProvider();
  });

  describe('1. Phone Normalization & Identification', () => {
    it('normalizes various Indian phone formats correctly', () => {
      const res1 = ParentWhatsappService.normalizeIndianPhone('9876543210');
      expect(res1.international).toBe('+919876543210');
      expect(res1.national10).toBe('9876543210');

      const res2 = ParentWhatsappService.normalizeIndianPhone('+919876543210');
      expect(res2.international).toBe('+919876543210');
      expect(res2.national10).toBe('9876543210');

      const res3 = ParentWhatsappService.normalizeIndianPhone('09876543210');
      expect(res3.international).toBe('+919876543210');
      expect(res3.national10).toBe('9876543210');

      const res4 = ParentWhatsappService.normalizeIndianPhone('+91 98765-43210');
      expect(res4.international).toBe('+919876543210');
      expect(res4.national10).toBe('9876543210');
    });

    it('handles message from unregistered phone by dispatching helpful guidance', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([]); // No parent found

      const res = await request(app)
        .post('/api/v1/parent/whatsapp/message')
        .send({
          from: '+919999988888',
          text: 'menu',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe('UNREGISTERED');
      expect(res.body.data.replyText).toContain('could not find a registered student linked');

      const sent = MockMessagingAdapter.getSentMessages();
      expect(sent.length).toBe(1);
      expect(sent[0].recipientPhone).toBe('+919999988888');
      expect(sent[0].directText).toContain('School Bus Transportation Safety Platform');
    });
  });

  describe('2. Task 1: Track My Bus', () => {
    it('returns live web tracking link and bus status when bus is in transit', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext (active trip)
      querySpy.mockResolvedValueOnce([
        {
          id: mockTripId,
          route_id: 'route-1',
          status: 'IN_TRANSIT',
          bus_id: 'bus-1',
          driver_id: 'driver-1',
          delay_minutes: 0,
          bus_number: 'DL-01-AB-1234',
          registration_number: 'DL1CAB1234',
          driver_name: 'Rajesh Kumar',
          driver_phone: '+919811122233',
          route_name: 'Route 12 - South Delhi',
          route_code: 'R-12',
        },
      ]);
      // 3. createTrackingToken (parent verification)
      querySpy.mockResolvedValueOnce([{ id: mockParentId }]);
      // 4. createTrackingToken (insert token)
      querySpy.mockResolvedValueOnce([{ id: 'token-uuid-1', expires_at: new Date() }]);

      const res = await request(app)
        .post('/api/v1/parent/whatsapp/message')
        .send({
          from: mockParentPhone,
          text: '1',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(ParentWhatsAppAction.TRACK_MY_BUS);
      expect(res.body.data.replyText).toContain('Live Bus Tracking');
      expect(res.body.data.replyText).toContain('DL-01-AB-1234');
      expect(res.body.data.replyText).toContain('In Transit');
      expect(res.body.data.replyText).toContain('Rajesh Kumar');
      expect(res.body.data.replyText).toContain('trk_');

      const sent = MockMessagingAdapter.getSentMessages();
      expect(sent.length).toBe(1);
      expect(sent[0].recipientPhone).toBe(mockParentPhone);
    });

    it('returns tracking link with calm idle message when bus is not currently in transit', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext (active query returns empty)
      querySpy.mockResolvedValueOnce([]);
      // 3. getParentTripContext (scheduled query returns empty)
      querySpy.mockResolvedValueOnce([]);
      // 4. createTrackingToken (parent verification)
      querySpy.mockResolvedValueOnce([{ id: mockParentId }]);
      // 5. createTrackingToken (insert token)
      querySpy.mockResolvedValueOnce([{ id: 'token-uuid-2', expires_at: new Date() }]);

      const res = await request(app)
        .post('/api/v1/parent/whatsapp/message')
        .send({
          from: mockParentPhone,
          text: 'track my bus',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(ParentWhatsAppAction.TRACK_MY_BUS);
      expect(res.body.data.replyText).toContain('Idle / Not in Transit');
      expect(res.body.data.replyText).toContain('trk_');
    });
  });

  describe('3. Task 2: My ETA', () => {
    it('returns calculated arrival minutes, distance, and approaching indicator when ETA is available', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext (active trip)
      querySpy.mockResolvedValueOnce([
        {
          id: mockTripId,
          route_id: 'route-1',
          status: 'IN_TRANSIT',
          bus_id: 'bus-1',
          driver_id: 'driver-1',
          delay_minutes: 0,
          bus_number: 'DL-01-AB-1234',
          driver_name: 'Rajesh Kumar',
        },
      ]);

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
          text: '2',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(ParentWhatsAppAction.MY_ETA);
      expect(res.body.data.replyText).toContain('Bus Arrival ETA');
      expect(res.body.data.replyText).toContain('Bus is Approaching!');
      expect(res.body.data.replyText).toContain('4 mins');
      expect(res.body.data.replyText).toContain('1.2 km away');
      expect(etaSpy).toHaveBeenCalledWith({
        tripId: mockTripId,
        schoolId: mockSchoolId,
        stopId: mockStopId,
      });
    });

    it('returns scheduled time when bus has not yet started trip', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext (active: none, scheduled: none)
      querySpy.mockResolvedValueOnce([]);
      querySpy.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/v1/parent/whatsapp/message')
        .send({
          from: mockParentPhone,
          text: 'eta',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(ParentWhatsAppAction.MY_ETA);
      expect(res.body.data.replyText).toContain('Bus Not Currently in Transit');
      expect(res.body.data.replyText).toContain('07:35:00');
    });
  });

  describe('4. Task 3: My Child', () => {
    it('returns student details and today’s boarding attendance status', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext
      querySpy.mockResolvedValueOnce([]);
      querySpy.mockResolvedValueOnce([]);
      // 3. handleMyChild: attendance events
      querySpy.mockResolvedValueOnce([
        {
          event_type: 'BOARDING',
          recorded_at: new Date().toISOString(),
          stop_name: 'Vasant Vihar C-Block Market',
        },
      ]);

      const res = await request(app)
        .post('/api/v1/parent/whatsapp/message')
        .send({
          from: mockParentPhone,
          text: 'child',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(ParentWhatsAppAction.MY_CHILD);
      expect(res.body.data.replyText).toContain('Aarav Sharma');
      expect(res.body.data.replyText).toContain('ADM-2024-889');
      expect(res.body.data.replyText).toContain('Class 5 - Section B');
      expect(res.body.data.replyText).toContain('Boarded Bus at');
      expect(res.body.data.replyText).toContain('Vasant Vihar C-Block Market');
    });
  });

  describe('5. Task 4: My Pickup', () => {
    it('returns assigned stop details, scheduled time, and location update info', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext
      querySpy.mockResolvedValueOnce([]);
      querySpy.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/v1/parent/whatsapp/message')
        .send({
          from: mockParentPhone,
          text: '4',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(ParentWhatsAppAction.MY_PICKUP);
      expect(res.body.data.replyText).toContain('Assigned Pickup Stop');
      expect(res.body.data.replyText).toContain('Vasant Vihar C-Block Market');
      expect(res.body.data.replyText).toContain('07:35:00');
      expect(res.body.data.replyText).toContain('300 meters');
      expect(res.body.data.replyText).toContain('share your live GPS pin directly in this WhatsApp chat');
    });
  });

  describe('6. Task 5: Notifications', () => {
    it('returns recent parent alerts and confirms WhatsApp notification delivery status', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext
      querySpy.mockResolvedValueOnce([]);
      querySpy.mockResolvedValueOnce([]);
      // 3. handleNotifications: notifications query
      querySpy.mockResolvedValueOnce([
        {
          id: 'notif-1',
          template_name: 'APPROACH',
          message_body: 'School bus is approaching Vasant Vihar stop (within 500m).',
          status: 'DELIVERED',
          created_at: new Date().toISOString(),
        },
      ]);

      const res = await request(app)
        .post('/api/v1/parent/whatsapp/message')
        .send({
          from: mockParentPhone,
          text: '5',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(ParentWhatsAppAction.NOTIFICATIONS);
      expect(res.body.data.replyText).toContain('Parent Notification Center');
      expect(res.body.data.replyText).toContain('WhatsApp Notifications Active');
      expect(res.body.data.replyText).toContain('School bus is approaching Vasant Vihar stop');
    });
  });

  describe('7. Task 6: Help', () => {
    it('returns command quick references and school transport helpline phone numbers', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext
      querySpy.mockResolvedValueOnce([]);
      querySpy.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/v1/parent/whatsapp/message')
        .send({
          from: mockParentPhone,
          text: '6',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(ParentWhatsAppAction.HELP);
      expect(res.body.data.replyText).toContain('School Transport Help & Support');
      expect(res.body.data.replyText).toContain('Type *1* or *TRACK*');
      expect(res.body.data.replyText).toContain('Type *2* or *ETA*');
      expect(res.body.data.replyText).toContain('+91-11-26174567');
      expect(res.body.data.replyText).toContain('+91-11-26179999');
    });
  });

  describe('8. Parent WhatsApp Menu & Webhook API Endpoints', () => {
    it('GET /api/v1/parent/whatsapp/menu returns structured menu with all 6 items', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext (active)
      querySpy.mockResolvedValueOnce([]);
      // 3. getParentTripContext (scheduled)
      querySpy.mockResolvedValueOnce([]);
      // 4. getOrCreateTrackingUrl: createTrackingToken (parent verification)
      querySpy.mockResolvedValueOnce([{ id: mockParentId }]);
      // 5. getOrCreateTrackingUrl: createTrackingToken (insert token)
      querySpy.mockResolvedValueOnce([{ id: 'tok-123', expires_at: new Date() }]);

      const res = await request(app)
        .get('/api/v1/parent/whatsapp/menu')
        .query({ phone: mockParentPhone });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.menuItems.length).toBe(6);
      expect(res.body.data.student.fullName).toBe('Aarav Sharma');
      expect(res.body.data.formattedText).toContain('School Bus Parent Portal');
      expect(res.body.data.formattedText).toContain('Track My Bus');
      expect(res.body.data.formattedText).toContain('My ETA');
      expect(res.body.data.formattedText).toContain('My Child');
      expect(res.body.data.formattedText).toContain('My Pickup');
      expect(res.body.data.formattedText).toContain('Notifications');
      expect(res.body.data.formattedText).toContain('Help');
    });

    it('GET /api/v1/parent/whatsapp/webhook handles Meta Cloud challenge verification', async () => {
      const res = await request(app)
        .get('/api/v1/parent/whatsapp/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'school-bus-verify-token',
          'hub.challenge': '1158201234',
        });

      expect(res.status).toBe(200);
      expect(res.text).toBe('1158201234');
    });

    it('POST /api/v1/parent/whatsapp/webhook processes inbound Meta Cloud API payload', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext
      querySpy.mockResolvedValueOnce([]);
      querySpy.mockResolvedValueOnce([]);

      const webhookPayload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '919876543210',
                      type: 'text',
                      text: { body: '6' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const res = await request(app)
        .post('/api/v1/parent/whatsapp/webhook')
        .send(webhookPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.handled).toBe(true);
      expect(res.body.data.actionTriggered).toBe(ParentWhatsAppAction.HELP);
    });

    it('POST /api/v1/parent/whatsapp/action executes direct action request', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. findParentByPhone
      querySpy.mockResolvedValueOnce([mockParentDbRow]);
      // 2. getParentTripContext
      querySpy.mockResolvedValueOnce([]);
      querySpy.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/v1/parent/whatsapp/action')
        .send({
          from: mockParentPhone,
          action: ParentWhatsAppAction.HELP,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(ParentWhatsAppAction.HELP);
    });
  });
});
