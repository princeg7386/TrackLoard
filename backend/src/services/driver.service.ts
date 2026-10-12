import bcrypt from 'bcryptjs';
import { query } from '../config/database.js';
import {
  CreateDriverRequest,
  UpdateDriverRequest,
  DriverWithBus,
  DriverTripHistoryItem,
  DriverIncidentHistoryItem,
  DriverAttendanceSummaryItem,
  DriverAttendanceRecordItem,
  DriverAttendanceHistoryResponse,
  DriverFullHistoryResponse,
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

      createdDriverId = insertRes.rows[0]!.id;

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

    return rows[0]!;
  }

  /**
   * Updates Driver bus assignment atomically
   */
  public static async assignBus(
    schoolId: string,
    driverId: string,
    busId: string | null | undefined,
    userId?: string,
    ipAddress?: string
  ): Promise<DriverWithBus> {
    const currentDriver = await this.getDriverById(schoolId, driverId);

    // 1. If busId is provided, verify bus exists in this school tenant
    if (busId) {
      const busRows = await query<{ id: string; bus_number: string; registration_number: string }>(
        `SELECT id, bus_number, registration_number FROM buses 
         WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [busId, schoolId]
      );
      if (busRows.length === 0) {
        throw new BadRequestError('Selected fleet vehicle does not exist or belongs to another school.');
      }
    }

    // 2. Transaction execution: unbind and bind
    await DbService.withTransaction(async (client) => {
      // Unbind any other bus where this driver was previously assigned
      await client.query(
        `UPDATE buses 
         SET default_driver_id = NULL, updated_at = NOW() 
         WHERE school_id = $1 AND default_driver_id = $2 AND ($3::uuid IS NULL OR id != $3) AND deleted_at IS NULL`,
        [schoolId, driverId, busId || null]
      );

      // If busId is specified, assign driver to new bus
      if (busId) {
        await client.query(
          `UPDATE buses 
           SET default_driver_id = $1, updated_at = NOW() 
           WHERE id = $2 AND school_id = $3 AND deleted_at IS NULL`,
          [driverId, busId, schoolId]
        );
      }
    });

    const updatedDriver = await this.getDriverById(schoolId, driverId);

    // 3. Audit logging
    await AuditService.logAction({
      schoolId,
      userId: userId || null,
      userRole: 'SCHOOL_ADMIN',
      action: 'DRIVER_BUS_ASSIGNED',
      entityType: 'DRIVER',
      entityId: driverId,
      diffJson: {
        before: {
          assignedBusId: currentDriver.assignedBusId,
          assignedBusNumber: currentDriver.assignedBusNumber,
        },
        after: {
          assignedBusId: updatedDriver.assignedBusId,
          assignedBusNumber: updatedDriver.assignedBusNumber,
        },
      },
      ipAddress,
    });

    logger.info('Driver bus assignment updated', {
      schoolId,
      driverId,
      assignedBusId: updatedDriver.assignedBusId,
      assignedBusNumber: updatedDriver.assignedBusNumber,
      updatedBy: userId,
    });

    return updatedDriver;
  }

  /**
   * Retrieves paginated trip history operated by a driver
   */
  public static async getDriverTripHistory(
    schoolId: string,
    driverId: string,
    limit = 50,
    offset = 0
  ): Promise<DriverTripHistoryItem[]> {
    // Verify driver belongs to school tenant
    await this.getDriverById(schoolId, driverId);

    const sql = `
      SELECT 
        t.id,
        t.school_id AS "schoolId",
        t.route_id AS "routeId",
        r.name AS "routeName",
        r.code AS "routeCode",
        r.route_type AS "routeType",
        t.bus_id AS "busId",
        b.bus_number AS "busNumber",
        b.registration_number AS "busRegistrationNumber",
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
      JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
      LEFT JOIN (
        SELECT trip_id, COUNT(DISTINCT student_id) AS boarded_count
        FROM boarding_events
        WHERE status = 'BOARDED'
        GROUP BY trip_id
      ) b_count ON b_count.trip_id = t.id
      WHERE t.driver_id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
      ORDER BY t.scheduled_date DESC, t.scheduled_start_time DESC
      LIMIT $3 OFFSET $4
    `;

    const rows = await query<any>(sql, [driverId, schoolId, limit, offset]);

    return rows.map((r) => ({
      id: r.id,
      schoolId: r.schoolId,
      routeId: r.routeId,
      routeName: r.routeName,
      routeCode: r.routeCode,
      routeType: r.routeType,
      busId: r.busId,
      busNumber: r.busNumber,
      busRegistrationNumber: r.busRegistrationNumber,
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
   * Retrieves combined safety incident and emergency SOS alert history for a driver
   */
  public static async getDriverIncidentHistory(
    schoolId: string,
    driverId: string,
    limit = 50,
    offset = 0
  ): Promise<DriverIncidentHistoryItem[]> {
    // Verify driver belongs to school tenant
    await this.getDriverById(schoolId, driverId);

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
          b.bus_number AS "busNumber",
          b.registration_number AS "busRegistrationNumber",
          r.name AS "routeName",
          i.latitude,
          i.longitude,
          i.reported_by AS "reportedBy",
          NULL::text AS "acknowledgedAt",
          i.resolved_at AS "resolvedAt",
          NULL::text AS "resolutionNotes",
          i.created_at AS "createdAt"
        FROM incidents i
        LEFT JOIN buses b ON i.bus_id = b.id
        LEFT JOIN trips t ON i.trip_id = t.id
        LEFT JOIN routes r ON t.route_id = r.id
        WHERE i.driver_id = $1 AND i.school_id = $2

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
          b.bus_number AS "busNumber",
          b.registration_number AS "busRegistrationNumber",
          r.name AS "routeName",
          s.latitude,
          s.longitude,
          'DRIVER' AS "reportedBy",
          s.acknowledged_at::text AS "acknowledgedAt",
          s.resolved_at AS "resolvedAt",
          s.resolution_notes AS "resolutionNotes",
          s.created_at AS "createdAt"
        FROM sos_events s
        LEFT JOIN buses b ON s.bus_id = b.id
        LEFT JOIN trips t ON s.trip_id = t.id
        LEFT JOIN routes r ON t.route_id = r.id
        WHERE s.driver_id = $1 AND s.school_id = $2
      ) events
      ORDER BY "createdAt" DESC
      LIMIT $3 OFFSET $4
    `;

    const rows = await query<any>(sql, [driverId, schoolId, limit, offset]);

    return rows.map((r) => ({
      id: r.id,
      schoolId: r.schoolId,
      tripId: r.tripId,
      category: r.category as 'INCIDENT' | 'SOS',
      type: r.type,
      severity: r.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
      status: r.status,
      description: r.description,
      busNumber: r.busNumber,
      busRegistrationNumber: r.busRegistrationNumber,
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
   * Retrieves student boarding and drop attendance history and trip summaries for a driver
   */
  public static async getDriverAttendanceHistory(
    schoolId: string,
    driverId: string,
    limit = 50
  ): Promise<DriverAttendanceHistoryResponse> {
    // Verify driver belongs to school tenant
    await this.getDriverById(schoolId, driverId);

    // 1. Trip Summaries
    const summarySql = `
      SELECT 
        t.id AS "tripId",
        TO_CHAR(t.scheduled_date, 'YYYY-MM-DD') AS "scheduledDate",
        r.name AS "routeName",
        r.code AS "routeCode",
        r.route_type AS "shiftType",
        b.bus_number AS "busNumber",
        b.registration_number AS "busRegistrationNumber",
        COUNT(DISTINCT b_ev.id) FILTER (WHERE b_ev.status = 'BOARDED')::int AS "totalBoarded",
        COUNT(DISTINCT b_ev.id) FILTER (WHERE b_ev.status = 'ABSENT')::int AS "totalAbsent",
        COUNT(DISTINCT dr.id) FILTER (WHERE dr.status = 'DEBOARDED')::int AS "totalDeboarded",
        (COUNT(DISTINCT b_ev.id) + COUNT(DISTINCT dr.id))::int AS "totalEvents"
      FROM trips t
      JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
      JOIN buses b ON t.bus_id = b.id AND b.deleted_at IS NULL
      LEFT JOIN boarding_events b_ev ON b_ev.trip_id = t.id
      LEFT JOIN drop_events dr ON dr.trip_id = t.id
      WHERE t.driver_id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
      GROUP BY t.id, t.scheduled_date, r.name, r.code, r.route_type, b.bus_number, b.registration_number
      ORDER BY t.scheduled_date DESC, t.scheduled_start_time DESC
      LIMIT $3
    `;
    const summaryRows = await query<any>(summarySql, [driverId, schoolId, limit]);

    const summaries: DriverAttendanceSummaryItem[] = summaryRows.map((s) => ({
      tripId: s.tripId,
      scheduledDate: s.scheduledDate,
      routeName: s.routeName,
      routeCode: s.routeCode,
      shiftType: s.shiftType,
      busNumber: s.busNumber,
      busRegistrationNumber: s.busRegistrationNumber,
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
          bus.bus_number AS "busNumber",
          'BOARDING' AS "eventType",
          b.status,
          b.marked_by AS "markedBy",
          b.recorded_at AS "recordedAt"
        FROM boarding_events b
        JOIN trips t ON b.trip_id = t.id
        JOIN buses bus ON t.bus_id = bus.id
        JOIN students s ON b.student_id = s.id
        JOIN pickup_locations p ON b.stop_id = p.id
        WHERE t.driver_id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL

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
          bus.bus_number AS "busNumber",
          'DROP' AS "eventType",
          dr.status,
          dr.marked_by AS "markedBy",
          dr.recorded_at AS "recordedAt"
        FROM drop_events dr
        JOIN trips t ON dr.trip_id = t.id
        JOIN buses bus ON t.bus_id = bus.id
        JOIN students s ON dr.student_id = s.id
        JOIN pickup_locations p ON dr.stop_id = p.id
        WHERE t.driver_id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
      ) records
      ORDER BY "recordedAt" DESC
      LIMIT 50
    `;
    const recordRows = await query<any>(recordsSql, [driverId, schoolId]);

    const recentRecords: DriverAttendanceRecordItem[] = recordRows.map((r) => ({
      id: r.id,
      tripId: r.tripId,
      scheduledDate: r.scheduledDate,
      studentId: r.studentId,
      studentName: r.studentName,
      admissionNumber: r.admissionNumber,
      classGrade: r.classGrade,
      section: r.section,
      stopName: r.stopName,
      busNumber: r.busNumber,
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
   * Retrieves consolidated driver history (Driver Profile, Trips, Incidents, Attendance)
   */
  public static async getDriverFullHistory(
    schoolId: string,
    driverId: string
  ): Promise<DriverFullHistoryResponse> {
    const [driver, trips, incidents, attendance] = await Promise.all([
      this.getDriverById(schoolId, driverId),
      this.getDriverTripHistory(schoolId, driverId, 30),
      this.getDriverIncidentHistory(schoolId, driverId, 30),
      this.getDriverAttendanceHistory(schoolId, driverId, 30),
    ]);

    return {
      driver,
      trips,
      incidents,
      attendance,
    };
  }

  /**
   * Updates driver profile details with duplicate phone validation and audit logging
   */
  public static async updateDriver(
    schoolId: string,
    driverId: string,
    payload: UpdateDriverRequest,
    userId?: string,
    ipAddress?: string
  ): Promise<DriverWithBus> {
    const current = await this.getDriverById(schoolId, driverId);

    let normalizedPhone = current.phone;
    if (payload.phone) {
      normalizedPhone = normalizeIndianPhoneNumber(payload.phone);
      if (normalizedPhone !== current.phone) {
        const existing = await query<{ id: string }>(
          `SELECT id FROM drivers 
           WHERE school_id = $1 AND phone = $2 AND id != $3 AND deleted_at IS NULL`,
          [schoolId, normalizedPhone, driverId]
        );
        if (existing.length > 0) {
          throw new ConflictError(
            `Another driver in your school is already registered with mobile number "${normalizedPhone}".`
          );
        }
      }
    }

    const cleanName = payload.fullName !== undefined ? payload.fullName.trim() : current.fullName;
    const cleanLicense = payload.licenseNumber !== undefined ? payload.licenseNumber.trim().toUpperCase() : current.licenseNumber;
    const cleanExpiry = payload.licenseExpiry !== undefined ? (payload.licenseExpiry?.trim() || null) : current.licenseExpiry;
    const cleanPhoto = payload.photoUrl !== undefined ? (payload.photoUrl?.trim() || null) : current.photoUrl;

    // Validate assigned bus if provided
    if (payload.assignedBusId !== undefined && payload.assignedBusId !== null) {
      const busExists = await query<{ id: string }>(
        `SELECT id FROM buses WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
        [payload.assignedBusId, schoolId]
      );
      if (busExists.length === 0) {
        throw new BadRequestError('Selected fleet vehicle does not exist or belongs to another school.');
      }
    }

    // Execute atomic update
    await DbService.withTransaction(async (client) => {
      await client.query(
        `UPDATE drivers 
         SET full_name = $1, phone = $2, license_number = $3, license_expiry = $4, photo_url = $5, updated_at = NOW() 
         WHERE school_id = $6 AND id = $7 AND deleted_at IS NULL`,
        [cleanName, normalizedPhone, cleanLicense, cleanExpiry, cleanPhoto, schoolId, driverId]
      );

      // If assignedBusId was specified in payload
      if (payload.assignedBusId !== undefined) {
        // Unbind any previous bus
        await client.query(
          `UPDATE buses 
           SET default_driver_id = NULL, updated_at = NOW() 
           WHERE school_id = $1 AND default_driver_id = $2 AND ($3::uuid IS NULL OR id != $3) AND deleted_at IS NULL`,
          [schoolId, driverId, payload.assignedBusId || null]
        );

        if (payload.assignedBusId) {
          await client.query(
            `UPDATE buses 
             SET default_driver_id = $1, updated_at = NOW() 
             WHERE id = $2 AND school_id = $3 AND deleted_at IS NULL`,
            [driverId, payload.assignedBusId, schoolId]
          );
        }
      }
    });

    const updated = await this.getDriverById(schoolId, driverId);

    // Audit Logging
    await AuditService.logAction({
      schoolId,
      userId: userId || null,
      userRole: 'SCHOOL_ADMIN',
      action: 'DRIVER_UPDATED',
      entityType: 'DRIVER',
      entityId: driverId,
      diffJson: {
        before: {
          fullName: current.fullName,
          phone: current.phone,
          licenseNumber: current.licenseNumber,
          licenseExpiry: current.licenseExpiry,
          photoUrl: current.photoUrl,
          assignedBusId: current.assignedBusId,
        },
        after: {
          fullName: updated.fullName,
          phone: updated.phone,
          licenseNumber: updated.licenseNumber,
          licenseExpiry: updated.licenseExpiry,
          photoUrl: updated.photoUrl,
          assignedBusId: updated.assignedBusId,
        },
      },
      ipAddress,
    });

    logger.info('Driver profile updated successfully', {
      schoolId,
      driverId,
      fullName: updated.fullName,
      updatedBy: userId,
    });

    return updated;
  }

  /**
   * Resets Driver mobile app login PIN with bcrypt hash and audit logging
   */
  public static async resetDriverPin(
    schoolId: string,
    driverId: string,
    pin: string,
    userId?: string,
    ipAddress?: string
  ): Promise<void> {
    await this.getDriverById(schoolId, driverId);

    if (!pin || !/^\d{4,6}$/.test(pin.trim())) {
      throw new BadRequestError('Driver login PIN must be between 4 and 6 digits.');
    }

    const pinHash = await bcrypt.hash(pin.trim(), 10);

    await query(
      `UPDATE drivers 
       SET pin_hash = $1, updated_at = NOW() 
       WHERE school_id = $2 AND id = $3 AND deleted_at IS NULL`,
      [pinHash, schoolId, driverId]
    );

    // Security Audit Log
    await AuditService.logAction({
      schoolId,
      userId: userId || null,
      userRole: 'SCHOOL_ADMIN',
      action: 'DRIVER_PIN_RESET',
      entityType: 'DRIVER',
      entityId: driverId,
      diffJson: { pinReset: true },
      ipAddress,
    });

    logger.info('Driver login PIN reset successfully', {
      schoolId,
      driverId,
      resetBy: userId,
    });
  }

  /**
   * Revokes driver mobile app sessions / forces logout
   */
  public static async revokeDriverSessions(
    schoolId: string,
    driverId: string,
    userId?: string,
    ipAddress?: string
  ): Promise<void> {
    await this.getDriverById(schoolId, driverId);

    await query(
      `UPDATE drivers 
       SET updated_at = NOW() 
       WHERE school_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [schoolId, driverId]
    );

    // Security Audit Log
    await AuditService.logAction({
      schoolId,
      userId: userId || null,
      userRole: 'SCHOOL_ADMIN',
      action: 'DRIVER_SESSIONS_REVOKED',
      entityType: 'DRIVER',
      entityId: driverId,
      diffJson: { sessionsRevoked: true },
      ipAddress,
    });

    logger.info('Driver sessions revoked', {
      schoolId,
      driverId,
      revokedBy: userId,
    });
  }

  /**
   * Soft-deletes a driver profile and unbinds from assigned buses
   */
  public static async removeDriver(
    schoolId: string,
    driverId: string,
    userId?: string,
    ipAddress?: string
  ): Promise<void> {
    const current = await this.getDriverById(schoolId, driverId);

    await DbService.withTransaction(async (client) => {
      // Unbind driver from any bus
      await client.query(
        `UPDATE buses 
         SET default_driver_id = NULL, updated_at = NOW() 
         WHERE school_id = $1 AND default_driver_id = $2 AND deleted_at IS NULL`,
        [schoolId, driverId]
      );

      // Soft-delete driver record
      await client.query(
        `UPDATE drivers 
         SET deleted_at = NOW(), updated_at = NOW() 
         WHERE school_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [schoolId, driverId]
      );
    });

    // Security Audit Log
    await AuditService.logAction({
      schoolId,
      userId: userId || null,
      userRole: 'SCHOOL_ADMIN',
      action: 'DRIVER_DELETED',
      entityType: 'DRIVER',
      entityId: driverId,
      diffJson: {
        deletedDriver: {
          fullName: current.fullName,
          phone: current.phone,
          licenseNumber: current.licenseNumber,
        },
      },
      ipAddress,
    });

    logger.info('Driver profile removed successfully', {
      schoolId,
      driverId,
      fullName: current.fullName,
      deletedBy: userId,
    });
  }
}


