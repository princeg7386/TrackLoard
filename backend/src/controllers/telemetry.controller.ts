import { Request, Response, NextFunction } from 'express';
import { TelemetryService } from '../services/telemetry.service.js';
import { GpsHealthService } from '../services/gps-health.service.js';
import { GpsOfflineDetectionService } from '../services/gps-offline-detection.service.js';
import { RouteDeviationService } from '../services/route-deviation.service.js';
import { RealtimeFeedService } from '../services/realtime-feed.service.js';
import { EtaService } from '../services/eta.service.js';
import { GeofenceService } from '../services/geofence.service.js';
import { NotFoundError } from '../middlewares/error.middleware.js';
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

  /**
   * GET /api/v1/telemetry/trips/:tripId/eta
   * Phase 20.2 — Compute and return live ETA for all remaining stops on a trip.
   *
   * Tenant isolation: requireActorTenantScope ensures the caller's schoolId
   * matches the trip's school_id (enforced inside EtaService.assembleContext).
   */
  static async getTripEta(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tripId } = req.params as { tripId: string };
      const schoolId: string = (req as any).user?.schoolId;

      const summary = await EtaService.calculateTripEta(tripId, schoolId);

      res.status(200).json({
        success: true,
        message: 'ETA calculated successfully',
        data: summary,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/telemetry/trips/:tripId/eta/stops/:stopId
   * Phase 20.4 — Return parent-specific pickup stop ETA for an admin/coordinator.
   */
  static async getStopEta(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tripId, stopId } = req.params as { tripId: string; stopId: string };
      const schoolId: string = (req as any).user?.schoolId;

      const parentEta = await EtaService.calculateParentEta({
        tripId,
        schoolId,
        stopId,
      });

      res.status(200).json({
        success: true,
        message: 'Stop ETA retrieved successfully',
        data: parentEta,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/telemetry/trips/:tripId/geofence-states
   * Phase 21.1 — Retrieves active geofence states for all stops on a trip.
   */
  static async getTripGeofenceStates(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tripId } = req.params as { tripId: string };
      const schoolId: string = (req as any).user?.schoolId;

      const states = await GeofenceService.getTripGeofenceStates(tripId, schoolId);

      res.status(200).json({
        success: true,
        message: 'Trip geofence states retrieved successfully',
        data: states,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/telemetry/trips/:tripId/geofence-events
   * Phase 21.1 — Retrieves historical entry and exit events for a trip.
   */
  static async getTripGeofenceEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tripId } = req.params as { tripId: string };
      const schoolId: string = (req as any).user?.schoolId;

      const events = await GeofenceService.getTripGeofenceEvents(tripId, schoolId);

      res.status(200).json({
        success: true,
        message: 'Trip geofence events retrieved successfully',
        data: events,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/telemetry/schools/:schoolId/offline-events
   * Phase 27.1 — Retrieve active GPS offline/disconnect events for a school
   */
  static async getSchoolOfflineEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      const events = await GpsOfflineDetectionService.getActiveOfflineEvents(schoolId!);

      res.status(200).json({
        success: true,
        data: events,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/telemetry/schools/:schoolId/offline-events/scan
   * Phase 27.1 — Trigger fleet offline evaluation across all active trips
   */
  static async scanFleetOfflineStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      const staleThreshold = req.body?.staleThresholdSeconds ? Number(req.body.staleThresholdSeconds) : undefined;
      const disconnectThreshold = req.body?.disconnectThresholdSeconds ? Number(req.body.disconnectThresholdSeconds) : undefined;

      const summary = await GpsOfflineDetectionService.scanActiveTripsForOffline(schoolId!, {
        staleThresholdSeconds: staleThreshold,
        disconnectThresholdSeconds: disconnectThreshold,
      });

      res.status(200).json({
        success: true,
        data: summary,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/telemetry/trips/:tripId/offline-status
   * Phase 27.1 — Check real-time offline/connectivity status for a single trip
   */
  static async getTripOfflineStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tripId } = req.params;
      const callerSchoolId = (req as any).tenantSchoolId ?? req.user?.schoolId;

      const result = await GpsOfflineDetectionService.detectTripOfflineStatus(tripId!);

      // Enforce tenant isolation if schoolId is available on the caller
      if (callerSchoolId && result.schoolId !== callerSchoolId) {
        throw new NotFoundError(`Trip with ID '${tripId}' not found`);
      }

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/telemetry/trips/:tripId/app-disconnect
   * Phase 27.1 — Driver app lifecycle disconnect reporting
   */
  static async reportAppDisconnect(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tripId } = req.params;
      const driverId = (req as any).driver?.id || (req as any).user?.id;

      const event = await GpsOfflineDetectionService.reportAppDisconnect({
        tripId: tripId!,
        driverId,
        payload: req.body,
      });

      res.status(200).json({
        success: true,
        message: 'Driver app disconnect recorded successfully',
        data: event,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/telemetry/schools/:schoolId/trips/:tripId/offline/respond
   * Phase 27.2 — Trigger offline response workflow (store last known, notify school, notify driver)
   */
  static async respondToOfflineTrip(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tripId, schoolId } = req.params;
      const forceNotify = Boolean(req.body?.forceNotify);

      const result = await GpsOfflineDetectionService.respondToOfflineTrip({
        tripId: tripId!,
        schoolId,
        forceNotify,
      });

      res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/telemetry/trips/:tripId/last-known-location
   * Phase 27.2 — Retrieve locked last known location details with staleness indicators
   */
  static async getLastKnownLocation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tripId } = req.params;

      const location = await GpsOfflineDetectionService.getLastKnownLocation(tripId!);

      res.status(200).json({
        success: true,
        data: location,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/telemetry/trips/:tripId/reconnect
   * Phase 27.3 — Automatic reconnection & queued batch upload from driver app
   */
  static async reconnectTrip(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tripId } = req.params;
      const driverId = (req as any).driver?.id || (req as any).user?.id;
      const locations = req.body?.locations || [];

      const result = await GpsOfflineDetectionService.processRecoveryBatch({
        tripId: tripId!,
        locations,
        authenticatedDriverId: driverId,
      });

      res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/telemetry/schools/:schoolId/trips/:tripId/offline/recover
   * Phase 27.3 — Manually mark an offline event as recovered by school coordinator
   */
  static async recoverTripOffline(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tripId } = req.params;
      const recoveryReason = req.body?.recoveryReason || 'MANUAL_COORDINATOR_RECOVERY';

      const result = await GpsOfflineDetectionService.markTripRecovered({
        tripId: tripId!,
        recoveryReason,
      });

      res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/telemetry/schools/:schoolId/routes/:routeId/geometry
   * Phase 28.1 — Load expected route geometry, stops, and coordinates
   */
  static async getRouteGeometry(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { routeId } = req.params;
      const geometry = await RouteDeviationService.loadRouteGeometry(routeId!);

      res.status(200).json({
        success: true,
        message: 'Route geometry retrieved successfully',
        data: geometry,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/telemetry/trips/:tripId/route-position
   * Phase 28.1 — Real-time bus position relative to expected route
   */
  static async getTripRoutePosition(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tripId } = req.params;
      const thresholdQuery = req.query.deviationThresholdMeters;
      const options = thresholdQuery
        ? { deviationThresholdMeters: Number(thresholdQuery) }
        : undefined;

      const position = await RouteDeviationService.getTripRoutePosition(tripId!, options);

      res.status(200).json({
        success: true,
        message: 'Trip route position evaluated successfully',
        data: position,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/telemetry/schools/:schoolId/trips/:tripId/deviation
   * Phase 28.2 — Get active deviation event for a trip
   */
  static async getTripActiveDeviation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tripId } = req.params;
      const deviation = await RouteDeviationService.getActiveDeviationForTrip(tripId!);

      res.status(200).json({
        success: true,
        message: deviation ? 'Active deviation event found' : 'No active deviation event',
        data: deviation,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/telemetry/schools/:schoolId/deviations
   * Phase 28.2 — List all active deviation events for a school
   */
  static async getSchoolActiveDeviations(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      const deviations = await RouteDeviationService.getActiveDeviationsForSchool(schoolId!);

      res.status(200).json({
        success: true,
        message: `${deviations.length} active deviation event(s) found`,
        data: deviations,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/telemetry/schools/:schoolId/deviations/:deviationId/notify
   * Phase 28.3 — Manually re-trigger school + driver notifications for a deviation
   */
  static async manualNotifyDeviation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { deviationId } = req.params;
      // Force bypass cooldown for manual coordinator action
      const result = await RouteDeviationService.dispatchDeviationNotifications(deviationId!, true);

      res.status(200).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}
