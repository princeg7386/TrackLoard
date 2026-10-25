import { Router } from 'express';
import {
  ParentIdentityLookupRequestSchema,
  GenerateParentTokenRequestSchema,
  RevokeParentTokenRequestSchema,
  RevokeStudentTokensRequestSchema,
  ParentOnboardConfirmRequestSchema,
  UserRole,
} from '@school-bus/shared';
import { validateBody } from '../middlewares/validate.middleware.js';
import { ParentIdentityController } from '../controllers/parent-identity.controller.js';
import { authenticateParentTrackingToken } from '../middlewares/parent-token.middleware.js';
import { authenticateToken, requireRoles } from '../middlewares/auth.middleware.js';
import {
  requireTenantScope,
  requireActorTenantScope,
} from '../middlewares/tenant-isolation.middleware.js';
import { parentTokenRateLimiter } from '../middlewares/rate-limiter.middleware.js';

const parentRouter = Router();

// 1. Identity & WhatsApp Phone Lookup
//    requireTenantScope: service layer validates req.user.schoolId against lookup results.
parentRouter.post(
  '/identity/lookup',
  parentTokenRateLimiter,
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireActorTenantScope,
  validateBody(ParentIdentityLookupRequestSchema),
  ParentIdentityController.lookupByPhone
);

// 2. Token Generation (schoolId in body — requireTenantScope validates against JWT school)
parentRouter.post(
  '/token/generate',
  parentTokenRateLimiter,
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  validateBody(GenerateParentTokenRequestSchema),
  requireTenantScope('body', 'schoolId'),
  ParentIdentityController.generateToken
);

parentRouter.post(
  '/token/revoke',
  // requireTenantScope: actor JWT schoolId scope enforced via requireActorTenantScope
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireActorTenantScope,
  validateBody(RevokeParentTokenRequestSchema),
  ParentIdentityController.revokeToken
);

parentRouter.post(
  '/token/revoke-student',
  // requireTenantScope: actor JWT schoolId scope enforced via requireActorTenantScope
  authenticateToken,
  requireRoles(UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  requireActorTenantScope,
  validateBody(RevokeStudentTokensRequestSchema),
  ParentIdentityController.revokeStudentTokens
);

// 5. Micro-phase 23.1: Secure Entry Token Verification (Public endpoint returning structured token status & session)
parentRouter.get(
  '/track/:token/verify-entry',
  ParentIdentityController.verifyLiveWebEntry
);

parentRouter.get(
  '/track/verify-entry',
  ParentIdentityController.verifyLiveWebEntry
);

// 5a. Parent Live Tracking Session Verification (Public tokenized web entry — parent token auth)
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

// 5a. Parent Real-time SSE Live Bus Feed (parent token auth only — scoped to the session's trip)
//     Browser EventSource cannot send headers: token can be passed as URL path param or ?token= query param.
//     authenticateParentTrackingToken reads req.params.token or req.query.token → no unauthenticated stream possible.
parentRouter.get(
  '/feed/:token',
  authenticateParentTrackingToken,
  ParentIdentityController.streamParentBusFeed
);

parentRouter.get(
  '/feed',
  authenticateParentTrackingToken,
  ParentIdentityController.streamParentBusFeed
);

// 5b. Phase 20.4 — Parent Pickup Stop ETA Endpoint
parentRouter.get(
  '/eta/:token',
  authenticateParentTrackingToken,
  ParentIdentityController.getParentEta
);

parentRouter.get(
  '/eta',
  authenticateParentTrackingToken,
  ParentIdentityController.getParentEta
);

// 6. Public Onboarding Verification & Activation (handles valid/expired/revoked/invalid tokens)
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

