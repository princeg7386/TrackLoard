import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DelaySpamControlService } from '../src/services/delay-spam-control.service.js';
import { DelayNotificationService } from '../src/services/delay-notification.service.js';
import { DelayIntelligenceService } from '../src/services/delay-intelligence.service.js';
import { NotificationAntiSpamService } from '../src/services/notification-anti-spam.service.js';
import { MessagingService } from '../src/services/messaging/messaging.service.js';
import {
  DELAY_SPAM_CONTROL_CONFIG,
  DelaySpamControlEvaluationSchema,
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

describe('Phase 25.5: Delay Spam Control & Meaningful Escalation Engine', () => {
  const schoolId = '11111111-1111-1111-1111-111111111111';
  const tripId = '22222222-2222-2222-2222-222222222222';
  const busId = '33333333-3333-3333-3333-333333333333';
  const stopId = '44444444-4444-4444-4444-444444444444';

  const mockTripContext = {
    id: tripId,
    schoolId,
    routeId: 'route-1',
    routeName: 'Route 10 - West Delhi',
    busId,
    busNumber: 'DL-01-AB-5678',
    driverId: 'driver-1',
    driverName: 'Kishan Lal',
    driverPhone: '+919811122244',
  };

  const mockAffectedResult = {
    tripId,
    schoolId,
    overallDelayMinutes: 16,
    overallDelayStatus: 'MODERATE_DELAY' as const,
    minDelayThresholdMinutes: 10,
    alreadyServedPickupsCount: 1,
    affectedPickupsCount: 1,
    waitingParentsCount: 1,
    affectedPickups: [
      {
        stopId,
        stopName: 'Janakpuri District Center',
        sequenceOrder: 2,
        expectedArrival: '2026-10-25T07:15:00.000Z',
        predictedArrival: '2026-10-25T07:31:00.000Z',
        delayMinutes: 16,
        delayStatus: 'MODERATE_DELAY' as const,
        waitingStudentsCount: 1,
      },
    ],
    waitingParents: [
      {
        parentId: '55555555-5555-5555-5555-555555555551',
        parentName: 'Deepak Chopra',
        parentPhone: '+919876543210',
        studentId: '66666666-6666-6666-6666-666666666661',
        studentName: 'Rohan Chopra',
        stopId,
        stopName: 'Janakpuri District Center',
        sequenceOrder: 2,
        expectedArrival: '2026-10-25T07:15:00.000Z',
        predictedArrival: '2026-10-25T07:31:00.000Z',
        delayMinutes: 16,
        delayStatus: 'MODERATE_DELAY' as const,
        trackingToken: 'tok-abc',
        trackingUrl: 'http://localhost:3000/track?token=tok-abc',
      },
    ],
    evaluatedAt: '2026-10-25T07:16:00.000Z',
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('1. Meaningful Change Evaluation (evaluateSpamControl)', () => {
    it('allows initial delay alert when no prior delay notification was sent on this trip', async () => {
      const mockQuery = vi.mocked(database.query);
      // Query returns empty (no active delay)
      mockQuery.mockResolvedValueOnce([]);

      const evaluation = await DelaySpamControlService.evaluateSpamControl({
        tripId,
        schoolId,
        currentDelayMinutes: 12,
      });

      expect(evaluation.allowed).toBe(true);
      expect(evaluation.isFirstAlert).toBe(true);
      expect(evaluation.isEscalation).toBe(false);
      expect(evaluation.suppressedAsSpam).toBe(false);
      expect(evaluation.previousDelayMinutes).toBeNull();
      expect(evaluation.deltaMinutes).toBeNull();
      expect(DelaySpamControlEvaluationSchema.safeParse(evaluation).success).toBe(true);
    });

    it('suppresses alert when delay is identical to previously notified delay', async () => {
      const mockQuery = vi.mocked(database.query);
      // Previous delay was 12m
      mockQuery.mockResolvedValueOnce([
        {
          id: 'delay-1',
          delay_minutes: 12,
          notified_parents_count: 5,
          created_at: new Date().toISOString(),
        },
      ]);

      const evaluation = await DelaySpamControlService.evaluateSpamControl({
        tripId,
        schoolId,
        currentDelayMinutes: 12, // Identical delay
      });

      expect(evaluation.allowed).toBe(false);
      expect(evaluation.suppressedAsSpam).toBe(true);
      expect(evaluation.isEscalation).toBe(false);
      expect(evaluation.deltaMinutes).toBe(0);
      expect(evaluation.reason).toContain('Identical or reduced delay already notified');
    });

    it('suppresses alert when delay has decreased or improved', async () => {
      const mockQuery = vi.mocked(database.query);
      // Previous delay was 15m
      mockQuery.mockResolvedValueOnce([
        {
          id: 'delay-1',
          delay_minutes: 15,
          notified_parents_count: 5,
          created_at: new Date().toISOString(),
        },
      ]);

      const evaluation = await DelaySpamControlService.evaluateSpamControl({
        tripId,
        schoolId,
        currentDelayMinutes: 13, // Decreased delay (-2m)
      });

      expect(evaluation.allowed).toBe(false);
      expect(evaluation.suppressedAsSpam).toBe(true);
      expect(evaluation.deltaMinutes).toBe(-2);
      expect(evaluation.reason).toContain('Identical or reduced delay');
    });

    it('suppresses minor delay increases below meaningful threshold (e.g. +2m or +4m increase)', async () => {
      const mockQuery = vi.mocked(database.query);
      // Previous delay was 10m
      mockQuery.mockResolvedValueOnce([
        {
          id: 'delay-1',
          delay_minutes: 10,
          notified_parents_count: 5,
          created_at: new Date().toISOString(),
        },
      ]);

      const evaluation = await DelaySpamControlService.evaluateSpamControl({
        tripId,
        schoolId,
        currentDelayMinutes: 13, // Delta is +3m (< 5m threshold)
      });

      expect(evaluation.allowed).toBe(false);
      expect(evaluation.suppressedAsSpam).toBe(true);
      expect(evaluation.deltaMinutes).toBe(3);
      expect(evaluation.reason).toContain('below meaningful change threshold');
    });

    it('allows delay alert on meaningful escalation (increase >= 5 minutes)', async () => {
      const mockQuery = vi.mocked(database.query);
      // Previous delay was 10m
      mockQuery.mockResolvedValueOnce([
        {
          id: 'delay-1',
          delay_minutes: 10,
          notified_parents_count: 5,
          created_at: new Date().toISOString(),
        },
      ]);

      const evaluation = await DelaySpamControlService.evaluateSpamControl({
        tripId,
        schoolId,
        currentDelayMinutes: 16, // Delta is +6m (>= 5m threshold)
      });

      expect(evaluation.allowed).toBe(true);
      expect(evaluation.isEscalation).toBe(true);
      expect(evaluation.suppressedAsSpam).toBe(false);
      expect(evaluation.previousDelayMinutes).toBe(10);
      expect(evaluation.deltaMinutes).toBe(6);
      expect(evaluation.reason).toContain('Meaningful delay escalation');
    });

    it('allows escalation when crossing into CRITICAL (>= 20 minutes) even if delta < 5m', async () => {
      const mockQuery = vi.mocked(database.query);
      // Previous delay was 17m (HIGH)
      mockQuery.mockResolvedValueOnce([
        {
          id: 'delay-1',
          delay_minutes: 17,
          notified_parents_count: 5,
          created_at: new Date().toISOString(),
        },
      ]);

      const evaluation = await DelaySpamControlService.evaluateSpamControl({
        tripId,
        schoolId,
        currentDelayMinutes: 20, // Crosses to CRITICAL tier! Delta = +3m
      });

      expect(evaluation.allowed).toBe(true);
      expect(evaluation.isEscalation).toBe(true);
      expect(evaluation.suppressedAsSpam).toBe(false);
      expect(evaluation.reason).toContain('Critical delay escalation to 20m');
    });

    it('allows alert safely if database throws an unexpected error', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockRejectedValueOnce(new Error('DB read failure'));

      const evaluation = await DelaySpamControlService.evaluateSpamControl({
        tripId,
        schoolId,
        currentDelayMinutes: 15,
      });

      expect(evaluation.allowed).toBe(true);
      expect(evaluation.isFirstAlert).toBe(true);
    });
  });

  describe('2. Delay Notification Dispatch Integration', () => {
    it('suppresses dispatch when spam control flags minor change as spam', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([mockTripContext]);

      // identifyWaitingParents returns 12m delay
      vi.mocked(DelayIntelligenceService.identifyWaitingParents).mockResolvedValueOnce({
        ...mockAffectedResult,
        overallDelayMinutes: 12,
      } as any);

      // Previous delay was 10m (+2m increase -> suppressed as spam)
      mockQuery.mockResolvedValueOnce([
        {
          id: 'delay-1',
          delay_minutes: 10,
          notified_parents_count: 1,
          created_at: new Date().toISOString(),
        },
      ]);

      const result = await DelayNotificationService.dispatchDelayAlert({
        schoolId,
        tripId,
        minDelayMinutes: 10,
      });

      expect(result.dispatched).toBe(false);
      expect(result.spamControlled).toBe(true);
      expect(result.isEscalation).toBe(false);
      expect(result.notificationsSent).toBe(0);
      expect(result.message).toContain('below meaningful change threshold');
      expect(MessagingService.sendMessage).not.toHaveBeenCalled();
    });

    it('dispatches escalation alert with escalation prefix when meaningful increase occurs', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([mockTripContext]);

      // identifyWaitingParents returns 16m delay
      vi.mocked(DelayIntelligenceService.identifyWaitingParents).mockResolvedValueOnce(mockAffectedResult as any);

      // Previous delay was 10m (+6m increase -> meaningful escalation!)
      mockQuery.mockResolvedValueOnce([
        {
          id: 'delay-1',
          delay_minutes: 10,
          notified_parents_count: 1,
          created_at: new Date().toISOString(),
        },
      ]);

      // Throttle check allowed
      vi.mocked(NotificationAntiSpamService.checkThrottle).mockResolvedValueOnce({
        allowed: true,
        throttled: false,
        deduplicated: false,
      });

      // Staff contacts
      mockQuery.mockResolvedValueOnce([
        {
          id: 'staff-1',
          phone: '+919811199999',
          name: 'Aditi Rao',
          role: 'TRANSPORT_COORDINATOR',
        },
      ]);

      // Delays table insert
      mockQuery.mockResolvedValueOnce([{ id: '77777777-7777-7777-7777-777777777777' }]);

      const result = await DelayNotificationService.dispatchDelayAlert({
        schoolId,
        tripId,
        minDelayMinutes: 10,
      });

      expect(result.dispatched).toBe(true);
      expect(result.spamControlled).toBe(false);
      expect(result.isEscalation).toBe(true);
      expect(result.notificationsSent).toBe(2); // 1 parent + 1 staff
      expect(result.message).toContain('Delay escalation alert successfully dispatched');

      // Check message copy contains "Delay Update:" and "+6m further delay"
      expect(MessagingService.sendMessage).toHaveBeenCalledTimes(2);
      const parentMsg = vi.mocked(MessagingService.sendMessage).mock.calls[0][0].directText;
      expect(parentMsg).toContain('Delay Update:');
      expect(parentMsg).toContain('+6m further delay');
    });
  });

  describe('3. Operational Constants Validation', () => {
    it('validates DELAY_SPAM_CONTROL_CONFIG specifications', () => {
      expect(DELAY_SPAM_CONTROL_CONFIG.MEANINGFUL_CHANGE_THRESHOLD_MINUTES).toBe(5);
      expect(DELAY_SPAM_CONTROL_CONFIG.BURST_THROTTLE_SECONDS).toBe(30);
      expect(DELAY_SPAM_CONTROL_CONFIG.CRITICAL_DELAY_THRESHOLD_MINUTES).toBe(20);
    });
  });
});
