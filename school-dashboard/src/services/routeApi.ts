import {
  RouteDetail,
  CreateRouteRequest,
  RouteStopDetail,
  AddRouteStopRequest,
  ReorderRouteStopsRequest,
  UpdateRouteStopRequest,
  RouteStopCalculationResult,
} from '@school-bus/shared';
import { apiRequest } from './api-client';

export class RouteApiService {
  /**
   * List all routes for a school
   */
  public static async listRoutes(schoolId: string): Promise<RouteDetail[]> {
    return apiRequest<RouteDetail[]>(`/schools/${schoolId}/routes`);
  }

  /**
   * Get single route detail with bus, driver, and metrics
   */
  public static async getRoute(schoolId: string, routeId: string): Promise<RouteDetail> {
    return apiRequest<RouteDetail>(`/schools/${schoolId}/routes/${routeId}`);
  }

  /**
   * Create a new route
   */
  public static async createRoute(schoolId: string, payload: CreateRouteRequest): Promise<RouteDetail> {
    return apiRequest<RouteDetail>(`/schools/${schoolId}/routes`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * List all stops for a route ordered by sequence_order ASC
   */
  public static async listRouteStops(schoolId: string, routeId: string): Promise<RouteStopDetail[]> {
    return apiRequest<RouteStopDetail[]>(`/schools/${schoolId}/routes/${routeId}/stops`);
  }

  /**
   * Add a new pickup stop to a route
   */
  public static async addRouteStop(
    schoolId: string,
    routeId: string,
    payload: AddRouteStopRequest
  ): Promise<RouteStopDetail> {
    return apiRequest<RouteStopDetail>(`/schools/${schoolId}/routes/${routeId}/stops`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Reorder pickup stops sequence for a route
   */
  public static async reorderRouteStops(
    schoolId: string,
    routeId: string,
    payload: ReorderRouteStopsRequest
  ): Promise<RouteStopDetail[]> {
    return apiRequest<RouteStopDetail[]>(`/schools/${schoolId}/routes/${routeId}/stops/reorder`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Update an individual stop details or sequence
   */
  public static async updateRouteStop(
    schoolId: string,
    routeId: string,
    stopId: string,
    payload: UpdateRouteStopRequest
  ): Promise<RouteStopDetail> {
    return apiRequest<RouteStopDetail>(`/schools/${schoolId}/routes/${routeId}/stops/${stopId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Remove / soft-delete a pickup stop from a route
   */
  public static async removeRouteStop(
    schoolId: string,
    routeId: string,
    stopId: string
  ): Promise<{ success: boolean; removedStopId: string; remainingStopsCount: number }> {
    return apiRequest<{ success: boolean; removedStopId: string; remainingStopsCount: number }>(
      `/schools/${schoolId}/routes/${routeId}/stops/${stopId}`,
      {
        method: 'DELETE',
      }
    );
  }

  /**
   * Retrieve driving route directions, path polyline, distance, and duration
   */
  public static async getRouteDirections(
    schoolId: string,
    routeId: string
  ): Promise<RouteStopCalculationResult> {
    return apiRequest<RouteStopCalculationResult>(
      `/routing/schools/${schoolId}/routes/${routeId}/directions`
    );
  }
}
