import { Router } from 'express';
import {
  UpdateSchoolProfileRequestSchema,
  UpdateSchoolGeofenceRequestSchema,
  UserRole,
} from '@school-bus/shared';
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
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR, UserRole.SUPER_ADMIN),
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

// 3. Get School Geofence (School Admin, Coordinator, Super Admin)
schoolProfileRouter.get(
  '/:schoolId/geofence',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR, UserRole.SUPER_ADMIN),
  SchoolProfileController.getGeofence
);

// 4. Update School Geofence (School Admin, Super Admin)
schoolProfileRouter.put(
  '/:schoolId/geofence',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN),
  validateBody(UpdateSchoolGeofenceRequestSchema),
  SchoolProfileController.updateGeofence
);

export default schoolProfileRouter;

