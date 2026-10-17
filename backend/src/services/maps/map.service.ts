import {
  IMapProvider,
  GeocodeQuery,
  GeocodeResult,
  ReverseGeocodeQuery,
  ReverseGeocodeResult,
  GeocodingOption,
  MapTileLayerOption,
  FreeMapOptionsResponse,
  PaidMapPolicyResponse,
  FREE_MAP_TILE_PROVIDERS,
} from '@school-bus/shared';
import { OsmMapAdapter } from './osm-map.adapter.js';
import { MockMapAdapter } from './mock-map.adapter.js';
import { GoogleMapsGeocodingAdapter } from './google-maps-geocoding.adapter.js';
import { MapUsageTracker } from './map-usage-tracker.service.js';
import { RoutingService } from '../routing/routing.service.js';

/**
 * Domain Service for Map & Geocoding Operations
 * Provides unified interface with pluggable provider adapters (Free/OSS First).
 */
export class MapService {
  private static activeOption: GeocodingOption =
    process.env.NODE_ENV === 'test' ? 'mock' : 'osm_nominatim';
  private static activeTileLayer: MapTileLayerOption = 'osm_standard';
  private static provider: IMapProvider =
    process.env.NODE_ENV === 'test' ? new MockMapAdapter() : new OsmMapAdapter();

  /**
   * Set custom or test provider adapter directly
   */
  public static setProvider(newProvider: IMapProvider): void {
    MapService.provider = newProvider;
  }

  /**
   * Get current provider adapter
   */
  public static getProvider(): IMapProvider {
    return MapService.provider;
  }

  /**
   * Switch geocoding option
   */
  public static setGeocodingOption(option: GeocodingOption): void {
    MapService.activeOption = option;
    if (option === 'osm_nominatim') {
      MapService.provider = new OsmMapAdapter();
    } else if (option === 'google_maps') {
      MapService.provider = new GoogleMapsGeocodingAdapter();
    } else {
      MapService.provider = new MockMapAdapter();
    }
  }

  /**
   * Get active geocoding option
   */
  public static getGeocodingOption(): GeocodingOption {
    return MapService.activeOption;
  }

  /**
   * Switch tile layer option
   */
  public static setTileLayerOption(layer: MapTileLayerOption): void {
    MapService.activeTileLayer = layer;
  }

  /**
   * Get active tile layer option
   */
  public static getTileLayerOption(): MapTileLayerOption {
    return MapService.activeTileLayer;
  }

  /**
   * Reset provider to default configuration
   */
  public static resetProvider(): void {
    MapService.activeOption = process.env.NODE_ENV === 'test' ? 'mock' : 'osm_nominatim';
    MapService.activeTileLayer = 'osm_standard';
    MapService.provider =
      process.env.NODE_ENV === 'test' ? new MockMapAdapter() : new OsmMapAdapter();
  }

  /**
   * Geocode a human-readable address to geographic coordinates
   */
  public static async geocode(query: GeocodeQuery, schoolId: string = 'system'): Promise<GeocodeResult[]> {
    const start = Date.now();
    try {
      const results = await MapService.provider.geocode(query);
      const isPaid = MapService.activeOption === 'google_maps';
      MapUsageTracker.record({
        schoolId,
        provider: MapService.provider.providerName,
        operation: 'geocode',
        status: 'success',
        latencyMs: Date.now() - start,
        isPaidProvider: isPaid,
      });
      return results;
    } catch (err: any) {
      MapUsageTracker.record({
        schoolId,
        provider: MapService.provider.providerName,
        operation: 'geocode',
        status: 'failed',
        latencyMs: Date.now() - start,
        isPaidProvider: MapService.activeOption === 'google_maps',
      });
      throw err;
    }
  }

  /**
   * Reverse geocode geographic coordinates to a structured address
   */
  public static async reverseGeocode(
    query: ReverseGeocodeQuery,
    schoolId: string = 'system'
  ): Promise<ReverseGeocodeResult> {
    const start = Date.now();
    try {
      const result = await MapService.provider.reverseGeocode(query);
      const isPaid = MapService.activeOption === 'google_maps';
      MapUsageTracker.record({
        schoolId,
        provider: MapService.provider.providerName,
        operation: 'reverse_geocode',
        status: 'success',
        latencyMs: Date.now() - start,
        isPaidProvider: isPaid,
      });
      return result;
    } catch (err: any) {
      MapUsageTracker.record({
        schoolId,
        provider: MapService.provider.providerName,
        operation: 'reverse_geocode',
        status: 'failed',
        latencyMs: Date.now() - start,
        isPaidProvider: MapService.activeOption === 'google_maps',
      });
      throw err;
    }
  }

  /**
   * Health check for active map provider
   */
  public static async isHealthy(): Promise<boolean> {
    return MapService.provider.isHealthy();
  }

  /**
   * Retrieve available and active free-first map and routing configurations
   */
  public static getFreeMapOptions(): FreeMapOptionsResponse {
    return {
      activeTileLayer: MapService.activeTileLayer,
      activeGeocodingProvider: MapService.activeOption,
      activeRoutingProvider: RoutingService.getRoutingOption(),
      availableTileLayers: Object.values(FREE_MAP_TILE_PROVIDERS),
      availableGeocodingProviders: ['osm_nominatim', 'google_maps', 'mock'],
      availableRoutingProviders: ['osrm', 'valhalla', 'google_maps', 'mock'],
      defaultCenter: { latitude: 28.6139, longitude: 77.2090 },
      defaultZoom: 12,
      isFreeFirst: true,
    };
  }

  /**
   * Machine-readable Paid Map & Provider Fallback Policy
   */
  public static getPaidMapPolicy(): PaidMapPolicyResponse {
    const hasGoogleKey = Boolean(process.env.GOOGLE_MAPS_API_KEY && process.env.GOOGLE_MAPS_API_KEY.trim().length > 10);

    return {
      policyName: 'BUSLOARD Indian School Transport Geospatial Fallback Policy',
      version: '1.0.0',
      isFreeFirstDefault: true,
      hasCommercialKeyConfigured: hasGoogleKey,
      activeRoutingOption: RoutingService.getRoutingOption(),
      activeGeocodingOption: MapService.activeOption,
      dailyQuotaBudget: 500,
      fallbackHierarchy: [
        'GOOGLE_MAPS_PLATFORM (Commercial Trigger)',
        'VALHALLA_MULTI_MODAL (Free OSS Host)',
        'OSRM_PROJECT (Free OSS Primary)',
        'MOCK_HAVERSINE (Zero-Dependency Offline Fallback)',
      ],
      supportedCommercialProviders: ['google_maps', 'mapbox'],
      triggers: [
        {
          id: 'TRG_ADDR_AMBIGUITY',
          name: 'Informal Indian Address Ambiguity',
          description: 'Triggered when Nominatim returns 0 results or low confidence (<0.60) for informal rural/suburban colony addresses.',
          triggerCategory: 'address_ambiguity',
          isActive: true,
          thresholdDetail: 'Nominatim confidence < 0.60 or result count == 0',
          actionSummary: 'Fall back to Google Places/Geocoding API, cache coordinates permanently in PostgreSQL, and avoid recurring billings.',
        },
        {
          id: 'TRG_DYNAMIC_CONGESTION',
          name: 'Dynamic Peak-Hour Congestion Re-Routing',
          description: 'Triggered during morning arrival or afternoon dispersal when real-time corridor delay exceeds 20 minutes.',
          triggerCategory: 'traffic_congestion',
          isActive: true,
          thresholdDetail: 'Active telemetry delay > 20 mins against scheduled ETA',
          actionSummary: 'Query Google Directions with live traffic_model=best_guess for dynamic parent notifications.',
        },
        {
          id: 'TRG_RATE_LIMIT_EXHAUSTION',
          name: 'Public Fair-Use Rate Limit Exhaustion',
          description: 'Triggered when fleet operations scale beyond 50 buses without dedicated self-hosted Valhalla/OSRM infrastructure.',
          triggerCategory: 'rate_limit',
          isActive: true,
          thresholdDetail: 'Request throughput > 1 req/sec on public OSM/Nominatim endpoints',
          actionSummary: 'Switch to commercial managed tier or enterprise CDN to ensure 99.99% uptime.',
        },
        {
          id: 'TRG_AERIAL_SAFETY_AUDIT',
          name: 'Aerial & Satellite Road Safety Auditing',
          description: 'Triggered by transport coordinators auditing turning radiuses, narrow lanes, and school gate clearance.',
          triggerCategory: 'safety_audit',
          isActive: true,
          thresholdDetail: 'Transport coordinator activates aerial inspection mode',
          actionSummary: 'Render high-resolution satellite imagery tiles on admin operational canvas.',
        },
      ],
    };
  }
}


