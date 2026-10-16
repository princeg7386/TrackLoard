import {
  IMapProvider,
  GeocodeQuery,
  GeocodeResult,
  ReverseGeocodeQuery,
  ReverseGeocodeResult,
  GeocodingOption,
  MapTileLayerOption,
  FreeMapOptionsResponse,
  FREE_MAP_TILE_PROVIDERS,
} from '@school-bus/shared';
import { OsmMapAdapter } from './osm-map.adapter.js';
import { MockMapAdapter } from './mock-map.adapter.js';
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
  public static async geocode(query: GeocodeQuery): Promise<GeocodeResult[]> {
    return MapService.provider.geocode(query);
  }

  /**
   * Reverse geocode geographic coordinates to a structured address
   */
  public static async reverseGeocode(query: ReverseGeocodeQuery): Promise<ReverseGeocodeResult> {
    return MapService.provider.reverseGeocode(query);
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
      availableGeocodingProviders: ['osm_nominatim', 'mock'],
      availableRoutingProviders: ['osrm', 'mock'],
      defaultCenter: { latitude: 28.6139, longitude: 77.2090 },
      defaultZoom: 12,
      isFreeFirst: true,
    };
  }
}

