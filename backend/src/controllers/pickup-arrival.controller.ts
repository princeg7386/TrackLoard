/**
 * PickupArrivalController — Phase 31.1: Upcoming Student Pickup
 *
 * Thin HTTP layer. Business logic lives in PickupArrivalService.
 */

import { Request, Response, NextFunction } from 'express';
import { PickupArrivalService } from '../services/pickup-arrival.service.js';
import { ValidationError } from '../middlewares/error.middleware.js';

export class PickupArrivalController {
  /**
   * GET /schools/:schoolId/trips/:tripId/upcoming-students
   *
   * Returns the next pickup stop and students for an active trip.
   * Used by: driver app, admin dashboard, parent notification system.
   *
   * Auth: SCHOOL_ADMIN | TRANSPORT_COORDINATOR | DRIVER
   */
  static async getUpcomingStudents(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;

      if (!schoolId || !tripId) {
        throw new ValidationError('schoolId and tripId params are required');
      }

      const result = await PickupArrivalService.getUpcomingStudents(tripId, schoolId);

      const message = result.allPickupsComplete
        ? 'All pickups complete for this trip'
        : `Next pickup: ${result.nextStop!.name} — ${result.totalPending} student(s) pending`;

      res.json({
        success: true,
        message,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
}
