import { Router } from 'express';
import {
  CreateBusRequestSchema,
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

// 3. Get Bus Details
busRouter.get(
  '/:schoolId/buses/:busId',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  BusController.getBus
);

// 4. Update Driver and Route Assignments
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

// 5. Driver directory listing for dropdowns
busRouter.get(
  '/:schoolId/drivers',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  BusController.listDrivers
);

// 6. Route directory listing for dropdowns
busRouter.get(
  '/:schoolId/routes',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  BusController.listRoutes
);

export default busRouter;
