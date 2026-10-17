import { Request, Response, NextFunction } from 'express';
import { CreateRouteRequest } from '@school-bus/shared';
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
      const result = await RouteService.createRoute(schoolId, req.body, actorSchoolId);
      sendSuccess(res, result, 'Route created successfully', 201);
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
}
