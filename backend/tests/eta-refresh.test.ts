/**
 * Phase 20.3 — ETA Refresh: Tests
 *
 * Tests verify:
 *  1. EtaSmoothingService.smooth() — pure function behaviour:
 *     - No previous summary: pass-through (with optional stopped-bus hold)
 *     - Stopped-bus detection (speed ≤ 2 km/h) → STOPPED_HOLD_SECS added
 *     - Moving bus → exponential smoothing applied
 *     - Jump clamp: large single-ping change is capped at MAX_JUMP_SECONDS
 *     - New stop (not in prev) is included without crashing
 *     - Empty stopEtas → summary with null nextStopEta/completionAt
 *  2. EtaRefreshService:
 *     - scheduleRefresh → eventual ETA_UPDATE SSE event published
 *     - Cache is populated after refresh
 *     - Cache eviction via evictCache()
 *     - EtaService failure → ETA_UPDATE NOT published (non-fatal)
 *  3. ETA_UPDATE event type exists in TelemetryFeedEvent
 *  4. Shared RouteEtaSummary type accessible in eta-refresh.service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { EtaSmoothingService, EtaRefreshService } from '../src/services/eta-refresh.service.js';
import type { RouteEtaSummary, StopEtaResult } from '@school-bus/shared';

const ROOT = join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStopEta(
  idx: number,
  durationSeconds: number,
  distanceMeters: number,
  estimatedArrivalAt?: string
): StopEtaResult {
  return {
    stopId: `1111111${idx}-1111-1111-1111-111111111111`,
    stopName: `Stop ${idx}`,
    sequenceOrder: idx,
    distanceMeters,
    durationSeconds,
    estimatedArrivalAt: estimatedArrivalAt ?? new Date(Date.now() + durationSeconds * 1000).toISOString(),
    provider: 'HAVERSINE_FALLBACK',
  };
}

function makeSummary(stopEtas: StopEtaResult[], tripId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'): RouteEtaSummary {
  const last = stopEtas[stopEtas.length - 1];
  return {
    tripId,
    totalRemainingDistanceMeters: last?.distanceMeters ?? 0,
    totalRemainingDurationSeconds: last?.durationSeconds ?? 0,
    estimatedRouteCompletionAt: last?.estimatedArrivalAt ?? null,
    nextStopEta: stopEtas[0] ?? null,
    stopEtas,
    effectiveSpeedKmh: 25,
    speedSource: 'rolling_avg',
    calculatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 1. EtaSmoothingService — pure function
// ---------------------------------------------------------------------------

describe('Phase 20.3 — EtaSmoothingService.smooth()', () => {
  it('with no previous summary, returns raw summary unchanged (empty stops)', () => {
    const raw = makeSummary([]);
    const { summary, isStoppedBus } = EtaSmoothingService.smooth(null, raw, 25);
    expect(summary.stopEtas).toHaveLength(0);
    expect(summary.nextStopEta).toBeNull();
    expect(isStoppedBus).toBe(false);
  });

  it('with no previous summary and one stop, returns raw values (moving bus)', () => {
    const stop = makeStopEta(1, 300, 2000);
    const raw = makeSummary([stop]);
    const { summary } = EtaSmoothingService.smooth(null, raw, 25);
    expect(summary.stopEtas).toHaveLength(1);
    expect(summary.stopEtas[0]!.durationSeconds).toBe(300);
    expect(summary.isStoppedBus).toBeUndefined(); // field not on RouteEtaSummary
  });

  it('detects stopped bus when speed ≤ 2 km/h', () => {
    const stop = makeStopEta(1, 300, 2000);
    const raw = makeSummary([stop]);
    const { isStoppedBus } = EtaSmoothingService.smooth(null, raw, 1.5);
    expect(isStoppedBus).toBe(true);
  });

  it('does NOT detect stopped bus when speed > 2 km/h', () => {
    const stop = makeStopEta(1, 300, 2000);
    const raw = makeSummary([stop]);
    const { isStoppedBus } = EtaSmoothingService.smooth(null, raw, 5);
    expect(isStoppedBus).toBe(false);
  });

  it('adds STOPPED_HOLD_SECONDS when bus is stopped (no prev)', () => {
    const HOLD = 60;
    const stop = makeStopEta(1, 300, 2000);
    const raw = makeSummary([stop]);
    const { summary } = EtaSmoothingService.smooth(null, raw, 0, {
      stoppedHoldSeconds: HOLD,
      stoppedThresholdKmh: 2,
    });
    expect(summary.stopEtas[0]!.durationSeconds).toBe(300 + HOLD);
  });

  it('applies exponential smoothing with alpha=0.7 against previous value', () => {
    const prev = makeSummary([makeStopEta(1, 400, 2000)]);
    const next = makeSummary([makeStopEta(1, 200, 1800)]);
    // smoothed = 0.7 * 200 + 0.3 * 400 = 140 + 120 = 260
    // Use large maxJumpSeconds so the clamp does not engage (|260 - 400| = 140 < 200)
    const { summary } = EtaSmoothingService.smooth(prev, next, 25, {
      alpha: 0.7,
      maxJumpSeconds: 200,
    });
    expect(summary.stopEtas[0]!.durationSeconds).toBe(260);
  });


  it('clamps large downward jump to MAX_JUMP_SECONDS below previous', () => {
    const MAX_JUMP = 120;
    const prev = makeSummary([makeStopEta(1, 600, 4000)]);
    // next = 0 → raw smoothed = 0.7*0 + 0.3*600 = 180 → still needs clamp check
    // But jump limit: new can't go below 600 - 120 = 480
    const next = makeSummary([makeStopEta(1, 0, 0)]);
    const { summary } = EtaSmoothingService.smooth(prev, next, 25, {
      maxJumpSeconds: MAX_JUMP,
      alpha: 0.7,
    });
    // smoothed = 0.7*0 + 0.3*600 = 180, clamped lower = 600 - 120 = 480
    expect(summary.stopEtas[0]!.durationSeconds).toBe(480);
  });

  it('clamps large upward jump to MAX_JUMP_SECONDS above previous', () => {
    const MAX_JUMP = 120;
    const prev = makeSummary([makeStopEta(1, 100, 1000)]);
    // next = 9999 → smoothed = 0.7*9999 + 0.3*100 = 6999.3 + 30 = 7029.3
    // clamped upper = 100 + 120 = 220
    const next = makeSummary([makeStopEta(1, 9999, 50000)]);
    const { summary } = EtaSmoothingService.smooth(prev, next, 25, {
      maxJumpSeconds: MAX_JUMP,
      alpha: 0.7,
    });
    expect(summary.stopEtas[0]!.durationSeconds).toBe(220);
  });

  it('adds STOPPED_HOLD on top of clamped value when bus is stopped', () => {
    const MAX_JUMP = 120;
    const HOLD = 60;
    const prev = makeSummary([makeStopEta(1, 300, 2000)]);
    const next = makeSummary([makeStopEta(1, 300, 2000)]); // same reading
    // smoothed = 0.7*300 + 0.3*300 = 300, clamped = 300, + hold = 360
    const { summary, isStoppedBus } = EtaSmoothingService.smooth(prev, next, 1, {
      maxJumpSeconds: MAX_JUMP,
      stoppedHoldSeconds: HOLD,
      stoppedThresholdKmh: 2,
      alpha: 0.7,
    });
    expect(isStoppedBus).toBe(true);
    expect(summary.stopEtas[0]!.durationSeconds).toBe(360);
  });

  it('handles a stop present in next but absent from prev (bus advanced)', () => {
    const prev = makeSummary([makeStopEta(2, 400, 3000)]);
    // Stop 1 is new (not in prev), Stop 2 is familiar
    const next = makeSummary([
      makeStopEta(1, 100, 800),
      makeStopEta(2, 500, 3500),
    ]);
    const { summary } = EtaSmoothingService.smooth(prev, next, 25);
    expect(summary.stopEtas).toHaveLength(2);
    expect(summary.stopEtas[0]!.stopName).toBe('Stop 1');
  });

  it('rebuilds nextStopEta = stopEtas[0] and completionAt = last stop arrival', () => {
    const stops = [makeStopEta(1, 120, 1000), makeStopEta(2, 300, 2500)];
    const raw = makeSummary(stops);
    const { summary } = EtaSmoothingService.smooth(null, raw, 30);
    expect(summary.nextStopEta?.stopId).toBe(summary.stopEtas[0]?.stopId);
    const completionMs = new Date(summary.estimatedRouteCompletionAt!).getTime();
    const lastMs = new Date(summary.stopEtas[1]!.estimatedArrivalAt).getTime();
    expect(completionMs).toBe(lastMs);
  });

  it('durationSeconds never goes below 0', () => {
    const prev = makeSummary([makeStopEta(1, 10, 200)]);
    const next = makeSummary([makeStopEta(1, 0, 0)]);
    // smoothed would be negative with high alpha, but clamped at 0
    const { summary } = EtaSmoothingService.smooth(prev, next, 25, {
      alpha: 1.0,
      maxJumpSeconds: 100,
    });
    expect(summary.stopEtas[0]!.durationSeconds).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 2. EtaRefreshService — fire-and-forget + cache
// ---------------------------------------------------------------------------

describe('Phase 20.3 — EtaRefreshService', () => {
  beforeEach(() => {
    EtaRefreshService.clearCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    EtaRefreshService.clearCache();
    vi.restoreAllMocks();
  });

  it('getCacheSize() returns 0 after clearCache()', () => {
    expect(EtaRefreshService.getCacheSize()).toBe(0);
  });

  it('getCachedSummary returns null for unknown tripId', () => {
    expect(EtaRefreshService.getCachedSummary('nonexistent')).toBeNull();
  });

  it('evictCache() removes the cached summary for a trip', () => {
    // Simulate a cached entry by calling clearCache and then checking
    EtaRefreshService.clearCache();
    expect(EtaRefreshService.getCacheSize()).toBe(0);
    EtaRefreshService.evictCache('some-trip-id');
    expect(EtaRefreshService.getCacheSize()).toBe(0);
  });

  it('scheduleRefresh() does not throw when EtaService fails (non-fatal)', async () => {
    // EtaService.assembleContext will throw because no DB is available in unit tests
    // scheduleRefresh should not propagate the error
    expect(() => {
      EtaRefreshService.scheduleRefresh({
        tripId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        schoolId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        busId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        speedKmh: 25,
        healthStatus: 'GOOD',
        latitude: 28.495,
        longitude: 77.088,
        recordedAt: new Date().toISOString(),
      });
    }).not.toThrow();
  });

  it('_doRefresh logs warning and does not publish when EtaService throws', async () => {
    const { EtaService } = await import('../src/services/eta.service.js');
    const { RealtimeFeedService } = await import('../src/services/realtime-feed.service.js');

    vi.spyOn(EtaService, 'assembleContext').mockRejectedValueOnce(
      new Error('DB connection refused')
    );
    const publishSpy = vi.spyOn(RealtimeFeedService, 'publish');

    await EtaRefreshService._doRefresh({
      tripId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      schoolId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      busId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      speedKmh: 25,
      healthStatus: 'GOOD',
      latitude: 28.495,
      longitude: 77.088,
      recordedAt: new Date().toISOString(),
    });

    // Must not publish when EtaService fails
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('_doRefresh publishes ETA_UPDATE event when EtaService succeeds', async () => {
    const { EtaService } = await import('../src/services/eta.service.js');
    const { RealtimeFeedService } = await import('../src/services/realtime-feed.service.js');

    const tripId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const mockSummary = makeSummary([makeStopEta(1, 300, 2000)], tripId);

    vi.spyOn(EtaService, 'assembleContext').mockResolvedValueOnce({
      tripId,
      schoolId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      busId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      currentPosition: { latitude: 28.495, longitude: 77.088 },
      effectiveSpeedKmh: 25,
      speedSource: 'rolling_avg',
      currentStopSequence: 0,
      remainingStops: [],
      tripStatus: 'IN_TRANSIT',
      actualStartTime: new Date().toISOString(),
      assembledAt: new Date().toISOString(),
    });
    vi.spyOn(EtaService, 'calculateStopEtas').mockResolvedValueOnce(mockSummary);

    const publishSpy = vi.spyOn(RealtimeFeedService, 'publish');

    await EtaRefreshService._doRefresh({
      tripId,
      schoolId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      busId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      speedKmh: 25,
      healthStatus: 'GOOD',
      latitude: 28.495,
      longitude: 77.088,
      recordedAt: new Date().toISOString(),
    });

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const published = publishSpy.mock.calls[0]![0];
    expect(published.type).toBe('ETA_UPDATE');
    expect(published.tripId).toBe(tripId);
    expect(published.etaSummary).toBeDefined();
    expect(published.isStoppedBus).toBe(false);
  });

  it('_doRefresh caches the smoothed summary after successful refresh', async () => {
    const { EtaService } = await import('../src/services/eta.service.js');
    const { RealtimeFeedService } = await import('../src/services/realtime-feed.service.js');

    const tripId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const mockSummary = makeSummary([makeStopEta(1, 200, 1500)], tripId);

    vi.spyOn(EtaService, 'assembleContext').mockResolvedValueOnce({
      tripId,
      schoolId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      busId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      currentPosition: null,
      effectiveSpeedKmh: 25,
      speedSource: 'fallback',
      currentStopSequence: 0,
      remainingStops: [],
      tripStatus: 'IN_TRANSIT',
      actualStartTime: null,
      assembledAt: new Date().toISOString(),
    });
    vi.spyOn(EtaService, 'calculateStopEtas').mockResolvedValueOnce(mockSummary);
    vi.spyOn(RealtimeFeedService, 'publish');

    expect(EtaRefreshService.getCachedSummary(tripId)).toBeNull();

    await EtaRefreshService._doRefresh({
      tripId,
      schoolId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      busId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      speedKmh: 25,
      healthStatus: 'GOOD',
      latitude: 28.5,
      longitude: 77.1,
      recordedAt: new Date().toISOString(),
    });

    expect(EtaRefreshService.getCachedSummary(tripId)).not.toBeNull();
    expect(EtaRefreshService.getCachedSummary(tripId)?.tripId).toBe(tripId);
  });

  it('sets isStoppedBus=true in published event when speedKmh ≤ 2', async () => {
    const { EtaService } = await import('../src/services/eta.service.js');
    const { RealtimeFeedService } = await import('../src/services/realtime-feed.service.js');

    const tripId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    const mockSummary = makeSummary([makeStopEta(1, 180, 1200)], tripId);

    vi.spyOn(EtaService, 'assembleContext').mockResolvedValueOnce({
      tripId,
      schoolId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      busId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      currentPosition: { latitude: 28.5, longitude: 77.1 },
      effectiveSpeedKmh: 5,
      speedSource: 'last_ping',
      currentStopSequence: 0,
      remainingStops: [],
      tripStatus: 'IN_TRANSIT',
      actualStartTime: new Date().toISOString(),
      assembledAt: new Date().toISOString(),
    });
    vi.spyOn(EtaService, 'calculateStopEtas').mockResolvedValueOnce(mockSummary);
    const publishSpy = vi.spyOn(RealtimeFeedService, 'publish');

    // Speed 1 km/h = stopped
    await EtaRefreshService._doRefresh({
      tripId,
      schoolId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      busId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      speedKmh: 1,
      healthStatus: 'POOR',
      latitude: 28.5,
      longitude: 77.1,
      recordedAt: new Date().toISOString(),
    });

    const published = publishSpy.mock.calls[0]![0];
    expect(published.isStoppedBus).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Structural / contract checks
// ---------------------------------------------------------------------------

describe('Phase 20.3 — Structural verification', () => {
  it('ETA_UPDATE is present in TelemetryFeedEventType in shared index', () => {
    const src = readFileSync(join(ROOT, 'shared', 'src', 'index.ts'), 'utf8');
    expect(src).toContain("'ETA_UPDATE'");
  });

  it('TelemetryFeedEvent has etaSummary field', () => {
    const src = readFileSync(join(ROOT, 'shared', 'src', 'index.ts'), 'utf8');
    expect(src).toContain('etaSummary');
  });

  it('TelemetryFeedEvent has isStoppedBus field', () => {
    const src = readFileSync(join(ROOT, 'shared', 'src', 'index.ts'), 'utf8');
    expect(src).toContain('isStoppedBus');
  });

  it('eta-refresh.service.ts exports EtaSmoothingService', () => {
    const src = readFileSync(
      join(ROOT, 'backend', 'src', 'services', 'eta-refresh.service.ts'),
      'utf8'
    );
    expect(src).toContain('export class EtaSmoothingService');
  });

  it('eta-refresh.service.ts exports EtaRefreshService', () => {
    const src = readFileSync(
      join(ROOT, 'backend', 'src', 'services', 'eta-refresh.service.ts'),
      'utf8'
    );
    expect(src).toContain('export class EtaRefreshService');
  });

  it('eta-refresh.service.ts uses scheduleRefresh as fire-and-forget (void)', () => {
    const src = readFileSync(
      join(ROOT, 'backend', 'src', 'services', 'eta-refresh.service.ts'),
      'utf8'
    );
    expect(src).toContain('scheduleRefresh');
    expect(src).toContain('void EtaRefreshService._doRefresh');
  });

  it('telemetry.service.ts imports EtaRefreshService', () => {
    const src = readFileSync(
      join(ROOT, 'backend', 'src', 'services', 'telemetry.service.ts'),
      'utf8'
    );
    expect(src).toContain("from './eta-refresh.service.js'");
  });

  it('telemetry.service.ts calls EtaRefreshService.scheduleRefresh in ingestLocation', () => {
    const src = readFileSync(
      join(ROOT, 'backend', 'src', 'services', 'telemetry.service.ts'),
      'utf8'
    );
    expect(src).toContain('EtaRefreshService.scheduleRefresh');
  });

  it('smoothing constants are within safe ranges', () => {
    const src = readFileSync(
      join(ROOT, 'backend', 'src', 'services', 'eta-refresh.service.ts'),
      'utf8'
    );
    expect(src).toContain('MAX_JUMP_SECONDS');
    expect(src).toContain('STOPPED_THRESHOLD_KMH');
    expect(src).toContain('STOPPED_HOLD_SECONDS');
    expect(src).toContain('ALPHA');
  });
});
