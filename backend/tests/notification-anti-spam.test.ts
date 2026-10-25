import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NotificationAntiSpamService,
  AffectedParentTarget,
} from '../src/services/notification-anti-spam.service.js';
import {
  NOTIFICATION_ANTI_SPAM_CONFIG,
  AntiSpamCheckResultSchema,
  NotificationAntiSpamEvaluateRequestSchema,
} from '@school-bus/shared';
import * as database from '../src/config/database.js';

// Mock database query
vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  pool: { end: vi.fn() },
}));

describe('Phase 24.5: Notification Anti-Spam & Smart Targeting Service', () => {
  const schoolId = '11111111-1111-1111-1111-111111111111';
  const tripId = '22222222-2222-2222-2222-222222222222';
  const routeId = '33333333-3333-3333-3333-333333333333';
  const stopId = '44444444-4444-4444-4444-444444444444';
  const studentId = '55555555-5555-5555-5555-555555555555';
  const parentPhone = '+919876543210';
  const recipientPhone = '+919876543210';

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('1. Event Deduplication (checkDuplicate)', () => {
    it('allows event when no duplicate notification exists in database', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([]);

      const result = await NotificationAntiSpamService.checkDuplicate({
        tripId,
        eventType: 'BUS_APPROACHING_10M',
        studentId,
      });

      expect(result.allowed).toBe(true);
      expect(result.deduplicated).toBe(false);
      expect(result.throttled).toBe(false);
      expect(AntiSpamCheckResultSchema.safeParse(result).success).toBe(true);
    });

    it('deduplicates when an identical event was already dispatched for the student', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([
        { id: 'notif-1', created_at: new Date().toISOString() },
      ]);

      const result = await NotificationAntiSpamService.checkDuplicate({
        tripId,
        eventType: 'BUS_APPROACHING_10M',
        studentId,
      });

      expect(result.allowed).toBe(false);
      expect(result.deduplicated).toBe(true);
      expect(result.reason).toContain('Duplicate event');
    });

    it('deduplicates when an identical event was already dispatched for the stop', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([
        { id: 'notif-2', created_at: new Date().toISOString() },
      ]);

      const result = await NotificationAntiSpamService.checkDuplicate({
        tripId,
        eventType: 'BUS_ARRIVED_STOP',
        stopId,
      });

      expect(result.allowed).toBe(false);
      expect(result.deduplicated).toBe(true);
      expect(result.reason).toContain('BUS_ARRIVED_STOP');
    });

    it('safely handles query error and allows event non-blockingly', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockRejectedValueOnce(new Error('DB Connection Timeout'));

      const result = await NotificationAntiSpamService.checkDuplicate({
        tripId,
        eventType: 'TRIP_STARTED',
      });

      expect(result.allowed).toBe(true);
      expect(result.deduplicated).toBe(false);
    });
  });

  describe('2. Alert Throttling & Priority Bypass (checkThrottle)', () => {
    it('CRITICAL priority (EMERGENCY_SOS) completely bypasses burst and cooldown throttling', async () => {
      const mockQuery = vi.mocked(database.query);

      const result = await NotificationAntiSpamService.checkThrottle({
        recipientPhone,
        eventType: 'EMERGENCY_SOS',
        priority: 'CRITICAL',
        tripId,
      });

      expect(result.allowed).toBe(true);
      expect(result.throttled).toBe(false);
      // DB shouldn't even need to be queried for CRITICAL bypass
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('burst throttles when last message to phone was sent within 30 seconds', async () => {
      const mockQuery = vi.mocked(database.query);
      const recentTimestamp = new Date(Date.now() - 10 * 1000).toISOString(); // 10s ago

      mockQuery.mockResolvedValueOnce([{ created_at: recentTimestamp }]);

      const result = await NotificationAntiSpamService.checkThrottle({
        recipientPhone,
        eventType: 'BUS_APPROACHING_3M',
        priority: 'HIGH',
      });

      expect(result.allowed).toBe(false);
      expect(result.throttled).toBe(true);
      expect(result.cooldownRemainingSeconds).toBeGreaterThan(0);
      expect(result.cooldownRemainingSeconds).toBeLessThanOrEqual(NOTIFICATION_ANTI_SPAM_CONFIG.BURST_THROTTLE_SECONDS);
      expect(result.reason).toContain('Burst throttle active');
    });

    it('allows message when last message to phone was sent > 30 seconds ago', async () => {
      const mockQuery = vi.mocked(database.query);
      const oldTimestamp = new Date(Date.now() - 45 * 1000).toISOString(); // 45s ago

      mockQuery.mockResolvedValueOnce([{ created_at: oldTimestamp }]);

      const result = await NotificationAntiSpamService.checkThrottle({
        recipientPhone,
        eventType: 'STUDENT_BOARDED',
        priority: 'NORMAL',
      });

      expect(result.allowed).toBe(true);
      expect(result.throttled).toBe(false);
    });

    it('enforces category cooldown on TRIP_DELAYED (15 min cooldown)', async () => {
      const mockQuery = vi.mocked(database.query);
      // No recent message to phone
      mockQuery.mockResolvedValueOnce([]);
      // Recent TRIP_DELAYED alert sent 5 minutes ago
      const recentDelay = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      mockQuery.mockResolvedValueOnce([{ created_at: recentDelay }]);

      const result = await NotificationAntiSpamService.checkThrottle({
        recipientPhone,
        eventType: 'TRIP_DELAYED',
        priority: 'HIGH',
        tripId,
      });

      expect(result.allowed).toBe(false);
      expect(result.throttled).toBe(true);
      expect(result.reason).toContain("Cooldown active for 'TRIP_DELAYED'");
    });

    it('allows TRIP_DELAYED alert once category cooldown has expired (> 15 mins)', async () => {
      const mockQuery = vi.mocked(database.query);
      // No recent burst
      mockQuery.mockResolvedValueOnce([]);
      // Alert sent 20 minutes ago
      const oldDelay = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      mockQuery.mockResolvedValueOnce([{ created_at: oldDelay }]);

      const result = await NotificationAntiSpamService.checkThrottle({
        recipientPhone,
        eventType: 'TRIP_DELAYED',
        priority: 'HIGH',
        tripId,
      });

      expect(result.allowed).toBe(true);
      expect(result.throttled).toBe(false);
    });

    it('enforces category cooldown on GPS_UNAVAILABLE (10 min cooldown)', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([]);
      // GPS alert sent 3 minutes ago
      mockQuery.mockResolvedValueOnce([{ created_at: new Date(Date.now() - 3 * 60 * 1000).toISOString() }]);

      const result = await NotificationAntiSpamService.checkThrottle({
        recipientPhone,
        eventType: 'GPS_UNAVAILABLE',
        priority: 'HIGH',
        tripId,
      });

      expect(result.allowed).toBe(false);
      expect(result.throttled).toBe(true);
      expect(result.reason).toContain("Cooldown active for 'GPS_UNAVAILABLE'");
    });

    it('enforces category cooldown on ROUTE_DEVIATION (10 min cooldown)', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([]);
      // Deviation alert sent 4 minutes ago
      mockQuery.mockResolvedValueOnce([{ created_at: new Date(Date.now() - 4 * 60 * 1000).toISOString() }]);

      const result = await NotificationAntiSpamService.checkThrottle({
        recipientPhone,
        eventType: 'ROUTE_DEVIATION',
        priority: 'HIGH',
        tripId,
      });

      expect(result.allowed).toBe(false);
      expect(result.throttled).toBe(true);
      expect(result.reason).toContain("Cooldown active for 'ROUTE_DEVIATION'");
    });

    it('enforces category cooldown on UNUSUAL_STOP (15 min cooldown)', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([]);
      // Unusual stop alert sent 8 minutes ago
      mockQuery.mockResolvedValueOnce([{ created_at: new Date(Date.now() - 8 * 60 * 1000).toISOString() }]);

      const result = await NotificationAntiSpamService.checkThrottle({
        recipientPhone,
        eventType: 'UNUSUAL_STOP',
        priority: 'HIGH',
        tripId,
      });

      expect(result.allowed).toBe(false);
      expect(result.throttled).toBe(true);
      expect(result.reason).toContain("Cooldown active for 'UNUSUAL_STOP'");
    });

    it('safely allows message if database errors during throttle check', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockRejectedValueOnce(new Error('Connection failed'));

      const result = await NotificationAntiSpamService.checkThrottle({
        recipientPhone,
        eventType: 'BUS_ARRIVED_STOP',
        priority: 'HIGH',
      });

      expect(result.allowed).toBe(true);
      expect(result.throttled).toBe(false);
    });
  });

  describe('3. Affected Parent Targeting (filterAffectedParents)', () => {
    it('returns only active route parents who have notifications_enabled = true', async () => {
      const mockQuery = vi.mocked(database.query);
      const mockCandidates = [
        {
          parentId: 'p-1',
          parentPhone: '+919876543210',
          parentName: 'Sunita Sharma',
          studentId: 's-1',
          studentName: 'Aarav Sharma',
          stopId: 'stop-1',
          stopName: 'Sector 14 Circle',
          sequenceOrder: 1,
          trackingToken: 'tok-1',
          notificationsEnabled: true,
        },
        {
          parentId: 'p-2',
          parentPhone: '+919876543211',
          parentName: 'Rajesh Verma',
          studentId: 's-2',
          studentName: 'Ananya Verma',
          stopId: 'stop-2',
          stopName: 'Sector 22 Market',
          sequenceOrder: 2,
          trackingToken: null,
          notificationsEnabled: true,
        },
      ];

      mockQuery.mockResolvedValueOnce(mockCandidates);

      const targets = await NotificationAntiSpamService.filterAffectedParents({
        schoolId,
        tripId,
        routeId,
        eventType: 'TRIP_STARTED',
      });

      expect(targets.length).toBe(2);
      expect(targets[0].parentPhone).toBe('+919876543210');
      expect(targets[1].studentName).toBe('Ananya Verma');
      expect(mockQuery).toHaveBeenCalledTimes(1);

      // Verify absence exclusion and drop exclusion clauses exist in SQL query
      const sqlQuery = mockQuery.mock.calls[0][0] as string;
      expect(sqlQuery).toContain('absence_records');
      expect(sqlQuery).toContain('drop_events');
      expect(sqlQuery).toContain("notifications_enabled = TRUE");
    });

    it('resolves sequence order threshold when isDownstreamOnly is requested', async () => {
      const mockQuery = vi.mocked(database.query);
      // First query fetches stop sequence_order
      mockQuery.mockResolvedValueOnce([{ sequence_order: 3 }]);
      // Second query fetches downstream parents
      mockQuery.mockResolvedValueOnce([
        {
          parentId: 'p-3',
          parentPhone: '+919876543213',
          parentName: 'Vikram Singh',
          studentId: 's-3',
          studentName: 'Rohan Singh',
          stopId: 'stop-3',
          stopName: 'Sector 45 Gate',
          sequenceOrder: 3,
          trackingToken: 'tok-3',
          notificationsEnabled: true,
        },
      ]);

      const targets = await NotificationAntiSpamService.filterAffectedParents({
        schoolId,
        tripId,
        routeId,
        eventType: 'TRIP_DELAYED',
        stopId,
        isDownstreamOnly: true,
      });

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(targets.length).toBe(1);
      expect(targets[0].sequenceOrder).toBe(3);

      const filterSql = mockQuery.mock.calls[1][0] as string;
      expect(filterSql).toContain('pl.sequence_order >=');
    });

    it('returns empty array safely if query throws an error', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockRejectedValueOnce(new Error('Database offline'));

      const targets = await NotificationAntiSpamService.filterAffectedParents({
        schoolId,
        tripId,
        routeId,
        eventType: 'BUS_APPROACHING_10M',
      });

      expect(targets).toEqual([]);
    });
  });

  describe('4. Composite Anti-Spam Evaluation (evaluateAntiSpam)', () => {
    it('returns allowed: true with all checks passed', async () => {
      const mockQuery = vi.mocked(database.query);
      // checkDuplicate query: no duplicate
      mockQuery.mockResolvedValueOnce([]);
      // checkThrottle query 1: no burst
      mockQuery.mockResolvedValueOnce([]);

      const evalResult = await NotificationAntiSpamService.evaluateAntiSpam({
        schoolId,
        tripId,
        eventType: 'BUS_APPROACHING_10M',
        priority: 'HIGH',
        recipientPhone,
        stopId,
      });

      expect(evalResult.allowed).toBe(true);
      expect(evalResult.duplicateCheck.allowed).toBe(true);
      expect(evalResult.throttleCheck?.allowed).toBe(true);
    });

    it('rejects early when duplicate check fails', async () => {
      const mockQuery = vi.mocked(database.query);
      // checkDuplicate query: found existing
      mockQuery.mockResolvedValueOnce([{ id: 'notif-dup', created_at: new Date().toISOString() }]);

      const evalResult = await NotificationAntiSpamService.evaluateAntiSpam({
        schoolId,
        tripId,
        eventType: 'BUS_ARRIVED_STOP',
        stopId,
      });

      expect(evalResult.allowed).toBe(false);
      expect(evalResult.duplicateCheck.deduplicated).toBe(true);
      expect(evalResult.rejectionReason).toContain('Duplicate event');
    });

    it('rejects when recipient burst throttle is active', async () => {
      const mockQuery = vi.mocked(database.query);
      // checkDuplicate query: no duplicate
      mockQuery.mockResolvedValueOnce([]);
      // checkThrottle query 1: recent message 12 seconds ago
      mockQuery.mockResolvedValueOnce([{ created_at: new Date(Date.now() - 12 * 1000).toISOString() }]);

      const evalResult = await NotificationAntiSpamService.evaluateAntiSpam({
        schoolId,
        tripId,
        eventType: 'BUS_APPROACHING_3M',
        priority: 'HIGH',
        recipientPhone,
      });

      expect(evalResult.allowed).toBe(false);
      expect(evalResult.throttleCheck?.throttled).toBe(true);
      expect(evalResult.rejectionReason).toContain('Burst throttle active');
    });
  });

  describe('5. Zod Schemas & Configuration Validation', () => {
    it('validates AntiSpamCheckResultSchema structure', () => {
      const valid = AntiSpamCheckResultSchema.parse({
        allowed: false,
        deduplicated: true,
        throttled: false,
        reason: 'Duplicate event suppressed',
      });
      expect(valid.allowed).toBe(false);
      expect(valid.deduplicated).toBe(true);
    });

    it('validates NotificationAntiSpamEvaluateRequestSchema', () => {
      const validReq = NotificationAntiSpamEvaluateRequestSchema.parse({
        tripId,
        eventType: 'TRIP_DELAYED',
        recipientPhone: '+919876543210',
        priority: 'HIGH',
        stopId,
        isDownstreamOnly: true,
      });
      expect(validReq.eventType).toBe('TRIP_DELAYED');
      expect(validReq.isDownstreamOnly).toBe(true);
    });

    it('verifies anti-spam cooldown constants meet operational guidelines', () => {
      expect(NOTIFICATION_ANTI_SPAM_CONFIG.BURST_THROTTLE_SECONDS).toBe(30);
      expect(NOTIFICATION_ANTI_SPAM_CONFIG.DELAY_ALERT_COOLDOWN_MINUTES).toBe(15);
      expect(NOTIFICATION_ANTI_SPAM_CONFIG.GPS_ALERT_COOLDOWN_MINUTES).toBe(10);
      expect(NOTIFICATION_ANTI_SPAM_CONFIG.DEVIATION_ALERT_COOLDOWN_MINUTES).toBe(10);
      expect(NOTIFICATION_ANTI_SPAM_CONFIG.UNUSUAL_STOP_COOLDOWN_MINUTES).toBe(15);
    });
  });
});
