import { Router } from 'express';
import { authenticateToken, requireRoles } from '../middlewares/auth.middleware.js';
import { requireTenantScope } from '../middlewares/tenant-isolation.middleware.js';
import { NotificationDeliveryController } from '../controllers/notification.controller.js';
import { UserRole } from '@school-bus/shared';

const notificationRouter = Router({ mergeParams: true });

/**
 * GET /api/v1/schools/:schoolId/notifications/alerts
 * Paginated operational notification alerts feed for school admin & transport coordinator
 */
notificationRouter.get(
  '/:schoolId/notifications/alerts',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR, UserRole.SUPER_ADMIN),
  NotificationDeliveryController.getAlerts
);

/**
 * GET /api/v1/schools/:schoolId/notifications/stats
 * Aggregated delivery metrics (sent, delivered, read, failed, priority breakdown)
 */
notificationRouter.get(
  '/:schoolId/notifications/stats',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR, UserRole.SUPER_ADMIN),
  NotificationDeliveryController.getStats
);

/**
 * POST /api/v1/schools/:schoolId/notifications/:notificationId/retry
 * Manual retry dispatch of a failed notification
 */
notificationRouter.post(
  '/:schoolId/notifications/:notificationId/retry',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR, UserRole.SUPER_ADMIN),
  NotificationDeliveryController.retryNotification
);

/**
 * POST /api/v1/schools/:schoolId/notifications/retry-failed
 * Batch worker retry of eligible failed notifications
 */
notificationRouter.post(
  '/:schoolId/notifications/retry-failed',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR, UserRole.SUPER_ADMIN),
  NotificationDeliveryController.retryPendingFailed
);

/**
 * POST /api/v1/schools/:schoolId/notifications/webhook/status
 * Synchronizes external delivery receipt status into notification record
 */
notificationRouter.post(
  '/:schoolId/notifications/webhook/status',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR, UserRole.SUPER_ADMIN),
  NotificationDeliveryController.handleWebhook
);

/**
 * POST /api/v1/schools/:schoolId/notifications/anti-spam/evaluate
 * Evaluates duplicate suppression, recipient burst throttle, and affected parent targeting
 */
notificationRouter.post(
  '/:schoolId/notifications/anti-spam/evaluate',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR, UserRole.SUPER_ADMIN),
  NotificationDeliveryController.evaluateAntiSpam
);

export default notificationRouter;
