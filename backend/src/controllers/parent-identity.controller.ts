import { Request, Response, NextFunction } from 'express';
import {
  ParentIdentityLookupRequest,
  GenerateParentTokenRequest,
  RevokeParentTokenRequest,
  RevokeStudentTokensRequest,
} from '@school-bus/shared';
import { ParentIdentityService } from '../services/parent-identity.service.js';
import { sendSuccess } from '../utils/response.util.js';

export class ParentIdentityController {
  /**
   * Resolve parent identity and linked students from a WhatsApp phone number
   */
  public static async lookupByPhone(
    req: Request<{}, {}, ParentIdentityLookupRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { phone, schoolId } = req.body;
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
   * Revoke a single active tracking token
   */
  public static async revokeToken(
    req: Request<{}, {}, RevokeParentTokenRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const tokenOrId = req.body.token || req.body.tokenId!;
      const revoked = await ParentIdentityService.revokeToken(
        tokenOrId,
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
   * Revoke all active tracking tokens for a given student (e.g. stop/bus changed)
   */
  public static async revokeStudentTokens(
    req: Request<{}, {}, RevokeStudentTokensRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { studentId, schoolId, reason } = req.body;
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
   * Public token consumption endpoint: validates tracking token and retrieves live trip session
   */
  public static async verifyToken(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const token =
        typeof req.query.token === 'string'
          ? req.query.token
          : typeof req.params.token === 'string'
            ? req.params.token
            : '';

      const session = await ParentIdentityService.verifyTrackingToken(token);

      sendSuccess(
        res,
        session,
        'Live tracking session resolved successfully'
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * List parents with student & WhatsApp status for a school
   */
  public static async listParents(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId } = req.params;
      const { search, relationship, whatsAppStatus } = req.query;

      const records = await ParentIdentityService.listParentsForSchool(
        schoolId,
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
