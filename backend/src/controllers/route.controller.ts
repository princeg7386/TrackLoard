import { Request, Response, NextFunction } from 'express';
import {
  CreateRouteRequest,
  UpdateRouteRequest,
  AddRouteStopRequest,
  ReorderRouteStopsRequest,
  UpdateRouteStopRequest,
} from '@school-bus/shared';
import { RouteService } from '../services/route.service.js';
import { sendSuccess } from '../utils/response.util.js';

export class RouteController {
  /**
   * POST /api/v1/schools/:schoolId/routes
   * Creates a new transit route with assigned bus and driver
   */
  public static async createRoute(
    req: Request<{ schoolId: string }, {}, CreateRouteRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId } = req.params;
      const actorSchoolId = req.user?.schoolId || undefined;
      const actorUserId = req.user?.id || undefined;
      const actorUserRole = req.user?.role || undefined;
      const result = await RouteService.createRoute(schoolId, req.body, actorSchoolId, actorUserId, actorUserRole);
      sendSuccess(res, result, 'Route created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/v1/schools/:schoolId/routes/:routeId
   * Updates route specifications with change tracking and audit log
   */
  public static async updateRoute(
    req: Request<{ schoolId: string; routeId: string }, {}, UpdateRouteRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, routeId } = req.params;
      const actorSchoolId = req.user?.schoolId || undefined;
      const actorUserId = req.user?.id || undefined;
      const actorUserRole = req.user?.role || undefined;
      const result = await RouteService.updateRoute(schoolId, routeId, req.body, actorSchoolId, actorUserId, actorUserRole);
      sendSuccess(res, result, 'Route updated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/schools/:schoolId/routes/:routeId/history
   * Retrieves chronological audit history and state diffs for a route
   */
  public static async getRouteHistory(
    req: Request<{ schoolId: string; routeId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, routeId } = req.params;
      const actorSchoolId = req.user?.schoolId || undefined;
      const result = await RouteService.getRouteHistory(schoolId, routeId, actorSchoolId);
      sendSuccess(res, result, 'Route history retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/schools/:schoolId/routes/:routeId
   * Retrieves single route details including bus, driver, stops, and student counts
   */
  public static async getRoute(
    req: Request<{ schoolId: string; routeId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, routeId } = req.params;
      const actorSchoolId = req.user?.schoolId || undefined;
      const result = await RouteService.getRouteById(schoolId, routeId, actorSchoolId);
      sendSuccess(res, result, 'Route retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/schools/:schoolId/routes
   * Lists all routes for a school with assigned bus, driver, and aggregate metrics
   */
  public static async listRoutes(
    req: Request<{ schoolId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId } = req.params;
      const actorSchoolId = req.user?.schoolId || undefined;
      const result = await RouteService.listRoutes(schoolId, actorSchoolId);
      sendSuccess(res, result, 'Routes retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/schools/:schoolId/routes/:routeId/stops
   * Lists all pickup stops for a route ordered by sequence_order ASC
   */
  public static async listStops(
    req: Request<{ schoolId: string; routeId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, routeId } = req.params;
      const actorSchoolId = req.user?.schoolId || undefined;
      const result = await RouteService.listRouteStops(schoolId, routeId, actorSchoolId);
      sendSuccess(res, result, 'Route stops retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/schools/:schoolId/routes/:routeId/stops
   * Adds a new pickup stop to the route
   */
  public static async addStop(
    req: Request<{ schoolId: string; routeId: string }, {}, AddRouteStopRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, routeId } = req.params;
      const actorSchoolId = req.user?.schoolId || undefined;
      const actorUserId = req.user?.id || undefined;
      const actorUserRole = req.user?.role || undefined;
      const result = await RouteService.addRouteStop(schoolId, routeId, req.body, actorSchoolId, actorUserId, actorUserRole);
      sendSuccess(res, result, 'Pickup stop added successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/v1/schools/:schoolId/routes/:routeId/stops/reorder
   * Reorders the pickup sequence for the route
   */
  public static async reorderStops(
    req: Request<{ schoolId: string; routeId: string }, {}, ReorderRouteStopsRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, routeId } = req.params;
      const actorSchoolId = req.user?.schoolId || undefined;
      const actorUserId = req.user?.id || undefined;
      const actorUserRole = req.user?.role || undefined;
      const result = await RouteService.reorderRouteStops(schoolId, routeId, req.body.stopIds, actorSchoolId, actorUserId, actorUserRole);
      sendSuccess(res, result, 'Pickup stops reordered successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/v1/schools/:schoolId/routes/:routeId/stops/:stopId
   * Updates an individual pickup stop's details or sequence
   */
  public static async updateStop(
    req: Request<{ schoolId: string; routeId: string; stopId: string }, {}, UpdateRouteStopRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, routeId, stopId } = req.params;
      const actorSchoolId = req.user?.schoolId || undefined;
      const actorUserId = req.user?.id || undefined;
      const actorUserRole = req.user?.role || undefined;
      const result = await RouteService.updateRouteStop(schoolId, routeId, stopId, req.body, actorSchoolId, actorUserId, actorUserRole);
      sendSuccess(res, result, 'Pickup stop updated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/schools/:schoolId/routes/:routeId/stops/:stopId
   * Removes / soft-deletes a pickup stop and resequences remaining stops
   */
  public static async removeStop(
    req: Request<{ schoolId: string; routeId: string; stopId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, routeId, stopId } = req.params;
      const actorSchoolId = req.user?.schoolId || undefined;
      const actorUserId = req.user?.id || undefined;
      const actorUserRole = req.user?.role || undefined;
      const result = await RouteService.removeRouteStop(schoolId, routeId, stopId, actorSchoolId, actorUserId, actorUserRole);
      sendSuccess(res, result, 'Pickup stop removed successfully');
    } catch (error) {
      next(error);
    }
  }
}


