import { Router } from 'express';
import { TelemetryController } from '../controllers/telemetry.controller.js';
import { validateRequest } from '../middlewares/validate.middleware.js';
import { authenticateDriver } from '../middlewares/driver-auth.middleware.js';
import { authenticateToken, requireRoles } from '../middlewares/auth.middleware.js';
import {
  requireTenantScope,
  requireActorTenantScope,
} from '../middlewares/tenant-isolation.middleware.js';
import { TelemetryIngestSchema, TelemetryBatchIngestSchema, UserRole } from '@school-bus/shared';
import { telemetryIngestRateLimiter } from '../middlewares/rate-limiter.middleware.js';

const telemetryRouter = Router();

// 1. Ingest single GPS location ping (Driver auth only)
telemetryRouter.post(
  '/ingest',
  telemetryIngestRateLimiter,
  authenticateDriver,
  validateRequest({ body: TelemetryIngestSchema }),
  TelemetryController.ingest
);

// 2. Ingest batch of offline buffered GPS location pings (Driver auth only)
telemetryRouter.post(
  '/batch',
  telemetryIngestRateLimiter,
  authenticateDriver,
  validateRequest({ body: TelemetryBatchIngestSchema }),
  TelemetryController.ingestBatch
);

// 3. Get latest bus location
//    requireTenantScope: requireActorTenantScope ensures admin is school-scoped;
//    controller verifies bus belongs to req.user.schoolId before returning data.
telemetryRouter.get(
  '/buses/:busId/latest',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireActorTenantScope,
  TelemetryController.getLatestBusLocation
);

// 4. Get location trail for a trip
//    requireTenantScope: requireActorTenantScope ensures admin is school-scoped;
//    controller verifies trip belongs to req.user.schoolId before returning trail.
telemetryRouter.get(
  '/trips/:tripId/trail',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireActorTenantScope,
  TelemetryController.getTripTrail
);

// 5. Get fleet GPS health overview for school admin canvas (Tenant isolated by schoolId param)
telemetryRouter.get(
  '/schools/:schoolId/health',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireTenantScope('params', 'schoolId'),
  TelemetryController.getFleetHealth
);

// 6. Get single bus GPS health summary
//    requireTenantScope: requireActorTenantScope ensures admin is school-scoped;
//    controller verifies bus belongs to req.user.schoolId.
telemetryRouter.get(
  '/buses/:busId/health',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireActorTenantScope,
  TelemetryController.getBusHealth
);

// 7. Real-time SSE stream for school fleet canvas (Tenant isolated by schoolId param)
telemetryRouter.get(
  '/schools/:schoolId/feed',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireTenantScope('params', 'schoolId'),
  TelemetryController.streamSchoolFeed
);

// 8. Real-time SSE stream for trip tracking
//    requireTenantScope: requireActorTenantScope ensures admin is school-scoped;
//    controller verifies trip belongs to req.user.schoolId.
telemetryRouter.get(
  '/trips/:tripId/feed',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireActorTenantScope,
  TelemetryController.streamTripFeed
);

// 9. Real-time SSE stream for single bus tracking (Subscription by Bus)
//    requireTenantScope: requireActorTenantScope ensures admin is school-scoped;
//    controller verifies bus belongs to req.user.schoolId.
telemetryRouter.get(
  '/buses/:busId/feed',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireActorTenantScope,
  TelemetryController.streamBusFeed
);

// 10. Phase 20.2 — Real-time ETA for all remaining stops on a trip.
//     Assembles EtaTripContext (bus position + remaining stops + speed)
//     and computes per-stop estimated arrival times via RoutingService.
//     requireActorTenantScope: ensures admin's schoolId matches the trip.
telemetryRouter.get(
  '/trips/:tripId/eta',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireActorTenantScope,
  TelemetryController.getTripEta
);

// 11. Phase 20.4 — Stop-specific ETA for school admin/coordinator inspection.
telemetryRouter.get(
  '/trips/:tripId/eta/stops/:stopId',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireActorTenantScope,
  TelemetryController.getStopEta
);

export default telemetryRouter;
