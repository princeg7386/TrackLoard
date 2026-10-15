import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { validateRequest } from '../middlewares/validate.middleware.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import {
  LoginRequestSchema,
  ForgotPasswordRequestSchema,
  ResetPasswordRequestSchema,
  ChangePasswordRequestSchema,
  UpdateAdminProfileRequestSchema,
} from '@school-bus/shared';

import { authRateLimiter } from '../middlewares/rate-limiter.middleware.js';

const authRouter = Router();

// 1. Admin Login
authRouter.post(
  '/login',
  authRateLimiter,
  validateRequest({ body: LoginRequestSchema }),
  AuthController.login
);

// 2. Admin Logout
authRouter.post('/logout', AuthController.logout);

// 3. Forgot Password Request
authRouter.post(
  '/forgot-password',
  authRateLimiter,
  validateRequest({ body: ForgotPasswordRequestSchema }),
  AuthController.forgotPassword
);

// 4. Reset Password with Token
authRouter.post(
  '/reset-password',
  authRateLimiter,
  validateRequest({ body: ResetPasswordRequestSchema }),
  AuthController.resetPassword
);

// 5. Change Password (Authenticated)
authRouter.post(
  '/change-password',
  authenticateToken,
  validateRequest({ body: ChangePasswordRequestSchema }),
  AuthController.changePassword
);

// 6. Get Current User Profile (Authenticated)
authRouter.get('/me', authenticateToken, AuthController.getMe);

// 7. Update Admin Profile (Authenticated)
authRouter.put(
  '/profile',
  authenticateToken,
  validateRequest({ body: UpdateAdminProfileRequestSchema }),
  AuthController.updateProfile
);

export default authRouter;

