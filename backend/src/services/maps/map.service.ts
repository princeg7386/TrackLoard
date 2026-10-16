import {
  IMapProvider,
  GeocodeQuery,
  GeocodeResult,
  ReverseGeocodeQuery,
  ReverseGeocodeResult,
} from '@school-bus/shared';
import { OsmMapAdapter } from './osm-map.adapter.js';
import { MockMapAdapter } from './mock-map.adapter.js';

/**
 * Domain Service for Map & Geocoding Operations
 * Provides unified interface with pluggable provider adapters (Free/OSS First).
 */
export class MapService {
  private static provider: IMapProvider =
    process.env.NODE_ENV === 'test' ? new MockMapAdapter() : new OsmMapAdapter();

  /**
   * Set custom or test provider adapter
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
   * Reset provider to default configuration
   */
  public static resetProvider(): void {
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
}
