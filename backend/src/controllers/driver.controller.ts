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
      if (!schoolId) {
        res.status(400).json({ success: false, error: { message: 'School ID is required' } });
        return;
      }
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
      if (!schoolId) {
        res.status(400).json({ success: false, error: { message: 'School ID is required' } });
        return;
      }
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
      if (!schoolId || !driverId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Driver ID are required' } });
        return;
      }
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
      if (!schoolId || !driverId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Driver ID are required' } });
        return;
      }
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
      if (!schoolId || !driverId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Driver ID are required' } });
        return;
      }
      const history = await DriverService.getDriverFullHistory(schoolId, driverId);

      res.status(200).json({
        success: true,
        data: history,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Updates driver profile information
   * PUT /api/v1/schools/:schoolId/drivers/:driverId
   */
  public static async updateDriver(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, driverId } = req.params;
      if (!schoolId || !driverId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Driver ID are required' } });
        return;
      }
      const userId = req.user?.id;
      const ipAddress = req.ip;

      const updated = await DriverService.updateDriver(schoolId, driverId, req.body, userId, ipAddress);

      res.status(200).json({
        success: true,
        data: updated,
        message: 'Driver profile updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Resets driver mobile app login PIN
   * POST /api/v1/schools/:schoolId/drivers/:driverId/reset-pin
   */
  public static async resetPin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, driverId } = req.params;
      if (!schoolId || !driverId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Driver ID are required' } });
        return;
      }
      const { pin } = req.body;
      const userId = req.user?.id;
      const ipAddress = req.ip;

      await DriverService.resetDriverPin(schoolId, driverId, pin, userId, ipAddress);

      res.status(200).json({
        success: true,
        message: 'Driver login PIN reset successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Revokes all active driver mobile sessions
   * POST /api/v1/schools/:schoolId/drivers/:driverId/revoke-sessions
   */
  public static async revokeSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, driverId } = req.params;
      if (!schoolId || !driverId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Driver ID are required' } });
        return;
      }
      const userId = req.user?.id;
      const ipAddress = req.ip;

      await DriverService.revokeDriverSessions(schoolId, driverId, userId, ipAddress);

      res.status(200).json({
        success: true,
        message: 'Driver sessions revoked successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Removes / soft-deletes driver profile
   * DELETE /api/v1/schools/:schoolId/drivers/:driverId
   */
  public static async removeDriver(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, driverId } = req.params;
      if (!schoolId || !driverId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Driver ID are required' } });
        return;
      }
      const userId = req.user?.id;
      const ipAddress = req.ip;

      await DriverService.removeDriver(schoolId, driverId, userId, ipAddress);

      res.status(200).json({
        success: true,
        message: 'Driver profile removed successfully',
      });
    } catch (error) {
      next(error);
    }
  }
}





