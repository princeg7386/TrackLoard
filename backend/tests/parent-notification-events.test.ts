import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParentNotificationService } from '../src/services/parent-notification.service.js';
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

describe('Phase 24.2: Parent Notification Events Lifecycle', () => {
  const schoolId = '11111111-1111-1111-1111-111111111111';
  const tripId = '22222222-2222-2222-2222-222222222222';
  const stopId = '33333333-3333-3333-3333-333333333333';
  const studentId = '44444444-4444-4444-4444-444444444444';
  const parentId = '55555555-5555-5555-5555-555555555555';

  const mockTargetRow = {
    tripId,
    schoolId,
    busNumber: 'DL-01-AB-1234',
    routeName: 'Route 4 Morning',
    parentId,
    parentPhone: '+919876543210',
    parentName: 'Sunita Sharma',
    studentId,
    studentName: 'Aarav Sharma',
    stopName: 'Green Park Main Gate',
    trackingToken: 'valid-token-xyz',
    notificationsEnabled: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Bus Started (TRIP_STARTED)', () => {
    it('dispatches trip started notification with live tracking magic link', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      // 1st query: candidates
      mockQuery.mockResolvedValueOnce([mockTargetRow]);
      // 2nd query: dedup check (not already notified)
      mockQuery.mockResolvedValueOnce([]);
      // Messaging send
      mockSend.mockResolvedValueOnce({
        messageId: 'msg-started-1',
        status: 'sent',
        provider: 'mock',
        timestamp: new Date().toISOString(),
      });

      const result = await ParentNotificationService.notifyTripStarted({
        schoolId,
        tripId,
      });

      expect(result.eventType).toBe('TRIP_STARTED');
      expect(result.notificationsSent).toBe(1);
      expect(result.parentsChecked).toBe(1);
      expect(result.alreadyNotified).toBe(0);
      expect(result.optedOut).toBe(0);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const sendArgs = mockSend.mock.calls[0][0];
      expect(sendArgs.recipientPhone).toBe('+919876543210');
      expect(sendArgs.recipientRole).toBe('PARENT');
      expect(sendArgs.eventType).toBe('TRIP_STARTED');
      expect(sendArgs.priority).toBe('NORMAL');
      expect(sendArgs.directText).toContain('has started its trip');
      expect(sendArgs.directText).toContain('valid-token-xyz');
    });

    it('deduplicates and skips parents already notified for this trip', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      mockQuery.mockResolvedValueOnce([mockTargetRow]);
      // 2nd query: dedup check finds existing row
      mockQuery.mockResolvedValueOnce([{ id: 'existing-notif-1' }]);

      const result = await ParentNotificationService.notifyTripStarted({
        schoolId,
        tripId,
      });

      expect(result.notificationsSent).toBe(0);
      expect(result.alreadyNotified).toBe(1);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('skips parents who have opted out of notifications', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      mockQuery.mockResolvedValueOnce([
        { ...mockTargetRow, notificationsEnabled: false },
      ]);

      const result = await ParentNotificationService.notifyTripStarted({
        schoolId,
        tripId,
      });

      expect(result.notificationsSent).toBe(0);
      expect(result.optedOut).toBe(1);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('2. 10-Minute Alert (BUS_APPROACHING_10M)', () => {
    it('dispatches 10-minute alert to parents at the approaching stop', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      mockQuery.mockResolvedValueOnce([mockTargetRow]);
      mockQuery.mockResolvedValueOnce([]); // not already notified
      mockSend.mockResolvedValueOnce({
        messageId: 'msg-10m-1',
        status: 'sent',
        provider: 'mock',
        timestamp: new Date().toISOString(),
      });

      const result = await ParentNotificationService.notifyApproaching10Min({
        schoolId,
        tripId,
        stopId,
        etaMinutes: 10,
      });

      expect(result.eventType).toBe('BUS_APPROACHING_10M');
      expect(result.notificationsSent).toBe(1);

      const sendArgs = mockSend.mock.calls[0][0];
      expect(sendArgs.eventType).toBe('BUS_APPROACHING_10M');
      expect(sendArgs.priority).toBe('HIGH');
      expect(sendArgs.directText).toContain('approx 10 minutes away');
      expect(sendArgs.directText).toContain('Green Park Main Gate');
    });
  });

  describe('3. 3-Minute / Nearby Alert (BUS_APPROACHING_3M)', () => {
    it('dispatches 3-minute prompt to step to the pickup point', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      mockQuery.mockResolvedValueOnce([mockTargetRow]);
      mockQuery.mockResolvedValueOnce([]); // not already notified
      mockSend.mockResolvedValueOnce({
        messageId: 'msg-3m-1',
        status: 'sent',
        provider: 'mock',
        timestamp: new Date().toISOString(),
      });

      const result = await ParentNotificationService.notifyApproaching3Min({
        schoolId,
        tripId,
        stopId,
        etaMinutes: 3,
      });

      expect(result.eventType).toBe('BUS_APPROACHING_3M');
      expect(result.notificationsSent).toBe(1);

      const sendArgs = mockSend.mock.calls[0][0];
      expect(sendArgs.eventType).toBe('BUS_APPROACHING_3M');
      expect(sendArgs.priority).toBe('HIGH');
      expect(sendArgs.directText).toContain('approx 3 mins away');
      expect(sendArgs.directText).toContain('Please proceed to the pickup point');
    });
  });

  describe('4. Reached Pickup (BUS_ARRIVED_STOP)', () => {
    it('dispatches bus arrived stop alert upon geofence entry', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      mockQuery.mockResolvedValueOnce([mockTargetRow]);
      mockQuery.mockResolvedValueOnce([]); // not already notified
      mockSend.mockResolvedValueOnce({
        messageId: 'msg-arrived-1',
        status: 'sent',
        provider: 'mock',
        timestamp: new Date().toISOString(),
      });

      const result = await ParentNotificationService.notifyBusArrivedStop({
        schoolId,
        tripId,
        stopId,
        stopName: 'Green Park Main Gate',
      });

      expect(result.eventType).toBe('BUS_ARRIVED_STOP');
      expect(result.notificationsSent).toBe(1);

      const sendArgs = mockSend.mock.calls[0][0];
      expect(sendArgs.eventType).toBe('BUS_ARRIVED_STOP');
      expect(sendArgs.priority).toBe('NORMAL');
      expect(sendArgs.directText).toContain('has arrived at Green Park Main Gate');
    });
  });

  describe('5. Child Boarded (STUDENT_BOARDED)', () => {
    it('dispatches safe boarding confirmation with student name and timestamp', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      mockQuery.mockResolvedValueOnce([mockTargetRow]);
      mockQuery.mockResolvedValueOnce([]); // not already notified
      mockSend.mockResolvedValueOnce({
        messageId: 'msg-boarded-1',
        status: 'sent',
        provider: 'mock',
        timestamp: new Date().toISOString(),
      });

      const success = await ParentNotificationService.notifyStudentBoarded({
        schoolId,
        tripId,
        studentId,
        stopId,
        recordedAt: '2026-10-25T07:45:00.000Z',
      });

      expect(success).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);

      const sendArgs = mockSend.mock.calls[0][0];
      expect(sendArgs.eventType).toBe('STUDENT_BOARDED');
      expect(sendArgs.priority).toBe('NORMAL');
      expect(sendArgs.directText).toContain('Aarav Sharma has safely boarded');
      expect(sendArgs.directText).toContain('DL-01-AB-1234');
    });

    it('returns false and skips dispatch if already notified for boarding', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      mockQuery.mockResolvedValueOnce([mockTargetRow]);
      mockQuery.mockResolvedValueOnce([{ id: 'existing-boarded-1' }]);

      const success = await ParentNotificationService.notifyStudentBoarded({
        schoolId,
        tripId,
        studentId,
        stopId,
      });

      expect(success).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('6. Child Dropped (STUDENT_DROPPED)', () => {
    it('dispatches drop-off confirmation when child is deboarded', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      mockQuery.mockResolvedValueOnce([mockTargetRow]);
      mockQuery.mockResolvedValueOnce([]); // not already notified
      mockSend.mockResolvedValueOnce({
        messageId: 'msg-dropped-1',
        status: 'sent',
        provider: 'mock',
        timestamp: new Date().toISOString(),
      });

      const success = await ParentNotificationService.notifyStudentDropped({
        schoolId,
        tripId,
        studentId,
        stopId,
        recordedAt: '2026-10-25T14:15:00.000Z',
      });

      expect(success).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);

      const sendArgs = mockSend.mock.calls[0][0];
      expect(sendArgs.eventType).toBe('STUDENT_DROPPED');
      expect(sendArgs.priority).toBe('NORMAL');
      expect(sendArgs.directText).toContain('Aarav Sharma has been safely dropped off');
    });
  });

  describe('7. Trip Completed (TRIP_COMPLETED)', () => {
    it('dispatches trip completion summary to parents on the route', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      mockQuery.mockResolvedValueOnce([mockTargetRow]);
      mockQuery.mockResolvedValueOnce([]); // not already notified
      mockSend.mockResolvedValueOnce({
        messageId: 'msg-completed-1',
        status: 'sent',
        provider: 'mock',
        timestamp: new Date().toISOString(),
      });

      const result = await ParentNotificationService.notifyTripCompleted({
        schoolId,
        tripId,
      });

      expect(result.eventType).toBe('TRIP_COMPLETED');
      expect(result.notificationsSent).toBe(1);

      const sendArgs = mockSend.mock.calls[0][0];
      expect(sendArgs.eventType).toBe('TRIP_COMPLETED');
      expect(sendArgs.priority).toBe('NORMAL');
      expect(sendArgs.directText).toContain('has safely completed its trip');
      expect(sendArgs.directText).toContain('Aarav Sharma has reached safely');
    });
  });

  describe('8. Non-Blocking Error Handling', () => {
    it('catches and suppresses database errors without throwing', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockRejectedValueOnce(new Error('DB Connection Timeout'));

      const result = await ParentNotificationService.notifyTripStarted({
        schoolId,
        tripId,
      });

      expect(result.notificationsSent).toBe(0);
      expect(result.parentsChecked).toBe(0);
    });

    it('catches and suppresses messaging provider dispatch failures', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      mockQuery.mockResolvedValueOnce([mockTargetRow]);
      mockQuery.mockResolvedValueOnce([]);
      mockSend.mockRejectedValueOnce(new Error('WhatsApp Meta Cloud Rate Limit'));

      const success = await ParentNotificationService.notifyStudentBoarded({
        schoolId,
        tripId,
        studentId,
        stopId,
      });

      // Does not throw an unhandled rejection, returns false cleanly
      expect(success).toBe(false);
    });
  });
});
