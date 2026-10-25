import { Router } from 'express';
import {
  ParentWhatsAppInboundRequestSchema,
  ParentWhatsAppActionExecuteRequestSchema,
} from '@school-bus/shared';
import { validateBody } from '../middlewares/validate.middleware.js';
import { ParentWhatsappController } from '../controllers/parent-whatsapp.controller.js';

const parentWhatsappRouter = Router();

// 1. Inbound WhatsApp webhook (Meta Cloud API / Twilio)
parentWhatsappRouter.post('/webhook', ParentWhatsappController.handleWebhook);
parentWhatsappRouter.get('/webhook', ParentWhatsappController.verifyWebhook);

// 2. Direct message intake / simulator endpoint
parentWhatsappRouter.post(
  '/message',
  validateBody(ParentWhatsAppInboundRequestSchema),
  ParentWhatsappController.receiveMessage
);

// 3. Get parent menu definition and live status
parentWhatsappRouter.get('/menu', ParentWhatsappController.getMenu);

// 4. Direct action execution
parentWhatsappRouter.post(
  '/action',
  validateBody(ParentWhatsAppActionExecuteRequestSchema),
  ParentWhatsappController.executeAction
);

export default parentWhatsappRouter;
