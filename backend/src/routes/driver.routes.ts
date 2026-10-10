import { Router } from 'express';
import { AssignDriverBusPayloadSchema, CreateDriverRequestSchema, UserRole } from '@school-bus/shared';
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
  DriverController.listDrivers
);

// 3. Get Single Driver Profile
driverRouter.get(
  '/:schoolId/drivers/:driverId',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
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

export default driverRouter;

