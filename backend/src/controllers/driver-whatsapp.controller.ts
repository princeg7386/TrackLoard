import { Request, Response, NextFunction } from 'express';
import {
  DriverWhatsAppInboundRequest,
  DriverWhatsAppAction,
} from '@school-bus/shared';
import { DriverWhatsappService } from '../services/driver-whatsapp.service.js';
import { sendSuccess } from '../utils/response.util.js';
import { BadRequestError, NotFoundError } from '../middlewares/error.middleware.js';

export class DriverWhatsappController {
  /**
   * POST /api/v1/driver/whatsapp/webhook
   * Inbound WhatsApp Cloud API / provider webhook receiver for driver daily operations
   */
  public static async handleWebhook(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await DriverWhatsappService.handleWebhookPayload(req.body);
      res.status(200).json({
        success: true,
        handled: result.handled,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/driver/whatsapp/message
   * Direct message dispatch / simulator endpoint for testing and driver app bridge
   */
  public static async receiveMessage(
    req: Request<{}, {}, DriverWhatsAppInboundRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { from, text, action, schoolId } = req.body;
      if (!from) {
        throw new BadRequestError('Sender phone number (from) is required');
      }

      const result = await DriverWhatsappService.handleInboundMessage({
        from,
        text,
        action,
        schoolId,
      });

      sendSuccess(res, result, 'Driver WhatsApp message processed successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/driver/whatsapp/menu
   * Retrieves full Driver WhatsApp Menu by phone number or driver ID
   */
  public static async getMenu(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const phone = req.query.phone as string | undefined;
      const driverId = req.query.driverId as string | undefined;
      const schoolId = req.query.schoolId as string | undefined;

      const target = phone || driverId;
      if (!target) {
        throw new BadRequestError('Either phone or driverId query parameter is required');
      }

      const menu = await DriverWhatsappService.getDriverMenu(target, schoolId);
      if (!menu) {
        throw new NotFoundError(`Driver not found for target identifier: ${target}`);
      }

      sendSuccess(res, menu, 'Driver WhatsApp menu retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
}
