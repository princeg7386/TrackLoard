import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DelayIntelligenceService } from '../src/services/delay-intelligence.service.js';
import { TripTimelineService } from '../src/services/trip-timeline.service.js';
import { EtaService } from '../src/services/eta.service.js';
import {
  TripDelayComparisonResultSchema,
  StopDelayComparisonSchema,
  DelaySeveritySchema,
} from '@school-bus/shared';
import * as database from '../src/config/database.js';

// Mock dependencies
vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  pool: { end: vi.fn() },
}));

vi.mock('../src/services/trip-timeline.service.js', () => ({
  TripTimelineService: {
    getTripTimeline: vi.fn(),
  },
}));

vi.mock('../src/services/eta.service.js', () => ({
  EtaService: {
    calculateTripEta: vi.fn(),
  },
}));

describe('Phase 25.2: Delay Intelligence & Actual Timeline Comparison Engine', () => {
  const schoolId = '11111111-1111-1111-1111-111111111111';
  const tripId = '22222222-2222-2222-2222-222222222222';
  const routeId = '33333333-3333-3333-3333-333333333333';
  const stop1Id = '44444444-4444-4444-4444-444444444441';
  const stop2Id = '44444444-4444-4444-4444-444444444442';
  const stop3Id = '44444444-4444-4444-4444-444444444443';

  const mockBaselineTimeline = {
    tripId,
    schoolId,
    routeId,
    routeName: 'Route 101 - North Campus Express',
    scheduledDate: '2026-10-25',
    scheduledStartTime: '2026-10-25T07:00:00.000Z',
    totalDistanceMeters: 4500,
    totalDurationSeconds: 900,
    expectedCompletionAt: '2026-10-25T07:15:00.000Z',
    stopsCount: 3,
    timeline: [
      {
        tripId,
        schoolId,
        stopId: stop1Id,
        stopName: 'Civil Lines Stop',
        sequenceOrder: 1,
        scheduledTime: '07:05:00',
        expectedArrival: '2026-10-25T07:05:00.000Z',
        expectedDeparture: '2026-10-25T07:05:45.000Z',
        distanceFromStartMeters: 0,
        durationFromStartSeconds: 45,
        dwellSeconds: 45,
      },
      {
        tripId,
        schoolId,
        stopId: stop2Id,
        stopName: 'Vishwa Vidyalaya Metro',
        sequenceOrder: 2,
        scheduledTime: '07:10:00',
        expectedArrival: '2026-10-25T07:10:00.000Z',
        expectedDeparture: '2026-10-25T07:10:45.000Z',
        distanceFromStartMeters: 2000,
        durationFromStartSeconds: 345,
        dwellSeconds: 45,
      },
      {
        tripId,
        schoolId,
        stopId: stop3Id,
        stopName: 'Kamla Nagar Market',
        sequenceOrder: 3,
        scheduledTime: '07:15:00',
        expectedArrival: '2026-10-25T07:15:00.000Z',
        expectedDeparture: '2026-10-25T07:15:45.000Z',
        distanceFromStartMeters: 4500,
        durationFromStartSeconds: 900,
        dwellSeconds: 45,
      },
    ],
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('1. Delay Severity Classification (classifyDelaySeverity)', () => {
    it('accurately classifies delay intervals into operational tiers', () => {
      // Early
      expect(DelayIntelligenceService.classifyDelaySeverity(-5)).toBe('EARLY');
      expect(DelayIntelligenceService.classifyDelaySeverity(-4)).toBe('EARLY');

      // On time (-3 to +5 minutes)
      expect(DelayIntelligenceService.classifyDelaySeverity(-3)).toBe('ON_TIME');
      expect(DelayIntelligenceService.classifyDelaySeverity(0)).toBe('ON_TIME');
      expect(DelayIntelligenceService.classifyDelaySeverity(3)).toBe('ON_TIME');
      expect(DelayIntelligenceService.classifyDelaySeverity(5)).toBe('ON_TIME');

      // Minor delay (6 to 10 minutes)
      expect(DelayIntelligenceService.classifyDelaySeverity(6)).toBe('MINOR_DELAY');
      expect(DelayIntelligenceService.classifyDelaySeverity(10)).toBe('MINOR_DELAY');

      // Moderate delay (11 to 20 minutes)
      expect(DelayIntelligenceService.classifyDelaySeverity(11)).toBe('MODERATE_DELAY');
      expect(DelayIntelligenceService.classifyDelaySeverity(15)).toBe('MODERATE_DELAY');
      expect(DelayIntelligenceService.classifyDelaySeverity(20)).toBe('MODERATE_DELAY');

      // Severe delay (> 20 minutes)
      expect(DelayIntelligenceService.classifyDelaySeverity(21)).toBe('SEVERE_DELAY');
      expect(DelayIntelligenceService.classifyDelaySeverity(45)).toBe('SEVERE_DELAY');
    });
  });

  describe('2. Live Trip Delay Comparison (compareTripTimeline)', () => {
    it('compares live GPS ETA against baseline timeline for in-transit trip', async () => {
      const mockQuery = vi.mocked(database.query);
      // Query 1: trip state
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          status: 'IN_TRANSIT',
          current_stop_sequence: 1, // Stop 1 already passed
          delay_minutes: 0,
          scheduled_date: '2026-10-25',
          scheduled_start_time: '2026-10-25T07:00:00.000Z',
          actual_start_time: '2026-10-25T07:02:00.000Z',
        },
      ]);
      // Query 2: trip delay_minutes update query
      mockQuery.mockResolvedValueOnce([{ id: tripId }]);

      // Mock baseline timeline
      vi.mocked(TripTimelineService.getTripTimeline).mockResolvedValueOnce(mockBaselineTimeline as any);

      // Mock live ETA calculation (Stop 2 expected 07:10, predicted 07:18 -> +8m MINOR_DELAY)
      // Stop 3 expected 07:15, predicted 07:27 -> +12m MODERATE_DELAY
      vi.mocked(EtaService.calculateTripEta).mockResolvedValueOnce({
        tripId,
        totalRemainingDistanceMeters: 3000,
        totalRemainingDurationSeconds: 1200,
        estimatedRouteCompletionAt: '2026-10-25T07:27:00.000Z',
        nextStopEta: null,
        effectiveSpeedKmh: 20,
        speedSource: 'rolling_avg',
        calculatedAt: '2026-10-25T07:05:00.000Z',
        stopEtas: [
          {
            stopId: stop2Id,
            stopName: 'Vishwa Vidyalaya Metro',
            sequenceOrder: 2,
            distanceMeters: 1500,
            durationSeconds: 780,
            estimatedArrivalAt: '2026-10-25T07:18:00.000Z', // 8 min late
            provider: 'DIRECT',
          },
          {
            stopId: stop3Id,
            stopName: 'Kamla Nagar Market',
            sequenceOrder: 3,
            distanceMeters: 3000,
            durationSeconds: 1320,
            estimatedArrivalAt: '2026-10-25T07:27:00.000Z', // 12 min late
            provider: 'DIRECT',
          },
        ],
      } as any);

      const comparison = await DelayIntelligenceService.compareTripTimeline(tripId, schoolId);

      expect(comparison.tripId).toBe(tripId);
      expect(comparison.stopsEvaluatedCount).toBe(3);
      expect(comparison.delayedStopsCount).toBe(2);

      // Stop 1: Passed
      const s1 = comparison.stopComparisons[0];
      expect(s1.stopId).toBe(stop1Id);
      expect(s1.hasPassed).toBe(true);
      expect(s1.delayMinutes).toBe(0);

      // Stop 2: Next upcoming stop (+8m -> MINOR_DELAY)
      const s2 = comparison.stopComparisons[1];
      expect(s2.stopId).toBe(stop2Id);
      expect(s2.hasPassed).toBe(false);
      expect(s2.delayMinutes).toBe(8);
      expect(s2.delayStatus).toBe('MINOR_DELAY');

      // Stop 3: Downstream stop (+12m -> MODERATE_DELAY)
      const s3 = comparison.stopComparisons[2];
      expect(s3.stopId).toBe(stop3Id);
      expect(s3.hasPassed).toBe(false);
      expect(s3.delayMinutes).toBe(12);
      expect(s3.delayStatus).toBe('MODERATE_DELAY');

      // Overall trip delay is set to next stop's delay (8 minutes)
      expect(comparison.overallDelayMinutes).toBe(8);
      expect(comparison.overallDelayStatus).toBe('MINOR_DELAY');
      expect(comparison.nextStopId).toBe(stop2Id);

      // Verify schema validity
      expect(TripDelayComparisonResultSchema.safeParse(comparison).success).toBe(true);

      // Verify DB update was executed
      expect(mockQuery).toHaveBeenCalledTimes(2);
      const updateCall = mockQuery.mock.calls[1][0] as string;
      expect(updateCall).toContain('UPDATE trips');
      expect(updateCall).toContain('SET delay_minutes = $1');
    });

    it('correctly reports EARLY status when bus is ahead of schedule', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          status: 'IN_TRANSIT',
          current_stop_sequence: 0,
          delay_minutes: 0,
          scheduled_date: '2026-10-25',
          scheduled_start_time: '2026-10-25T07:00:00.000Z',
          actual_start_time: '2026-10-25T06:55:00.000Z',
        },
      ]);
      mockQuery.mockResolvedValueOnce([{ id: tripId }]);

      vi.mocked(TripTimelineService.getTripTimeline).mockResolvedValueOnce(mockBaselineTimeline as any);

      // Live ETA 5 minutes earlier than expected (07:00 vs 07:05) -> -5 minutes -> EARLY
      vi.mocked(EtaService.calculateTripEta).mockResolvedValueOnce({
        tripId,
        totalRemainingDistanceMeters: 4500,
        totalRemainingDurationSeconds: 600,
        estimatedRouteCompletionAt: '2026-10-25T07:10:00.000Z',
        nextStopEta: null,
        effectiveSpeedKmh: 35,
        speedSource: 'rolling_avg',
        calculatedAt: '2026-10-25T06:56:00.000Z',
        stopEtas: [
          {
            stopId: stop1Id,
            stopName: 'Civil Lines Stop',
            sequenceOrder: 1,
            distanceMeters: 1000,
            durationSeconds: 240,
            estimatedArrivalAt: '2026-10-25T07:00:00.000Z', // 5m early
            provider: 'DIRECT',
          },
        ],
      } as any);

      const comparison = await DelayIntelligenceService.compareTripTimeline(tripId, schoolId);

      expect(comparison.stopComparisons[0].delayMinutes).toBe(-5);
      expect(comparison.stopComparisons[0].delayStatus).toBe('EARLY');
      expect(comparison.overallDelayStatus).toBe('EARLY');
    });

    it('evaluates scheduled trip with on-time status before journey start', async () => {
      const mockQuery = vi.mocked(database.query);
      const futureStartTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          status: 'SCHEDULED',
          current_stop_sequence: 0,
          delay_minutes: 0,
          scheduled_date: '2026-10-25',
          scheduled_start_time: futureStartTime,
          actual_start_time: null,
        },
      ]);
      mockQuery.mockResolvedValueOnce([{ id: tripId }]);

      vi.mocked(TripTimelineService.getTripTimeline).mockResolvedValueOnce({
        ...mockBaselineTimeline,
        scheduledStartTime: futureStartTime,
      } as any);

      const comparison = await DelayIntelligenceService.compareTripTimeline(tripId, schoolId);

      expect(comparison.overallDelayMinutes).toBe(0);
      expect(comparison.overallDelayStatus).toBe('ON_TIME');
      expect(comparison.delayedStopsCount).toBe(0);
      expect(comparison.stopComparisons[0].delayStatus).toBe('ON_TIME');
    });

    it('evaluates departure delay for scheduled trip when current time has surpassed scheduled start', async () => {
      const mockQuery = vi.mocked(database.query);
      // Scheduled start was 15 minutes ago
      const pastStartTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          status: 'SCHEDULED',
          current_stop_sequence: 0,
          delay_minutes: 0,
          scheduled_date: '2026-10-25',
          scheduled_start_time: pastStartTime,
          actual_start_time: null,
        },
      ]);
      mockQuery.mockResolvedValueOnce([{ id: tripId }]);

      vi.mocked(TripTimelineService.getTripTimeline).mockResolvedValueOnce({
        ...mockBaselineTimeline,
        scheduledStartTime: pastStartTime,
      } as any);

      const comparison = await DelayIntelligenceService.compareTripTimeline(tripId, schoolId);

      expect(comparison.overallDelayMinutes).toBe(15);
      expect(comparison.overallDelayStatus).toBe('MODERATE_DELAY');
      expect(comparison.stopComparisons[0].delayMinutes).toBe(15);
      expect(comparison.stopComparisons[0].delayStatus).toBe('MODERATE_DELAY');
    });

    it('throws NotFoundError when trip does not exist', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([]);

      await expect(
        DelayIntelligenceService.compareTripTimeline('non-existent-trip', schoolId)
      ).rejects.toThrow('not found');
    });

    it('falls back gracefully to baseline progression if live ETA calculator throws', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          status: 'IN_TRANSIT',
          current_stop_sequence: 0,
          delay_minutes: 0,
          scheduled_date: '2026-10-25',
          scheduled_start_time: '2026-10-25T07:00:00.000Z',
          actual_start_time: '2026-10-25T07:00:00.000Z',
        },
      ]);
      mockQuery.mockResolvedValueOnce([{ id: tripId }]);

      vi.mocked(TripTimelineService.getTripTimeline).mockResolvedValueOnce(mockBaselineTimeline as any);
      vi.mocked(EtaService.calculateTripEta).mockRejectedValueOnce(new Error('GPS service unavailable'));

      const comparison = await DelayIntelligenceService.compareTripTimeline(tripId, schoolId);

      expect(comparison.tripId).toBe(tripId);
      expect(comparison.stopsEvaluatedCount).toBe(3);
      expect(comparison.overallDelayMinutes).toBe(0);
      expect(comparison.overallDelayStatus).toBe('ON_TIME');
    });
  });

  describe('3. Schema Contracts', () => {
    it('validates StopDelayComparisonSchema', () => {
      const valid = StopDelayComparisonSchema.parse({
        stopId: stop1Id,
        stopName: 'Civil Lines Stop',
        sequenceOrder: 1,
        expectedArrival: '2026-10-25T07:05:00.000Z',
        predictedArrival: '2026-10-25T07:22:00.000Z',
        delayMinutes: 17,
        delayStatus: 'MODERATE_DELAY',
        hasPassed: false,
      });

      expect(valid.delayStatus).toBe('MODERATE_DELAY');
      expect(valid.delayMinutes).toBe(17);
    });

    it('validates DelaySeveritySchema values', () => {
      const values = ['EARLY', 'ON_TIME', 'MINOR_DELAY', 'MODERATE_DELAY', 'SEVERE_DELAY'];
      for (const val of values) {
        expect(DelaySeveritySchema.parse(val)).toBe(val);
      }
    });
  });
});
