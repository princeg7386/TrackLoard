import { Request, Response, NextFunction } from 'express';
import { BusService } from '../services/bus.service.js';

export class BusController {
  /**
   * Registers a new vehicle in the school fleet
   * POST /api/v1/schools/:schoolId/buses
   */
  public static async createBus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      const userId = req.user?.id;
      const ipAddress = req.ip;

      const bus = await BusService.createBus(schoolId, req.body, userId, ipAddress);

      res.status(201).json({
        success: true,
        data: bus,
        message: 'Vehicle registered in fleet successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Lists all fleet vehicles for a school
   * GET /api/v1/schools/:schoolId/buses
   */
  public static async listBuses(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      const buses = await BusService.getBuses(schoolId);

      res.status(200).json({
        success: true,
        data: buses,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieves single bus details
   * GET /api/v1/schools/:schoolId/buses/:busId
   */
  public static async getBus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, busId } = req.params;
      const bus = await BusService.getBusById(schoolId, busId);

      res.status(200).json({
        success: true,
        data: bus,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Updates Driver and/or Route assignments for a bus
   * PUT /api/v1/schools/:schoolId/buses/:busId/assignments
   */
  public static async updateAssignments(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, busId } = req.params;
      const userId = req.user?.id;
      const ipAddress = req.ip;

      const updatedBus = await BusService.assignDriverAndRoute(
        schoolId,
        busId,
        req.body,
        userId,
        ipAddress
      );

      res.status(200).json({
        success: true,
        data: updatedBus,
        message: 'Bus assignments updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Lists drivers for dropdowns
   * GET /api/v1/schools/:schoolId/drivers
   */
  public static async listDrivers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      const drivers = await BusService.getDrivers(schoolId);

      res.status(200).json({
        success: true,
        data: drivers,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Lists routes for dropdowns
   * GET /api/v1/schools/:schoolId/routes
   */
  public static async listRoutes(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      const routes = await BusService.getRoutes(schoolId);

      res.status(200).json({
        success: true,
        data: routes,
      });
    } catch (error) {
      next(error);
    }
  }
}
