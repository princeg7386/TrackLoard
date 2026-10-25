import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DelayIntelligenceService } from '../src/services/delay-intelligence.service.js';
import {
  WaitingParentTargetSchema,
  AffectedPickupStopSummarySchema,
  TripAffectedParentsResultSchema,
  TripDelayComparisonResult,
} from '@school-bus/shared';
import * as database from '../src/config/database.js';

// Mock database query
vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  pool: { end: vi.fn() },
}));

describe('Phase 25.3: Affected Parent Logic & Waiting Target Resolution', () => {
  const schoolId = '11111111-1111-1111-1111-111111111111';
  const tripId = '22222222-2222-2222-2222-222222222222';
  const stop1Id = '44444444-4444-4444-4444-444444444441'; // Already passed
  const stop2Id = '44444444-4444-4444-4444-444444444442'; // Upcoming, delayed 8m
  const stop3Id = '44444444-4444-4444-4444-444444444443'; // Upcoming, delayed 14m
  const stop4Id = '44444444-4444-4444-4444-444444444444'; // Upcoming, on-time (2m)

  const mockComparisonResult: TripDelayComparisonResult = {
    tripId,
    schoolId,
    overallDelayMinutes: 8,
    overallDelayStatus: 'MINOR_DELAY',
    nextStopDelayMinutes: 8,
    nextStopId: stop2Id,
    stopsEvaluatedCount: 4,
    delayedStopsCount: 2,
    evaluatedAt: '2026-10-25T07:10:00.000Z',
    stopComparisons: [
      {
        stopId: stop1Id,
        stopName: 'South Ex Part 1',
        sequenceOrder: 1,
        expectedArrival: '2026-10-25T07:05:00.000Z',
        predictedArrival: '2026-10-25T07:05:00.000Z',
        delayMinutes: 0,
        delayStatus: 'ON_TIME',
        hasPassed: true, // Already served
      },
      {
        stopId: stop2Id,
        stopName: 'Lajpat Nagar Ring Road',
        sequenceOrder: 2,
        expectedArrival: '2026-10-25T07:15:00.000Z',
        predictedArrival: '2026-10-25T07:23:00.000Z',
        delayMinutes: 8,
        delayStatus: 'MINOR_DELAY',
        hasPassed: false, // Upcoming affected
      },
      {
        stopId: stop3Id,
        stopName: 'Moolchand Hospital',
        sequenceOrder: 3,
        expectedArrival: '2026-10-25T07:25:00.000Z',
        predictedArrival: '2026-10-25T07:39:00.000Z',
        delayMinutes: 14,
        delayStatus: 'MODERATE_DELAY',
        hasPassed: false, // Upcoming affected
      },
      {
        stopId: stop4Id,
        stopName: 'Defense Colony Flyover',
        sequenceOrder: 4,
        expectedArrival: '2026-10-25T07:35:00.000Z',
        predictedArrival: '2026-10-25T07:37:00.000Z',
        delayMinutes: 2,
        delayStatus: 'ON_TIME',
        hasPassed: false, // Upcoming but on-time (below threshold)
      },
    ],
  };

  const parent1Id = '55555555-5555-5555-5555-555555555551';
  const parent2Id = '55555555-5555-5555-5555-555555555552';
  const student1Id = '66666666-6666-6666-6666-666666666661';
  const student2Id = '66666666-6666-6666-6666-666666666662';

  const mockCandidateRows = [
    {
      parentId: parent1Id,
      parentName: 'Ramesh Sharma',
      parentPhone: '+919876543210',
      studentId: student1Id,
      studentName: 'Aarav Sharma',
      stopId: stop2Id,
      stopName: 'Lajpat Nagar Ring Road',
      sequenceOrder: 2,
      trackingToken: 'token-xyz-1',
    },
    {
      parentId: parent2Id,
      parentName: 'Priya Verma',
      parentPhone: '+919876543211',
      studentId: student2Id,
      studentName: 'Ananya Verma',
      stopId: stop3Id,
      stopName: 'Moolchand Hospital',
      sequenceOrder: 3,
      trackingToken: null,
    },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('1. Upcoming Affected Pickups & Excluded Pickups', () => {
    it('identifies upcoming delayed pickups and excludes already-served pickups', async () => {
      // Spy on compareTripTimeline
      const spyCompare = vi.spyOn(DelayIntelligenceService, 'compareTripTimeline').mockResolvedValueOnce(mockComparisonResult);
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce(mockCandidateRows);

      const result = await DelayIntelligenceService.identifyWaitingParents({
        schoolId,
        tripId,
        minDelayMinutes: 5,
      });

      expect(spyCompare).toHaveBeenCalledWith(tripId, schoolId);

      // Verify pickup counts
      expect(result.alreadyServedPickupsCount).toBe(1); // stop 1
      expect(result.affectedPickupsCount).toBe(2); // stop 2 and stop 3
      expect(result.waitingParentsCount).toBe(2);

      // Verify affected pickups list excludes stop 1 (passed) and stop 4 (on-time)
      const stopIds = result.affectedPickups.map((p) => p.stopId);
      expect(stopIds).toContain(stop2Id);
      expect(stopIds).toContain(stop3Id);
      expect(stopIds).not.toContain(stop1Id);
      expect(stopIds).not.toContain(stop4Id);

      // Verify student counts per stop
      const stop2Summary = result.affectedPickups.find((p) => p.stopId === stop2Id);
      expect(stop2Summary?.waitingStudentsCount).toBe(1);
      expect(stop2Summary?.delayMinutes).toBe(8);
      expect(stop2Summary?.delayStatus).toBe('MINOR_DELAY');

      const stop3Summary = result.affectedPickups.find((p) => p.stopId === stop3Id);
      expect(stop3Summary?.waitingStudentsCount).toBe(1);
      expect(stop3Summary?.delayMinutes).toBe(14);
      expect(stop3Summary?.delayStatus).toBe('MODERATE_DELAY');
    });

    it('returns empty lists when no upcoming stops exceed delay threshold', async () => {
      const onTimeComparison: TripDelayComparisonResult = {
        ...mockComparisonResult,
        overallDelayMinutes: 2,
        overallDelayStatus: 'ON_TIME',
        delayedStopsCount: 0,
        stopComparisons: mockComparisonResult.stopComparisons.map((s) => ({
          ...s,
          delayMinutes: 2,
          delayStatus: 'ON_TIME',
        })),
      };

      vi.spyOn(DelayIntelligenceService, 'compareTripTimeline').mockResolvedValueOnce(onTimeComparison);
      const mockQuery = vi.mocked(database.query);

      const result = await DelayIntelligenceService.identifyWaitingParents({
        schoolId,
        tripId,
        minDelayMinutes: 5,
      });

      expect(result.affectedPickupsCount).toBe(0);
      expect(result.waitingParentsCount).toBe(0);
      expect(result.affectedPickups).toEqual([]);
      expect(result.waitingParents).toEqual([]);
      // Should not query DB if no upcoming stops are affected
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('2. Waiting Parent Target Resolution & Exclusions', () => {
    it('resolves waiting parents with live tracking URLs', async () => {
      vi.spyOn(DelayIntelligenceService, 'compareTripTimeline').mockResolvedValueOnce(mockComparisonResult);
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce(mockCandidateRows);

      const result = await DelayIntelligenceService.identifyWaitingParents({
        schoolId,
        tripId,
        minDelayMinutes: 5,
      });

      expect(result.waitingParents.length).toBe(2);

      // Parent 1 (with token)
      const p1 = result.waitingParents[0];
      expect(p1.parentName).toBe('Ramesh Sharma');
      expect(p1.studentName).toBe('Aarav Sharma');
      expect(p1.trackingToken).toBe('token-xyz-1');
      expect(p1.trackingUrl).toContain('token=token-xyz-1');
      expect(p1.delayMinutes).toBe(8);

      // Parent 2 (without token)
      const p2 = result.waitingParents[1];
      expect(p2.parentName).toBe('Priya Verma');
      expect(p2.trackingToken).toBeNull();
      expect(p2.trackingUrl).toBeNull();
      expect(p2.delayMinutes).toBe(14);

      // Verify that query enforces absence, boarding, and drop exclusions in SQL
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const querySql = mockQuery.mock.calls[0][0] as string;
      expect(querySql).toContain('absence_records');
      expect(querySql).toContain('boarding_events');
      expect(querySql).toContain('drop_events');
      expect(querySql).toContain('p.notifications_enabled = TRUE');
    });

    it('respects custom minDelayMinutes filter parameter', async () => {
      vi.spyOn(DelayIntelligenceService, 'compareTripTimeline').mockResolvedValueOnce(mockComparisonResult);
      const mockQuery = vi.mocked(database.query);
      // Only stop 3 (14m delay) exceeds 10m threshold
      mockQuery.mockResolvedValueOnce([mockCandidateRows[1]]);

      const result = await DelayIntelligenceService.identifyWaitingParents({
        schoolId,
        tripId,
        minDelayMinutes: 10,
      });

      expect(result.affectedPickupsCount).toBe(1);
      expect(result.affectedPickups[0].stopId).toBe(stop3Id);
      expect(result.waitingParentsCount).toBe(1);
      expect(result.waitingParents[0].stopId).toBe(stop3Id);
    });
  });

  describe('3. Schema Contracts Validation', () => {
    it('validates WaitingParentTargetSchema', () => {
      const validTarget = WaitingParentTargetSchema.parse({
        parentId: '11111111-1111-1111-1111-111111111111',
        parentName: 'Sunita Mehra',
        parentPhone: '+919876543210',
        studentId: '22222222-2222-2222-2222-222222222222',
        studentName: 'Kabir Mehra',
        stopId: stop2Id,
        stopName: 'Lajpat Nagar Ring Road',
        sequenceOrder: 2,
        expectedArrival: '2026-10-25T07:15:00.000Z',
        predictedArrival: '2026-10-25T07:27:00.000Z',
        delayMinutes: 12,
        delayStatus: 'MODERATE_DELAY',
        trackingToken: 'tok-123',
        trackingUrl: 'http://localhost:3000/track?token=tok-123',
      });

      expect(validTarget.delayStatus).toBe('MODERATE_DELAY');
      expect(validTarget.delayMinutes).toBe(12);
    });

    it('validates TripAffectedParentsResultSchema structure', () => {
      const validResult = TripAffectedParentsResultSchema.parse({
        tripId,
        schoolId,
        overallDelayMinutes: 8,
        overallDelayStatus: 'MINOR_DELAY',
        minDelayThresholdMinutes: 5,
        alreadyServedPickupsCount: 1,
        affectedPickupsCount: 1,
        waitingParentsCount: 1,
        affectedPickups: [
          {
            stopId: stop2Id,
            stopName: 'Lajpat Nagar Ring Road',
            sequenceOrder: 2,
            expectedArrival: '2026-10-25T07:15:00.000Z',
            predictedArrival: '2026-10-25T07:23:00.000Z',
            delayMinutes: 8,
            delayStatus: 'MINOR_DELAY',
            waitingStudentsCount: 1,
          },
        ],
        waitingParents: [],
        evaluatedAt: new Date().toISOString(),
      });

      expect(validResult.alreadyServedPickupsCount).toBe(1);
      expect(validResult.affectedPickupsCount).toBe(1);
    });
  });
});
