import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LongStopDetectionService, TelemetryPointInput } from '../src/services/long-stop-detection.service.js';
import {
  LONG_STOP_CONFIG,
  LongStopDetectionOptionsSchema,
  LongStopDetectionResultSchema,
  LongStopRecordSchema,
} from '@school-bus/shared';
import * as database from '../src/config/database.js';

// Mock database query
vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  pool: { end: vi.fn() },
}));

describe('Phase 26.1: Long Stop Detection — Stationary Detection & Jitter Filtering', () => {
  const schoolId = '11111111-1111-1111-1111-111111111111';
  const tripId = '22222222-2222-2222-2222-222222222222';
  const busId = '33333333-3333-3333-3333-333333333333';
  const driverId = '44444444-4444-4444-4444-444444444444';
  const mockQuery = vi.mocked(database.query);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Pure Evaluation: evaluateTelemetryStream', () => {
    it('returns MOVING state for empty telemetry points', () => {
      const result = LongStopDetectionService.evaluateTelemetryStream([]);
      expect(result.status).toBe('MOVING');
      expect(result.isStationary).toBe(false);
      expect(result.isLongStop).toBe(false);
      expect(result.stationarySince).toBeNull();
      expect(result.durationMinutes).toBe(0);
      expect(result.totalPointsAnalyzed).toBe(0);
    });

    it('identifies actively moving vehicle when speed and displacement are high', () => {
      const now = Date.now();
      const points: TelemetryPointInput[] = [
        {
          latitude: 28.6139,
          longitude: 77.2090,
          speedKmh: 42.0,
          recordedAt: new Date(now).toISOString(),
        },
        {
          latitude: 28.6120,
          longitude: 77.2070,
          speedKmh: 38.0,
          recordedAt: new Date(now - 30 * 1000).toISOString(),
        },
        {
          latitude: 28.6100,
          longitude: 77.2050,
          speedKmh: 35.0,
          recordedAt: new Date(now - 60 * 1000).toISOString(),
        },
      ];

      const result = LongStopDetectionService.evaluateTelemetryStream(points);
      expect(result.status).toBe('MOVING');
      expect(result.isStationary).toBe(false);
      expect(result.isLongStop).toBe(false);
      expect(result.stationarySince).toBeNull();
      expect(result.averageSpeedKmh).toBe(42.0);
    });

    it('identifies short stationary dwell (< 5 minutes) as STATIONARY_SHORT', () => {
      const now = Date.now();
      // Bus stopped 2 minutes ago
      const points: TelemetryPointInput[] = [
        {
          latitude: 28.61390,
          longitude: 77.20900,
          speedKmh: 0.0,
          recordedAt: new Date(now).toISOString(),
        },
        {
          latitude: 28.61391,
          longitude: 77.20901,
          speedKmh: 0.0,
          recordedAt: new Date(now - 60 * 1000).toISOString(),
        },
        {
          latitude: 28.61389,
          longitude: 77.20899,
          speedKmh: 0.0,
          recordedAt: new Date(now - 120 * 1000).toISOString(),
        },
      ];

      const result = LongStopDetectionService.evaluateTelemetryStream(points);
      expect(result.status).toBe('STATIONARY_SHORT');
      expect(result.isStationary).toBe(true);
      expect(result.isLongStop).toBe(false);
      expect(result.durationMinutes).toBe(2.0);
      expect(result.durationSeconds).toBe(120);
      expect(result.stationaryPointsCount).toBe(3);
    });

    it('identifies long stationary dwell (>= 5 minutes) as LONG_STOP', () => {
      const now = Date.now();
      // Bus stopped 6 minutes ago
      const points: TelemetryPointInput[] = [
        {
          latitude: 28.61390,
          longitude: 77.20900,
          speedKmh: 0.0,
          recordedAt: new Date(now).toISOString(),
        },
        {
          latitude: 28.61391,
          longitude: 77.20901,
          speedKmh: 0.0,
          recordedAt: new Date(now - 180 * 1000).toISOString(),
        },
        {
          latitude: 28.61390,
          longitude: 77.20900,
          speedKmh: 0.0,
          recordedAt: new Date(now - 360 * 1000).toISOString(),
        },
      ];

      const result = LongStopDetectionService.evaluateTelemetryStream(points);
      expect(result.status).toBe('LONG_STOP');
      expect(result.isStationary).toBe(true);
      expect(result.isLongStop).toBe(true);
      expect(result.durationMinutes).toBe(6.0);
      expect(result.durationSeconds).toBe(360);
      expect(result.thresholdMinutes).toBe(LONG_STOP_CONFIG.DEFAULT_LONG_STOP_THRESHOLD_MINUTES);
    });

    it('respects configurable thresholds (e.g. 3 minute threshold)', () => {
      const now = Date.now();
      const points: TelemetryPointInput[] = [
        {
          latitude: 28.61390,
          longitude: 77.20900,
          speedKmh: 0.0,
          recordedAt: new Date(now).toISOString(),
        },
        {
          latitude: 28.61390,
          longitude: 77.20900,
          speedKmh: 0.0,
          recordedAt: new Date(now - 180 * 1000).toISOString(), // 3 min ago
        },
      ];

      // Default 5 minutes -> STATIONARY_SHORT
      const defaultResult = LongStopDetectionService.evaluateTelemetryStream(points);
      expect(defaultResult.status).toBe('STATIONARY_SHORT');
      expect(defaultResult.isLongStop).toBe(false);

      // Custom 3 minutes -> LONG_STOP
      const customResult = LongStopDetectionService.evaluateTelemetryStream(points, {
        longStopThresholdMinutes: 3,
      });
      expect(customResult.status).toBe('LONG_STOP');
      expect(customResult.isLongStop).toBe(true);
      expect(customResult.thresholdMinutes).toBe(3);
    });

    it('ignores GPS speed jitter (oscillating speeds under 3 km/h)', () => {
      const now = Date.now();
      // Mobile device reports speed jitter of 0.8, 1.4, 2.5 km/h while stationary
      const points: TelemetryPointInput[] = [
        {
          latitude: 28.61390,
          longitude: 77.20900,
          speedKmh: 1.4,
          recordedAt: new Date(now).toISOString(),
        },
        {
          latitude: 28.61392,
          longitude: 77.20901,
          speedKmh: 2.2,
          recordedAt: new Date(now - 120 * 1000).toISOString(),
        },
        {
          latitude: 28.61389,
          longitude: 77.20899,
          speedKmh: 0.7,
          recordedAt: new Date(now - 320 * 1000).toISOString(), // 5.3 min ago
        },
      ];

      const result = LongStopDetectionService.evaluateTelemetryStream(points);
      expect(result.status).toBe('LONG_STOP');
      expect(result.isStationary).toBe(true);
      expect(result.isLongStop).toBe(true);
      expect(result.averageSpeedKmh).toBeGreaterThan(0);
      expect(result.averageSpeedKmh).toBeLessThanOrEqual(3.0);
    });

    it('ignores GPS coordinate drift jitter (drift within 35 meters)', () => {
      const now = Date.now();
      // Anchor at (28.613900, 77.209000).
      // Points bouncing around ~10m - 20m from anchor
      const points: TelemetryPointInput[] = [
        {
          latitude: 28.613900,
          longitude: 77.209000,
          speedKmh: 0.5,
          recordedAt: new Date(now).toISOString(),
        },
        {
          latitude: 28.613990, // ~10 meters north
          longitude: 77.209000,
          speedKmh: 1.1,
          recordedAt: new Date(now - 150 * 1000).toISOString(),
        },
        {
          latitude: 28.613850, // ~15 meters south
          longitude: 77.209020,
          speedKmh: 0.3,
          recordedAt: new Date(now - 330 * 1000).toISOString(), // 5.5 min
        },
      ];

      const result = LongStopDetectionService.evaluateTelemetryStream(points);
      expect(result.status).toBe('LONG_STOP');
      expect(result.isStationary).toBe(true);
      expect(result.isLongStop).toBe(true);
      expect(result.maxDriftMeters).toBeGreaterThan(5);
      expect(result.maxDriftMeters).toBeLessThan(LONG_STOP_CONFIG.DEFAULT_JITTER_RADIUS_METERS);
    });

    it('stops stationary window when earlier point moved outside jitter radius (> 35m)', () => {
      const now = Date.now();
      const points: TelemetryPointInput[] = [
        {
          latitude: 28.61390,
          longitude: 77.20900,
          speedKmh: 0.0,
          recordedAt: new Date(now).toISOString(),
        },
        {
          latitude: 28.61391,
          longitude: 77.20901,
          speedKmh: 0.0,
          recordedAt: new Date(now - 60 * 1000).toISOString(), // 1 min ago
        },
        // Earlier point was 500m away driving at 40 km/h 2 minutes ago
        {
          latitude: 28.61000,
          longitude: 77.20500,
          speedKmh: 40.0,
          recordedAt: new Date(now - 120 * 1000).toISOString(),
        },
      ];

      const result = LongStopDetectionService.evaluateTelemetryStream(points);
      // Only the first 2 points should be clustered
      expect(result.stationaryPointsCount).toBe(2);
      expect(result.durationMinutes).toBe(1.0);
      expect(result.status).toBe('STATIONARY_SHORT');
      expect(result.isLongStop).toBe(false);
    });
  });

  describe('2. Service Integration: detectStationaryBus & Persistence', () => {
    it('throws NotFoundError if trip does not exist', async () => {
      mockQuery.mockResolvedValueOnce([]); // No trip row

      await expect(
        LongStopDetectionService.detectStationaryBus({
          tripId,
          schoolId,
        })
      ).rejects.toThrow(/not found/i);
    });

    it('inserts a new ACTIVE long stop record when threshold is exceeded', async () => {
      const now = Date.now();
      // 1. Mock trip lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_PROGRESS',
        },
      ]);

      // 2. Mock telemetry points (stopped 6 minutes ago, sampled every 2 minutes)
      mockQuery.mockResolvedValueOnce([
        {
          latitude: 28.61390,
          longitude: 77.20900,
          speed_kmh: 0.0,
          accuracy_meters: 10,
          recorded_at: new Date(now),
        },
        {
          latitude: 28.61391,
          longitude: 77.20901,
          speed_kmh: 0.0,
          accuracy_meters: 10,
          recorded_at: new Date(now - 120 * 1000),
        },
        {
          latitude: 28.61390,
          longitude: 77.20900,
          speed_kmh: 0.0,
          accuracy_meters: 10,
          recorded_at: new Date(now - 240 * 1000),
        },
        {
          latitude: 28.61391,
          longitude: 77.20901,
          speed_kmh: 0.0,
          accuracy_meters: 10,
          recorded_at: new Date(now - 360 * 1000),
        },
      ]);

      // 3. Mock active long stop check (none exists)
      mockQuery.mockResolvedValueOnce([]);

      // 4. Mock insert into long_stops
      const newRecordId = '99999999-9999-9999-9999-999999999999';
      mockQuery.mockResolvedValueOnce([{ id: newRecordId }]);

      const result = await LongStopDetectionService.detectStationaryBus({
        tripId,
        schoolId,
        autoPersist: true,
      });

      expect(result.status).toBe('LONG_STOP');
      expect(result.isLongStop).toBe(true);
      expect(result.longStopRecordId).toBe(newRecordId);
      expect(result.durationMinutes).toBe(6.0);

      // Verify insert query was called
      expect(mockQuery).toHaveBeenCalledTimes(4);
      expect(mockQuery.mock.calls[3]![0]).toMatch(/INSERT INTO long_stops/i);
    });

    it('updates existing ACTIVE record when bus remains in long stop', async () => {
      const now = Date.now();
      const existingId = '88888888-8888-8888-8888-888888888888';

      // 1. Mock trip lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_PROGRESS',
        },
      ]);

      // 2. Mock telemetry points (stopped 8 minutes ago, sampled every 2 minutes)
      mockQuery.mockResolvedValueOnce([
        {
          latitude: 28.61390,
          longitude: 77.20900,
          speed_kmh: 0.5,
          accuracy_meters: 10,
          recorded_at: new Date(now),
        },
        {
          latitude: 28.61391,
          longitude: 77.20901,
          speed_kmh: 0.2,
          accuracy_meters: 10,
          recorded_at: new Date(now - 120 * 1000),
        },
        {
          latitude: 28.61390,
          longitude: 77.20900,
          speed_kmh: 0.4,
          accuracy_meters: 10,
          recorded_at: new Date(now - 300 * 1000),
        },
        {
          latitude: 28.61391,
          longitude: 77.20901,
          speed_kmh: 0.2,
          accuracy_meters: 10,
          recorded_at: new Date(now - 480 * 1000),
        },
      ]);

      // 3. Mock active long stop check (record found)
      mockQuery.mockResolvedValueOnce([
        {
          id: existingId,
          started_at: new Date(now - 480 * 1000),
        },
      ]);

      // 4. Mock update long_stops
      mockQuery.mockResolvedValueOnce([]);

      const result = await LongStopDetectionService.detectStationaryBus({
        tripId,
        schoolId,
        autoPersist: true,
      });

      expect(result.status).toBe('LONG_STOP');
      expect(result.isLongStop).toBe(true);
      expect(result.longStopRecordId).toBe(existingId);
      expect(result.durationMinutes).toBe(8.0);

      // Verify update query was called
      expect(mockQuery).toHaveBeenCalledTimes(4);
      expect(mockQuery.mock.calls[3]![0]).toMatch(/UPDATE long_stops/i);
    });

    it('resolves active long stop when vehicle resumes moving', async () => {
      const now = Date.now();

      // 1. Mock trip lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_PROGRESS',
        },
      ]);

      // 2. Mock telemetry points (bus is driving at 45 km/h)
      mockQuery.mockResolvedValueOnce([
        {
          latitude: 28.62000,
          longitude: 77.21500,
          speed_kmh: 45.0,
          accuracy_meters: 5,
          recorded_at: new Date(now),
        },
        {
          latitude: 28.61500,
          longitude: 77.21000,
          speed_kmh: 42.0,
          accuracy_meters: 5,
          recorded_at: new Date(now - 30 * 1000),
        },
      ]);

      // 3. Mock resolve active long stop update query
      mockQuery.mockResolvedValueOnce([{ id: 'existing-id' }]);

      const result = await LongStopDetectionService.detectStationaryBus({
        tripId,
        schoolId,
        autoPersist: true,
      });

      expect(result.status).toBe('MOVING');
      expect(result.isStationary).toBe(false);
      expect(result.isLongStop).toBe(false);

      // Verify resolve query was executed
      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(mockQuery.mock.calls[2]![0]).toMatch(/status = 'RESOLVED'/i);
    });

    it('getActiveLongStops returns formatted list of active records', async () => {
      const mockRecord = {
        id: '77777777-7777-7777-7777-777777777777',
        school_id: schoolId,
        trip_id: tripId,
        bus_id: busId,
        driver_id: driverId,
        latitude: 28.6139,
        longitude: 77.2090,
        started_at: new Date(),
        duration_seconds: 420,
        threshold_minutes: 5,
        speed_kmh: 0.4,
        status: 'ACTIVE' as const,
        stop_type: 'UNPLANNED',
        resolved_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockQuery.mockResolvedValueOnce([mockRecord]);

      const records = await LongStopDetectionService.getActiveLongStops(schoolId);
      expect(records).toHaveLength(1);
      expect(records[0]!.id).toBe(mockRecord.id);
      expect(records[0]!.durationSeconds).toBe(420);
      expect(records[0]!.status).toBe('ACTIVE');
      expect(LongStopRecordSchema.parse(records[0])).toBeTruthy();
    });
  });
});
