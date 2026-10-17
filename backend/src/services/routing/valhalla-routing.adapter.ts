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
  decodePolyline,
} from '@school-bus/shared';
import { logger } from '../logger.service.js';
import { MockRoutingAdapter } from './mock-routing.adapter.js';

/**
 * Valhalla Routing Engine Adapter.
 * Open-source multi-modal routing engine designed for OpenStreetMap data.
 * Supports custom costing options (bus, auto), time-distance matrix,
 * turn-by-turn guidance maneuvers, and automatic fallback.
 */
export class ValhallaRoutingAdapter implements IRoutingProvider {
  public readonly providerName = 'VALHALLA_ROUTING_PROVIDER';
  private baseUrl: string;
  private fallbackAdapter: MockRoutingAdapter;

  constructor(
    baseUrl: string = process.env.VALHALLA_BASE_URL || 'https://valhalla1.openstreetmap.de'
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
        throw new Error('At least 2 waypoints are required for route calculation');
      }

      const locations = waypoints.map((w) => ({
        lat: w.latitude,
        lon: w.longitude,
        type: 'break',
      }));

      const costing = options?.mode === 'bus' ? 'bus' : 'auto';

      const payload = {
        locations,
        costing,
        costing_options: {
          [costing]: {
            maneuver_penalty: 15,
            country_crossing_penalty: 0,
          },
        },
        directions_options: {
          units: 'kilometers',
          language: 'en-US',
        },
      };

      const res = await fetch(`${this.baseUrl}/route`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(4000),
      });

      if (!res.ok) {
        throw new Error(`Valhalla route HTTP error ${res.status}`);
      }

      const data = (await res.json()) as {
        trip?: {
          summary?: { length: number; time: number };
          legs?: Array<{
            summary?: { length: number; time: number };
            shape?: string;
            maneuvers?: Array<{
              instruction?: string;
              length?: number;
              time?: number;
            }>;
          }>;
        };
      };

      if (!data.trip || !data.trip.summary) {
        throw new Error('Invalid response structure from Valhalla engine');
      }

      const totalDistanceMeters = Math.round((data.trip.summary.length || 0) * 1000);
      const totalDurationSeconds = Math.round(data.trip.summary.time || 0);

      // Extract and decode coordinates from legs
      const coordinates: [number, number][] = [];
      const legs: RouteLeg[] = [];

      for (let i = 0; i < (data.trip.legs || []).length; i++) {
        const leg = data.trip.legs![i]!;
        const legDistance = Math.round((leg.summary?.length || 0) * 1000);
        const legDuration = Math.round(leg.summary?.time || 0);

        if (leg.shape) {
          // Valhalla uses precision 6 for polyline encoding
          const decoded = decodePolyline(leg.shape, 6);
          coordinates.push(...decoded);
        }

        legs.push({
          distanceMeters: legDistance,
          durationSeconds: legDuration,
          startLocation: waypoints[i]!,
          endLocation: waypoints[i + 1]!,
          steps: (leg.maneuvers || []).map((m) => ({
            instruction: m.instruction || 'Continue on route',
            distanceMeters: Math.round((m.length || 0) * 1000),
            durationSeconds: Math.round(m.time || 0),
            startLocation: waypoints[i]!,
            endLocation: waypoints[i + 1]!,
          })),
        });
      }

      // If shape was not provided, fallback coordinates to waypoints
      if (coordinates.length === 0) {
        for (const w of waypoints) {
          coordinates.push([w.latitude, w.longitude]);
        }
      }

      return {
        distanceMeters: totalDistanceMeters,
        durationSeconds: totalDurationSeconds,
        geometryPolyline: JSON.stringify(coordinates),
        coordinates,
        legs,
        provider: this.providerName,
      };
    } catch (error: any) {
      logger.warn(
        `[ValhallaRoutingAdapter] Route calculation failed: ${error?.message}. Invoking fallback.`,
        { waypointsCount: waypoints.length }
      );
      return this.fallbackAdapter.calculateRoute(waypoints, options);
    }
  }

  async calculateDistanceMatrix(query: DistanceMatrixQuery): Promise<DistanceMatrixResult> {
    try {
      const payload = {
        sources: query.origins.map((o) => ({ lat: o.latitude, lon: o.longitude })),
        targets: query.destinations.map((d) => ({ lat: d.latitude, lon: d.longitude })),
        costing: 'bus',
      };

      const res = await fetch(`${this.baseUrl}/sources_to_targets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(4000),
      });

      if (!res.ok) {
        throw new Error(`Valhalla matrix HTTP ${res.status}`);
      }

      const data = (await res.json()) as {
        sources_to_targets?: Array<
          Array<{
            distance?: number;
            time?: number;
          }>
        >;
      };

      if (!data.sources_to_targets) {
        throw new Error('Invalid matrix response from Valhalla');
      }

      const rows = data.sources_to_targets.map((row) => ({
        elements: row.map((cell) => ({
          distanceMeters: Math.round((cell.distance || 0) * 1000),
          durationSeconds: Math.round(cell.time || 0),
          status: 'OK' as const,
        })),
      }));

      return {
        rows,
        provider: this.providerName,
      };
    } catch (error: any) {
      logger.warn(
        `[ValhallaRoutingAdapter] Distance matrix calculation failed: ${error?.message}. Invoking fallback.`
      );
      return this.fallbackAdapter.calculateDistanceMatrix(query);
    }
  }

  async calculateEta(query: EtaCalculationQuery): Promise<EtaCalculationResult> {
    try {
      const route = await this.calculateRoute([query.origin, query.destination], {
        mode: 'bus',
      });
      const etaDate = new Date(Date.now() + route.durationSeconds * 1000);

      return {
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        estimatedArrival: etaDate.toISOString(),
        provider: this.providerName,
      };
    } catch (error: any) {
      logger.warn(
        `[ValhallaRoutingAdapter] ETA calculation failed: ${error?.message}. Invoking fallback.`
      );
      return this.fallbackAdapter.calculateEta(query);
    }
  }

  async snapToRoad(points: GeoCoordinates[]): Promise<SnapToRoadResult> {
    try {
      if (!points || points.length === 0) {
        return { snappedPoints: [], provider: this.providerName };
      }

      const payload = {
        locations: points.map((p) => ({ lat: p.latitude, lon: p.longitude })),
        costing: 'bus',
      };

      const res = await fetch(`${this.baseUrl}/locate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(3000),
      });

      if (!res.ok) {
        throw new Error(`Valhalla locate HTTP ${res.status}`);
      }

      const data = (await res.json()) as Array<{
        lat?: number;
        lon?: number;
        edges?: Array<{ correlated_lat?: number; correlated_lon?: number; distance?: number }>;
      }>;

      const snappedPoints = points.map((pt, idx) => {
        const item = data[idx];
        const edge = item?.edges && item.edges[0];
        return {
          latitude: edge?.correlated_lat ?? item?.lat ?? pt.latitude,
          longitude: edge?.correlated_lon ?? item?.lon ?? pt.longitude,
          originalIndex: idx,
          confidence: edge ? Math.max(0.7, 1 - (edge.distance || 0) / 100) : 0.6,
        };
      });

      return {
        snappedPoints,
        provider: this.providerName,
      };
    } catch (error: any) {
      logger.warn(
        `[ValhallaRoutingAdapter] Snap to road failed: ${error?.message}. Invoking fallback.`
      );
      return this.fallbackAdapter.snapToRoad(points);
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/status`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
