import {
  CreateRouteRequest,
  UpdateRouteRequest,
  RouteDetail,
  RouteType,
  RouteStopDetail,
  AddRouteStopRequest,
  ReorderRouteStopsRequest,
  UpdateRouteStopRequest,
  RouteHistoryItem,
  RouteHistoryResponse,
} from '@school-bus/shared';
import { query } from '../config/database.js';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  BadRequestError,
} from '../middlewares/error.middleware.js';
import { logger } from './logger.service.js';
import { SpatialService } from './spatial.service.js';

export class RouteService {
  /**
   * Helper: Records an operational or lifecycle change to audit_logs
   */
  private static async recordRouteAudit(params: {
    schoolId: string;
    routeId: string;
    action: string;
    userId?: string | null;
    userRole?: string;
    changeSummary: string;
    previousState?: Record<string, any> | null;
    newState?: Record<string, any> | null;
  }): Promise<void> {
    try {
      const {
        schoolId,
        routeId,
        action,
        userId = null,
        userRole = 'SCHOOL_ADMIN',
        changeSummary,
        previousState = null,
        newState = null,
      } = params;

      const diffJson = {
        changeSummary,
        previousState,
        newState,
      };

      await query(
        `INSERT INTO audit_logs (
           school_id, user_id, user_role, action, entity_type, entity_id, diff_json
         ) VALUES ($1, $2, $3, $4, 'ROUTE', $5, $6)`,
        [
          schoolId,
          userId,
          userRole,
          action,
          routeId,
          JSON.stringify(diffJson),
        ]
      );
    } catch (err: any) {
      logger.warn(`[RouteService] Failed to record route audit log: ${err.message}`);
    }
  }

  /**
   * Micro-phase 15.1: Create Route with assigned bus and driver
   */
  public static async createRoute(
    schoolId: string,
    payload: CreateRouteRequest,
    actorSchoolId?: string,
    actorUserId?: string,
    actorUserRole?: string
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

    // Record audit log
    await this.recordRouteAudit({
      schoolId,
      routeId: r.id,
      action: 'ROUTE_CREATED',
      userId: actorUserId,
      userRole: actorUserRole,
      changeSummary: `Route "${r.name}" (${r.code}) created`,
      previousState: null,
      newState: {
        name: r.name,
        code: r.code,
        routeType: r.route_type,
        defaultBusId: r.default_bus_id,
        defaultDriverId: r.default_driver_id,
        estimatedDurationMinutes: Number(r.estimated_duration_minutes),
      },
    });

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
   * Micro-phase 15.4: Update Route Specifications with change tracking
   */
  public static async updateRoute(
    schoolId: string,
    routeId: string,
    payload: UpdateRouteRequest,
    actorSchoolId?: string,
    actorUserId?: string,
    actorUserRole?: string
  ): Promise<RouteDetail> {
    if (actorSchoolId && actorSchoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant route update attempt');
    }

    // 1. Fetch current route state
    const currentRows = await query<{
      id: string;
      name: string;
      code: string;
      route_type: RouteType;
      default_bus_id: string | null;
      default_driver_id: string | null;
      estimated_duration_minutes: number;
    }>(
      `SELECT id, name, code, route_type, default_bus_id, default_driver_id, estimated_duration_minutes
       FROM routes
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [routeId, schoolId]
    );

    if (currentRows.length === 0 || !currentRows[0]) {
      throw new NotFoundError(`Route ${routeId} not found in this school context`);
    }

    const current = currentRows[0];
    const previousState = {
      name: current.name,
      code: current.code,
      routeType: current.route_type,
      defaultBusId: current.default_bus_id,
      defaultDriverId: current.default_driver_id,
      estimatedDurationMinutes: Number(current.estimated_duration_minutes),
    };

    // 2. Validate route code uniqueness if changed
    let normalizedCode: string | null = null;
    if (payload.code && payload.code.trim().toUpperCase() !== current.code) {
      normalizedCode = payload.code.trim().toUpperCase();
      const duplicateRows = await query<{ id: string }>(
        `SELECT id FROM routes
         WHERE school_id = $1 AND code = $2 AND id != $3 AND deleted_at IS NULL
         LIMIT 1`,
        [schoolId, normalizedCode, routeId]
      );
      if (duplicateRows.length > 0) {
        throw new ConflictError(`Route code "${normalizedCode}" is already in use by another route`);
      }
    }

    // 3. Validate bus if specified
    const updateBus = payload.defaultBusId !== undefined;
    if (updateBus && payload.defaultBusId) {
      const busCheck = await query<{ id: string }>(
        `SELECT id FROM buses WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [payload.defaultBusId, schoolId]
      );
      if (busCheck.length === 0) {
        throw new NotFoundError(`Bus ${payload.defaultBusId} not found in this school context`);
      }
    }

    // 4. Validate driver if specified
    const updateDriver = payload.defaultDriverId !== undefined;
    if (updateDriver && payload.defaultDriverId) {
      const driverCheck = await query<{ id: string }>(
        `SELECT id FROM drivers WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [payload.defaultDriverId, schoolId]
      );
      if (driverCheck.length === 0) {
        throw new NotFoundError(`Driver ${payload.defaultDriverId} not found in this school context`);
      }
    }

    // 5. Update database record
    await query(
      `UPDATE routes
       SET name = COALESCE($1, name),
           code = COALESCE($2, code),
           route_type = COALESCE($3, route_type),
           default_bus_id = CASE WHEN $4::boolean = TRUE THEN $5::uuid ELSE default_bus_id END,
           default_driver_id = CASE WHEN $6::boolean = TRUE THEN $7::uuid ELSE default_driver_id END,
           estimated_duration_minutes = COALESCE($8, estimated_duration_minutes),
           updated_at = NOW()
       WHERE id = $9 AND school_id = $10 AND deleted_at IS NULL`,
      [
        payload.name ? payload.name.trim() : null,
        normalizedCode,
        payload.routeType || null,
        updateBus,
        updateBus ? payload.defaultBusId : null,
        updateDriver,
        updateDriver ? payload.defaultDriverId : null,
        payload.estimatedDurationMinutes || null,
        routeId,
        schoolId,
      ]
    );

    const updated = await this.getRouteById(schoolId, routeId, actorSchoolId);

    const newState = {
      name: updated.name,
      code: updated.code,
      routeType: updated.routeType,
      defaultBusId: updated.defaultBusId,
      defaultDriverId: updated.defaultDriverId,
      estimatedDurationMinutes: updated.estimatedDurationMinutes,
    };

    // 6. Record audit log with previous and new states
    await this.recordRouteAudit({
      schoolId,
      routeId,
      action: 'ROUTE_UPDATED',
      userId: actorUserId,
      userRole: actorUserRole,
      changeSummary: `Route specifications updated for "${updated.name}" (${updated.code})`,
      previousState,
      newState,
    });

    return updated;
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
      geofence_type: 'RADIUS' | 'POLYGON';
      geofence_polygon: any;
      assigned_students_count: number;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT pl.id, pl.school_id, pl.route_id, pl.stop_name, pl.sequence_order,
              pl.latitude, pl.longitude, pl.scheduled_time::text AS scheduled_time,
              pl.geofence_radius_meters,
              COALESCE(pl.geofence_type, 'RADIUS') AS geofence_type,
              pl.geofence_polygon,
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
      geofenceType: (r.geofence_type as 'RADIUS' | 'POLYGON') || 'RADIUS',
      geofencePolygon: r.geofence_polygon ?? null,
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
    actorSchoolId?: string,
    actorUserId?: string,
    actorUserRole?: string
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
      geofenceType = 'RADIUS',
      geofencePolygon = null,
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

    let geomSql = 'NULL';
    if (geofenceType === 'POLYGON' && geofencePolygon && geofencePolygon.length >= 3) {
      geomSql = SpatialService.toGeographyPolygonSql(geofencePolygon);
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
      geofence_type: 'RADIUS' | 'POLYGON';
      geofence_polygon: any;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO pickup_locations (
         school_id, route_id, stop_name, sequence_order,
         latitude, longitude, location, scheduled_time, geofence_radius_meters,
         geofence_type, geofence_polygon, geofence_geometry
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography, $7::time, $8,
         $9, $10::jsonb, ${geomSql}
       )
       RETURNING id, school_id, route_id, stop_name, sequence_order,
                 latitude, longitude, scheduled_time::text AS scheduled_time,
                 geofence_radius_meters, COALESCE(geofence_type, 'RADIUS') AS geofence_type,
                 geofence_polygon, created_at, updated_at`,
      [
        schoolId,
        routeId,
        stopName.trim(),
        targetSequence,
        latitude,
        longitude,
        scheduledTime,
        geofenceRadiusMeters,
        geofenceType,
        geofencePolygon ? JSON.stringify(geofencePolygon) : null,
      ]
    );

    const r = insertedRows[0]!;
    logger.info(`[RouteService] Added stop ${r.id} (${r.stop_name}) at sequence ${r.sequence_order} on route ${routeId}`);

    // Record audit log
    await this.recordRouteAudit({
      schoolId,
      routeId,
      action: 'ROUTE_STOP_ADDED',
      userId: actorUserId,
      userRole: actorUserRole,
      changeSummary: `Added stop "${r.stop_name}" at sequence #${r.sequence_order}`,
      previousState: null,
      newState: {
        stopId: r.id,
        stopName: r.stop_name,
        sequenceOrder: Number(r.sequence_order),
        latitude: Number(r.latitude),
        longitude: Number(r.longitude),
        scheduledTime: r.scheduled_time,
        geofenceRadiusMeters: Number(r.geofence_radius_meters),
        geofenceType: (r.geofence_type as 'RADIUS' | 'POLYGON') || 'RADIUS',
        geofencePolygon: r.geofence_polygon ?? null,
      },
    });

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
      geofenceType: (r.geofence_type as 'RADIUS' | 'POLYGON') || 'RADIUS',
      geofencePolygon: r.geofence_polygon ?? null,
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
    actorSchoolId?: string,
    actorUserId?: string,
    actorUserRole?: string
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
    const activeStops = await query<{ id: string; stop_name: string; sequence_order: number }>(
      `SELECT id, stop_name, sequence_order FROM pickup_locations WHERE route_id = $1 AND school_id = $2 AND deleted_at IS NULL ORDER BY sequence_order ASC`,
      [routeId, schoolId]
    );

    const activeSet = new Set(activeStops.map((s) => s.id));
    if (stopIds.length !== activeStops.length || !stopIds.every((id) => activeSet.has(id))) {
      throw new BadRequestError('Provided stopIds must match exactly all active stops for this route');
    }

    const previousOrder = activeStops.map((s) => ({
      id: s.id,
      stopName: s.stop_name,
      sequenceOrder: Number(s.sequence_order),
    }));

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

    const result = await this.listRouteStops(schoolId, routeId, actorSchoolId);

    // Record audit log
    await this.recordRouteAudit({
      schoolId,
      routeId,
      action: 'ROUTE_STOPS_REORDERED',
      userId: actorUserId,
      userRole: actorUserRole,
      changeSummary: `Reordered ${stopIds.length} stops on route`,
      previousState: { stopOrder: previousOrder },
      newState: {
        stopOrder: stopIds.map((id, idx) => ({ id, sequenceOrder: idx + 1 })),
      },
    });

    return result;
  }

  /**
   * Micro-phase 15.2: Update an individual stop's sequence, name, coordinates, or timing
   */
  public static async updateRouteStop(
    schoolId: string,
    routeId: string,
    stopId: string,
    payload: UpdateRouteStopRequest,
    actorSchoolId?: string,
    actorUserId?: string,
    actorUserRole?: string
  ): Promise<RouteStopDetail> {
    if (actorSchoolId && actorSchoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant stop update attempt');
    }

    // Check stop exists
    const stopRows = await query<{
      id: string;
      stop_name: string;
      sequence_order: number;
      latitude: number;
      longitude: number;
      scheduled_time: string;
      geofence_radius_meters: number;
    }>(
      `SELECT id, stop_name, sequence_order, latitude, longitude,
              scheduled_time::text AS scheduled_time, geofence_radius_meters
       FROM pickup_locations
       WHERE id = $1 AND route_id = $2 AND school_id = $3 AND deleted_at IS NULL
       LIMIT 1`,
      [stopId, routeId, schoolId]
    );
    if (stopRows.length === 0 || !stopRows[0]) {
      throw new NotFoundError(`Stop ${stopId} not found on route ${routeId}`);
    }

    const currentStop = stopRows[0];
    const previousState = {
      stopId: currentStop.id,
      stopName: currentStop.stop_name,
      sequenceOrder: Number(currentStop.sequence_order),
      latitude: Number(currentStop.latitude),
      longitude: Number(currentStop.longitude),
      scheduledTime: currentStop.scheduled_time,
      geofenceRadiusMeters: Number(currentStop.geofence_radius_meters),
    };

    // If sequenceOrder is specified and different from current
    if (
      payload.sequenceOrder !== undefined &&
      payload.sequenceOrder !== null &&
      payload.sequenceOrder !== Number(currentStop.sequence_order)
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
      await this.reorderRouteStops(schoolId, routeId, stopList, actorSchoolId, actorUserId, actorUserRole);
    }

    // Update non-sequence fields if provided
    const hasDetailUpdates =
      payload.stopName !== undefined ||
      payload.latitude !== undefined ||
      payload.longitude !== undefined ||
      payload.scheduledTime !== undefined ||
      payload.geofenceRadiusMeters !== undefined ||
      payload.geofenceType !== undefined ||
      payload.geofencePolygon !== undefined;

    if (hasDetailUpdates) {
      let geomSqlClause = 'geofence_geometry';
      if (payload.geofenceType === 'POLYGON' && payload.geofencePolygon && payload.geofencePolygon.length >= 3) {
        geomSqlClause = SpatialService.toGeographyPolygonSql(payload.geofencePolygon);
      } else if (payload.geofenceType === 'RADIUS') {
        geomSqlClause = 'NULL';
      }

      await query(
        `UPDATE pickup_locations
         SET stop_name = COALESCE($1, stop_name),
             latitude = COALESCE($2, latitude),
             longitude = COALESCE($3, longitude),
             location = CASE WHEN $2::float8 IS NOT NULL AND $3::float8 IS NOT NULL THEN ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography ELSE location END,
             scheduled_time = CASE WHEN $4::text IS NOT NULL THEN $4::time ELSE scheduled_time END,
             geofence_radius_meters = COALESCE($5, geofence_radius_meters),
             geofence_type = COALESCE($6, geofence_type),
             geofence_polygon = CASE WHEN $7::text IS NOT NULL THEN $7::jsonb ELSE geofence_polygon END,
             geofence_geometry = ${geomSqlClause},
             updated_at = NOW()
         WHERE id = $8 AND route_id = $9 AND school_id = $10 AND deleted_at IS NULL`,
        [
          payload.stopName ? payload.stopName.trim() : null,
          payload.latitude !== undefined ? payload.latitude : null,
          payload.longitude !== undefined ? payload.longitude : null,
          payload.scheduledTime || null,
          payload.geofenceRadiusMeters !== undefined ? payload.geofenceRadiusMeters : null,
          payload.geofenceType || null,
          payload.geofencePolygon !== undefined ? (payload.geofencePolygon ? JSON.stringify(payload.geofencePolygon) : 'null') : null,
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

    const newState = {
      stopId: updated.id,
      stopName: updated.stopName,
      sequenceOrder: updated.sequenceOrder,
      latitude: updated.latitude,
      longitude: updated.longitude,
      scheduledTime: updated.scheduledTime,
      geofenceRadiusMeters: updated.geofenceRadiusMeters,
    };

    // Record audit log
    await this.recordRouteAudit({
      schoolId,
      routeId,
      action: 'ROUTE_STOP_UPDATED',
      userId: actorUserId,
      userRole: actorUserRole,
      changeSummary: `Updated stop "${updated.stopName}" (seq #${updated.sequenceOrder})`,
      previousState,
      newState,
    });

    return updated;
  }

  /**
   * Micro-phase 15.2: Remove / soft-delete a pickup stop and resequence remaining stops
   */
  public static async removeRouteStop(
    schoolId: string,
    routeId: string,
    stopId: string,
    actorSchoolId?: string,
    actorUserId?: string,
    actorUserRole?: string
  ): Promise<{ success: boolean; removedStopId: string; remainingStopsCount: number }> {
    if (actorSchoolId && actorSchoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant stop removal attempt');
    }

    // Verify stop exists
    const stopRows = await query<{
      id: string;
      stop_name: string;
      sequence_order: number;
      latitude: number;
      longitude: number;
      scheduled_time: string;
      geofence_radius_meters: number;
    }>(
      `SELECT id, stop_name, sequence_order, latitude, longitude,
              scheduled_time::text AS scheduled_time, geofence_radius_meters
       FROM pickup_locations
       WHERE id = $1 AND route_id = $2 AND school_id = $3 AND deleted_at IS NULL
       LIMIT 1`,
      [stopId, routeId, schoolId]
    );
    if (stopRows.length === 0 || !stopRows[0]) {
      throw new NotFoundError(`Stop ${stopId} not found on route ${routeId}`);
    }

    const currentStop = stopRows[0];
    const previousState = {
      stopId: currentStop.id,
      stopName: currentStop.stop_name,
      sequenceOrder: Number(currentStop.sequence_order),
      latitude: Number(currentStop.latitude),
      longitude: Number(currentStop.longitude),
      scheduledTime: currentStop.scheduled_time,
      geofenceRadiusMeters: Number(currentStop.geofence_radius_meters),
    };

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

    // Record audit log
    await this.recordRouteAudit({
      schoolId,
      routeId,
      action: 'ROUTE_STOP_REMOVED',
      userId: actorUserId,
      userRole: actorUserRole,
      changeSummary: `Removed stop "${currentStop.stop_name}" (was seq #${currentStop.sequence_order})`,
      previousState,
      newState: null,
    });

    return {
      success: true,
      removedStopId: stopId,
      remainingStopsCount: remainingStops.length,
    };
  }

  /**
   * Micro-phase 15.4: Get route change history / audit trail
   */
  public static async getRouteHistory(
    schoolId: string,
    routeId: string,
    actorSchoolId?: string
  ): Promise<RouteHistoryResponse> {
    if (actorSchoolId && actorSchoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant route history access attempt');
    }

    const route = await this.getRouteById(schoolId, routeId, actorSchoolId);

    const rows = await query<{
      id: string;
      school_id: string;
      user_id: string | null;
      user_role: string;
      action: string;
      entity_type: string;
      entity_id: string;
      diff_json: any;
      created_at: string;
      user_name: string | null;
      user_email: string | null;
    }>(
      `SELECT al.id, al.school_id, al.user_id, al.user_role, al.action,
              al.entity_type, al.entity_id, al.diff_json, al.created_at,
              adm.full_name AS user_name, adm.email AS user_email
       FROM audit_logs al
       LEFT JOIN admins adm ON al.user_id = adm.id
       WHERE al.school_id = $1 AND al.entity_type = 'ROUTE' AND al.entity_id = $2
       ORDER BY al.created_at DESC`,
      [schoolId, routeId]
    );

    const history: RouteHistoryItem[] = rows.map((r) => {
      let parsedDiff: any = {};
      if (typeof r.diff_json === 'string') {
        try {
          parsedDiff = JSON.parse(r.diff_json);
        } catch {
          parsedDiff = {};
        }
      } else if (r.diff_json && typeof r.diff_json === 'object') {
        parsedDiff = r.diff_json;
      }

      return {
        id: r.id,
        schoolId: r.school_id,
        routeId: r.entity_id,
        action: r.action,
        userId: r.user_id,
        userName: r.user_name || undefined,
        userRole: r.user_role,
        changeSummary: parsedDiff.changeSummary || r.action,
        previousState: parsedDiff.previousState ?? null,
        newState: parsedDiff.newState ?? null,
        createdAt: r.created_at,
      };
    });

    return {
      route,
      history,
      totalChanges: history.length,
    };
  }
}

