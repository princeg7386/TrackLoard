/**
 * Pickup Arrival Routes — Phase 31: Pickup Arrival Workflow
 *
 * Micro-phase 31.1: Route 117 — GET  /:schoolId/trips/:tripId/upcoming-students
 * Micro-phase 31.3: Route 118 — POST /:schoolId/trips/:tripId/stops/:stopId/arrival
 *
 * Mounted at /api/v1/schools
 */

import { Router } from 'express';
import { PickupArrivalController } from '../controllers/pickup-arrival.controller.js';
import { authenticateToken, requireRoles } from '../middlewares/auth.middleware.js';
import { requireTenantScope } from '../middlewares/tenant-isolation.middleware.js';
import { UserRole } from '@school-bus/shared';

const pickupArrivalRouter = Router({ mergeParams: true });

/**
 * Route 117 — Next pickup stop and upcoming students for an active trip
 * GET /schools/:schoolId/trips/:tripId/upcoming-students
 * Auth: school admin, transport coordinator, or driver
 */
pickupArrivalRouter.get(
  '/:schoolId/trips/:tripId/upcoming-students',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR, UserRole.DRIVER),
  requireTenantScope('params', 'schoolId'),
  PickupArrivalController.getUpcomingStudents
);

/**
 * Route 118 — Record arrival at a pickup stop (geofence entry, parent alert, unlocks boarding)
 * POST /schools/:schoolId/trips/:tripId/stops/:stopId/arrival
 * Auth: school admin, transport coordinator, or driver
 */
pickupArrivalRouter.post(
  '/:schoolId/trips/:tripId/stops/:stopId/arrival',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR, UserRole.DRIVER),
  requireTenantScope('params', 'schoolId'),
  PickupArrivalController.recordStopArrival
);

export default pickupArrivalRouter;
