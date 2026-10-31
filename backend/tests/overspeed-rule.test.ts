/**
 * Phase 29.1 -- Overspeed Rule Tests
 * Tests for: loadOverspeedRule (priority resolution), evaluateSpeed (state machine),
 *            getActiveEventsForSchool, clearTripState.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../src/config/database.js', () => ({ query: mockQuery }));

vi.mock('../src/config/env.js', () => ({
  env: {
    JWT_SECRET: 'test-secret',
    MESSAGING_PROVIDER: 'mock',
    DATABASE_URL: 'postgresql://localhost/test',
    PORT: 3001,
    NODE_ENV: 'test',
  },
}));

import { OverspeedRuleService } from '../src/services/overspeed-rule.service.js';
import { OVERSPEED_CONFIG } from '@school-bus/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';
const TRIP_ID   = '22222222-2222-2222-2222-222222222222';
const BUS_ID    = '33333333-3333-3333-3333-333333333333';
const DRIVER_ID = '44444444-4444-4444-4444-444444444444';
const ROUTE_ID  = '55555555-5555-5555-5555-555555555555';
const EVENT_ID  = '66666666-6666-6666-6666-666666666666';
const NOW_ISO   = new Date().toISOString();

const baseActiveEvent = {
  id: EVENT_ID,
  school_id: SCHOOL_ID,
  trip_id: TRIP_ID,
  bus_id: BUS_ID,
  driver_id: DRIVER_ID,
  route_id: ROUTE_ID,
  status: 'ACTIVE',
  started_at: new Date(Date.now() - 30_000).toISOString(), // 30s ago
  ended_at: null,
  duration_seconds: 30,
  speed_limit_kmh: 40,
  max_speed_kmh: '55.00',
  current_speed_kmh: '55.00',
  peak_latitude: 28.6139,
  peak_longitude: 77.2090,
  school_notified_at: null,
  driver_notified_at: null,
  created_at: new Date(Date.now() - 30_000).toISOString(),
};

const baseEvalParams = {
  tripId: TRIP_ID,
  schoolId: SCHOOL_ID,
  busId: BUS_ID,
  driverId: DRIVER_ID,
  routeId: ROUTE_ID,
  latitude: 28.6139,
  longitude: 77.2090,
  timestamp: NOW_ISO,
  pingIntervalSeconds: 5,
};

// ---------------------------------------------------------------------------

describe('Phase 29.1 -- Overspeed Rule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear in-process duration accumulator between tests
    OverspeedRuleService.clearTripState(TRIP_ID);
  });

  // ── loadOverspeedRule ────────────────────────────────────────────────────

  describe('loadOverspeedRule -- priority resolution', () => {
    it('uses route-level override when present', async () => {
      mockQuery
        .mockResolvedValueOnce([{ speed_limit_kmh: 60, overspeed_duration_threshold_seconds: 15 }]);

      const rule = await OverspeedRuleService.loadOverspeedRule(SCHOOL_ID, ROUTE_ID);

      expect(rule.speedLimitKmh).toBe(60);
      expect(rule.durationThresholdSeconds).toBe(15);
      expect(rule.source).toBe('ROUTE_OVERRIDE');
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('falls back to school default when route has no override', async () => {
      mockQuery
        .mockResolvedValueOnce([{ speed_limit_kmh: null, overspeed_duration_threshold_seconds: null }]) // route row — no override
        .mockResolvedValueOnce([{ speed_limit_kmh: 45, overspeed_duration_threshold_seconds: 20 }]);  // school row

      const rule = await OverspeedRuleService.loadOverspeedRule(SCHOOL_ID, ROUTE_ID);

      expect(rule.speedLimitKmh).toBe(45);
      expect(rule.durationThresholdSeconds).toBe(20);
      expect(rule.source).toBe('SCHOOL_DEFAULT');
    });

    it('falls back to config default when school has no speed_limit_kmh configured', async () => {
      mockQuery
        .mockResolvedValueOnce([{ speed_limit_kmh: null, overspeed_duration_threshold_seconds: null }]) // route — no override
        .mockResolvedValueOnce([{ speed_limit_kmh: null, overspeed_duration_threshold_seconds: null }]); // school — not set

      const rule = await OverspeedRuleService.loadOverspeedRule(SCHOOL_ID, ROUTE_ID);

      expect(rule.speedLimitKmh).toBe(OVERSPEED_CONFIG.DEFAULT_SPEED_LIMIT_KMH);
      expect(rule.durationThresholdSeconds).toBe(OVERSPEED_CONFIG.DEFAULT_DURATION_THRESHOLD_SECONDS);
      expect(rule.source).toBe('CONFIG_DEFAULT');
    });

    it('skips route query when routeId is null', async () => {
      mockQuery
        .mockResolvedValueOnce([{ speed_limit_kmh: 40, overspeed_duration_threshold_seconds: 10 }]); // school row

      const rule = await OverspeedRuleService.loadOverspeedRule(SCHOOL_ID, null);

      expect(rule.source).toBe('SCHOOL_DEFAULT');
      // Only one query (school), no route query
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain('FROM schools');
    });

    it('uses school duration when route has speed but no duration override', async () => {
      mockQuery
        .mockResolvedValueOnce([{ speed_limit_kmh: 60, overspeed_duration_threshold_seconds: null }]) // route — speed only
        .mockResolvedValueOnce([{ overspeed_duration_threshold_seconds: 25 }]); // school duration fallback

      const rule = await OverspeedRuleService.loadOverspeedRule(SCHOOL_ID, ROUTE_ID);

      expect(rule.speedLimitKmh).toBe(60);
      expect(rule.durationThresholdSeconds).toBe(25);
      expect(rule.source).toBe('ROUTE_OVERRIDE');
    });

    it('enforces tenant isolation -- school_id in route query', async () => {
      mockQuery
        .mockResolvedValueOnce([{ speed_limit_kmh: 50, overspeed_duration_threshold_seconds: 10 }]);

      await OverspeedRuleService.loadOverspeedRule(SCHOOL_ID, ROUTE_ID);

      const routeQueryParams = mockQuery.mock.calls[0][1];
      expect(routeQueryParams).toContain(SCHOOL_ID);
      expect(routeQueryParams).toContain(ROUTE_ID);
    });
  });

  // ── evaluateSpeed — state machine ────────────────────────────────────────

  describe('evaluateSpeed -- state machine', () => {
    it('returns SKIPPED for very low speed (GPS noise / bus stopped)', async () => {
      const result = await OverspeedRuleService.evaluateSpeed({
        ...baseEvalParams,
        speedKmh: 2, // below MIN_EVALUATION_SPEED_KMH
      });

      expect(result.action).toBe('SKIPPED');
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns SAFE when speed is within limit', async () => {
      // Rule query (route) + no active event query
      mockQuery
        .mockResolvedValueOnce([{ speed_limit_kmh: 40, overspeed_duration_threshold_seconds: 10 }])
        .mockResolvedValueOnce([]); // no active event

      const result = await OverspeedRuleService.evaluateSpeed({
        ...baseEvalParams,
        speedKmh: 35,
      });

      expect(result.action).toBe('SAFE');
      expect(result.isOverspeed).toBe(false);
      expect(result.speedLimitKmh).toBe(40);
    });

    it('returns DEBOUNCING when speed exceeds limit but duration not met', async () => {
      // Rule: limit 40, duration 10s; ping interval 5s → after 1 ping = 5s < 10s
      mockQuery
        .mockResolvedValueOnce([{ speed_limit_kmh: 40, overspeed_duration_threshold_seconds: 10 }])
        .mockResolvedValueOnce([]); // no active event

      const result = await OverspeedRuleService.evaluateSpeed({
        ...baseEvalParams,
        speedKmh: 55, // over limit
        pingIntervalSeconds: 5,
      });

      expect(result.action).toBe('DEBOUNCING');
      expect(result.isOverspeed).toBe(true);
      expect(result.accumulatedSeconds).toBe(5);
      expect(result.durationThresholdSeconds).toBe(10);
    });

    it('returns TRIGGERED and opens event when duration threshold met', async () => {
      // Pre-accumulate 5s already
      OverspeedRuleService['_durationAccumulator'].set(TRIP_ID, 5);

      // Next ping: 5 more seconds → total 10s = threshold
      mockQuery
        .mockResolvedValueOnce([{ speed_limit_kmh: 40, overspeed_duration_threshold_seconds: 10 }])
        .mockResolvedValueOnce([])                   // no active event yet
        .mockResolvedValueOnce([{ id: EVENT_ID }]);  // INSERT RETURNING id

      const result = await OverspeedRuleService.evaluateSpeed({
        ...baseEvalParams,
        speedKmh: 60,
        pingIntervalSeconds: 5,
      });

      expect(result.action).toBe('TRIGGERED');
      expect(result.isOverspeed).toBe(true);
      expect(result.activeEventId).toBe(EVENT_ID);
      expect(result.accumulatedSeconds).toBe(10);

      // Verify INSERT was called
      const insertCall = mockQuery.mock.calls.find((c) => (c[0] as string).includes('INSERT INTO overspeed_events'));
      expect(insertCall).toBeDefined();
      expect(insertCall![1]).toContain(SCHOOL_ID);
      expect(insertCall![1]).toContain(TRIP_ID);
      expect(insertCall![1]).toContain(40); // speed_limit_kmh
    });

    it('returns TRIGGERED and updates existing event when already active', async () => {
      mockQuery
        .mockResolvedValueOnce([{ speed_limit_kmh: 40, overspeed_duration_threshold_seconds: 10 }])
        .mockResolvedValueOnce([baseActiveEvent]) // active event exists
        .mockResolvedValueOnce([]);               // UPDATE

      const result = await OverspeedRuleService.evaluateSpeed({
        ...baseEvalParams,
        speedKmh: 58,
        pingIntervalSeconds: 5,
      });

      expect(result.action).toBe('TRIGGERED');
      expect(result.activeEventId).toBe(EVENT_ID);

      // Verify UPDATE was called (not INSERT)
      const updateCall = mockQuery.mock.calls.find((c) => (c[0] as string).includes('UPDATE overspeed_events'));
      expect(updateCall).toBeDefined();
      const insertCall = mockQuery.mock.calls.find((c) => (c[0] as string).includes('INSERT INTO overspeed_events'));
      expect(insertCall).toBeUndefined();
    });

    it('returns RESOLVED and closes active event when speed drops back under limit', async () => {
      mockQuery
        .mockResolvedValueOnce([{ speed_limit_kmh: 40, overspeed_duration_threshold_seconds: 10 }])
        .mockResolvedValueOnce([baseActiveEvent]) // active event to resolve
        .mockResolvedValueOnce([]);               // UPDATE to RESOLVED

      const result = await OverspeedRuleService.evaluateSpeed({
        ...baseEvalParams,
        speedKmh: 38, // back under limit
      });

      expect(result.action).toBe('RESOLVED');
      expect(result.isOverspeed).toBe(false);
      expect(result.activeEventId).toBe(EVENT_ID);

      const updateCall = mockQuery.mock.calls.find((c) => (c[0] as string).includes("status = 'RESOLVED'"));
      expect(updateCall).toBeDefined();
    });

    it('resets duration accumulator when speed drops to safe', async () => {
      // Pre-set some accumulation
      OverspeedRuleService['_durationAccumulator'].set(TRIP_ID, 8);

      mockQuery
        .mockResolvedValueOnce([{ speed_limit_kmh: 40, overspeed_duration_threshold_seconds: 10 }])
        .mockResolvedValueOnce([]); // no active event

      await OverspeedRuleService.evaluateSpeed({
        ...baseEvalParams,
        speedKmh: 35,
      });

      expect(OverspeedRuleService['_durationAccumulator'].has(TRIP_ID)).toBe(false);
    });
  });

  // ── getActiveEventsForSchool ─────────────────────────────────────────────

  describe('getActiveEventsForSchool', () => {
    it('returns mapped active events for the school', async () => {
      mockQuery.mockResolvedValueOnce([baseActiveEvent]);

      const events = await OverspeedRuleService.getActiveEventsForSchool(SCHOOL_ID);

      expect(events).toHaveLength(1);
      expect(events[0]!.id).toBe(EVENT_ID);
      expect(events[0]!.status).toBe('ACTIVE');
      expect(events[0]!.speedLimitKmh).toBe(40);
      expect(events[0]!.maxSpeedKmh).toBe(55);
    });

    it('returns empty array when no active events', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const events = await OverspeedRuleService.getActiveEventsForSchool(SCHOOL_ID);

      expect(events).toHaveLength(0);
    });

    it('enforces tenant isolation -- school_id in query', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await OverspeedRuleService.getActiveEventsForSchool(SCHOOL_ID);

      expect(mockQuery.mock.calls[0][1]).toContain(SCHOOL_ID);
    });
  });

  // ── clearTripState ───────────────────────────────────────────────────────

  describe('clearTripState', () => {
    it('removes the duration accumulator entry for the trip', () => {
      OverspeedRuleService['_durationAccumulator'].set(TRIP_ID, 30);
      expect(OverspeedRuleService['_durationAccumulator'].has(TRIP_ID)).toBe(true);

      OverspeedRuleService.clearTripState(TRIP_ID);

      expect(OverspeedRuleService['_durationAccumulator'].has(TRIP_ID)).toBe(false);
    });
  });
});
