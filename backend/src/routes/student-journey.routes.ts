/**
 * Student Journey Routes — Phase 32.1: Student Journey Timeline Record
 *
 * Route 119: GET /schools/:schoolId/students/:studentId/journey
 * Mounted at /api/v1/schools
 */

import { Router } from 'express';
import { StudentJourneyController } from '../controllers/student-journey.controller.js';
import { authenticateToken, requireRoles } from '../middlewares/auth.middleware.js';
import { requireTenantScope } from '../middlewares/tenant-isolation.middleware.js';
import { UserRole } from '@school-bus/shared';

const studentJourneyRouter = Router({ mergeParams: true });

/**
 * Route 119 — Retrieve 6-stage student journey record (Pickup, Bus arrival, Boarding, On route, School arrival, Dropped)
 * GET /schools/:schoolId/students/:studentId/journey
 * Auth: school admin, transport coordinator, or driver
 */
studentJourneyRouter.get(
  '/:schoolId/students/:studentId/journey',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR, UserRole.DRIVER),
  requireTenantScope('params', 'schoolId'),
  StudentJourneyController.getStudentJourneyTimeline
);

export default studentJourneyRouter;
