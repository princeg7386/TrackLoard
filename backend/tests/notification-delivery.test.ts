import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationDeliveryService } from '../src/services/notification-delivery.service.js';
import { MessagingService } from '../src/services/messaging/messaging.service.js';
import { RealtimeFeedService } from '../src/services/realtime-feed.service.js';
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

// Mock RealtimeFeedService
vi.mock('../src/services/realtime-feed.service.js', () => ({
  RealtimeFeedService: {
    publish: vi.fn(),
  },
}));

describe('Phase 24.4: Notification Delivery & Resilience Engine', () => {
  const schoolId = '11111111-1111-1111-1111-111111111111';
  const notificationId = '22222222-2222-2222-2222-222222222222';
  const tripId = '33333333-3333-3333-3333-333333333333';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Real-Time Dashboard Alert Push', () => {
    it('publishes NOTIFICATION_ALERT event via RealtimeFeedService for operational visibility', () => {
      const mockPublish = vi.mocked(RealtimeFeedService.publish);

      NotificationDeliveryService.publishDashboardAlert({
        notificationId,
        schoolId,
        tripId,
        busId: 'bus-1',
        eventType: 'ROUTE_DEVIATION',
        priority: 'HIGH',
        title: 'Route Deviation Alert',
        message: 'Bus #12 is 600m off route',
        recipientRole: 'TRANSPORT_COORDINATOR',
      });

      expect(mockPublish).toHaveBeenCalledTimes(1);
      const event = mockPublish.mock.calls[0][0];
      expect(event.type).toBe('NOTIFICATION_ALERT');
      expect(event.schoolId).toBe(schoolId);
      expect(event.tripId).toBe(tripId);
      expect(event.notificationAlert?.eventType).toBe('ROUTE_DEVIATION');
      expect(event.notificationAlert?.priority).toBe('HIGH');
      expect(event.notificationAlert?.title).toBe('Route Deviation Alert');
    });
  });

  describe('2. Inbound Delivery Status Webhook', () => {
    it('updates notification status to DELIVERED when matching providerMessageId is received', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([{ id: notificationId, school_id: schoolId, status: 'DELIVERED' }]);

      const updated = await NotificationDeliveryService.handleDeliveryWebhook(
        'meta_wamid_99999',
        'DELIVERED',
        { timestamp: '2026-10-25T12:00:00.000Z' }
      );

      expect(updated).toBeDefined();
      expect(updated?.status).toBe('DELIVERED');
      expect(mockQuery).toHaveBeenCalledTimes(1);

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('UPDATE notifications');
      expect(sql).toContain('status = $1');
      expect(sql).toContain('delivered_at');
    });

    it('records failure reason when delivery status is FAILED', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([{ id: notificationId, school_id: schoolId, status: 'FAILED' }]);

      const updated = await NotificationDeliveryService.handleDeliveryWebhook(
        'meta_wamid_error',
        'FAILED',
        { failureReason: 'Phone number does not exist on WhatsApp' }
      );

      expect(updated?.status).toBe('FAILED');
      const params = mockQuery.mock.calls[0][1];
      expect(params).toContain('Phone number does not exist on WhatsApp');
    });

    it('returns null if providerMessageId does not match any notification', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([]);

      const updated = await NotificationDeliveryService.handleDeliveryWebhook(
        'unknown_msg_id',
        'DELIVERED'
      );

      expect(updated).toBeNull();
    });
  });

  describe('3. Retry / Failure State Engine', () => {
    const mockFailedNotification = {
      id: notificationId,
      school_id: schoolId,
      trip_id: tripId,
      recipient_phone: '+919876543210',
      recipient_role: 'PARENT',
      channel: 'WHATSAPP',
      template_name: 'APPROACH_10M_ALERT',
      message_body: 'Bus is approx 10 minutes away',
      status: 'FAILED',
      event_type: 'BUS_APPROACHING_10M' as const,
      priority: 'HIGH' as const,
      retry_count: 1,
    };

    it('successfully retries a failed notification and updates status to SENT', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      // 1. SELECT notification
      mockQuery.mockResolvedValueOnce([mockFailedNotification]);
      // 2. Messaging send succeeds
      mockSend.mockResolvedValueOnce({
        messageId: 'new_msg_id_retry',
        status: 'sent',
        provider: 'mock',
        timestamp: new Date().toISOString(),
      });
      // 3. UPDATE status to SENT
      mockQuery.mockResolvedValueOnce([{ id: notificationId }]);

      const result = await NotificationDeliveryService.retryNotification(schoolId, notificationId);

      expect(result.success).toBe(true);
      expect(result.status).toBe('SENT');
      expect(result.retryCount).toBe(2);
      expect(mockSend).toHaveBeenCalledTimes(1);

      const updateSql = mockQuery.mock.calls[1][0];
      expect(updateSql).toContain("status = 'SENT'");
      expect(updateSql).toContain('next_retry_at = NULL');
    });

    it('rejects retrying a notification that is not in FAILED state', async () => {
      const mockQuery = vi.mocked(database.query);

      mockQuery.mockResolvedValueOnce([
        { ...mockFailedNotification, status: 'DELIVERED' },
      ]);

      await expect(
        NotificationDeliveryService.retryNotification(schoolId, notificationId)
      ).rejects.toThrow(/Cannot retry notification with status 'DELIVERED'/);
    });

    it('tracks retry count and enforces dead-letter threshold after MAX_RETRIES', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      // Already retried twice, this 3rd attempt will reach MAX_RETRY_ATTEMPTS (3)
      mockQuery.mockResolvedValueOnce([
        { ...mockFailedNotification, retry_count: 2 },
      ]);
      // Send fails again
      mockSend.mockRejectedValueOnce(new Error('WhatsApp Cloud API HTTP 500'));
      // UPDATE failure & next_retry_at
      mockQuery.mockResolvedValueOnce([{ id: notificationId }]);

      const result = await NotificationDeliveryService.retryNotification(schoolId, notificationId);

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
      expect(result.retryCount).toBe(3);
      expect(result.message).toContain('exhausted (dead-letter)');

      const updateParams = mockQuery.mock.calls[1][1];
      expect(updateParams).toContain(true); // isExhausted flag
    });

    it('batch retries pending failed notifications', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockSend = vi.mocked(MessagingService.sendMessage);

      // 1. SELECT candidate failed notifications
      mockQuery.mockResolvedValueOnce([
        { id: 'notif-1', school_id: schoolId },
        { id: 'notif-2', school_id: schoolId },
      ]);

      // notif-1: query -> send -> update
      mockQuery.mockResolvedValueOnce([{ ...mockFailedNotification, id: 'notif-1', retry_count: 0 }]);
      mockSend.mockResolvedValueOnce({ messageId: 'm1', status: 'sent', provider: 'mock', timestamp: '' });
      mockQuery.mockResolvedValueOnce([{ id: 'notif-1' }]);

      // notif-2: query -> send fails -> update
      mockQuery.mockResolvedValueOnce([{ ...mockFailedNotification, id: 'notif-2', retry_count: 0 }]);
      mockSend.mockRejectedValueOnce(new Error('Network error'));
      mockQuery.mockResolvedValueOnce([{ id: 'notif-2' }]);

      const summary = await NotificationDeliveryService.retryPendingFailedNotifications(schoolId, 10);

      expect(summary.totalRetried).toBe(2);
      expect(summary.succeeded).toBe(1);
      expect(summary.failed).toBe(1);
    });
  });

  describe('4. Dashboard Alerts & Delivery Metrics', () => {
    it('returns filtered and paginated operational alerts for school dashboard', async () => {
      const mockQuery = vi.mocked(database.query);

      // 1. COUNT query
      mockQuery.mockResolvedValueOnce([{ count: '1' }]);
      // 2. SELECT rows
      mockQuery.mockResolvedValueOnce([
        {
          id: notificationId,
          schoolId,
          tripId,
          recipientPhone: '+919876543210',
          recipientRole: 'PARENT',
          channel: 'WHATSAPP',
          templateName: 'TRIP_STARTED_ALERT',
          messageBody: 'Trip started',
          status: 'SENT',
          failureReason: null,
          eventType: 'TRIP_STARTED',
          priority: 'NORMAL',
          deliveredAt: null,
          readAt: null,
          retryCount: 0,
          createdAt: '2026-10-25T08:00:00.000Z',
        },
      ]);

      const result = await NotificationDeliveryService.getSchoolAlerts(schoolId, {
        priority: 'NORMAL',
        page: 1,
        limit: 25,
      });

      expect(result.alerts.length).toBe(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.totalPages).toBe(1);
      expect(result.alerts[0].eventType).toBe('TRIP_STARTED');
    });

    it('aggregates delivery metrics and priority breakdown for school', async () => {
      const mockQuery = vi.mocked(database.query);

      mockQuery.mockResolvedValueOnce([
        {
          total_sent: '100',
          delivered_count: '80',
          read_count: '15',
          failed_count: '5',
          pending_count: '0',
          critical_count: '2',
          high_count: '28',
          normal_count: '60',
          low_count: '10',
        },
      ]);

      const stats = await NotificationDeliveryService.getSchoolNotificationStats(schoolId);

      expect(stats.schoolId).toBe(schoolId);
      expect(stats.totalSent).toBe(100);
      expect(stats.deliveredCount).toBe(80);
      expect(stats.readCount).toBe(15);
      expect(stats.failedCount).toBe(5);
      expect(stats.deliveryRatePercent).toBe(95); // (80 + 15) / 100 = 95%
      expect(stats.priorityBreakdown.critical).toBe(2);
      expect(stats.priorityBreakdown.high).toBe(28);
    });
  });
});
