import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DelayNotificationService } from '../src/services/delay-notification.service.js';
import { DelayIntelligenceService } from '../src/services/delay-intelligence.service.js';
import { NotificationAntiSpamService } from '../src/services/notification-anti-spam.service.js';
import { MessagingService } from '../src/services/messaging/messaging.service.js';
import { RealtimeFeedService } from '../src/services/realtime-feed.service.js';
import {
  DelayAlertDispatchResultSchema,
  DelayRecoveryResultSchema,
  DelayAlertDispatchRequestSchema,
} from '@school-bus/shared';
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

// Mock NotificationAntiSpamService
vi.mock('../src/services/notification-anti-spam.service.js', () => ({
  NotificationAntiSpamService: {
    checkThrottle: vi.fn(),
  },
}));

// Mock DelayIntelligenceService
vi.mock('../src/services/delay-intelligence.service.js', () => ({
  DelayIntelligenceService: {
    identifyWaitingParents: vi.fn(),
    compareTripTimeline: vi.fn(),
  },
}));

describe('Phase 25.4: Delay Notifications & Recovery Lifecycle Engine', () => {
  const schoolId = '11111111-1111-1111-1111-111111111111';
  const tripId = '22222222-2222-2222-2222-222222222222';
  const busId = '33333333-3333-3333-3333-333333333333';
  const stopId = '44444444-4444-4444-4444-444444444444';
  const delayRecordId = '55555555-5555-5555-5555-555555555555';

  const mockTripContext = {
    id: tripId,
    schoolId,
    routeId: 'route-1',
    routeName: 'Route 5 - Central Delhi',
    busId,
    busNumber: 'DL-01-AB-1234',
    driverId: 'driver-1',
    driverName: 'Mohan Singh',
    driverPhone: '+919811122233',
  };

  const mockStaffRows = [
    {
      id: 'staff-1',
      phone: '+919811199999',
      name: 'Aditi Rao',
      role: 'TRANSPORT_COORDINATOR',
    },
  ];

  const mockAffectedResult = {
    tripId,
    schoolId,
    overallDelayMinutes: 14,
    overallDelayStatus: 'MODERATE_DELAY' as const,
    minDelayThresholdMinutes: 10,
    alreadyServedPickupsCount: 1,
    affectedPickupsCount: 1,
    waitingParentsCount: 2,
    affectedPickups: [
      {
        stopId,
        stopName: 'Connaught Place Outer Circle',
        sequenceOrder: 2,
        expectedArrival: '2026-10-25T07:15:00.000Z',
        predictedArrival: '2026-10-25T07:29:00.000Z',
        delayMinutes: 14,
        delayStatus: 'MODERATE_DELAY' as const,
        waitingStudentsCount: 2,
      },
    ],
    waitingParents: [
      {
        parentId: 'parent-1111-1111-1111-111111111111',
        parentName: 'Sanjay Kapoor',
        parentPhone: '+919876543210',
        studentId: 'student-1111-1111-1111-111111111111',
        studentName: 'Vihaan Kapoor',
        stopId,
        stopName: 'Connaught Place Outer Circle',
        sequenceOrder: 2,
        expectedArrival: '2026-10-25T07:15:00.000Z',
        predictedArrival: '2026-10-25T07:29:00.000Z',
        delayMinutes: 14,
        delayStatus: 'MODERATE_DELAY' as const,
        trackingToken: 'tok-123',
        trackingUrl: 'http://localhost:3000/track?token=tok-123',
      },
      {
        parentId: 'parent-2222-2222-2222-222222222222',
        parentName: 'Geeta Nair',
        parentPhone: '+919876543211',
        studentId: 'student-2222-2222-2222-222222222222',
        studentName: 'Maya Nair',
        stopId,
        stopName: 'Connaught Place Outer Circle',
        sequenceOrder: 2,
        expectedArrival: '2026-10-25T07:15:00.000Z',
        predictedArrival: '2026-10-25T07:29:00.000Z',
        delayMinutes: 14,
        delayStatus: 'MODERATE_DELAY' as const,
        trackingToken: null,
        trackingUrl: null,
      },
    ],
    evaluatedAt: '2026-10-25T07:16:00.000Z',
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('1. Delay Alert Dispatch (dispatchDelayAlert)', () => {
    it('dispatches delay alerts to waiting parents and staff, updates ETA, and inserts delay record', async () => {
      const mockQuery = vi.mocked(database.query);
      // Query 1: trip context
      mockQuery.mockResolvedValueOnce([mockTripContext]);
      // identifyWaitingParents mock
      vi.mocked(DelayIntelligenceService.identifyWaitingParents).mockResolvedValueOnce(mockAffectedResult as any);
      // Query 2: evaluateSpamControl (no prior delay -> allowed)
      mockQuery.mockResolvedValueOnce([]);
      // checkThrottle mock (allowed)
      vi.mocked(NotificationAntiSpamService.checkThrottle).mockResolvedValueOnce({
        allowed: true,
        throttled: false,
        deduplicated: false,
      });
      // Query 3: fetch staff contacts
      mockQuery.mockResolvedValueOnce(mockStaffRows);
      // Query 4: insert into delays table
      mockQuery.mockResolvedValueOnce([{ id: delayRecordId }]);

      const result = await DelayNotificationService.dispatchDelayAlert({
        schoolId,
        tripId,
        minDelayMinutes: 10,
        reason: 'Heavy traffic on Ring Road',
      });

      expect(result.dispatched).toBe(true);
      expect(result.delayMinutes).toBe(14);
      expect(result.affectedParentsCount).toBe(2);
      expect(result.notificationsSent).toBe(3); // 2 parents + 1 staff
      expect(result.delayRecordId).toBe(delayRecordId);

      // Verify messaging dispatches (2 parents + 1 staff)
      expect(MessagingService.sendMessage).toHaveBeenCalledTimes(3);
      const parentCall = vi.mocked(MessagingService.sendMessage).mock.calls[0][0];
      expect(parentCall.recipientPhone).toBe('+919876543210');
      expect(parentCall.directText).toContain('14 minutes late');
      expect(parentCall.directText).toContain('Heavy traffic on Ring Road');

      const staffCall = vi.mocked(MessagingService.sendMessage).mock.calls[2][0];
      expect(staffCall.recipientPhone).toBe('+919811199999');
      expect(staffCall.directText).toContain('Fleet Delay Alert');

      // Verify RealtimeFeedService published ETA_UPDATE and NOTIFICATION_ALERT
      expect(RealtimeFeedService.publish).toHaveBeenCalledTimes(2);
      const feedEvents = vi.mocked(RealtimeFeedService.publish).mock.calls.map((c) => c[0]);
      expect(feedEvents.some((e) => e.type === 'ETA_UPDATE')).toBe(true);
      expect(feedEvents.some((e) => e.type === 'NOTIFICATION_ALERT')).toBe(true);

      // Contract validation
      expect(DelayAlertDispatchResultSchema.safeParse(result).success).toBe(true);
    });

    it('suppresses alert when delay is below threshold', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([mockTripContext]);

      // Delay is only 6m, threshold is 10m
      vi.mocked(DelayIntelligenceService.identifyWaitingParents).mockResolvedValueOnce({
        ...mockAffectedResult,
        overallDelayMinutes: 6,
        waitingParentsCount: 0,
      } as any);

      const result = await DelayNotificationService.dispatchDelayAlert({
        schoolId,
        tripId,
        minDelayMinutes: 10,
      });

      expect(result.dispatched).toBe(false);
      expect(result.cooldownActive).toBe(false);
      expect(result.notificationsSent).toBe(0);
      expect(MessagingService.sendMessage).not.toHaveBeenCalled();
      expect(RealtimeFeedService.publish).not.toHaveBeenCalled();
    });

    it('suppresses alert when anti-spam cooldown is active', async () => {
      const mockQuery = vi.mocked(database.query);
      // Query 1: trip context
      mockQuery.mockResolvedValueOnce([mockTripContext]);

      vi.mocked(DelayIntelligenceService.identifyWaitingParents).mockResolvedValueOnce(mockAffectedResult as any);
      // Query 2: evaluateSpamControl (no prior delay -> allowed)
      mockQuery.mockResolvedValueOnce([]);

      // Cooldown active
      vi.mocked(NotificationAntiSpamService.checkThrottle).mockResolvedValueOnce({
        allowed: false,
        throttled: true,
        deduplicated: false,
        cooldownRemainingSeconds: 420,
        reason: "Cooldown active for 'TRIP_DELAYED': 7m remaining",
      });

      const result = await DelayNotificationService.dispatchDelayAlert({
        schoolId,
        tripId,
        minDelayMinutes: 10,
      });

      expect(result.dispatched).toBe(false);
      expect(result.cooldownActive).toBe(true);
      expect(result.message).toContain("Cooldown active for 'TRIP_DELAYED'");
      expect(MessagingService.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('2. Delay Recovery Detection & Update (checkAndDispatchRecoveryUpdate)', () => {
    it('detects on-time recovery (delay <= 5m), resolves delay record, and notifies parents and staff', async () => {
      const mockQuery = vi.mocked(database.query);
      // Query 1: trip context
      mockQuery.mockResolvedValueOnce([mockTripContext]);
      // Query 2: fetch active unresolved delay
      mockQuery.mockResolvedValueOnce([
        {
          id: delayRecordId,
          delay_minutes: 15,
          notified_parents_count: 2,
        },
      ]);

      // Current comparison: delay has recovered to 3 minutes (ON_TIME)
      vi.mocked(DelayIntelligenceService.compareTripTimeline).mockResolvedValueOnce({
        tripId,
        schoolId,
        overallDelayMinutes: 3,
        overallDelayStatus: 'ON_TIME',
        nextStopDelayMinutes: 3,
        stopsEvaluatedCount: 3,
        delayedStopsCount: 0,
        stopComparisons: [],
        evaluatedAt: new Date().toISOString(),
      });

      // Query 3: resolve delay record in DB
      mockQuery.mockResolvedValueOnce([{ id: delayRecordId }]);

      // Mock remaining waiting parents
      vi.mocked(DelayIntelligenceService.identifyWaitingParents).mockResolvedValueOnce(mockAffectedResult as any);

      // Query 4: staff contacts
      mockQuery.mockResolvedValueOnce(mockStaffRows);

      const recoveryResult = await DelayNotificationService.checkAndDispatchRecoveryUpdate({
        schoolId,
        tripId,
      });

      expect(recoveryResult.recovered).toBe(true);
      expect(recoveryResult.initialDelayMinutes).toBe(15);
      expect(recoveryResult.currentDelayMinutes).toBe(3);
      expect(recoveryResult.parentsNotified).toBe(2);

      // Verify delay was resolved in DB
      const resolveCall = mockQuery.mock.calls[2][0] as string;
      expect(resolveCall).toContain('UPDATE delays');
      expect(resolveCall).toContain('SET resolved_at = NOW()');

      // Verify messaging dispatches (2 parents + 1 staff)
      expect(MessagingService.sendMessage).toHaveBeenCalledTimes(3);
      const parentCall = vi.mocked(MessagingService.sendMessage).mock.calls[0][0];
      expect(parentCall.directText).toContain('Good news!');
      expect(parentCall.directText).toContain('now running on schedule');

      // Verify SSE broadcast for recovery
      expect(RealtimeFeedService.publish).toHaveBeenCalledTimes(2);
      const feedEvents = vi.mocked(RealtimeFeedService.publish).mock.calls.map((c) => c[0]);
      expect(feedEvents.some((e) => e.type === 'ETA_UPDATE')).toBe(true);
      expect(feedEvents.some((e) => e.type === 'NOTIFICATION_ALERT')).toBe(true);

      // Contract validation
      expect(DelayRecoveryResultSchema.safeParse(recoveryResult).success).toBe(true);
    });

    it('returns recovered: false when no active delay record exists for trip', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([mockTripContext]);
      // Query 2: no active delay
      mockQuery.mockResolvedValueOnce([]);

      const recoveryResult = await DelayNotificationService.checkAndDispatchRecoveryUpdate({
        schoolId,
        tripId,
      });

      expect(recoveryResult.recovered).toBe(false);
      expect(recoveryResult.message).toContain('No active unresolved delay found');
      expect(MessagingService.sendMessage).not.toHaveBeenCalled();
    });

    it('returns recovered: false when trip delay is still active and above recovery threshold', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([mockTripContext]);
      // Query 2: active delay was 18m
      mockQuery.mockResolvedValueOnce([
        {
          id: delayRecordId,
          delay_minutes: 18,
          notified_parents_count: 2,
        },
      ]);

      // Current comparison: delay is still 15m (has not recovered)
      vi.mocked(DelayIntelligenceService.compareTripTimeline).mockResolvedValueOnce({
        tripId,
        schoolId,
        overallDelayMinutes: 15,
        overallDelayStatus: 'MODERATE_DELAY',
        nextStopDelayMinutes: 15,
        stopsEvaluatedCount: 3,
        delayedStopsCount: 1,
        stopComparisons: [],
        evaluatedAt: new Date().toISOString(),
      });

      const recoveryResult = await DelayNotificationService.checkAndDispatchRecoveryUpdate({
        schoolId,
        tripId,
      });

      expect(recoveryResult.recovered).toBe(false);
      expect(recoveryResult.currentDelayMinutes).toBe(15);
      expect(recoveryResult.message).toContain('still active');
      expect(MessagingService.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('3. Schema Contracts', () => {
    it('validates DelayAlertDispatchRequestSchema', () => {
      const valid = DelayAlertDispatchRequestSchema.parse({
        minDelayMinutes: 15,
        reason: 'Waterlogging at Ashram underpass',
      });
      expect(valid.minDelayMinutes).toBe(15);
      expect(valid.reason).toBe('Waterlogging at Ashram underpass');
    });
  });
});
