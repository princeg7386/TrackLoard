import { Request, Response, NextFunction } from 'express';
import {
  RequestParentLocation,
  ParentLocationShareRequest,
  ValidateCoordinatesQuery,
  FindNearestRoadQuery,
  CreatePickupPointRequest,
} from '@school-bus/shared';
import { DynamicPickupService } from '../services/dynamic-pickup/dynamic-pickup.service.js';
import { sendSuccess } from '../utils/response.util.js';
import { ForbiddenError } from '../middlewares/error.middleware.js';

export class DynamicPickupController {
  /**
   * POST /api/v1/parent/location/request
   * Dispatches WhatsApp interactive Location Request to student's parent(s)
   */
  public static async requestParentLocation(
    req: Request<{}, {}, RequestParentLocation>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, studentId, parentPhone, customPrompt } = req.body;
      const callerSchoolId = req.user?.schoolId;

      if (callerSchoolId && callerSchoolId !== schoolId) {
        throw new ForbiddenError('Unauthorized: Access restricted to caller school context');
      }

      const result = await DynamicPickupService.requestParentLocation({
        schoolId,
        studentId,
        parentPhone,
        customPrompt,
      });

      sendSuccess(res, result, 'WhatsApp location request dispatched successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/parent/location/share
   * Ingest and validate a location shared by a parent (via live web link or direct app)
   */
  public static async shareLocation(
    req: Request<{}, {}, ParentLocationShareRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const params = req.body;

      const session = (req as any).parentTrackingSession || (req as any).parentSession;
      if (session) {
        params.studentId = params.studentId || session.studentId;
        params.schoolId = params.schoolId || session.schoolId;
        params.senderPhone = params.senderPhone || session.parentPhone;
      }

      const result = await DynamicPickupService.receiveAndValidateParentLocation(params);
      sendSuccess(res, result, 'Parent location received and validated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/parent/location/validate
   * Standalone coordinate validation check (India bounds, catchment zone, road accessibility)
   */
  public static async validateCoordinates(
    req: Request<{}, {}, ValidateCoordinatesQuery>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await DynamicPickupService.validateCoordinates(req.body);
      sendSuccess(res, result, 'Coordinates validated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/parent/webhook/whatsapp
   * Inbound WhatsApp Cloud API webhook receiver for parent location sharing
   */
  public static async handleWhatsAppWebhook(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await DynamicPickupService.handleWhatsAppInboundPayload(req.body);
      res.status(200).json({
        success: true,
        handled: result.handled,
        data: result.result || null,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/parent/pickup/nearest-road
   * Finds nearest navigable road segment, snapping offset, and readable address
   */
  public static async findNearestRoad(
    req: Request<{}, {}, FindNearestRoadQuery>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await DynamicPickupService.findNearestSuitableRoad(req.body);
      sendSuccess(res, result, 'Nearest road and readable address resolved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/parent/pickup/create-point
   * Creates or deduplicates a pickup location and assigns it to a route and optional student
   */
  public static async createPickupPoint(
    req: Request<{}, {}, CreatePickupPointRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const actorSchoolId = req.user?.schoolId || undefined;
      const result = await DynamicPickupService.createOrAssignPickupPoint(req.body, actorSchoolId);
      sendSuccess(res, result, 'Pickup point created and stored successfully', 201);
    } catch (error) {
      next(error);
    }
  }
}

