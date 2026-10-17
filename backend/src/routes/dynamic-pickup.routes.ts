import { Router } from 'express';
import {
  RequestParentLocationSchema,
  ParentLocationShareRequestSchema,
  ValidateCoordinatesQuerySchema,
  FindNearestRoadQuerySchema,
  CreatePickupPointRequestSchema,
  UserRole,
} from '@school-bus/shared';
import { validateBody } from '../middlewares/validate.middleware.js';
import { DynamicPickupController } from '../controllers/dynamic-pickup.controller.js';
import { authenticateToken, requireRoles } from '../middlewares/auth.middleware.js';
import { requireTenantScope } from '../middlewares/tenant-isolation.middleware.js';

const dynamicPickupRouter = Router();

// 1. Dynamic Pickup: WhatsApp Asks for Location (Task 1)
dynamicPickupRouter.post(
  '/location/request',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR, UserRole.SUPER_ADMIN),
  validateBody(RequestParentLocationSchema),
  requireTenantScope('body', 'schoolId'),
  DynamicPickupController.requestParentLocation
);

// 2. Dynamic Pickup: Receive Shared Location (Task 2)
dynamicPickupRouter.post(
  '/location/share',
  validateBody(ParentLocationShareRequestSchema),
  DynamicPickupController.shareLocation
);

// 3. Dynamic Pickup: Validate Coordinates (Task 3)
dynamicPickupRouter.post(
  '/location/validate',
  validateBody(ValidateCoordinatesQuerySchema),
  DynamicPickupController.validateCoordinates
);

// 4. Dynamic Pickup: Inbound WhatsApp Location Webhook (Task 1 & 2)
dynamicPickupRouter.post(
  '/webhook/whatsapp',
  DynamicPickupController.handleWhatsAppWebhook
);

// 5. Dynamic Pickup: Find Nearest Road & Reverse Geocode (Micro-phase 14.2 Tasks 1-3)
dynamicPickupRouter.post(
  '/pickup/nearest-road',
  validateBody(FindNearestRoadQuerySchema),
  DynamicPickupController.findNearestRoad
);

// 6. Dynamic Pickup: Create & Store Pickup Point (Micro-phase 14.2 Task 4)
dynamicPickupRouter.post(
  '/pickup/create-point',
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR, UserRole.SUPER_ADMIN),
  validateBody(CreatePickupPointRequestSchema),
  requireTenantScope('body', 'schoolId'),
  DynamicPickupController.createPickupPoint
);

export default dynamicPickupRouter;
