import {
  DriverWithBus,
  CreateDriverRequest,
  AssignDriverBusPayload,
  BusWithDriver,
  DriverFullHistoryResponse,
} from '@school-bus/shared';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('sb_admin_token') : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Fetches all registered drivers with joined vehicle and route assignments
 */
export async function fetchDrivers(schoolId: string): Promise<DriverWithBus[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/drivers`, {
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
    return [];
  }
}

/**
 * Retrieves single driver profile
 */
export async function fetchDriverDetail(
  schoolId: string,
  driverId: string
): Promise<DriverWithBus> {
  const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/drivers/${driverId}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });

  const json = await res.json();

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('UNAUTHORIZED');
    }
    throw new Error(json.error?.message || `Failed to fetch driver details (HTTP ${res.status})`);
  }

  return json.data;
}

/**
 * Registers a new driver profile with login credentials
 */
export async function createDriver(
  schoolId: string,
  payload: CreateDriverRequest
): Promise<DriverWithBus> {
  const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/drivers`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  const json = await res.json();

  if (!res.ok) {
    if (res.status === 409) {
      throw new Error(
        json.error?.message || 'A driver with this mobile phone number is already registered.'
      );
    }
    if (res.status === 422) {
      const details = json.error?.details;
      if (Array.isArray(details) && details.length > 0) {
        throw new Error(details[0].message || 'Validation error');
      }
      throw new Error(json.error?.message || 'Invalid driver details provided.');
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error('UNAUTHORIZED');
    }
    throw new Error(json.error?.message || `Failed to register driver (HTTP ${res.status})`);
  }

  return json.data;
}

/**
 * Updates bus assignment for a driver (assign or unassign)
 */
export async function updateDriverBusAssignment(
  schoolId: string,
  driverId: string,
  payload: AssignDriverBusPayload
): Promise<DriverWithBus> {
  const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/drivers/${driverId}/assignments`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  const json = await res.json();

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('UNAUTHORIZED');
    }
    throw new Error(json.error?.message || `Failed to update bus assignment (HTTP ${res.status})`);
  }

  return json.data;
}

/**
 * Fetches available fleet buses for vehicle pairing dropdown
 */
export async function fetchAvailableBuses(schoolId: string): Promise<BusWithDriver[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/buses`, {
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

/**
 * Fetches consolidated operational history for a driver (Trips, Incidents, Boarding Attendance)
 */
export async function fetchDriverFullHistory(
  schoolId: string,
  driverId: string
): Promise<DriverFullHistoryResponse> {
  const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/drivers/${driverId}/history`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });

  const json = await res.json();

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('UNAUTHORIZED');
    }
    throw new Error(json.error?.message || `Failed to fetch driver history logs (HTTP ${res.status})`);
  }

  return json.data;
}


