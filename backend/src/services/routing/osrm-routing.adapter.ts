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
} from '@school-bus/shared';
import { logger } from '../logger.service.js';
import { MockRoutingAdapter } from './mock-routing.adapter.js';

/**
 * Open Source Routing Machine (OSRM) Provider Adapter.
 * Uses OSRM HTTP API for high-precision turn-by-turn routing and road snapping.
 * Includes automatic fallback to MockRoutingAdapter when offline or in test environments.
 */
export class OsrmRoutingAdapter implements IRoutingProvider {
  public readonly providerName = 'OSRM_ROUTING_PROVIDER';
  private baseUrl: string;
  private fallbackAdapter: MockRoutingAdapter;

  constructor(
    baseUrl: string = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org'
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fallbackAdapter = new MockRoutingAdapter();
  }

  async calculateRoute(
    waypoints: GeoCoordinates[],
    options?: RouteOptions
  ): Promise<RouteCalculationResult> {
    try {
      if (!waypoints || waypoints.length < 2) {
        throw new Error('At least 2 waypoints are required');
      }

      // OSRM expects coordinates in lng,lat;lng,lat format
      const coordsString = waypoints.map((w) => `${w.longitude},${w.latitude}`).join(';');
      const url = `${this.baseUrl}/route/v1/driving/${coordsString}?overview=full&geometries=geojson&steps=true`;

      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      });

      if (!res.ok) {
        throw new Error(`OSRM route returned HTTP ${res.status}`);
      }

      const data = (await res.json()) as {
        code: string;
        routes?: Array<{
          distance: number;
          duration: number;
          geometry: {
            coordinates: [number, number][]; // [lng, lat]
          };
          legs: Array<{
            distance: number;
            duration: number;
            steps?: Array<{
              maneuver?: { instruction?: string };
              distance: number;
              duration: number;
            }>;
          }>;
        }>;
      };

      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error(`OSRM code: ${data.code}`);
      }

      const route = data.routes[0]!;
      // Convert OSRM [lng, lat] GeoJSON to [lat, lng]
      const coordinates: [number, number][] = route.geometry.coordinates.map(
        ([lng, lat]) => [lat, lng]
      );

      const legs: RouteLeg[] = (route.legs || []).map((l, idx) => ({
        distanceMeters: Math.round(l.distance),
        durationSeconds: Math.round(l.duration),
        startLocation: waypoints[idx]!,
        endLocation: waypoints[idx + 1]!,
        steps: (l.steps || []).map((s) => ({
          instruction: s.maneuver?.instruction || 'Continue on route',
          distanceMeters: Math.round(s.distance),
          durationSeconds: Math.round(s.duration),
          startLocation: waypoints[idx]!,
          endLocation: waypoints[idx + 1]!,
        })),
      }));

      return {
        distanceMeters: Math.round(route.distance),
        durationSeconds: Math.round(route.duration),
        geometryPolyline: JSON.stringify(coordinates),
        coordinates,
        legs,
        provider: this.providerName,
      };
    } catch (err: any) {
      logger.warn('OSRM routing failed or offline, falling back to local adapter', {
        waypointsCount: waypoints.length,
        error: err.message,
      });
      return this.fallbackAdapter.calculateRoute(waypoints, options);
    }
  }

  async calculateDistanceMatrix(query: DistanceMatrixQuery): Promise<DistanceMatrixResult> {
    try {
      const allCoords = [...query.origins, ...query.destinations];
      const coordsString = allCoords.map((c) => `${c.longitude},${c.latitude}`).join(';');
      const sources = query.origins.map((_, i) => i).join(';');
      const destinations = query.destinations.map((_, i) => query.origins.length + i).join(';');

      const url = `${this.baseUrl}/table/v1/driving/${coordsString}?sources=${sources}&destinations=${destinations}&annotations=distance,duration`;

      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      });

      if (!res.ok) {
        throw new Error(`OSRM table returned HTTP ${res.status}`);
      }

      const data = (await res.json()) as {
        code: string;
        durations?: number[][];
        distances?: number[][];
      };

      if (data.code !== 'Ok' || !data.durations || !data.distances) {
        throw new Error(`OSRM matrix code: ${data.code}`);
      }

      const rows = data.distances.map((row, rIdx) => ({
        elements: row.map((dist, cIdx) => ({
          distanceMeters: Math.round(dist),
          durationSeconds: Math.round(data.durations![rIdx]![cIdx]!),
          status: 'OK' as const,
        })),
      }));

      return {
        rows,
        provider: this.providerName,
      };
    } catch (err: any) {
      logger.warn('OSRM matrix failed or offline, falling back to local adapter', {
        error: err.message,
      });
      return this.fallbackAdapter.calculateDistanceMatrix(query);
    }
  }

  async calculateEta(query: EtaCalculationQuery): Promise<EtaCalculationResult> {
    try {
      const route = await this.calculateRoute([query.origin, query.destination]);
      const estimatedArrival = new Date(Date.now() + route.durationSeconds * 1000).toISOString();

      return {
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        estimatedArrival,
        provider: this.providerName,
      };
    } catch (err: any) {
      logger.warn('OSRM ETA failed or offline, falling back to local adapter', {
        error: err.message,
      });
      return this.fallbackAdapter.calculateEta(query);
    }
  }

  async snapToRoad(points: GeoCoordinates[]): Promise<SnapToRoadResult> {
    try {
      if (points.length === 0) {
        return { snappedPoints: [], provider: this.providerName };
      }

      const coordsString = points.map((p) => `${p.longitude},${p.latitude}`).join(';');
      const url = `${this.baseUrl}/match/v1/driving/${coordsString}?overview=simplified`;

      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      });

      if (!res.ok) {
        throw new Error(`OSRM match returned HTTP ${res.status}`);
      }

      const data = (await res.json()) as {
        code: string;
        tracepoints?: Array<{
          location?: [number, number]; // [lng, lat]
          matchings_index?: number;
          confidence?: number;
        } | null>;
      };

      if (data.code !== 'Ok' || !data.tracepoints) {
        throw new Error(`OSRM match code: ${data.code}`);
      }

      const snappedPoints = data.tracepoints.map((tp, idx) => {
        if (!tp || !tp.location) {
          return {
            latitude: points[idx]!.latitude,
            longitude: points[idx]!.longitude,
            originalIndex: idx,
            confidence: 0,
          };
        }
        return {
          latitude: tp.location[1],
          longitude: tp.location[0],
          originalIndex: idx,
          confidence: tp.confidence || 0.95,
        };
      });

      return {
        snappedPoints,
        provider: this.providerName,
      };
    } catch (err: any) {
      logger.warn('OSRM match failed or offline, falling back to local adapter', {
        error: err.message,
      });
      return this.fallbackAdapter.snapToRoad(points);
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Test basic 2-point routing
      const res = await fetch(
        `${this.baseUrl}/route/v1/driving/77.209,28.6139;77.215,28.625?overview=none`,
        { signal: AbortSignal.timeout(2000) }
      );
      return res.ok;
    } catch {
      return false;
    }
  }
}
