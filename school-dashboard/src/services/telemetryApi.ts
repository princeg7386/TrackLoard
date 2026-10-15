/**
 * Phase 12.1 — Telemetry API client for the School Admin Dashboard.
 *
 * All functions wrap the existing apiRequest helper and are typed against the
 * shared package interfaces. No hardcoded UUIDs or demo data.
 */
import { apiRequest } from './api-client';
import type { FleetGpsHealthOverview, ActiveTripStateResponse } from '@school-bus/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

/**
 * Fetch fleet GPS health overview for a school.
 * Used by the Live Operations page to render the bus state list.
 */
export async function getFleetHealth(schoolId: string): Promise<FleetGpsHealthOverview> {
  return apiRequest<FleetGpsHealthOverview>(`/telemetry/schools/${schoolId}/health`);
}

/**
 * Fetch the current state snapshot for a single bus.
 * Returns live GPS + active trip + route + driver info.
 */
export async function getBusState(schoolId: string, busId: string): Promise<ActiveTripStateResponse> {
  return apiRequest<ActiveTripStateResponse>(`/schools/${schoolId}/buses/${busId}/state`);
}

/**
 * Open a Server-Sent Events stream for a school's fleet feed.
 *
 * Browser EventSource cannot send Authorization headers, so we pass the JWT
 * as a `?token=` query parameter (supported by authenticateToken middleware).
 *
 * @returns An EventSource instance — caller must call .close() on cleanup.
 */
export function openSchoolFeed(
  schoolId: string,
  onEvent: (event: MessageEvent) => void,
  onError?: (event: Event) => void
): EventSource {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('sb_auth_token') || '' : '';

  const url = `${API_BASE}/telemetry/schools/${schoolId}/feed?token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);

  es.addEventListener('initial_state', onEvent);
  es.addEventListener('location_update', onEvent);

  if (onError) {
    es.onerror = onError;
  }

  return es;
}
