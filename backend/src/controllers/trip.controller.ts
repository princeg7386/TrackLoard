import { Request, Response, NextFunction } from 'express';
import {
  CreateTripRequest,
  UpdateTripProgressRequest,
  CancelTripRequest,
  TripStatus,
  UserRole,
} from '@school-bus/shared';
import { TripService, TripActorContext } from '../services/trip.service.js';
import { sendSuccess } from '../utils/response.util.js';

function extractTripActor(req: Request): TripActorContext {
  const isDriver = req.user?.role === UserRole.DRIVER || !!req.driver;
  return {
    schoolId: req.user?.schoolId || req.driver?.schoolId,
    userId: req.user?.id || req.driver?.id,
    userRole: req.user?.role || (req.driver ? UserRole.DRIVER : undefined),
    isDriver,
  };
}

export class TripController {
  /**
   * POST /api/v1/schools/:schoolId/trips
   * Creates / schedules a new transit trip (NOT_STARTED)
   */
  public static async createTrip(
    req: Request<{ schoolId: string }, {}, CreateTripRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId } = req.params;
      const actor = extractTripActor(req);
      const result = await TripService.createTrip(schoolId, req.body, actor);
      sendSuccess(res, result, 'Trip scheduled successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/schools/:schoolId/trips
   * Lists trips with optional filters (date, route, bus, driver, status)
   */
  public static async listTrips(
    req: Request<{ schoolId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId } = req.params;
      const actor = extractTripActor(req);
      const filters = {
        date: typeof req.query.date === 'string' ? req.query.date : undefined,
        routeId: typeof req.query.routeId === 'string' ? req.query.routeId : undefined,
        busId: typeof req.query.busId === 'string' ? req.query.busId : undefined,
        driverId: typeof req.query.driverId === 'string' ? req.query.driverId : undefined,
        status:
          typeof req.query.status === 'string' &&
          Object.values(TripStatus).includes(req.query.status as TripStatus)
            ? (req.query.status as TripStatus)
            : undefined,
      };

      const trips = await TripService.listTrips(schoolId, filters, actor);
      sendSuccess(res, trips, 'Trips retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/schools/:schoolId/trips/:tripId
   * Retrieves full details and computed lifecycle stage for a single trip
   */
  public static async getTrip(
    req: Request<{ schoolId: string; tripId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const actor = extractTripActor(req);
      const trip = await TripService.getTripById(schoolId, tripId, actor);
      sendSuccess(res, trip, 'Trip retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/schools/:schoolId/trips/:tripId/start
   * Transitions trip from NOT_STARTED to STARTED / IN_TRANSIT
   */
  public static async startTrip(
    req: Request<{ schoolId: string; tripId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const actor = extractTripActor(req);
      const trip = await TripService.startTrip(schoolId, tripId, actor);
      sendSuccess(res, trip, 'Trip started successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/v1/schools/:schoolId/trips/:tripId/progress
   * Updates current stop sequence and delay minutes (IN_TRANSIT)
   */
  public static async updateProgress(
    req: Request<{ schoolId: string; tripId: string }, {}, UpdateTripProgressRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const actor = extractTripActor(req);
      const trip = await TripService.updateTripProgress(schoolId, tripId, req.body, actor);
      sendSuccess(res, trip, 'Trip progress updated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/schools/:schoolId/trips/:tripId/arrive-school
   * Records school arrival milestone (ARRIVED_SCHOOL)
   */
  public static async arriveAtSchool(
    req: Request<{ schoolId: string; tripId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const actor = extractTripActor(req);
      const trip = await TripService.arriveAtSchool(schoolId, tripId, actor);
      sendSuccess(res, trip, 'School arrival recorded successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/schools/:schoolId/trips/:tripId/complete
   * Transitions trip to COMPLETED and sets actual_end_time
   */
  public static async completeTrip(
    req: Request<{ schoolId: string; tripId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const actor = extractTripActor(req);
      const trip = await TripService.completeTrip(schoolId, tripId, actor);
      sendSuccess(res, trip, 'Trip completed successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/schools/:schoolId/trips/:tripId/cancel
   * Cancels a scheduled or in-transit trip with cancellation reason
   */
  public static async cancelTrip(
    req: Request<{ schoolId: string; tripId: string }, {}, CancelTripRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const actor = extractTripActor(req);
      const trip = await TripService.cancelTrip(schoolId, tripId, req.body.reason, actor);
      sendSuccess(res, trip, 'Trip cancelled successfully');
    } catch (error) {
      next(error);
    }
  }
}
