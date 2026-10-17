import {
  CreateRouteRequest,
  RouteDetail,
  RouteType,
  RouteStopDetail,
  AddRouteStopRequest,
  ReorderRouteStopsRequest,
  UpdateRouteStopRequest,
} from '@school-bus/shared';
import { query } from '../config/database.js';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  BadRequestError,
} from '../middlewares/error.middleware.js';
import { logger } from './logger.service.js';

export class RouteService {
  /**
   * Micro-phase 15.1: Create Route with assigned bus and driver
   */
  public static async createRoute(
    schoolId: string,
    payload: CreateRouteRequest,
    actorSchoolId?: string
  ): Promise<RouteDetail> {
    // 1. Tenant validation
    if (actorSchoolId && actorSchoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant route creation attempt');
    }

    if (!schoolId) {
      throw new BadRequestError('schoolId is required to create a route');
    }

    // 2. Validate school existence
    const schoolRows = await query<{ id: string }>(
      `SELECT id FROM schools WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [schoolId]
    );
    if (schoolRows.length === 0) {
      throw new NotFoundError(`School ${schoolId} not found`);
    }

    const {
      name,
      code,
      routeType = RouteType.MORNING_PICKUP,
      defaultBusId = null,
      defaultDriverId = null,
      estimatedDurationMinutes = 45,
    } = payload;

    const normalizedCode = code.trim().toUpperCase();

    // 3. Verify unique route code within this school context
    const existingCodeRows = await query<{ id: string }>(
      `SELECT id FROM routes WHERE school_id = $1 AND code = $2 AND deleted_at IS NULL LIMIT 1`,
      [schoolId, normalizedCode]
    );
    if (existingCodeRows.length > 0) {
      throw new ConflictError(`Route code "${normalizedCode}" is already in use for this school`);
    }

    // 4. Verify assigned bus if provided
    let busNumber: string | null = null;
    let busRegistrationNumber: string | null = null;
    if (defaultBusId) {
      const busRows = await query<{ id: string; bus_number: string; registration_number: string }>(
        `SELECT id, bus_number, registration_number
         FROM buses
         WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
         LIMIT 1`,
        [defaultBusId, schoolId]
      );
      if (busRows.length === 0 || !busRows[0]) {
        throw new NotFoundError(`Bus ${defaultBusId} not found in this school context`);
      }
      busNumber = busRows[0].bus_number;
      busRegistrationNumber = busRows[0].registration_number;
    }

    // 5. Verify assigned driver if provided
    let driverName: string | null = null;
    let driverPhone: string | null = null;
    if (defaultDriverId) {
      const driverRows = await query<{ id: string; full_name: string; phone: string }>(
        `SELECT id, full_name, phone
         FROM drivers
         WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
         LIMIT 1`,
        [defaultDriverId, schoolId]
      );
      if (driverRows.length === 0 || !driverRows[0]) {
        throw new NotFoundError(`Driver ${defaultDriverId} not found in this school context`);
      }
      driverName = driverRows[0].full_name;
      driverPhone = driverRows[0].phone;
    }

    // 6. Insert new route
    const insertResult = await query<{
      id: string;
      school_id: string;
      name: string;
      code: string;
      route_type: RouteType;
      default_bus_id: string | null;
      default_driver_id: string | null;
      path_polyline: string | null;
      estimated_duration_minutes: number;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO routes (
         school_id, name, code, route_type, default_bus_id, default_driver_id, estimated_duration_minutes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, school_id, name, code, route_type, default_bus_id, default_driver_id,
                 path_polyline, estimated_duration_minutes, created_at, updated_at`,
      [
        schoolId,
        name.trim(),
        normalizedCode,
        routeType,
        defaultBusId || null,
        defaultDriverId || null,
        estimatedDurationMinutes,
      ]
    );

    const r = insertResult[0]!;
    logger.info(`[RouteService] Created route ${r.id} (${r.code}) for school ${schoolId}`);

    return {
      id: r.id,
      schoolId: r.school_id,
      name: r.name,
      code: r.code,
      routeType: r.route_type,
      defaultBusId: r.default_bus_id,
      defaultDriverId: r.default_driver_id,
      busNumber,
      busRegistrationNumber,
      driverName,
      driverPhone,
      pathPolyline: r.path_polyline,
      estimatedDurationMinutes: Number(r.estimated_duration_minutes),
      stopsCount: 0,
      studentsCount: 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  /**
   * Retrieves single route details with assigned bus, driver, and aggregate metrics
   */
  public static async getRouteById(
    schoolId: string,
    routeId: string,
    actorSchoolId?: string
  ): Promise<RouteDetail> {
    if (actorSchoolId && actorSchoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant route access attempt');
    }

    const rows = await query<{
      id: string;
      school_id: string;
      name: string;
      code: string;
      route_type: RouteType;
      default_bus_id: string | null;
      default_driver_id: string | null;
      bus_number: string | null;
      registration_number: string | null;
      driver_name: string | null;
      driver_phone: string | null;
      path_polyline: string | null;
      estimated_duration_minutes: number;
      stops_count: number;
      students_count: number;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT r.id, r.school_id, r.name, r.code, r.route_type,
              r.default_bus_id, r.default_driver_id,
              b.bus_number, b.registration_number,
              d.full_name AS driver_name, d.phone AS driver_phone,
              r.path_polyline, r.estimated_duration_minutes,
              (SELECT COUNT(*)::int FROM pickup_locations pl WHERE pl.route_id = r.id AND pl.deleted_at IS NULL) AS stops_count,
              (SELECT COUNT(DISTINCT ssa.student_id)::int FROM student_stop_assignments ssa
               JOIN pickup_locations pl ON ssa.pickup_stop_id = pl.id
               WHERE pl.route_id = r.id AND ssa.deleted_at IS NULL AND pl.deleted_at IS NULL) AS students_count,
              r.created_at, r.updated_at
       FROM routes r
       LEFT JOIN buses b ON r.default_bus_id = b.id AND b.deleted_at IS NULL
       LEFT JOIN drivers d ON r.default_driver_id = d.id AND d.deleted_at IS NULL
       WHERE r.id = $1 AND r.school_id = $2 AND r.deleted_at IS NULL
       LIMIT 1`,
      [routeId, schoolId]
    );

    if (rows.length === 0 || !rows[0]) {
      throw new NotFoundError(`Route ${routeId} not found in this school context`);
    }

    const r = rows[0];
    return {
      id: r.id,
      schoolId: r.school_id,
      name: r.name,
      code: r.code,
      routeType: r.route_type,
      defaultBusId: r.default_bus_id,
      defaultDriverId: r.default_driver_id,
      busNumber: r.bus_number,
      busRegistrationNumber: r.registration_number,
      driverName: r.driver_name,
      driverPhone: r.driver_phone,
      pathPolyline: r.path_polyline,
      estimatedDurationMinutes: Number(r.estimated_duration_minutes),
      stopsCount: Number(r.stops_count),
      studentsCount: Number(r.students_count),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  /**
   * Retrieves all routes for a school with bus, driver, and counts
   */
  public static async listRoutes(
    schoolId: string,
    actorSchoolId?: string
  ): Promise<RouteDetail[]> {
    if (actorSchoolId && actorSchoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant route access attempt');
    }

    const rows = await query<{
      id: string;
      school_id: string;
      name: string;
      code: string;
      route_type: RouteType;
      default_bus_id: string | null;
      default_driver_id: string | null;
      bus_number: string | null;
      registration_number: string | null;
      driver_name: string | null;
      driver_phone: string | null;
      path_polyline: string | null;
      estimated_duration_minutes: number;
      stops_count: number;
      students_count: number;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT r.id, r.school_id, r.name, r.code, r.route_type,
              r.default_bus_id, r.default_driver_id,
              b.bus_number, b.registration_number,
              d.full_name AS driver_name, d.phone AS driver_phone,
              r.path_polyline, r.estimated_duration_minutes,
              (SELECT COUNT(*)::int FROM pickup_locations pl WHERE pl.route_id = r.id AND pl.deleted_at IS NULL) AS stops_count,
              (SELECT COUNT(DISTINCT ssa.student_id)::int FROM student_stop_assignments ssa
               JOIN pickup_locations pl ON ssa.pickup_stop_id = pl.id
               WHERE pl.route_id = r.id AND ssa.deleted_at IS NULL AND pl.deleted_at IS NULL) AS students_count,
              r.created_at, r.updated_at
       FROM routes r
       LEFT JOIN buses b ON r.default_bus_id = b.id AND b.deleted_at IS NULL
       LEFT JOIN drivers d ON r.default_driver_id = d.id AND d.deleted_at IS NULL
       WHERE r.school_id = $1 AND r.deleted_at IS NULL
       ORDER BY r.name ASC`,
      [schoolId]
    );

    return rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      name: r.name,
      code: r.code,
      routeType: r.route_type,
      defaultBusId: r.default_bus_id,
      defaultDriverId: r.default_driver_id,
      busNumber: r.bus_number,
      busRegistrationNumber: r.registration_number,
      driverName: r.driver_name,
      driverPhone: r.driver_phone,
      pathPolyline: r.path_polyline,
      estimatedDurationMinutes: Number(r.estimated_duration_minutes),
      stopsCount: Number(r.stops_count),
      studentsCount: Number(r.students_count),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Micro-phase 15.2: List all active pickup stops for a route ordered by sequence_order ASC
   */
  public static async listRouteStops(
    schoolId: string,
    routeId: string,
    actorSchoolId?: string
  ): Promise<RouteStopDetail[]> {
    if (actorSchoolId && actorSchoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant route stops access attempt');
    }

    // Verify route exists
    const routeRows = await query<{ id: string }>(
      `SELECT id FROM routes WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [routeId, schoolId]
    );
    if (routeRows.length === 0 || !routeRows[0]) {
      throw new NotFoundError(`Route ${routeId} not found in this school context`);
    }

    const rows = await query<{
      id: string;
      school_id: string;
      route_id: string;
      stop_name: string;
      sequence_order: number;
      latitude: number;
      longitude: number;
      scheduled_time: string;
      geofence_radius_meters: number;
      assigned_students_count: number;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT pl.id, pl.school_id, pl.route_id, pl.stop_name, pl.sequence_order,
              pl.latitude, pl.longitude, pl.scheduled_time::text AS scheduled_time,
              pl.geofence_radius_meters,
              (SELECT COUNT(DISTINCT ssa.student_id)::int
               FROM student_stop_assignments ssa
               WHERE (ssa.pickup_stop_id = pl.id OR ssa.drop_stop_id = pl.id)
                 AND ssa.school_id = pl.school_id
                 AND ssa.deleted_at IS NULL) AS assigned_students_count,
              pl.created_at, pl.updated_at
       FROM pickup_locations pl
       WHERE pl.route_id = $1 AND pl.school_id = $2 AND pl.deleted_at IS NULL
       ORDER BY pl.sequence_order ASC`,
      [routeId, schoolId]
    );

    return rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      routeId: r.route_id,
      stopName: r.stop_name,
      sequenceOrder: Number(r.sequence_order),
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      scheduledTime: r.scheduled_time,
      geofenceRadiusMeters: Number(r.geofence_radius_meters),
      assignedStudentsCount: Number(r.assigned_students_count),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Micro-phase 15.2: Add a new pickup stop to a route with automatic or custom sequence ordering
   */
  public static async addRouteStop(
    schoolId: string,
    routeId: string,
    payload: AddRouteStopRequest,
    actorSchoolId?: string
  ): Promise<RouteStopDetail> {
    if (actorSchoolId && actorSchoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant stop creation attempt');
    }

    // Verify route exists
    const routeRows = await query<{ id: string }>(
      `SELECT id FROM routes WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [routeId, schoolId]
    );
    if (routeRows.length === 0 || !routeRows[0]) {
      throw new NotFoundError(`Route ${routeId} not found in this school context`);
    }

    const {
      stopName,
      latitude,
      longitude,
      scheduledTime,
      geofenceRadiusMeters = 300,
      sequenceOrder,
    } = payload;

    let targetSequence: number;

    if (sequenceOrder !== undefined && sequenceOrder !== null) {
      targetSequence = sequenceOrder;
      // Shift existing stops with sequence_order >= targetSequence by +1
      // Step 1: Temporary offset to avoid uq_route_sequence conflicts
      await query(
        `UPDATE pickup_locations
         SET sequence_order = sequence_order + 50000
         WHERE route_id = $1 AND school_id = $2 AND sequence_order >= $3 AND deleted_at IS NULL`,
        [routeId, schoolId, targetSequence]
      );
      // Step 2: Final shifted position
      await query(
        `UPDATE pickup_locations
         SET sequence_order = (sequence_order - 50000) + 1
         WHERE route_id = $1 AND school_id = $2 AND sequence_order >= 50000 AND deleted_at IS NULL`,
        [routeId, schoolId]
      );
    } else {
      const maxRows = await query<{ next_order: number }>(
        `SELECT COALESCE(MAX(sequence_order), 0) + 1 AS next_order
         FROM pickup_locations
         WHERE route_id = $1 AND school_id = $2 AND deleted_at IS NULL AND sequence_order > 0`,
        [routeId, schoolId]
      );
      targetSequence = Number(maxRows[0]?.next_order || 1);
    }

    const insertedRows = await query<{
      id: string;
      school_id: string;
      route_id: string;
      stop_name: string;
      sequence_order: number;
      latitude: number;
      longitude: number;
      scheduled_time: string;
      geofence_radius_meters: number;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO pickup_locations (
         school_id, route_id, stop_name, sequence_order,
         latitude, longitude, location, scheduled_time, geofence_radius_meters
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography, $7::time, $8
       )
       RETURNING id, school_id, route_id, stop_name, sequence_order,
                 latitude, longitude, scheduled_time::text AS scheduled_time,
                 geofence_radius_meters, created_at, updated_at`,
      [
        schoolId,
        routeId,
        stopName.trim(),
        targetSequence,
        latitude,
        longitude,
        scheduledTime,
        geofenceRadiusMeters,
      ]
    );

    const r = insertedRows[0]!;
    logger.info(`[RouteService] Added stop ${r.id} (${r.stop_name}) at sequence ${r.sequence_order} on route ${routeId}`);

    return {
      id: r.id,
      schoolId: r.school_id,
      routeId: r.route_id,
      stopName: r.stop_name,
      sequenceOrder: Number(r.sequence_order),
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      scheduledTime: r.scheduled_time,
      geofenceRadiusMeters: Number(r.geofence_radius_meters),
      assignedStudentsCount: 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  /**
   * Micro-phase 15.2: Reorder pickup sequence for a route safely
   */
  public static async reorderRouteStops(
    schoolId: string,
    routeId: string,
    stopIds: string[],
    actorSchoolId?: string
  ): Promise<RouteStopDetail[]> {
    if (actorSchoolId && actorSchoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant stop reordering attempt');
    }

    // Verify route exists
    const routeRows = await query<{ id: string }>(
      `SELECT id FROM routes WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [routeId, schoolId]
    );
    if (routeRows.length === 0 || !routeRows[0]) {
      throw new NotFoundError(`Route ${routeId} not found in this school context`);
    }

    // Fetch active stops for this route
    const activeStops = await query<{ id: string }>(
      `SELECT id FROM pickup_locations WHERE route_id = $1 AND school_id = $2 AND deleted_at IS NULL ORDER BY sequence_order ASC`,
      [routeId, schoolId]
    );

    const activeSet = new Set(activeStops.map((s) => s.id));
    if (stopIds.length !== activeStops.length || !stopIds.every((id) => activeSet.has(id))) {
      throw new BadRequestError('Provided stopIds must match exactly all active stops for this route');
    }

    // Step 1: Temporarily shift active stops to offset +50000 to avoid uq_route_sequence collisions
    await query(
      `UPDATE pickup_locations
       SET sequence_order = sequence_order + 50000
       WHERE route_id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [routeId, schoolId]
    );

    // Step 2: Assign new 1-based consecutive sequence orders
    for (let i = 0; i < stopIds.length; i++) {
      const stopId = stopIds[i]!;
      const newOrder = i + 1;
      await query(
        `UPDATE pickup_locations
         SET sequence_order = $1, updated_at = NOW()
         WHERE id = $2 AND route_id = $3 AND school_id = $4`,
        [newOrder, stopId, routeId, schoolId]
      );
    }

    logger.info(`[RouteService] Reordered ${stopIds.length} stops on route ${routeId}`);
    return this.listRouteStops(schoolId, routeId, actorSchoolId);
  }

  /**
   * Micro-phase 15.2: Update an individual stop's sequence, name, coordinates, or timing
   */
  public static async updateRouteStop(
    schoolId: string,
    routeId: string,
    stopId: string,
    payload: UpdateRouteStopRequest,
    actorSchoolId?: string
  ): Promise<RouteStopDetail> {
    if (actorSchoolId && actorSchoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant stop update attempt');
    }

    // Check stop exists
    const stopRows = await query<{
      id: string;
      sequence_order: number;
    }>(
      `SELECT id, sequence_order
       FROM pickup_locations
       WHERE id = $1 AND route_id = $2 AND school_id = $3 AND deleted_at IS NULL
       LIMIT 1`,
      [stopId, routeId, schoolId]
    );
    if (stopRows.length === 0 || !stopRows[0]) {
      throw new NotFoundError(`Stop ${stopId} not found on route ${routeId}`);
    }

    // If sequenceOrder is specified and different from current
    if (
      payload.sequenceOrder !== undefined &&
      payload.sequenceOrder !== null &&
      payload.sequenceOrder !== Number(stopRows[0].sequence_order)
    ) {
      // Get all active stops in order
      const allActive = await query<{ id: string }>(
        `SELECT id FROM pickup_locations
         WHERE route_id = $1 AND school_id = $2 AND deleted_at IS NULL
         ORDER BY sequence_order ASC`,
        [routeId, schoolId]
      );
      const stopList = allActive.map((s) => s.id).filter((id) => id !== stopId);
      const targetIndex = Math.max(0, Math.min(stopList.length, payload.sequenceOrder - 1));
      stopList.splice(targetIndex, 0, stopId);

      // Reorder using safe helper
      await this.reorderRouteStops(schoolId, routeId, stopList, actorSchoolId);
    }

    // Update non-sequence fields if provided
    const hasDetailUpdates =
      payload.stopName !== undefined ||
      payload.latitude !== undefined ||
      payload.longitude !== undefined ||
      payload.scheduledTime !== undefined ||
      payload.geofenceRadiusMeters !== undefined;

    if (hasDetailUpdates) {
      await query(
        `UPDATE pickup_locations
         SET stop_name = COALESCE($1, stop_name),
             latitude = COALESCE($2, latitude),
             longitude = COALESCE($3, longitude),
             location = CASE WHEN $2::float8 IS NOT NULL AND $3::float8 IS NOT NULL THEN ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography ELSE location END,
             scheduled_time = CASE WHEN $4::text IS NOT NULL THEN $4::time ELSE scheduled_time END,
             geofence_radius_meters = COALESCE($5, geofence_radius_meters),
             updated_at = NOW()
         WHERE id = $6 AND route_id = $7 AND school_id = $8 AND deleted_at IS NULL`,
        [
          payload.stopName ? payload.stopName.trim() : null,
          payload.latitude !== undefined ? payload.latitude : null,
          payload.longitude !== undefined ? payload.longitude : null,
          payload.scheduledTime || null,
          payload.geofenceRadiusMeters !== undefined ? payload.geofenceRadiusMeters : null,
          stopId,
          routeId,
          schoolId,
        ]
      );
    }

    const stops = await this.listRouteStops(schoolId, routeId, actorSchoolId);
    const updated = stops.find((s) => s.id === stopId);
    if (!updated) {
      throw new NotFoundError(`Stop ${stopId} not found after update`);
    }
    return updated;
  }

  /**
   * Micro-phase 15.2: Remove / soft-delete a pickup stop and resequence remaining stops
   */
  public static async removeRouteStop(
    schoolId: string,
    routeId: string,
    stopId: string,
    actorSchoolId?: string
  ): Promise<{ success: boolean; removedStopId: string; remainingStopsCount: number }> {
    if (actorSchoolId && actorSchoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant stop removal attempt');
    }

    // Verify stop exists
    const stopRows = await query<{
      id: string;
      sequence_order: number;
    }>(
      `SELECT id, sequence_order
       FROM pickup_locations
       WHERE id = $1 AND route_id = $2 AND school_id = $3 AND deleted_at IS NULL
       LIMIT 1`,
      [stopId, routeId, schoolId]
    );
    if (stopRows.length === 0 || !stopRows[0]) {
      throw new NotFoundError(`Stop ${stopId} not found on route ${routeId}`);
    }

    // Find next available negative sequence order to avoid uq_route_sequence collision
    const negRows = await query<{ next_neg: number }>(
      `SELECT COALESCE(MAX(ABS(sequence_order)), 10000) + 1 AS next_neg
       FROM pickup_locations
       WHERE route_id = $1 AND sequence_order < 0`,
      [routeId]
    );
    const nextNeg = Number(negRows[0]?.next_neg || 10001);

    // Soft delete the stop
    await query(
      `UPDATE pickup_locations
       SET deleted_at = NOW(), sequence_order = -1 * $1
       WHERE id = $2 AND route_id = $3 AND school_id = $4`,
      [nextNeg, stopId, routeId, schoolId]
    );

    // Resequence remaining active stops
    const remainingStops = await query<{ id: string }>(
      `SELECT id FROM pickup_locations
       WHERE route_id = $1 AND school_id = $2 AND deleted_at IS NULL
       ORDER BY sequence_order ASC`,
      [routeId, schoolId]
    );

    if (remainingStops.length > 0) {
      // Step 1: offset remaining active stops
      await query(
        `UPDATE pickup_locations
         SET sequence_order = sequence_order + 50000
         WHERE route_id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [routeId, schoolId]
      );

      // Step 2: assign consecutive 1..N
      for (let i = 0; i < remainingStops.length; i++) {
        const remainingId = remainingStops[i]!.id;
        const newOrder = i + 1;
        await query(
          `UPDATE pickup_locations
           SET sequence_order = $1, updated_at = NOW()
           WHERE id = $2 AND route_id = $3 AND school_id = $4`,
          [newOrder, remainingId, routeId, schoolId]
        );
      }
    }

    logger.info(`[RouteService] Removed stop ${stopId} from route ${routeId}; ${remainingStops.length} stops remaining`);

    return {
      success: true,
      removedStopId: stopId,
      remainingStopsCount: remainingStops.length,
    };
  }
}

