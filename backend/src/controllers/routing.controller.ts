import { Request, Response, NextFunction } from 'express';
import {
  CalculateRouteRequest,
  EtaCalculationQuery,
  DistanceMatrixQuery,
  SnapToRoadQuery,
  GeocodeQuery,
  ReverseGeocodeQuery,
  SelectMapOptionRequest,
} from '@school-bus/shared';
import { RoutingService } from '../services/routing/routing.service.js';
import { MapService } from '../services/maps/map.service.js';
import { sendSuccess } from '../utils/response.util.js';
import { ForbiddenError } from '../middlewares/error.middleware.js';

export class RoutingController {
  /**
   * POST /api/v1/routing/calculate
   * Compute multi-waypoint route directions, distance, duration, and polyline
   */
  public static async calculateRoute(
    req: Request<{}, {}, CalculateRouteRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { waypoints, options } = req.body;
      const result = await RoutingService.calculateRoute(waypoints, options);
      sendSuccess(res, result, 'Route directions calculated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/routing/eta
   * Compute estimated arrival time between two points
   */
  public static async calculateEta(
    req: Request<{}, {}, EtaCalculationQuery>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await RoutingService.calculateEta(req.body);
      sendSuccess(res, result, 'Estimated arrival calculated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/routing/matrix
   * Compute distance & duration matrix between origins and destinations
   */
  public static async calculateMatrix(
    req: Request<{}, {}, DistanceMatrixQuery>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await RoutingService.calculateDistanceMatrix(req.body);
      sendSuccess(res, result, 'Distance matrix computed successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/routing/snap-to-road
   * Snap raw GPS points to realistic road geometry
   */
  public static async snapToRoad(
    req: Request<{}, {}, SnapToRoadQuery>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await RoutingService.snapToRoad(req.body.points);
      sendSuccess(res, result, 'Coordinates snapped to road successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/routing/geocode
   * Search location by address or query string
   */
  public static async geocode(
    req: Request<{}, {}, GeocodeQuery>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const results = await MapService.geocode(req.body);
      sendSuccess(res, results, 'Geocoding completed successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/routing/reverse-geocode
   * Resolve location address from latitude & longitude
   */
  public static async reverseGeocode(
    req: Request<{}, {}, ReverseGeocodeQuery>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = await MapService.reverseGeocode(req.body);
      sendSuccess(res, result, 'Reverse geocoding completed successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/schools/:schoolId/routes/:routeId/directions
   * Fetch and calculate full sequenced path for a school's route
   */
  public static async getRouteDirections(
    req: Request<{ schoolId: string; routeId: string }>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { schoolId, routeId } = req.params;
      const tenantSchoolId = req.user?.schoolId;

      if (!tenantSchoolId || schoolId !== tenantSchoolId) {
        throw new ForbiddenError('Unauthorized: Access restricted to caller school context');
      }

      const result = await RoutingService.calculateAndPersistRouteForStops(schoolId, routeId);
      sendSuccess(res, result, 'Route directions and stops retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/routing/options
   * Retrieve active and available free-first map and routing configurations
   */
  public static async getFreeMapOptions(
    _req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const options = MapService.getFreeMapOptions();
      sendSuccess(res, options, 'Free-first map options retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/routing/options/select
   * Dynamically switch active free-first tile layer, geocoding or routing options
   */
  public static async selectFreeMapOption(
    req: Request<{}, {}, SelectMapOptionRequest>,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { tileLayer, geocodingProvider, routingProvider } = req.body;
      if (tileLayer) {
        MapService.setTileLayerOption(tileLayer);
      }
      if (geocodingProvider) {
        MapService.setGeocodingOption(geocodingProvider);
      }
      if (routingProvider) {
        RoutingService.setRoutingOption(routingProvider);
      }

      const updated = MapService.getFreeMapOptions();
      sendSuccess(res, updated, 'Free-first map configuration updated successfully');
    } catch (error) {
      next(error);
    }
  }
}

