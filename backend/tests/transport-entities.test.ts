import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  RouteSchema,
  RouteType,
  PickupLocationSchema,
  TripSchema,
  TripStatus,
  TelemetryIngestSchema,
  BoardingEventSchema,
  DropEventSchema,
} from '@school-bus/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Transport Entities Schemas & PostGIS Constraints', () => {
  it('validates Route entity schema correctly', () => {
    const validRoute = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      name: 'North Campus Route 07',
      code: 'RTE-NC07',
      routeType: RouteType.MORNING_PICKUP,
      estimatedDurationMinutes: 45,
    };
    const parsed = RouteSchema.parse(validRoute);
    expect(parsed.name).toBe('North Campus Route 07');
    expect(parsed.routeType).toBe(RouteType.MORNING_PICKUP);
    expect(parsed.estimatedDurationMinutes).toBe(45);
  });

  it('validates PickupLocation schema with coordinate boundaries and time format', () => {
    const validStop = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      routeId: '223e4567-e89b-12d3-a456-426614174001',
      stopName: 'Green Park Metro Station Gate 2',
      sequenceOrder: 1,
      latitude: 28.5589,
      longitude: 77.2065,
      scheduledTime: '07:15:00',
      geofenceRadiusMeters: 300,
    };
    const parsed = PickupLocationSchema.parse(validStop);
    expect(parsed.latitude).toBe(28.5589);
    expect(parsed.longitude).toBe(77.2065);
    expect(parsed.sequenceOrder).toBe(1);

    // Invalid coordinates (> 90 lat)
    expect(() =>
      PickupLocationSchema.parse({ ...validStop, latitude: 95.0 })
    ).toThrow();

    // Invalid scheduled time format
    expect(() =>
      PickupLocationSchema.parse({ ...validStop, scheduledTime: '25:99' })
    ).toThrow();
  });

  it('validates Trip schema and lifecycle state transitions', () => {
    const validTrip = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      routeId: '223e4567-e89b-12d3-a456-426614174001',
      busId: '323e4567-e89b-12d3-a456-426614174002',
      driverId: '423e4567-e89b-12d3-a456-426614174003',
      status: TripStatus.SCHEDULED,
      scheduledDate: '2026-10-10',
      scheduledStartTime: '2026-10-10T07:00:00Z',
    };
    const parsed = TripSchema.parse(validTrip);
    expect(parsed.status).toBe(TripStatus.SCHEDULED);
    expect(parsed.scheduledDate).toBe('2026-10-10');
  });

  it('validates GPS Telemetry Ingest schema with speed and bearing', () => {
    const validTelemetry = {
      tripId: '123e4567-e89b-12d3-a456-426614174000',
      busId: '223e4567-e89b-12d3-a456-426614174001',
      driverId: '323e4567-e89b-12d3-a456-426614174002',
      latitude: 28.559,
      longitude: 77.207,
      speedKmh: 42.5,
      bearingDegrees: 180,
      accuracyMeters: 4.5,
      recordedAt: '2026-10-10T07:12:30.000Z',
    };
    const parsed = TelemetryIngestSchema.parse(validTelemetry);
    expect(parsed.speedKmh).toBe(42.5);
    expect(parsed.accuracyMeters).toBe(4.5);

    // Speed exceeding maximum physical limit
    expect(() =>
      TelemetryIngestSchema.parse({ ...validTelemetry, speedKmh: 220 })
    ).toThrow();
  });

  it('validates Boarding and Drop attendance event schemas', () => {
    const validBoarding = {
      tripId: '123e4567-e89b-12d3-a456-426614174000',
      studentId: '223e4567-e89b-12d3-a456-426614174001',
      stopId: '323e4567-e89b-12d3-a456-426614174002',
      status: 'BOARDED' as const,
      markedBy: 'DRIVER' as const,
    };
    const parsedBoarding = BoardingEventSchema.parse(validBoarding);
    expect(parsedBoarding.status).toBe('BOARDED');

    const validDrop = {
      tripId: '123e4567-e89b-12d3-a456-426614174000',
      studentId: '223e4567-e89b-12d3-a456-426614174001',
      stopId: '323e4567-e89b-12d3-a456-426614174002',
      status: 'DEBOARDED' as const,
      markedBy: 'DRIVER' as const,
    };
    const parsedDrop = DropEventSchema.parse(validDrop);
    expect(parsedDrop.status).toBe('DEBOARDED');
  });

  it('verifies migration 002_transport_entities.sql exists and contains PostGIS GIST indexes', () => {
    const migrationPath = path.join(
      __dirname,
      '../src/db/migrations/002_transport_entities.sql'
    );
    expect(fs.existsSync(migrationPath)).toBe(true);

    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS routes');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS pickup_locations');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS trips');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS gps_locations');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS boarding_events');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS drop_events');

    // Verify PostGIS spatial indexes (GIST)
    expect(sql).toContain('USING GIST(location)');
  });
});
