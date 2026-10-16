import { Request, Response, NextFunction } from 'express';
import {
  ParentIdentityLookupRequest,
  GenerateParentTokenRequest,
  RevokeParentTokenRequest,
  RevokeStudentTokensRequest,
} from '@school-bus/shared';
import { ParentIdentityService } from '../services/parent-identity.service.js';
import { RealtimeFeedService } from '../services/realtime-feed.service.js';
import { sendSuccess } from '../utils/response.util.js';


export class ParentIdentityController {
  /**
   * Resolve parent identity and linked students from a WhatsApp phone number.
   * School scope is always taken from the authenticated admin's JWT (req.user.schoolId),
   * not from the request body, to prevent cross-tenant lookups.
   */
  public static async lookupByPhone(
    req: Request<{}, {}, ParentIdentityLookupRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { phone } = req.body;
      const schoolId = req.user?.schoolId ?? undefined;
      const records = await ParentIdentityService.lookupParentsByPhone(phone, schoolId);

      sendSuccess(
        res,
        { records, count: records.length },
        'Parent identity lookup completed successfully'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Generate a secure tracking token and link for a parent & student
   */
  public static async generateToken(
    req: Request<{}, {}, GenerateParentTokenRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const tokenData = await ParentIdentityService.createTrackingToken(req.body);

      sendSuccess(
        res,
        tokenData,
        'Parent live tracking token generated successfully',
        201
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Revoke a single active tracking token.
   * School scope is enforced from the authenticated admin's JWT to prevent
   * cross-tenant token revocation.
   */
  public static async revokeToken(
    req: Request<{}, {}, RevokeParentTokenRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const tokenOrId = req.body.token || req.body.tokenId!;
      const schoolId = req.user?.schoolId ?? undefined;
      const revoked = await ParentIdentityService.revokeToken(
        tokenOrId,
        schoolId,
        req.body.reason
      );

      sendSuccess(
        res,
        { revoked },
        'Parent live tracking token revoked successfully'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Revoke all active tracking tokens for a given student.
   * School scope is always taken from the authenticated admin's JWT (req.user.schoolId).
   */
  public static async revokeStudentTokens(
    req: Request<{}, {}, RevokeStudentTokensRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { studentId, reason } = req.body;
      const schoolId = req.user?.schoolId!;
      const count = await ParentIdentityService.revokeAllTokensForStudent(
        studentId,
        schoolId,
        reason
      );

      sendSuccess(
        res,
        { revokedCount: count },
        `Revoked ${count} tracking token(s) for student`
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Return live tracking session attached by authenticateParentTrackingToken middleware
   */
  public static async getLiveTrackingSession(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const session = req.parentTrackingSession || (req as any).parentSession;
      sendSuccess(
        res,
        session,
        'Parent live tracking session retrieved successfully'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/parent/track/:token/feed
   * Real-time SSE stream for parent live bus tracking.
   * Auth: authenticateParentTrackingToken (parent tracking token, no admin JWT).
   * Scoped strictly to the single bus/trip linked to the token — no discovery possible.
   */
  public static async streamParentBusFeed(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const session = req.parentTrackingSession;
      if (!session) {
        res.status(401).json({ success: false, error: { message: 'Parent tracking session not found' } });
        return;
      }

      if (!session.activeTrip) {
        res.status(404).json({
          success: false,
          error: {
            message: 'No trip currently in progress for your student. Live tracking activates automatically when a trip begins.',
            code: 'NO_ACTIVE_TRIP',
          },
        });
        return;
      }

      const { id: tripId, busNumber } = session.activeTrip;

      // Set SSE headers
      RealtimeFeedService.initSseStream(res);

      // Send initial state with the last known GPS location from the session
      RealtimeFeedService.sendSseMessage(res, 'initial_state', {
        tripId,
        busNumber,
        studentName: session.student.fullName,
        pickupStop: session.pickupStop ?? null,
        lastGpsLocation: session.activeTrip.lastGpsLocation ?? null,
        tripStatus: session.activeTrip.status,
        delayMinutes: session.activeTrip.delayMinutes,
      });

      // Subscribe to trip channel — only this trip's events will be forwarded
      const unsubscribe = RealtimeFeedService.subscribeTrip(tripId, (event) => {
        RealtimeFeedService.sendSseMessage(res, 'location_update', event);
      });

      const heartbeatInterval = setInterval(() => {
        RealtimeFeedService.sendSseHeartbeat(res);
      }, 20000);

      req.on('close', () => {
        clearInterval(heartbeatInterval);
        unsubscribe();
        res.end();
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List all parents registered in a school with linked student details
   */
  public static async listParents(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId } = req.params;
      const { search, relationship, whatsAppStatus } = req.query;

      const records = await ParentIdentityService.getSchoolParents(
        schoolId!,
        {
          search: typeof search === 'string' ? search : undefined,
          relationship: typeof relationship === 'string' ? relationship : undefined,
          whatsAppStatus: typeof whatsAppStatus === 'string' ? whatsAppStatus : undefined,
        }
      );

      sendSuccess(
        res,
        records,
        'Parent directory retrieved successfully'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get single parent assignment details
   */
  public static async getParentAssignment(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, parentId } = req.params;
      if (!schoolId || !parentId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Parent ID are required' } });
        return;
      }
      const details = await ParentIdentityService.getParentAssignmentDetails(
        schoolId,
        parentId
      );

      sendSuccess(
        res,
        details,
        'Parent assignment details retrieved successfully'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Re-link parent to another student
   */
  public static async relinkStudent(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, parentId } = req.params;
      if (!schoolId || !parentId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Parent ID are required' } });
        return;
      }
      const { studentId } = req.body;
      const actorUserId = req.user?.id || null;

      const assignment = await ParentIdentityService.relinkParentStudent(
        schoolId,
        parentId,
        studentId,
        actorUserId
      );

      sendSuccess(
        res,
        assignment,
        'Parent successfully linked to authorized student'
      );
    } catch (error) {
      next(error);
    }
  }

  public static listSchoolParents = (req: Request, res: Response, next: NextFunction) =>
    ParentIdentityController.listParents(req, res, next);

  public static getAssignmentDetails = (req: Request, res: Response, next: NextFunction) =>
    ParentIdentityController.getParentAssignment(req, res, next);

  public static relinkParentStudent = (req: Request, res: Response, next: NextFunction) =>
    ParentIdentityController.relinkStudent(req, res, next);

  /**
   * Get communication history (WhatsApp notices + token events) for a parent
   */
  public static async getCommunicationHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, parentId } = req.params;
      if (!schoolId || !parentId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Parent ID are required' } });
        return;
      }
      const history = await ParentIdentityService.getParentCommunicationHistory(
        schoolId,
        parentId
      );

      sendSuccess(
        res,
        history,
        'Parent communication history retrieved successfully'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Dispatch an outbound notice/message to parent's registered WhatsApp phone
   */
  public static async sendNotice(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, parentId } = req.params;
      if (!schoolId || !parentId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Parent ID are required' } });
        return;
      }
      const notice = await ParentIdentityService.sendParentNotice(
        schoolId,
        parentId,
        req.body
      );

      sendSuccess(
        res,
        notice,
        'Notice dispatched successfully to parent',
        201
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Generates and dispatches a verified WhatsApp onboarding invitation
   */
  public static async sendOnboardInvite(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, parentId } = req.params;
      if (!schoolId || !parentId) {
        res.status(400).json({ success: false, error: { message: 'School ID and Parent ID are required' } });
        return;
      }
      const { ttlHours, customNote } = req.body || {};
      const adminUserId = req.user?.id || null;

      const result = await ParentIdentityService.sendOnboardingInvite(
        schoolId,
        parentId,
        {
          ttlHours,
          customNote,
          adminUserId,
        }
      );

      sendSuccess(
        res,
        result,
        'WhatsApp onboarding invitation dispatched successfully',
        201
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Public endpoint to verify onboarding token and return structured status
   */
  public static async verifyOnboardToken(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const rawToken =
        typeof req.query.token === 'string'
          ? req.query.token
          : typeof req.params.token === 'string'
            ? req.params.token
            : '';

      const verification = await ParentIdentityService.verifyOnboardingToken(rawToken);

      sendSuccess(
        res,
        verification,
        'Onboarding token verified successfully'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Public endpoint to confirm parent identity & activate live tracking session
   */
  public static async confirmOnboard(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { token, phoneLast4 } = req.body;

      const confirmation = await ParentIdentityService.confirmOnboardingActivation(
        token,
        phoneLast4
      );

      sendSuccess(
        res,
        confirmation,
        'Live tracking portal activated successfully'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get notification delivery health, link access activity, and opt-out status for a parent
   */
  public static async getNotificationStatus(
    req: Request<{ schoolId: string; parentId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, parentId } = req.params;
      const status = await ParentIdentityService.getParentNotificationStatus(schoolId, parentId);

      sendSuccess(
        res,
        status,
        'Parent notification status retrieved successfully'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update notification preferences (opt-out / opt-in) for a parent
   */
  public static async updateNotificationPreferences(
    req: Request<{ schoolId: string; parentId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, parentId } = req.params;
      const actorUserId = req.user?.id || null;

      const result = await ParentIdentityService.updateParentNotificationPreferences(
        schoolId,
        parentId,
        req.body,
        actorUserId
      );

      sendSuccess(
        res,
        result,
        'Parent notification preferences updated successfully'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update delivery status for an outbound notification
   */
  public static async updateNotificationStatus(
    req: Request<{ schoolId: string; notificationId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, notificationId } = req.params;

      const result = await ParentIdentityService.updateNotificationDeliveryStatus(
        schoolId,
        notificationId,
        req.body
      );

      sendSuccess(
        res,
        result,
        'Notification delivery status updated successfully'
      );
    } catch (error) {
      next(error);
    }
  }
}
