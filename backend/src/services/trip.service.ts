import {
  TripStatus,
  TripLifecycleStage,
  CreateTripRequest,
  CreateTodayTripRequest,
  GenerateDailyTripsRequest,
  GenerateDailyTripsResponse,
  TripDetailResponse,
  StartTripRequest,
  EndTripRequest,
  TripSummaryResponse,
  UpdateTripProgressRequest,
  GpsHealthStatus,
} from '@school-bus/shared';
import { query } from '../config/database.js';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../middlewares/error.middleware.js';
import { logger } from './logger.service.js';
import { RealtimeFeedService } from './realtime-feed.service.js';

export interface TripActorContext {
  schoolId?: string;
  userId?: string;
  userRole?: string;
  isDriver?: boolean;
  idempotencyKey?: string;
}

export class TripService {
  /**
   * Helper: Records an operational trip change to audit_logs
   */
  private static async recordTripAudit(params: {
    schoolId: string;
    tripId: string;
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
        tripId,
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
         ) VALUES ($1, $2, $3, $4, 'TRIP', $5, $6)`,
        [
          schoolId,
          userId,
          userRole,
          action,
          tripId,
          JSON.stringify(diffJson),
        ]
      );
    } catch (err: any) {
      logger.warn(`[TripService] Failed to record trip audit log: ${err.message}`);
    }
  }

  /**
   * Helper: Resolves computed TripLifecycleStage from state and timestamps
   */
  public static computeLifecycleStage(row: {
    status: TripStatus | string;
    actualStartTime?: string | Date | null;
    actualEndTime?: string | Date | null;
    currentStopSequence?: number;
    isArrivedSchool?: boolean;
  }): TripLifecycleStage {
    if (row.status === TripStatus.COMPLETED) {
      return TripLifecycleStage.COMPLETED;
    }
    if (row.status === TripStatus.ARRIVED_SCHOOL || row.isArrivedSchool) {
      return TripLifecycleStage.ARRIVED_SCHOOL;
    }
    if (row.actualStartTime && (row.status === TripStatus.IN_TRANSIT || row.status === TripStatus.DELAYED)) {
      if ((row.currentStopSequence ?? 0) > 0) {
        return TripLifecycleStage.IN_TRANSIT;
      }
      return TripLifecycleStage.STARTED;
    }
    return TripLifecycleStage.NOT_STARTED;
  }

  /**
   * Micro-phase 16.1 & 16.2: Create / Schedule a new Trip
   * Attaches route, bus, and driver with validation and conflict checks
   */
  public static async createTrip(
    schoolId: string,
    payload: CreateTripRequest,
    actor?: TripActorContext
  ): Promise<TripDetailResponse> {
    if (actor?.schoolId && actor.schoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant trip creation attempt');
    }

    // 1. Verify school exists
    const schoolRows = await query<{ id: string }>(
      `SELECT id FROM schools WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [schoolId]
    );
    if (schoolRows.length === 0) {
      throw new NotFoundError(`School ${schoolId} not found`);
    }

    const { routeId, busId, driverId, scheduledDate, scheduledStartTime } = payload;

    // 2. Attach Route: Verify route belongs to this school
    const routeRows = await query<{
      id: string;
      name: string;
      code: string;
      default_bus_id: string | null;
      default_driver_id: string | null;
    }>(
      `SELECT id, name, code, default_bus_id, default_driver_id
       FROM routes
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [routeId, schoolId]
    );
    if (routeRows.length === 0 || !routeRows[0]) {
      throw new NotFoundError(`Route ${routeId} not found for this school`);
    }

    const route = routeRows[0];

    // 3. Attach Bus: Use explicit busId or fallback to route's default_bus_id
    const effectiveBusId = busId || route.default_bus_id;
    if (!effectiveBusId) {
      throw new BadRequestError('Bus is required. Please specify busId or attach a default bus to route');
    }

    const busRows = await query<{ id: string; bus_number: string; registration_number: string }>(
      `SELECT id, bus_number, registration_number
       FROM buses
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [effectiveBusId, schoolId]
    );
    if (busRows.length === 0 || !busRows[0]) {
      throw new NotFoundError(`Bus ${effectiveBusId} not found for this school`);
    }

    // 4. Attach Driver: Use explicit driverId or fallback to route's default_driver_id
    const effectiveDriverId = driverId || route.default_driver_id;
    if (!effectiveDriverId) {
      throw new BadRequestError('Driver is required. Please specify driverId or attach a default driver to route');
    }

    const driverRows = await query<{ id: string; full_name: string; phone: string }>(
      `SELECT id, full_name, phone
       FROM drivers
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [effectiveDriverId, schoolId]
    );
    if (driverRows.length === 0 || !driverRows[0]) {
      throw new NotFoundError(`Driver ${effectiveDriverId} not found for this school`);
    }

    // 5. Conflict Validation: Verify bus is not currently in transit on another active trip
    const activeBusTrip = await query<{ id: string }>(
      `SELECT id FROM trips
       WHERE bus_id = $1 AND school_id = $2 AND status = 'IN_TRANSIT' AND deleted_at IS NULL
       LIMIT 1`,
      [effectiveBusId, schoolId]
    );
    if (activeBusTrip.length > 0) {
      throw new ConflictError('Bus is currently in transit on another active trip');
    }

    // 6. Conflict Validation: Verify driver is not currently in transit on another active trip
    const activeDriverTrip = await query<{ id: string }>(
      `SELECT id FROM trips
       WHERE driver_id = $1 AND school_id = $2 AND status = 'IN_TRANSIT' AND deleted_at IS NULL
       LIMIT 1`,
      [effectiveDriverId, schoolId]
    );
    if (activeDriverTrip.length > 0) {
      throw new ConflictError('Driver is currently in transit on another active trip');
    }

    // 7. Resolve Scheduled Date & Start Time
    const todayDate = scheduledDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const rawTime = scheduledStartTime || '07:30';
    const effectiveStartTime = rawTime.includes('T') ? rawTime : `${todayDate}T${rawTime.padStart(5, '0')}:00Z`;

    // 8. Conflict Validation: Prevent duplicate scheduled trip on same route, date, and start time
    const duplicateTrip = await query<{ id: string }>(
      `SELECT id FROM trips
       WHERE school_id = $1 AND route_id = $2 AND scheduled_date = $3::date AND scheduled_start_time = $4::timestamptz AND status != 'CANCELLED' AND deleted_at IS NULL
       LIMIT 1`,
      [schoolId, routeId, todayDate, effectiveStartTime]
    );
    if (duplicateTrip.length > 0) {
      throw new ConflictError('A trip is already scheduled for this route, date, and start time');
    }

    // 9. Insert scheduled trip
    const insertResult = await query<{
      id: string;
      school_id: string;
      route_id: string;
      bus_id: string;
      driver_id: string;
      status: TripStatus;
      scheduled_date: string;
      scheduled_start_time: string;
      actual_start_time: string | null;
      actual_end_time: string | null;
      current_stop_sequence: number;
      delay_minutes: number;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO trips (
         school_id, route_id, bus_id, driver_id, status, scheduled_date, scheduled_start_time
       ) VALUES ($1, $2, $3, $4, 'SCHEDULED', $5::date, $6::timestamptz)
       RETURNING id, school_id, route_id, bus_id, driver_id, status,
                 scheduled_date::text AS scheduled_date,
                 scheduled_start_time::text AS scheduled_start_time,
                 actual_start_time::text AS actual_start_time,
                 actual_end_time::text AS actual_end_time,
                 current_stop_sequence, delay_minutes, created_at, updated_at`,
      [schoolId, routeId, effectiveBusId, effectiveDriverId, todayDate, effectiveStartTime]
    );

    const r = insertResult[0]!;
    logger.info(`[TripService] Scheduled trip ${r.id} for route ${routeId} on ${todayDate}`);

    // 10. Record audit log
    await this.recordTripAudit({
      schoolId,
      tripId: r.id,
      action: 'TRIP_CREATED',
      userId: actor?.userId,
      userRole: actor?.userRole,
      changeSummary: `Trip scheduled for route ${route.name} (${route.code}) on ${todayDate}`,
      previousState: null,
      newState: {
        status: r.status,
        routeId: r.route_id,
        busId: r.bus_id,
        driverId: r.driver_id,
        scheduledDate: r.scheduled_date,
        scheduledStartTime: r.scheduled_start_time,
        stage: TripLifecycleStage.NOT_STARTED,
      },
    });

    return this.getTripById(schoolId, r.id, actor);
  }

  /**
   * Micro-phase 16.2: Create Today's Trip
   * Concurrently attaches route, bus, and driver defaulting to today's Indian local date
   */
  public static async createTodayTrip(
    schoolId: string,
    payload: CreateTodayTripRequest,
    actor?: TripActorContext
  ): Promise<TripDetailResponse> {
    const todayDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    return this.createTrip(
      schoolId,
      {
        ...payload,
        scheduledDate: todayDate,
      },
      actor
    );
  }

  /**
   * Micro-phase 16.2: Generate Daily Trips
   * Automatically instantiates today's trips for all active routes with attached bus & driver
   */
  public static async generateDailyTrips(
    schoolId: string,
    payload?: GenerateDailyTripsRequest,
    actor?: TripActorContext
  ): Promise<GenerateDailyTripsResponse> {
    if (actor?.schoolId && actor.schoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant daily trips generation attempt');
    }

    const targetDate = payload?.scheduledDate || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

    // 1. Fetch active routes that have both default bus and driver attached
    const routes = await query<{
      id: string;
      name: string;
      code: string;
      default_bus_id: string;
      default_driver_id: string;
    }>(
      `SELECT id, name, code, default_bus_id, default_driver_id
       FROM routes
       WHERE school_id = $1 AND default_bus_id IS NOT NULL AND default_driver_id IS NOT NULL AND deleted_at IS NULL
       ORDER BY code ASC`,
      [schoolId]
    );

    const createdTrips: TripDetailResponse[] = [];
    let skippedCount = 0;

    for (const route of routes) {
      // Check if a trip is already scheduled for this route today
      const existing = await query<{ id: string }>(
        `SELECT id FROM trips
         WHERE school_id = $1 AND route_id = $2 AND scheduled_date = $3::date AND status != 'CANCELLED' AND deleted_at IS NULL
         LIMIT 1`,
        [schoolId, route.id, targetDate]
      );

      if (existing.length > 0) {
        skippedCount++;
        continue;
      }

      try {
        const trip = await this.createTrip(
          schoolId,
          {
            routeId: route.id,
            busId: route.default_bus_id,
            driverId: route.default_driver_id,
            scheduledDate: targetDate,
            scheduledStartTime: '07:30',
          },
          actor
        );
        createdTrips.push(trip);
      } catch (err: any) {
        logger.warn(`[TripService] Failed to generate daily trip for route ${route.code}: ${err.message}`);
        skippedCount++;
      }
    }

    logger.info(`[TripService] Generated ${createdTrips.length} daily trips for school ${schoolId} on ${targetDate} (${skippedCount} skipped)`);

    return {
      scheduledCount: createdTrips.length,
      skippedCount,
      createdTrips,
    };
  }

  /**
   * Micro-phase 16.1: Retrieves trip details with assigned entities and lifecycle state
   */
  public static async getTripById(
    schoolId: string,
    tripId: string,
    actor?: TripActorContext
  ): Promise<TripDetailResponse> {
    if (actor?.schoolId && actor.schoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant trip access attempt');
    }

    const rows = await query<{
      id: string;
      school_id: string;
      route_id: string;
      bus_id: string;
      driver_id: string;
      status: TripStatus;
      scheduled_date: string;
      scheduled_start_time: string;
      actual_start_time: string | null;
      actual_end_time: string | null;
      current_stop_sequence: number;
      delay_minutes: number;
      created_at: string;
      updated_at: string;
      route_name: string | null;
      route_code: string | null;
      bus_number: string | null;
      registration_number: string | null;
      driver_name: string | null;
      driver_phone: string | null;
      total_stops: number;
      is_arrived_school: boolean;
      arrived_school_time: string | null;
    }>(
      `SELECT t.id, t.school_id, t.route_id, t.bus_id, t.driver_id, t.status,
              t.scheduled_date::text AS scheduled_date,
              t.scheduled_start_time::text AS scheduled_start_time,
              t.actual_start_time::text AS actual_start_time,
              t.actual_end_time::text AS actual_end_time,
              t.current_stop_sequence, t.delay_minutes, t.created_at, t.updated_at,
              r.name AS route_name, r.code AS route_code,
              b.bus_number, b.registration_number,
              d.full_name AS driver_name, d.phone AS driver_phone,
              (SELECT COUNT(*)::int FROM pickup_locations pl WHERE pl.route_id = t.route_id AND pl.deleted_at IS NULL) AS total_stops,
              EXISTS(
                SELECT 1 FROM audit_logs al
                WHERE al.school_id = t.school_id AND al.entity_type = 'TRIP' AND al.entity_id = t.id AND al.action = 'TRIP_ARRIVED_SCHOOL'
              ) AS is_arrived_school,
              (
                SELECT al.created_at::text FROM audit_logs al
                WHERE al.school_id = t.school_id AND al.entity_type = 'TRIP' AND al.entity_id = t.id AND al.action = 'TRIP_ARRIVED_SCHOOL'
                ORDER BY al.created_at DESC LIMIT 1
              ) AS arrived_school_time
       FROM trips t
       LEFT JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
       LEFT JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
       LEFT JOIN drivers d ON t.driver_id = d.id AND d.deleted_at IS NULL
       WHERE t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
       LIMIT 1`,
      [tripId, schoolId]
    );

    if (rows.length === 0 || !rows[0]) {
      throw new NotFoundError(`Trip ${tripId} not found for this school`);
    }

    const r = rows[0];

    const lifecycleStage = this.computeLifecycleStage({
      status: r.status,
      actualStartTime: r.actual_start_time,
      actualEndTime: r.actual_end_time,
      currentStopSequence: Number(r.current_stop_sequence),
      isArrivedSchool: Boolean(r.is_arrived_school),
    });

    return {
      id: r.id,
      schoolId: r.school_id,
      routeId: r.route_id,
      routeName: r.route_name || undefined,
      routeCode: r.route_code || undefined,
      busId: r.bus_id,
      busNumber: r.bus_number || undefined,
      busRegistrationNumber: r.registration_number || undefined,
      driverId: r.driver_id,
      driverName: r.driver_name || undefined,
      driverPhone: r.driver_phone || undefined,
      status: r.status,
      lifecycleStage,
      scheduledDate: r.scheduled_date,
      scheduledStartTime: r.scheduled_start_time,
      actualStartTime: r.actual_start_time || null,
      actualEndTime: r.actual_end_time || null,
      arrivedSchoolTime: r.arrived_school_time || null,
      currentStopSequence: Number(r.current_stop_sequence),
      delayMinutes: Number(r.delay_minutes),
      totalStops: Number(r.total_stops),
      trackingSessionActive: r.status === TripStatus.IN_TRANSIT,
      attendanceLocked: r.status === TripStatus.COMPLETED,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  /**
   * Micro-phase 16.1: List trips for school with filters
   */
  public static async listTrips(
    schoolId: string,
    filters?: {
      date?: string;
      routeId?: string;
      busId?: string;
      driverId?: string;
      status?: TripStatus;
    },
    actor?: TripActorContext
  ): Promise<TripDetailResponse[]> {
    if (actor?.schoolId && actor.schoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant trip access attempt');
    }

    const rows = await query<{
      id: string;
      school_id: string;
      route_id: string;
      bus_id: string;
      driver_id: string;
      status: TripStatus;
      scheduled_date: string;
      scheduled_start_time: string;
      actual_start_time: string | null;
      actual_end_time: string | null;
      current_stop_sequence: number;
      delay_minutes: number;
      created_at: string;
      updated_at: string;
      route_name: string | null;
      route_code: string | null;
      bus_number: string | null;
      registration_number: string | null;
      driver_name: string | null;
      driver_phone: string | null;
      total_stops: number;
      is_arrived_school: boolean;
      arrived_school_time: string | null;
    }>(
      `SELECT t.id, t.school_id, t.route_id, t.bus_id, t.driver_id, t.status,
              t.scheduled_date::text AS scheduled_date,
              t.scheduled_start_time::text AS scheduled_start_time,
              t.actual_start_time::text AS actual_start_time,
              t.actual_end_time::text AS actual_end_time,
              t.current_stop_sequence, t.delay_minutes, t.created_at, t.updated_at,
              r.name AS route_name, r.code AS route_code,
              b.bus_number, b.registration_number,
              d.full_name AS driver_name, d.phone AS driver_phone,
              (SELECT COUNT(*)::int FROM pickup_locations pl WHERE pl.route_id = t.route_id AND pl.deleted_at IS NULL) AS total_stops,
              EXISTS(
                SELECT 1 FROM audit_logs al
                WHERE al.school_id = t.school_id AND al.entity_type = 'TRIP' AND al.entity_id = t.id AND al.action = 'TRIP_ARRIVED_SCHOOL'
              ) AS is_arrived_school,
              (
                SELECT al.created_at::text FROM audit_logs al
                WHERE al.school_id = t.school_id AND al.entity_type = 'TRIP' AND al.entity_id = t.id AND al.action = 'TRIP_ARRIVED_SCHOOL'
                ORDER BY al.created_at DESC LIMIT 1
              ) AS arrived_school_time
       FROM trips t
       LEFT JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
       LEFT JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
       LEFT JOIN drivers d ON t.driver_id = d.id AND d.deleted_at IS NULL
       WHERE t.school_id = $1
         AND ($2::date IS NULL OR t.scheduled_date = $2::date)
         AND ($3::uuid IS NULL OR t.route_id = $3::uuid)
         AND ($4::uuid IS NULL OR t.bus_id = $4::uuid)
         AND ($5::uuid IS NULL OR t.driver_id = $5::uuid)
         AND ($6::varchar IS NULL OR t.status = $6::varchar)
         AND t.deleted_at IS NULL
       ORDER BY t.scheduled_date DESC, t.scheduled_start_time ASC`,
      [
        schoolId,
        filters?.date || null,
        filters?.routeId || null,
        filters?.busId || null,
        filters?.driverId || null,
        filters?.status || null,
      ]
    );

    return rows.map((r) => ({
      id: r.id,
      schoolId: r.school_id,
      routeId: r.route_id,
      routeName: r.route_name || undefined,
      routeCode: r.route_code || undefined,
      busId: r.bus_id,
      busNumber: r.bus_number || undefined,
      busRegistrationNumber: r.registration_number || undefined,
      driverId: r.driver_id,
      driverName: r.driver_name || undefined,
      driverPhone: r.driver_phone || undefined,
      status: r.status,
      lifecycleStage: this.computeLifecycleStage({
        status: r.status,
        actualStartTime: r.actual_start_time,
        actualEndTime: r.actual_end_time,
        currentStopSequence: Number(r.current_stop_sequence),
        isArrivedSchool: Boolean(r.is_arrived_school),
      }),
      scheduledDate: r.scheduled_date,
      scheduledStartTime: r.scheduled_start_time,
      actualStartTime: r.actual_start_time || null,
      actualEndTime: r.actual_end_time || null,
      arrivedSchoolTime: r.arrived_school_time || null,
      currentStopSequence: Number(r.current_stop_sequence),
      delayMinutes: Number(r.delay_minutes),
      totalStops: Number(r.total_stops),
      trackingSessionActive: r.status === TripStatus.IN_TRANSIT,
      attendanceLocked: r.status === TripStatus.COMPLETED,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Micro-phase 16.3: Trip Start (Start timestamp, Activate tracking session, Update dashboard)
   * Transitions from NOT_STARTED to STARTED / IN_TRANSIT, activates parent tracking tokens,
   * and publishes real-time telemetry event.
   */
  public static async startTrip(
    schoolId: string,
    tripId: string,
    actor?: TripActorContext,
    payload?: StartTripRequest
  ): Promise<TripDetailResponse> {
    if (actor?.schoolId && actor.schoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant trip start attempt');
    }

    // 1. Fetch current trip state and attached bus location cache
    const currentRows = await query<{
      id: string;
      route_id: string;
      bus_id: string;
      driver_id: string;
      status: TripStatus;
      actual_start_time: string | null;
      actual_end_time: string | null;
      last_latitude: number | null;
      last_longitude: number | null;
      last_speed_kmh: number | null;
      last_bearing_degrees: number | null;
      gps_health_status: string | null;
    }>(
      `SELECT t.id, t.route_id, t.bus_id, t.driver_id, t.status, t.actual_start_time, t.actual_end_time,
              b.last_latitude, b.last_longitude, b.last_speed_kmh, b.last_bearing_degrees, b.gps_health_status
       FROM trips t
       LEFT JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
       WHERE t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
       LIMIT 1`,
      [tripId, schoolId]
    );

    if (currentRows.length === 0 || !currentRows[0]) {
      throw new NotFoundError(`Trip ${tripId} not found in this school context`);
    }

    const current = currentRows[0];

    // 2. Driver role validation: driver can only start their assigned trip
    if (actor?.isDriver && actor.userId && current.driver_id !== actor.userId) {
      throw new ForbiddenError('You are not authorized to start a trip assigned to another driver');
    }

    // 3. State Machine Validation & Idempotency:
    // If the trip is already started / in-transit, return active trip idempotently without re-triggering side effects
    if (current.status === TripStatus.IN_TRANSIT || current.status === TripStatus.DELAYED) {
      const keySuffix = actor?.idempotencyKey ? ` [Key: ${actor.idempotencyKey}]` : '';
      logger.info(
        `[TripService] Idempotent retry detected for startTrip: Trip ${tripId} is already in transit${keySuffix}`
      );
      const trip = await this.getTripById(schoolId, tripId, actor);
      return {
        ...trip,
        trackingSessionActive: true,
      };
    }
    if (current.status === TripStatus.COMPLETED) {
      throw new BadRequestError('Cannot start a trip that is already completed');
    }
    if (current.status === TripStatus.CANCELLED) {
      throw new BadRequestError('Cannot start a trip that has been cancelled');
    }

    // 4. Update status to IN_TRANSIT and set actual_start_time (client payload or NOW())
    const explicitStartTime = payload?.startedAt || null;
    await query(
      `UPDATE trips
       SET status = 'IN_TRANSIT',
           actual_start_time = COALESCE($3::timestamptz, actual_start_time, NOW()),
           current_stop_sequence = 0,
           updated_at = NOW()
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [tripId, schoolId, explicitStartTime]
    );

    // 5. Activate tracking session:
    // Connect and activate parent tracking tokens for all students on the trip's route
    const activatedTokens = await query<{ id: string }>(
      `UPDATE parent_tracking_tokens
       SET trip_id = $1,
           updated_at = NOW()
       WHERE student_id IN (
         SELECT ssa.student_id
         FROM student_stop_assignments ssa
         JOIN pickup_locations pl ON (ssa.pickup_stop_id = pl.id OR ssa.drop_stop_id = pl.id)
         WHERE pl.route_id = $2
           AND ssa.deleted_at IS NULL
           AND pl.deleted_at IS NULL
       )
       AND school_id = $3
       AND revoked_at IS NULL
       AND expires_at > NOW()
       AND deleted_at IS NULL
       RETURNING id`,
      [tripId, current.route_id, schoolId]
    );

    const activatedTokensCount = activatedTokens.length;
    logger.info(
      `[TripService] Trip ${tripId} STARTED by ${actor?.userId || 'admin'}. Activated ${activatedTokensCount} parent tracking tokens.`
    );

    // 6. Broadcast real-time feed event to update dashboard and parent live tracking
    const effectiveStartTime = explicitStartTime || new Date().toISOString();
    const effectiveHealthStatus: GpsHealthStatus =
      (current.gps_health_status as GpsHealthStatus) || 'HEALTHY';
    RealtimeFeedService.publish({
      type: 'INITIAL_STATE',
      schoolId,
      busId: current.bus_id,
      tripId,
      latitude: current.last_latitude != null ? Number(current.last_latitude) : 0,
      longitude: current.last_longitude != null ? Number(current.last_longitude) : 0,
      speedKmh: current.last_speed_kmh != null ? Number(current.last_speed_kmh) : 0,
      bearingDegrees: current.last_bearing_degrees != null ? Number(current.last_bearing_degrees) : 0,
      accuracyMeters: null,
      batteryPercentage: null,
      isCharging: null,
      networkType: null,
      healthStatus: effectiveHealthStatus,
      recordedAt: effectiveStartTime,
      timestamp: new Date().toISOString(),
    });

    // 7. Audit log
    await this.recordTripAudit({
      schoolId,
      tripId,
      action: 'TRIP_STARTED',
      userId: actor?.userId,
      userRole: actor?.userRole || (actor?.isDriver ? 'DRIVER' : 'SCHOOL_ADMIN'),
      changeSummary: `Trip departed / started (${activatedTokensCount} tracking tokens activated)`,
      previousState: {
        status: current.status,
        stage: TripLifecycleStage.NOT_STARTED,
      },
      newState: {
        status: TripStatus.IN_TRANSIT,
        stage: TripLifecycleStage.STARTED,
        actualStartTime: effectiveStartTime,
        activatedTokensCount,
        trackingSessionActive: true,
      },
    });

    const trip = await this.getTripById(schoolId, tripId, actor);
    return {
      ...trip,
      trackingSessionActive: true,
      activatedTrackingTokens: activatedTokensCount,
    };
  }

  /**
   * Micro-phase 16.1: Update trip stop progress (Lifecycle: IN_TRANSIT progression)
   */
  public static async updateTripProgress(
    schoolId: string,
    tripId: string,
    payload: UpdateTripProgressRequest,
    actor?: TripActorContext
  ): Promise<TripDetailResponse> {
    if (actor?.schoolId && actor.schoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant trip update attempt');
    }

    const currentRows = await query<{
      id: string;
      driver_id: string;
      status: TripStatus;
      current_stop_sequence: number;
      delay_minutes: number;
    }>(
      `SELECT id, driver_id, status, current_stop_sequence, delay_minutes
       FROM trips
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [tripId, schoolId]
    );

    if (currentRows.length === 0 || !currentRows[0]) {
      throw new NotFoundError(`Trip ${tripId} not found in this school context`);
    }

    const current = currentRows[0];

    // Driver verification
    if (actor?.isDriver && actor.userId && current.driver_id !== actor.userId) {
      throw new ForbiddenError('You are not authorized to update progress for another driver\'s trip');
    }

    // State machine: must be active (IN_TRANSIT or DELAYED)
    if (current.status !== TripStatus.IN_TRANSIT && current.status !== TripStatus.DELAYED) {
      throw new BadRequestError(`Cannot update progress for trip in ${current.status} state`);
    }

    const nextDelay = payload.delayMinutes !== undefined ? payload.delayMinutes : current.delay_minutes;

    // Idempotency: If stop sequence and delay match current state, return existing trip without duplicate updates
    if (
      Number(current.current_stop_sequence) === payload.currentStopSequence &&
      Number(current.delay_minutes) === nextDelay
    ) {
      logger.info(
        `[TripService] Idempotent retry detected for updateTripProgress: Trip ${tripId} stop sequence #${payload.currentStopSequence} already recorded`
      );
      return this.getTripById(schoolId, tripId, actor);
    }

    await query(
      `UPDATE trips
       SET current_stop_sequence = $1,
           delay_minutes = $2,
           status = CASE WHEN $2 > 10 THEN 'DELAYED' ELSE 'IN_TRANSIT' END,
           updated_at = NOW()
       WHERE id = $3 AND school_id = $4 AND deleted_at IS NULL`,
      [payload.currentStopSequence, nextDelay, tripId, schoolId]
    );

    // Audit log
    await this.recordTripAudit({
      schoolId,
      tripId,
      action: 'TRIP_PROGRESS_UPDATED',
      userId: actor?.userId,
      userRole: actor?.userRole || (actor?.isDriver ? 'DRIVER' : 'SCHOOL_ADMIN'),
      changeSummary: `Progress updated: stop sequence #${payload.currentStopSequence}`,
      previousState: {
        currentStopSequence: current.current_stop_sequence,
        delayMinutes: current.delay_minutes,
      },
      newState: {
        currentStopSequence: payload.currentStopSequence,
        delayMinutes: nextDelay,
        stage: TripLifecycleStage.IN_TRANSIT,
      },
    });

    return this.getTripById(schoolId, tripId, actor);
  }

  /**
   * Micro-phase 16.1: Mark arrival at destination school (Lifecycle: ARRIVED_SCHOOL)
   */
  public static async arriveAtSchool(
    schoolId: string,
    tripId: string,
    actor?: TripActorContext
  ): Promise<TripDetailResponse> {
    if (actor?.schoolId && actor.schoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant trip arrival attempt');
    }

    const currentRows = await query<{
      id: string;
      driver_id: string;
      status: TripStatus;
      current_stop_sequence: number;
    }>(
      `SELECT id, driver_id, status, current_stop_sequence
       FROM trips
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [tripId, schoolId]
    );

    if (currentRows.length === 0 || !currentRows[0]) {
      throw new NotFoundError(`Trip ${tripId} not found in this school context`);
    }

    const current = currentRows[0];

    // Driver verification
    if (actor?.isDriver && actor.userId && current.driver_id !== actor.userId) {
      throw new ForbiddenError('You are not authorized to mark arrival for another driver\'s trip');
    }

    // State machine: must be active
    if (current.status !== TripStatus.IN_TRANSIT && current.status !== TripStatus.DELAYED) {
      if (current.status === TripStatus.ARRIVED_SCHOOL) {
        logger.info(
          `[TripService] Idempotent retry detected for arriveAtSchool: Trip ${tripId} already in ARRIVED_SCHOOL state`
        );
        return this.getTripById(schoolId, tripId, actor);
      }
      throw new BadRequestError(`Cannot mark arrival for trip in ${current.status} state`);
    }

    // Idempotency: Check if arrival was already recorded
    const existingArrival = await query<{ id: string }>(
      `SELECT id FROM audit_logs
       WHERE school_id = $1 AND entity_type = 'TRIP' AND entity_id = $2 AND action = 'TRIP_ARRIVED_SCHOOL'
       LIMIT 1`,
      [schoolId, tripId]
    );
    if (existingArrival.length > 0) {
      logger.info(
        `[TripService] Idempotent retry detected for arriveAtSchool: Trip ${tripId} already marked arrived at school`
      );
      return this.getTripById(schoolId, tripId, actor);
    }

    logger.info(`[TripService] Trip ${tripId} reached destination (ARRIVED_SCHOOL)`);

    // Update status to ARRIVED_SCHOOL in database
    await query(
      `UPDATE trips
       SET status = 'ARRIVED_SCHOOL',
           updated_at = NOW()
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [tripId, schoolId]
    );

    // Audit log stores the arrival milestone
    await this.recordTripAudit({
      schoolId,
      tripId,
      action: 'TRIP_ARRIVED_SCHOOL',
      userId: actor?.userId,
      userRole: actor?.userRole || (actor?.isDriver ? 'DRIVER' : 'SCHOOL_ADMIN'),
      changeSummary: 'Bus arrived at destination school campus',
      previousState: {
        status: current.status,
        stage: TripLifecycleStage.IN_TRANSIT,
      },
      newState: {
        status: TripStatus.ARRIVED_SCHOOL,
        stage: TripLifecycleStage.ARRIVED_SCHOOL,
        arrivedSchoolTime: new Date().toISOString(),
      },
    });

    return this.getTripById(schoolId, tripId, actor);
  }

  /**
   * Micro-phase 16.4: Conclude and finalize a trip (Lifecycle: COMPLETED)
   * Records end timestamp, stops tracking session, locks attendance ledger, and publishes real-time broadcast.
   */
  public static async completeTrip(
    schoolId: string,
    tripId: string,
    actor?: TripActorContext,
    payload?: EndTripRequest
  ): Promise<TripDetailResponse> {
    if (actor?.schoolId && actor.schoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant trip completion attempt');
    }

    // 1. Fetch current trip state and attached bus cache
    const currentRows = await query<{
      id: string;
      route_id: string;
      bus_id: string;
      driver_id: string;
      status: TripStatus;
      actual_start_time: string | null;
      actual_end_time: string | null;
      last_latitude: number | null;
      last_longitude: number | null;
      last_speed_kmh: number | null;
      last_bearing_degrees: number | null;
      gps_health_status: string | null;
    }>(
      `SELECT t.id, t.route_id, t.bus_id, t.driver_id, t.status, t.actual_start_time, t.actual_end_time,
              b.last_latitude, b.last_longitude, b.last_speed_kmh, b.last_bearing_degrees, b.gps_health_status
       FROM trips t
       LEFT JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
       WHERE t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
       LIMIT 1`,
      [tripId, schoolId]
    );

    if (currentRows.length === 0 || !currentRows[0]) {
      throw new NotFoundError(`Trip ${tripId} not found in this school context`);
    }

    const current = currentRows[0];

    // 2. Driver verification
    if (actor?.isDriver && actor.userId && current.driver_id !== actor.userId) {
      throw new ForbiddenError('You are not authorized to complete another driver\'s trip');
    }

    // 3. State machine validation & Idempotency:
    // If the trip is already completed, return existing finalized trip idempotently without duplicate side effects
    if (current.status === TripStatus.COMPLETED) {
      const keySuffix = actor?.idempotencyKey ? ` [Key: ${actor.idempotencyKey}]` : '';
      logger.info(
        `[TripService] Idempotent retry detected for completeTrip: Trip ${tripId} is already completed${keySuffix}`
      );
      const trip = await this.getTripById(schoolId, tripId, actor);
      return {
        ...trip,
        trackingSessionActive: false,
        attendanceLocked: true,
      };
    }
    if (current.status === TripStatus.CANCELLED) {
      throw new BadRequestError('Cannot complete a cancelled trip');
    }
    if (current.status === TripStatus.SCHEDULED) {
      throw new BadRequestError('Cannot complete a trip that has not been started');
    }

    // 4. Update status to COMPLETED and record actual_end_time (client payload or NOW())
    const explicitEndTime = payload?.endedAt || null;
    await query(
      `UPDATE trips
       SET status = 'COMPLETED',
           actual_end_time = COALESCE($3::timestamptz, actual_end_time, NOW()),
           updated_at = NOW()
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [tripId, schoolId, explicitEndTime]
    );

    // 5. Inactivate tracking session: unlink parent tracking tokens
    await query(
      `UPDATE parent_tracking_tokens
       SET trip_id = NULL,
           updated_at = NOW()
       WHERE trip_id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [tripId, schoolId]
    );

    logger.info(`[TripService] Trip ${tripId} COMPLETED and tracking session detached`);

    // 6. Broadcast real-time feed update indicating trip concluded
    const effectiveEndTime = explicitEndTime || new Date().toISOString();
    RealtimeFeedService.publish({
      type: 'LOCATION_UPDATE',
      schoolId,
      busId: current.bus_id,
      tripId,
      latitude: current.last_latitude != null ? Number(current.last_latitude) : 0,
      longitude: current.last_longitude != null ? Number(current.last_longitude) : 0,
      speedKmh: 0,
      bearingDegrees: current.last_bearing_degrees != null ? Number(current.last_bearing_degrees) : 0,
      accuracyMeters: null,
      batteryPercentage: null,
      isCharging: null,
      networkType: null,
      healthStatus: 'OFFLINE',
      recordedAt: effectiveEndTime,
      timestamp: new Date().toISOString(),
    });

    // 7. Audit log: TRIP_COMPLETED
    await this.recordTripAudit({
      schoolId,
      tripId,
      action: 'TRIP_COMPLETED',
      userId: actor?.userId,
      userRole: actor?.userRole || (actor?.isDriver ? 'DRIVER' : 'SCHOOL_ADMIN'),
      changeSummary: payload?.summaryNotes
        ? `Trip finished and marked COMPLETED. Notes: ${payload.summaryNotes}`
        : 'Trip successfully finished and marked COMPLETED',
      previousState: {
        status: current.status,
      },
      newState: {
        status: TripStatus.COMPLETED,
        stage: TripLifecycleStage.COMPLETED,
        actualEndTime: effectiveEndTime,
        summaryNotes: payload?.summaryNotes || null,
      },
    });

    // 8. Audit log: TRIP_ATTENDANCE_LOCKED (Locks attendance ledger permanently)
    await this.recordTripAudit({
      schoolId,
      tripId,
      action: 'TRIP_ATTENDANCE_LOCKED',
      userId: actor?.userId,
      userRole: actor?.userRole || (actor?.isDriver ? 'DRIVER' : 'SCHOOL_ADMIN'),
      changeSummary: 'Trip attendance ledger permanently locked upon trip conclusion',
      previousState: { attendanceLocked: false },
      newState: { attendanceLocked: true, lockedAt: effectiveEndTime },
    });

    return this.getTripById(schoolId, tripId, actor);
  }

  /**
   * Micro-phase 16.4: Retrieve comprehensive trip operational summary
   */
  public static async getTripSummary(
    schoolId: string,
    tripId: string,
    actor?: TripActorContext
  ): Promise<TripSummaryResponse> {
    if (actor?.schoolId && actor.schoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant trip summary access attempt');
    }

    const rows = await query<{
      trip_id: string;
      school_id: string;
      route_id: string;
      bus_id: string;
      driver_id: string;
      status: TripStatus;
      scheduled_date: string;
      scheduled_start_time: string;
      actual_start_time: string | null;
      actual_end_time: string | null;
      current_stop_sequence: number;
      delay_minutes: number;
      route_name: string | null;
      route_code: string | null;
      bus_number: string | null;
      registration_number: string | null;
      driver_name: string | null;
      driver_phone: string | null;
      total_stops: number;
      total_expected: number;
      total_boarded: number;
      total_deboarded: number;
      total_absent: number;
      completed_at: string | null;
    }>(
      `SELECT 
         t.id AS trip_id,
         t.school_id,
         t.route_id,
         t.bus_id,
         t.driver_id,
         t.status,
         t.scheduled_date::text AS scheduled_date,
         t.scheduled_start_time::text AS scheduled_start_time,
         t.actual_start_time::text AS actual_start_time,
         t.actual_end_time::text AS actual_end_time,
         t.current_stop_sequence,
         t.delay_minutes,
         r.name AS route_name,
         r.code AS route_code,
         b.bus_number,
         b.registration_number,
         d.full_name AS driver_name,
         d.phone AS driver_phone,
         (SELECT COUNT(*)::int FROM pickup_locations pl WHERE pl.route_id = t.route_id AND pl.deleted_at IS NULL) AS total_stops,
         (SELECT COUNT(DISTINCT ssa.student_id)::int FROM student_stop_assignments ssa JOIN pickup_locations pl ON (ssa.pickup_stop_id = pl.id OR ssa.drop_stop_id = pl.id) WHERE pl.route_id = t.route_id AND ssa.deleted_at IS NULL AND pl.deleted_at IS NULL) AS total_expected,
         (SELECT COUNT(DISTINCT be.student_id)::int FROM boarding_events be WHERE be.trip_id = t.id AND be.status = 'BOARDED') AS total_boarded,
         (SELECT COUNT(DISTINCT de.student_id)::int FROM drop_events de WHERE de.trip_id = t.id AND de.status = 'DEBOARDED') AS total_deboarded,
         (SELECT COUNT(DISTINCT be.student_id)::int FROM boarding_events be WHERE be.trip_id = t.id AND be.status = 'ABSENT') AS total_absent,
         (SELECT al.created_at::text FROM audit_logs al WHERE al.school_id = t.school_id AND al.entity_type = 'TRIP' AND al.entity_id = t.id AND al.action = 'TRIP_COMPLETED' ORDER BY al.created_at DESC LIMIT 1) AS completed_at
       FROM trips t
       LEFT JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
       LEFT JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
       LEFT JOIN drivers d ON t.driver_id = d.id AND d.deleted_at IS NULL
       WHERE t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
       LIMIT 1`,
      [tripId, schoolId]
    );

    if (rows.length === 0 || !rows[0]) {
      throw new NotFoundError(`Trip ${tripId} not found in this school context`);
    }

    const r = rows[0];

    // Compute duration in minutes
    let durationMinutes = 0;
    if (r.actual_start_time && r.actual_end_time) {
      const startMs = new Date(r.actual_start_time).getTime();
      const endMs = new Date(r.actual_end_time).getTime();
      durationMinutes = Math.max(0, Math.round((endMs - startMs) / 60000));
    }

    const totalExpected = Number(r.total_expected) || 0;
    const totalBoarded = Number(r.total_boarded) || 0;
    const totalDeboarded = Number(r.total_deboarded) || 0;
    const directAbsent = Number(r.total_absent) || 0;
    const totalAbsent = directAbsent > 0 ? directAbsent : Math.max(0, totalExpected - totalBoarded);

    const lifecycleStage = this.computeLifecycleStage({
      status: r.status,
      actualStartTime: r.actual_start_time,
      actualEndTime: r.actual_end_time,
      currentStopSequence: Number(r.current_stop_sequence),
    });

    return {
      tripId: r.trip_id,
      schoolId: r.school_id,
      routeId: r.route_id,
      routeName: r.route_name || undefined,
      routeCode: r.route_code || undefined,
      busId: r.bus_id,
      busNumber: r.bus_number || undefined,
      busRegistrationNumber: r.registration_number || undefined,
      driverId: r.driver_id,
      driverName: r.driver_name || undefined,
      driverPhone: r.driver_phone || undefined,
      status: r.status,
      lifecycleStage,
      scheduledDate: r.scheduled_date,
      scheduledStartTime: r.scheduled_start_time,
      actualStartTime: r.actual_start_time || null,
      actualEndTime: r.actual_end_time || null,
      durationMinutes,
      totalStops: Number(r.total_stops) || 0,
      stopsCompleted: Number(r.current_stop_sequence) || 0,
      delayMinutes: Number(r.delay_minutes) || 0,
      attendanceLocked: r.status === TripStatus.COMPLETED,
      attendance: {
        totalExpected,
        totalBoarded,
        totalDeboarded,
        totalAbsent,
      },
      completedAt: r.completed_at || undefined,
    };
  }

  /**
   * Micro-phase 16.4: Guard preventing modifications to attendance ledger once trip is completed
   */
  public static async assertAttendanceNotLocked(schoolId: string, tripId: string): Promise<void> {
    const rows = await query<{ status: TripStatus }>(
      `SELECT status FROM trips WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [tripId, schoolId]
    );
    if (rows.length === 0 || !rows[0]) {
      throw new NotFoundError(`Trip ${tripId} not found in this school context`);
    }
    if (rows[0].status === TripStatus.COMPLETED) {
      throw new BadRequestError('Trip attendance is locked because trip has completed');
    }
  }

  /**
   * Micro-phase 16.1: Cancel a trip with audit trail
   */
  public static async cancelTrip(
    schoolId: string,
    tripId: string,
    reason: string,
    actor?: TripActorContext
  ): Promise<TripDetailResponse> {
    if (actor?.schoolId && actor.schoolId !== schoolId) {
      throw new ForbiddenError('Cross-tenant trip cancellation attempt');
    }

    const currentRows = await query<{
      id: string;
      status: TripStatus;
    }>(
      `SELECT id, status
       FROM trips
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [tripId, schoolId]
    );

    if (currentRows.length === 0 || !currentRows[0]) {
      throw new NotFoundError(`Trip ${tripId} not found in this school context`);
    }

    const current = currentRows[0];

    if (current.status === TripStatus.COMPLETED) {
      throw new BadRequestError('Cannot cancel an already completed trip');
    }
    if (current.status === TripStatus.CANCELLED) {
      throw new BadRequestError('Trip is already cancelled');
    }

    await query(
      `UPDATE trips
       SET status = 'CANCELLED',
           updated_at = NOW()
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [tripId, schoolId]
    );

    logger.info(`[TripService] Trip ${tripId} CANCELLED. Reason: ${reason}`);

    // Audit log
    await this.recordTripAudit({
      schoolId,
      tripId,
      action: 'TRIP_CANCELLED',
      userId: actor?.userId,
      userRole: actor?.userRole || 'SCHOOL_ADMIN',
      changeSummary: `Trip cancelled: ${reason.trim()}`,
      previousState: {
        status: current.status,
      },
      newState: {
        status: TripStatus.CANCELLED,
        reason: reason.trim(),
      },
    });

    return this.getTripById(schoolId, tripId, actor);
  }
}
