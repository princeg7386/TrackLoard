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
      if (!schoolId) {
        res.status(400).json({ success: false, error: { message: 'School ID is required' } });
        return;
      }
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
      if (!schoolId) {
        res.status(400).json({ success: false, error: { message: 'School ID is required' } });
        return;
      }
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
   * Retrieves single bus detailed view (with GPS location & current trip)
   * GET /api/v1/schools/:schoolId/buses/:busId
   */
  public static async getBus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, busId } = req.params;
      if (!schoolId || !busId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Bus ID are required' } });
        return;
      }
      const bus = await BusService.getBusDetail(schoolId, busId);

      res.status(200).json({
        success: true,
        data: bus,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Updates an existing vehicle's specifications & profile
   * PUT /api/v1/schools/:schoolId/buses/:busId
   */
  public static async updateBus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, busId } = req.params;
      if (!schoolId || !busId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Bus ID are required' } });
        return;
      }
      const userId = req.user?.id;
      const ipAddress = req.ip;

      const updatedBus = await BusService.updateBus(
        schoolId,
        busId,
        req.body,
        userId,
        ipAddress
      );

      res.status(200).json({
        success: true,
        data: updatedBus,
        message: 'Vehicle specifications updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Soft-deletes a vehicle from the fleet
   * DELETE /api/v1/schools/:schoolId/buses/:busId
   */
  public static async deleteBus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, busId } = req.params;
      if (!schoolId || !busId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Bus ID are required' } });
        return;
      }
      const userId = req.user?.id;
      const ipAddress = req.ip;

      const result = await BusService.deleteBus(schoolId, busId, userId, ipAddress);

      res.status(200).json({
        success: true,
        message: result.message,
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
      if (!schoolId || !busId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Bus ID are required' } });
        return;
      }
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
      if (!schoolId) {
        res.status(400).json({ success: false, error: { message: 'School ID is required' } });
        return;
      }
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
      if (!schoolId) {
        res.status(400).json({ success: false, error: { message: 'School ID is required' } });
        return;
      }
      const routes = await BusService.getRoutes(schoolId);

      res.status(200).json({
        success: true,
        data: routes,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieves full vehicle history (Bus details, Trips, Incidents, Attendance)
   * GET /api/v1/schools/:schoolId/buses/:busId/history
   */
  public static async getBusHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, busId } = req.params;
      if (!schoolId || !busId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Bus ID are required' } });
        return;
      }
      const history = await BusService.getBusFullHistory(schoolId, busId);

      res.status(200).json({
        success: true,
        data: history,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieves paginated trip history for a vehicle
   * GET /api/v1/schools/:schoolId/buses/:busId/history/trips
   */
  public static async getBusTripHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, busId } = req.params;
      if (!schoolId || !busId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Bus ID are required' } });
        return;
      }
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;

      const trips = await BusService.getBusTripHistory(schoolId, busId, limit, offset);

      res.status(200).json({
        success: true,
        data: trips,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieves combined safety incident and emergency SOS history for a vehicle
   * GET /api/v1/schools/:schoolId/buses/:busId/history/incidents
   */
  public static async getBusIncidentHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, busId } = req.params;
      if (!schoolId || !busId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Bus ID are required' } });
        return;
      }
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;

      const incidents = await BusService.getBusIncidentHistory(schoolId, busId, limit, offset);

      res.status(200).json({
        success: true,
        data: incidents,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieves attendance summaries and student boarding records for a vehicle
   * GET /api/v1/schools/:schoolId/buses/:busId/history/attendance
   */
  public static async getBusAttendanceHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, busId } = req.params;
      if (!schoolId || !busId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Bus ID are required' } });
        return;
      }
      const limit = Number(req.query.limit) || 50;

      const attendance = await BusService.getBusAttendanceHistory(schoolId, busId, limit);

      res.status(200).json({
        success: true,
        data: attendance,
      });
    } catch (error) {
      next(error);
    }
  }
}


