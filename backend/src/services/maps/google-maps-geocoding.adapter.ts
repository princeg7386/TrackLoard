import {
  IMapProvider,
  GeocodeQuery,
  GeocodeResult,
  ReverseGeocodeQuery,
  ReverseGeocodeResult,
} from '@school-bus/shared';
import { OsmMapAdapter } from './osm-map.adapter.js';
import { MockMapAdapter } from './mock-map.adapter.js';
import { MapUsageTracker } from './map-usage-tracker.service.js';

/**
 * Commercial Google Maps Geocoding & Reverse Geocoding Adapter with Transparent OSM Fallback.
 * Used when school districts encounter ambiguous Indian addresses, informal colony names,
 * or require Google Places precision. Automatically falls back to OsmMapAdapter on missing key or network errors.
 */
export class GoogleMapsGeocodingAdapter implements IMapProvider {
  public readonly providerName = 'GOOGLE_MAPS_GEOCODING_PROVIDER';

  private readonly apiKey: string;
  private readonly fallbackAdapter: IMapProvider;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GOOGLE_MAPS_API_KEY || '';
    this.fallbackAdapter =
      process.env.NODE_ENV === 'test' ? new MockMapAdapter() : new OsmMapAdapter();
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

  public async geocode(query: GeocodeQuery): Promise<GeocodeResult[]> {
    const startTime = Date.now();

    if (!this.hasValidKey()) {
      const fallbackResult = await this.fallbackAdapter.geocode(query);
      MapUsageTracker.record({
        schoolId: 'system',
        provider: this.providerName,
        operation: 'geocode',
        status: 'fallback',
        fallbackProvider: this.fallbackAdapter.providerName,
        latencyMs: Date.now() - startTime,
        isPaidProvider: false,
      });
      return fallbackResult;
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        query.query
      )}&region=in&key=${this.apiKey}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Google Geocoding HTTP error ${response.status}`);
      }

      const data = (await response.json()) as any;

      if (data.status !== 'OK' || !data.results || data.results.length === 0) {
        throw new Error(`Google Geocoding status: ${data.status || 'ZERO_RESULTS'}`);
      }

      const mapped: GeocodeResult[] = data.results.slice(0, query.limit || 5).map((item: any) => ({
        latitude: item.geometry.location.lat,
        longitude: item.geometry.location.lng,
        formattedAddress: item.formatted_address,
        displayName: item.formatted_address,
        placeId: item.place_id,
        country: 'India',
      }));

      MapUsageTracker.record({
        schoolId: 'system',
        provider: this.providerName,
        operation: 'geocode',
        status: 'success',
        latencyMs: Date.now() - startTime,
        isPaidProvider: true,
      });

      return mapped;
    } catch {
      const fallbackResult = await this.fallbackAdapter.geocode(query);
      MapUsageTracker.record({
        schoolId: 'system',
        provider: this.providerName,
        operation: 'geocode',
        status: 'fallback',
        fallbackProvider: this.fallbackAdapter.providerName,
        latencyMs: Date.now() - startTime,
        isPaidProvider: false,
      });
      return fallbackResult;
    }
  }

  public async reverseGeocode(query: ReverseGeocodeQuery): Promise<ReverseGeocodeResult> {
    const startTime = Date.now();

    if (!this.hasValidKey()) {
      const fallbackResult = await this.fallbackAdapter.reverseGeocode(query);
      MapUsageTracker.record({
        schoolId: 'system',
        provider: this.providerName,
        operation: 'reverse_geocode',
        status: 'fallback',
        fallbackProvider: this.fallbackAdapter.providerName,
        latencyMs: Date.now() - startTime,
        isPaidProvider: false,
      });
      return fallbackResult;
    }

    try {
      const latlng = `${query.latitude},${query.longitude}`;
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(
        latlng
      )}&key=${this.apiKey}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Google Reverse Geocoding HTTP error ${response.status}`);
      }

      const data = (await response.json()) as any;

      if (data.status !== 'OK' || !data.results || data.results.length === 0) {
        throw new Error(`Google Reverse Geocoding status: ${data.status || 'ZERO_RESULTS'}`);
      }

      const item = data.results[0];

      MapUsageTracker.record({
        schoolId: 'system',
        provider: this.providerName,
        operation: 'reverse_geocode',
        status: 'success',
        latencyMs: Date.now() - startTime,
        isPaidProvider: true,
      });

      return {
        latitude: query.latitude,
        longitude: query.longitude,
        formattedAddress: item.formatted_address,
        displayName: item.formatted_address,
      };
    } catch {
      const fallbackResult = await this.fallbackAdapter.reverseGeocode(query);
      MapUsageTracker.record({
        schoolId: 'system',
        provider: this.providerName,
        operation: 'reverse_geocode',
        status: 'fallback',
        fallbackProvider: this.fallbackAdapter.providerName,
        latencyMs: Date.now() - startTime,
        isPaidProvider: false,
      });
      return fallbackResult;
    }
  }
}
