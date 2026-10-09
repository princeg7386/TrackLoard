import { Router } from 'express';
import { UpdateSchoolProfileRequestSchema, UserRole } from '@school-bus/shared';
import { authenticateToken, requireRoles } from '../middlewares/auth.middleware.js';
import { requireTenantScope } from '../middlewares/tenant-isolation.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { SchoolProfileController } from '../controllers/school-profile.controller.js';

const schoolProfileRouter = Router({ mergeParams: true });

// 1. Get School Profile
schoolProfileRouter.get(
  '/:schoolId/profile',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  SchoolProfileController.getProfile
);

// 2. Update School Profile (Restricted to School Admin or Super Admin)
schoolProfileRouter.put(
  '/:schoolId/profile',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN),
  validateBody(UpdateSchoolProfileRequestSchema),
  SchoolProfileController.updateProfile
);

export default schoolProfileRouter;
