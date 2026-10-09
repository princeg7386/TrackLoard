import { Router } from 'express';
import {
  ParentIdentityLookupRequestSchema,
  GenerateParentTokenRequestSchema,
  RevokeParentTokenRequestSchema,
  RevokeStudentTokensRequestSchema,
} from '@school-bus/shared';
import { validateBody } from '../middlewares/validate.middleware.js';
import { ParentIdentityController } from '../controllers/parent-identity.controller.js';
import { authenticateParentTrackingToken } from '../middlewares/parent-token.middleware.js';

const parentRouter = Router();

// 1. Identity & WhatsApp Phone Lookup
parentRouter.post(
  '/identity/lookup',
  validateBody(ParentIdentityLookupRequestSchema),
  ParentIdentityController.lookupByPhone
);

// 2. Token Issuance & Revocation
parentRouter.post(
  '/token/generate',
  validateBody(GenerateParentTokenRequestSchema),
  ParentIdentityController.generateToken
);

parentRouter.post(
  '/token/revoke',
  validateBody(RevokeParentTokenRequestSchema),
  ParentIdentityController.revokeToken
);

parentRouter.post(
  '/token/revoke-student',
  validateBody(RevokeStudentTokensRequestSchema),
  ParentIdentityController.revokeStudentTokens
);

// 3. Parent Live Tracking Session Verification (Public tokenized web entry)
parentRouter.get(
  '/track/:token',
  authenticateParentTrackingToken,
  ParentIdentityController.getLiveTrackingSession
);

parentRouter.get(
  '/track',
  authenticateParentTrackingToken,
  ParentIdentityController.getLiveTrackingSession
);

export default parentRouter;
