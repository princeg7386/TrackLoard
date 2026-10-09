import { describe, it, expect } from 'vitest';
import {
  calculateHaversineDistanceMeters,
  isPointInGeofence,
  calculateBearingDegrees,
  GeoCoordinates,
} from '@school-bus/shared';
import { SpatialService } from '../src/services/spatial.service.js';

describe('Spatial Location Model & Geofencing Math', () => {
  // Real coordinates in Delhi:
  // Connaught Place: 28.6315° N, 77.2167° E
  // India Gate: 28.6129° N, 77.2295° E
  const connaughtPlace: GeoCoordinates = { latitude: 28.6315, longitude: 77.2167 };
  const indiaGate: GeoCoordinates = { latitude: 28.6129, longitude: 77.2295 };

  it('calculates Haversine distance accurately between two geographical points', () => {
    const distanceMeters = calculateHaversineDistanceMeters(connaughtPlace, indiaGate);
    // Real distance is ~2.4 km (2350m - 2450m)
    expect(distanceMeters).toBeGreaterThan(2300);
    expect(distanceMeters).toBeLessThan(2500);
  });

  it('correctly determines whether a point is within geofence radius', () => {
    // A point 100m away
    const nearStop: GeoCoordinates = { latitude: 28.632, longitude: 77.217 };
    const distanceNear = calculateHaversineDistanceMeters(connaughtPlace, nearStop);
    expect(distanceNear).toBeLessThan(300);
    expect(isPointInGeofence(nearStop, connaughtPlace, 300)).toBe(true);

    // India Gate is > 2000m away from Connaught Place
    expect(isPointInGeofence(indiaGate, connaughtPlace, 300)).toBe(false);
  });

  it('calculates bearing degrees correctly for cardinal directions', () => {
    const pointA: GeoCoordinates = { latitude: 28.0, longitude: 77.0 };
    const pointNorth: GeoCoordinates = { latitude: 29.0, longitude: 77.0 };
    const pointEast: GeoCoordinates = { latitude: 28.0, longitude: 78.0 };
    const pointSouth: GeoCoordinates = { latitude: 27.0, longitude: 77.0 };

    expect(calculateBearingDegrees(pointA, pointNorth)).toBe(0);
    expect(calculateBearingDegrees(pointA, pointEast)).toBe(90);
    expect(calculateBearingDegrees(pointA, pointSouth)).toBe(180);
  });

  it('validates SpatialService SQL helper and in-memory geofence checks', () => {
    const sql = SpatialService.toGeographyPointSql(28.6315, 77.2167);
    expect(sql).toBe('ST_SetSRID(ST_MakePoint(77.2167, 28.6315), 4326)::geography');

    const nearResult = SpatialService.checkGeofenceInMemory(
      { latitude: 28.632, longitude: 77.217 },
      connaughtPlace,
      300
    );
    expect(nearResult.isInside).toBe(true);
    expect(nearResult.distanceMeters).toBeLessThan(300);

    const farResult = SpatialService.checkGeofenceInMemory(
      indiaGate,
      connaughtPlace,
      300
    );
    expect(farResult.isInside).toBe(false);
  });
});
