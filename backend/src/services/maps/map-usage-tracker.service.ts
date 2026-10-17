import { randomUUID } from 'crypto';
import {
  MapUsageRecord,
  MapUsageSummary,
  MapUsageOperation,
  MapUsageStatus,
  RoutingOption,
  GeocodingOption,
  MapTileLayerOption,
} from '@school-bus/shared';

// Standard commercial unit cost benchmarks (USD)
const COMMERCIAL_UNIT_COST_USD: Record<MapUsageOperation, number> = {
  geocode: 0.005, // Google Geocoding API ($5 / 1,000)
  reverse_geocode: 0.005, // Google Reverse Geocoding API ($5 / 1,000)
  route_calculate: 0.005, // Google Directions API ($5 / 1,000)
  eta: 0.005, // Google Distance Matrix API ($5 / 1,000)
  distance_matrix: 0.005, // Google Distance Matrix API per origin/dest ($5 / 1,000)
  snap_to_road: 0.01, // Google Roads API ($10 / 1,000)
  tile_request: 0.0005, // Commercial tile CDN ($0.50 / 1,000)
};

const USD_TO_INR_RATE = 83.0;
const MAX_RING_BUFFER_SIZE = 5000;

export interface RecordUsageParams {
  schoolId: string;
  provider: string;
  operation: MapUsageOperation;
  status: MapUsageStatus;
  fallbackProvider?: string;
  latencyMs: number;
  isPaidProvider?: boolean;
}

/**
 * In-memory operational tracker for Map, Routing & Geocoding API consumption,
 * fallback occurrences, and Free-First cost savings.
 */
export class MapUsageTracker {
  private static events: MapUsageRecord[] = [];
  private static counters = new Map<
    string,
    {
      totalRequests: number;
      successfulRequests: number;
      failedRequests: number;
      fallbackCount: number;
      totalLatencyMs: number;
      totalCostUsd: number;
      totalSavedInr: number;
      requestsByProvider: Record<string, number>;
      requestsByOperation: Record<string, number>;
    }
  >();

  /**
   * Record a map or routing operation
   */
  public static record(params: RecordUsageParams): MapUsageRecord {
    const { schoolId, provider, operation, status, fallbackProvider, latencyMs, isPaidProvider } = params;

    const unitCostUsd = isPaidProvider ? (COMMERCIAL_UNIT_COST_USD[operation] || 0.005) : 0;
    const commercialBenchmarkUsd = COMMERCIAL_UNIT_COST_USD[operation] || 0.005;

    // Savings: if free provider used successfully, saved = commercial benchmark * rate
    const savedCostInr = !isPaidProvider && status !== 'failed' ? commercialBenchmarkUsd * USD_TO_INR_RATE : 0;
    const estimatedCostUsd = unitCostUsd;
    const estimatedCostInr = unitCostUsd * USD_TO_INR_RATE;

    const record: MapUsageRecord = {
      id: randomUUID(),
      schoolId: schoolId || 'system',
      provider,
      operation,
      status,
      fallbackProvider,
      latencyMs: Math.max(0, latencyMs),
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)),
      estimatedCostInr: Number(estimatedCostInr.toFixed(2)),
      savedCostInr: Number(savedCostInr.toFixed(2)),
      timestamp: new Date().toISOString(),
    };

    // Append to ring buffer
    MapUsageTracker.events.push(record);
    if (MapUsageTracker.events.length > MAX_RING_BUFFER_SIZE) {
      MapUsageTracker.events.shift();
    }

    // Update aggregate counters for schoolId and 'all'
    const targetScopes = [schoolId || 'system'];
    if (schoolId && schoolId !== 'all') {
      targetScopes.push('all');
    }

    for (const scope of targetScopes) {
      let stats = MapUsageTracker.counters.get(scope);
      if (!stats) {
        stats = {
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          fallbackCount: 0,
          totalLatencyMs: 0,
          totalCostUsd: 0,
          totalSavedInr: 0,
          requestsByProvider: {},
          requestsByOperation: {},
        };
        MapUsageTracker.counters.set(scope, stats);
      }

      stats.totalRequests += 1;
      if (status === 'success') stats.successfulRequests += 1;
      if (status === 'failed') stats.failedRequests += 1;
      if (status === 'fallback') stats.fallbackCount += 1;

      stats.totalLatencyMs += latencyMs;
      stats.totalCostUsd += estimatedCostUsd;
      stats.totalSavedInr += savedCostInr;

      stats.requestsByProvider[provider] = (stats.requestsByProvider[provider] || 0) + 1;
      stats.requestsByOperation[operation] = (stats.requestsByOperation[operation] || 0) + 1;
    }

    return record;
  }

  /**
   * Get summarized usage and savings metrics
   */
  public static getSummary(
    schoolId: string = 'all',
    activeRouting: RoutingOption = 'osrm',
    activeGeocoding: GeocodingOption = 'osm_nominatim',
    activeTileLayer: MapTileLayerOption = 'osm_standard'
  ): MapUsageSummary {
    const stats = MapUsageTracker.counters.get(schoolId) || {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      fallbackCount: 0,
      totalLatencyMs: 0,
      totalCostUsd: 0,
      totalSavedInr: 0,
      requestsByProvider: {},
      requestsByOperation: {},
    };

    const avgLatency =
      stats.totalRequests > 0 ? Math.round(stats.totalLatencyMs / stats.totalRequests) : 0;

    return {
      schoolId,
      totalRequests: stats.totalRequests,
      successfulRequests: stats.successfulRequests,
      failedRequests: stats.failedRequests,
      fallbackCount: stats.fallbackCount,
      averageLatencyMs: avgLatency,
      totalCostInr: Number((stats.totalCostUsd * USD_TO_INR_RATE).toFixed(2)),
      totalCostUsd: Number(stats.totalCostUsd.toFixed(4)),
      totalSavedInr: Number(stats.totalSavedInr.toFixed(2)),
      requestsByProvider: { ...stats.requestsByProvider },
      requestsByOperation: { ...stats.requestsByOperation },
      activeProviders: {
        routing: activeRouting,
        geocoding: activeGeocoding,
        tileLayer: activeTileLayer,
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Retrieve recent event log for audit
   */
  public static getRecentEvents(schoolId?: string, limit: number = 50): MapUsageRecord[] {
    const filtered = schoolId && schoolId !== 'all'
      ? MapUsageTracker.events.filter((e) => e.schoolId === schoolId)
      : MapUsageTracker.events;

    return filtered.slice(-limit).reverse();
  }

  /**
   * Reset in-memory tracking counters (for tests & reset periods)
   */
  public static reset(): void {
    MapUsageTracker.events = [];
    MapUsageTracker.counters.clear();
  }
}
