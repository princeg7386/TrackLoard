import { Router, Request, Response } from 'express';
import { verifyPostGisConnection } from '../config/database.js';
import { env } from '../config/env.js';

const router = Router();
const startTime = Date.now();

router.get('/health', async (_req: Request, res: Response) => {
  const dbStatus = await verifyPostGisConnection();
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  const isHealthy = dbStatus.connected;
  const statusCode = isHealthy ? 200 : 503;

  res.status(statusCode).json({
    success: isHealthy,
    status: isHealthy ? 'healthy' : 'degraded',
    service: env.APP_NAME,
    environment: env.NODE_ENV,
    uptimeSeconds,
    timestamp: new Date().toISOString(),
    components: {
      database: {
        status: dbStatus.connected ? 'up' : 'down',
        postgis: dbStatus.postgisVersion || 'unavailable',
        error: dbStatus.error,
      },
      providers: {
        routing: env.ROUTING_PROVIDER,
        messaging: env.MESSAGING_PROVIDER,
      },
    },
    system: {
      memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      nodeVersion: process.version,
    },
  });
});

export default router;

