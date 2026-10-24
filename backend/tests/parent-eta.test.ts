/**
 * Phase 20.4 — Parent ETA Tests
 *
 * Covers:
 *  - ParentPickupEtaSchema shape validation
 *  - Parent-specific ETA extraction from RouteEtaSummary
 *  - Dynamic status transitions (AVAILABLE, APPROACHING, PASSED, UNAVAILABLE)
 *  - Unavailable ETA reasons (TRIP_NOT_STARTED, TRIP_COMPLETED, TRIP_CANCELLED,
 *    STOP_ALREADY_PASSED, NO_STOP_ASSIGNED, STOP_NOT_ON_ROUTE)
 *  - Last updated timestamp tracking
 *  - Route registrations for parent ETA and stop ETA endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ParentPickupEtaSchema,
  ParentEtaStatusSchema,
  ParentEtaUnavailableReasonSchema,
  RouteEtaSummary,
} from '@school-bus/shared';
import { EtaService } from '../src/services/eta.service.js';
import * as db from '../src/config/database.js';

const TRIP_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SCHOOL_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ROUTE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const STOP_ID_1 = '11111111-1111-1111-1111-111111111111';
const STOP_ID_2 = '22222222-2222-2222-2222-222222222222';
const STOP_ID_3 = '33333333-3333-3333-3333-333333333333';

function makeMockSummary(overrides?: Partial<RouteEtaSummary>): RouteEtaSummary {
  const calculatedAt = new Date().toISOString();
  return {
    tripId: TRIP_ID,
    totalRemainingDistanceMeters: 4500,
    totalRemainingDurationSeconds: 650,
    estimatedRouteCompletionAt: new Date(Date.now() + 650000).toISOString(),
    nextStopEta: {
      stopId: STOP_ID_1,
      stopName: 'Stop 1 - City Mall',
      sequenceOrder: 1,
      distanceMeters: 800,
      durationSeconds: 150,
      estimatedArrivalAt: new Date(Date.now() + 150000).toISOString(),
      provider: 'OSRM',
    },
    stopEtas: [
      {
        stopId: STOP_ID_1,
        stopName: 'Stop 1 - City Mall',
        sequenceOrder: 1,
        distanceMeters: 800,
        durationSeconds: 150, // <= 300s -> APPROACHING
        estimatedArrivalAt: new Date(Date.now() + 150000).toISOString(),
        provider: 'OSRM',
      },
      {
        stopId: STOP_ID_2,
        stopName: 'Stop 2 - Green Park',
        sequenceOrder: 2,
        distanceMeters: 2500,
        durationSeconds: 420, // > 300s -> AVAILABLE
        estimatedArrivalAt: new Date(Date.now() + 420000).toISOString(),
        provider: 'OSRM',
      },
      {
        stopId: STOP_ID_3,
        stopName: 'Stop 3 - School Gate',
        sequenceOrder: 3,
        distanceMeters: 4500,
        durationSeconds: 650,
        estimatedArrivalAt: new Date(Date.now() + 650000).toISOString(),
        provider: 'OSRM',
      },
    ],
    effectiveSpeedKmh: 25,
    speedSource: 'rolling_avg',
    calculatedAt,
    ...overrides,
  };
}

describe('Phase 20.4 — Parent ETA Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. ParentPickupEtaSchema Validation', () => {
    it('validates a complete active parent ETA', () => {
      const parsed = ParentPickupEtaSchema.parse({
        tripId: TRIP_ID,
        stopId: STOP_ID_1,
        stopName: 'Stop 1 - City Mall',
        sequenceOrder: 1,
        durationSeconds: 240,
        distanceMeters: 1200,
        etaMinutes: 4,
        estimatedArrivalAt: new Date().toISOString(),
        status: 'AVAILABLE',
        isAvailable: true,
        unavailableReason: null,
        unavailableMessage: null,
        isApproaching: false,
        isPassed: false,
        isStoppedBus: false,
        effectiveSpeedKmh: 20,
        lastUpdatedAt: new Date().toISOString(),
        calculatedAt: new Date().toISOString(),
      });

      expect(parsed.isAvailable).toBe(true);
      expect(parsed.etaMinutes).toBe(4);
      expect(parsed.status).toBe('AVAILABLE');
    });

    it('validates unavailable parent ETA shape with reason', () => {
      const parsed = ParentPickupEtaSchema.parse({
        tripId: TRIP_ID,
        stopId: STOP_ID_1,
        stopName: 'Stop 1',
        sequenceOrder: 1,
        status: 'UNAVAILABLE',
        isAvailable: false,
        unavailableReason: 'TRIP_NOT_STARTED',
        unavailableMessage: 'The bus has not started this trip yet.',
        isApproaching: false,
        isPassed: false,
        lastUpdatedAt: new Date().toISOString(),
        calculatedAt: new Date().toISOString(),
      });

      expect(parsed.isAvailable).toBe(false);
      expect(parsed.status).toBe('UNAVAILABLE');
      expect(parsed.unavailableReason).toBe('TRIP_NOT_STARTED');
    });

    it('rejects invalid status or negative duration', () => {
      expect(() =>
        ParentPickupEtaSchema.parse({
          status: 'INVALID_STATUS',
          isAvailable: true,
          isApproaching: false,
          isPassed: false,
        })
      ).toThrow();

      expect(() =>
        ParentPickupEtaSchema.parse({
          status: 'AVAILABLE',
          isAvailable: true,
          durationSeconds: -10,
          isApproaching: false,
          isPassed: false,
        })
      ).toThrow();
    });
  });

  describe('2. extractParentEtaFromSummary', () => {
    it('extracts approaching stop ETA (<= 300s or within geofence)', () => {
      const summary = makeMockSummary();
      const parentEta = EtaService.extractParentEtaFromSummary(summary, STOP_ID_1, 'Stop 1', 1, 500);

      expect(parentEta.isAvailable).toBe(true);
      expect(parentEta.status).toBe('APPROACHING');
      expect(parentEta.isApproaching).toBe(true);
      expect(parentEta.isPassed).toBe(false);
      expect(parentEta.etaMinutes).toBe(3); // 150 / 60 = 2.5 -> 3
      expect(parentEta.distanceMeters).toBe(800);
      expect(parentEta.lastUpdatedAt).toBe(summary.calculatedAt);
    });

    it('extracts available en-route stop ETA (> 300s)', () => {
      const summary = makeMockSummary();
      const parentEta = EtaService.extractParentEtaFromSummary(summary, STOP_ID_2, 'Stop 2', 2, 300);

      expect(parentEta.isAvailable).toBe(true);
      expect(parentEta.status).toBe('AVAILABLE');
      expect(parentEta.isApproaching).toBe(false);
      expect(parentEta.etaMinutes).toBe(7); // 420 / 60 = 7
      expect(parentEta.distanceMeters).toBe(2500);
    });

    it('marks stopped bus correctly when speed <= 2 km/h', () => {
      const summary = makeMockSummary({ effectiveSpeedKmh: 1 });
      const parentEta = EtaService.extractParentEtaFromSummary(summary, STOP_ID_2);

      expect(parentEta.isStoppedBus).toBe(true);
    });

    it('returns pending unavailable when stop is not found in summary', () => {
      const summary = makeMockSummary();
      const unknownStopId = '99999999-9999-9999-9999-999999999999';
      const parentEta = EtaService.extractParentEtaFromSummary(summary, unknownStopId, 'Unknown');

      expect(parentEta.isAvailable).toBe(false);
      expect(parentEta.status).toBe('UNAVAILABLE');
      expect(parentEta.unavailableReason).toBe('CALCULATION_PENDING');
      expect(parentEta.durationSeconds).toBeNull();
    });
  });

  describe('3. getUnavailableParentEta helper', () => {
    it('constructs an unavailable record with specified reason and message', () => {
      const eta = EtaService.getUnavailableParentEta(
        'GPS_UNAVAILABLE',
        'Waiting for bus GPS location to calculate live arrival time.',
        { tripId: TRIP_ID, stopId: STOP_ID_1, stopName: 'Stop 1' }
      );

      expect(eta.isAvailable).toBe(false);
      expect(eta.status).toBe('UNAVAILABLE');
      expect(eta.unavailableReason).toBe('GPS_UNAVAILABLE');
      expect(eta.unavailableMessage).toContain('Waiting for bus GPS');
      expect(eta.lastUpdatedAt).toBeTruthy();
    });

    it('constructs a PASSED status when reason is STOP_ALREADY_PASSED', () => {
      const eta = EtaService.getUnavailableParentEta(
        'STOP_ALREADY_PASSED',
        'The bus has already passed your pickup stop.',
        { tripId: TRIP_ID, stopId: STOP_ID_1 }
      );

      expect(eta.isAvailable).toBe(false);
      expect(eta.status).toBe('PASSED');
      expect(eta.isPassed).toBe(true);
    });
  });

  describe('4. calculateParentEta domain logic', () => {
    it('returns NO_STOP_ASSIGNED when stopId is not provided', async () => {
      const eta = await EtaService.calculateParentEta({
        tripId: TRIP_ID,
        schoolId: SCHOOL_ID,
        stopId: null,
      });

      expect(eta.isAvailable).toBe(false);
      expect(eta.status).toBe('UNAVAILABLE');
      expect(eta.unavailableReason).toBe('NO_STOP_ASSIGNED');
    });

    it('throws NotFoundError when trip does not exist', async () => {
      vi.spyOn(db, 'query').mockResolvedValueOnce([]); // no trip rows

      await expect(
        EtaService.calculateParentEta({
          tripId: TRIP_ID,
          schoolId: SCHOOL_ID,
          stopId: STOP_ID_1,
        })
      ).rejects.toThrow('not found');
    });

    it('returns TRIP_NOT_STARTED when trip status is SCHEDULED', async () => {
      vi.spyOn(db, 'query').mockResolvedValueOnce([
        {
          id: TRIP_ID,
          school_id: SCHOOL_ID,
          bus_id: 'bus-1',
          route_id: ROUTE_ID,
          status: 'SCHEDULED',
          current_stop_sequence: 0,
          actual_start_time: null,
        },
      ]);

      const eta = await EtaService.calculateParentEta({
        tripId: TRIP_ID,
        schoolId: SCHOOL_ID,
        stopId: STOP_ID_1,
      });

      expect(eta.isAvailable).toBe(false);
      expect(eta.status).toBe('UNAVAILABLE');
      expect(eta.unavailableReason).toBe('TRIP_NOT_STARTED');
    });

    it('returns TRIP_COMPLETED when trip status is COMPLETED', async () => {
      vi.spyOn(db, 'query').mockResolvedValueOnce([
        {
          id: TRIP_ID,
          school_id: SCHOOL_ID,
          bus_id: 'bus-1',
          route_id: ROUTE_ID,
          status: 'COMPLETED',
          current_stop_sequence: 5,
          actual_start_time: '2026-10-25T07:00:00Z',
        },
      ]);

      const eta = await EtaService.calculateParentEta({
        tripId: TRIP_ID,
        schoolId: SCHOOL_ID,
        stopId: STOP_ID_1,
      });

      expect(eta.isAvailable).toBe(false);
      expect(eta.status).toBe('UNAVAILABLE');
      expect(eta.unavailableReason).toBe('TRIP_COMPLETED');
    });

    it('returns STOP_NOT_ON_ROUTE when stop belongs to a different route', async () => {
      vi.spyOn(db, 'query')
        .mockResolvedValueOnce([
          {
            id: TRIP_ID,
            school_id: SCHOOL_ID,
            bus_id: 'bus-1',
            route_id: ROUTE_ID,
            status: 'IN_TRANSIT',
            current_stop_sequence: 0,
            actual_start_time: '2026-10-25T07:00:00Z',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: STOP_ID_1,
            route_id: 'different-route-id',
            stop_name: 'Stop 1',
            sequence_order: 1,
            latitude: 12.97,
            longitude: 77.59,
            geofence_radius_meters: 300,
            scheduled_time: '07:30:00',
          },
        ]);

      const eta = await EtaService.calculateParentEta({
        tripId: TRIP_ID,
        schoolId: SCHOOL_ID,
        stopId: STOP_ID_1,
      });

      expect(eta.isAvailable).toBe(false);
      expect(eta.unavailableReason).toBe('STOP_NOT_ON_ROUTE');
    });

    it('returns STOP_ALREADY_PASSED when stop sequence <= current sequence', async () => {
      vi.spyOn(db, 'query')
        .mockResolvedValueOnce([
          {
            id: TRIP_ID,
            school_id: SCHOOL_ID,
            bus_id: 'bus-1',
            route_id: ROUTE_ID,
            status: 'IN_TRANSIT',
            current_stop_sequence: 2, // Bus is already at stop 2
            actual_start_time: '2026-10-25T07:00:00Z',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: STOP_ID_1,
            route_id: ROUTE_ID,
            stop_name: 'Stop 1 - City Mall',
            sequence_order: 1, // Stop 1 <= current sequence 2
            latitude: 12.97,
            longitude: 77.59,
            geofence_radius_meters: 300,
            scheduled_time: '07:15:00',
          },
        ]);

      const eta = await EtaService.calculateParentEta({
        tripId: TRIP_ID,
        schoolId: SCHOOL_ID,
        stopId: STOP_ID_1,
      });

      expect(eta.isAvailable).toBe(false);
      expect(eta.status).toBe('PASSED');
      expect(eta.isPassed).toBe(true);
      expect(eta.unavailableReason).toBe('STOP_ALREADY_PASSED');
      expect(eta.unavailableMessage).toContain('already passed');
    });

    it('calculates parent ETA for upcoming stop using provided cached summary', async () => {
      const mockSummary = makeMockSummary();

      vi.spyOn(db, 'query')
        .mockResolvedValueOnce([
          {
            id: TRIP_ID,
            school_id: SCHOOL_ID,
            bus_id: 'bus-1',
            route_id: ROUTE_ID,
            status: 'IN_TRANSIT',
            current_stop_sequence: 0,
            actual_start_time: '2026-10-25T07:00:00Z',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: STOP_ID_2,
            route_id: ROUTE_ID,
            stop_name: 'Stop 2 - Green Park',
            sequence_order: 2,
            latitude: 12.98,
            longitude: 77.6,
            geofence_radius_meters: 300,
            scheduled_time: '07:35:00',
          },
        ]);

      const eta = await EtaService.calculateParentEta({
        tripId: TRIP_ID,
        schoolId: SCHOOL_ID,
        stopId: STOP_ID_2,
        cachedSummary: mockSummary,
      });

      expect(eta.isAvailable).toBe(true);
      expect(eta.stopId).toBe(STOP_ID_2);
      expect(eta.stopName).toBe('Stop 2 - Green Park');
      expect(eta.sequenceOrder).toBe(2);
      expect(eta.durationSeconds).toBe(420);
      expect(eta.distanceMeters).toBe(2500);
      expect(eta.etaMinutes).toBe(7);
      expect(eta.status).toBe('AVAILABLE');
      expect(eta.isApproaching).toBe(false);
    });
  });

  describe('5. Route & API Integrations', () => {
    it('verifies parent-identity route file has /eta and /eta/:token', () => {
      const routesFile = readFileSync(
        join(__dirname, '..', 'src', 'routes', 'parent-identity.routes.ts'),
        'utf8'
      );
      expect(routesFile).toContain("'/eta/:token'");
      expect(routesFile).toContain("'/eta'");
      expect(routesFile).toContain('authenticateParentTrackingToken');
      expect(routesFile).toContain('ParentIdentityController.getParentEta');
    });

    it('verifies telemetry route file has /trips/:tripId/eta/stops/:stopId', () => {
      const routesFile = readFileSync(
        join(__dirname, '..', 'src', 'routes', 'telemetry.routes.ts'),
        'utf8'
      );
      expect(routesFile).toContain("'/trips/:tripId/eta/stops/:stopId'");
      expect(routesFile).toContain('TelemetryController.getStopEta');
    });
  });
});
