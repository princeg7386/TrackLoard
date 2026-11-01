/**
 * PickupArrivalController — Phase 31.1 & 31.3: Pickup Arrival Workflow
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

  /**
   * POST /schools/:schoolId/trips/:tripId/stops/:stopId/arrival
   *
   * Records arrival at a stop, triggers geofence ENTRY event + parent WhatsApp notification,
   * and unlocks boarding for the stop.
   *
   * Auth: SCHOOL_ADMIN | TRANSPORT_COORDINATOR | DRIVER
   */
  static async recordStopArrival(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId, stopId } = req.params;

      if (!schoolId || !tripId || !stopId) {
        throw new ValidationError('schoolId, tripId, and stopId params are required');
      }

      const result = await PickupArrivalService.recordStopArrival(schoolId, tripId, stopId);

      res.status(200).json({
        success: true,
        message: `Arrived at ${result.stopName} — boarding is now active`,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
}
