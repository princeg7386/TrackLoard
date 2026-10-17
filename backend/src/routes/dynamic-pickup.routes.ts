import { Router } from 'express';
import {
  RequestParentLocationSchema,
  ParentLocationShareRequestSchema,
  ValidateCoordinatesQuerySchema,
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

export default dynamicPickupRouter;
