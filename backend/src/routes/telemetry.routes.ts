import { Router } from 'express';
import { TelemetryController } from '../controllers/telemetry.controller.js';
import { validateRequest } from '../middlewares/validate.middleware.js';
import { authenticateDriver } from '../middlewares/driver-auth.middleware.js';
import { TelemetryIngestSchema, TelemetryBatchIngestSchema } from '@school-bus/shared';

const telemetryRouter = Router();

// 1. Ingest single GPS location ping (Driver auth)
telemetryRouter.post(
  '/ingest',
  authenticateDriver,
  validateRequest({ body: TelemetryIngestSchema }),
  TelemetryController.ingest
);

// 2. Ingest batch of offline buffered GPS location pings (Driver auth)
telemetryRouter.post(
  '/batch',
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

export default telemetryRouter;
