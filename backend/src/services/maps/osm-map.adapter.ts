import {
  IMapProvider,
  GeocodeQuery,
  GeocodeResult,
  ReverseGeocodeQuery,
  ReverseGeocodeResult,
} from '@school-bus/shared';
import { logger } from '../logger.service.js';
import { MockMapAdapter } from './mock-map.adapter.js';

/**
 * OpenStreetMap Nominatim Provider Adapter (Free / OSS Standard)
 * Includes offline resilience: falls back to deterministic local mock adapter
 * if the external API is unreachable or times out.
 */
export class OsmMapAdapter implements IMapProvider {
  public readonly providerName = 'OPEN_STREET_MAP_NOMINATIM';
  private baseUrl: string;
  private userAgent: string;
  private fallbackAdapter: MockMapAdapter;

  constructor(
    baseUrl: string = process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org',
    userAgent: string = 'BUSLOARD-SchoolBusTracking/1.0'
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.userAgent = userAgent;
    this.fallbackAdapter = new MockMapAdapter();
  }

  async geocode(query: GeocodeQuery): Promise<GeocodeResult[]> {
    try {
      const url = new URL(`${this.baseUrl}/search`);
      url.searchParams.set('q', query.query);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', String(query.limit || 5));
      if (query.countryCode) {
        url.searchParams.set('countrycodes', query.countryCode);
      }

      const res = await fetch(url.toString(), {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(3000), // 3s timeout
      });

      if (!res.ok) {
        throw new Error(`Nominatim returned HTTP ${res.status}`);
      }

      const data = (await res.json()) as Array<{
        display_name: string;
        lat: string;
        lon: string;
        place_id?: number;
        address?: {
          city?: string;
          town?: string;
          village?: string;
          state?: string;
          postcode?: string;
          country?: string;
        };
        boundingbox?: [string, string, string, string];
      }>;

      if (!Array.isArray(data) || data.length === 0) {
        return this.fallbackAdapter.geocode(query);
      }

      return data.map((item) => ({
        formattedAddress: item.display_name,
        latitude: parseFloat(item.lat),
        longitude: parseFloat(item.lon),
        placeId: item.place_id ? String(item.place_id) : undefined,
        displayName: item.display_name.split(',')[0]?.trim() || item.display_name,
        city: item.address?.city || item.address?.town || item.address?.village,
        state: item.address?.state,
        postalCode: item.address?.postcode,
        country: item.address?.country || 'India',
        boundingBox: item.boundingbox
          ? [
              parseFloat(item.boundingbox[0]),
              parseFloat(item.boundingbox[1]),
              parseFloat(item.boundingbox[2]),
              parseFloat(item.boundingbox[3]),
            ]
          : undefined,
      }));
    } catch (err: any) {
      logger.warn('Nominatim geocoding failed or offline, falling back to local adapter', {
        query: query.query,
        error: err.message,
      });
      return this.fallbackAdapter.geocode(query);
    }
  }

  async reverseGeocode(query: ReverseGeocodeQuery): Promise<ReverseGeocodeResult> {
    try {
      const url = new URL(`${this.baseUrl}/reverse`);
      url.searchParams.set('lat', String(query.latitude));
      url.searchParams.set('lon', String(query.longitude));
      url.searchParams.set('format', 'jsonv2');

      const res = await fetch(url.toString(), {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(3000),
      });

      if (!res.ok) {
        throw new Error(`Nominatim returned HTTP ${res.status}`);
      }

      const data = (await res.json()) as {
        display_name: string;
        lat: string;
        lon: string;
        address?: {
          road?: string;
          city?: string;
          town?: string;
          village?: string;
          state?: string;
          postcode?: string;
          country?: string;
        };
      };

      if (!data || !data.display_name) {
        return this.fallbackAdapter.reverseGeocode(query);
      }

      return {
        formattedAddress: data.display_name,
        latitude: parseFloat(data.lat),
        longitude: parseFloat(data.lon),
        displayName: data.display_name.split(',')[0]?.trim(),
        street: data.address?.road,
        city: data.address?.city || data.address?.town || data.address?.village,
        state: data.address?.state,
        postalCode: data.address?.postcode,
        country: data.address?.country || 'India',
      };
    } catch (err: any) {
      logger.warn('Nominatim reverse geocoding failed or offline, falling back to local adapter', {
        coords: query,
        error: err.message,
      });
      return this.fallbackAdapter.reverseGeocode(query);
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/status.php?format=json`, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
