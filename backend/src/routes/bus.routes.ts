import { Router } from 'express';
import {
  CreateBusRequestSchema,
  UpdateBusRequestSchema,
  AssignBusPayloadSchema,
  UserRole,
} from '@school-bus/shared';
import { authenticateToken, requireRoles } from '../middlewares/auth.middleware.js';
import { requireTenantScope } from '../middlewares/tenant-isolation.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { BusController } from '../controllers/bus.controller.js';

const busRouter = Router({ mergeParams: true });

// 1. Create / Register Bus
busRouter.post(
  '/:schoolId/buses',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(CreateBusRequestSchema),
  BusController.createBus
);

// 2. List Buses
busRouter.get(
  '/:schoolId/buses',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  BusController.listBuses
);

// 3. Get Bus Details (Includes live GPS location and current active trip)
busRouter.get(
  '/:schoolId/buses/:busId',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  BusController.getBus
);

// 4. Update Bus Specifications
busRouter.put(
  '/:schoolId/buses/:busId',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(UpdateBusRequestSchema),
  BusController.updateBus
);

// 5. Remove / Soft-Delete Bus
busRouter.delete(
  '/:schoolId/buses/:busId',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.SUPER_ADMIN),
  BusController.deleteBus
);

// 6. Update Driver and Route Assignments
busRouter.put(
  '/:schoolId/buses/:busId/assignments',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(AssignBusPayloadSchema),
  BusController.updateAssignments
);

// 7. Driver directory listing for dropdowns
busRouter.get(
  '/:schoolId/drivers',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  BusController.listDrivers
);

// 8. Route directory listing for dropdowns
busRouter.get(
  '/:schoolId/routes',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  BusController.listRoutes
);

export default busRouter;
