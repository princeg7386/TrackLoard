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
   * Retrieve the most recent GPS location of a bus.
   * Enforces tenant isolation: the service returns 404 unless the bus belongs to the caller's school.
   */
  static async getLatestBusLocation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { busId } = req.params;
      // Pass callerSchoolId into the service so the school check is mockable in unit tests.
      const callerSchoolId = (req as any).tenantSchoolId ?? req.user?.schoolId;

      const location = await TelemetryService.getLatestBusLocation(busId!, callerSchoolId);

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
   * Retrieve location trail for a trip.
   * Enforces tenant isolation: the service returns 404 unless the trip belongs to the caller's school.
   */
  static async getTripTrail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tripId } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 200;
      // Pass callerSchoolId into the service so the school check is mockable in unit tests.
      const callerSchoolId = (req as any).tenantSchoolId ?? req.user?.schoolId;

      const trail = await TelemetryService.getTripLocationTrail(tripId!, limit, callerSchoolId);

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
   * Retrieve real-time GPS health summary for a specific bus.
   * Enforces tenant isolation: the service returns 404 unless the bus belongs to the caller's school.
   */
  static async getBusHealth(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { busId } = req.params;
      // Pass callerSchoolId into the service so the school check is mockable in unit tests.
      const callerSchoolId = (req as any).tenantSchoolId ?? req.user?.schoolId;

      const result = await GpsHealthService.getBusGpsHealth(busId!, callerSchoolId);

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

      RealtimeFeedService.initSseStream(res);

      const initialFleet = await GpsHealthService.getSchoolFleetGpsHealth(schoolId!);
      RealtimeFeedService.sendSseMessage(res, 'initial_state', initialFleet);

      const unsubscribe = RealtimeFeedService.subscribeSchool(schoolId!, (event) => {
        RealtimeFeedService.sendSseMessage(res, 'location_update', event);
      });

      const heartbeatInterval = setInterval(() => {
        RealtimeFeedService.sendSseHeartbeat(res);
      }, 20000);

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
   * Real-time SSE telemetry feed for a specific trip.
   * Enforces tenant isolation: the service returns 404 unless the trip belongs to the caller's school.
   */
  static async streamTripFeed(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tripId } = req.params;
      // Pass callerSchoolId into the service so the school check is mockable in unit tests.
      const callerSchoolId = (req as any).tenantSchoolId ?? req.user?.schoolId;

      // Fetch initial trail first — getTripLocationTrail enforces school ownership when
      // callerSchoolId is set. Done BEFORE initSseStream so a 404 can still be returned.
      // In unit tests this call is mocked via vi.spyOn so no real DB is needed.
      const recentTrail = await TelemetryService.getTripLocationTrail(tripId!, 20, callerSchoolId);

      RealtimeFeedService.initSseStream(res);
      RealtimeFeedService.sendSseMessage(res, 'initial_state', {
        tripId,
        recentTrail,
      });

      const unsubscribe = RealtimeFeedService.subscribeTrip(tripId!, (event) => {
        RealtimeFeedService.sendSseMessage(res, 'location_update', event);
      });

      const heartbeatInterval = setInterval(() => {
        RealtimeFeedService.sendSseHeartbeat(res);
      }, 20000);

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
   * GET /api/v1/telemetry/buses/:busId/feed
   * Real-time SSE telemetry feed for a specific bus.
   * Enforces tenant isolation: verifies bus belongs to the caller's school.
   */
  static async streamBusFeed(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { busId } = req.params;
      const callerSchoolId = (req as any).tenantSchoolId ?? req.user?.schoolId;

      // Verify bus exists and belongs to the caller's school before initiating SSE
      const busState = await GpsHealthService.getBusGpsHealth(busId!, callerSchoolId);

      RealtimeFeedService.initSseStream(res);
      RealtimeFeedService.sendSseMessage(res, 'initial_state', busState);

      const unsubscribe = RealtimeFeedService.subscribeBus(busId!, (event) => {
        RealtimeFeedService.sendSseMessage(res, 'location_update', event);
      });

      const heartbeatInterval = setInterval(() => {
        RealtimeFeedService.sendSseHeartbeat(res);
      }, 20000);

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
