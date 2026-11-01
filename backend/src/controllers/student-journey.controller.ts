/**
 * StudentJourneyController — Phase 32.1: Student Journey Timeline Record
 *
 * Exposes the 6-stage student journey record for school admins, transport coordinators,
 * and drivers.
 */

import { Request, Response, NextFunction } from 'express';
import { StudentJourneyService } from '../services/student-journey.service.js';
import { ValidationError } from '../middlewares/error.middleware.js';

export class StudentJourneyController {
  /**
   * GET /schools/:schoolId/students/:studentId/journey
   *
   * Query params:
   *   tripId — optional target trip UUID (defaults to active or most recent trip)
   */
  static async getStudentJourneyTimeline(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, studentId } = req.params;
      const tripId = req.query.tripId as string | undefined;

      if (!schoolId || !studentId) {
        throw new ValidationError('schoolId and studentId parameters are required');
      }

      const journey = await StudentJourneyService.getStudentJourneyTimeline(
        schoolId,
        studentId,
        tripId
      );

      res.status(200).json({
        success: true,
        message: 'Student journey timeline retrieved successfully',
        data: journey,
      });
    } catch (err) {
      next(err);
    }
  }
}
