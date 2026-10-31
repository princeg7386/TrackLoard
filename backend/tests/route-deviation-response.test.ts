/**
 * Phase 28.3 (Response) -- Route Deviation: Incident Record Tests
 * Tests for: createDeviationIncidentRecord, OPENED hook integration,
 *            incidentRecordId propagation in query results.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks
const { mockQuery, mockSendMessage } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockSendMessage: vi.fn(),
}));

vi.mock('../src/config/database.js', () => ({ query: mockQuery }));

vi.mock('../src/services/messaging/messaging.service.js', () => ({
  MessagingService: { sendMessage: mockSendMessage },
}));

vi.mock('../src/config/env.js', () => ({
  env: {
    JWT_SECRET: 'test-secret',
    MESSAGING_PROVIDER: 'mock',
    DATABASE_URL: 'postgresql://localhost/test',
    PORT: 3001,
    NODE_ENV: 'test',
  },
}));

import { RouteDeviationService } from '../src/services/route-deviation.service.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCHOOL_ID   = '11111111-1111-1111-1111-111111111111';
const TRIP_ID     = '22222222-2222-2222-2222-222222222222';
const BUS_ID      = '33333333-3333-3333-3333-333333333333';
const DRIVER_ID   = '44444444-4444-4444-4444-444444444444';
const DEV_ID      = '55555555-5555-5555-5555-555555555555';
const INCIDENT_ID = '66666666-6666-6666-6666-666666666666';
const ROUTE_ID    = '77777777-7777-7777-7777-777777777777';
const STARTED_AT  = new Date().toISOString();

const baseDevRow = {
  id: DEV_ID,
  school_id: SCHOOL_ID,
  trip_id: TRIP_ID,
  bus_id: BUS_ID,
  driver_id: DRIVER_ID,
  route_id: ROUTE_ID,
  status: 'ACTIVE',
  severity: 'HIGH',
  started_at: STARTED_AT,
  resolved_at: null,
  duration_seconds: 0,
  max_deviation_distance_meters: 650,
  current_deviation_distance_meters: 650,
  threshold_distance_meters: 100,
  debounce_count: 3,
  deviation_latitude: 28.6139,
  deviation_longitude: 77.2090,
  nearest_route_latitude: 28.6120,
  nearest_route_longitude: 77.2080,
  nearest_stop_id: null,
  school_notified_at: null,
  driver_notified_at: null,
  incident_record_id: null,
  notes: null,
};

// ---------------------------------------------------------------------------

describe('Phase 28.3 (Response) -- Route Deviation: Incident Record', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue({ status: 'sent', messageId: 'msg-x' });
  });

  // -------------------------------------------------------------------------
  describe('createDeviationIncidentRecord', () => {
    it('inserts an incidents row and writes back incident_record_id to route_deviations', async () => {
      mockQuery
        .mockResolvedValueOnce([{ id: INCIDENT_ID }])  // INSERT incidents RETURNING id
        .mockResolvedValueOnce([]);                      // UPDATE route_deviations.incident_record_id

      const result = await RouteDeviationService.createDeviationIncidentRecord({
        deviationId: DEV_ID,
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        busId: BUS_ID,
        driverId: DRIVER_ID,
        severity: 'HIGH',
        distanceMeters: 650,
        deviationLat: 28.6139,
        deviationLng: 77.2090,
        startedAt: STARTED_AT,
      });

      expect(result).toBe(INCIDENT_ID);
      expect(mockQuery).toHaveBeenCalledTimes(2);

      // Verify INSERT call contains correct incident_type
      const insertCall = mockQuery.mock.calls[0];
      expect(insertCall[0]).toContain('INSERT INTO incidents');
      expect(insertCall[0]).toContain('ROUTE_DEVIATION');
      expect(insertCall[1]).toContain(SCHOOL_ID);
      expect(insertCall[1]).toContain(TRIP_ID);
      expect(insertCall[1]).toContain(BUS_ID);
      expect(insertCall[1]).toContain(DRIVER_ID);
      expect(insertCall[1]).toContain(28.6139);
      expect(insertCall[1]).toContain(77.2090);

      // Verify UPDATE call links incident_record_id back
      const updateCall = mockQuery.mock.calls[1];
      expect(updateCall[0]).toContain('UPDATE route_deviations');
      expect(updateCall[0]).toContain('incident_record_id');
      expect(updateCall[1]).toContain(INCIDENT_ID);
      expect(updateCall[1]).toContain(DEV_ID);
      expect(updateCall[1]).toContain(SCHOOL_ID);
    });

    it('maps CRITICAL severity to HIGH for incidents table', async () => {
      mockQuery
        .mockResolvedValueOnce([{ id: INCIDENT_ID }])
        .mockResolvedValueOnce([]);

      await RouteDeviationService.createDeviationIncidentRecord({
        deviationId: DEV_ID,
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        busId: BUS_ID,
        driverId: null,
        severity: 'CRITICAL',
        distanceMeters: 1200,
        deviationLat: 28.0,
        deviationLng: 77.0,
        startedAt: STARTED_AT,
      });

      const insertParams = mockQuery.mock.calls[0][1] as unknown[];
      // incidentSeverity should be 'HIGH' not 'CRITICAL'
      expect(insertParams).toContain('HIGH');
      expect(insertParams).not.toContain('CRITICAL');
    });

    it('passes null driver_id when no driver assigned', async () => {
      mockQuery
        .mockResolvedValueOnce([{ id: INCIDENT_ID }])
        .mockResolvedValueOnce([]);

      await RouteDeviationService.createDeviationIncidentRecord({
        deviationId: DEV_ID,
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        busId: BUS_ID,
        driverId: null,
        severity: 'MEDIUM',
        distanceMeters: 300,
        deviationLat: 28.0,
        deviationLng: 77.0,
        startedAt: STARTED_AT,
      });

      const insertParams = mockQuery.mock.calls[0][1] as unknown[];
      expect(insertParams).toContain(null); // driver_id = null
    });

    it('returns null and never throws when DB insert fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB write failed'));

      const result = await RouteDeviationService.createDeviationIncidentRecord({
        deviationId: DEV_ID,
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        busId: BUS_ID,
        driverId: null,
        severity: 'LOW',
        distanceMeters: 150,
        deviationLat: 28.0,
        deviationLng: 77.0,
        startedAt: STARTED_AT,
      });

      expect(result).toBeNull();
    });

    it('returns null and never throws when INSERT returns empty rows', async () => {
      mockQuery.mockResolvedValueOnce([]); // empty result

      const result = await RouteDeviationService.createDeviationIncidentRecord({
        deviationId: DEV_ID,
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        busId: BUS_ID,
        driverId: null,
        severity: 'LOW',
        distanceMeters: 150,
        deviationLat: 28.0,
        deviationLng: 77.0,
        startedAt: STARTED_AT,
      });

      expect(result).toBeNull();
    });

    it('enforces tenant isolation -- school_id in all queries', async () => {
      mockQuery
        .mockResolvedValueOnce([{ id: INCIDENT_ID }])
        .mockResolvedValueOnce([]);

      await RouteDeviationService.createDeviationIncidentRecord({
        deviationId: DEV_ID,
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        busId: BUS_ID,
        driverId: DRIVER_ID,
        severity: 'HIGH',
        distanceMeters: 650,
        deviationLat: 28.6139,
        deviationLng: 77.2090,
        startedAt: STARTED_AT,
      });

      for (const call of mockQuery.mock.calls) {
        expect(call[1]).toContain(SCHOOL_ID);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('getActiveDeviationForTrip -- incidentRecordId field', () => {
    it('returns incidentRecordId when populated in DB', async () => {
      mockQuery.mockResolvedValueOnce([{ ...baseDevRow, incident_record_id: INCIDENT_ID }]);

      const result = await RouteDeviationService.getActiveDeviationForTrip(TRIP_ID);

      expect(result).not.toBeNull();
      expect(result!.incidentRecordId).toBe(INCIDENT_ID);
    });

    it('returns incidentRecordId as null when not yet linked', async () => {
      mockQuery.mockResolvedValueOnce([{ ...baseDevRow, incident_record_id: null }]);

      const result = await RouteDeviationService.getActiveDeviationForTrip(TRIP_ID);

      expect(result).not.toBeNull();
      expect(result!.incidentRecordId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('getActiveDeviationsForSchool -- incidentRecordId field', () => {
    it('returns incidentRecordId for each deviation in list', async () => {
      mockQuery.mockResolvedValueOnce([
        { ...baseDevRow, id: DEV_ID, incident_record_id: INCIDENT_ID },
        { ...baseDevRow, id: '88888888-8888-8888-8888-888888888888', incident_record_id: null },
      ]);

      const results = await RouteDeviationService.getActiveDeviationsForSchool(SCHOOL_ID);

      expect(results).toHaveLength(2);
      expect(results[0]!.incidentRecordId).toBe(INCIDENT_ID);
      expect(results[1]!.incidentRecordId).toBeNull();
    });
  });
});
