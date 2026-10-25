import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeofenceService } from '../src/services/geofence.service.js';
import { SchoolProfileService } from '../src/services/school-profile.service.js';
import { TripService } from '../src/services/trip.service.js';
import { RealtimeFeedService } from '../src/services/realtime-feed.service.js';
import { AuditService } from '../src/services/audit.service.js';
import * as db from '../src/config/database.js';
import { TripStatus } from '@school-bus/shared';

// ---------------------------------------------------------------------------
// Phase 21.2 — School Geofence Engine & Arrival Detection Tests
// Tasks: Create school geofence · Detect school arrival
// ---------------------------------------------------------------------------

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';
const BUS_ID = '33333333-3333-3333-3333-333333333333';

// Delhi Public School R.K. Puram coordinates
const SCHOOL_LAT = 28.5672;
const SCHOOL_LNG = 77.1818;

// School campus polygon boundary
const CAMPUS_POLYGON = [
  { latitude: 28.5680, longitude: 77.1800 },
  { latitude: 28.5680, longitude: 77.1830 },
  { latitude: 28.5660, longitude: 77.1830 },
  { latitude: 28.5660, longitude: 77.1800 },
];

describe('Phase 21.2 — School Geofence Management (Task 1: Create school geofence)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retrieves current school campus geofence configuration', async () => {
    const querySpy = vi.spyOn(db, 'query').mockResolvedValueOnce([
      {
        schoolId: SCHOOL_ID,
        schoolName: 'Delhi Public School',
        latitude: 28.5672,
        longitude: 77.1818,
        geofenceType: 'RADIUS',
        geofenceRadiusMeters: 500,
        geofencePolygon: null,
        autoArrivalEnabled: true,
        updatedAt: '2026-10-25T08:00:00.000Z',
      },
    ]);

    const result = await SchoolProfileService.getSchoolGeofence(SCHOOL_ID);

    expect(result.schoolId).toBe(SCHOOL_ID);
    expect(result.geofenceType).toBe('RADIUS');
    expect(result.geofenceRadiusMeters).toBe(500);
    expect(result.autoArrivalEnabled).toBe(true);
    expect(result.latitude).toBe(28.5672);
    expect(result.longitude).toBe(77.1818);
    expect(querySpy).toHaveBeenCalledTimes(1);
  });

  it('updates school radius geofence and creates audit log', async () => {
    const currentMock = {
      schoolId: SCHOOL_ID,
      schoolName: 'Delhi Public School',
      latitude: 28.5672,
      longitude: 77.1818,
      geofenceType: 'RADIUS' as const,
      geofenceRadiusMeters: 500,
      geofencePolygon: null,
      autoArrivalEnabled: true,
      updatedAt: '2026-10-25T08:00:00.000Z',
    };

    const updatedMock = {
      schoolId: SCHOOL_ID,
      schoolName: 'Delhi Public School',
      latitude: 28.5672,
      longitude: 77.1818,
      geofenceType: 'RADIUS' as const,
      geofenceRadiusMeters: 750,
      geofencePolygon: null,
      autoArrivalEnabled: true,
      updatedAt: '2026-10-25T08:30:00.000Z',
    };

    const querySpy = vi.spyOn(db, 'query')
      .mockResolvedValueOnce([currentMock]) // getSchoolGeofence
      .mockResolvedValueOnce([updatedMock]); // update query

    const auditSpy = vi.spyOn(AuditService, 'logAction').mockResolvedValueOnce('audit-id-123');

    const result = await SchoolProfileService.updateSchoolGeofence(
      SCHOOL_ID,
      {
        geofenceType: 'RADIUS',
        geofenceRadiusMeters: 750,
        autoArrivalEnabled: true,
      },
      'admin-user-001',
      '192.168.1.1'
    );

    expect(result.geofenceRadiusMeters).toBe(750);
    expect(result.geofenceType).toBe('RADIUS');
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        schoolId: SCHOOL_ID,
        action: 'SCHOOL_GEOFENCE_UPDATE',
        entityType: 'SCHOOL',
        entityId: SCHOOL_ID,
      })
    );
  });

  it('updates school polygon geofence boundary', async () => {
    const currentMock = {
      schoolId: SCHOOL_ID,
      schoolName: 'Delhi Public School',
      latitude: 28.5672,
      longitude: 77.1818,
      geofenceType: 'RADIUS' as const,
      geofenceRadiusMeters: 500,
      geofencePolygon: null,
      autoArrivalEnabled: true,
      updatedAt: '2026-10-25T08:00:00.000Z',
    };

    const updatedMock = {
      schoolId: SCHOOL_ID,
      schoolName: 'Delhi Public School',
      latitude: 28.5672,
      longitude: 77.1818,
      geofenceType: 'POLYGON' as const,
      geofenceRadiusMeters: 500,
      geofencePolygon: CAMPUS_POLYGON,
      autoArrivalEnabled: true,
      updatedAt: '2026-10-25T08:35:00.000Z',
    };

    vi.spyOn(db, 'query')
      .mockResolvedValueOnce([currentMock])
      .mockResolvedValueOnce([updatedMock]);
    vi.spyOn(AuditService, 'logAction').mockResolvedValueOnce('audit-id-124');

    const result = await SchoolProfileService.updateSchoolGeofence(
      SCHOOL_ID,
      {
        geofenceType: 'POLYGON',
        geofencePolygon: CAMPUS_POLYGON,
      },
      'admin-user-001'
    );

    expect(result.geofenceType).toBe('POLYGON');
    expect(result.geofencePolygon).toEqual(CAMPUS_POLYGON);
  });

  it('rejects invalid polygon geofence with fewer than 3 vertices', async () => {
    const currentMock = {
      schoolId: SCHOOL_ID,
      schoolName: 'Delhi Public School',
      latitude: 28.5672,
      longitude: 77.1818,
      geofenceType: 'RADIUS' as const,
      geofenceRadiusMeters: 500,
      geofencePolygon: null,
      autoArrivalEnabled: true,
      updatedAt: '2026-10-25T08:00:00.000Z',
    };

    vi.spyOn(db, 'query').mockResolvedValueOnce([currentMock]);

    await expect(
      SchoolProfileService.updateSchoolGeofence(
        SCHOOL_ID,
        {
          geofenceType: 'POLYGON',
          geofencePolygon: [{ latitude: 28.567, longitude: 77.181 }], // only 1 vertex
        },
        'admin-user-001'
      )
    ).rejects.toThrow('Polygon geofence requires at least 3 vertices');
  });
});

describe('Phase 21.2 — School Arrival Detection (Task 2: Detect school arrival)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns arrived: false when bus coordinates are outside destination campus radius', async () => {
    const querySpy = vi.spyOn(db, 'query');

    // 1. Active trip query
    querySpy.mockResolvedValueOnce([{ id: TRIP_ID, status: TripStatus.IN_TRANSIT }]);

    // 2. School geofence query (500m radius)
    querySpy.mockResolvedValueOnce([
      {
        id: SCHOOL_ID,
        name: 'Delhi Public School',
        latitude: SCHOOL_LAT,
        longitude: SCHOOL_LNG,
        geofenceType: 'RADIUS',
        geofenceRadiusMeters: 500,
        geofencePolygon: null,
        autoArrivalEnabled: true,
      },
    ]);

    // Position bus 2km away from school
    const busCoords = { latitude: 28.5500, longitude: 77.1818 };
    const result = await GeofenceService.evaluateSchoolArrival({
      tripId: TRIP_ID,
      schoolId: SCHOOL_ID,
      busId: BUS_ID,
      latitude: busCoords.latitude,
      longitude: busCoords.longitude,
      recordedAt: new Date('2026-10-25T08:20:00.000Z'),
    });

    expect(result.evaluated).toBe(true);
    expect(result.arrived).toBe(false);
    expect(result.distanceMeters).toBeGreaterThan(1000);
  });

  it('detects campus arrival, records SCHOOL_ARRIVAL geofence event, and auto-advances trip status', async () => {
    const querySpy = vi.spyOn(db, 'query');

    // 1. Active trip query
    querySpy.mockResolvedValueOnce([{ id: TRIP_ID, status: TripStatus.IN_TRANSIT }]);

    // 2. School geofence query (500m radius, auto-arrival enabled)
    querySpy.mockResolvedValueOnce([
      {
        id: SCHOOL_ID,
        name: 'Delhi Public School',
        latitude: SCHOOL_LAT,
        longitude: SCHOOL_LNG,
        geofenceType: 'RADIUS',
        geofenceRadiusMeters: 500,
        geofencePolygon: null,
        autoArrivalEnabled: true,
      },
    ]);

    // 3. Existing arrival check (idempotency: none yet)
    querySpy.mockResolvedValueOnce([]);

    // 4. geofence_events INSERT
    querySpy.mockResolvedValueOnce([{ id: 'event-arrival-001' }]);

    const arriveTripSpy = vi.spyOn(TripService, 'arriveAtSchool').mockResolvedValueOnce({
      id: TRIP_ID,
      status: TripStatus.ARRIVED_SCHOOL,
    } as any);

    const publishSpy = vi.spyOn(RealtimeFeedService, 'publish').mockImplementation(() => {});

    // Position bus 150m from school campus center
    const busCoords = { latitude: 28.5678, longitude: 77.1822 };
    const recordedAt = new Date('2026-10-25T08:25:00.000Z');

    const result = await GeofenceService.evaluateSchoolArrival({
      tripId: TRIP_ID,
      schoolId: SCHOOL_ID,
      busId: BUS_ID,
      latitude: busCoords.latitude,
      longitude: busCoords.longitude,
      recordedAt,
    });

    expect(result.evaluated).toBe(true);
    expect(result.arrived).toBe(true);
    expect(result.distanceMeters).toBeLessThan(500);

    // Verify TripService.arriveAtSchool was called to advance trip state
    expect(arriveTripSpy).toHaveBeenCalledWith(
      SCHOOL_ID,
      TRIP_ID,
      expect.objectContaining({
        schoolId: SCHOOL_ID,
        isDriver: false,
        userRole: 'AUTO_GEOFENCE',
      })
    );

    // Verify real-time SSE broadcast
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'GEOFENCE_EVENT',
        eventType: 'ENTRY',
        targetType: 'SCHOOL',
        status: 'ARRIVED_SCHOOL',
        tripId: TRIP_ID,
        schoolId: SCHOOL_ID,
      })
    );
  });

  it('detects campus arrival with custom polygon boundary', async () => {
    const querySpy = vi.spyOn(db, 'query');

    // 1. Active trip query (DELAYED status is also eligible for arrival)
    querySpy.mockResolvedValueOnce([{ id: TRIP_ID, status: TripStatus.DELAYED }]);

    // 2. School geofence query (POLYGON type)
    querySpy.mockResolvedValueOnce([
      {
        id: SCHOOL_ID,
        name: 'Delhi Public School',
        latitude: SCHOOL_LAT,
        longitude: SCHOOL_LNG,
        geofenceType: 'POLYGON',
        geofenceRadiusMeters: 500,
        geofencePolygon: CAMPUS_POLYGON,
        autoArrivalEnabled: true,
      },
    ]);

    // 3. Existing arrival check: none
    querySpy.mockResolvedValueOnce([]);

    // 4. geofence_events INSERT
    querySpy.mockResolvedValueOnce([{ id: 'event-arrival-002' }]);

    const arriveTripSpy = vi.spyOn(TripService, 'arriveAtSchool').mockResolvedValueOnce({
      id: TRIP_ID,
      status: TripStatus.ARRIVED_SCHOOL,
    } as any);

    vi.spyOn(RealtimeFeedService, 'publish').mockImplementation(() => {});

    // Point inside campus polygon
    const insideCoords = { latitude: 28.5670, longitude: 77.1815 };

    const result = await GeofenceService.evaluateSchoolArrival({
      tripId: TRIP_ID,
      schoolId: SCHOOL_ID,
      busId: BUS_ID,
      latitude: insideCoords.latitude,
      longitude: insideCoords.longitude,
      recordedAt: new Date('2026-10-25T08:30:00.000Z'),
    });

    expect(result.evaluated).toBe(true);
    expect(result.arrived).toBe(true);
    expect(arriveTripSpy).toHaveBeenCalledTimes(1);
  });

  it('records arrival but skips trip state advance when autoArrivalEnabled is false', async () => {
    const querySpy = vi.spyOn(db, 'query');

    // 1. Active trip query
    querySpy.mockResolvedValueOnce([{ id: TRIP_ID, status: TripStatus.IN_TRANSIT }]);

    // 2. School geofence query (autoArrivalEnabled: false)
    querySpy.mockResolvedValueOnce([
      {
        id: SCHOOL_ID,
        name: 'Delhi Public School',
        latitude: SCHOOL_LAT,
        longitude: SCHOOL_LNG,
        geofenceType: 'RADIUS',
        geofenceRadiusMeters: 500,
        geofencePolygon: null,
        autoArrivalEnabled: false,
      },
    ]);

    // 3. Existing arrival check
    querySpy.mockResolvedValueOnce([]);

    // 4. geofence_events INSERT
    querySpy.mockResolvedValueOnce([{ id: 'event-arrival-003' }]);

    const arriveTripSpy = vi.spyOn(TripService, 'arriveAtSchool');
    const publishSpy = vi.spyOn(RealtimeFeedService, 'publish').mockImplementation(() => {});

    // Position bus inside campus
    const insideCoords = { latitude: 28.5672, longitude: 77.1818 };

    const result = await GeofenceService.evaluateSchoolArrival({
      tripId: TRIP_ID,
      schoolId: SCHOOL_ID,
      busId: BUS_ID,
      latitude: insideCoords.latitude,
      longitude: insideCoords.longitude,
      recordedAt: new Date('2026-10-25T08:32:00.000Z'),
    });

    expect(result.arrived).toBe(true);
    // Trip status should NOT be automatically advanced
    expect(arriveTripSpy).not.toHaveBeenCalled();
    // Realtime notification was broadcast
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'GEOFENCE_EVENT',
        targetType: 'SCHOOL',
        status: 'INSIDE',
      })
    );
  });

  it('guarantees idempotency when bus coordinates remain inside school campus', async () => {
    const querySpy = vi.spyOn(db, 'query');

    // 1. Active trip query
    querySpy.mockResolvedValueOnce([{ id: TRIP_ID, status: TripStatus.IN_TRANSIT }]);

    // 2. School geofence query
    querySpy.mockResolvedValueOnce([
      {
        id: SCHOOL_ID,
        name: 'Delhi Public School',
        latitude: SCHOOL_LAT,
        longitude: SCHOOL_LNG,
        geofenceType: 'RADIUS',
        geofenceRadiusMeters: 500,
        geofencePolygon: null,
        autoArrivalEnabled: true,
      },
    ]);

    // 3. Existing arrival check: PRIOR EVENT ALREADY EXISTS!
    querySpy.mockResolvedValueOnce([{ id: 'prior-event-001' }]);

    const arriveTripSpy = vi.spyOn(TripService, 'arriveAtSchool');
    const publishSpy = vi.spyOn(RealtimeFeedService, 'publish');

    const result = await GeofenceService.evaluateSchoolArrival({
      tripId: TRIP_ID,
      schoolId: SCHOOL_ID,
      busId: BUS_ID,
      latitude: SCHOOL_LAT,
      longitude: SCHOOL_LNG,
      recordedAt: new Date('2026-10-25T08:35:00.000Z'),
    });

    expect(result.arrived).toBe(true);
    expect(result.reason).toContain('idempotent');
    // Neither DB insert, nor state advance, nor SSE repeat should occur
    expect(arriveTripSpy).not.toHaveBeenCalled();
    expect(publishSpy).not.toHaveBeenCalled();
    // DB queries: only trip check, school check, existing check (3 queries)
    expect(querySpy).toHaveBeenCalledTimes(3);
  });

  it('skips evaluation when trip is already completed or cancelled', async () => {
    const querySpy = vi.spyOn(db, 'query');

    // Trip is COMPLETED
    querySpy.mockResolvedValueOnce([{ id: TRIP_ID, status: TripStatus.COMPLETED }]);

    const result = await GeofenceService.evaluateSchoolArrival({
      tripId: TRIP_ID,
      schoolId: SCHOOL_ID,
      busId: BUS_ID,
      latitude: SCHOOL_LAT,
      longitude: SCHOOL_LNG,
      recordedAt: new Date('2026-10-25T08:40:00.000Z'),
    });

    expect(result.evaluated).toBe(false);
    expect(result.arrived).toBe(false);
    expect(result.reason).toContain('not in transit');
  });

  it('retrieves trip geofence events including school arrival events', async () => {
    const querySpy = vi.spyOn(db, 'query');

    // Trip lookup
    querySpy.mockResolvedValueOnce([{ id: TRIP_ID, school_id: SCHOOL_ID }]);

    // Events list (includes STOP and SCHOOL events)
    querySpy.mockResolvedValueOnce([
      {
        id: 'event-001',
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        busId: BUS_ID,
        stopId: 'stop-001',
        targetType: 'STOP',
        stopName: 'Stop 1',
        sequenceOrder: 1,
        eventType: 'ENTRY',
        distanceToCenterMeters: 45,
        dwellTimeSeconds: 0,
        recordedAt: '2026-10-25T08:10:00.000Z',
        createdAt: '2026-10-25T08:10:01.000Z',
      },
      {
        id: 'event-002',
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        busId: BUS_ID,
        stopId: null,
        targetType: 'SCHOOL',
        stopName: null,
        sequenceOrder: null,
        eventType: 'SCHOOL_ARRIVAL',
        distanceToCenterMeters: 20,
        dwellTimeSeconds: 0,
        recordedAt: '2026-10-25T08:40:00.000Z',
        createdAt: '2026-10-25T08:40:01.000Z',
      },
    ]);

    const events = await GeofenceService.getTripGeofenceEvents(TRIP_ID, SCHOOL_ID);

    expect(events.length).toBe(2);
    expect(events[0]?.targetType).toBe('STOP');
    expect(events[1]?.targetType).toBe('SCHOOL');
    expect(events[1]?.eventType).toBe('SCHOOL_ARRIVAL');
    expect(events[1]?.stopId).toBeNull();
  });
});
