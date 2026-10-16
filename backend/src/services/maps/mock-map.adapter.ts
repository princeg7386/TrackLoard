import {
  IMapProvider,
  GeocodeQuery,
  GeocodeResult,
  ReverseGeocodeQuery,
  ReverseGeocodeResult,
} from '@school-bus/shared';

/**
 * Deterministic Mock Map Provider for testing and offline environments
 */
export class MockMapAdapter implements IMapProvider {
  public readonly providerName = 'MOCK_MAP_PROVIDER';

  // Seeded addresses for testing
  private addressRegistry: Map<string, GeocodeResult> = new Map([
    [
      'delhi public academy',
      {
        formattedAddress: 'Delhi Public Academy, Sector 14, New Delhi, Delhi 110001, India',
        latitude: 28.6139,
        longitude: 77.209,
        displayName: 'Delhi Public Academy',
        city: 'New Delhi',
        state: 'Delhi',
        postalCode: '110001',
        country: 'India',
        boundingBox: [28.61, 28.62, 77.20, 77.22],
      },
    ],
    [
      'greenwood heights',
      {
        formattedAddress: 'Greenwood Heights Gate 1, Sector 21, New Delhi, Delhi 110075, India',
        latitude: 28.625,
        longitude: 77.215,
        displayName: 'Greenwood Heights Gate 1',
        city: 'New Delhi',
        state: 'Delhi',
        postalCode: '110075',
        country: 'India',
        boundingBox: [28.62, 28.63, 77.21, 77.22],
      },
    ],
  ]);

  async geocode(query: GeocodeQuery): Promise<GeocodeResult[]> {
    const qLower = query.query.toLowerCase().trim();
    const results: GeocodeResult[] = [];

    for (const [key, val] of this.addressRegistry.entries()) {
      if (qLower.includes(key) || key.includes(qLower)) {
        results.push(val);
      }
    }

    if (results.length > 0) {
      return results.slice(0, query.limit || 5);
    }

    // Fallback deterministic geocoding for unknown queries
    const hash = this.simpleHash(query.query);
    const lat = 28.6 + (hash % 100) * 0.001;
    const lng = 77.2 + ((hash >> 2) % 100) * 0.001;

    return [
      {
        formattedAddress: `${query.query}, New Delhi, India`,
        latitude: Number(lat.toFixed(6)),
        longitude: Number(lng.toFixed(6)),
        displayName: query.query,
        city: 'New Delhi',
        state: 'Delhi',
        country: 'India',
      },
    ];
  }

  async reverseGeocode(query: ReverseGeocodeQuery): Promise<ReverseGeocodeResult> {
    // Check known coordinates with tolerance ~500m
    for (const val of this.addressRegistry.values()) {
      const dLat = Math.abs(val.latitude - query.latitude);
      const dLng = Math.abs(val.longitude - query.longitude);
      if (dLat < 0.005 && dLng < 0.005) {
        return {
          formattedAddress: val.formattedAddress,
          latitude: query.latitude,
          longitude: query.longitude,
          displayName: val.displayName,
          city: val.city,
          state: val.state,
          postalCode: val.postalCode,
          country: val.country,
        };
      }
    }

    return {
      formattedAddress: `Near Lat ${query.latitude.toFixed(4)}, Lng ${query.longitude.toFixed(4)}, New Delhi, India`,
      latitude: query.latitude,
      longitude: query.longitude,
      displayName: `Coordinate (${query.latitude.toFixed(4)}, ${query.longitude.toFixed(4)})`,
      city: 'New Delhi',
      state: 'Delhi',
      country: 'India',
    };
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }
}
