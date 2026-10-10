import { query } from '../config/database.js';
import {
  CreateBusRequest,
  UpdateBusRequest,
  AssignBusPayload,
  BusWithDriver,
  BusDetailView,
  BusCurrentLocation,
  BusCurrentTrip,
  Driver,
  Route,
  normalizeIndianRegistrationNumber,
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
      const match = existing[0];
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

      driverName = driverRows[0].fullName;
      driverPhone = driverRows[0].phone;
      driverLicense = driverRows[0].licenseNumber;
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

    const createdBus = insertedRows[0];
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

    // 1. Safety Check: Verify no trip is currently IN_PROGRESS
    const activeTrips = await query<{ id: string }>(
      `SELECT id FROM trips 
       WHERE bus_id = $1 AND school_id = $2 AND status = 'IN_PROGRESS' AND deleted_at IS NULL`,
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
      const loc = locRows[0];
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
        AND t.status IN ('IN_PROGRESS', 'SCHEDULED')
        AND t.deleted_at IS NULL
      ORDER BY (CASE WHEN t.status = 'IN_PROGRESS' THEN 1 ELSE 2 END), t.scheduled_start_time ASC
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
      const tr = tripRows[0];
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

    return rows[0];
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
}
