import { Router } from 'express';
import { RoutingController } from '../controllers/routing.controller.js';
import { authenticateToken, requireRoles } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { requireTenantScope } from '../middlewares/tenant-isolation.middleware.js';
import {
  CalculateRouteRequestSchema,
  EtaCalculationQuerySchema,
  DistanceMatrixQuerySchema,
  SnapToRoadQuerySchema,
  GeocodeQuerySchema,
  ReverseGeocodeQuerySchema,
  SelectMapOptionRequestSchema,
  UserRole,
} from '@school-bus/shared';

const routingRouter = Router();

// 1. Point-to-point / Waypoint Route Calculation
routingRouter.post(
  '/calculate',
  authenticateToken,
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.DRIVER,
    UserRole.SUPER_ADMIN
  ),
  validateBody(CalculateRouteRequestSchema),
  RoutingController.calculateRoute
);

// 2. ETA Calculation between origin and destination
routingRouter.post(
  '/eta',
  authenticateToken,
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.DRIVER,
    UserRole.SUPER_ADMIN
  ),
  validateBody(EtaCalculationQuerySchema),
  RoutingController.calculateEta
);

// 3. Distance & Duration Matrix
routingRouter.post(
  '/matrix',
  authenticateToken,
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.DRIVER,
    UserRole.SUPER_ADMIN
  ),
  validateBody(DistanceMatrixQuerySchema),
  RoutingController.calculateMatrix
);

// 4. Snap GPS Points to Road Geometry
routingRouter.post(
  '/snap-to-road',
  authenticateToken,
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.DRIVER,
    UserRole.SUPER_ADMIN
  ),
  validateBody(SnapToRoadQuerySchema),
  RoutingController.snapToRoad
);

// 5. Geocoding address search
routingRouter.post(
  '/geocode',
  authenticateToken,
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.DRIVER,
    UserRole.SUPER_ADMIN
  ),
  validateBody(GeocodeQuerySchema),
  RoutingController.geocode
);

// 6. Reverse geocoding coordinate resolution
routingRouter.post(
  '/reverse-geocode',
  authenticateToken,
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.DRIVER,
    UserRole.SUPER_ADMIN
  ),
  validateBody(ReverseGeocodeQuerySchema),
  RoutingController.reverseGeocode
);

// 7. Route Directions for Sequenced Pickup Stops in a School
routingRouter.get(
  '/schools/:schoolId/routes/:routeId/directions',
  authenticateToken,
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.DRIVER,
    UserRole.SUPER_ADMIN
  ),
  requireTenantScope('params', 'schoolId'),
  RoutingController.getRouteDirections
);

// 8. Free-First Map & Routing Configuration Options
routingRouter.get(
  '/options',
  authenticateToken,
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.DRIVER,
    UserRole.SUPER_ADMIN
  ),
  RoutingController.getFreeMapOptions
);

// 9. Select / Update Active Map, Geocoding or Routing Option
routingRouter.post(
  '/options/select',
  authenticateToken,
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(SelectMapOptionRequestSchema),
  RoutingController.selectFreeMapOption
);

// 10. Benchmark & Evaluate Routing Engines (OSRM, Valhalla, Mock)
routingRouter.get(
  '/evaluate',
  authenticateToken,
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  RoutingController.evaluateRoutingEngines
);

// 11. Paid Map Trigger Policy & Guidelines
routingRouter.get(
  '/policy',
  authenticateToken,
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.DRIVER,
    UserRole.SUPER_ADMIN
  ),
  RoutingController.getPaidMapPolicy
);

// 12. Map API Usage, Latency & Free-First Savings
routingRouter.get(
  '/usage',
  authenticateToken,
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  RoutingController.getMapUsage
);

// 13. Reset Map Usage Counters (Test & Admin)
routingRouter.post(
  '/usage/reset',
  authenticateToken,
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  RoutingController.resetMapUsage
);

export default routingRouter;


