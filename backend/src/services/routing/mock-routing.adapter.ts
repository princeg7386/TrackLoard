import {
  IRoutingProvider,
  GeoCoordinates,
  RouteOptions,
  RouteCalculationResult,
  RouteLeg,
  DistanceMatrixQuery,
  DistanceMatrixResult,
  EtaCalculationQuery,
  EtaCalculationResult,
  SnapToRoadResult,
  calculateHaversineDistanceMeters,
} from '@school-bus/shared';

/**
 * Deterministic Mock Routing Provider for testing and offline environments.
 * Uses exact Haversine geometric calculations and Indian urban bus transit models
 * (average speed ~30 km/h with urban road winding factor 1.25x).
 */
export class MockRoutingAdapter implements IRoutingProvider {
  public readonly providerName = 'MOCK_ROUTING_PROVIDER';

  // Winding factor to approximate actual street road distance from straight line
  private static readonly ROAD_WINDING_FACTOR = 1.25;
  // Default urban school bus speed in India: 30 km/h = 8.33 m/s
  private static readonly DEFAULT_BUS_SPEED_MS = 30 / 3.6;

  async calculateRoute(
    waypoints: GeoCoordinates[],
    options?: RouteOptions
  ): Promise<RouteCalculationResult> {
    if (!waypoints || waypoints.length < 2) {
      throw new Error('At least 2 waypoints are required to calculate a route');
    }

    const legs: RouteLeg[] = [];
    let totalDistanceMeters = 0;
    let totalDurationSeconds = 0;
    const coordinates: [number, number][] = [];

    for (let i = 0; i < waypoints.length - 1; i++) {
      const start = waypoints[i]!;
      const end = waypoints[i + 1]!;

      const straightDistance = calculateHaversineDistanceMeters(start, end);
      const legDistance = Math.round(straightDistance * MockRoutingAdapter.ROAD_WINDING_FACTOR);
      const legDuration = Math.round(legDistance / MockRoutingAdapter.DEFAULT_BUS_SPEED_MS);

      totalDistanceMeters += legDistance;
      totalDurationSeconds += legDuration;

      // Add intermediate interpolated point for polyline smoothness
      coordinates.push([start.latitude, start.longitude]);
      coordinates.push([
        Number(((start.latitude + end.latitude) / 2).toFixed(6)),
        Number(((start.longitude + end.longitude) / 2).toFixed(6)),
      ]);

      legs.push({
        distanceMeters: legDistance,
        durationSeconds: legDuration,
        startLocation: start,
        endLocation: end,
        startAddress: `Stop ${i + 1}`,
        endAddress: `Stop ${i + 2}`,
        steps: [
          {
            instruction: `Depart from Stop ${i + 1} towards Stop ${i + 2}`,
            distanceMeters: legDistance,
            durationSeconds: legDuration,
            startLocation: start,
            endLocation: end,
          },
        ],
      });
    }

    const last = waypoints[waypoints.length - 1]!;
    coordinates.push([last.latitude, last.longitude]);

    // Encode coordinates into a simplified polyline string for storage in routes.path_polyline
    const geometryPolyline = JSON.stringify(coordinates);

    return {
      distanceMeters: totalDistanceMeters,
      durationSeconds: totalDurationSeconds,
      geometryPolyline,
      coordinates,
      legs,
      provider: this.providerName,
    };
  }

  async calculateDistanceMatrix(query: DistanceMatrixQuery): Promise<DistanceMatrixResult> {
    const rows = query.origins.map((origin) => {
      const elements = query.destinations.map((destination) => {
        const straight = calculateHaversineDistanceMeters(origin, destination);
        const distanceMeters = Math.round(straight * MockRoutingAdapter.ROAD_WINDING_FACTOR);
        const durationSeconds = Math.round(distanceMeters / MockRoutingAdapter.DEFAULT_BUS_SPEED_MS);

        return {
          distanceMeters,
          durationSeconds,
          status: 'OK' as const,
        };
      });

      return { elements };
    });

    return {
      rows,
      provider: this.providerName,
    };
  }

  async calculateEta(query: EtaCalculationQuery): Promise<EtaCalculationResult> {
    const straight = calculateHaversineDistanceMeters(query.origin, query.destination);
    const distanceMeters = Math.round(straight * MockRoutingAdapter.ROAD_WINDING_FACTOR);
    const speedMs = (query.averageSpeedKmh || 30) / 3.6;
    const durationSeconds = Math.round(distanceMeters / speedMs);
    const estimatedArrival = new Date(Date.now() + durationSeconds * 1000).toISOString();

    return {
      distanceMeters,
      durationSeconds,
      estimatedArrival,
      provider: this.providerName,
    };
  }

  async snapToRoad(points: GeoCoordinates[]): Promise<SnapToRoadResult> {
    // In mock, points are considered snapped with high confidence
    const snappedPoints = points.map((pt, idx) => ({
      latitude: pt.latitude,
      longitude: pt.longitude,
      originalIndex: idx,
      confidence: 0.98,
    }));

    return {
      snappedPoints,
      provider: this.providerName,
    };
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }
}
