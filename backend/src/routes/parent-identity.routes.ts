import { Router } from 'express';
import {
  ParentIdentityLookupRequestSchema,
  GenerateParentTokenRequestSchema,
  RevokeParentTokenRequestSchema,
  RevokeStudentTokensRequestSchema,
  ParentOnboardConfirmRequestSchema,
} from '@school-bus/shared';
import { validateBody } from '../middlewares/validate.middleware.js';
import { ParentIdentityController } from '../controllers/parent-identity.controller.js';
import { authenticateParentTrackingToken } from '../middlewares/parent-token.middleware.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';
import { parentTokenRateLimiter } from '../middlewares/rate-limiter.middleware.js';

const parentRouter = Router();

// 1. Identity & WhatsApp Phone Lookup (Staff / Admin auth required)
parentRouter.post(
  '/identity/lookup',
  parentTokenRateLimiter,
  authenticateToken,
  validateBody(ParentIdentityLookupRequestSchema),
  ParentIdentityController.lookupByPhone
);

// 2. Token Issuance & Revocation (Staff / Admin auth required)
parentRouter.post(
  '/token/generate',
  parentTokenRateLimiter,
  authenticateToken,
  validateBody(GenerateParentTokenRequestSchema),
  ParentIdentityController.generateToken
);

parentRouter.post(
  '/token/revoke',
  authenticateToken,
  validateBody(RevokeParentTokenRequestSchema),
  ParentIdentityController.revokeToken
);

parentRouter.post(
  '/token/revoke-student',
  authenticateToken,
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

// 4. Public Onboarding Verification & Activation (Handles valid, expired, revoked, invalid)
parentRouter.get(
  '/onboard/verify',
  ParentIdentityController.verifyOnboardToken
);

parentRouter.post(
  '/onboard/confirm',
  validateBody(ParentOnboardConfirmRequestSchema),
  ParentIdentityController.confirmOnboard
);

export default parentRouter;

