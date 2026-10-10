import { BusWithDriver, CreateBusRequest, Driver } from '@school-bus/shared';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('sb_admin_token') : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Fetches all fleet vehicles for a school tenant
 */
export async function fetchBuses(schoolId: string): Promise<BusWithDriver[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/buses`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('UNAUTHORIZED');
      }
      throw new Error(`API Error: ${res.status}`);
    }

    const json = await res.json();
    return json.data || [];
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') throw error;
    // Return empty array for local dev if backend not running
    return [];
  }
}

/**
 * Registers a new vehicle in the school fleet
 */
export async function createBus(
  schoolId: string,
  payload: CreateBusRequest
): Promise<BusWithDriver> {
  const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/buses`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  const json = await res.json();

  if (!res.ok) {
    if (res.status === 409) {
      throw new Error(json.error?.message || 'A vehicle with this registration or bus number already exists.');
    }
    if (res.status === 422) {
      const details = json.error?.details;
      if (Array.isArray(details) && details.length > 0) {
        throw new Error(details[0].message || 'Validation error');
      }
      throw new Error(json.error?.message || 'Invalid vehicle details provided.');
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error('UNAUTHORIZED');
    }
    throw new Error(json.error?.message || `Failed to register vehicle (HTTP ${res.status})`);
  }

  return json.data;
}

/**
 * Fetches registered drivers for assignment dropdown
 */
export async function fetchAvailableDrivers(schoolId: string): Promise<Driver[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/drivers`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    if (!res.ok) {
      return [];
    }

    const json = await res.json();
    return json.data || [];
  } catch {
    return [];
  }
}
