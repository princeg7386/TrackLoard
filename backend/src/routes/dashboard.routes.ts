import { Router } from 'express';
import { authenticateToken, requireRoles } from '../middlewares/auth.middleware.js';
import { requireTenantScope } from '../middlewares/tenant-isolation.middleware.js';
import { DashboardController } from '../controllers/dashboard.controller.js';
import { UserRole } from '@school-bus/shared';

const dashboardRouter = Router({ mergeParams: true });

/**
 * GET /api/v1/schools/:schoolId/dashboard/summary
 * Protected by authenticateToken and requireTenantScope
 */
dashboardRouter.get(
  '/:schoolId/dashboard/summary',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN),
  DashboardController.getSummary
);

export default dashboardRouter;

