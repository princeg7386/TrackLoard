import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import * as db from '../src/config/database.js';
import { MessagingService } from '../src/services/messaging/messaging.service.js';
import { MockMessagingAdapter } from '../src/services/messaging/mock-messaging.adapter.js';
import { DriverWhatsappService } from '../src/services/driver-whatsapp.service.js';
import { DriverWhatsAppAction, TripStatus } from '@school-bus/shared';

const schoolA = '111e4567-e89b-12d3-a456-426614174001';
const driverAId = 'ddd11111-e89b-12d3-a456-426614174001';
const busAId = '222e4567-e89b-12d3-a456-426614174222';
const routeAId = '555e4567-e89b-12d3-a456-426614174555';
const tripAId = '777e4567-e89b-12d3-a456-426614174777';

describe('Phase 17.1: Driver WhatsApp Core — Menu & Daily Operations', () => {
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
      const res1 = DriverWhatsappService.normalizeIndianPhone('9876543210');
      expect(res1.international).toBe('+919876543210');
      expect(res1.national10).toBe('9876543210');

      const res2 = DriverWhatsappService.normalizeIndianPhone('+919876543210');
      expect(res2.international).toBe('+919876543210');
      expect(res2.national10).toBe('9876543210');

      const res3 = DriverWhatsappService.normalizeIndianPhone('09876543210');
      expect(res3.international).toBe('+919876543210');
      expect(res3.national10).toBe('9876543210');

      const res4 = DriverWhatsappService.normalizeIndianPhone('+91 98765-43210');
      expect(res4.international).toBe('+919876543210');
      expect(res4.national10).toBe('9876543210');
    });

    it('handles message from unregistered phone by dispatching helpful guidance', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([]); // No driver found

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/message')
        .send({
          from: '+919999988888',
          text: 'menu',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.handled).toBe(false);
      expect(res.body.data.actionTriggered).toBe('UNREGISTERED');
      expect(res.body.data.replyText).toContain('Unregistered Mobile Number');

      // Verify outbound WhatsApp message dispatched
      const sent = MockMessagingAdapter.getSentMessages();
      expect(sent.length).toBe(1);
      expect(sent[0]?.recipientPhone).toBe('+919999988888');
      expect(sent[0]?.directText).toContain('School Transport Coordinator');
    });
  });

  describe('2. Driver WhatsApp Menu (GET /api/v1/driver/whatsapp/menu)', () => {
    it('returns structured driver menu with idle operational status when no active trips', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Driver lookup query
      querySpy.mockResolvedValueOnce([
        {
          id: driverAId,
          school_id: schoolA,
          full_name: 'Rajesh Driver',
          phone: '+919876543210',
          license_number: 'DL-KA-01-2020-001',
          bus_id: busAId,
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
        },
      ] as any);

      // 2. Active trip query returns none
      querySpy.mockResolvedValueOnce([]);

      // 3. Scheduled trip query returns none
      querySpy.mockResolvedValueOnce([]);

      const res = await request(app)
        .get(`/api/v1/driver/whatsapp/menu?phone=9876543210&schoolId=${schoolA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.driver.fullName).toBe('Rajesh Driver');
      expect(res.body.data.bus.busNumber).toBe('BUS-01');
      expect(res.body.data.menuItems.length).toBe(6);

      // Verify all 6 required tasks are present in menu items
      const actions = res.body.data.menuItems.map((m: any) => m.action);
      expect(actions).toContain(DriverWhatsAppAction.START_TRIP);
      expect(actions).toContain(DriverWhatsAppAction.END_TRIP);
      expect(actions).toContain(DriverWhatsAppAction.STUDENT_SEARCH);
      expect(actions).toContain(DriverWhatsAppAction.REPORT_PROBLEM);
      expect(actions).toContain(DriverWhatsAppAction.EMERGENCY);
      expect(actions).toContain(DriverWhatsAppAction.HELP);

      expect(res.body.data.formattedText).toContain('School Bus Driver Menu');
      expect(res.body.data.formattedText).toContain('Idle / Off Duty');
    });

    it('reflects active in-transit trip and stop progress in driver menu', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Driver lookup query
      querySpy.mockResolvedValueOnce([
        {
          id: driverAId,
          school_id: schoolA,
          full_name: 'Rajesh Driver',
          phone: '+919876543210',
          license_number: 'DL-KA-01-2020-001',
          bus_id: busAId,
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
        },
      ] as any);

      // 2. Active trip query returns active trip on Route R-101
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          status: TripStatus.IN_TRANSIT,
          current_stop_sequence: 3,
          route_name: 'North Campus Express',
          route_code: 'R-101',
          bus_number: 'BUS-01',
          total_stops: 8,
        },
      ] as any);

      const res = await request(app)
        .get(`/api/v1/driver/whatsapp/menu?driverId=${driverAId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.activeTrip.status).toBe(TripStatus.IN_TRANSIT);
      expect(res.body.data.activeTrip.currentStopSequence).toBe(3);
      expect(res.body.data.activeTrip.totalStops).toBe(8);
      expect(res.body.data.formattedText).toContain('In Transit');
      expect(res.body.data.formattedText).toContain('3 / 8');
    });

    it('rejects menu query without phone or driverId with 400 Bad Request', async () => {
      const res = await request(app).get('/api/v1/driver/whatsapp/menu');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when driver does not exist', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([]);

      const res = await request(app).get('/api/v1/driver/whatsapp/menu?phone=919999999999');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe('3. Inbound Command & Action Routing', () => {
    it('handles menu command (6 / menu / hi) and sends formatted menu text', async () => {
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

      // 2. Active trip lookup (none)
      querySpy.mockResolvedValueOnce([]);

      // 3. Scheduled trip lookup (none)
      querySpy.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/message')
        .send({
          from: '+919876543210',
          text: 'menu',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.handled).toBe(true);
      expect(res.body.data.actionTriggered).toBe(DriverWhatsAppAction.HELP);
      expect(res.body.data.replyText).toContain('School Bus Driver Menu');
      expect(res.body.data.replyText).toContain('1️⃣ *Start Trip*');
      expect(res.body.data.replyText).toContain('5️⃣ *Emergency*');

      // Verify outbound message was recorded
      const sent = MockMessagingAdapter.getSentMessages();
      expect(sent.length).toBe(1);
      expect(sent[0]?.recipientPhone).toBe('+919876543210');
      expect(sent[0]?.schoolId).toBe(schoolA);
    });

    it('handles Start Trip command (1 / start / START_TRIP) when scheduled trip exists', async () => {
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

      // 2. Active trip (none)
      querySpy.mockResolvedValueOnce([]);

      // 3. Scheduled trip
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          scheduled_start_time: '2026-10-17T07:30:00Z',
          route_name: 'North Campus',
          route_code: 'R-101',
          bus_number: 'BUS-01',
        },
      ] as any);

      vi.spyOn(DriverWhatsappService, 'startTripViaWhatsApp').mockResolvedValueOnce({
        success: true,
        alreadyInTransit: false,
        trip: { id: tripAId, routeCode: 'R-101' } as any,
        driver: { id: driverAId, fullName: 'Rajesh Driver', phone: '+919876543210' },
        bus: { id: busAId, busNumber: 'BUS-01', registrationNumber: 'KA-01-AB-1234' },
        parentNotificationsSent: 2,
        trackingSessionActive: true,
        replyText: 'Trip Started Successfully! Route: R-101 Bus: BUS-01',
      });

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/message')
        .send({
          from: '+919876543210',
          text: '1',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(DriverWhatsAppAction.START_TRIP);
      expect(res.body.data.replyText).toContain('Trip Started Successfully!');
      expect(res.body.data.replyText).toContain('R-101');
    });

    it('handles End Trip command (2 / end / END_TRIP) when trip is active', async () => {
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

      // 2. Active trip lookup
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

      vi.spyOn(DriverWhatsappService, 'endTripViaWhatsApp').mockResolvedValueOnce({
        success: true,
        alreadyCompleted: false,
        trip: { id: tripAId, status: TripStatus.COMPLETED } as any,
        summary: { durationMinutes: 45, stopsCompleted: 5 } as any,
        driver: { id: driverAId, fullName: 'Rajesh Driver', phone: '+919876543210' },
        bus: { id: busAId, busNumber: 'BUS-01', registrationNumber: 'KA-01-AB-1234' },
        attendanceLocked: true,
        trackingSessionActive: false,
        replyText: 'Trip Completed Successfully! Route: R-101 Bus: BUS-01',
      });

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/message')
        .send({
          from: '+919876543210',
          text: '2',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(DriverWhatsAppAction.END_TRIP);
      expect(res.body.data.replyText).toContain('Trip Completed Successfully!');
    });

    it('handles Student Search command (3 / search / student search)', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: driverAId,
          school_id: schoolA,
          full_name: 'Rajesh Driver',
          phone: '+919876543210',
          license_number: 'DL-01',
        },
      ] as any);
      querySpy.mockResolvedValueOnce([]); // No active trip
      querySpy.mockResolvedValueOnce([]); // No scheduled trip

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/message')
        .send({
          from: '+919876543210',
          text: '3',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(DriverWhatsAppAction.STUDENT_SEARCH);
      expect(res.body.data.replyText).toContain('Student Search');
      expect(res.body.data.replyText).toContain('admission number');
    });

    it('handles Report Problem command (4 / problem / report problem)', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: driverAId,
          school_id: schoolA,
          full_name: 'Rajesh Driver',
          phone: '+919876543210',
          license_number: 'DL-01',
        },
      ] as any);
      querySpy.mockResolvedValueOnce([]);
      querySpy.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/message')
        .send({
          from: '+919876543210',
          text: 'report problem',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(DriverWhatsAppAction.REPORT_PROBLEM);
      expect(res.body.data.replyText).toContain('Report Operational Problem');
      expect(res.body.data.replyText).toContain('TRAFFIC');
      expect(res.body.data.replyText).toContain('BREAKDOWN');
    });

    it('handles Emergency command (5 / emergency / sos)', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: driverAId,
          school_id: schoolA,
          full_name: 'Rajesh Driver',
          phone: '+919876543210',
          license_number: 'DL-01',
        },
      ] as any);
      querySpy.mockResolvedValueOnce([]);
      querySpy.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/message')
        .send({
          from: '+919876543210',
          text: 'sos',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(DriverWhatsAppAction.EMERGENCY);
      expect(res.body.data.replyText).toContain('EMERGENCY / SOS DISPATCH');
      expect(res.body.data.replyText).toContain('112');
    });
  });

  describe('4. WhatsApp Cloud API Webhook Ingestion', () => {
    it('processes Meta Cloud WhatsApp interactive button reply webhook payload', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: driverAId,
          school_id: schoolA,
          full_name: 'Rajesh Driver',
          phone: '+919876543210',
          license_number: 'DL-01',
        },
      ] as any);
      querySpy.mockResolvedValueOnce([]);
      querySpy.mockResolvedValueOnce([]);

      const webhookPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WABA_ID_001',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  messages: [
                    {
                      from: '919876543210',
                      id: 'wamid.HBgL...',
                      timestamp: '1729168000',
                      type: 'interactive',
                      interactive: {
                        type: 'button_reply',
                        button_reply: {
                          id: 'DRIVER_ACTION_HELP',
                          title: 'Help',
                        },
                      },
                    },
                  ],
                },
                field: 'messages',
              },
            ],
          },
        ],
      };

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/webhook')
        .send(webhookPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.handled).toBe(true);
      expect(res.body.data.actionTriggered).toBe(DriverWhatsAppAction.HELP);
    });

    it('gracefully returns handled: false for non-message webhook events', async () => {
      const res = await request(app)
        .post('/api/v1/driver/whatsapp/webhook')
        .send({ object: 'whatsapp_business_account', entry: [] });

      expect(res.status).toBe(200);
      expect(res.body.handled).toBe(false);
    });
  });
});
