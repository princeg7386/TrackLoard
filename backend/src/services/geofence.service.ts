import { query } from '../config/database.js';
import {
  GeoCoordinates,
  GeofenceShape,
  GeofenceTransition,
  EvaluateTripGeofenceResult,
  TripStopGeofenceState,
  GeofenceEventRecord,
  UpdateStopGeofenceRequest,
} from '@school-bus/shared';
import { SpatialService } from './spatial.service.js';
import { RealtimeFeedService } from './realtime-feed.service.js';
import { logger } from './logger.service.js';
import { NotFoundError, BadRequestError, ForbiddenError } from '../middlewares/error.middleware.js';

interface RouteStopRow {
  id: string;
  stopName: string;
  sequenceOrder: number;
  latitude: number;
  longitude: number;
  geofenceType: 'RADIUS' | 'POLYGON';
  geofenceRadiusMeters: number;
  geofencePolygon: GeoCoordinates[] | null;
}

interface GeofenceStateRow {
  stopId: string;
  status: 'INSIDE' | 'OUTSIDE';
  enteredAt: string | null;
  exitedAt: string | null;
  dwellTimeSeconds: number;
}

/**
 * Phase 21.1 — Pickup Geofence Engine
 *
 * Manages pickup stop geofence radius & custom polygon shapes,
 * evaluates real-time transitions (ENTRY / EXIT), calculates dwell time,
 * records audit logs in geofence_events, and publishes real-time updates.
 */
export class GeofenceService {
  /**
   * Evaluates all pickup stops along a trip's route for the given GPS telemetry fix.
   * Detects ENTRY (OUTSIDE -> INSIDE) and EXIT (INSIDE -> OUTSIDE) transitions.
   */
  static async evaluateTripStops(params: {
    tripId: string;
    schoolId: string;
    busId: string;
    latitude: number;
    longitude: number;
    recordedAt: Date;
  }): Promise<EvaluateTripGeofenceResult> {
    const { tripId, schoolId, busId, latitude, longitude, recordedAt } = params;
    const busCoords: GeoCoordinates = { latitude, longitude };
    const recordedAtIso = recordedAt.toISOString();

    // 1. Fetch all active stops for this trip's route
    const stopsSql = `
      SELECT 
        p.id,
        p.stop_name AS "stopName",
        p.sequence_order AS "sequenceOrder",
        p.latitude,
        p.longitude,
        COALESCE(p.geofence_type, 'RADIUS') AS "geofenceType",
        COALESCE(p.geofence_radius_meters, 300) AS "geofenceRadiusMeters",
        p.geofence_polygon AS "geofencePolygon"
      FROM trips t
      JOIN routes r ON t.route_id = r.id
      JOIN pickup_locations p ON p.route_id = r.id
      WHERE t.id = $1 AND p.deleted_at IS NULL
      ORDER BY p.sequence_order ASC;
    `;

    const stops = await query<RouteStopRow>(stopsSql, [tripId]);
    if (stops.length === 0) {
      return {
        tripId,
        busId,
        evaluatedStopsCount: 0,
        transitions: [],
        recordedAt: recordedAtIso,
      };
    }

    // 2. Fetch current geofence states for this trip
    const statesSql = `
      SELECT 
        stop_id AS "stopId",
        status,
        entered_at::text AS "enteredAt",
        exited_at::text AS "exitedAt",
        COALESCE(dwell_time_seconds, 0) AS "dwellTimeSeconds"
      FROM trip_stop_geofence_states
      WHERE trip_id = $1;
    `;
    const existingStates = await query<GeofenceStateRow>(statesSql, [tripId]);
    const stateMap = new Map<string, GeofenceStateRow>();
    for (const s of existingStates) {
      stateMap.set(s.stopId, s);
    }

    const transitions: GeofenceTransition[] = [];

    // 3. Evaluate each stop
    for (const stop of stops) {
      const { isInside, distanceMeters } = SpatialService.isPointInGeofenceShape(busCoords, {
        latitude: stop.latitude,
        longitude: stop.longitude,
        geofenceType: stop.geofenceType,
        geofenceRadiusMeters: stop.geofenceRadiusMeters,
        geofencePolygon: stop.geofencePolygon,
      });

      const currentStatus: 'INSIDE' | 'OUTSIDE' = isInside ? 'INSIDE' : 'OUTSIDE';
      const prevState = stateMap.get(stop.id);
      const previousStatus: 'INSIDE' | 'OUTSIDE' = prevState ? prevState.status : 'OUTSIDE';

      // ── Transition: ENTRY (OUTSIDE -> INSIDE) ──────────────────────────
      if (previousStatus !== 'INSIDE' && currentStatus === 'INSIDE') {
        const transition: GeofenceTransition = {
          stopId: stop.id,
          stopName: stop.stopName,
          sequenceOrder: stop.sequenceOrder,
          eventType: 'ENTRY',
          previousStatus,
          currentStatus,
          distanceToCenterMeters: distanceMeters,
          enteredAt: recordedAtIso,
          recordedAt: recordedAtIso,
        };
        transitions.push(transition);

        // Record in geofence_events ledger
        await query(
          `INSERT INTO geofence_events (
             school_id, trip_id, bus_id, stop_id, event_type,
             latitude, longitude, location, distance_to_center_meters, recorded_at
           ) VALUES (
             $1, $2, $3, $4, 'ENTRY',
             $5, $6, ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography, $7, $8
           );`,
          [schoolId, tripId, busId, stop.id, latitude, longitude, distanceMeters, recordedAtIso]
        );

        // Upsert state in trip_stop_geofence_states
        await query(
          `INSERT INTO trip_stop_geofence_states (
             trip_id, stop_id, status, entered_at, exited_at, dwell_time_seconds, last_evaluated_at, updated_at
           ) VALUES ($1, $2, 'INSIDE', $3, NULL, 0, $3, NOW())
           ON CONFLICT (trip_id, stop_id)
           DO UPDATE SET
             status = 'INSIDE',
             entered_at = EXCLUDED.entered_at,
             exited_at = NULL,
             dwell_time_seconds = 0,
             last_evaluated_at = EXCLUDED.last_evaluated_at,
             updated_at = NOW();`,
          [tripId, stop.id, recordedAtIso]
        );

        // Broadcast real-time feed event
        RealtimeFeedService.publish({
          type: 'GEOFENCE_EVENT',
          schoolId,
          tripId,
          busId,
          stopId: stop.id,
          stopName: stop.stopName,
          sequenceOrder: stop.sequenceOrder,
          eventType: 'ENTRY',
          status: 'INSIDE',
          distanceMeters,
          timestamp: recordedAtIso,
        });

        logger.info(`[GeofenceService] Bus entered geofence for stop "${stop.stopName}" (seq #${stop.sequenceOrder})`, {
          tripId,
          stopId: stop.id,
          distanceMeters,
        });
      }

      // ── Transition: EXIT (INSIDE -> OUTSIDE) ───────────────────────────
      else if (previousStatus === 'INSIDE' && currentStatus === 'OUTSIDE') {
        const enteredAt = prevState?.enteredAt ? new Date(prevState.enteredAt) : null;
        const dwellTimeSeconds = enteredAt
          ? Math.max(0, Math.round((recordedAt.getTime() - enteredAt.getTime()) / 1000))
          : 0;

        const transition: GeofenceTransition = {
          stopId: stop.id,
          stopName: stop.stopName,
          sequenceOrder: stop.sequenceOrder,
          eventType: 'EXIT',
          previousStatus,
          currentStatus,
          distanceToCenterMeters: distanceMeters,
          exitedAt: recordedAtIso,
          dwellTimeSeconds,
          recordedAt: recordedAtIso,
        };
        transitions.push(transition);

        // Record in geofence_events ledger
        await query(
          `INSERT INTO geofence_events (
             school_id, trip_id, bus_id, stop_id, event_type,
             latitude, longitude, location, distance_to_center_meters, dwell_time_seconds, recorded_at
           ) VALUES (
             $1, $2, $3, $4, 'EXIT',
             $5, $6, ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography, $7, $8, $9
           );`,
          [schoolId, tripId, busId, stop.id, latitude, longitude, distanceMeters, dwellTimeSeconds, recordedAtIso]
        );

        // Upsert state in trip_stop_geofence_states
        await query(
          `INSERT INTO trip_stop_geofence_states (
             trip_id, stop_id, status, entered_at, exited_at, dwell_time_seconds, last_evaluated_at, updated_at
           ) VALUES ($1, $2, 'OUTSIDE', NULL, $3, $4, $3, NOW())
           ON CONFLICT (trip_id, stop_id)
           DO UPDATE SET
             status = 'OUTSIDE',
             exited_at = EXCLUDED.exited_at,
             dwell_time_seconds = EXCLUDED.dwell_time_seconds,
             last_evaluated_at = EXCLUDED.last_evaluated_at,
             updated_at = NOW();`,
          [tripId, stop.id, recordedAtIso, dwellTimeSeconds]
        );

        // Broadcast real-time feed event
        RealtimeFeedService.publish({
          type: 'GEOFENCE_EVENT',
          schoolId,
          tripId,
          busId,
          stopId: stop.id,
          stopName: stop.stopName,
          sequenceOrder: stop.sequenceOrder,
          eventType: 'EXIT',
          status: 'OUTSIDE',
          dwellTimeSeconds,
          distanceMeters,
          timestamp: recordedAtIso,
        });

        logger.info(`[GeofenceService] Bus exited geofence for stop "${stop.stopName}" (dwell: ${dwellTimeSeconds}s)`, {
          tripId,
          stopId: stop.id,
          dwellTimeSeconds,
          distanceMeters,
        });
      }

      // ── Stationary / In-geofence heartbeat: update dwell time ──────────
      else if (previousStatus === 'INSIDE' && currentStatus === 'INSIDE') {
        const enteredAt = prevState?.enteredAt ? new Date(prevState.enteredAt) : null;
        const dwellTimeSeconds = enteredAt
          ? Math.max(0, Math.round((recordedAt.getTime() - enteredAt.getTime()) / 1000))
          : 0;

        await query(
          `UPDATE trip_stop_geofence_states
           SET dwell_time_seconds = $1,
               last_evaluated_at = $2,
               updated_at = NOW()
           WHERE trip_id = $3 AND stop_id = $4;`,
          [dwellTimeSeconds, recordedAtIso, tripId, stop.id]
        );
      }
    }

    return {
      tripId,
      busId,
      evaluatedStopsCount: stops.length,
      transitions,
      recordedAt: recordedAtIso,
    };
  }

  /**
   * Retrieves active geofence states for all stops in a trip.
   */
  static async getTripGeofenceStates(
    tripId: string,
    schoolId?: string
  ): Promise<TripStopGeofenceState[]> {
    if (schoolId) {
      const trip = await query<{ id: string; school_id: string }>(
        `SELECT id, school_id FROM trips WHERE id = $1 LIMIT 1;`,
        [tripId]
      );
      if (!trip[0]) {
        throw new NotFoundError(`Trip ${tripId} not found`);
      }
      if (trip[0].school_id !== schoolId) {
        throw new ForbiddenError('Cross-tenant trip geofence state access denied');
      }
    }

    const sql = `
      SELECT 
        s.id,
        $1::uuid AS "tripId",
        p.id AS "stopId",
        p.stop_name AS "stopName",
        p.sequence_order AS "sequenceOrder",
        COALESCE(s.status, 'OUTSIDE') AS "status",
        s.entered_at::text AS "enteredAt",
        s.exited_at::text AS "exitedAt",
        COALESCE(s.dwell_time_seconds, 0) AS "dwellTimeSeconds",
        COALESCE(s.last_evaluated_at, NOW())::text AS "lastEvaluatedAt"
      FROM trips t
      JOIN routes r ON t.route_id = r.id
      JOIN pickup_locations p ON p.route_id = r.id AND p.deleted_at IS NULL
      LEFT JOIN trip_stop_geofence_states s ON s.trip_id = t.id AND s.stop_id = p.id
      WHERE t.id = $1
      ORDER BY p.sequence_order ASC;
    `;

    return query<TripStopGeofenceState>(sql, [tripId]);
  }

  /**
   * Retrieves historical geofence entry/exit events for a trip.
   */
  static async getTripGeofenceEvents(
    tripId: string,
    schoolId?: string
  ): Promise<GeofenceEventRecord[]> {
    if (schoolId) {
      const trip = await query<{ id: string; school_id: string }>(
        `SELECT id, school_id FROM trips WHERE id = $1 LIMIT 1;`,
        [tripId]
      );
      if (!trip[0]) {
        throw new NotFoundError(`Trip ${tripId} not found`);
      }
      if (trip[0].school_id !== schoolId) {
        throw new ForbiddenError('Cross-tenant trip geofence events access denied');
      }
    }

    const sql = `
      SELECT 
        e.id,
        e.school_id AS "schoolId",
        e.trip_id AS "tripId",
        e.bus_id AS "busId",
        e.stop_id AS "stopId",
        p.stop_name AS "stopName",
        p.sequence_order AS "sequenceOrder",
        e.event_type AS "eventType",
        e.latitude,
        e.longitude,
        e.distance_to_center_meters AS "distanceToCenterMeters",
        e.dwell_time_seconds AS "dwellTimeSeconds",
        e.recorded_at::text AS "recordedAt",
        e.created_at::text AS "createdAt"
      FROM geofence_events e
      JOIN pickup_locations p ON e.stop_id = p.id
      WHERE e.trip_id = $1
      ORDER BY e.recorded_at ASC, e.created_at ASC;
    `;

    return query<GeofenceEventRecord>(sql, [tripId]);
  }

  /**
   * Retrieves the geofence configuration for a stop.
   */
  static async getStopGeofence(
    schoolId: string,
    routeId: string,
    stopId: string
  ): Promise<GeofenceShape> {
    const rows = await query<{
      geofenceType: 'RADIUS' | 'POLYGON';
      geofenceRadiusMeters: number;
      geofencePolygon: GeoCoordinates[] | null;
    }>(
      `SELECT 
         COALESCE(geofence_type, 'RADIUS') AS "geofenceType",
         COALESCE(geofence_radius_meters, 300) AS "geofenceRadiusMeters",
         geofence_polygon AS "geofencePolygon"
       FROM pickup_locations
       WHERE id = $1 AND route_id = $2 AND school_id = $3 AND deleted_at IS NULL
       LIMIT 1;`,
      [stopId, routeId, schoolId]
    );

    const stop = rows[0];
    if (!stop) {
      throw new NotFoundError(`Stop ${stopId} not found`);
    }

    return {
      geofenceType: stop.geofenceType,
      geofenceRadiusMeters: stop.geofenceRadiusMeters,
      geofencePolygon: stop.geofencePolygon,
    };
  }

  /**
   * Updates a stop's geofence configuration (radius or custom polygon shape).
   */
  static async updateStopGeofence(
    schoolId: string,
    routeId: string,
    stopId: string,
    payload: UpdateStopGeofenceRequest
  ): Promise<GeofenceShape> {
    const { geofenceType, geofenceRadiusMeters, geofencePolygon } = payload;

    // Validate polygon shape if POLYGON type requested
    let geometrySqlFragment = 'NULL';
    let params: unknown[] = [geofenceType, stopId, routeId, schoolId];

    if (geofenceType === 'POLYGON') {
      if (!geofencePolygon || geofencePolygon.length < 3) {
        throw new BadRequestError('Polygon geofence requires at least 3 vertices');
      }
      try {
        geometrySqlFragment = SpatialService.toGeographyPolygonSql(geofencePolygon);
      } catch (err) {
        throw new BadRequestError(`Invalid polygon coordinates: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const radius = geofenceRadiusMeters ?? 300;

    const sql = `
      UPDATE pickup_locations
      SET geofence_type = $1,
          geofence_radius_meters = $5,
          geofence_polygon = $6::jsonb,
          geofence_geometry = ${geometrySqlFragment},
          updated_at = NOW()
      WHERE id = $2 AND route_id = $3 AND school_id = $4 AND deleted_at IS NULL
      RETURNING 
        geofence_type AS "geofenceType",
        geofence_radius_meters AS "geofenceRadiusMeters",
        geofence_polygon AS "geofencePolygon";
    `;

    const updated = await query<{
      geofenceType: 'RADIUS' | 'POLYGON';
      geofenceRadiusMeters: number;
      geofencePolygon: GeoCoordinates[] | null;
    }>(sql, [
      geofenceType,
      stopId,
      routeId,
      schoolId,
      radius,
      geofencePolygon ? JSON.stringify(geofencePolygon) : null,
    ]);

    if (!updated[0]) {
      throw new NotFoundError(`Stop ${stopId} not found`);
    }

    logger.info(`[GeofenceService] Updated geofence for stop ${stopId} to type ${geofenceType}`, {
      schoolId,
      routeId,
      stopId,
      geofenceType,
      radius,
    });

    return {
      geofenceType: updated[0].geofenceType,
      geofenceRadiusMeters: updated[0].geofenceRadiusMeters,
      geofencePolygon: updated[0].geofencePolygon,
    };
  }
}
