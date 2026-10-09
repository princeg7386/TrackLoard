import { Request, Response } from 'express';
import { UpdateSchoolProfileRequest } from '@school-bus/shared';
import { SchoolProfileService } from '../services/school-profile.service.js';
import { SecurityUtil } from '../utils/security.util.js';
import { sendSuccess } from '../utils/response.util.js';

export class SchoolProfileController {
  /**
   * GET /api/v1/schools/:schoolId/profile
   */
  public static async getProfile(req: Request, res: Response): Promise<void> {
    const schoolId = req.params.schoolId as string;
    const profile = await SchoolProfileService.getSchoolProfile(schoolId);

    sendSuccess(res, profile, 'School profile retrieved successfully');
  }

  /**
   * PUT /api/v1/schools/:schoolId/profile
   */
  public static async updateProfile(
    req: Request<{ schoolId: string }, {}, UpdateSchoolProfileRequest>,
    res: Response
  ): Promise<void> {
    const schoolId = req.params.schoolId;
    const clientIp = SecurityUtil.getClientIp(req);
    const userId = req.user?.id;

    const updatedProfile = await SchoolProfileService.updateSchoolProfile(
      schoolId,
      req.body,
      userId,
      clientIp
    );

    sendSuccess(
      res,
      updatedProfile,
      'School profile updated successfully'
    );
  }
}
