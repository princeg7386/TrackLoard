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
  RoutingOption,
  RoutingEvaluationResponse,
  RoutingEvaluationItem,
} from '@school-bus/shared';
import { query } from '../../config/database.js';
import { NotFoundError } from '../../middlewares/error.middleware.js';
import { OsrmRoutingAdapter } from './osrm-routing.adapter.js';
import { ValhallaRoutingAdapter } from './valhalla-routing.adapter.js';
import { MockRoutingAdapter } from './mock-routing.adapter.js';

export interface RouteStopCalculationResult {
  routeId: string;
  routeName: string;
  schoolId: string;
  stopsCount: number;
  totalDistanceMeters: number;
  estimatedDurationMinutes: number;
  pathPolyline: string;
  legs: RouteCalculationResult['legs'];
  provider: string;
}

/**
 * Domain Service for Routing, Matrix, ETA, and Stop Path Management.
 * Pluggable provider architecture with built-in database persistence for school routes.
 */
export class RoutingService {
  private static activeOption: RoutingOption =
    process.env.NODE_ENV === 'test' ? 'mock' : 'osrm';
  private static provider: IRoutingProvider =
    process.env.NODE_ENV === 'test' ? new MockRoutingAdapter() : new OsrmRoutingAdapter();

  /**
   * Set custom or test routing provider adapter
   */
  public static setProvider(newProvider: IRoutingProvider): void {
    RoutingService.provider = newProvider;
  }

  /**
   * Switch routing option
   */
  public static setRoutingOption(option: RoutingOption): void {
    RoutingService.activeOption = option;
    if (option === 'osrm') {
      RoutingService.provider = new OsrmRoutingAdapter();
    } else if (option === 'valhalla') {
      RoutingService.provider = new ValhallaRoutingAdapter();
    } else {
      RoutingService.provider = new MockRoutingAdapter();
    }
  }


  /**
   * Get active routing option
   */
  public static getRoutingOption(): RoutingOption {
    return RoutingService.activeOption;
  }

  /**
   * Get current active provider
   */
  public static getProvider(): IRoutingProvider {
    return RoutingService.provider;
  }

  /**
   * Reset provider to default configuration
   */
  public static resetProvider(): void {
    RoutingService.activeOption = process.env.NODE_ENV === 'test' ? 'mock' : 'osrm';
    RoutingService.provider =
      process.env.NODE_ENV === 'test' ? new MockRoutingAdapter() : new OsrmRoutingAdapter();
  }

  /**
   * Calculate point-to-point or multi-waypoint route
   */
  public static async calculateRoute(
    waypoints: GeoCoordinates[],
    options?: RouteOptions
  ): Promise<RouteCalculationResult> {
    return RoutingService.provider.calculateRoute(waypoints, options);
  }

  /**
   * Calculate distance & duration matrix
   */
  public static async calculateDistanceMatrix(
    matrixQuery: DistanceMatrixQuery
  ): Promise<DistanceMatrixResult> {
    return RoutingService.provider.calculateDistanceMatrix(matrixQuery);
  }

  /**
   * Calculate estimated time of arrival between two points
   */
  public static async calculateEta(
    etaQuery: EtaCalculationQuery
  ): Promise<EtaCalculationResult> {
    return RoutingService.provider.calculateEta(etaQuery);
  }

  /**
   * Snap raw GPS telemetry coordinates to realistic road network
   */
  public static async snapToRoad(points: GeoCoordinates[]): Promise<SnapToRoadResult> {
    return RoutingService.provider.snapToRoad(points);
  }

  /**
   * Health check for active routing provider
   */
  public static async isHealthy(): Promise<boolean> {
    return RoutingService.provider.isHealthy();
  }

  /**
   * Real-DB integration:
   * Retrieves sequenced pickup stops for a school's route, computes the driving path,
   * and persists the polyline and estimated duration directly into the routes table.
   */
  public static async calculateAndPersistRouteForStops(
    schoolId: string,
    routeId: string
  ): Promise<RouteStopCalculationResult> {
    // 1. Fetch route verifying school ownership
    const routeRows = await query<{ id: string; name: string; school_id: string }>(
      `SELECT id, name, school_id FROM routes WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [routeId, schoolId]
    );

    if (routeRows.length === 0) {
      throw new NotFoundError(`Route ${routeId} not found in this school`);
    }

    const routeRecord = routeRows[0]!;

    // 2. Fetch sequenced pickup locations
    const stopRows = await query<{
      id: string;
      stop_name: string;
      sequence_order: number;
      latitude: number;
      longitude: number;
    }>(
      `SELECT id, stop_name, sequence_order, latitude, longitude
       FROM pickup_locations
       WHERE route_id = $1 AND school_id = $2 AND deleted_at IS NULL
       ORDER BY sequence_order ASC`,
      [routeId, schoolId]
    );

    if (stopRows.length < 2) {
      return {
        routeId: routeRecord.id,
        routeName: routeRecord.name,
        schoolId: routeRecord.school_id,
        stopsCount: stopRows.length,
        totalDistanceMeters: 0,
        estimatedDurationMinutes: 0,
        pathPolyline: '[]',
        legs: [],
        provider: RoutingService.provider.providerName,
      };
    }

    // 3. Map stops to waypoints
    const waypoints: GeoCoordinates[] = stopRows.map((s) => ({
      latitude: s.latitude,
      longitude: s.longitude,
    }));

    // 4. Calculate route through provider
    const routeResult = await RoutingService.calculateRoute(waypoints);
    const durationMinutes = Math.max(1, Math.round(routeResult.durationSeconds / 60));

    // 5. Persist calculated polyline and duration in routes table
    await query(
      `UPDATE routes
       SET path_polyline = $1, estimated_duration_minutes = $2, updated_at = NOW()
       WHERE id = $3 AND school_id = $4`,
      [routeResult.geometryPolyline, durationMinutes, routeId, schoolId]
    );

    return {
      routeId: routeRecord.id,
      routeName: routeRecord.name,
      schoolId: routeRecord.school_id,
      stopsCount: stopRows.length,
      totalDistanceMeters: routeResult.distanceMeters,
      estimatedDurationMinutes: durationMinutes,
      pathPolyline: routeResult.geometryPolyline,
      legs: routeResult.legs,
      provider: routeResult.provider,
    };
  }

  /**
   * Evaluate and benchmark routing engines (OSRM, Valhalla, Mock)
   * Runs standardized transit route benchmark and returns comparative metrics.
   */
  public static async evaluateEngines(): Promise<RoutingEvaluationResponse> {
    const benchmarkWaypoints: GeoCoordinates[] = [
      { latitude: 28.6675, longitude: 77.2285 }, // Kashmere Gate Metro
      { latitude: 28.6800, longitude: 77.2250 }, // Civil Lines Gate 3
    ];

    const engines: Array<{
      option: RoutingOption;
      name: string;
      adapter: IRoutingProvider;
      features: { turnByTurn: boolean; matrix: boolean; roadSnapping: boolean; customCosting: boolean };
    }> = [
      {
        option: 'osrm',
        name: 'Open Source Routing Machine (OSRM)',
        adapter: new OsrmRoutingAdapter(),
        features: { turnByTurn: true, matrix: true, roadSnapping: true, customCosting: false },
      },
      {
        option: 'valhalla',
        name: 'Valhalla Multi-Modal Routing Engine',
        adapter: new ValhallaRoutingAdapter(),
        features: { turnByTurn: true, matrix: true, roadSnapping: true, customCosting: true },
      },
      {
        option: 'mock',
        name: 'Mock & Geometric Transit Model (Offline)',
        adapter: new MockRoutingAdapter(),
        features: { turnByTurn: true, matrix: true, roadSnapping: true, customCosting: true },
      },
    ];

    const evaluations: RoutingEvaluationItem[] = [];

    for (const eng of engines) {
      const start = Date.now();
      try {
        const result = await eng.adapter.calculateRoute(benchmarkWaypoints, { mode: 'bus' });
        const latencyMs = Date.now() - start;

        evaluations.push({
          engine: eng.option,
          engineName: eng.name,
          isAvailable: true,
          latencyMs,
          distanceMeters: result.distanceMeters,
          durationSeconds: result.durationSeconds,
          pointsCount: result.coordinates.length,
          features: eng.features,
        });
      } catch (err: any) {
        evaluations.push({
          engine: eng.option,
          engineName: eng.name,
          isAvailable: false,
          latencyMs: Date.now() - start,
          features: eng.features,
          error: err?.message || 'Engine unreachable',
        });
      }
    }

    // Determine recommended engine: prefer OSRM or Valhalla if available with low latency (<3000ms), else mock
    const osrmEval = evaluations.find((e) => e.engine === 'osrm');
    const valhallaEval = evaluations.find((e) => e.engine === 'valhalla');

    let recommendedEngine: RoutingOption = 'mock';
    if (osrmEval && osrmEval.isAvailable && (!osrmEval.error || osrmEval.latencyMs < 3000)) {
      recommendedEngine = 'osrm';
    } else if (valhallaEval && valhallaEval.isAvailable && !valhallaEval.error) {
      recommendedEngine = 'valhalla';
    }

    return {
      evaluations,
      recommendedEngine,
      activeEngine: RoutingService.activeOption,
      evaluatedAt: new Date().toISOString(),
    };
  }
}

