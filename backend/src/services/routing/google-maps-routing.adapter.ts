import {
  IRoutingProvider,
  GeoCoordinates,
  RouteOptions,
  RouteCalculationResult,
  DistanceMatrixQuery,
  DistanceMatrixResult,
  EtaCalculationQuery,
  EtaCalculationResult,
  SnapToRoadResult,
} from '@school-bus/shared';
import { ValhallaRoutingAdapter } from './valhalla-routing.adapter.js';
import { MockRoutingAdapter } from './mock-routing.adapter.js';
import { MapUsageTracker } from '../maps/map-usage-tracker.service.js';

/**
 * Commercial Google Maps Routing Provider Adapter with Graceful Open-Source Fallback.
 * Allows seamless activation of Google Maps Platform when an API key is provided,
 * while automatically falling back to Valhalla / OSRM / Mock when keys are unconfigured
 * or external Google APIs encounter network/quota errors.
 */
export class GoogleMapsRoutingAdapter implements IRoutingProvider {
  public readonly providerName = 'GOOGLE_MAPS_ROUTING_PROVIDER';

  private readonly apiKey: string;
  private readonly fallbackAdapter: IRoutingProvider;
  private readonly emergencyMockAdapter: IRoutingProvider;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GOOGLE_MAPS_API_KEY || '';
    this.fallbackAdapter = new ValhallaRoutingAdapter();
    this.emergencyMockAdapter = new MockRoutingAdapter();
  }

  public hasValidKey(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 10);
  }

  public async isHealthy(): Promise<boolean> {
    if (!this.hasValidKey()) {
      return this.fallbackAdapter.isHealthy();
    }
    return true;
  }

  public async calculateRoute(
    waypoints: GeoCoordinates[],
    options?: RouteOptions
  ): Promise<RouteCalculationResult> {
    const startTime = Date.now();

    // 1. If key is missing or invalid, immediately use fallback
    if (!this.hasValidKey()) {
      const fallbackResult = await this.fallbackAdapter.calculateRoute(waypoints, options);
      MapUsageTracker.record({
        schoolId: 'system',
        provider: this.providerName,
        operation: 'route_calculate',
        status: 'fallback',
        fallbackProvider: fallbackResult.provider,
        latencyMs: Date.now() - startTime,
        isPaidProvider: false,
      });
      return {
        ...fallbackResult,
        provider: `${this.providerName}_FALLBACK_${fallbackResult.provider}`,
      };
    }

    // 2. Key is present — attempt Google Directions API call
    try {
      const origin = `${waypoints[0]!.latitude},${waypoints[0]!.longitude}`;
      const destination = `${waypoints[waypoints.length - 1]!.latitude},${waypoints[waypoints.length - 1]!.longitude}`;
      let intermediateWaypoints = '';

      if (waypoints.length > 2) {
        const intermediate = waypoints.slice(1, -1).map((w) => `${w.latitude},${w.longitude}`).join('|');
        intermediateWaypoints = `&waypoints=${encodeURIComponent(intermediate)}`;
      }

      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(
        origin
      )}&destination=${encodeURIComponent(destination)}${intermediateWaypoints}&mode=driving&departure_time=now&key=${this.apiKey}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Google Maps API responded with HTTP status ${response.status}`);
      }

      const data = (await response.json()) as any;

      if (data.status !== 'OK' || !data.routes || data.routes.length === 0) {
        throw new Error(`Google Directions API error status: ${data.status || 'NO_ROUTES'}`);
      }

      const route = data.routes[0];
      let totalDistance = 0;
      let totalDuration = 0;
      const legs: RouteCalculationResult['legs'] = [];

      for (const leg of route.legs || []) {
        totalDistance += leg.distance?.value || 0;
        totalDuration += leg.duration_in_traffic?.value || leg.duration?.value || 0;
        legs.push({
          distanceMeters: leg.distance?.value || 0,
          durationSeconds: leg.duration_in_traffic?.value || leg.duration?.value || 0,
          startLocation: {
            latitude: leg.start_location?.lat || waypoints[0]!.latitude,
            longitude: leg.start_location?.lng || waypoints[0]!.longitude,
          },
          endLocation: {
            latitude: leg.end_location?.lat || waypoints[waypoints.length - 1]!.latitude,
            longitude: leg.end_location?.lng || waypoints[waypoints.length - 1]!.longitude,
          },
        });
      }

      MapUsageTracker.record({
        schoolId: 'system',
        provider: this.providerName,
        operation: 'route_calculate',
        status: 'success',
        latencyMs: Date.now() - startTime,
        isPaidProvider: true,
      });

      const coordinates: [number, number][] = waypoints.map((w): [number, number] => [w.latitude, w.longitude]);

      return {
        distanceMeters: totalDistance,
        durationSeconds: totalDuration,
        geometryPolyline: route.overview_polyline?.points || '',
        coordinates,
        legs,
        provider: this.providerName,
      };
    } catch (err: any) {
      // 3. Graceful fallback on Google API failure/timeout/quota exhaustion
      const fallbackResult = await this.fallbackAdapter.calculateRoute(waypoints, options);
      MapUsageTracker.record({
        schoolId: 'system',
        provider: this.providerName,
        operation: 'route_calculate',
        status: 'fallback',
        fallbackProvider: fallbackResult.provider,
        latencyMs: Date.now() - startTime,
        isPaidProvider: false,
      });

      return {
        ...fallbackResult,
        provider: `${this.providerName}_FALLBACK_${fallbackResult.provider}`,
      };
    }
  }

  public async calculateDistanceMatrix(
    matrixQuery: DistanceMatrixQuery
  ): Promise<DistanceMatrixResult> {
    const startTime = Date.now();

    if (!this.hasValidKey()) {
      const fallbackResult = await this.fallbackAdapter.calculateDistanceMatrix(matrixQuery);
      MapUsageTracker.record({
        schoolId: 'system',
        provider: this.providerName,
        operation: 'distance_matrix',
        status: 'fallback',
        fallbackProvider: fallbackResult.provider,
        latencyMs: Date.now() - startTime,
        isPaidProvider: false,
      });
      return {
        ...fallbackResult,
        provider: `${this.providerName}_FALLBACK_${fallbackResult.provider}`,
      };
    }

    try {
      // Google Distance Matrix API call
      const origins = matrixQuery.origins.map((o) => `${o.latitude},${o.longitude}`).join('|');
      const destinations = matrixQuery.destinations.map((d) => `${d.latitude},${d.longitude}`).join('|');
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(
        origins
      )}&destinations=${encodeURIComponent(destinations)}&mode=driving&departure_time=now&key=${this.apiKey}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`Google Distance Matrix HTTP ${response.status}`);
      const data = (await response.json()) as any;

      if (data.status !== 'OK') throw new Error(`Google Matrix status: ${data.status}`);

      const rows: DistanceMatrixResult['rows'] = [];

      for (const row of data.rows || []) {
        const elements: DistanceMatrixResult['rows'][0]['elements'] = [];
        for (const elem of row.elements || []) {
          elements.push({
            status: elem.status === 'OK' ? 'OK' : 'FAIL',
            distanceMeters: elem.distance?.value || 0,
            durationSeconds: elem.duration_in_traffic?.value || elem.duration?.value || 0,
          });
        }
        rows.push({ elements });
      }

      MapUsageTracker.record({
        schoolId: 'system',
        provider: this.providerName,
        operation: 'distance_matrix',
        status: 'success',
        latencyMs: Date.now() - startTime,
        isPaidProvider: true,
      });

      return {
        rows,
        provider: this.providerName,
      };
    } catch {
      const fallbackResult = await this.fallbackAdapter.calculateDistanceMatrix(matrixQuery);
      MapUsageTracker.record({
        schoolId: 'system',
        provider: this.providerName,
        operation: 'distance_matrix',
        status: 'fallback',
        fallbackProvider: fallbackResult.provider,
        latencyMs: Date.now() - startTime,
        isPaidProvider: false,
      });
      return {
        ...fallbackResult,
        provider: `${this.providerName}_FALLBACK_${fallbackResult.provider}`,
      };
    }
  }

  public async calculateEta(query: EtaCalculationQuery): Promise<EtaCalculationResult> {
    const startTime = Date.now();
    try {
      const route = await this.calculateRoute([query.origin, query.destination], {
        mode: 'bus',
      });

      const arrivalTime = new Date(Date.now() + route.durationSeconds * 1000).toISOString();

      return {
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        estimatedArrival: arrivalTime,
        provider: route.provider,
      };
    } catch {
      const mockResult = await this.emergencyMockAdapter.calculateEta(query);
      MapUsageTracker.record({
        schoolId: 'system',
        provider: this.providerName,
        operation: 'eta',
        status: 'fallback',
        fallbackProvider: mockResult.provider,
        latencyMs: Date.now() - startTime,
        isPaidProvider: false,
      });
      return mockResult;
    }
  }

  public async snapToRoad(points: GeoCoordinates[]): Promise<SnapToRoadResult> {
    const startTime = Date.now();
    // Default to Valhalla or Mock snap
    const fallbackResult = await this.fallbackAdapter.snapToRoad(points);
    MapUsageTracker.record({
      schoolId: 'system',
      provider: this.providerName,
      operation: 'snap_to_road',
      status: 'fallback',
      fallbackProvider: fallbackResult.provider,
      latencyMs: Date.now() - startTime,
      isPaidProvider: false,
    });
    return fallbackResult;
  }
}
