import { Router } from 'express';
import { TelemetryController } from '../controllers/telemetry.controller.js';
import { validateRequest } from '../middlewares/validate.middleware.js';
import { authenticateDriver } from '../middlewares/driver-auth.middleware.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { requireTenantScope } from '../middlewares/tenant-isolation.middleware.js';
import { TelemetryIngestSchema, TelemetryBatchIngestSchema } from '@school-bus/shared';
import { telemetryIngestRateLimiter } from '../middlewares/rate-limiter.middleware.js';

const telemetryRouter = Router();

// 1. Ingest single GPS location ping (Driver auth)
telemetryRouter.post(
  '/ingest',
  telemetryIngestRateLimiter,
  authenticateDriver,
  validateRequest({ body: TelemetryIngestSchema }),
  TelemetryController.ingest
);

// 2. Ingest batch of offline buffered GPS location pings (Driver auth)
telemetryRouter.post(
  '/batch',
  telemetryIngestRateLimiter,
  authenticateDriver,
  validateRequest({ body: TelemetryBatchIngestSchema }),
  TelemetryController.ingestBatch
);

// 3. Get latest bus location
telemetryRouter.get(
  '/buses/:busId/latest',
  TelemetryController.getLatestBusLocation
);

// 4. Get location trail for a trip
telemetryRouter.get(
  '/trips/:tripId/trail',
  TelemetryController.getTripTrail
);

// 5. Get fleet GPS health overview for school admin canvas
telemetryRouter.get(
  '/schools/:schoolId/health',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  TelemetryController.getFleetHealth
);

// 6. Get single bus GPS health summary
telemetryRouter.get(
  '/buses/:busId/health',
  TelemetryController.getBusHealth
);

// 7. Real-time SSE stream for school fleet canvas (Tenant isolated)
telemetryRouter.get(
  '/schools/:schoolId/feed',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  TelemetryController.streamSchoolFeed
);

// 8. Real-time SSE stream for trip tracking
telemetryRouter.get(
  '/trips/:tripId/feed',
  TelemetryController.streamTripFeed
);

export default telemetryRouter;


