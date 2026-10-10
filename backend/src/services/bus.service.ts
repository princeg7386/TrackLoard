import { query } from '../config/database.js';
import {
  CreateBusRequest,
  AssignBusPayload,
  BusWithDriver,
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
