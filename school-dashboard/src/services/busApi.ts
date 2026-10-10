import {
  BusWithDriver,
  BusDetailView,
  BusTripHistoryItem,
  BusIncidentHistoryItem,
  BusAttendanceHistoryResponse,
  BusFullHistoryResponse,
  CreateBusRequest,
  UpdateBusRequest,
  AssignBusPayload,
  Driver,
  Route,
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
    return [];
  }
}

/**
 * Fetches detailed bus view including live GPS location and current active trip
 */
export async function fetchBusDetail(schoolId: string, busId: string): Promise<BusDetailView> {
  const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/buses/${busId}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });

  const json = await res.json();

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('UNAUTHORIZED');
    }
    throw new Error(json.error?.message || `Failed to fetch bus details (HTTP ${res.status})`);
  }

  return json.data;
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
 * Updates vehicle specifications and details
 */
export async function updateBus(
  schoolId: string,
  busId: string,
  payload: UpdateBusRequest
): Promise<BusWithDriver> {
  const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/buses/${busId}`, {
    method: 'PUT',
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
    throw new Error(json.error?.message || `Failed to update vehicle (HTTP ${res.status})`);
  }

  return json.data;
}

/**
 * Soft-deletes a vehicle from the fleet
 */
export async function deleteBus(schoolId: string, busId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/buses/${busId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  const json = await res.json();

  if (!res.ok) {
    if (res.status === 400) {
      throw new Error(json.error?.message || 'Cannot remove vehicle while an active trip is in progress.');
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error('UNAUTHORIZED');
    }
    throw new Error(json.error?.message || `Failed to remove vehicle (HTTP ${res.status})`);
  }
}

/**
 * Updates driver and/or route assignments for a bus atomically
 */
export async function updateBusAssignments(
  schoolId: string,
  busId: string,
  payload: AssignBusPayload
): Promise<BusWithDriver> {
  const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/buses/${busId}/assignments`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  const json = await res.json();

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('UNAUTHORIZED');
    }
    throw new Error(json.error?.message || `Failed to update assignments (HTTP ${res.status})`);
  }

  return json.data;
}

/**
 * Fetches registered drivers for assignment dropdowns
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

/**
 * Fetches configured routes for assignment dropdowns
 */
export async function fetchAvailableRoutes(schoolId: string): Promise<Route[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/routes`, {
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
 * Fetches consolidated vehicle history (Bus details, Trips, Incidents, Attendance)
 */
export async function fetchBusFullHistory(
  schoolId: string,
  busId: string
): Promise<BusFullHistoryResponse> {
  const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/buses/${busId}/history`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });

  const json = await res.json();

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('UNAUTHORIZED');
    }
    throw new Error(json.error?.message || `Failed to fetch bus history (HTTP ${res.status})`);
  }

  return json.data;
}

/**
 * Fetches trip history for a bus
 */
export async function fetchBusTripHistory(
  schoolId: string,
  busId: string,
  limit = 50,
  offset = 0
): Promise<BusTripHistoryItem[]> {
  const res = await fetch(
    `${API_BASE_URL}/schools/${schoolId}/buses/${busId}/history/trips?limit=${limit}&offset=${offset}`,
    {
      method: 'GET',
      headers: getAuthHeaders(),
    }
  );

  const json = await res.json();

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('UNAUTHORIZED');
    }
    throw new Error(json.error?.message || `Failed to fetch trip history (HTTP ${res.status})`);
  }

  return json.data || [];
}

/**
 * Fetches safety incident and SOS alert history for a bus
 */
export async function fetchBusIncidentHistory(
  schoolId: string,
  busId: string,
  limit = 50,
  offset = 0
): Promise<BusIncidentHistoryItem[]> {
  const res = await fetch(
    `${API_BASE_URL}/schools/${schoolId}/buses/${busId}/history/incidents?limit=${limit}&offset=${offset}`,
    {
      method: 'GET',
      headers: getAuthHeaders(),
    }
  );

  const json = await res.json();

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('UNAUTHORIZED');
    }
    throw new Error(json.error?.message || `Failed to fetch incident history (HTTP ${res.status})`);
  }

  return json.data || [];
}

/**
 * Fetches attendance history and student boarding records for a bus
 */
export async function fetchBusAttendanceHistory(
  schoolId: string,
  busId: string,
  limit = 50
): Promise<BusAttendanceHistoryResponse> {
  const res = await fetch(
    `${API_BASE_URL}/schools/${schoolId}/buses/${busId}/history/attendance?limit=${limit}`,
    {
      method: 'GET',
      headers: getAuthHeaders(),
    }
  );

  const json = await res.json();

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('UNAUTHORIZED');
    }
    throw new Error(json.error?.message || `Failed to fetch attendance history (HTTP ${res.status})`);
  }

  return json.data;
}

