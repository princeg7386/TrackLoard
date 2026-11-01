/**
 * SOS Routes — Phase 30.1: Emergency / SOS Trigger
 *
 * Mounted at /api/v1 (full paths written here for audit scanner compatibility)
 *
 * Route Plan:
 *  POST   /telemetry/trips/:tripId/sos                          — authenticateDriver (Flutter app button)
 *  GET    /schools/:schoolId/sos-events                          — admin: list active SOS events
 *  POST   /schools/:schoolId/sos-events/:sosId/acknowledge       — admin: acknowledge SOS
 *  POST   /schools/:schoolId/sos-events/:sosId/resolve           — admin: resolve SOS
 */

import { Router } from 'express';
import { SosController } from '../controllers/sos.controller.js';
import { authenticateDriver } from '../middlewares/driver-auth.middleware.js';
import { authenticateToken, requireRoles } from '../middlewares/auth.middleware.js';
import { requireTenantScope } from '../middlewares/tenant-isolation.middleware.js';
import { UserRole } from '@school-bus/shared';

const sosRouter = Router();

/**
 * Route 31 — Driver app SOS button
 * POST /telemetry/trips/:tripId/sos
 * Auth: driver JWT only (Flutter app)
 */
sosRouter.post(
  '/telemetry/trips/:tripId/sos',
  authenticateDriver,
  SosController.triggerSos
);

/**
 * Route 32 — List active SOS events for school
 * GET /schools/:schoolId/sos-events
 * Auth: school admin or transport coordinator
 */
sosRouter.get(
  '/schools/:schoolId/sos-events',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireTenantScope('params', 'schoolId'),
  SosController.getActiveSosEvents
);

/**
 * Route 33 — Acknowledge an active SOS event
 * POST /schools/:schoolId/sos-events/:sosId/acknowledge
 * Auth: school admin or transport coordinator
 */
sosRouter.post(
  '/schools/:schoolId/sos-events/:sosId/acknowledge',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireTenantScope('params', 'schoolId'),
  SosController.acknowledgeSos
);

/**
 * Route 34 — Resolve a SOS event
 * POST /schools/:schoolId/sos-events/:sosId/resolve
 * Auth: school admin or transport coordinator
 */
sosRouter.post(
  '/schools/:schoolId/sos-events/:sosId/resolve',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireTenantScope('params', 'schoolId'),
  SosController.resolveSos
);

export default sosRouter;
