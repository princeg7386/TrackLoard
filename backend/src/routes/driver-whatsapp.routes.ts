import { Router } from 'express';
import {
  DriverWhatsAppInboundRequestSchema,
  DriverWhatsAppStartTripRequestSchema,
  DriverWhatsAppEndTripRequestSchema,
} from '@school-bus/shared';
import { validateBody } from '../middlewares/validate.middleware.js';
import { DriverWhatsappController } from '../controllers/driver-whatsapp.controller.js';

const driverWhatsappRouter = Router();

// 1. Inbound WhatsApp webhook (Meta Cloud API / Twilio)
driverWhatsappRouter.post('/webhook', DriverWhatsappController.handleWebhook);

// 2. Direct message intake / simulator endpoint
driverWhatsappRouter.post(
  '/message',
  validateBody(DriverWhatsAppInboundRequestSchema),
  DriverWhatsappController.receiveMessage
);

// 3. Get driver menu definition and status
driverWhatsappRouter.get('/menu', DriverWhatsappController.getMenu);

// 4. Start trip via WhatsApp flow (Micro-Phase 17.2)
driverWhatsappRouter.post(
  '/start-trip',
  validateBody(DriverWhatsAppStartTripRequestSchema),
  DriverWhatsappController.startTrip
);

// 5. End trip via WhatsApp flow (Micro-Phase 17.3)
driverWhatsappRouter.post(
  '/end-trip',
  validateBody(DriverWhatsAppEndTripRequestSchema),
  DriverWhatsappController.endTrip
);

export default driverWhatsappRouter;


