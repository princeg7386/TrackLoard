import { Router, Request, Response } from 'express';
import authRouter from './auth.routes.js';
import driverAuthRouter from './driver-auth.routes.js';
import parentRouter from './parent-identity.routes.js';
import schoolProfileRouter from './school-profile.routes.js';

const apiRouter = Router();

// Subdomain Routers
apiRouter.use('/auth', authRouter);
apiRouter.use('/driver/auth', driverAuthRouter);
apiRouter.use('/parent', parentRouter);
apiRouter.use('/schools', schoolProfileRouter);

apiRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'School Bus Tracking Platform API v1',
    version: '1.0.0',
    documentation: '/docs',
    endpoints: {
      health: '/health',
      auth: '/api/v1/auth',
      adminAuth: '/api/v1/auth',
      driverAuth: '/api/v1/driver/auth',
      schools: '/api/v1/schools',
      buses: '/api/v1/buses',
      drivers: '/api/v1/drivers',
      routes: '/api/v1/routes',
      trips: '/api/v1/trips',
      telemetry: '/api/v1/telemetry',
      attendance: '/api/v1/attendance',
      parentTracking: '/api/v1/parent/track',
    },
  });
});

export default apiRouter;
