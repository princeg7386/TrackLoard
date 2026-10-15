import { Request, Response, NextFunction } from 'express';
import { TelemetryService } from '../services/telemetry.service.js';
import { GpsHealthService } from '../services/gps-health.service.js';
import { RealtimeFeedService } from '../services/realtime-feed.service.js';
import { TelemetryIngestPayload } from '@school-bus/shared';

export class TelemetryController {
  /**
   * POST /api/v1/telemetry/ingest
   * Ingest single real-time GPS telemetry ping
   */
  static async ingest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const payload = req.body as TelemetryIngestPayload;
      const authenticatedDriverId = req.driver?.id || (req as any).user?.id;

      const result = await TelemetryService.ingestLocation(payload, authenticatedDriverId);

      res.status(201).json({
        success: true,
        message: 'GPS telemetry ping ingested successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/telemetry/batch
   * Ingest batch of offline buffered GPS telemetry pings
   */
  static async ingestBatch(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { locations } = req.body as { locations: TelemetryIngestPayload[] };
      const authenticatedDriverId = req.driver?.id || (req as any).user?.id;

      const result = await TelemetryService.ingestBatch(locations, authenticatedDriverId);

      res.status(200).json({
        success: true,
        message: `Successfully ingested ${result.ingestedCount} telemetry pings in batch`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/telemetry/buses/:busId/latest
   * Retrieve the most recent GPS location of a bus
   */
  static async getLatestBusLocation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { busId } = req.params;
      const location = await TelemetryService.getLatestBusLocation(busId!);

      res.status(200).json({
        success: true,
        data: location,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/telemetry/trips/:tripId/trail
   * Retrieve location trail points for an active or completed trip
   */
  static async getTripTrail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tripId } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 200;

      const trail = await TelemetryService.getTripLocationTrail(tripId!, limit);

      res.status(200).json({
        success: true,
        data: {
          tripId,
          count: trail.length,
          trail,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/telemetry/schools/:schoolId/health
   * Retrieve real-time GPS health overview for school fleet
   */
  static async getFleetHealth(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      const result = await GpsHealthService.getSchoolFleetGpsHealth(schoolId!);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/telemetry/buses/:busId/health
   * Retrieve real-time GPS health summary for a specific bus
   */
  static async getBusHealth(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { busId } = req.params;
      const result = await GpsHealthService.getBusGpsHealth(busId!);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/telemetry/schools/:schoolId/feed
   * Real-time Server-Sent Events (SSE) telemetry feed for school admin fleet canvas
   */
  static async streamSchoolFeed(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;

      // 1. Initialize SSE connection headers
      RealtimeFeedService.initSseStream(res);

      // 2. Fetch and dispatch initial fleet state
      const initialFleet = await GpsHealthService.getSchoolFleetGpsHealth(schoolId!);
      RealtimeFeedService.sendSseMessage(res, 'initial_state', initialFleet);

      // 3. Subscribe to real-time telemetry updates for this school
      const unsubscribe = RealtimeFeedService.subscribeSchool(schoolId!, (event) => {
        RealtimeFeedService.sendSseMessage(res, 'location_update', event);
      });

      // 4. Setup periodic heartbeat ping to prevent timeouts
      const heartbeatInterval = setInterval(() => {
        RealtimeFeedService.sendSseHeartbeat(res);
      }, 20000);

      // 5. Clean up on client disconnect
      req.on('close', () => {
        clearInterval(heartbeatInterval);
        unsubscribe();
        res.end();
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/telemetry/trips/:tripId/feed
   * Real-time Server-Sent Events (SSE) telemetry feed for a specific trip
   */
  static async streamTripFeed(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tripId } = req.params;

      // 1. Initialize SSE connection headers
      RealtimeFeedService.initSseStream(res);

      // 2. Fetch and dispatch recent trail as initial state
      const recentTrail = await TelemetryService.getTripLocationTrail(tripId!, 20);
      RealtimeFeedService.sendSseMessage(res, 'initial_state', {
        tripId,
        recentTrail,
      });

      // 3. Subscribe to real-time telemetry updates for this trip
      const unsubscribe = RealtimeFeedService.subscribeTrip(tripId!, (event) => {
        RealtimeFeedService.sendSseMessage(res, 'location_update', event);
      });

      // 4. Setup periodic heartbeat ping
      const heartbeatInterval = setInterval(() => {
        RealtimeFeedService.sendSseHeartbeat(res);
      }, 20000);

      // 5. Clean up on client disconnect
      req.on('close', () => {
        clearInterval(heartbeatInterval);
        unsubscribe();
        res.end();
      });
    } catch (error) {
      next(error);
    }
  }
}

