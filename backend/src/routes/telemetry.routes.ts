import { Router } from 'express';
import { TelemetryController } from '../controllers/telemetry.controller.js';
import { validateRequest } from '../middlewares/validate.middleware.js';
import { authenticateDriver } from '../middlewares/driver-auth.middleware.js';
import { authenticateToken, requireRoles } from '../middlewares/auth.middleware.js';
import {
  requireTenantScope,
  requireActorTenantScope,
} from '../middlewares/tenant-isolation.middleware.js';
import {
  TelemetryIngestSchema,
  TelemetryBatchIngestSchema,
  ReportAppDisconnectRequestSchema,
  ReconnectTripRequestSchema,
  UserRole,
} from '@school-bus/shared';
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

// 12. Phase 21.1 — Active trip stop geofence states
telemetryRouter.get(
  '/trips/:tripId/geofence-states',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireActorTenantScope,
  TelemetryController.getTripGeofenceStates
);

// 13. Phase 21.1 — Historical trip geofence events ledger
telemetryRouter.get(
  '/trips/:tripId/geofence-events',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireActorTenantScope,
  TelemetryController.getTripGeofenceEvents
);

// 14. Phase 27.1 — Get active GPS offline events for a school
telemetryRouter.get(
  '/schools/:schoolId/offline-events',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireTenantScope('params', 'schoolId'),
  TelemetryController.getSchoolOfflineEvents
);

// 15. Phase 27.1 — Trigger fleet offline evaluation across all active trips
telemetryRouter.post(
  '/schools/:schoolId/offline-events/scan',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireTenantScope('params', 'schoolId'),
  TelemetryController.scanFleetOfflineStatus
);

// 16. Phase 27.1 — Check real-time offline status for a specific trip
telemetryRouter.get(
  '/trips/:tripId/offline-status',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireActorTenantScope,
  TelemetryController.getTripOfflineStatus
);

// 17. Phase 27.1 — Driver app lifecycle disconnect reporting
telemetryRouter.post(
  '/trips/:tripId/app-disconnect',
  authenticateDriver,
  validateRequest({ body: ReportAppDisconnectRequestSchema }),
  TelemetryController.reportAppDisconnect
);

// 18. Phase 27.2 — Trigger offline response workflow (Store last known, notify school, notify driver)
telemetryRouter.post(
  '/schools/:schoolId/trips/:tripId/offline/respond',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireTenantScope('params', 'schoolId'),
  TelemetryController.respondToOfflineTrip
);

// 19. Phase 27.2 — Retrieve locked last known location for a trip
telemetryRouter.get(
  '/trips/:tripId/last-known-location',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireActorTenantScope,
  TelemetryController.getLastKnownLocation
);

// 20. Phase 27.3 — Driver automatic reconnection & queued batch sync
telemetryRouter.post(
  '/trips/:tripId/reconnect',
  authenticateDriver,
  validateRequest({ body: ReconnectTripRequestSchema }),
  TelemetryController.reconnectTrip
);

// 21. Phase 27.3 — Manual recovery of an offline trip by school coordinator
telemetryRouter.post(
  '/schools/:schoolId/trips/:tripId/offline/recover',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireTenantScope('params', 'schoolId'),
  TelemetryController.recoverTripOffline
);

// 22. Phase 28.1 — Load expected route geometry and stops
telemetryRouter.get(
  '/schools/:schoolId/routes/:routeId/geometry',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireTenantScope('params', 'schoolId'),
  TelemetryController.getRouteGeometry
);

// 23. Phase 28.1 — Real-time bus position relative to expected route
telemetryRouter.get(
  '/trips/:tripId/route-position',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireActorTenantScope,
  TelemetryController.getTripRoutePosition
);

// 24. Phase 28.2 — Get active deviation event for a trip
telemetryRouter.get(
  '/schools/:schoolId/trips/:tripId/deviation',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireTenantScope('params', 'schoolId'),
  TelemetryController.getTripActiveDeviation
);

// 25. Phase 28.2 — List all active deviation events for a school
telemetryRouter.get(
  '/schools/:schoolId/deviations',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireTenantScope('params', 'schoolId'),
  TelemetryController.getSchoolActiveDeviations
);

// 26. Phase 28.3 — Manually re-trigger school + driver notifications for a deviation
telemetryRouter.post(
  '/schools/:schoolId/deviations/:deviationId/notify',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireTenantScope('params', 'schoolId'),
  TelemetryController.manualNotifyDeviation
);

// 27. Phase 29.2 — List active overspeed events for a school
telemetryRouter.get(
  '/schools/:schoolId/overspeed-events',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireTenantScope('params', 'schoolId'),
  TelemetryController.getSchoolActiveOverspeedEvents
);

// 28. Phase 29.2 — Get active overspeed event for a trip
telemetryRouter.get(
  '/schools/:schoolId/trips/:tripId/overspeed',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireTenantScope('params', 'schoolId'),
  TelemetryController.getTripActiveOverspeedEvent
);

// 29. Phase 29.3 — Manually re-trigger school + driver notifications for an overspeed event
telemetryRouter.post(
  '/schools/:schoolId/overspeed-events/:eventId/notify',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireTenantScope('params', 'schoolId'),
  TelemetryController.manualNotifyOverspeed
);

export default telemetryRouter;
