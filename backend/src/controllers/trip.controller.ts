import { Request, Response, NextFunction } from 'express';
import {
  CreateTripRequest,
  CreateTodayTripRequest,
  GenerateDailyTripsRequest,
  StartTripRequest,
  EndTripRequest,
  UpdateTripProgressRequest,
  CancelTripRequest,
  TripStatus,
  UserRole,
  RecordLongStopReasonRequestSchema,
  ResolveLongStopRequestSchema,
  AcknowledgeLongStopRequestSchema,
} from '@school-bus/shared';
import { TripService, TripActorContext } from '../services/trip.service.js';
import { TripTimelineService } from '../services/trip-timeline.service.js';
import { DelayIntelligenceService } from '../services/delay-intelligence.service.js';
import { DelayNotificationService } from '../services/delay-notification.service.js';
import { DelaySpamControlService } from '../services/delay-spam-control.service.js';
import { LongStopDetectionService } from '../services/long-stop-detection.service.js';
import { sendSuccess } from '../utils/response.util.js';

function extractTripActor(req: Request): TripActorContext {
  const isDriver = req.user?.role === UserRole.DRIVER || !!req.driver;
  const headerKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
  const idempotencyKey =
    typeof headerKey === 'string'
      ? headerKey
      : (req.body as any)?.idempotencyKey || (req.body as any)?.clientRequestId || undefined;

  return {
    schoolId: req.user?.schoolId || req.driver?.schoolId,
    userId: req.user?.id || req.driver?.id,
    userRole: req.user?.role || (req.driver ? UserRole.DRIVER : undefined),
    isDriver,
    idempotencyKey,
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
   * POST /api/v1/schools/:schoolId/trips/today
   * Creates / schedules today's transit trip
   */
  public static async createTodayTrip(
    req: Request<{ schoolId: string }, {}, CreateTodayTripRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId } = req.params;
      const actor = extractTripActor(req);
      const result = await TripService.createTodayTrip(schoolId, req.body, actor);
      sendSuccess(res, result, "Today's trip scheduled successfully", 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/schools/:schoolId/trips/generate-daily
   * Automatically schedules trips for today across all active routes with attached bus/driver
   */
  public static async generateDailyTrips(
    req: Request<{ schoolId: string }, {}, GenerateDailyTripsRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId } = req.params;
      const actor = extractTripActor(req);
      const result = await TripService.generateDailyTrips(schoolId, req.body, actor);
      sendSuccess(res, result, 'Daily trips generated successfully', 201);
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
    req: Request<{ schoolId: string; tripId: string }, {}, StartTripRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const actor = extractTripActor(req);
      const trip = await TripService.startTrip(schoolId, tripId, actor, req.body);
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
    req: Request<{ schoolId: string; tripId: string }, {}, EndTripRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const actor = extractTripActor(req);
      const trip = await TripService.completeTrip(schoolId, tripId, actor, req.body);
      sendSuccess(res, trip, 'Trip completed successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/schools/:schoolId/trips/:tripId/summary
   * Retrieves operational summary of completed or active trip
   */
  public static async getTripSummary(
    req: Request<{ schoolId: string; tripId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const actor = extractTripActor(req);
      const summary = await TripService.getTripSummary(schoolId, tripId, actor);
      sendSuccess(res, summary, 'Trip summary retrieved successfully');
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

  /**
   * GET /api/v1/schools/:schoolId/trips/:tripId/timeline
   * Micro-phase 25.1: Retrieves pre-calculated expected timeline for pickup stops
   */
  public static async getTripTimeline(
    req: Request<{ schoolId: string; tripId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const timeline = await TripTimelineService.getTripTimeline(tripId, schoolId);
      sendSuccess(res, timeline, 'Expected trip timeline retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/schools/:schoolId/trips/:tripId/timeline/generate
   * Micro-phase 25.1: Forces re-calculation and storage of expected timeline
   */
  public static async generateTripTimeline(
    req: Request<{ schoolId: string; tripId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const timeline = await TripTimelineService.generateAndStoreTimeline(tripId, schoolId);
      sendSuccess(res, timeline, 'Expected trip timeline generated and stored successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/schools/:schoolId/trips/:tripId/delay-comparison
   * Micro-phase 25.2: Compares current ETA vs expected timeline and returns delay minutes
   */
  public static async getTripDelayComparison(
    req: Request<{ schoolId: string; tripId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const comparison = await DelayIntelligenceService.compareTripTimeline(tripId, schoolId);
      sendSuccess(res, comparison, 'Trip delay comparison evaluated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/schools/:schoolId/trips/:tripId/affected-parents
   * Micro-phase 25.3: Identifies affected upcoming pickups and parents still waiting
   */
  public static async getAffectedParents(
    req: Request<{ schoolId: string; tripId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const minDelayMinutes = req.query.minDelayMinutes
        ? Number(req.query.minDelayMinutes)
        : 5;
      const result = await DelayIntelligenceService.identifyWaitingParents({
        schoolId,
        tripId,
        minDelayMinutes,
      });
      sendSuccess(res, result, 'Waiting affected parents identified successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/schools/:schoolId/trips/:tripId/delay-alerts/dispatch
   * Micro-phase 25.4: Dispatches delay notifications to waiting parents & staff, updates ETA
   */
  public static async dispatchDelayAlert(
    req: Request<{ schoolId: string; tripId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const minDelayMinutes = req.body?.minDelayMinutes
        ? Number(req.body.minDelayMinutes)
        : 10;
      const reason = req.body?.reason;
      const result = await DelayNotificationService.dispatchDelayAlert({
        schoolId,
        tripId,
        minDelayMinutes,
        reason,
      });
      sendSuccess(res, result, result.message);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/schools/:schoolId/trips/:tripId/delay-alerts/check-recovery
   * Micro-phase 25.4: Checks if a delayed trip has recovered on schedule and sends recovery alerts
   */
  public static async checkDelayRecovery(
    req: Request<{ schoolId: string; tripId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const result = await DelayNotificationService.checkAndDispatchRecoveryUpdate({
        schoolId,
        tripId,
      });
      sendSuccess(res, result, result.message);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/schools/:schoolId/trips/:tripId/delay-alerts/evaluate-spam-control
   * Micro-phase 25.5: Evaluates whether a delay alert meets meaningful escalation criteria
   */
  public static async evaluateDelaySpamControl(
    req: Request<{ schoolId: string; tripId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const currentDelayMinutes = Number(req.body?.currentDelayMinutes ?? 0);
      const evaluation = await DelaySpamControlService.evaluateSpamControl({
        schoolId,
        tripId,
        currentDelayMinutes,
      });
      sendSuccess(res, evaluation, evaluation.reason || 'Delay spam control evaluated');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/schools/:schoolId/trips/:tripId/long-stop/evaluate
   * Micro-phase 26.1: On-demand stationary & long stop evaluation with configurable thresholds
   */
  public static async evaluateLongStop(
    req: Request<{ schoolId: string; tripId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const {
        stationarySpeedThresholdKmh,
        longStopThresholdMinutes,
        jitterRadiusMeters,
        autoPersist = true,
      } = req.body || {};

      const result = await LongStopDetectionService.detectStationaryBus({
        schoolId,
        tripId,
        options: {
          stationarySpeedThresholdKmh:
            stationarySpeedThresholdKmh != null ? Number(stationarySpeedThresholdKmh) : undefined,
          longStopThresholdMinutes:
            longStopThresholdMinutes != null ? Number(longStopThresholdMinutes) : undefined,
          jitterRadiusMeters:
            jitterRadiusMeters != null ? Number(jitterRadiusMeters) : undefined,
        },
        autoPersist: Boolean(autoPersist),
      });

      const message = result.isLongStop
        ? `Long stop detected (${result.durationMinutes} min stationary)`
        : result.isStationary
        ? `Stationary dwell detected (${result.durationMinutes} min, below threshold)`
        : 'Vehicle is currently in motion';

      sendSuccess(res, result, message);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/schools/:schoolId/trips/:tripId/long-stop/status
   * Micro-phase 26.1: Query current stationary/long-stop status without side-effects
   */
  public static async getTripLongStopStatus(
    req: Request<{ schoolId: string; tripId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const {
        stationarySpeedThresholdKmh,
        longStopThresholdMinutes,
        jitterRadiusMeters,
      } = req.query;

      const result = await LongStopDetectionService.detectStationaryBus({
        schoolId,
        tripId,
        options: {
          stationarySpeedThresholdKmh:
            stationarySpeedThresholdKmh != null ? Number(stationarySpeedThresholdKmh) : undefined,
          longStopThresholdMinutes:
            longStopThresholdMinutes != null ? Number(longStopThresholdMinutes) : undefined,
          jitterRadiusMeters:
            jitterRadiusMeters != null ? Number(jitterRadiusMeters) : undefined,
        },
        autoPersist: false,
      });

      sendSuccess(res, result, 'Long stop status retrieved');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/schools/:schoolId/long-stops/active
   * Micro-phase 26.1: List all active long stops for a school
   */
  public static async getActiveLongStops(
    req: Request<{ schoolId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId } = req.params;
      const records = await LongStopDetectionService.getActiveLongStops(schoolId);
      sendSuccess(res, records, `Retrieved ${records.length} active long stop(s)`);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/schools/:schoolId/trips/:tripId/long-stop/reason
   * Micro-phase 26.2: Record driver reason for stationary / long stop dwell
   */
  public static async recordLongStopReason(
    req: Request<{ schoolId: string; tripId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const parsedBody = RecordLongStopReasonRequestSchema.parse(req.body);
      const actor = extractTripActor(req);

      const result = await LongStopDetectionService.recordDriverReason({
        schoolId,
        tripId,
        driverId: actor.userId,
        reason: parsedBody.reason,
        notes: parsedBody.notes,
        source: actor.isDriver ? 'APP' : 'MANUAL_OVERRIDE',
        longStopId: parsedBody.longStopId,
      });

      sendSuccess(res, result, result.message);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/schools/:schoolId/trips/:tripId/long-stop/resolve
   * Micro-phase 26.3: Resolve long stop event manually by coordinator or admin
   */
  public static async resolveLongStop(
    req: Request<{ schoolId: string; tripId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const parsedBody = ResolveLongStopRequestSchema.parse(req.body || {});
      const actor = extractTripActor(req);

      const result = await LongStopDetectionService.resolveLongStopManual({
        schoolId,
        tripId,
        longStopId: parsedBody.longStopId,
        resolvedBy: actor.userId,
        resolutionNotes: parsedBody.resolutionNotes,
      });

      sendSuccess(res, result, result.message);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/schools/:schoolId/trips/:tripId/long-stop/acknowledge
   * Micro-phase 26.3: Acknowledge long stop event by transport coordinator
   */
  public static async acknowledgeLongStop(
    req: Request<{ schoolId: string; tripId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, tripId } = req.params;
      const parsedBody = AcknowledgeLongStopRequestSchema.parse(req.body || {});
      const actor = extractTripActor(req);

      const result = await LongStopDetectionService.acknowledgeLongStop({
        schoolId,
        tripId,
        longStopId: parsedBody.longStopId,
        acknowledgedBy: actor.userId || 'coordinator',
        notes: parsedBody.notes,
      });

      sendSuccess(res, result, result.message);
    } catch (error) {
      next(error);
    }
  }
}
