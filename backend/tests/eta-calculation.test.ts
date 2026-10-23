/**
 * Phase 20.2 — ETA Calculation: Tests
 *
 * Tests verify:
 *  - StopEtaResultSchema / RouteEtaSummarySchema shape validation
 *  - calculateStopEtas logic: empty stops, mono-increasing distance/duration,
 *    ascending timestamps, nextStopEta matches stopEtas[0],
 *    null currentPosition fallback, cumulative chaining
 *  - TelemetryFeedEvent has ETA optional fields
 *  - Route file has /trips/:tripId/eta
 *  - EtaService exports calculateStopEtas and calculateTripEta
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  StopEtaResultSchema,
  RouteEtaSummarySchema,
  EtaTripContextSchema,
} from '@school-bus/shared';
import { EtaService } from '../src/services/eta.service.js';

const ROOT = join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStop(seq: number, lat: number, lng: number) {
  return {
    stopId: `1111111${seq}-1111-1111-1111-111111111111`,
    stopName: `Stop ${seq}`,
    sequenceOrder: seq,
    latitude: lat,
    longitude: lng,
    geofenceRadiusMeters: 300,
    scheduledTime: '07:30:00',
  };
}

const BASE_CONTEXT = {
  tripId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  schoolId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  busId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  currentPosition: { latitude: 28.4950, longitude: 77.0880 },
  effectiveSpeedKmh: 25,
  speedSource: 'rolling_avg' as const,
  currentStopSequence: 0,
  remainingStops: [],
  tripStatus: 'IN_TRANSIT',
  actualStartTime: '2026-10-23T01:30:00.000Z',
  assembledAt: '2026-10-23T01:45:00.000Z',
};

// ---------------------------------------------------------------------------
// 1. Shared Schema Validation
// ---------------------------------------------------------------------------

describe('Phase 20.2 — StopEtaResultSchema', () => {
  const validStop = {
    stopId: '11111111-1111-1111-1111-111111111111',
    stopName: 'Gate 1',
    sequenceOrder: 1,
    distanceMeters: 1500,
    durationSeconds: 240,
    estimatedArrivalAt: '2026-10-23T02:04:00.000Z',
    provider: 'MOCK_ROUTING_PROVIDER',
  };

  it('parses a valid StopEtaResult', () => {
    const r = StopEtaResultSchema.parse(validStop);
    expect(r.distanceMeters).toBe(1500);
    expect(r.durationSeconds).toBe(240);
    expect(r.provider).toBe('MOCK_ROUTING_PROVIDER');
  });

  it('rejects negative distanceMeters', () => {
    expect(() => StopEtaResultSchema.parse({ ...validStop, distanceMeters: -1 })).toThrow();
  });

  it('rejects negative durationSeconds', () => {
    expect(() => StopEtaResultSchema.parse({ ...validStop, durationSeconds: -1 })).toThrow();
  });

  it('rejects non-ISO estimatedArrivalAt', () => {
    expect(() =>
      StopEtaResultSchema.parse({ ...validStop, estimatedArrivalAt: 'tomorrow' })
    ).toThrow();
  });
});

describe('Phase 20.2 — RouteEtaSummarySchema', () => {
  const stopEta = {
    stopId: '11111111-1111-1111-1111-111111111111',
    stopName: 'Gate 1',
    sequenceOrder: 1,
    distanceMeters: 1500,
    durationSeconds: 240,
    estimatedArrivalAt: '2026-10-23T02:04:00.000Z',
    provider: 'MOCK_ROUTING_PROVIDER',
  };

  const validSummary = {
    tripId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    totalRemainingDistanceMeters: 1500,
    totalRemainingDurationSeconds: 240,
    estimatedRouteCompletionAt: '2026-10-23T02:04:00.000Z',
    nextStopEta: stopEta,
    stopEtas: [stopEta],
    effectiveSpeedKmh: 25,
    speedSource: 'rolling_avg',
    calculatedAt: '2026-10-23T02:00:00.000Z',
  };

  it('parses a complete RouteEtaSummary', () => {
    const r = RouteEtaSummarySchema.parse(validSummary);
    expect(r.tripId).toBe(validSummary.tripId);
    expect(r.stopEtas).toHaveLength(1);
    expect(r.nextStopEta?.stopName).toBe('Gate 1');
  });

  it('accepts empty stopEtas with null nextStopEta and null completionAt', () => {
    const r = RouteEtaSummarySchema.parse({
      ...validSummary,
      stopEtas: [],
      nextStopEta: null,
      estimatedRouteCompletionAt: null,
      totalRemainingDistanceMeters: 0,
      totalRemainingDurationSeconds: 0,
    });
    expect(r.stopEtas).toHaveLength(0);
    expect(r.nextStopEta).toBeNull();
    expect(r.estimatedRouteCompletionAt).toBeNull();
  });

  it('rejects effectiveSpeedKmh below 5', () => {
    expect(() =>
      RouteEtaSummarySchema.parse({ ...validSummary, effectiveSpeedKmh: 2 })
    ).toThrow();
  });

  it('rejects totalRemainingDistanceMeters < 0', () => {
    expect(() =>
      RouteEtaSummarySchema.parse({ ...validSummary, totalRemainingDistanceMeters: -100 })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. calculateStopEtas pure-logic tests (using Mock provider in-process)
// ---------------------------------------------------------------------------

describe('Phase 20.2 — calculateStopEtas logic (mock provider)', () => {
  it('returns empty stopEtas and null nextStopEta when no remaining stops', async () => {
    const ctx = EtaTripContextSchema.parse({ ...BASE_CONTEXT, remainingStops: [] });
    const summary = await EtaService.calculateStopEtas(ctx);
    expect(summary.stopEtas).toHaveLength(0);
    expect(summary.nextStopEta).toBeNull();
    expect(summary.estimatedRouteCompletionAt).toBeNull();
    expect(summary.totalRemainingDistanceMeters).toBe(0);
    expect(summary.totalRemainingDurationSeconds).toBe(0);
  });

  it('returns one StopEtaResult for one remaining stop', async () => {
    const ctx = EtaTripContextSchema.parse({
      ...BASE_CONTEXT,
      remainingStops: [makeStop(1, 28.4980, 77.0920)],
    });
    const summary = await EtaService.calculateStopEtas(ctx);
    expect(summary.stopEtas).toHaveLength(1);
    expect(summary.nextStopEta?.stopName).toBe('Stop 1');
  });

  it('cumulative distanceMeters is monotonically non-decreasing', async () => {
    const ctx = EtaTripContextSchema.parse({
      ...BASE_CONTEXT,
      remainingStops: [
        makeStop(1, 28.4980, 77.0920),
        makeStop(2, 28.5010, 77.0960),
        makeStop(3, 28.5040, 77.1000),
      ],
    });
    const summary = await EtaService.calculateStopEtas(ctx);
    const distances = summary.stopEtas.map((s) => s.distanceMeters);
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]!);
    }
  });

  it('cumulative durationSeconds is monotonically non-decreasing', async () => {
    const ctx = EtaTripContextSchema.parse({
      ...BASE_CONTEXT,
      remainingStops: [
        makeStop(1, 28.4980, 77.0920),
        makeStop(2, 28.5010, 77.0960),
      ],
    });
    const summary = await EtaService.calculateStopEtas(ctx);
    const durations = summary.stopEtas.map((s) => s.durationSeconds);
    expect(durations[1]).toBeGreaterThanOrEqual(durations[0]!);
  });

  it('estimatedArrivalAt timestamps are in ascending order', async () => {
    const ctx = EtaTripContextSchema.parse({
      ...BASE_CONTEXT,
      remainingStops: [
        makeStop(1, 28.4980, 77.0920),
        makeStop(2, 28.5010, 77.0960),
        makeStop(3, 28.5040, 77.1000),
      ],
    });
    const summary = await EtaService.calculateStopEtas(ctx);
    const times = summary.stopEtas.map((s) => new Date(s.estimatedArrivalAt).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]!);
    }
  });

  it('nextStopEta matches stopEtas[0]', async () => {
    const ctx = EtaTripContextSchema.parse({
      ...BASE_CONTEXT,
      remainingStops: [
        makeStop(1, 28.4980, 77.0920),
        makeStop(2, 28.5010, 77.0960),
      ],
    });
    const summary = await EtaService.calculateStopEtas(ctx);
    expect(summary.nextStopEta?.stopId).toBe(summary.stopEtas[0]?.stopId);
  });

  it('when currentPosition is null, first stop leg is skipped or uses stop coords as own origin', async () => {
    const ctx = EtaTripContextSchema.parse({
      ...BASE_CONTEXT,
      currentPosition: null,
      remainingStops: [
        makeStop(1, 28.4980, 77.0920),
        makeStop(2, 28.5010, 77.0960),
      ],
    });
    const summary = await EtaService.calculateStopEtas(ctx);
    // With null position the first stop uses its own coords as origin (isSamePoint).
    // The second stop's cumulative distance must be >= the first stop's.
    expect(summary.stopEtas).toHaveLength(2);
    expect(summary.stopEtas[1]!.distanceMeters).toBeGreaterThanOrEqual(
      summary.stopEtas[0]!.distanceMeters
    );
  });

  it('totalRemainingDistanceMeters equals last stop distanceMeters', async () => {
    const ctx = EtaTripContextSchema.parse({
      ...BASE_CONTEXT,
      remainingStops: [
        makeStop(1, 28.4980, 77.0920),
        makeStop(2, 28.5010, 77.0960),
      ],
    });
    const summary = await EtaService.calculateStopEtas(ctx);
    const lastStop = summary.stopEtas[summary.stopEtas.length - 1]!;
    // totalRemaining reflects cumulative sum — must equal last stop's cumulative values
    expect(summary.totalRemainingDistanceMeters).toEqual(lastStop.distanceMeters);
    expect(summary.totalRemainingDurationSeconds).toEqual(lastStop.durationSeconds);
  });

  it('estimatedRouteCompletionAt matches last stop estimatedArrivalAt (as epoch ms)', async () => {
    const ctx = EtaTripContextSchema.parse({
      ...BASE_CONTEXT,
      remainingStops: [makeStop(1, 28.4980, 77.0920)],
    });
    const summary = await EtaService.calculateStopEtas(ctx);
    // Zod may normalize ISO strings — compare as timestamps
    const completionMs = new Date(summary.estimatedRouteCompletionAt!).getTime();
    const lastStopMs = new Date(summary.stopEtas[0]!.estimatedArrivalAt).getTime();
    expect(completionMs).toBe(lastStopMs);
  });

  it('calculatedAt is a valid ISO timestamp', async () => {
    const ctx = EtaTripContextSchema.parse({ ...BASE_CONTEXT, remainingStops: [] });
    const summary = await EtaService.calculateStopEtas(ctx);
    expect(new Date(summary.calculatedAt).getTime()).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Structural / file-content assertions
// ---------------------------------------------------------------------------

describe('Phase 20.2 — EtaService structural verification', () => {
  const src = readFileSync(
    join(ROOT, 'backend', 'src', 'services', 'eta.service.ts'),
    'utf8'
  );

  it('exports calculateStopEtas', () => {
    expect(src).toContain('static async calculateStopEtas(');
  });

  it('exports calculateTripEta convenience wrapper', () => {
    expect(src).toContain('static async calculateTripEta(');
  });

  it('imports RoutingService', () => {
    expect(src).toContain("from './routing/routing.service.js'");
  });

  it('imports StopEtaResultSchema from shared', () => {
    expect(src).toContain('StopEtaResultSchema');
  });

  it('imports RouteEtaSummarySchema from shared', () => {
    expect(src).toContain('RouteEtaSummarySchema');
  });

  it('uses cumulative distance accumulation', () => {
    expect(src).toContain('cumulativeDistanceMeters');
  });

  it('uses cumulative duration accumulation', () => {
    expect(src).toContain('cumulativeDurationSeconds');
  });

  it('has haversine fallback when RoutingService fails', () => {
    expect(src).toContain('HAVERSINE_FALLBACK');
  });

  it('handles same-point origin (isSamePoint guard)', () => {
    expect(src).toContain('isSamePoint');
  });
});

describe('Phase 20.2 — HTTP route registration', () => {
  const routeSrc = readFileSync(
    join(ROOT, 'backend', 'src', 'routes', 'telemetry.routes.ts'),
    'utf8'
  );

  it('registers GET /trips/:tripId/eta route', () => {
    expect(routeSrc).toContain('/trips/:tripId/eta');
  });

  it('uses requireActorTenantScope on the ETA route', () => {
    expect(routeSrc).toContain('requireActorTenantScope');
  });

  it('wires getTripEta controller action', () => {
    expect(routeSrc).toContain('TelemetryController.getTripEta');
  });
});

describe('Phase 20.2 — TelemetryFeedEvent ETA extension', () => {
  const sharedSrc = readFileSync(
    join(ROOT, 'shared', 'src', 'index.ts'),
    'utf8'
  );

  it('TelemetryFeedEvent has nextStopEtaSeconds field', () => {
    expect(sharedSrc).toContain('nextStopEtaSeconds');
  });

  it('TelemetryFeedEvent has nextStopName field', () => {
    expect(sharedSrc).toContain('nextStopName');
  });

  it('TelemetryFeedEvent has estimatedNextArrivalAt field', () => {
    expect(sharedSrc).toContain('estimatedNextArrivalAt');
  });
});
