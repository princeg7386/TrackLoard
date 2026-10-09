import { Router, Request, Response } from 'express';

const apiRouter = Router();

apiRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'School Bus Tracking Platform API v1',
    version: '1.0.0',
    documentation: '/docs',
    endpoints: {
      health: '/health',
      auth: '/api/v1/auth',
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
