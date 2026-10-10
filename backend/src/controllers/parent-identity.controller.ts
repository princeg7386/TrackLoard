import { Request, Response } from 'express';
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
    res: Response
  ): Promise<void> {
    const { phone, schoolId } = req.body;
    const records = await ParentIdentityService.lookupParentsByPhone(phone, schoolId);

    sendSuccess(
      res,
      { records, count: records.length },
      'Parent identity lookup completed successfully'
    );
  }

  /**
   * Generate a secure tracking token and link for a parent & student
   */
  public static async generateToken(
    req: Request<{}, {}, GenerateParentTokenRequest>,
    res: Response
  ): Promise<void> {
    const tokenData = await ParentIdentityService.createTrackingToken(req.body);

    sendSuccess(
      res,
      tokenData,
      'Parent live tracking token generated successfully',
      201
    );
  }

  /**
   * Revoke a single active tracking token
   */
  public static async revokeToken(
    req: Request<{}, {}, RevokeParentTokenRequest>,
    res: Response
  ): Promise<void> {
    const tokenOrId = req.body.token || req.body.tokenId!;
    const revoked = await ParentIdentityService.revokeToken(
      tokenOrId,
      req.body.reason
    );

    sendSuccess(
      res,
      { revoked },
      revoked
        ? 'Tracking token revoked successfully'
        : 'Token was already revoked or not found'
    );
  }

  /**
   * Revoke all active tracking tokens for a student
   */
  public static async revokeStudentTokens(
    req: Request<{}, {}, RevokeStudentTokensRequest>,
    res: Response
  ): Promise<void> {
    const { studentId, schoolId, reason } = req.body;
    const revokedCount = await ParentIdentityService.revokeAllTokensForStudent(
      studentId,
      schoolId,
      reason
    );

    sendSuccess(
      res,
      { studentId, revokedCount },
      `Successfully revoked ${revokedCount} active tracking link(s) for student`
    );
  }

  /**
   * Get verified live tracking session metadata for parent web view
   */
  public static async getLiveTrackingSession(
    req: Request,
    res: Response
  ): Promise<void> {
    // If authenticated via middleware, req.parentTrackingSession is already populated
    if (req.parentTrackingSession) {
      sendSuccess(
        res,
        req.parentTrackingSession,
        'Live tracking session verified successfully'
      );
      return;
    }

    const tokenParam = req.params.token;
    const queryParam = req.query.token;
    const rawToken =
      typeof tokenParam === 'string'
        ? tokenParam
        : typeof queryParam === 'string'
          ? queryParam
          : '';

    const session = await ParentIdentityService.verifyTrackingToken(rawToken);

    sendSuccess(
      res,
      session,
      'Live tracking session verified successfully'
    );
  }

  /**
   * List all parents for a school with linked student context & WhatsApp tracking status
   */
  public static async listSchoolParents(
    req: Request,
    res: Response
  ): Promise<void> {
    const schoolId = req.params.schoolId;
    const { relationship, search, whatsAppStatus } = req.query as {
      relationship?: string;
      search?: string;
      whatsAppStatus?: string;
    };

    const parents = await ParentIdentityService.getSchoolParents(schoolId, {
      relationship,
      search,
      whatsAppStatus,
    });

    sendSuccess(
      res,
      parents,
      'School parents retrieved successfully'
    );
  }

  /**
   * Get full assignment details (student, transport, live tracking token) for a parent
   */
  public static async getAssignmentDetails(
    req: Request,
    res: Response
  ): Promise<void> {
    const { schoolId, parentId } = req.params;
    const assignment = await ParentIdentityService.getParentAssignmentDetails(
      schoolId,
      parentId
    );

    sendSuccess(
      res,
      assignment,
      'Parent assignment details retrieved successfully'
    );
  }

  /**
   * Re-link an existing parent to another authorized student in the same school
   */
  public static async relinkStudent(
    req: Request,
    res: Response
  ): Promise<void> {
    const { schoolId, parentId } = req.params;
    const { studentId } = req.body;
    const adminUserId = req.user?.id || null;

    const assignment = await ParentIdentityService.relinkParentStudent(
      schoolId,
      parentId,
      studentId,
      adminUserId
    );

    sendSuccess(
      res,
      assignment,
      'Parent successfully linked to authorized student'
    );
  }

  /**
   * Get communication history (WhatsApp notices + token events) for a parent
   */
  public static async getCommunicationHistory(
    req: Request,
    res: Response
  ): Promise<void> {
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
  }

  /**
   * Dispatch an outbound notice/message to parent's registered WhatsApp phone
   */
  public static async sendNotice(
    req: Request,
    res: Response
  ): Promise<void> {
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
  }
}

