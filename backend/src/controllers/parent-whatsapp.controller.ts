import { Request, Response, NextFunction } from 'express';
import {
  ParentWhatsAppInboundRequest,
  ParentWhatsAppActionExecuteRequest,
} from '@school-bus/shared';
import { ParentWhatsappService } from '../services/parent-whatsapp.service.js';
import { sendSuccess } from '../utils/response.util.js';
import { BadRequestError, NotFoundError } from '../middlewares/error.middleware.js';
import { env } from '../config/env.js';

export class ParentWhatsappController {
  /**
   * POST /api/v1/parent/whatsapp/webhook
   * Inbound WhatsApp Cloud API / provider webhook receiver for parent interactions
   */
  public static async handleWebhook(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await ParentWhatsappService.handleWebhookPayload(req.body);
      res.status(200).json({
        success: true,
        handled: 'handled' in result ? result.handled : true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/parent/whatsapp/webhook
   * Meta WhatsApp Cloud API Webhook Subscription Verification
   */
  public static async verifyWebhook(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      const expectedToken =
        process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ||
        process.env.META_VERIFY_TOKEN ||
        'school-bus-verify-token';

      if (mode === 'subscribe' && token === expectedToken) {
        res.status(200).send(challenge);
        return;
      }

      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Webhook verification token mismatch',
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/parent/whatsapp/message
   * Direct message dispatch / simulator endpoint for testing and parent web intake
   */
  public static async receiveMessage(
    req: Request<{}, {}, ParentWhatsAppInboundRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { from, text, action, schoolId } = req.body;
      if (!from) {
        throw new BadRequestError('Sender phone number (from) is required');
      }

      const result = await ParentWhatsappService.handleInboundMessage({
        from,
        text,
        action,
        schoolId,
      });

      sendSuccess(res, result, 'Parent WhatsApp message processed successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/parent/whatsapp/menu
   * Retrieves full Parent WhatsApp Menu by parent phone number
   */
  public static async getMenu(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const phone = req.query.phone as string | undefined;
      const schoolId = req.query.schoolId as string | undefined;

      if (!phone) {
        throw new BadRequestError('Parent phone number query parameter is required');
      }

      const menu = await ParentWhatsappService.getParentMenu(phone, schoolId);
      if (!menu) {
        throw new NotFoundError(`Parent not found for phone number: ${phone}`);
      }

      sendSuccess(res, menu, 'Parent WhatsApp menu retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/parent/whatsapp/action
   * Direct trigger for a specific Parent WhatsApp action
   */
  public static async executeAction(
    req: Request<{}, {}, ParentWhatsAppActionExecuteRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { from, action, schoolId } = req.body;
      if (!from) {
        throw new BadRequestError('Sender phone number (from) is required');
      }
      if (!action) {
        throw new BadRequestError('Target action is required');
      }

      const result = await ParentWhatsappService.handleInboundMessage({
        from,
        action,
        schoolId,
      });

      sendSuccess(res, result, `Parent WhatsApp action ${action} executed successfully`);
    } catch (error) {
      next(error);
    }
  }
}
