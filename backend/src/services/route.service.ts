import {
  CreateRouteRequest,
  RouteDetail,
  RouteType,
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
}
