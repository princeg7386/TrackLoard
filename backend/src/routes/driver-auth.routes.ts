import { Router } from 'express';
import { DriverAuthController } from '../controllers/driver-auth.controller.js';
import { validateRequest } from '../middlewares/validate.middleware.js';
import { authenticateDriver, authenticateDriverOptional } from '../middlewares/driver-auth.middleware.js';
import { DriverLoginRequestSchema } from '@school-bus/shared';

import { authRateLimiter } from '../middlewares/rate-limiter.middleware.js';

const driverAuthRouter = Router();

// 1. Driver Login via Phone (+ optional PIN/License)
driverAuthRouter.post(
  '/login',
  authRateLimiter,
  validateRequest({ body: DriverLoginRequestSchema }),
  DriverAuthController.login
);

// 2. Driver Logout
driverAuthRouter.post('/logout', authenticateDriverOptional, DriverAuthController.logout);

// 3. Driver Profile, Assigned Bus & Trips (Authenticated)
driverAuthRouter.get('/me', authenticateDriver, DriverAuthController.getProfile);

export default driverAuthRouter;
