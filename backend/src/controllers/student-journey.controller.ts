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

  /**
   * Route 120 — GET /schools/:schoolId/students/:studentId/journey/history
   *
   * Query params:
   *   startDate — optional ISO date filter (YYYY-MM-DD)
   *   endDate   — optional ISO date filter (YYYY-MM-DD)
   *   limit     — optional result limit (default 20, max 100)
   *   offset    — optional pagination offset (default 0)
   */
  static async getStudentJourneyHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, studentId } = req.params;
      const { startDate, endDate, limit, offset } = req.query;

      if (!schoolId || !studentId) {
        throw new ValidationError('schoolId and studentId parameters are required');
      }

      const history = await StudentJourneyService.getStudentMultiTripHistory(
        schoolId,
        studentId,
        {
          startDate: typeof startDate === 'string' ? startDate : undefined,
          endDate: typeof endDate === 'string' ? endDate : undefined,
          limit: limit ? Number(limit) : undefined,
          offset: offset ? Number(offset) : undefined,
        }
      );

      res.status(200).json({
        success: true,
        message: 'Student journey history retrieved successfully',
        data: history,
      });
    } catch (err) {
      next(err);
    }
  }
}
