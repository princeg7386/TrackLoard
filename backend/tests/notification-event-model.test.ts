import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NotificationEventTypeSchema,
  NotificationPrioritySchema,
  NotificationRecipientRoleSchema,
  NotificationRecipientSchema,
  NotificationEventPayloadSchema,
  NotificationSchema,
  SendMessageOptionsSchema,
  getNotificationEventDefaultPriority,
  getNotificationEventDefaultRoles,
  isUrgentNotificationPriority,
  NOTIFICATION_EVENT_CONFIGS,
  NotificationEventType,
} from '@school-bus/shared';
import { NotificationEventService } from '../src/services/notification-event.service.js';
import * as database from '../src/config/database.js';

// Mock database query
vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  pool: { end: vi.fn() },
}));

describe('Phase 24.1: Notification Event Model, Recipients & Priority Tiers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Notification Event Taxonomy', () => {
    const validEvents: NotificationEventType[] = [
      'EMERGENCY_SOS',
      'BUS_BREAKDOWN',
      'ROUTE_DEVIATION',
      'ACCIDENT_ALERT',
      'BUS_APPROACHING',
      'BUS_APPROACHING_10M',
      'BUS_APPROACHING_3M',
      'BUS_ARRIVED_STOP',
      'STUDENT_BOARDED',
      'STUDENT_DROPPED',
      'MISSED_BOARDING',
      'TRIP_STARTED',
      'TRIP_DELAYED',
      'TRIP_COMPLETED',
      'BUS_ARRIVED_SCHOOL',
      'PARENT_INVITE',
      'TOKEN_REVOKED_NOTICE',
      'GPS_UNAVAILABLE',
      'UNUSUAL_STOP',
      'GENERAL_ALERT',
    ];

    it('successfully validates all official notification event types', () => {
      for (const eventType of validEvents) {
        expect(NotificationEventTypeSchema.parse(eventType)).toBe(eventType);
      }
    });

    it('rejects unsupported or fabricated event types', () => {
      expect(() => NotificationEventTypeSchema.parse('RANDOM_MARKETING_PROMO')).toThrow();
      expect(() => NotificationEventTypeSchema.parse('PAYMENT_REMINDER')).toThrow();
      expect(() => NotificationEventTypeSchema.parse('')).toThrow();
    });

    it('ensures every event type has an entry in NOTIFICATION_EVENT_CONFIGS', () => {
      for (const eventType of validEvents) {
        const config = NOTIFICATION_EVENT_CONFIGS[eventType];
        expect(config).toBeDefined();
        expect(config.eventType).toBe(eventType);
        expect(['CRITICAL', 'HIGH', 'NORMAL', 'LOW']).toContain(config.defaultPriority);
        expect(Array.isArray(config.defaultRecipients)).toBe(true);
        expect(config.defaultRecipients.length).toBeGreaterThan(0);
        expect(typeof config.requiresImmediateDispatch).toBe('boolean');
        expect(typeof config.allowOptOut).toBe('boolean');
        expect(typeof config.description).toBe('string');
      }
    });
  });

  describe('2. Priority Tiers & Escalation Matrix', () => {
    it('validates all four priority levels (CRITICAL, HIGH, NORMAL, LOW)', () => {
      expect(NotificationPrioritySchema.parse('CRITICAL')).toBe('CRITICAL');
      expect(NotificationPrioritySchema.parse('HIGH')).toBe('HIGH');
      expect(NotificationPrioritySchema.parse('NORMAL')).toBe('NORMAL');
      expect(NotificationPrioritySchema.parse('LOW')).toBe('LOW');
      expect(() => NotificationPrioritySchema.parse('URGENT')).toThrow();
    });

    it('correctly classifies urgent vs non-urgent priorities', () => {
      expect(isUrgentNotificationPriority('CRITICAL')).toBe(true);
      expect(isUrgentNotificationPriority('HIGH')).toBe(true);
      expect(isUrgentNotificationPriority('NORMAL')).toBe(false);
      expect(isUrgentNotificationPriority('LOW')).toBe(false);
    });

    it('maps safety and SOS events to CRITICAL priority by default', () => {
      expect(getNotificationEventDefaultPriority('EMERGENCY_SOS')).toBe('CRITICAL');
      expect(getNotificationEventDefaultPriority('BUS_BREAKDOWN')).toBe('CRITICAL');
      expect(getNotificationEventDefaultPriority('ACCIDENT_ALERT')).toBe('CRITICAL');
    });

    it('maps proximity and deviation events to HIGH priority by default', () => {
      expect(getNotificationEventDefaultPriority('BUS_APPROACHING')).toBe('HIGH');
      expect(getNotificationEventDefaultPriority('MISSED_BOARDING')).toBe('HIGH');
      expect(getNotificationEventDefaultPriority('ROUTE_DEVIATION')).toBe('HIGH');
      expect(getNotificationEventDefaultPriority('TRIP_DELAYED')).toBe('HIGH');
    });

    it('maps lifecycle events to NORMAL priority by default', () => {
      expect(getNotificationEventDefaultPriority('TRIP_STARTED')).toBe('NORMAL');
      expect(getNotificationEventDefaultPriority('BUS_ARRIVED_STOP')).toBe('NORMAL');
      expect(getNotificationEventDefaultPriority('STUDENT_BOARDED')).toBe('NORMAL');
      expect(getNotificationEventDefaultPriority('STUDENT_DROPPED')).toBe('NORMAL');
      expect(getNotificationEventDefaultPriority('TRIP_COMPLETED')).toBe('NORMAL');
      expect(getNotificationEventDefaultPriority('BUS_ARRIVED_SCHOOL')).toBe('NORMAL');
      expect(getNotificationEventDefaultPriority('TOKEN_REVOKED_NOTICE')).toBe('NORMAL');
    });

    it('maps onboarding invites to LOW priority by default', () => {
      expect(getNotificationEventDefaultPriority('PARENT_INVITE')).toBe('LOW');
    });

    it('resolves priority with contextual escalation', () => {
      // Normal delay is HIGH
      expect(NotificationEventService.resolveEventPriority('TRIP_DELAYED', { delayMinutes: 8 })).toBe('HIGH');

      // Extreme delay (>= 20 min) escalates to CRITICAL
      expect(NotificationEventService.resolveEventPriority('TRIP_DELAYED', { delayMinutes: 25 })).toBe('CRITICAL');

      // Severe flag escalates any event to CRITICAL
      expect(NotificationEventService.resolveEventPriority('BUS_APPROACHING', { isSevere: true })).toBe('CRITICAL');

      // Explicit priority override takes precedence
      expect(
        NotificationEventService.resolveEventPriority('PARENT_INVITE', { explicitPriority: 'CRITICAL' })
      ).toBe('CRITICAL');
    });
  });

  describe('3. Recipient Roles & Targeting', () => {
    it('validates supported recipient roles including legacy ADMIN and new granular roles', () => {
      expect(NotificationRecipientRoleSchema.parse('PARENT')).toBe('PARENT');
      expect(NotificationRecipientRoleSchema.parse('DRIVER')).toBe('DRIVER');
      expect(NotificationRecipientRoleSchema.parse('ADMIN')).toBe('ADMIN');
      expect(NotificationRecipientRoleSchema.parse('SCHOOL_ADMIN')).toBe('SCHOOL_ADMIN');
      expect(NotificationRecipientRoleSchema.parse('TRANSPORT_COORDINATOR')).toBe('TRANSPORT_COORDINATOR');
      expect(NotificationRecipientRoleSchema.parse('EMERGENCY_CONTACT')).toBe('EMERGENCY_CONTACT');
      expect(() => NotificationRecipientRoleSchema.parse('TEACHER')).toThrow();
    });

    it('ensures safety events target staff and parents/emergency contacts', () => {
      const sosRoles = getNotificationEventDefaultRoles('EMERGENCY_SOS');
      expect(sosRoles).toContain('SCHOOL_ADMIN');
      expect(sosRoles).toContain('TRANSPORT_COORDINATOR');
      expect(sosRoles).toContain('PARENT');
      expect(sosRoles).toContain('EMERGENCY_CONTACT');
    });

    it('ensures stop arrival and approach events target parents directly', () => {
      expect(getNotificationEventDefaultRoles('BUS_APPROACHING')).toEqual(['PARENT']);
      expect(getNotificationEventDefaultRoles('BUS_ARRIVED_STOP')).toEqual(['PARENT']);
      expect(getNotificationEventDefaultRoles('STUDENT_BOARDED')).toEqual(['PARENT']);
      expect(getNotificationEventDefaultRoles('STUDENT_DROPPED')).toEqual(['PARENT']);
    });

    it('validates a structured NotificationRecipient model', () => {
      const recipient = {
        schoolId: '123e4567-e89b-12d3-a456-426614174000',
        phone: '+919876543210',
        role: 'PARENT' as const,
        name: 'Sunita Sharma',
        studentId: '223e4567-e89b-12d3-a456-426614174001',
        tripId: '323e4567-e89b-12d3-a456-426614174002',
        preferredChannel: 'WHATSAPP' as const,
      };
      const parsed = NotificationRecipientSchema.parse(recipient);
      expect(parsed.phone).toBe('+919876543210');
      expect(parsed.role).toBe('PARENT');
      expect(parsed.preferredChannel).toBe('WHATSAPP');
    });
  });

  describe('4. Notification Event Service & Payload Lifecycle', () => {
    it('creates standardized NotificationEventPayload with automatic defaults', () => {
      const event = NotificationEventService.createEvent({
        schoolId: '123e4567-e89b-12d3-a456-426614174000',
        eventType: 'BUS_APPROACHING',
        title: 'Bus Approaching Stop',
        message: 'Bus #12 is 500 meters from your stop.',
        tripId: '323e4567-e89b-12d3-a456-426614174002',
        studentId: '223e4567-e89b-12d3-a456-426614174001',
      });

      expect(event.eventId).toBeDefined();
      expect(event.createdAt).toBeDefined();
      expect(event.priority).toBe('HIGH'); // derived from default
      expect(event.eventType).toBe('BUS_APPROACHING');
      expect(event.title).toBe('Bus Approaching Stop');
    });

    it('validates payloads correctly via validatePayload helper', () => {
      const valid = {
        schoolId: '123e4567-e89b-12d3-a456-426614174000',
        eventType: 'EMERGENCY_SOS',
        title: 'Emergency SOS',
        message: 'Driver reported an emergency on Route 4',
      };
      const validResult = NotificationEventService.validatePayload(valid);
      expect(validResult.isValid).toBe(true);
      expect(validResult.data?.eventType).toBe('EMERGENCY_SOS');

      const invalid = {
        schoolId: 'not-a-uuid',
        eventType: 'INVALID_TYPE',
      };
      const invalidResult = NotificationEventService.validatePayload(invalid);
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.error).toBeDefined();
    });

    it('records notification into database with typed event_type and priority', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([{ id: 'notif-uuid-999' }]);

      const recordId = await NotificationEventService.recordNotification({
        schoolId: '123e4567-e89b-12d3-a456-426614174000',
        recipientPhone: '+919876543210',
        recipientRole: 'PARENT',
        eventType: 'BUS_APPROACHING',
        messageBody: 'Bus is nearing your stop',
        channel: 'WHATSAPP',
      });

      expect(recordId).toBe('notif-uuid-999');
      expect(mockQuery).toHaveBeenCalledTimes(1);

      const sql = mockQuery.mock.calls[0][0];
      const params = mockQuery.mock.calls[0][1];

      expect(sql).toContain('INSERT INTO notifications');
      expect(sql).toContain('event_type');
      expect(sql).toContain('priority');
      expect(params).toContain('BUS_APPROACHING');
      expect(params).toContain('HIGH');
    });

    it('resolves trip recipients across parent, driver, and staff roles', async () => {
      const mockQuery = vi.mocked(database.query);

      // 1st query: parents for trip
      mockQuery.mockResolvedValueOnce([
        {
          parentId: 'parent-1',
          phone: '+919876543210',
          name: 'Sunita Sharma',
          studentId: 'student-1',
        },
      ]);

      // 2nd query: staff (admin/coordinator)
      mockQuery.mockResolvedValueOnce([
        {
          id: 'user-admin-1',
          phone: '+919876543299',
          name: 'Principal Sharma',
          role: 'ADMIN',
        },
      ]);

      const recipients = await NotificationEventService.resolveRecipientsForTrip(
        '123e4567-e89b-12d3-a456-426614174000',
        '323e4567-e89b-12d3-a456-426614174002',
        'TRIP_STARTED'
      );

      expect(recipients.length).toBe(2);
      expect(recipients[0].role).toBe('PARENT');
      expect(recipients[0].phone).toBe('+919876543210');
      expect(recipients[1].role).toBe('SCHOOL_ADMIN');
      expect(recipients[1].phone).toBe('+919876543299');
    });
  });

  describe('5. Backward Compatibility', () => {
    it('maintains backwards compatibility for legacy NotificationSchema without eventType', () => {
      const legacyRecord = {
        schoolId: '123e4567-e89b-12d3-a456-426614174000',
        recipientPhone: '+919876543210',
        recipientRole: 'PARENT' as const,
        channel: 'WHATSAPP' as const,
        messageBody: 'Legacy format notification',
        status: 'SENT' as const,
      };

      const parsed = NotificationSchema.parse(legacyRecord);
      expect(parsed.priority).toBe('NORMAL');
      expect(parsed.eventType).toBeUndefined();
      expect(parsed.recipientRole).toBe('PARENT');
    });

    it('maintains backwards compatibility for SendMessageOptionsSchema with optional eventType', () => {
      const optionsWithoutEvent = {
        recipientPhone: '+919876543210',
        directText: 'Direct message',
      };
      const parsedWithout = SendMessageOptionsSchema.parse(optionsWithoutEvent);
      expect(parsedWithout.eventType).toBeUndefined();

      const optionsWithEvent = {
        recipientPhone: '+919876543210',
        directText: 'Bus is near',
        eventType: 'BUS_APPROACHING' as const,
        priority: 'HIGH' as const,
      };
      const parsedWith = SendMessageOptionsSchema.parse(optionsWithEvent);
      expect(parsedWith.eventType).toBe('BUS_APPROACHING');
      expect(parsedWith.priority).toBe('HIGH');
    });
  });
});
