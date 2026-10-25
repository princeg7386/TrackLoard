import { Router, Request, Response } from 'express';
import authRouter from './auth.routes.js';
import driverAuthRouter from './driver-auth.routes.js';
import parentRouter from './parent-identity.routes.js';
import schoolProfileRouter from './school-profile.routes.js';
import dashboardRouter from './dashboard.routes.js';
import busRouter from './bus.routes.js';
import driverRouter from './driver.routes.js';
import studentRouter from './student.routes.js';
import telemetryRouter from './telemetry.routes.js';
import routingRouter from './routing.routes.js';
import dynamicPickupRouter from './dynamic-pickup.routes.js';
import tripRouter from './trip.routes.js';
import driverWhatsappRouter from './driver-whatsapp.routes.js';
import driverAttendanceRouter from './driver-attendance.routes.js';
import parentWhatsappRouter from './parent-whatsapp.routes.js';
import notificationRouter from './notification.routes.js';

const apiRouter = Router();

// Subdomain Routers
apiRouter.use('/auth', authRouter);
apiRouter.use('/driver/auth', driverAuthRouter);
apiRouter.use('/driver/whatsapp', driverWhatsappRouter);
apiRouter.use('/driver/attendance', driverAttendanceRouter);
apiRouter.use('/attendance', driverAttendanceRouter);
apiRouter.use('/parent/whatsapp', parentWhatsappRouter);
apiRouter.use('/parent', parentRouter);
apiRouter.use('/parent', dynamicPickupRouter);
apiRouter.use('/telemetry', telemetryRouter);
apiRouter.use('/routing', routingRouter);
apiRouter.use('/schools', schoolProfileRouter);
apiRouter.use('/schools', dashboardRouter);
apiRouter.use('/schools', busRouter);
apiRouter.use('/schools', driverRouter);
apiRouter.use('/schools', studentRouter);
apiRouter.use('/schools', tripRouter);
apiRouter.use('/schools', notificationRouter);

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
      dashboardSummary: '/api/v1/schools/:schoolId/dashboard/summary',
      buses: '/api/v1/schools/:schoolId/buses',
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

