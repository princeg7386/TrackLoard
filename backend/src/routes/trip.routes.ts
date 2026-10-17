import { Router } from 'express';
import {
  CreateTripRequestSchema,
  CreateTodayTripRequestSchema,
  GenerateDailyTripsRequestSchema,
  StartTripRequestSchema,
  EndTripRequestSchema,
  UpdateTripProgressRequestSchema,
  CancelTripRequestSchema,
  UserRole,
} from '@school-bus/shared';
import { authenticateToken, requireRoles } from '../middlewares/auth.middleware.js';
import { requireTenantScope } from '../middlewares/tenant-isolation.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { TripController } from '../controllers/trip.controller.js';

const tripRouter = Router({ mergeParams: true });

// 1. Create / Schedule Trip (Admin, Coordinator)
tripRouter.post(
  '/:schoolId/trips',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(CreateTripRequestSchema),
  TripController.createTrip
);

// 1b. Create Today's Trip (Admin, Coordinator)
tripRouter.post(
  '/:schoolId/trips/today',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(CreateTodayTripRequestSchema),
  TripController.createTodayTrip
);

// 1c. Generate Daily Trips from Active Routes (Admin, Coordinator)
tripRouter.post(
  '/:schoolId/trips/generate-daily',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(GenerateDailyTripsRequestSchema),
  TripController.generateDailyTrips
);

// 2. List Trips with filters (Admin, Coordinator, Driver)
tripRouter.get(
  '/:schoolId/trips',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.DRIVER,
    UserRole.SUPER_ADMIN
  ),
  TripController.listTrips
);

// 3. Get Trip Details (Admin, Coordinator, Driver)
tripRouter.get(
  '/:schoolId/trips/:tripId',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.DRIVER,
    UserRole.SUPER_ADMIN
  ),
  TripController.getTrip
);

// 4. Start Trip -> IN_TRANSIT (Admin, Coordinator, Driver)
tripRouter.post(
  '/:schoolId/trips/:tripId/start',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.DRIVER,
    UserRole.SUPER_ADMIN
  ),
  validateBody(StartTripRequestSchema.optional()),
  TripController.startTrip
);

// 5. Update Trip Progress -> Stop sequence & Delay (Admin, Coordinator, Driver)
tripRouter.put(
  '/:schoolId/trips/:tripId/progress',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.DRIVER,
    UserRole.SUPER_ADMIN
  ),
  validateBody(UpdateTripProgressRequestSchema),
  TripController.updateProgress
);

// 6. Arrive at School Milestone (Admin, Coordinator, Driver)
tripRouter.post(
  '/:schoolId/trips/:tripId/arrive-school',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.DRIVER,
    UserRole.SUPER_ADMIN
  ),
  TripController.arriveAtSchool
);

// 7. Complete / End Trip -> COMPLETED (Admin, Coordinator, Driver)
tripRouter.post(
  '/:schoolId/trips/:tripId/complete',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.DRIVER,
    UserRole.SUPER_ADMIN
  ),
  validateBody(EndTripRequestSchema.optional()),
  TripController.completeTrip
);

// 7b. End Trip alias -> COMPLETED (Admin, Coordinator, Driver)
tripRouter.post(
  '/:schoolId/trips/:tripId/end',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.DRIVER,
    UserRole.SUPER_ADMIN
  ),
  validateBody(EndTripRequestSchema.optional()),
  TripController.completeTrip
);

// 7c. Trip Summary (Admin, Coordinator, Driver)
tripRouter.get(
  '/:schoolId/trips/:tripId/summary',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.DRIVER,
    UserRole.SUPER_ADMIN
  ),
  TripController.getTripSummary
);

// 8. Cancel Trip (Admin, Coordinator)
tripRouter.post(
  '/:schoolId/trips/:tripId/cancel',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(CancelTripRequestSchema),
  TripController.cancelTrip
);

export default tripRouter;
