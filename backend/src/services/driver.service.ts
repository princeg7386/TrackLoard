import bcrypt from 'bcryptjs';
import { query } from '../config/database.js';
import {
  CreateDriverRequest,
  DriverWithBus,
  normalizeIndianPhoneNumber,
} from '@school-bus/shared';
import {
  ConflictError,
  BadRequestError,
  NotFoundError,
} from '../middlewares/error.middleware.js';
import { DbService } from './db.service.js';
import { AuditService } from './audit.service.js';
import { logger } from './logger.service.js';

export class DriverService {
  /**
   * Registers a new driver profile with login credentials and optional bus pairing
   */
  public static async createDriver(
    schoolId: string,
    payload: CreateDriverRequest,
    userId?: string,
    ipAddress?: string
  ): Promise<DriverWithBus> {
    const normalizedPhone = normalizeIndianPhoneNumber(payload.phone);
    const trimmedName = payload.fullName.trim();
    const cleanLicense = payload.licenseNumber.trim().toUpperCase();
    const cleanExpiry = payload.licenseExpiry?.trim() || null;
    const cleanPhotoUrl = payload.photoUrl?.trim() || null;
    const assignedBusId = payload.assignedBusId?.trim() || null;

    // 1. Check for duplicate phone in this school tenant
    const duplicateSql = `
      SELECT id, full_name, phone
      FROM drivers
      WHERE school_id = $1 AND phone = $2 AND deleted_at IS NULL
    `;
    const existing = await query<{ id: string; full_name: string; phone: string }>(
      duplicateSql,
      [schoolId, normalizedPhone]
    );

    if (existing.length > 0) {
      throw new ConflictError(
        `Driver with mobile number "${normalizedPhone}" is already registered in your school.`
      );
    }

    // 2. If an assigned bus is specified, verify that the bus belongs to this school
    if (assignedBusId) {
      const busSql = `
        SELECT id, bus_number, registration_number
        FROM buses
        WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
      `;
      const busRows = await query<{ id: string; bus_number: string; registration_number: string }>(
        busSql,
        [assignedBusId, schoolId]
      );
      if (busRows.length === 0) {
        throw new BadRequestError('Selected fleet vehicle does not exist or belongs to another school.');
      }
    }

    // 3. Hash driver login PIN if provided (default to last 4 digits of phone if not specified)
    const rawPin = payload.pin && payload.pin.trim() ? payload.pin.trim() : normalizedPhone.slice(-4);
    const pinHash = await bcrypt.hash(rawPin, 10);

    let createdDriverId: string;

    // 4. Atomic Transaction: Insert driver and pair with bus if requested
    await DbService.withTransaction(async (client) => {
      const insertSql = `
        INSERT INTO drivers (
          school_id,
          full_name,
          phone,
          license_number,
          license_expiry,
          photo_url,
          pin_hash
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `;

      const insertRes = await client.query<{ id: string }>(insertSql, [
        schoolId,
        trimmedName,
        normalizedPhone,
        cleanLicense,
        cleanExpiry,
        cleanPhotoUrl,
        pinHash,
      ]);

      createdDriverId = insertRes.rows[0].id;

      // If bus assignment provided, update bus default driver
      if (assignedBusId) {
        await client.query(
          `UPDATE buses 
           SET default_driver_id = $1, updated_at = NOW() 
           WHERE id = $2 AND school_id = $3 AND deleted_at IS NULL`,
          [createdDriverId, assignedBusId, schoolId]
        );
      }
    });

    const driver = await this.getDriverById(schoolId, createdDriverId!);

    // 5. Immutable Audit Logging
    await AuditService.logAction({
      schoolId,
      userId: userId || null,
      userRole: 'SCHOOL_ADMIN',
      action: 'DRIVER_CREATED',
      entityType: 'DRIVER',
      entityId: driver.id!,
      diffJson: {
        after: {
          fullName: driver.fullName,
          phone: driver.phone,
          licenseNumber: driver.licenseNumber,
          licenseExpiry: driver.licenseExpiry,
          assignedBusId: driver.assignedBusId,
          assignedBusNumber: driver.assignedBusNumber,
        },
      },
      ipAddress,
    });

    logger.info('Driver registered successfully', {
      schoolId,
      driverId: driver.id,
      fullName: driver.fullName,
      phone: driver.phone,
      createdBy: userId,
    });

    return driver;
  }

  /**
   * Lists all registered drivers with joined bus pairings
   */
  public static async getDrivers(schoolId: string): Promise<DriverWithBus[]> {
    const sql = `
      SELECT 
        d.id,
        d.school_id AS "schoolId",
        d.full_name AS "fullName",
        d.phone,
        d.license_number AS "licenseNumber",
        TO_CHAR(d.license_expiry, 'YYYY-MM-DD') AS "licenseExpiry",
        d.photo_url AS "photoUrl",
        d.last_active_at AS "lastActiveAt",
        d.created_at AS "createdAt",
        d.updated_at AS "updatedAt",
        b.id AS "assignedBusId",
        b.bus_number AS "assignedBusNumber",
        b.registration_number AS "assignedRegistrationNumber",
        r.id AS "assignedRouteId",
        r.name AS "assignedRouteName",
        r.code AS "assignedRouteCode"
      FROM drivers d
      LEFT JOIN buses b ON b.default_driver_id = d.id AND b.deleted_at IS NULL
      LEFT JOIN routes r ON r.default_bus_id = b.id AND r.deleted_at IS NULL
      WHERE d.school_id = $1 AND d.deleted_at IS NULL
      ORDER BY d.full_name ASC
    `;

    return await query<DriverWithBus>(sql, [schoolId]);
  }

  /**
   * Retrieves single driver by ID
   */
  public static async getDriverById(schoolId: string, driverId: string): Promise<DriverWithBus> {
    const sql = `
      SELECT 
        d.id,
        d.school_id AS "schoolId",
        d.full_name AS "fullName",
        d.phone,
        d.license_number AS "licenseNumber",
        TO_CHAR(d.license_expiry, 'YYYY-MM-DD') AS "licenseExpiry",
        d.photo_url AS "photoUrl",
        d.last_active_at AS "lastActiveAt",
        d.created_at AS "createdAt",
        d.updated_at AS "updatedAt",
        b.id AS "assignedBusId",
        b.bus_number AS "assignedBusNumber",
        b.registration_number AS "assignedRegistrationNumber",
        r.id AS "assignedRouteId",
        r.name AS "assignedRouteName",
        r.code AS "assignedRouteCode"
      FROM drivers d
      LEFT JOIN buses b ON b.default_driver_id = d.id AND b.deleted_at IS NULL
      LEFT JOIN routes r ON r.default_bus_id = b.id AND r.deleted_at IS NULL
      WHERE d.school_id = $1 AND d.id = $2 AND d.deleted_at IS NULL
    `;

    const rows = await query<DriverWithBus>(sql, [schoolId, driverId]);
    if (rows.length === 0) {
      throw new NotFoundError(`Driver with ID ${driverId} not found in this school.`);
    }

    return rows[0];
  }
}
