import { Request, Response, NextFunction } from 'express';
import { NotificationDeliveryService } from '../services/notification-delivery.service.js';
import { NotificationAntiSpamService } from '../services/notification-anti-spam.service.js';
import {
  NotificationAlertsQuerySchema,
  NotificationAntiSpamEvaluateRequestSchema,
} from '@school-bus/shared';

export class NotificationDeliveryController {
  /**
   * GET /api/v1/schools/:schoolId/notifications/alerts
   * Paginated operational alerts stream for dashboard
   */
  public static async getAlerts(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      if (!schoolId) {
        res.status(400).json({ success: false, error: { message: 'School ID is required' } });
        return;
      }

      const parsedQuery = NotificationAlertsQuerySchema.parse(req.query);
      const result = await NotificationDeliveryService.getSchoolAlerts(schoolId, parsedQuery);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/schools/:schoolId/notifications/stats
   * Aggregated delivery statistics for school operations
   */
  public static async getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      if (!schoolId) {
        res.status(400).json({ success: false, error: { message: 'School ID is required' } });
        return;
      }

      const stats = await NotificationDeliveryService.getSchoolNotificationStats(schoolId);

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/schools/:schoolId/notifications/:notificationId/retry
   * Retries dispatch of a failed notification
   */
  public static async retryNotification(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, notificationId } = req.params;
      if (!schoolId || !notificationId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Notification ID are required' } });
        return;
      }

      const result = await NotificationDeliveryService.retryNotification(schoolId, notificationId);

      res.status(200).json({
        success: result.success,
        data: result,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/schools/:schoolId/notifications/retry-failed
   * Batch retries eligible failed notifications
   */
  public static async retryPendingFailed(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      const limit = req.body?.limit ? Number(req.body.limit) : 20;

      const summary = await NotificationDeliveryService.retryPendingFailedNotifications(schoolId, limit);

      res.status(200).json({
        success: true,
        data: summary,
        message: `Batch retry processed ${summary.totalRetried} notifications (${summary.succeeded} succeeded, ${summary.failed} failed)`,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/schools/:schoolId/notifications/webhook/status
   * Provider delivery receipt webhook endpoint
   */
  public static async handleWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { providerMessageId, status, failureReason, timestamp } = req.body;
      if (!providerMessageId || !status) {
        res.status(400).json({ success: false, error: { message: 'providerMessageId and status are required' } });
        return;
      }

      const validStatus = ['DELIVERED', 'READ', 'FAILED'].includes(status?.toUpperCase())
        ? (status.toUpperCase() as 'DELIVERED' | 'READ' | 'FAILED')
        : 'DELIVERED';

      const updated = await NotificationDeliveryService.handleDeliveryWebhook(
        providerMessageId,
        validStatus,
        { failureReason, timestamp }
      );

      res.status(200).json({
        success: true,
        data: updated,
        message: updated ? 'Delivery status synchronized' : 'No matching notification found for providerMessageId',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/schools/:schoolId/notifications/anti-spam/evaluate
   * Evaluates deduplication, burst throttling, and affected parent targeting eligibility
   */
  public static async evaluateAntiSpam(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      if (!schoolId) {
        res.status(400).json({ success: false, error: { message: 'School ID is required' } });
        return;
      }

      const parsedBody = NotificationAntiSpamEvaluateRequestSchema.parse(req.body);
      const evaluation = await NotificationAntiSpamService.evaluateAntiSpam({
        schoolId,
        tripId: parsedBody.tripId,
        eventType: parsedBody.eventType,
        priority: parsedBody.priority,
        recipientPhone: parsedBody.recipientPhone,
        stopId: parsedBody.stopId,
        studentId: parsedBody.studentId,
        routeId: parsedBody.routeId,
        isDownstreamOnly: parsedBody.isDownstreamOnly,
      });

      res.status(200).json({
        success: true,
        data: evaluation,
      });
    } catch (error) {
      next(error);
    }
  }
}
