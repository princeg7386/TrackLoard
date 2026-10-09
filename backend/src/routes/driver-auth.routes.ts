import { Router } from 'express';
import { DriverAuthController } from '../controllers/driver-auth.controller.js';
import { validateRequest } from '../middlewares/validate.middleware.js';
import { authenticateDriver } from '../middlewares/driver-auth.middleware.js';
import { DriverLoginRequestSchema } from '@school-bus/shared';

const driverAuthRouter = Router();

// 1. Driver Login via Phone (+ optional PIN/License)
driverAuthRouter.post(
  '/login',
  validateRequest({ body: DriverLoginRequestSchema }),
  DriverAuthController.login
);

// 2. Driver Logout
driverAuthRouter.post('/logout', DriverAuthController.logout);

// 3. Driver Profile, Assigned Bus & Trips (Authenticated)
driverAuthRouter.get('/me', authenticateDriver, DriverAuthController.getProfile);

export default driverAuthRouter;
