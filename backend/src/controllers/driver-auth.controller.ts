import { Request, Response, NextFunction } from 'express';
import { DriverAuthService } from '../services/driver-auth.service.js';
import { sendSuccess } from '../utils/response.util.js';

export class DriverAuthController {
  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { phone, pin, licenseNumber } = req.body;
      const result = await DriverAuthService.login(phone, pin, licenseNumber);
      sendSuccess(res, result, 'Driver login successful');
    } catch (error) {
      next(error);
    }
  }

  static async logout(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      sendSuccess(res, { loggedOut: true }, 'Driver logged out successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const driverId = req.driver!.id;
      const profile = await DriverAuthService.getDriverProfile(driverId);
      sendSuccess(res, profile, 'Driver profile and assigned bus retrieved');
    } catch (error) {
      next(error);
    }
  }
}
