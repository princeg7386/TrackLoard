import { Request, Response, NextFunction } from 'express';
import { DriverService } from '../services/driver.service.js';

export class DriverController {
  /**
   * Registers a new driver profile in school directory
   * POST /api/v1/schools/:schoolId/drivers
   */
  public static async createDriver(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      const userId = req.user?.id;
      const ipAddress = req.ip;

      const driver = await DriverService.createDriver(schoolId, req.body, userId, ipAddress);

      res.status(201).json({
        success: true,
        data: driver,
        message: 'Driver profile registered successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Lists all drivers registered for a school
   * GET /api/v1/schools/:schoolId/drivers
   */
  public static async listDrivers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      const drivers = await DriverService.getDrivers(schoolId);

      res.status(200).json({
        success: true,
        data: drivers,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieves single driver profile
   * GET /api/v1/schools/:schoolId/drivers/:driverId
   */
  public static async getDriver(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, driverId } = req.params;
      const driver = await DriverService.getDriverById(schoolId, driverId);

      res.status(200).json({
        success: true,
        data: driver,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Assigns or unassigns a bus for a driver
   * PUT /api/v1/schools/:schoolId/drivers/:driverId/assignments
   */
  public static async assignBus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, driverId } = req.params;
      const userId = req.user?.id;
      const ipAddress = req.ip;

      const updatedDriver = await DriverService.assignBus(schoolId, driverId, req.body, userId, ipAddress);

      res.status(200).json({
        success: true,
        data: updatedDriver,
        message: 'Driver bus assignment updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieves full operational history for a driver (Trips, Incidents, Attendance)
   * GET /api/v1/schools/:schoolId/drivers/:driverId/history
   */
  public static async getDriverHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, driverId } = req.params;
      const history = await DriverService.getDriverFullHistory(schoolId, driverId);

      res.status(200).json({
        success: true,
        data: history,
      });
    } catch (error) {
      next(error);
    }
  }
}



