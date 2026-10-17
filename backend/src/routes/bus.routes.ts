import { Router } from 'express';
import {
  CreateBusRequestSchema,
  UpdateBusRequestSchema,
  AssignBusPayloadSchema,
  CreateRouteRequestSchema,
  AddRouteStopRequestSchema,
  ReorderRouteStopsRequestSchema,
  UpdateRouteStopRequestSchema,
  UserRole,
} from '@school-bus/shared';
import { authenticateToken, requireRoles } from '../middlewares/auth.middleware.js';
import { requireTenantScope } from '../middlewares/tenant-isolation.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { BusController } from '../controllers/bus.controller.js';
import { RouteController } from '../controllers/route.controller.js';

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
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  BusController.listBuses
);

// 3. Get Bus Details (Includes live GPS location and current active trip)
busRouter.get(
  '/:schoolId/buses/:busId',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
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

// 7. Route directory listing for dropdowns
busRouter.get(
  '/:schoolId/routes',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  BusController.listRoutes
);

// 7a. Create Route (Micro-phase 15.1)
busRouter.post(
  '/:schoolId/routes',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(CreateRouteRequestSchema),
  RouteController.createRoute
);

// 7b. Get Route Details by ID (Micro-phase 15.1)
busRouter.get(
  '/:schoolId/routes/:routeId',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  RouteController.getRoute
);

// 7c. List Route Stops (Micro-phase 15.2)
busRouter.get(
  '/:schoolId/routes/:routeId/stops',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  RouteController.listStops
);

// 7d. Add Route Stop (Micro-phase 15.2)
busRouter.post(
  '/:schoolId/routes/:routeId/stops',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(AddRouteStopRequestSchema),
  RouteController.addStop
);

// 7e. Reorder Route Stops (Micro-phase 15.2)
busRouter.put(
  '/:schoolId/routes/:routeId/stops/reorder',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(ReorderRouteStopsRequestSchema),
  RouteController.reorderStops
);

// 7f. Update Route Stop Details or Sequence (Micro-phase 15.2)
busRouter.put(
  '/:schoolId/routes/:routeId/stops/:stopId',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(UpdateRouteStopRequestSchema),
  RouteController.updateStop
);

// 7g. Remove / Soft-Delete Route Stop (Micro-phase 15.2)
busRouter.delete(
  '/:schoolId/routes/:routeId/stops/:stopId',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  RouteController.removeStop
);

// 9. Full Vehicle History (Bus profile, trips, safety incidents, attendance)
busRouter.get(
  '/:schoolId/buses/:busId/history',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  BusController.getBusHistory
);

// 10. Vehicle Trip History
busRouter.get(
  '/:schoolId/buses/:busId/history/trips',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  BusController.getBusTripHistory
);

// 11. Vehicle Safety Incidents & SOS History
busRouter.get(
  '/:schoolId/buses/:busId/history/incidents',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  BusController.getBusIncidentHistory
);

// 12. Vehicle Attendance History & Student Records
busRouter.get(
  '/:schoolId/buses/:busId/history/attendance',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  BusController.getBusAttendanceHistory
);

// 13. Phase 12.1 — Current bus state: live GPS + active trip + route + driver
//     Tenant-isolated via requireTenantScope; bus must belong to the caller's school.
busRouter.get(
  '/:schoolId/buses/:busId/state',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  BusController.getActiveBusState
);

export default busRouter;


