/**
 * Pickup Arrival Routes — Phase 31.1: Upcoming Student Pickup
 *
 * Mounted at /api/v1 (full paths written here for audit scanner compatibility)
 *
 * Route Plan:
 *   GET /schools/:schoolId/trips/:tripId/upcoming-students
 *       — Next pickup stop + students for an active trip
 *       — Auth: SCHOOL_ADMIN | TRANSPORT_COORDINATOR | DRIVER
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

export default pickupArrivalRouter;
