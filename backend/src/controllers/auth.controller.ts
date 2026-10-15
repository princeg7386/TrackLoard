import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';
import { sendSuccess } from '../utils/response.util.js';

export class AuthController {
  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body;
      const result = await AuthService.login(email, password);
      sendSuccess(res, result, 'Login successful');
    } catch (error) {
      next(error);
    }
  }

  static async logout(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // In JWT stateless architecture, client clears token; server returns 200 OK
      sendSuccess(res, { loggedOut: true }, 'Logged out successfully');
    } catch (error) {
      next(error);
    }
  }

  static async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;
      const result = await AuthService.forgotPassword(email);
      sendSuccess(
        res,
        {
          requested: true,
          // Only return token in test mode for automated testing convenience
          ...(process.env.NODE_ENV === 'test' ? { devResetToken: result.resetToken } : {}),
        },
        'If an account exists, a password reset link has been dispatched'
      );
    } catch (error) {
      next(error);
    }
  }

  static async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, newPassword } = req.body;
      const result = await AuthService.resetPassword(token, newPassword);
      sendSuccess(res, result, 'Password reset successfully. You may now login.');
    } catch (error) {
      next(error);
    }
  }

  static async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const { currentPassword, newPassword } = req.body;
      const result = await AuthService.changePassword(userId, currentPassword, newPassword);
      sendSuccess(res, result, 'Password changed successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const user = await AuthService.getMe(userId);
      sendSuccess(res, user, 'User profile retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const clientIp = req.socket.remoteAddress;
      const updated = await AuthService.updateAdminProfile(userId, req.body, clientIp);
      sendSuccess(res, updated, 'Admin profile updated successfully');
    } catch (error) {
      next(error);
    }
  }
}

