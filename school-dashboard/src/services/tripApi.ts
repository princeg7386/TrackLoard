import {
  TripDetailResponse,
  CreateTripRequest,
  CreateTodayTripRequest,
  GenerateDailyTripsRequest,
  GenerateDailyTripsResponse,
  StartTripRequest,
  UpdateTripProgressRequest,
  CancelTripRequest,
  TripStatus,
} from '@school-bus/shared';
import { apiRequest } from './api-client';

export interface TripQueryFilters {
  date?: string;
  routeId?: string;
  busId?: string;
  driverId?: string;
  status?: TripStatus;
}

export class TripApiService {
  /**
   * List scheduled and active trips for a school
   */
  public static async listTrips(
    schoolId: string,
    filters?: TripQueryFilters
  ): Promise<TripDetailResponse[]> {
    const params = new URLSearchParams();
    if (filters?.date) params.append('date', filters.date);
    if (filters?.routeId) params.append('routeId', filters.routeId);
    if (filters?.busId) params.append('busId', filters.busId);
    if (filters?.driverId) params.append('driverId', filters.driverId);
    if (filters?.status) params.append('status', filters.status);

    const queryStr = params.toString() ? `?${params.toString()}` : '';
    return apiRequest<TripDetailResponse[]>(`/schools/${schoolId}/trips${queryStr}`);
  }

  /**
   * Get trip details by ID with computed lifecycle stage
   */
  public static async getTrip(schoolId: string, tripId: string): Promise<TripDetailResponse> {
    return apiRequest<TripDetailResponse>(`/schools/${schoolId}/trips/${tripId}`);
  }

  /**
   * Schedule a new trip
   */
  public static async createTrip(
    schoolId: string,
    payload: CreateTripRequest
  ): Promise<TripDetailResponse> {
    return apiRequest<TripDetailResponse>(`/schools/${schoolId}/trips`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Create today's trip with route, bus, driver attachment
   */
  public static async createTodayTrip(
    schoolId: string,
    payload: CreateTodayTripRequest
  ): Promise<TripDetailResponse> {
    return apiRequest<TripDetailResponse>(`/schools/${schoolId}/trips/today`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Generate today's trips in bulk across active routes
   */
  public static async generateDailyTrips(
    schoolId: string,
    payload?: GenerateDailyTripsRequest
  ): Promise<GenerateDailyTripsResponse> {
    return apiRequest<GenerateDailyTripsResponse>(`/schools/${schoolId}/trips/generate-daily`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  }

  /**
   * Start trip transition (NOT_STARTED -> STARTED)
   */
  public static async startTrip(
    schoolId: string,
    tripId: string,
    payload?: StartTripRequest
  ): Promise<TripDetailResponse> {
    return apiRequest<TripDetailResponse>(`/schools/${schoolId}/trips/${tripId}/start`, {
      method: 'POST',
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
  }

  /**
   * Update trip progress (stop sequence and delay)
   */
  public static async updateProgress(
    schoolId: string,
    tripId: string,
    payload: UpdateTripProgressRequest
  ): Promise<TripDetailResponse> {
    return apiRequest<TripDetailResponse>(`/schools/${schoolId}/trips/${tripId}/progress`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Mark trip as arrived at destination school campus
   */
  public static async arriveAtSchool(
    schoolId: string,
    tripId: string
  ): Promise<TripDetailResponse> {
    return apiRequest<TripDetailResponse>(`/schools/${schoolId}/trips/${tripId}/arrive-school`, {
      method: 'POST',
    });
  }

  /**
   * Complete trip (-> COMPLETED)
   */
  public static async completeTrip(
    schoolId: string,
    tripId: string
  ): Promise<TripDetailResponse> {
    return apiRequest<TripDetailResponse>(`/schools/${schoolId}/trips/${tripId}/complete`, {
      method: 'POST',
    });
  }

  /**
   * Cancel trip with reason
   */
  public static async cancelTrip(
    schoolId: string,
    tripId: string,
    payload: CancelTripRequest
  ): Promise<TripDetailResponse> {
    return apiRequest<TripDetailResponse>(`/schools/${schoolId}/trips/${tripId}/cancel`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}
