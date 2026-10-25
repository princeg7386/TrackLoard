import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TripTimelineService } from '../src/services/trip-timeline.service.js';
import {
  TripStopTimelineItemSchema,
  TripExpectedTimelineSchema,
} from '@school-bus/shared';
import * as database from '../src/config/database.js';

// Mock database query
vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  pool: { end: vi.fn() },
}));

describe('Phase 25.1: Expected Timeline & Pickup Arrival Engine', () => {
  const schoolId = '11111111-1111-1111-1111-111111111111';
  const tripId = '22222222-2222-2222-2222-222222222222';
  const routeId = '33333333-3333-3333-3333-333333333333';
  const stop1Id = '44444444-4444-4444-4444-444444444441';
  const stop2Id = '44444444-4444-4444-4444-444444444442';
  const stop3Id = '44444444-4444-4444-4444-444444444443';

  const mockTripRow = {
    id: tripId,
    school_id: schoolId,
    route_id: routeId,
    route_name: 'Route 12 - South Delhi Express',
    scheduled_date: '2026-10-25',
    scheduled_start_time: '2026-10-25T07:00:00.000Z',
  };

  const mockStopRows = [
    {
      id: stop1Id,
      stop_name: 'Hauz Khas Metro',
      sequence_order: 1,
      latitude: 28.5431,
      longitude: 77.2065,
      scheduled_time: '07:15:00',
      geofence_radius_meters: 300,
    },
    {
      id: stop2Id,
      stop_name: 'Green Park Market',
      sequence_order: 2,
      latitude: 28.5585,
      longitude: 77.2028,
      scheduled_time: '07:25:00',
      geofence_radius_meters: 300,
    },
    {
      id: stop3Id,
      stop_name: 'AIIMS Circle',
      sequence_order: 3,
      latitude: 28.5672,
      longitude: 77.2100,
      scheduled_time: null, // Test distance/speed calculation fallback
      geofence_radius_meters: 300,
    },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('1. Calculate Expected Timeline (calculateExpectedTimeline)', () => {
    it('calculates expected arrival, distances, and cumulative duration for each pickup stop', async () => {
      const mockQuery = vi.mocked(database.query);
      // Query 1: trip details
      mockQuery.mockResolvedValueOnce([mockTripRow]);
      // Query 2: pickup stops
      mockQuery.mockResolvedValueOnce(mockStopRows);

      const timeline = await TripTimelineService.calculateExpectedTimeline(tripId, schoolId);

      expect(timeline.tripId).toBe(tripId);
      expect(timeline.schoolId).toBe(schoolId);
      expect(timeline.routeId).toBe(routeId);
      expect(timeline.routeName).toBe('Route 12 - South Delhi Express');
      expect(timeline.stopsCount).toBe(3);
      expect(timeline.timeline.length).toBe(3);

      // Stop 1: Hauz Khas (scheduled 07:15:00 IST)
      const stop1 = timeline.timeline[0];
      expect(stop1.stopId).toBe(stop1Id);
      expect(stop1.sequenceOrder).toBe(1);
      expect(stop1.scheduledTime).toBe('07:15:00');
      expect(stop1.dwellSeconds).toBe(45);
      expect(stop1.distanceFromStartMeters).toBe(0); // first stop distance = 0
      expect(new Date(stop1.expectedArrival).getTime()).toBeLessThan(new Date(stop1.expectedDeparture!).getTime());

      // Stop 2: Green Park (scheduled 07:25:00 IST)
      const stop2 = timeline.timeline[1];
      expect(stop2.stopId).toBe(stop2Id);
      expect(stop2.sequenceOrder).toBe(2);
      expect(stop2.scheduledTime).toBe('07:25:00');
      expect(stop2.distanceFromStartMeters).toBeGreaterThan(0);

      // Stop 3: AIIMS Circle (scheduled_time null, calculated dynamically)
      const stop3 = timeline.timeline[2];
      expect(stop3.stopId).toBe(stop3Id);
      expect(stop3.sequenceOrder).toBe(3);
      expect(stop3.scheduledTime).toBeNull();
      expect(stop3.expectedArrival).toBeDefined();
      expect(stop3.distanceFromStartMeters).toBeGreaterThan(stop2.distanceFromStartMeters);

      // Schema verification
      expect(TripExpectedTimelineSchema.safeParse(timeline).success).toBe(true);
    });

    it('throws NotFoundError if trip does not exist', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([]);

      await expect(
        TripTimelineService.calculateExpectedTimeline('non-existent-trip', schoolId)
      ).rejects.toThrow('not found');
    });

    it('handles route with zero stops gracefully', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([mockTripRow]);
      mockQuery.mockResolvedValueOnce([]); // no stops

      const timeline = await TripTimelineService.calculateExpectedTimeline(tripId, schoolId);
      expect(timeline.stopsCount).toBe(0);
      expect(timeline.timeline).toEqual([]);
      expect(timeline.totalDistanceMeters).toBe(0);
    });
  });

  describe('2. Store Expected Timeline (generateAndStoreTimeline)', () => {
    it('persists calculated timeline records into trip_stop_timelines', async () => {
      const mockQuery = vi.mocked(database.query);
      // calculateExpectedTimeline queries
      mockQuery.mockResolvedValueOnce([mockTripRow]);
      mockQuery.mockResolvedValueOnce(mockStopRows);

      // Upsert returns for each stop
      mockQuery.mockResolvedValueOnce([{ id: 'timeline-row-1', created_at: new Date().toISOString() }]);
      mockQuery.mockResolvedValueOnce([{ id: 'timeline-row-2', created_at: new Date().toISOString() }]);
      mockQuery.mockResolvedValueOnce([{ id: 'timeline-row-3', created_at: new Date().toISOString() }]);

      const result = await TripTimelineService.generateAndStoreTimeline(tripId, schoolId);

      expect(result.timeline.length).toBe(3);
      expect(result.timeline[0].id).toBe('timeline-row-1');
      expect(result.timeline[1].id).toBe('timeline-row-2');
      expect(result.timeline[2].id).toBe('timeline-row-3');

      // Verify that database.query was called for trip, stops, and each insert (1 + 1 + 3 = 5)
      expect(mockQuery).toHaveBeenCalledTimes(5);
      const insertQuery = mockQuery.mock.calls[2][0] as string;
      expect(insertQuery).toContain('INSERT INTO trip_stop_timelines');
      expect(insertQuery).toContain('ON CONFLICT (trip_id, stop_id)');
    });
  });

  describe('3. Retrieve Trip Timeline (getTripTimeline)', () => {
    it('returns existing stored timeline records from database if present', async () => {
      const mockQuery = vi.mocked(database.query);
      const storedRows = [
        {
          id: 'row-1',
          tripId,
          schoolId,
          stopId: stop1Id,
          stopName: 'Hauz Khas Metro',
          sequenceOrder: 1,
          scheduledTime: '07:15:00',
          expectedArrival: '2026-10-25T01:45:00.000Z',
          expectedDeparture: '2026-10-25T01:45:45.000Z',
          distanceFromStartMeters: 0,
          durationFromStartSeconds: 45,
          dwellSeconds: 45,
          createdAt: new Date().toISOString(),
          routeId,
          routeName: 'Route 12 - South Delhi Express',
          scheduledDate: '2026-10-25',
          scheduledStartTime: '2026-10-25T07:00:00.000Z',
        },
      ];

      mockQuery.mockResolvedValueOnce(storedRows);

      const timeline = await TripTimelineService.getTripTimeline(tripId, schoolId);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(timeline.stopsCount).toBe(1);
      expect(timeline.timeline[0].stopName).toBe('Hauz Khas Metro');
      expect(timeline.timeline[0].id).toBe('row-1');
    });

    it('on-demand generates and stores timeline if not already cached in database', async () => {
      const mockQuery = vi.mocked(database.query);
      // Query 1: lookup in trip_stop_timelines returns empty
      mockQuery.mockResolvedValueOnce([]);
      // generateAndStoreTimeline: fetch trip
      mockQuery.mockResolvedValueOnce([mockTripRow]);
      // generateAndStoreTimeline: fetch stops
      mockQuery.mockResolvedValueOnce([mockStopRows[0]]);
      // generateAndStoreTimeline: insert
      mockQuery.mockResolvedValueOnce([{ id: 'gen-row-1', created_at: new Date().toISOString() }]);

      const timeline = await TripTimelineService.getTripTimeline(tripId, schoolId);

      expect(mockQuery).toHaveBeenCalledTimes(4);
      expect(timeline.stopsCount).toBe(1);
      expect(timeline.timeline[0].id).toBe('gen-row-1');
    });
  });

  describe('4. Quick Lookup for Stop Expected Arrival (getStopExpectedArrival)', () => {
    it('returns expected arrival and scheduled time for stop', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([
        {
          expected_arrival: '2026-10-25T01:45:00.000Z',
          scheduled_time: '07:15:00',
        },
      ]);

      const result = await TripTimelineService.getStopExpectedArrival(tripId, stop1Id);

      expect(result).not.toBeNull();
      expect(result?.expectedArrival).toBe('2026-10-25T01:45:00.000Z');
      expect(result?.scheduledTime).toBe('07:15:00');
    });

    it('returns null if stop expected arrival is not found', async () => {
      const mockQuery = vi.mocked(database.query);
      mockQuery.mockResolvedValueOnce([]);

      const result = await TripTimelineService.getStopExpectedArrival(tripId, 'unknown-stop');

      expect(result).toBeNull();
    });
  });

  describe('5. Schemas & Contract Validation', () => {
    it('validates TripStopTimelineItemSchema', () => {
      const valid = TripStopTimelineItemSchema.parse({
        tripId,
        schoolId,
        stopId: stop1Id,
        stopName: 'Saket City Hospital',
        sequenceOrder: 1,
        expectedArrival: new Date().toISOString(),
        distanceFromStartMeters: 500,
        durationFromStartSeconds: 120,
        dwellSeconds: 45,
      });

      expect(valid.dwellSeconds).toBe(45);
      expect(valid.sequenceOrder).toBe(1);
    });

    it('validates constants: average speed (25 km/h) and dwell time (45s)', () => {
      expect(TripTimelineService.AVERAGE_SPEED_KMH).toBe(25);
      expect(TripTimelineService.DEFAULT_DWELL_SECONDS).toBe(45);
      expect(TripTimelineService.WINDING_FACTOR).toBe(1.25);
    });
  });
});
