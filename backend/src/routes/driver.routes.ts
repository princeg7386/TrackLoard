import { Router } from 'express';
import {
  AssignDriverBusPayloadSchema,
  CreateDriverRequestSchema,
  UpdateDriverRequestSchema,
  ResetDriverPinRequestSchema,
  UserRole,
} from '@school-bus/shared';
import { authenticateToken, requireRoles } from '../middlewares/auth.middleware.js';
import { requireTenantScope } from '../middlewares/tenant-isolation.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { DriverController } from '../controllers/driver.controller.js';

const driverRouter = Router({ mergeParams: true });

// 1. Create / Register Driver
driverRouter.post(
  '/:schoolId/drivers',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(CreateDriverRequestSchema),
  DriverController.createDriver
);

// 2. List Drivers with Bus Assignments
driverRouter.get(
  '/:schoolId/drivers',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  DriverController.listDrivers
);

// 3. Get Single Driver Profile
driverRouter.get(
  '/:schoolId/drivers/:driverId',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  DriverController.getDriver
);

// 4. Assign / Reassign / Unassign Bus for Driver
driverRouter.put(
  '/:schoolId/drivers/:driverId/assignments',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(AssignDriverBusPayloadSchema),
  DriverController.assignBus
);

// 5. Driver Full History (Trips, Incidents, Attendance)
driverRouter.get(
  '/:schoolId/drivers/:driverId/history',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  DriverController.getDriverHistory
);

// 6. Update Driver Profile
driverRouter.put(
  '/:schoolId/drivers/:driverId',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(UpdateDriverRequestSchema),
  DriverController.updateDriver
);

// 7. Reset Driver PIN
driverRouter.post(
  '/:schoolId/drivers/:driverId/reset-pin',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(ResetDriverPinRequestSchema),
  DriverController.resetPin
);

// 8. Revoke Driver Mobile Sessions
driverRouter.post(
  '/:schoolId/drivers/:driverId/revoke-sessions',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  DriverController.revokeSessions
);

// 9. Remove / Delete Driver Profile
driverRouter.delete(
  '/:schoolId/drivers/:driverId',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  DriverController.removeDriver
);

export default driverRouter;




