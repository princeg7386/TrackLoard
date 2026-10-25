import { Router } from 'express';
import {
  ParentWhatsAppInboundRequestSchema,
  ParentWhatsAppActionExecuteRequestSchema,
  ParentPickupUpdateRequestSchema,
  ParentReportIssueRequestSchema,
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

// 5. Track My Bus direct query (Micro-Phase 22.2)
parentWhatsappRouter.get('/track-bus', ParentWhatsappController.trackBus);

// 6. My ETA direct query (Micro-Phase 22.3)
parentWhatsappRouter.get('/eta', ParentWhatsappController.getMyEta);

// 7. My Child direct query (Micro-Phase 22.4)
parentWhatsappRouter.get('/child', ParentWhatsappController.getMyChild);

// 8. My Pickup queries & updates (Micro-Phase 22.5)
parentWhatsappRouter.get('/pickup', ParentWhatsappController.getMyPickup);
parentWhatsappRouter.post(
  '/pickup/update',
  validateBody(ParentPickupUpdateRequestSchema),
  ParentWhatsappController.updatePickup
);

// 9. Help & Issue Reporting (Micro-Phase 22.6)
parentWhatsappRouter.get('/help', ParentWhatsappController.getHelp);
parentWhatsappRouter.post(
  '/help/report-issue',
  validateBody(ParentReportIssueRequestSchema),
  ParentWhatsappController.reportIssue
);

export default parentWhatsappRouter;


