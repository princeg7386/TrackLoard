import { Request, Response, NextFunction } from 'express';
import { query } from '../config/database.js';
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

  static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (req.driver) {
        await query(
          `UPDATE drivers 
           SET token_version = COALESCE(token_version, 1) + 1,
               session_revoked_at = NOW(),
               updated_at = NOW() 
           WHERE id = $1 AND deleted_at IS NULL;`,
          [req.driver.id]
        );
      }
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

