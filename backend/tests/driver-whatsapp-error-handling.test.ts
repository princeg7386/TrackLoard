import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import * as db from '../src/config/database.js';
import { DriverWhatsappService } from '../src/services/driver-whatsapp.service.js';
import { MessagingService } from '../src/services/messaging/messaging.service.js';
import { MockMessagingAdapter } from '../src/services/messaging/mock-messaging.adapter.js';
import { DriverWhatsAppAction, TripStatus } from '@school-bus/shared';

const schoolA = '111e4567-e89b-12d3-a456-426614174001';
const driverAId = 'ddd11111-e89b-12d3-a456-426614174001';
const busAId = '222e4567-e89b-12d3-a456-426614174222';
const routeAId = '555e4567-e89b-12d3-a456-426614174555';
const tripAId = '777e4567-e89b-12d3-a456-426614174777';

describe('Phase 17.4: Driver WhatsApp Core — Error Handling & Failure Recovery', () => {
  let app: any;

  beforeEach(() => {
    app = createApp();
    MessagingService.resetProvider();
    DriverWhatsappService.clearCommandCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    MessagingService.resetProvider();
    DriverWhatsappService.clearCommandCache();
  });

  describe('1. No Assigned Bus Error Handling', () => {
    it('returns 400 Bad Request with errorCode NO_ASSIGNED_BUS on /start-trip when driver has no assigned bus', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Driver lookup: driver has NO bus_id
      querySpy.mockResolvedValueOnce([
        {
          id: driverAId,
          school_id: schoolA,
          full_name: 'Rajesh Driver',
          phone: '+919876543210',
          license_number: 'DL-01',
          bus_id: null,
          bus_number: null,
          registration_number: null,
        },
      ] as any);

      // 2. Active trip query (none)
      querySpy.mockResolvedValueOnce([]);

      // 3. Scheduled trip query (none)
      querySpy.mockResolvedValueOnce([]);

      // 4. Assigned route query: route has NO default_bus_id
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
          from: '+919876543210',
          schoolId: schoolA,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('No assigned bus');
      expect(res.body.error.details.errorCode).toBe('NO_ASSIGNED_BUS');
    });

    it('returns structured actionable WhatsApp reply with errorCode NO_ASSIGNED_BUS when driver sends start trip message', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Driver lookup: driver has NO bus_id
      querySpy.mockResolvedValueOnce([
        {
          id: driverAId,
          school_id: schoolA,
          full_name: 'Rajesh Driver',
          phone: '+919876543210',
          license_number: 'DL-01',
          bus_id: null,
          bus_number: null,
          registration_number: null,
        },
      ] as any);

      // 2. Menu lookup: active trip (none)
      querySpy.mockResolvedValueOnce([]);
      // 3. Menu lookup: scheduled trip (none)
      querySpy.mockResolvedValueOnce([]);

      // 4. In startTripViaWhatsApp: driver lookup
      querySpy.mockResolvedValueOnce([
        {
          id: driverAId,
          school_id: schoolA,
          full_name: 'Rajesh Driver',
          phone: '+919876543210',
          license_number: 'DL-01',
          bus_id: null,
          bus_number: null,
          registration_number: null,
        },
      ] as any);

      // 5. Active trip check (none)
      querySpy.mockResolvedValueOnce([]);
      // 6. Scheduled trip check (none)
      querySpy.mockResolvedValueOnce([]);
      // 7. Assigned route check (route with no bus)
      querySpy.mockResolvedValueOnce([
        {
          id: routeAId,
          name: 'Route 101',
          code: 'R-101',
          default_bus_id: null,
        },
      ] as any);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/message')
        .send({
          from: '+919876543210',
          text: '1',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(DriverWhatsAppAction.START_TRIP);
      expect(res.body.data.errorCode).toBe('NO_ASSIGNED_BUS');
      expect(res.body.data.replyText).toContain('No Assigned Bus Found');
      expect(res.body.data.replyText).toContain('School Transport Coordinator');

      // Verify outbound WhatsApp notification was dispatched
      const sent = MockMessagingAdapter.getSentMessages();
      expect(sent.length).toBe(1);
      expect(sent[0]?.directText).toContain('No Assigned Bus Found');
    });
  });

  describe('2. No Active Trip Error Handling', () => {
    it('returns 400 Bad Request with errorCode NO_ACTIVE_TRIP on /end-trip when no trip is running', async () => {
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

      // 2. Active trip in transit (none)
      querySpy.mockResolvedValueOnce([]);

      // 3. Recently completed trip today (none)
      querySpy.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/end-trip')
        .send({
          from: '+919876543210',
          schoolId: schoolA,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('active trip in transit');
      expect(res.body.error.details.errorCode).toBe('NO_ACTIVE_TRIP');
    });

    it('returns structured actionable WhatsApp reply with errorCode NO_ACTIVE_TRIP when driver sends end trip message with no trip', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Driver lookup for inbound message
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

      // 2. Menu lookup: active trip (none)
      querySpy.mockResolvedValueOnce([]);
      // 3. Menu lookup: scheduled trip (none)
      querySpy.mockResolvedValueOnce([]);

      // 4. In endTripViaWhatsApp: driver lookup
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

      // 5. Active trip check (none)
      querySpy.mockResolvedValueOnce([]);
      // 6. Recently completed trip check (none)
      querySpy.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/message')
        .send({
          from: '+919876543210',
          text: '2',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe(DriverWhatsAppAction.END_TRIP);
      expect(res.body.data.errorCode).toBe('NO_ACTIVE_TRIP');
      expect(res.body.data.replyText).toContain('No Active Trip Found');
      expect(res.body.data.replyText).toContain('Reply *1* to start');

      const sent = MockMessagingAdapter.getSentMessages();
      expect(sent.length).toBe(1);
      expect(sent[0]?.directText).toContain('No Active Trip Found');
    });
  });

  describe('3. Duplicate Command & Debounce Protection', () => {
    it('safely debounces rapid repeated command submissions and returns DUPLICATE_COMMAND', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // Setup mock queries for first message
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
      querySpy.mockResolvedValueOnce([]);
      querySpy.mockResolvedValueOnce([]);

      // First submission: Help / Menu command
      const res1 = await request(app)
        .post('/api/v1/driver/whatsapp/message')
        .send({
          from: '+919876543210',
          text: 'help',
        });

      expect(res1.status).toBe(200);
      expect(res1.body.data.actionTriggered).toBe(DriverWhatsAppAction.HELP);

      // Second identical submission within debounce window (immediate)
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

      const res2 = await request(app)
        .post('/api/v1/driver/whatsapp/message')
        .send({
          from: '+919876543210',
          text: 'help',
        });

      expect(res2.status).toBe(200);
      expect(res2.body.data.actionTriggered).toBe('DUPLICATE_COMMAND');
      expect(res2.body.data.errorCode).toBe('DUPLICATE_COMMAND');
      expect(res2.body.data.replyText).toContain('Duplicate Request Received');
    });
  });

  describe('4. Unknown Command Parsing & Recovery Guidance', () => {
    it('parses unrecognized commands to UNKNOWN_COMMAND with actionable 1-6 guidance', async () => {
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

      // 2. Menu lookup
      querySpy.mockResolvedValueOnce([]);
      querySpy.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/message')
        .send({
          from: '+919876543210',
          text: 'what is the weather today?',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.handled).toBe(false);
      expect(res.body.data.actionTriggered).toBe('UNKNOWN_COMMAND');
      expect(res.body.data.errorCode).toBe('UNKNOWN_COMMAND');
      expect(res.body.data.replyText).toContain('Command Not Recognized');
      expect(res.body.data.replyText).toContain('what is the weather today?');
      expect(res.body.data.replyText).toContain('1️⃣ *Start Trip*');
      expect(res.body.data.replyText).toContain('6️⃣ *Help*');

      const sent = MockMessagingAdapter.getSentMessages();
      expect(sent.length).toBe(1);
      expect(sent[0]?.directText).toContain('Command Not Recognized');
    });
  });

  describe('5. Temporary WhatsApp / Provider API Failure Resilience', () => {
    it('handles outbound WhatsApp dispatch failure gracefully without crashing and audits failed notification', async () => {
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

      // 2. Menu lookup
      querySpy.mockResolvedValueOnce([]);
      querySpy.mockResolvedValueOnce([]);

      // Mock outbound messaging service failure (e.g. Meta Cloud API 503)
      vi.spyOn(MessagingService, 'sendMessage').mockRejectedValueOnce(
        new Error('Meta Cloud API 503 Service Unavailable: Network timeout')
      );

      // Mock notifications audit insert
      querySpy.mockResolvedValueOnce([{ id: 'notif-123' }] as any);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/message')
        .send({
          from: '+919876543210',
          text: 'help',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.handled).toBe(true);
      expect(res.body.data.whatsappDelivered).toBe(false);
      expect(res.body.data.errorCode).toBe('TEMPORARY_WHATSAPP_FAILURE');
      expect(res.body.data.replyText).toContain('School Bus Driver Menu');

      // Verify DB query recorded failed notification audit
      const auditCall = querySpy.mock.calls.find((call) =>
        typeof call[0] === 'string' && call[0].includes('INSERT INTO notifications')
      );
      expect(auditCall).toBeDefined();
      expect(auditCall?.[1]).toContain('FAILED');
    });

    it('handles outbound WhatsApp dispatch failure for unregistered driver without crashing', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // Unregistered driver query
      querySpy.mockResolvedValueOnce([]);

      // Outbound dispatch fails
      vi.spyOn(MessagingService, 'sendMessage').mockRejectedValueOnce(
        new Error('Connection reset by peer')
      );

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/message')
        .send({
          from: '+919999988888',
          text: 'hello',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.handled).toBe(false);
      expect(res.body.data.actionTriggered).toBe('UNREGISTERED');
      expect(res.body.data.whatsappDelivered).toBe(false);
      expect(res.body.data.errorCode).toBe('TEMPORARY_WHATSAPP_FAILURE');
      expect(res.body.data.replyText).toContain('Unregistered Mobile Number');
    });
  });
});
