import { query } from '../config/database.js';
import {
  CreateBusRequest,
  UpdateBusRequest,
  AssignBusPayload,
  BusWithDriver,
  BusDetailView,
  BusCurrentLocation,
  BusCurrentTrip,
  BusTripHistoryItem,
  BusIncidentHistoryItem,
  BusAttendanceSummaryItem,
  BusAttendanceRecordItem,
  BusAttendanceHistoryResponse,
  BusFullHistoryResponse,
  Driver,
  Route,
  normalizeIndianRegistrationNumber,
  ActiveTripStateResponse,
  GpsHealthStatus,
} from '@school-bus/shared';
import {
  ConflictError,
  BadRequestError,
  NotFoundError,
} from '../middlewares/error.middleware.js';
import { DbService } from './db.service.js';
import { AuditService } from './audit.service.js';
import { logger } from './logger.service.js';

export class BusService {
  /**
   * Registers a new vehicle in the school's fleet
   */
  public static async createBus(
    schoolId: string,
    payload: CreateBusRequest,
    userId?: string,
    ipAddress?: string
  ): Promise<BusWithDriver> {
    const normalizedReg = normalizeIndianRegistrationNumber(payload.registrationNumber);
    const trimmedBusNumber = payload.busNumber.trim();
    const cleanMakeModel = payload.makeModel?.trim() || null;
    const cleanDeviceIdentifier = payload.deviceIdentifier?.trim() || null;
    const driverId = payload.defaultDriverId || null;

    // 1. Check for duplicate registration number or bus number in this school tenant
    const duplicateSql = `
      SELECT id, registration_number, bus_number
      FROM buses
      WHERE school_id = $1 
        AND (UPPER(registration_number) = UPPER($2) OR UPPER(bus_number) = UPPER($3))
        AND deleted_at IS NULL
    `;
    const existing = await query<{
      id: string;
      registration_number: string;
      bus_number: string;
    }>(duplicateSql, [schoolId, normalizedReg, trimmedBusNumber]);

    if (existing.length > 0) {
      const match = existing[0]!;
      if (match.registration_number.toUpperCase() === normalizedReg.toUpperCase()) {
        throw new ConflictError(
          `Vehicle with registration number "${normalizedReg}" is already registered in your fleet.`
        );
      }
      throw new ConflictError(
        `Bus internal number "${trimmedBusNumber}" is already in use. Please use a unique identifier.`
      );
    }

    // 2. If a default driver is assigned, verify driver belongs to same school tenant
    let driverName: string | null = null;
    let driverPhone: string | null = null;
    let driverLicense: string | null = null;

    if (driverId) {
      const driverSql = `
        SELECT id, full_name AS "fullName", phone, license_number AS "licenseNumber"
        FROM drivers
        WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
      `;
      const driverRows = await query<{
        id: string;
        fullName: string;
        phone: string;
        licenseNumber: string;
      }>(driverSql, [driverId, schoolId]);

      if (driverRows.length === 0) {
        throw new BadRequestError(
          'Selected default driver does not exist or does not belong to this school.'
        );
      }

      driverName = driverRows[0]!.fullName;
      driverPhone = driverRows[0]!.phone;
      driverLicense = driverRows[0]!.licenseNumber;
    }

    // 3. Insert bus record
    const insertSql = `
      INSERT INTO buses (
        school_id,
        registration_number,
        bus_number,
        default_driver_id,
        device_identifier,
        make_model
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING 
        id,
        school_id AS "schoolId",
        registration_number AS "registrationNumber",
        bus_number AS "busNumber",
        default_driver_id AS "defaultDriverId",
        device_identifier AS "deviceIdentifier",
        make_model AS "makeModel",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    const insertedRows = await query<BusWithDriver>(insertSql, [
      schoolId,
      normalizedReg,
      trimmedBusNumber,
      driverId,
      cleanDeviceIdentifier,
      cleanMakeModel,
    ]);

    const createdBus = insertedRows[0]!;
    createdBus.driverName = driverName;
    createdBus.driverPhone = driverPhone;
    createdBus.driverLicenseNumber = driverLicense;

    // 4. Record immutable audit log
    await AuditService.logAction({
      schoolId,
      userId: userId || null,
      userRole: 'SCHOOL_ADMIN',
      action: 'BUS_CREATED',
      entityType: 'BUS',
      entityId: createdBus.id!,
      diffJson: {
        after: {
          busNumber: createdBus.busNumber,
          registrationNumber: createdBus.registrationNumber,
          makeModel: createdBus.makeModel,
          defaultDriverId: createdBus.defaultDriverId,
          deviceIdentifier: createdBus.deviceIdentifier,
        },
      },
      ipAddress,
    });

    logger.info('Vehicle registered in fleet successfully', {
      schoolId,
      busId: createdBus.id,
      registrationNumber: createdBus.registrationNumber,
      busNumber: createdBus.busNumber,
      createdBy: userId,
    });

    return createdBus;
  }

  /**
   * Updates an existing bus profile and specifications
   */
  public static async updateBus(
    schoolId: string,
    busId: string,
    payload: UpdateBusRequest,
    userId?: string,
    ipAddress?: string
  ): Promise<BusWithDriver> {
    const currentBus = await this.getBusById(schoolId, busId);

    const formattedReg = payload.registrationNumber
      ? normalizeIndianRegistrationNumber(payload.registrationNumber)
      : currentBus.registrationNumber;

    const formattedBusNumber = payload.busNumber
      ? payload.busNumber.trim()
      : currentBus.busNumber;

    // 1. Check duplicate registration number (excluding self)
    if (payload.registrationNumber) {
      const regDup = await query<{ id: string }>(
        `SELECT id FROM buses 
         WHERE school_id = $1 AND UPPER(registration_number) = UPPER($2) AND id != $3 AND deleted_at IS NULL`,
        [schoolId, formattedReg, busId]
      );
      if (regDup.length > 0) {
        throw new ConflictError(
          `Vehicle registration number "${formattedReg}" is already registered to another bus.`
        );
      }
    }

    // 2. Check duplicate bus number (excluding self)
    if (payload.busNumber) {
      const busDup = await query<{ id: string }>(
        `SELECT id FROM buses 
         WHERE school_id = $1 AND UPPER(bus_number) = UPPER($2) AND id != $3 AND deleted_at IS NULL`,
        [schoolId, formattedBusNumber, busId]
      );
      if (busDup.length > 0) {
        throw new ConflictError(
          `Bus internal identifier "${formattedBusNumber}" is already in use by another vehicle.`
        );
      }
    }

    // 3. Verify driver if updated
    if (payload.defaultDriverId !== undefined && payload.defaultDriverId !== null && payload.defaultDriverId !== '') {
      const driverRows = await query<{ id: string }>(
        `SELECT id FROM drivers WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [payload.defaultDriverId, schoolId]
      );
      if (driverRows.length === 0) {
        throw new BadRequestError('Assigned driver does not exist or belongs to another school.');
      }
    }

    const cleanMakeModel =
      payload.makeModel !== undefined ? payload.makeModel?.trim() || null : currentBus.makeModel;
    const cleanDeviceIdentifier =
      payload.deviceIdentifier !== undefined
        ? payload.deviceIdentifier?.trim() || null
        : currentBus.deviceIdentifier;
    const cleanDriverId =
      payload.defaultDriverId !== undefined
        ? payload.defaultDriverId || null
        : currentBus.defaultDriverId;

    const updateSql = `
      UPDATE buses
      SET
        registration_number = $1,
        bus_number = $2,
        make_model = $3,
        device_identifier = $4,
        default_driver_id = $5,
        updated_at = NOW()
      WHERE id = $6 AND school_id = $7 AND deleted_at IS NULL
    `;

    await query(updateSql, [
      formattedReg,
      formattedBusNumber,
      cleanMakeModel,
      cleanDeviceIdentifier,
      cleanDriverId,
      busId,
      schoolId,
    ]);

    const updatedBus = await this.getBusById(schoolId, busId);

    // 4. Audit logging
    await AuditService.logAction({
      schoolId,
      userId: userId || null,
      userRole: 'SCHOOL_ADMIN',
      action: 'BUS_UPDATED',
      entityType: 'BUS',
      entityId: busId,
      diffJson: {
        before: {
          busNumber: currentBus.busNumber,
          registrationNumber: currentBus.registrationNumber,
          makeModel: currentBus.makeModel,
          deviceIdentifier: currentBus.deviceIdentifier,
          defaultDriverId: currentBus.defaultDriverId,
        },
        after: {
          busNumber: updatedBus.busNumber,
          registrationNumber: updatedBus.registrationNumber,
          makeModel: updatedBus.makeModel,
          deviceIdentifier: updatedBus.deviceIdentifier,
          defaultDriverId: updatedBus.defaultDriverId,
        },
      },
      ipAddress,
    });

    logger.info('Vehicle specifications updated successfully', {
      schoolId,
      busId,
      busNumber: updatedBus.busNumber,
      updatedBy: userId,
    });

    return updatedBus;
  }

  /**
   * Soft-deletes a bus with in-progress trip safety checks and unbinds routes
   */
  public static async deleteBus(
    schoolId: string,
    busId: string,
    userId?: string,
    ipAddress?: string
  ): Promise<{ success: boolean; message: string }> {
    const bus = await this.getBusById(schoolId, busId);

    // 1. Safety Check: Verify no trip is currently IN_TRANSIT
    const activeTrips = await query<{ id: string }>(
      `SELECT id FROM trips 
       WHERE bus_id = $1 AND school_id = $2 AND status IN ('IN_TRANSIT', 'DELAYED', 'ARRIVED_SCHOOL') AND deleted_at IS NULL`,
      [busId, schoolId]
    );

    if (activeTrips.length > 0) {
      throw new BadRequestError(
        'Cannot remove vehicle while an active trip is currently in progress. Please complete or abort the trip before removing this bus.'
      );
    }

    // 2. Transaction: Unbind routes and soft-delete bus
    await DbService.withTransaction(async (client) => {
      // Unbind route defaults
      await client.query(
        `UPDATE routes 
         SET default_bus_id = NULL, updated_at = NOW() 
         WHERE school_id = $1 AND default_bus_id = $2 AND deleted_at IS NULL`,
        [schoolId, busId]
      );

      // Soft delete bus
      await client.query(
        `UPDATE buses 
         SET deleted_at = NOW(), updated_at = NOW() 
         WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [busId, schoolId]
      );
    });

    // 3. Audit log
    await AuditService.logAction({
      schoolId,
      userId: userId || null,
      userRole: 'SCHOOL_ADMIN',
      action: 'BUS_REMOVED',
      entityType: 'BUS',
      entityId: busId,
      diffJson: {
        before: {
          busNumber: bus.busNumber,
          registrationNumber: bus.registrationNumber,
          driverName: bus.driverName,
          assignedRouteName: bus.assignedRouteName,
        },
      },
      ipAddress,
    });

    logger.info('Vehicle removed from fleet successfully', {
      schoolId,
      busId,
      busNumber: bus.busNumber,
      removedBy: userId,
    });

    return {
      success: true,
      message: `Vehicle ${bus.busNumber} (${bus.registrationNumber}) was removed from your fleet.`,
    };
  }

  /**
   * Retrieves single bus detail view with live GPS location and current active trip
   */
  public static async getBusDetail(schoolId: string, busId: string): Promise<BusDetailView> {
    const bus = await this.getBusById(schoolId, busId);

    // 1. Fetch latest GPS location from PostGIS telemetry stream
    const locSql = `
      SELECT 
        latitude,
        longitude,
        speed_kmh AS "speedKmh",
        bearing_degrees AS "bearingDegrees",
        accuracy_meters AS "accuracyMeters",
        recorded_at AS "recordedAt"
      FROM gps_locations
      WHERE bus_id = $1
      ORDER BY recorded_at DESC
      LIMIT 1
    `;
    const locRows = await query<{
      latitude: number;
      longitude: number;
      speedKmh: number | string;
      bearingDegrees: number | string | null;
      accuracyMeters: number | string | null;
      recordedAt: string;
    }>(locSql, [busId]);

    let currentLocation: BusCurrentLocation | null = null;
    if (locRows.length > 0) {
      const loc = locRows[0]!;
      currentLocation = {
        latitude: Number(loc.latitude),
        longitude: Number(loc.longitude),
        speedKmh: Number(loc.speedKmh) || 0,
        bearingDegrees: loc.bearingDegrees !== null ? Number(loc.bearingDegrees) : null,
        accuracyMeters: loc.accuracyMeters !== null ? Number(loc.accuracyMeters) : null,
        recordedAt: new Date(loc.recordedAt).toISOString(),
      };
    }

    // 2. Fetch current trip (in-progress or scheduled for today)
    const tripSql = `
      SELECT
        t.id,
        t.route_id AS "routeId",
        r.name AS "routeName",
        r.code AS "routeCode",
        r.route_type AS "routeType",
        t.status,
        t.scheduled_start_time AS "scheduledStartTime",
        t.actual_start_time AS "actualStartTime",
        t.current_stop_sequence AS "currentStopSequence",
        t.delay_minutes AS "delayMinutes"
      FROM trips t
      JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
      WHERE t.bus_id = $1 
        AND t.school_id = $2 
        AND t.scheduled_date = CURRENT_DATE
        AND t.status IN ('IN_TRANSIT', 'DELAYED', 'ARRIVED_SCHOOL', 'SCHEDULED')
        AND t.deleted_at IS NULL
      ORDER BY (CASE WHEN t.status IN ('IN_TRANSIT', 'DELAYED', 'ARRIVED_SCHOOL') THEN 1 ELSE 2 END), t.scheduled_start_time ASC
      LIMIT 1
    `;
    const tripRows = await query<{
      id: string;
      routeId: string;
      routeName: string;
      routeCode: string;
      routeType: string;
      status: string;
      scheduledStartTime: string;
      actualStartTime: string | null;
      currentStopSequence: number;
      delayMinutes: number;
    }>(tripSql, [busId, schoolId]);

    let currentTrip: BusCurrentTrip | null = null;
    if (tripRows.length > 0) {
      const tr = tripRows[0]!;
      currentTrip = {
        id: tr.id,
        routeId: tr.routeId,
        routeName: tr.routeName,
        routeCode: tr.routeCode,
        routeType: tr.routeType,
        status: tr.status,
        scheduledStartTime: new Date(tr.scheduledStartTime).toISOString(),
        actualStartTime: tr.actualStartTime ? new Date(tr.actualStartTime).toISOString() : null,
        currentStopSequence: Number(tr.currentStopSequence) || 0,
        delayMinutes: Number(tr.delayMinutes) || 0,
      };
    }

    return {
      ...bus,
      currentLocation,
      currentTrip,
    };
  }

  /**
   * Updates Driver and/or Route assignments for a bus atomically
   */
  public static async assignDriverAndRoute(
    schoolId: string,
    busId: string,
    payload: AssignBusPayload,
    userId?: string,
    ipAddress?: string
  ): Promise<BusWithDriver> {
    const currentBus = await this.getBusById(schoolId, busId);

    // 1. Verify Driver if driverId provided
    if (payload.driverId !== undefined && payload.driverId !== null) {
      const driverRows = await query<{ id: string }>(
        `SELECT id FROM drivers WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [payload.driverId, schoolId]
      );
      if (driverRows.length === 0) {
        throw new BadRequestError(
          'Selected driver does not exist or does not belong to this school.'
        );
      }
    }

    // 2. Verify Route if routeId provided
    if (payload.routeId !== undefined && payload.routeId !== null) {
      const routeRows = await query<{ id: string }>(
        `SELECT id FROM routes WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [payload.routeId, schoolId]
      );
      if (routeRows.length === 0) {
        throw new BadRequestError(
          'Selected route does not exist or does not belong to this school.'
        );
      }
    }

    // 3. Atomic Database Transaction Execution
    await DbService.withTransaction(async (client) => {
      // Update Driver on Bus
      if (payload.driverId !== undefined) {
        await client.query(
          `UPDATE buses 
           SET default_driver_id = $1, updated_at = NOW() 
           WHERE id = $2 AND school_id = $3 AND deleted_at IS NULL`,
          [payload.driverId, busId, schoolId]
        );
      }

      // Update Route assignment
      if (payload.routeId !== undefined) {
        if (payload.routeId !== null) {
          // Unbind any other route previously bound to this bus
          await client.query(
            `UPDATE routes 
             SET default_bus_id = NULL, updated_at = NOW() 
             WHERE school_id = $1 AND default_bus_id = $2 AND id != $3 AND deleted_at IS NULL`,
            [schoolId, busId, payload.routeId]
          );

          // Bind route to this bus
          await client.query(
            `UPDATE routes 
             SET default_bus_id = $1, updated_at = NOW() 
             WHERE id = $2 AND school_id = $3 AND deleted_at IS NULL`,
            [busId, payload.routeId, schoolId]
          );
        } else {
          // Unassign all routes for this bus
          await client.query(
            `UPDATE routes 
             SET default_bus_id = NULL, updated_at = NOW() 
             WHERE school_id = $1 AND default_bus_id = $2 AND deleted_at IS NULL`,
            [schoolId, busId]
          );
        }
      }
    });

    const updatedBus = await this.getBusById(schoolId, busId);

    // 4. Record Audit Trail
    await AuditService.logAction({
      schoolId,
      userId: userId || null,
      userRole: 'SCHOOL_ADMIN',
      action: 'BUS_ASSIGNMENTS_UPDATED',
      entityType: 'BUS',
      entityId: busId,
      diffJson: {
        before: {
          defaultDriverId: currentBus.defaultDriverId,
          driverName: currentBus.driverName,
          assignedRouteId: currentBus.assignedRouteId,
          assignedRouteName: currentBus.assignedRouteName,
        },
        after: {
          defaultDriverId: updatedBus.defaultDriverId,
          driverName: updatedBus.driverName,
          assignedRouteId: updatedBus.assignedRouteId,
          assignedRouteName: updatedBus.assignedRouteName,
        },
      },
      ipAddress,
    });

    logger.info('Bus assignments updated successfully', {
      schoolId,
      busId,
      driverId: updatedBus.defaultDriverId,
      routeId: updatedBus.assignedRouteId,
      updatedBy: userId,
    });

    return updatedBus;
  }

  /**
   * Lists all fleet vehicles for a school with joined driver and route details
   */
  public static async getBuses(schoolId: string): Promise<BusWithDriver[]> {
    const sql = `
      SELECT 
        b.id,
        b.school_id AS "schoolId",
        b.registration_number AS "registrationNumber",
        b.bus_number AS "busNumber",
        b.default_driver_id AS "defaultDriverId",
        b.device_identifier AS "deviceIdentifier",
        b.make_model AS "makeModel",
        b.created_at AS "createdAt",
        b.updated_at AS "updatedAt",
        d.full_name AS "driverName",
        d.phone AS "driverPhone",
        d.license_number AS "driverLicenseNumber",
        r.id AS "assignedRouteId",
        r.name AS "assignedRouteName",
        r.code AS "assignedRouteCode",
        r.route_type AS "assignedRouteType"
      FROM buses b
      LEFT JOIN drivers d ON b.default_driver_id = d.id AND d.deleted_at IS NULL
      LEFT JOIN routes r ON r.default_bus_id = b.id AND r.deleted_at IS NULL
      WHERE b.school_id = $1 AND b.deleted_at IS NULL
      ORDER BY b.bus_number ASC, b.created_at DESC
    `;

    return await query<BusWithDriver>(sql, [schoolId]);
  }

  /**
   * Retrieves single bus by ID with joined driver and route details
   */
  public static async getBusById(schoolId: string, busId: string): Promise<BusWithDriver> {
    const sql = `
      SELECT 
        b.id,
        b.school_id AS "schoolId",
        b.registration_number AS "registrationNumber",
        b.bus_number AS "busNumber",
        b.default_driver_id AS "defaultDriverId",
        b.device_identifier AS "deviceIdentifier",
        b.make_model AS "makeModel",
        b.created_at AS "createdAt",
        b.updated_at AS "updatedAt",
        d.full_name AS "driverName",
        d.phone AS "driverPhone",
        d.license_number AS "driverLicenseNumber",
        r.id AS "assignedRouteId",
        r.name AS "assignedRouteName",
        r.code AS "assignedRouteCode",
        r.route_type AS "assignedRouteType"
      FROM buses b
      LEFT JOIN drivers d ON b.default_driver_id = d.id AND d.deleted_at IS NULL
      LEFT JOIN routes r ON r.default_bus_id = b.id AND r.deleted_at IS NULL
      WHERE b.school_id = $1 AND b.id = $2 AND b.deleted_at IS NULL
    `;

    const rows = await query<BusWithDriver>(sql, [schoolId, busId]);
    if (rows.length === 0) {
      throw new NotFoundError(`Vehicle with ID ${busId} not found in this school.`);
    }

    return rows[0]!;
  }

  /**
   * Retrieves registered drivers for tenant dropdowns
   */
  public static async getDrivers(schoolId: string): Promise<Driver[]> {
    const sql = `
      SELECT
        id,
        school_id AS "schoolId",
        full_name AS "fullName",
        phone,
        license_number AS "licenseNumber",
        license_expiry AS "licenseExpiry",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM drivers
      WHERE school_id = $1 AND deleted_at IS NULL
      ORDER BY full_name ASC
    `;
    return await query<Driver>(sql, [schoolId]);
  }

  /**
   * Retrieves configured routes for tenant dropdowns
   */
  public static async getRoutes(schoolId: string): Promise<Route[]> {
    const sql = `
      SELECT
        id,
        school_id AS "schoolId",
        name,
        code,
        route_type AS "routeType",
        default_bus_id AS "defaultBusId",
        default_driver_id AS "defaultDriverId",
        path_polyline AS "pathPolyline",
        estimated_duration_minutes AS "estimatedDurationMinutes",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM routes
      WHERE school_id = $1 AND deleted_at IS NULL
      ORDER BY name ASC
    `;
    return await query<Route>(sql, [schoolId]);
  }

  /**
   * Retrieves paginated trip history for a bus
   */
  public static async getBusTripHistory(
    schoolId: string,
    busId: string,
    limit = 50,
    offset = 0
  ): Promise<BusTripHistoryItem[]> {
    // Verify vehicle belongs to school tenant
    await this.getBusById(schoolId, busId);

    const sql = `
      SELECT 
        t.id,
        t.school_id AS "schoolId",
        t.route_id AS "routeId",
        r.name AS "routeName",
        r.code AS "routeCode",
        r.route_type AS "routeType",
        t.driver_id AS "driverId",
        d.full_name AS "driverName",
        d.phone AS "driverPhone",
        t.status,
        TO_CHAR(t.scheduled_date, 'YYYY-MM-DD') AS "scheduledDate",
        t.scheduled_start_time AS "scheduledStartTime",
        t.actual_start_time AS "actualStartTime",
        t.actual_end_time AS "actualEndTime",
        t.current_stop_sequence AS "currentStopSequence",
        t.delay_minutes AS "delayMinutes",
        COALESCE(b_count.boarded_count, 0)::int AS "totalBoarded"
      FROM trips t
      JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
      JOIN drivers d ON t.driver_id = d.id AND d.deleted_at IS NULL
      LEFT JOIN (
        SELECT trip_id, COUNT(DISTINCT student_id) AS boarded_count
        FROM boarding_events
        WHERE status = 'BOARDED'
        GROUP BY trip_id
      ) b_count ON b_count.trip_id = t.id
      WHERE t.bus_id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
      ORDER BY t.scheduled_date DESC, t.scheduled_start_time DESC
      LIMIT $3 OFFSET $4
    `;

    const rows = await query<any>(sql, [busId, schoolId, limit, offset]);

    return rows.map((r) => ({
      id: r.id,
      schoolId: r.schoolId,
      routeId: r.routeId,
      routeName: r.routeName,
      routeCode: r.routeCode,
      routeType: r.routeType,
      driverId: r.driverId,
      driverName: r.driverName,
      driverPhone: r.driverPhone,
      status: r.status,
      scheduledDate: r.scheduledDate,
      scheduledStartTime: new Date(r.scheduledStartTime).toISOString(),
      actualStartTime: r.actualStartTime ? new Date(r.actualStartTime).toISOString() : null,
      actualEndTime: r.actualEndTime ? new Date(r.actualEndTime).toISOString() : null,
      currentStopSequence: Number(r.currentStopSequence) || 0,
      delayMinutes: Number(r.delayMinutes) || 0,
      totalBoarded: Number(r.totalBoarded) || 0,
    }));
  }

  /**
   * Retrieves combined safety incident and emergency SOS alert history for a bus
   */
  public static async getBusIncidentHistory(
    schoolId: string,
    busId: string,
    limit = 50,
    offset = 0
  ): Promise<BusIncidentHistoryItem[]> {
    // Verify vehicle belongs to school tenant
    await this.getBusById(schoolId, busId);

    const sql = `
      SELECT * FROM (
        SELECT 
          i.id,
          i.school_id AS "schoolId",
          i.trip_id AS "tripId",
          'INCIDENT' AS category,
          i.incident_type AS type,
          i.severity,
          i.status,
          i.description,
          d.full_name AS "driverName",
          r.name AS "routeName",
          i.latitude,
          i.longitude,
          i.reported_by AS "reportedBy",
          NULL::text AS "acknowledgedAt",
          i.resolved_at AS "resolvedAt",
          NULL::text AS "resolutionNotes",
          i.created_at AS "createdAt"
        FROM incidents i
        LEFT JOIN drivers d ON i.driver_id = d.id
        LEFT JOIN trips t ON i.trip_id = t.id
        LEFT JOIN routes r ON t.route_id = r.id
        WHERE i.bus_id = $1 AND i.school_id = $2

        UNION ALL

        SELECT 
          s.id,
          s.school_id AS "schoolId",
          s.trip_id AS "tripId",
          'SOS' AS category,
          s.trigger_source AS type,
          'CRITICAL' AS severity,
          s.status,
          CONCAT('Emergency SOS triggered via ', s.trigger_source) AS description,
          d.full_name AS "driverName",
          r.name AS "routeName",
          s.latitude,
          s.longitude,
          'DRIVER' AS "reportedBy",
          s.acknowledged_at::text AS "acknowledgedAt",
          s.resolved_at AS "resolvedAt",
          s.resolution_notes AS "resolutionNotes",
          s.created_at AS "createdAt"
        FROM sos_events s
        LEFT JOIN drivers d ON s.driver_id = d.id
        LEFT JOIN trips t ON s.trip_id = t.id
        LEFT JOIN routes r ON t.route_id = r.id
        WHERE s.bus_id = $1 AND s.school_id = $2
      ) events
      ORDER BY "createdAt" DESC
      LIMIT $3 OFFSET $4
    `;

    const rows = await query<any>(sql, [busId, schoolId, limit, offset]);

    return rows.map((r) => ({
      id: r.id,
      schoolId: r.schoolId,
      tripId: r.tripId,
      category: r.category as 'INCIDENT' | 'SOS',
      type: r.type,
      severity: r.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
      status: r.status,
      description: r.description,
      driverName: r.driverName,
      routeName: r.routeName,
      latitude: r.latitude != null ? Number(r.latitude) : null,
      longitude: r.longitude != null ? Number(r.longitude) : null,
      reportedBy: r.reportedBy,
      acknowledgedAt: r.acknowledgedAt ? new Date(r.acknowledgedAt).toISOString() : null,
      resolvedAt: r.resolvedAt ? new Date(r.resolvedAt).toISOString() : null,
      resolutionNotes: r.resolutionNotes,
      createdAt: new Date(r.createdAt).toISOString(),
    }));
  }

  /**
   * Retrieves student boarding and drop attendance history and trip summaries for a bus
   */
  public static async getBusAttendanceHistory(
    schoolId: string,
    busId: string,
    limit = 50
  ): Promise<BusAttendanceHistoryResponse> {
    // Verify vehicle belongs to school tenant
    await this.getBusById(schoolId, busId);

    // 1. Trip Summaries
    const summarySql = `
      SELECT 
        t.id AS "tripId",
        TO_CHAR(t.scheduled_date, 'YYYY-MM-DD') AS "scheduledDate",
        r.name AS "routeName",
        r.code AS "routeCode",
        r.route_type AS "shiftType",
        d.full_name AS "driverName",
        COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'BOARDED')::int AS "totalBoarded",
        COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'ABSENT')::int AS "totalAbsent",
        COUNT(DISTINCT dr.id) FILTER (WHERE dr.status = 'DEBOARDED')::int AS "totalDeboarded",
        (COUNT(DISTINCT b.id) + COUNT(DISTINCT dr.id))::int AS "totalEvents"
      FROM trips t
      JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
      JOIN drivers d ON t.driver_id = d.id AND d.deleted_at IS NULL
      LEFT JOIN boarding_events b ON b.trip_id = t.id
      LEFT JOIN drop_events dr ON dr.trip_id = t.id
      WHERE t.bus_id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
      GROUP BY t.id, t.scheduled_date, r.name, r.code, r.route_type, d.full_name
      ORDER BY t.scheduled_date DESC, t.scheduled_start_time DESC
      LIMIT $3
    `;
    const summaryRows = await query<any>(summarySql, [busId, schoolId, limit]);

    const summaries: BusAttendanceSummaryItem[] = summaryRows.map((s) => ({
      tripId: s.tripId,
      scheduledDate: s.scheduledDate,
      routeName: s.routeName,
      routeCode: s.routeCode,
      shiftType: s.shiftType,
      driverName: s.driverName,
      totalBoarded: Number(s.totalBoarded) || 0,
      totalAbsent: Number(s.totalAbsent) || 0,
      totalDeboarded: Number(s.totalDeboarded) || 0,
      totalEvents: Number(s.totalEvents) || 0,
    }));

    // 2. Recent Student Boarding / Drop Records
    const recordsSql = `
      SELECT * FROM (
        SELECT 
          b.id,
          b.trip_id AS "tripId",
          TO_CHAR(t.scheduled_date, 'YYYY-MM-DD') AS "scheduledDate",
          s.id AS "studentId",
          s.full_name AS "studentName",
          s.admission_number AS "admissionNumber",
          s.class_grade AS "classGrade",
          s.section,
          p.stop_name AS "stopName",
          'BOARDING' AS "eventType",
          b.status,
          b.marked_by AS "markedBy",
          b.recorded_at AS "recordedAt"
        FROM boarding_events b
        JOIN trips t ON b.trip_id = t.id
        JOIN students s ON b.student_id = s.id
        JOIN pickup_locations p ON b.stop_id = p.id
        WHERE t.bus_id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL

        UNION ALL

        SELECT 
          dr.id,
          dr.trip_id AS "tripId",
          TO_CHAR(t.scheduled_date, 'YYYY-MM-DD') AS "scheduledDate",
          s.id AS "studentId",
          s.full_name AS "studentName",
          s.admission_number AS "admissionNumber",
          s.class_grade AS "classGrade",
          s.section,
          p.stop_name AS "stopName",
          'DROP' AS "eventType",
          dr.status,
          dr.marked_by AS "markedBy",
          dr.recorded_at AS "recordedAt"
        FROM drop_events dr
        JOIN trips t ON dr.trip_id = t.id
        JOIN students s ON dr.student_id = s.id
        JOIN pickup_locations p ON dr.stop_id = p.id
        WHERE t.bus_id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
      ) records
      ORDER BY "recordedAt" DESC
      LIMIT 50
    `;
    const recordRows = await query<any>(recordsSql, [busId, schoolId]);

    const recentRecords: BusAttendanceRecordItem[] = recordRows.map((r) => ({
      id: r.id,
      tripId: r.tripId,
      scheduledDate: r.scheduledDate,
      studentId: r.studentId,
      studentName: r.studentName,
      admissionNumber: r.admissionNumber,
      classGrade: r.classGrade,
      section: r.section,
      stopName: r.stopName,
      eventType: r.eventType as 'BOARDING' | 'DROP',
      status: r.status,
      markedBy: r.markedBy,
      recordedAt: new Date(r.recordedAt).toISOString(),
    }));

    return {
      summaries,
      recentRecords,
    };
  }

  /**
   * Retrieves consolidated vehicle history (Bus Profile, Trips, Incidents, Attendance)
   */
  public static async getBusFullHistory(
    schoolId: string,
    busId: string
  ): Promise<BusFullHistoryResponse> {
    const [bus, trips, incidents, attendance] = await Promise.all([
      this.getBusById(schoolId, busId),
      this.getBusTripHistory(schoolId, busId, 30),
      this.getBusIncidentHistory(schoolId, busId, 30),
      this.getBusAttendanceHistory(schoolId, busId, 30),
    ]);

    return {
      bus,
      trips,
      incidents,
      attendance,
    };
  }

  /**
   * Phase 12.1 — Current Bus State
   * Returns a full snapshot of bus + driver + active trip + route + live GPS cache.
   * Uses the O(1) buses.last_* location cache; no gps_locations table scan.
   *
   * @param callerSchoolId Enforces tenant isolation — throws NotFoundError if bus
   *   does not belong to this school.
   */
  static async getActiveBusState(
    busId: string,
    callerSchoolId: string
  ): Promise<ActiveTripStateResponse> {
    const rows = await query<{
      bus_id: string;
      bus_number: string;
      registration_number: string;
      make_model: string | null;
      last_latitude: number | null;
      last_longitude: number | null;
      last_speed_kmh: number | null;
      last_bearing_degrees: number | null;
      last_accuracy_meters: number | null;
      last_battery_percentage: number | null;
      last_is_charging: boolean | null;
      last_network_type: string | null;
      last_gps_recorded_at: string | null;
      gps_health_status: string | null;
      driver_id: string | null;
      driver_name: string | null;
      driver_phone: string | null;
      trip_id: string | null;
      trip_status: string | null;
      route_id: string | null;
      route_name: string | null;
      route_code: string | null;
      route_type: string | null;
      scheduled_start_time: string | null;
      actual_start_time: string | null;
      current_stop_sequence: number | null;
      delay_minutes: number | null;
    }>(
      `SELECT
        b.id                        AS bus_id,
        b.bus_number,
        b.registration_number,
        b.make_model,
        b.last_latitude,
        b.last_longitude,
        b.last_speed_kmh,
        b.last_bearing_degrees,
        b.last_accuracy_meters,
        b.last_battery_percentage,
        b.last_is_charging,
        b.last_network_type,
        b.last_gps_recorded_at,
        b.gps_health_status,
        d.id                        AS driver_id,
        d.full_name                 AS driver_name,
        d.phone                     AS driver_phone,
        t.id                        AS trip_id,
        t.status                    AS trip_status,
        r.id                        AS route_id,
        r.name                      AS route_name,
        r.code                      AS route_code,
        r.route_type,
        t.scheduled_start_time,
        t.actual_start_time,
        t.current_stop_sequence,
        t.delay_minutes
       FROM buses b
       LEFT JOIN drivers d
         ON d.id = b.default_driver_id AND d.deleted_at IS NULL
       LEFT JOIN trips t
         ON t.bus_id = b.id
        AND t.status IN ('IN_TRANSIT', 'DELAYED', 'ARRIVED_SCHOOL', 'SCHEDULED', 'EMERGENCY')
        AND t.deleted_at IS NULL
       LEFT JOIN routes r
         ON r.id = t.route_id AND r.deleted_at IS NULL
       WHERE b.id = $1
         AND b.school_id = $2
         AND b.deleted_at IS NULL
       ORDER BY
         CASE t.status
           WHEN 'IN_TRANSIT'     THEN 1
           WHEN 'DELAYED'        THEN 2
           WHEN 'ARRIVED_SCHOOL' THEN 3
           WHEN 'EMERGENCY'      THEN 4
           WHEN 'SCHEDULED'      THEN 5
           ELSE 6
         END ASC
       LIMIT 1;`,
      [busId, callerSchoolId]
    );

    const row = rows[0];
    if (!row) {
      throw new NotFoundError(`Bus ${busId} not found`);
    }

    const gpsAge =
      row.last_gps_recorded_at
        ? Math.max(0, Math.floor((Date.now() - new Date(row.last_gps_recorded_at).getTime()) / 1000))
        : null;

    return {
      busId: row.bus_id,
      busNumber: row.bus_number,
      registrationNumber: row.registration_number,
      makeModel: row.make_model ?? null,

      driverId: row.driver_id ?? null,
      driverName: row.driver_name ?? null,
      driverPhone: row.driver_phone ?? null,

      tripId: row.trip_id ?? null,
      tripStatus: row.trip_status ?? null,
      routeId: row.route_id ?? null,
      routeName: row.route_name ?? null,
      routeCode: row.route_code ?? null,
      routeType: row.route_type ?? null,
      scheduledStartTime: row.scheduled_start_time
        ? new Date(row.scheduled_start_time).toISOString()
        : null,
      actualStartTime: row.actual_start_time
        ? new Date(row.actual_start_time).toISOString()
        : null,
      currentStopSequence: row.current_stop_sequence ?? null,
      delayMinutes: row.delay_minutes ?? null,

      lastLatitude: row.last_latitude != null ? Number(row.last_latitude) : null,
      lastLongitude: row.last_longitude != null ? Number(row.last_longitude) : null,
      lastSpeedKmh: row.last_speed_kmh != null ? Number(row.last_speed_kmh) : null,
      lastBearingDegrees: row.last_bearing_degrees != null ? Number(row.last_bearing_degrees) : null,
      lastAccuracyMeters: row.last_accuracy_meters != null ? Number(row.last_accuracy_meters) : null,
      lastBatteryPercentage: row.last_battery_percentage != null ? Number(row.last_battery_percentage) : null,
      lastIsCharging: row.last_is_charging != null ? Boolean(row.last_is_charging) : null,
      lastNetworkType: row.last_network_type ?? null,
      lastGpsRecordedAt: row.last_gps_recorded_at
        ? new Date(row.last_gps_recorded_at).toISOString()
        : null,
      gpsHealthStatus: (row.gps_health_status as GpsHealthStatus) ?? 'OFFLINE',
      gpsAgeSeconds: gpsAge,
    };
  }
}


