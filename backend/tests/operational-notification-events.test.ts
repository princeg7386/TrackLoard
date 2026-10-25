import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OperationalNotificationService } from '../src/services/operational-notification.service.js';
import { MessagingService } from '../src/services/messaging/messaging.service.js';
import * as database from '../src/config/database.js';

// Mock database query
vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  pool: { end: vi.fn() },
}));

// Mock MessagingService
vi.mock('../src/services/messaging/messaging.service.js', () => ({
  MessagingService: {
    sendMessage: vi.fn(),
  },
}));

describe('Phase 24.3: Operational Notification Events Lifecycle', () => {
  const schoolId = '11111111-1111-1111-1111-111111111111';
  const tripId = '22222222-2222-2222-2222-222222222222';
  const routeId = '33333333-3333-3333-3333-333333333333';
  const busId = '44444444-4444-4444-4444-444444444444';
  const driverId = '55555555-5555-5555-5555-555555555555';

  const mockTripContext = {
    tripId,
    schoolId,
    routeId,
    routeName: 'Morning North Route 4',
    busId,
    busNumber: 'DL-01-AB-1234',
    driverId,
    driverName: 'Ramesh Singh',
    driverPhone: '+919876500001',
    schoolPhone: '+911122334455',
    schoolEmergencyPhone: '+911199887766',
  };

  const mockStaffContact = {
    id: 'user-coordinator-1',
    phone: '+919876599999',
    name: 'Mr. Verma (Coordinator)',
    role: 'TRANSPORT_COORDINATOR' as const,
  };

  const mockParentInfo = {
    parentId: 'parent-1',
    parentPhone: '+919876543210',
    parentName: 'Sunita Sharma',
    studentId: 'student-1',
    studentName: 'Aarav Sharma',
    trackingToken: 'valid-token-xyz',
    notificationsEnabled: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Delay (TRIP_DELAYED)', () => {
    it('skips dispatch if delay is below the 10-minute threshold', async () => {
      const result = await OperationalNotificationService.notifyTripDelay({
        schoolId,
        tripId,
        delayMinutes: 5,
      });

      expect(result.notificationsSent).toBe(0);
      expect(result.cooldownActive).toBe(false);
    });

    it('dispatches HIGH priority alert for 15-minute delay to staff and parents', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      // 1. isCooldownActive -> no recent notification
      mockQuery.mockResolvedValueOnce([]);
      // 2. fetchTripContext
      mockQuery.mockResolvedValueOnce([mockTripContext]);
      // 3. fetchStaffContacts
      mockQuery.mockResolvedValueOnce([mockStaffContact]);
      // 4. fetchTripParents
      mockQuery.mockResolvedValueOnce([mockParentInfo]);
      // 5. insert into delays table
      mockQuery.mockResolvedValueOnce([{ id: 'delay-record-1' }]);

      mockSend.mockResolvedValue({
        messageId: 'msg-delay-1',
        status: 'sent',
        provider: 'mock',
        timestamp: new Date().toISOString(),
      });

      const result = await OperationalNotificationService.notifyTripDelay({
        schoolId,
        tripId,
        delayMinutes: 15,
        reason: 'Heavy traffic on Ring Road',
      });

      expect(result.eventType).toBe('TRIP_DELAYED');
      expect(result.notificationsSent).toBe(2); // 1 staff + 1 parent
      expect(result.cooldownActive).toBe(false);

      // Verify staff message
      const staffCall = mockSend.mock.calls[0][0];
      expect(staffCall.recipientRole).toBe('TRANSPORT_COORDINATOR');
      expect(staffCall.priority).toBe('HIGH');
      expect(staffCall.directText).toContain('delayed by 15 minutes');

      // Verify parent message
      const parentCall = mockSend.mock.calls[1][0];
      expect(parentCall.recipientRole).toBe('PARENT');
      expect(parentCall.priority).toBe('HIGH');
      expect(parentCall.directText).toContain('Heavy traffic on Ring Road');
      expect(parentCall.directText).toContain('valid-token-xyz');
    });

    it('escalates priority to CRITICAL when delay is >= 20 minutes', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      mockQuery.mockResolvedValueOnce([]); // no cooldown
      mockQuery.mockResolvedValueOnce([mockTripContext]);
      mockQuery.mockResolvedValueOnce([mockStaffContact]);
      mockQuery.mockResolvedValueOnce([]); // no parents
      mockQuery.mockResolvedValueOnce([{ id: 'delay-record-2' }]);

      mockSend.mockResolvedValueOnce({
        messageId: 'msg-delay-crit',
        status: 'sent',
        provider: 'mock',
        timestamp: new Date().toISOString(),
      });

      const result = await OperationalNotificationService.notifyTripDelay({
        schoolId,
        tripId,
        delayMinutes: 25,
      });

      expect(result.notificationsSent).toBe(1);
      const staffCall = mockSend.mock.calls[0][0];
      expect(staffCall.priority).toBe('CRITICAL');
    });

    it('suppresses notifications if cooldown window is active', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      // Cooldown check finds recent notification sent 5 minutes ago
      const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      mockQuery.mockResolvedValueOnce([{ created_at: recentTime }]);

      const result = await OperationalNotificationService.notifyTripDelay({
        schoolId,
        tripId,
        delayMinutes: 15,
      });

      expect(result.cooldownActive).toBe(true);
      expect(result.notificationsSent).toBe(0);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('2. GPS Unavailable (GPS_UNAVAILABLE)', () => {
    it('dispatches GPS unavailable alert to coordinator and driver', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      mockQuery.mockResolvedValueOnce([]); // no cooldown
      mockQuery.mockResolvedValueOnce([mockTripContext]);
      mockQuery.mockResolvedValueOnce([mockStaffContact]);

      mockSend.mockResolvedValue({
        messageId: 'msg-gps-lost',
        status: 'sent',
        provider: 'mock',
        timestamp: new Date().toISOString(),
      });

      const result = await OperationalNotificationService.notifyGpsUnavailable({
        schoolId,
        tripId,
        lastSeenAt: '2026-10-25T07:30:00.000Z',
      });

      expect(result.eventType).toBe('GPS_UNAVAILABLE');
      expect(result.notificationsSent).toBe(2); // 1 staff + 1 driver

      const staffCall = mockSend.mock.calls[0][0];
      expect(staffCall.recipientRole).toBe('TRANSPORT_COORDINATOR');
      expect(staffCall.directText).toContain('GPS signal unavailable for Bus DL-01-AB-1234');

      const driverCall = mockSend.mock.calls[1][0];
      expect(driverCall.recipientRole).toBe('DRIVER');
      expect(driverCall.recipientPhone).toBe('+919876500001');
      expect(driverCall.directText).toContain('Your GPS background tracking signal is offline');
    });
  });

  describe('3. Route Deviation (ROUTE_DEVIATION)', () => {
    it('dispatches route deviation warning to coordinator and driver', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      mockQuery.mockResolvedValueOnce([]); // no cooldown
      mockQuery.mockResolvedValueOnce([mockTripContext]);
      mockQuery.mockResolvedValueOnce([mockStaffContact]);

      mockSend.mockResolvedValue({
        messageId: 'msg-dev-1',
        status: 'sent',
        provider: 'mock',
        timestamp: new Date().toISOString(),
      });

      const result = await OperationalNotificationService.notifyRouteDeviation({
        schoolId,
        tripId,
        deviationDistanceMeters: 650,
        latitude: 28.5355,
        longitude: 77.241,
        currentSpeedKmh: 35,
      });

      expect(result.eventType).toBe('ROUTE_DEVIATION');
      expect(result.notificationsSent).toBe(2);

      const staffCall = mockSend.mock.calls[0][0];
      expect(staffCall.priority).toBe('HIGH');
      expect(staffCall.directText).toContain('approx 650m off-route');
      expect(staffCall.directText).toContain('Speed: 35 km/h');

      const driverCall = mockSend.mock.calls[1][0];
      expect(driverCall.priority).toBe('HIGH');
      expect(driverCall.directText).toContain('departed from route');
    });
  });

  describe('4. Emergency SOS (EMERGENCY_SOS)', () => {
    it('executes CRITICAL broadcast to staff and parents, and logs to sos_events', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      // 1. fetchTripContext
      mockQuery.mockResolvedValueOnce([mockTripContext]);
      // 2. insert into sos_events
      mockQuery.mockResolvedValueOnce([{ id: 'sos-uuid-123' }]);
      // 3. fetchStaffContacts
      mockQuery.mockResolvedValueOnce([mockStaffContact]);
      // 4. fetchTripParents
      mockQuery.mockResolvedValueOnce([mockParentInfo]);

      mockSend.mockResolvedValue({
        messageId: 'msg-sos-crit',
        status: 'sent',
        provider: 'mock',
        timestamp: new Date().toISOString(),
      });

      const result = await OperationalNotificationService.notifyEmergencySos({
        schoolId,
        tripId,
        triggerSource: 'APP_SOS_BUTTON',
        latitude: 28.5355,
        longitude: 77.241,
        notes: 'Driver pressed emergency panic button',
      });

      expect(result.eventType).toBe('EMERGENCY_SOS');
      expect(result.notificationsSent).toBe(2); // 1 staff + 1 parent

      // SOS is never suppressed by cooldown
      expect(result.cooldownActive).toBe(false);

      // Staff emergency alert
      const staffCall = mockSend.mock.calls[0][0];
      expect(staffCall.priority).toBe('CRITICAL');
      expect(staffCall.directText).toContain('CRITICAL SOS EMERGENCY');
      expect(staffCall.directText).toContain('Ramesh Singh');

      // Parent reassurance notice
      const parentCall = mockSend.mock.calls[1][0];
      expect(parentCall.priority).toBe('CRITICAL');
      expect(parentCall.directText).toContain('Safety Alert: An emergency notification was triggered');
      expect(parentCall.directText).toContain('+911122334455'); // Helpline
    });
  });

  describe('5. Unusual Stop (UNUSUAL_STOP)', () => {
    it('dispatches fleet alert to coordinator when bus remains stationary outside stops', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      mockQuery.mockResolvedValueOnce([]); // no cooldown
      mockQuery.mockResolvedValueOnce([mockTripContext]);
      mockQuery.mockResolvedValueOnce([mockStaffContact]);

      mockSend.mockResolvedValueOnce({
        messageId: 'msg-unusual-1',
        status: 'sent',
        provider: 'mock',
        timestamp: new Date().toISOString(),
      });

      const result = await OperationalNotificationService.notifyUnusualStop({
        schoolId,
        tripId,
        stoppedDurationMinutes: 8,
        latitude: 28.5355,
        longitude: 77.241,
        nearestStopName: 'Lajpat Nagar Flyover',
      });

      expect(result.eventType).toBe('UNUSUAL_STOP');
      expect(result.notificationsSent).toBe(1);

      const staffCall = mockSend.mock.calls[0][0];
      expect(staffCall.priority).toBe('HIGH');
      expect(staffCall.directText).toContain('Unusual stop detected');
      expect(staffCall.directText).toContain('stationary outside scheduled stops for 8 minutes');
      expect(staffCall.directText).toContain('Lajpat Nagar Flyover');
      expect(staffCall.directText).toContain('Ramesh Singh');
    });
  });

  describe('6. Non-Blocking Error Handling', () => {
    it('suppresses database connection failures without throwing', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockRejectedValueOnce(new Error('PostgreSQL Pool Connection Terminated'));

      const result = await OperationalNotificationService.notifyTripDelay({
        schoolId,
        tripId,
        delayMinutes: 15,
      });

      expect(result.notificationsSent).toBe(0);
      expect(result.recipientsCount).toBe(0);
    });

    it('suppresses messaging provider dispatch failures without throwing', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      mockQuery.mockResolvedValueOnce([]); // no cooldown
      mockQuery.mockResolvedValueOnce([mockTripContext]);
      mockQuery.mockResolvedValueOnce([mockStaffContact]);

      mockSend.mockRejectedValueOnce(new Error('Meta WhatsApp Cloud Outage'));

      const result = await OperationalNotificationService.notifyGpsUnavailable({
        schoolId,
        tripId,
      });

      // Does not throw an unhandled rejection, reports failure count safely
      expect(result.notificationsSent).toBe(0);
    });
  });
});
