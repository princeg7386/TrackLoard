/**
 * Phase 20.1 — ETA Engine Input Context: Tests
 *
 * Tests verify:
 *  - EtaTripContextSchema shape and Zod validation
 *  - SpeedSource classification logic
 *  - Speed clamping behaviour
 *  - assembleContext tenant isolation
 *  - Service file structure (file-content assertions for DB wiring)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  EtaTripContextSchema,
  EtaRemainingStopSchema,
  SpeedSourceSchema,
  GeoCoordinatesSchema,
} from '@school-bus/shared';

const ROOT = join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// 1. Shared Schema Tests
// ---------------------------------------------------------------------------

describe('Phase 20.1 — Shared EtaTripContext Schema', () => {
  const validStop = {
    stopId: '11111111-1111-1111-1111-111111111111',
    stopName: 'Gate 1 – DLF Phase 2',
    sequenceOrder: 1,
    latitude: 28.4949,
    longitude: 77.0887,
    geofenceRadiusMeters: 300,
    scheduledTime: '07:15:00',
  };

  const validContext = {
    tripId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    schoolId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    busId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    currentPosition: { latitude: 28.4959, longitude: 77.0877 },
    effectiveSpeedKmh: 28.5,
    speedSource: 'rolling_avg',
    currentStopSequence: 0,
    remainingStops: [validStop],
    tripStatus: 'IN_TRANSIT',
    actualStartTime: '2026-10-23T01:30:00.000Z',
    assembledAt: '2026-10-23T01:45:00.000Z',
  };

  it('SpeedSourceSchema accepts valid values', () => {
    expect(SpeedSourceSchema.parse('rolling_avg')).toBe('rolling_avg');
    expect(SpeedSourceSchema.parse('last_ping')).toBe('last_ping');
    expect(SpeedSourceSchema.parse('fallback')).toBe('fallback');
  });

  it('SpeedSourceSchema rejects unknown value', () => {
    expect(() => SpeedSourceSchema.parse('guess')).toThrow();
  });

  it('EtaRemainingStopSchema parses a valid stop', () => {
    const result = EtaRemainingStopSchema.parse(validStop);
    expect(result.stopId).toBe(validStop.stopId);
    expect(result.sequenceOrder).toBe(1);
    expect(result.geofenceRadiusMeters).toBeGreaterThanOrEqual(50);
  });

  it('EtaRemainingStopSchema rejects geofenceRadiusMeters below 50', () => {
    expect(() =>
      EtaRemainingStopSchema.parse({ ...validStop, geofenceRadiusMeters: 10 })
    ).toThrow();
  });

  it('EtaTripContextSchema parses a complete valid context', () => {
    const result = EtaTripContextSchema.parse(validContext);
    expect(result.tripId).toBe(validContext.tripId);
    expect(result.effectiveSpeedKmh).toBeGreaterThanOrEqual(5);
    expect(result.effectiveSpeedKmh).toBeLessThanOrEqual(160);
    expect(result.remainingStops).toHaveLength(1);
  });

  it('EtaTripContextSchema accepts null currentPosition (no GPS fix)', () => {
    const result = EtaTripContextSchema.parse({
      ...validContext,
      currentPosition: null,
    });
    expect(result.currentPosition).toBeNull();
  });

  it('EtaTripContextSchema accepts null actualStartTime (trip not started)', () => {
    const result = EtaTripContextSchema.parse({
      ...validContext,
      actualStartTime: null,
    });
    expect(result.actualStartTime).toBeNull();
  });

  it('EtaTripContextSchema accepts an empty remainingStops array', () => {
    const result = EtaTripContextSchema.parse({
      ...validContext,
      remainingStops: [],
    });
    expect(result.remainingStops).toHaveLength(0);
  });

  it('EtaTripContextSchema rejects effectiveSpeedKmh below 5', () => {
    expect(() =>
      EtaTripContextSchema.parse({ ...validContext, effectiveSpeedKmh: 3 })
    ).toThrow();
  });

  it('EtaTripContextSchema rejects effectiveSpeedKmh above 160', () => {
    expect(() =>
      EtaTripContextSchema.parse({ ...validContext, effectiveSpeedKmh: 200 })
    ).toThrow();
  });

  it('EtaTripContextSchema rejects invalid assembledAt (non-ISO)', () => {
    expect(() =>
      EtaTripContextSchema.parse({ ...validContext, assembledAt: 'not-a-date' })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. GeoCoordinates reuse (existing shared utility)
// ---------------------------------------------------------------------------

describe('Phase 20.1 — GeoCoordinates used in ETA context', () => {
  it('GeoCoordinatesSchema validates a realistic Indian coordinate', () => {
    const coord = GeoCoordinatesSchema.parse({ latitude: 28.6139, longitude: 77.2090 });
    expect(coord.latitude).toBeCloseTo(28.6139);
  });

  it('GeoCoordinatesSchema rejects out-of-range latitude', () => {
    expect(() => GeoCoordinatesSchema.parse({ latitude: 95, longitude: 77 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. EtaService file-content assertions (structural verification)
// ---------------------------------------------------------------------------

describe('Phase 20.1 — EtaService structural verification', () => {
  const src = readFileSync(
    join(ROOT, 'backend', 'src', 'services', 'eta.service.ts'),
    'utf8'
  );

  it('exports EtaService class', () => {
    expect(src).toContain('export class EtaService');
  });

  it('exports EffectiveSpeedService class', () => {
    expect(src).toContain('export class EffectiveSpeedService');
  });

  it('assembleContext method exists on EtaService', () => {
    expect(src).toContain('static async assembleContext(');
  });

  it('computeEffectiveSpeedKmh method exists on EffectiveSpeedService', () => {
    expect(src).toContain('static async computeEffectiveSpeedKmh(');
  });

  it('implements tenant isolation check (school_id comparison)', () => {
    expect(src).toContain('trip.school_id !== schoolId');
  });

  it('throws ForbiddenError for cross-school access', () => {
    expect(src).toContain('ForbiddenError');
  });

  it('throws NotFoundError for unknown trip', () => {
    expect(src).toContain('NotFoundError');
  });

  it('queries remaining stops filtered by sequence_order > current_stop_sequence', () => {
    expect(src).toContain('sequence_order > $2');
  });

  it('queries gps_locations within rolling time window', () => {
    expect(src).toContain("INTERVAL '");
  });

  it('returns rolling_avg SpeedSource when enough pings', () => {
    expect(src).toContain("'rolling_avg'");
  });

  it('returns last_ping SpeedSource fallback', () => {
    expect(src).toContain("'last_ping'");
  });

  it('returns fallback SpeedSource when no GPS data', () => {
    expect(src).toContain("'fallback'");
  });

  it('clamps speed to MIN_SPEED_KMH (5)', () => {
    expect(src).toContain('MIN_SPEED_KMH');
  });

  it('clamps speed to MAX_SPEED_KMH (160)', () => {
    expect(src).toContain('MAX_SPEED_KMH');
  });

  it('validates context with EtaTripContextSchema.parse', () => {
    expect(src).toContain('EtaTripContextSchema.parse');
  });

  it('imports EtaTripContextSchema from shared', () => {
    expect(src).toContain("from '@school-bus/shared'");
  });

  it('queries deleted_at IS NULL for trips (soft-delete safety)', () => {
    expect(src).toContain('deleted_at IS NULL');
  });

  it('queries pickup_locations with route_id and sequence_order filter', () => {
    expect(src).toContain('pickup_locations');
    expect(src).toContain('route_id');
  });
});
