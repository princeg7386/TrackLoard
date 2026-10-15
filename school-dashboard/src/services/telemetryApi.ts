/**
 * Phase 12.1 & 12.2 — Telemetry API client for the School Admin Dashboard.
 *
 * All functions wrap the existing apiRequest helper and are typed against the
 * shared package interfaces. No hardcoded UUIDs or demo data.
 */
import { apiRequest } from './api-client';
import type { FleetGpsHealthOverview, ActiveTripStateResponse, BusGpsHealthSummary } from '@school-bus/shared';

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
 * Fetch historical GPS location trail for an active trip.
 */
export async function getTripTrail(
  tripId: string,
  limit: number = 200
): Promise<{ tripId: string; count: number; trail: Array<{ latitude: number; longitude: number; speedKmh: number; recordedAt: string }> }> {
  return apiRequest(`/telemetry/trips/${tripId}/trail?limit=${limit}`);
}

export type FeedConnectionStatus = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'OFFLINE';

export interface ResilientFeedSubscription {
  close: () => void;
  getStatus: () => FeedConnectionStatus;
}

/**
 * Open a resilient Server-Sent Events stream with automatic reconnection (exponential backoff).
 *
 * @param path Relative path, e.g. `/telemetry/schools/${schoolId}/feed` or `/telemetry/buses/${busId}/feed`
 * @param onEvent Callback on incoming message events
 * @param onStatusChange Callback on connection status changes
 */
export function openResilientFeed(
  path: string,
  onEvent: (event: MessageEvent) => void,
  onStatusChange?: (status: FeedConnectionStatus) => void
): ResilientFeedSubscription {
  let isClosed = false;
  let eventSource: EventSource | null = null;
  let retryTimer: NodeJS.Timeout | null = null;
  let backoffMs = 1000;
  const maxBackoffMs = 16000;

  function connect() {
    if (isClosed) return;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      onStatusChange?.('OFFLINE');
      return;
    }

    onStatusChange?.(backoffMs > 1000 ? 'RECONNECTING' : 'CONNECTING');

    const token =
      typeof window !== 'undefined' ? localStorage.getItem('sb_auth_token') || '' : '';
    const delimiter = path.includes('?') ? '&' : '?';
    const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}${delimiter}token=${encodeURIComponent(token)}`;

    try {
      eventSource = new EventSource(url);

      eventSource.onopen = () => {
        backoffMs = 1000;
        onStatusChange?.('CONNECTED');
      };

      eventSource.addEventListener('initial_state', onEvent);
      eventSource.addEventListener('location_update', onEvent);

      eventSource.onerror = () => {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }

        if (isClosed) return;

        onStatusChange?.('RECONNECTING');

        // Exponential backoff
        retryTimer = setTimeout(() => {
          backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
          connect();
        }, backoffMs);
      };
    } catch {
      onStatusChange?.('RECONNECTING');
      retryTimer = setTimeout(() => {
        connect();
      }, 2000);
    }
  }

  // Network offline / online handling
  const handleOnline = () => {
    if (!isClosed && (!eventSource || eventSource.readyState === EventSource.CLOSED)) {
      backoffMs = 1000;
      connect();
    }
  };
  const handleOffline = () => {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    onStatusChange?.('OFFLINE');
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  }

  connect();

  return {
    close: () => {
      isClosed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      }
    },
    getStatus: () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return 'OFFLINE';
      if (!eventSource) return 'CONNECTING';
      switch (eventSource.readyState) {
        case EventSource.OPEN:
          return 'CONNECTED';
        case EventSource.CONNECTING:
          return 'CONNECTING';
        default:
          return 'RECONNECTING';
      }
    },
  };
}

/**
 * Open a resilient Server-Sent Events stream for a school's fleet feed (Subscription by School).
 */
export function openSchoolFeed(
  schoolId: string,
  onEvent: (event: MessageEvent) => void,
  onStatusChange?: (status: FeedConnectionStatus) => void
): ResilientFeedSubscription {
  return openResilientFeed(`/telemetry/schools/${schoolId}/feed`, onEvent, onStatusChange);
}

/**
 * Open a resilient Server-Sent Events stream for a specific bus (Subscription by Bus).
 */
export function openBusFeed(
  busId: string,
  onEvent: (event: MessageEvent) => void,
  onStatusChange?: (status: FeedConnectionStatus) => void
): ResilientFeedSubscription {
  return openResilientFeed(`/telemetry/buses/${busId}/feed`, onEvent, onStatusChange);
}
