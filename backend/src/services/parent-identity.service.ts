import crypto from 'crypto';
import { query } from '../config/database.js';
import { env } from '../config/env.js';
import {
  ParentIdentityRecord,
  ParentTrackingTokenData,
  ParentLiveTrackingSession,
  ParentRecordWithStudent,
  ParentAssignmentDetails,
  ParentCommunicationItem,
  SendParentNoticeRequest,
  normalizeIndianPhoneNumber,
  TripStatus,
  RouteType,
} from '@school-bus/shared';
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../middlewares/error.middleware.js';
import { logger } from './logger.service.js';
import { AuditService } from './audit.service.js';

export interface CreateTokenParams {
  parentId: string;
  studentId: string;
  schoolId: string;
  tripId?: string | null;
  ttlHours?: number;
  purpose?: string;
}

export class ParentIdentityService {
  /**
   * Hashes a raw tracking token using SHA-256 for secure DB lookup
   */
  public static hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
  }

  /**
   * Generates a cryptographically strong, URL-safe tracking token
   * Format: trk_<base64url 32 bytes>
   */
  public static generateSecureToken(): string {
    const randomBuffer = crypto.randomBytes(24);
    return `trk_${randomBuffer.toString('base64url')}`;
  }

  /**
   * Constructs the full public tracking URL for a given raw token
   */
  public static generateTrackingUrl(rawToken: string, baseUrl?: string): string {
    const root = (baseUrl || env.PARENT_TRACKING_BASE_URL).replace(/\/+$/, '');
    return `${root}/${encodeURIComponent(rawToken.trim())}`;
  }

  /**
   * Resolves parent identities and linked student(s) from a WhatsApp phone number
   */
  public static async lookupParentsByPhone(
    phone: string,
    schoolId?: string
  ): Promise<ParentIdentityRecord[]> {
    const normalizedPhone = normalizeIndianPhoneNumber(phone);

    const queryParams: any[] = [normalizedPhone];
    let schoolFilter = '';

    if (schoolId) {
      queryParams.push(schoolId);
      schoolFilter = ` AND p.school_id = $2`;
    }

    const sql = `
      SELECT 
        p.id AS parent_id,
        p.school_id,
        p.student_id,
        p.full_name AS parent_name,
        p.relationship,
        p.phone AS parent_phone,
        p.email AS parent_email,
        s.id AS s_id,
        s.full_name AS student_name,
        s.admission_number,
        s.class_grade,
        s.section,
        s.roll_number,
        s.emergency_contact_phone,
        sch.name AS school_name,
        sch.code AS school_code,
        sch.city AS school_city,
        sch.timezone AS school_timezone,
        pl.id AS stop_id,
        pl.stop_name,
        pl.sequence_order,
        pl.scheduled_time,
        ST_Y(pl.location::geometry) AS stop_latitude,
        ST_X(pl.location::geometry) AS stop_longitude,
        pl.geofence_radius_meters
      FROM parents p
      JOIN students s ON p.student_id = s.id AND s.deleted_at IS NULL
      JOIN schools sch ON p.school_id = sch.id AND sch.deleted_at IS NULL
      LEFT JOIN student_stop_assignments ssa ON s.id = ssa.student_id AND ssa.deleted_at IS NULL
      LEFT JOIN pickup_locations pl ON ssa.pickup_stop_id = pl.id AND pl.deleted_at IS NULL
      WHERE p.phone = $1
        AND p.deleted_at IS NULL
        ${schoolFilter}
      ORDER BY s.full_name ASC
    `;

    const rows = await query<any>(sql, queryParams);

    return rows.map((row) => ({
      id: row.parent_id,
      schoolId: row.school_id,
      studentId: row.student_id,
      fullName: row.parent_name,
      relationship: row.relationship,
      phone: row.parent_phone,
      email: row.parent_email,
      student: {
        id: row.s_id,
        schoolId: row.school_id,
        fullName: row.student_name,
        admissionNumber: row.admission_number,
        classGrade: row.class_grade,
        section: row.section,
        rollNumber: row.roll_number,
        emergencyContactPhone: row.emergency_contact_phone,
      },
      school: {
        id: row.school_id,
        name: row.school_name,
        code: row.school_code,
        city: row.school_city,
        timezone: row.school_timezone,
      },
      pickupStop: row.stop_id
        ? {
            id: row.stop_id,
            stopName: row.stop_name,
            sequenceOrder: row.sequence_order,
            scheduledTime: row.scheduled_time,
            latitude: Number(row.stop_latitude),
            longitude: Number(row.stop_longitude),
            geofenceRadiusMeters: row.geofence_radius_meters,
          }
        : null,
    }));
  }

  /**
   * Generates and stores a new parent tracking token
   */
  public static async createTrackingToken(
    params: CreateTokenParams
  ): Promise<ParentTrackingTokenData> {
    const {
      parentId,
      studentId,
      schoolId,
      tripId = null,
      ttlHours = env.PARENT_TOKEN_TTL_HOURS,
      purpose = 'LIVE_TRACKING',
    } = params;

    // Verify parent & student relationship
    const parentRows = await query<any>(
      `SELECT id FROM parents WHERE id = $1 AND student_id = $2 AND school_id = $3 AND deleted_at IS NULL`,
      [parentId, studentId, schoolId]
    );

    if (parentRows.length === 0) {
      throw new ValidationError(
        'Invalid parent or student relationship for the specified school'
      );
    }

    const rawToken = this.generateSecureToken();
    const tokenHash = this.hashToken(rawToken);
    const tokenPrefix = rawToken.substring(0, 8);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    const insertSql = `
      INSERT INTO parent_tracking_tokens (
        school_id,
        parent_id,
        student_id,
        trip_id,
        token_hash,
        token_prefix,
        purpose,
        expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, expires_at, created_at
    `;

    const result = await query<{ id: string; expires_at: Date }>(insertSql, [
      schoolId,
      parentId,
      studentId,
      tripId,
      tokenHash,
      tokenPrefix,
      purpose,
      expiresAt.toISOString(),
    ]);

    const record = result[0];
    if (!record) {
      throw new Error('Failed to create parent tracking token');
    }

    const trackingUrl = this.generateTrackingUrl(rawToken);

    logger.info('Generated parent tracking token', {
      tokenId: record.id,
      parentId,
      studentId,
      expiresAt: expiresAt.toISOString(),
    });

    return {
      id: record.id,
      token: rawToken,
      trackingUrl,
      expiresAt: expiresAt.toISOString(),
      purpose,
      parentId,
      studentId,
      schoolId,
      tripId,
    };
  }

  /**
   * Validates a raw tracking token and retrieves full live session tracking details
   */
  public static async verifyTrackingToken(
    rawToken: string
  ): Promise<ParentLiveTrackingSession> {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new UnauthorizedError('Tracking token is missing');
    }

    const tokenHash = this.hashToken(rawToken);

    const tokenRows = await query<any>(
      `
      SELECT 
        ptt.id AS token_id,
        ptt.school_id,
        ptt.parent_id,
        ptt.student_id,
        ptt.trip_id,
        ptt.purpose,
        ptt.expires_at,
        ptt.revoked_at,
        ptt.deleted_at
      FROM parent_tracking_tokens ptt
      WHERE ptt.token_hash = $1
      `,
      [tokenHash]
    );

    if (tokenRows.length === 0 || tokenRows[0].deleted_at) {
      throw new UnauthorizedError('Invalid tracking link or link does not exist');
    }

    const token = tokenRows[0];

    // Check revocation
    if (token.revoked_at) {
      throw new UnauthorizedError('This live tracking link has been revoked for security');
    }

    // Check expiration
    const expiresAt = new Date(token.expires_at);
    if (expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError('This live tracking link has expired');
    }

    // Asynchronously update last_accessed_at and increment access count
    query(
      `
      UPDATE parent_tracking_tokens 
      SET last_accessed_at = NOW(), access_count = access_count + 1 
      WHERE id = $1
      `,
      [token.token_id]
    ).catch((err) => {
      logger.error('Failed to update tracking token access count', {
        tokenId: token.token_id,
        error: err.message,
      });
    });

    // Query parent, student, school, stop, and active trip metadata
    const detailsSql = `
      SELECT 
        p.id AS parent_id,
        p.full_name AS parent_name,
        p.relationship,
        p.phone AS parent_phone,
        s.id AS student_id,
        s.full_name AS student_name,
        s.admission_number,
        s.class_grade,
        s.section,
        s.roll_number,
        s.emergency_contact_phone,
        sch.id AS school_id,
        sch.name AS school_name,
        sch.code AS school_code,
        sch.timezone AS school_timezone,
        pl.id AS stop_id,
        pl.stop_name,
        pl.sequence_order,
        pl.scheduled_time,
        ST_Y(pl.location::geometry) AS stop_latitude,
        ST_X(pl.location::geometry) AS stop_longitude,
        pl.geofence_radius_meters
      FROM parents p
      JOIN students s ON p.student_id = s.id
      JOIN schools sch ON p.school_id = sch.id
      LEFT JOIN student_stop_assignments ssa ON s.id = ssa.student_id AND ssa.deleted_at IS NULL
      LEFT JOIN pickup_locations pl ON ssa.pickup_stop_id = pl.id AND pl.deleted_at IS NULL
      WHERE p.id = $1 AND s.id = $2 AND sch.id = $3
    `;

    const detailRows = await query<any>(detailsSql, [
      token.parent_id,
      token.student_id,
      token.school_id,
    ]);

    if (detailRows.length === 0) {
      throw new NotFoundError('Associated student or school records could not be found');
    }

    const row = detailRows[0];

    // Find active trip or token-scoped trip
    let activeTrip: ParentLiveTrackingSession['activeTrip'] = null;

    let tripQuery = `
      SELECT 
        t.id AS trip_id,
        t.route_id,
        t.status AS trip_status,
        t.delay_minutes,
        t.current_stop_sequence,
        r.name AS route_name,
        r.route_type,
        b.bus_number,
        b.registration_number,
        d.full_name AS driver_name,
        d.phone AS driver_phone
      FROM trips t
      JOIN routes r ON t.route_id = r.id
      JOIN buses b ON t.bus_id = b.id
      JOIN drivers d ON t.driver_id = d.id
      WHERE t.school_id = $1
    `;

    const tripParams: any[] = [token.school_id];

    if (token.trip_id) {
      tripQuery += ` AND t.id = $2`;
      tripParams.push(token.trip_id);
    } else if (row.stop_id) {
      // Find trip on the stop's route that is currently in-transit or scheduled today
      tripQuery += ` 
        AND t.route_id = (SELECT route_id FROM pickup_locations WHERE id = $2)
        AND t.status IN ('IN_TRANSIT', 'SCHEDULED', 'DELAYED')
        ORDER BY t.scheduled_start_time DESC
        LIMIT 1
      `;
      tripParams.push(row.stop_id);
    } else {
      tripQuery += `
        AND t.status = 'IN_TRANSIT'
        ORDER BY t.scheduled_start_time DESC
        LIMIT 1
      `;
    }

    const tripRows = await query<any>(tripQuery, tripParams);

    if (tripRows.length > 0) {
      const trip = tripRows[0];

      // Fetch latest GPS point for this trip
      const gpsRows = await query<any>(
        `
        SELECT 
          ST_Y(location::geometry) AS latitude,
          ST_X(location::geometry) AS longitude,
          speed_kmh,
          bearing_degrees,
          recorded_at
        FROM gps_locations
        WHERE trip_id = $1
        ORDER BY recorded_at DESC
        LIMIT 1
        `,
        [trip.trip_id]
      );

      const latestGps = gpsRows[0];

      activeTrip = {
        id: trip.trip_id,
        routeId: trip.route_id,
        routeName: trip.route_name,
        routeType: trip.route_type as RouteType,
        status: trip.trip_status as TripStatus,
        busNumber: trip.bus_number,
        registrationNumber: trip.registration_number,
        driverName: trip.driver_name,
        driverPhone: trip.driver_phone,
        delayMinutes: trip.delay_minutes || 0,
        currentStopSequence: trip.current_stop_sequence || 0,
        lastGpsLocation: latestGps
          ? {
              latitude: Number(latestGps.latitude),
              longitude: Number(latestGps.longitude),
              speedKmh: Number(latestGps.speed_kmh),
              bearingDegrees: latestGps.bearing_degrees ? Number(latestGps.bearing_degrees) : undefined,
              recordedAt: latestGps.recorded_at,
            }
          : null,
      };
    }

    return {
      isValid: true,
      expiresAt: expiresAt.toISOString(),
      parent: {
        id: row.parent_id,
        fullName: row.parent_name,
        relationship: row.relationship,
        phone: row.parent_phone,
      },
      student: {
        id: row.student_id,
        schoolId: row.school_id,
        fullName: row.student_name,
        admissionNumber: row.admission_number,
        classGrade: row.class_grade,
        section: row.section,
        rollNumber: row.roll_number,
        emergencyContactPhone: row.emergency_contact_phone,
      },
      school: {
        id: row.school_id,
        name: row.school_name,
        code: row.school_code,
        timezone: row.school_timezone,
      },
      pickupStop: row.stop_id
        ? {
            id: row.stop_id,
            stopName: row.stop_name,
            sequenceOrder: row.sequence_order,
            scheduledTime: row.scheduled_time,
            latitude: Number(row.stop_latitude),
            longitude: Number(row.stop_longitude),
            geofenceRadiusMeters: row.geofence_radius_meters,
          }
        : null,
      activeTrip,
    };
  }

  /**
   * Revokes a specific parent tracking token by raw token or UUID
   */
  public static async revokeToken(
    tokenOrId: string,
    reason?: string
  ): Promise<boolean> {
    if (!tokenOrId) return false;

    let sql: string;
    let param: string;

    if (tokenOrId.startsWith('trk_')) {
      sql = `
        UPDATE parent_tracking_tokens 
        SET revoked_at = NOW(), updated_at = NOW() 
        WHERE token_hash = $1 AND revoked_at IS NULL
        RETURNING id
      `;
      param = this.hashToken(tokenOrId);
    } else {
      sql = `
        UPDATE parent_tracking_tokens 
        SET revoked_at = NOW(), updated_at = NOW() 
        WHERE id = $1 AND revoked_at IS NULL
        RETURNING id
      `;
      param = tokenOrId;
    }

    const rows = await query<{ id: string }>(sql, [param]);
    const revoked = rows.length > 0;

    if (revoked && rows[0]) {
      logger.info('Parent tracking token revoked', {
        tokenId: rows[0].id,
        reason: reason || 'Manual revocation',
      });
    }

    return revoked;
  }

  /**
   * Revokes all active tracking tokens for a given student (e.g. on student status change)
   */
  public static async revokeAllTokensForStudent(
    studentId: string,
    schoolId: string,
    reason?: string
  ): Promise<number> {
    const sql = `
      UPDATE parent_tracking_tokens
      SET revoked_at = NOW(), updated_at = NOW()
      WHERE student_id = $1 AND school_id = $2 AND revoked_at IS NULL
      RETURNING id
    `;

    const rows = await query<{ id: string }>(sql, [studentId, schoolId]);
    logger.info(`Revoked ${rows.length} tracking tokens for student`, {
      studentId,
      schoolId,
      reason: reason || 'Student-wide revocation',
    });

    return rows.length;
  }

  /**
   * Revokes all active tracking tokens for a parent
   */
  public static async revokeAllTokensForParent(
    parentId: string,
    schoolId: string,
    reason?: string
  ): Promise<number> {
    const sql = `
      UPDATE parent_tracking_tokens
      SET revoked_at = NOW(), updated_at = NOW()
      WHERE parent_id = $1 AND school_id = $2 AND revoked_at IS NULL
      RETURNING id
    `;

    const rows = await query<{ id: string }>(sql, [parentId, schoolId]);
    logger.info(`Revoked ${rows.length} tracking tokens for parent`, {
      parentId,
      schoolId,
      reason: reason || 'Parent-wide revocation',
    });

    return rows.length;
  }

  /**
   * Retrieves all parents registered in a school with linked student details and WhatsApp tracking status
   */
  public static async getSchoolParents(
    schoolId: string,
    filters?: {
      search?: string;
      relationship?: string;
      whatsAppStatus?: string;
    }
  ): Promise<ParentRecordWithStudent[]> {
    let sql = `
      SELECT 
        p.id AS parent_id,
        p.school_id,
        p.student_id,
        p.full_name AS parent_name,
        p.relationship,
        p.phone AS parent_phone,
        p.email AS parent_email,
        p.created_at AS parent_created_at,
        p.updated_at AS parent_updated_at,
        s.id AS student_id,
        s.full_name AS student_name,
        s.admission_number,
        s.class_grade,
        s.section,
        s.roll_number,
        s.emergency_contact_phone,
        pl.stop_name AS pickup_stop_name,
        pl.scheduled_time::text AS pickup_scheduled_time,
        b.bus_number AS assigned_bus_number,
        r.code AS assigned_route_code,
        COALESCE(tok.active_token_count, 0)::int AS active_token_count,
        tok.last_token_created_at,
        tok.last_token_expires_at
      FROM parents p
      JOIN students s ON s.id = p.student_id AND s.deleted_at IS NULL
      LEFT JOIN student_stop_assignments ssa ON ssa.student_id = s.id
      LEFT JOIN pickup_locations pl ON pl.id = ssa.pickup_stop_id
      LEFT JOIN routes r ON r.id = pl.route_id
      LEFT JOIN buses b ON b.id = r.default_bus_id AND b.deleted_at IS NULL
      LEFT JOIN (
        SELECT 
          parent_id,
          COUNT(*)::int AS active_token_count,
          MAX(created_at) AS last_token_created_at,
          MAX(expires_at) AS last_token_expires_at
        FROM parent_tracking_tokens
        WHERE school_id = $1 
          AND revoked_at IS NULL 
          AND expires_at > NOW() 
          AND deleted_at IS NULL
        GROUP BY parent_id
      ) tok ON tok.parent_id = p.id
      WHERE p.school_id = $1 AND p.deleted_at IS NULL
    `;

    const params: any[] = [schoolId];
    let paramIndex = 2;

    if (filters?.relationship && filters.relationship.trim()) {
      sql += ` AND UPPER(p.relationship) = UPPER($${paramIndex})`;
      params.push(filters.relationship.trim());
      paramIndex++;
    }

    if (filters?.search && filters.search.trim()) {
      const searchPattern = `%${filters.search.trim().toLowerCase()}%`;
      sql += ` AND (
        LOWER(p.full_name) LIKE $${paramIndex} OR
        LOWER(p.phone) LIKE $${paramIndex} OR
        LOWER(COALESCE(p.email, '')) LIKE $${paramIndex} OR
        LOWER(s.full_name) LIKE $${paramIndex} OR
        LOWER(s.admission_number) LIKE $${paramIndex}
      )`;
      params.push(searchPattern);
      paramIndex++;
    }

    sql += ` ORDER BY p.full_name ASC, s.full_name ASC`;

    const rows = await query<any>(sql, params);

    const records: ParentRecordWithStudent[] = rows.map((r) => {
      const activeCount = Number(r.active_token_count) || 0;
      let whatsAppStatus: 'ACTIVE_TOKEN' | 'LINKED' | 'NOT_LINKED' = 'NOT_LINKED';

      if (activeCount > 0) {
        whatsAppStatus = 'ACTIVE_TOKEN';
      } else if (r.parent_phone && r.parent_phone.trim()) {
        whatsAppStatus = 'LINKED';
      }

      return {
        id: r.parent_id,
        schoolId: r.school_id,
        studentId: r.student_id,
        fullName: r.parent_name,
        relationship: r.relationship,
        phone: r.parent_phone,
        email: r.parent_email || null,
        createdAt: r.parent_created_at ? new Date(r.parent_created_at).toISOString() : undefined,
        updatedAt: r.parent_updated_at ? new Date(r.parent_updated_at).toISOString() : undefined,
        whatsAppStatus,
        activeTokenCount: activeCount,
        lastTokenCreatedAt: r.last_token_created_at ? new Date(r.last_token_created_at).toISOString() : null,
        lastTokenExpiresAt: r.last_token_expires_at ? new Date(r.last_token_expires_at).toISOString() : null,
        student: {
          id: r.student_id,
          fullName: r.student_name,
          admissionNumber: r.admission_number,
          classGrade: r.class_grade,
          section: r.section,
          rollNumber: r.roll_number,
          emergencyContactPhone: r.emergency_contact_phone,
          pickupStopName: r.pickup_stop_name || null,
          pickupScheduledTime: r.pickup_scheduled_time || null,
          assignedBusNumber: r.assigned_bus_number || null,
          assignedRouteCode: r.assigned_route_code || null,
        },
      };
    });

    if (filters?.whatsAppStatus && filters.whatsAppStatus.trim()) {
      const targetStatus = filters.whatsAppStatus.trim().toUpperCase();
      return records.filter((r) => r.whatsAppStatus === targetStatus);
    }

    return records;
  }

  /**
   * Fetches full assignment details for a parent, linked student, and allocated transport
   */
  public static async getParentAssignmentDetails(
    schoolId: string,
    parentId: string
  ): Promise<ParentAssignmentDetails> {
    const sql = `
      SELECT 
        p.id AS parent_id,
        p.school_id,
        p.student_id,
        p.full_name AS parent_name,
        p.relationship,
        p.phone AS parent_phone,
        p.email AS parent_email,
        p.created_at AS parent_created_at,
        p.updated_at AS parent_updated_at,
        s.id AS student_id,
        s.full_name AS student_name,
        s.admission_number,
        s.class_grade,
        s.section,
        s.roll_number,
        s.emergency_contact_phone,
        b.id AS bus_id,
        b.bus_number,
        b.registration_number,
        r.id AS route_id,
        r.name AS route_name,
        r.code AS route_code,
        pl_pick.id AS pickup_stop_id,
        pl_pick.stop_name AS pickup_stop_name,
        pl_pick.scheduled_time AS pickup_scheduled_time,
        ST_Y(pl_pick.location::geometry) AS pickup_latitude,
        ST_X(pl_pick.location::geometry) AS pickup_longitude,
        pl_drop.id AS drop_stop_id,
        pl_drop.stop_name AS drop_stop_name,
        pl_drop.scheduled_time AS drop_scheduled_time,
        ptt.id AS token_id,
        ptt.token_prefix,
        ptt.expires_at AS token_expires_at,
        ptt.access_count AS token_access_count,
        ptt.last_accessed_at AS token_last_accessed_at,
        ptt.revoked_at AS token_revoked_at
      FROM parents p
      JOIN students s ON p.student_id = s.id AND s.deleted_at IS NULL
      LEFT JOIN student_stop_assignments ssa ON s.id = ssa.student_id AND ssa.deleted_at IS NULL
      LEFT JOIN pickup_locations pl_pick ON ssa.pickup_stop_id = pl_pick.id AND pl_pick.deleted_at IS NULL
      LEFT JOIN pickup_locations pl_drop ON ssa.drop_stop_id = pl_drop.id AND pl_drop.deleted_at IS NULL
      LEFT JOIN routes r ON (pl_pick.route_id = r.id OR pl_drop.route_id = r.id) AND r.deleted_at IS NULL
      LEFT JOIN buses b ON r.default_bus_id = b.id AND b.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT id, token_prefix, expires_at, access_count, last_accessed_at, revoked_at
        FROM parent_tracking_tokens
        WHERE parent_id = p.id AND student_id = s.id AND deleted_at IS NULL
        ORDER BY (revoked_at IS NULL AND expires_at > NOW()) DESC, created_at DESC
        LIMIT 1
      ) ptt ON true
      WHERE p.id = $1 AND p.school_id = $2
    `;

    const rows = await query<any>(sql, [parentId, schoolId]);

    if (rows.length === 0) {
      throw new NotFoundError('Parent record not found or not registered under this school');
    }

    const r = rows[0];

    const hasActiveToken =
      r.token_id &&
      !r.token_revoked_at &&
      new Date(r.token_expires_at).getTime() > Date.now();

    let whatsAppStatus: 'ACTIVE_TOKEN' | 'LINKED' | 'NOT_LINKED' = 'NOT_LINKED';
    if (hasActiveToken) {
      whatsAppStatus = 'ACTIVE_TOKEN';
    } else if (r.parent_phone && r.parent_phone.trim()) {
      whatsAppStatus = 'LINKED';
    }

    return {
      parent: {
        id: r.parent_id,
        schoolId: r.school_id,
        studentId: r.student_id,
        fullName: r.parent_name,
        relationship: r.relationship,
        phone: r.parent_phone,
        email: r.parent_email || null,
        createdAt: r.parent_created_at ? new Date(r.parent_created_at).toISOString() : undefined,
        updatedAt: r.parent_updated_at ? new Date(r.parent_updated_at).toISOString() : undefined,
        whatsAppStatus,
      },
      student: {
        id: r.student_id,
        fullName: r.student_name,
        admissionNumber: r.admission_number,
        classGrade: r.class_grade,
        section: r.section,
        rollNumber: r.roll_number || null,
        emergencyContactPhone: r.emergency_contact_phone || null,
      },
      transport: {
        busId: r.bus_id || null,
        busNumber: r.bus_number || null,
        registrationNumber: r.registration_number || null,
        routeId: r.route_id || null,
        routeName: r.route_name || null,
        routeCode: r.route_code || null,
        pickupStopId: r.pickup_stop_id || null,
        pickupStopName: r.pickup_stop_name || null,
        pickupScheduledTime: r.pickup_scheduled_time || null,
        pickupLatitude: r.pickup_latitude ? parseFloat(r.pickup_latitude) : null,
        pickupLongitude: r.pickup_longitude ? parseFloat(r.pickup_longitude) : null,
        dropStopId: r.drop_stop_id || null,
        dropStopName: r.drop_stop_name || null,
        dropScheduledTime: r.drop_scheduled_time || null,
      },
      activeTrackingToken: r.token_id
        ? {
            id: r.token_id,
            tokenPrefix: r.token_prefix,
            expiresAt: new Date(r.token_expires_at).toISOString(),
            accessCount: Number(r.token_access_count) || 0,
            lastAccessedAt: r.token_last_accessed_at
              ? new Date(r.token_last_accessed_at).toISOString()
              : null,
            isRevoked: Boolean(r.token_revoked_at),
          }
        : null,
    };
  }

  /**
   * Re-links a parent to another authorized student in the same school
   */
  public static async relinkParentStudent(
    schoolId: string,
    parentId: string,
    newStudentId: string,
    adminUserId?: string | null
  ): Promise<ParentAssignmentDetails> {
    const parentCheck = await query<any>(
      `SELECT id, student_id, full_name, phone FROM parents WHERE id = $1 AND school_id = $2`,
      [parentId, schoolId]
    );

    if (parentCheck.length === 0) {
      throw new NotFoundError('Parent record not found');
    }

    const currentParent = parentCheck[0];

    const studentCheck = await query<any>(
      `SELECT id, full_name, admission_number FROM students WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL`,
      [newStudentId, schoolId]
    );

    if (studentCheck.length === 0) {
      throw new NotFoundError('Target student not found in this school roster');
    }

    const targetStudent = studentCheck[0];

    if (currentParent.student_id !== newStudentId) {
      // Revoke any active tracking tokens for previous pairing
      await query(
        `UPDATE parent_tracking_tokens
         SET revoked_at = NOW(), updated_at = NOW()
         WHERE parent_id = $1 AND student_id = $2 AND revoked_at IS NULL AND deleted_at IS NULL`,
        [parentId, currentParent.student_id]
      );

      // Update parent link
      await query(
        `UPDATE parents SET student_id = $1, updated_at = NOW() WHERE id = $2 AND school_id = $3`,
        [newStudentId, parentId, schoolId]
      );

      // Record audit log
      await AuditService.logAction({
        schoolId,
        userId: adminUserId,
        action: 'PARENT_STUDENT_RELINKED',
        entityType: 'PARENT',
        entityId: parentId,
        diffJson: {
          previousStudentId: currentParent.student_id,
          newStudentId,
          targetStudentName: targetStudent.full_name,
          admissionNumber: targetStudent.admission_number,
        },
      });

      logger.info('Parent student link updated', {
        parentId,
        previousStudentId: currentParent.student_id,
        newStudentId,
        schoolId,
      });
    }

    return this.getParentAssignmentDetails(schoolId, parentId);
  }

  /**
   * Retrieves unified communication history (WhatsApp/SMS notifications + tracking token events)
   */
  public static async getParentCommunicationHistory(
    schoolId: string,
    parentId: string
  ): Promise<ParentCommunicationItem[]> {
    const parentRows = await query<any>(
      `SELECT id, student_id, phone, full_name FROM parents WHERE id = $1 AND school_id = $2`,
      [parentId, schoolId]
    );

    if (parentRows.length === 0) {
      throw new NotFoundError('Parent record not found');
    }

    const parent = parentRows[0];
    const items: ParentCommunicationItem[] = [];

    if (parent.phone && parent.phone.trim()) {
      const cleanDigits = parent.phone.replace(/[^0-9]/g, '');
      const last10 = cleanDigits.slice(-10);

      const notifSql = `
        SELECT 
          id,
          channel,
          template_name,
          message_body,
          status,
          recipient_phone,
          failure_reason,
          created_at
        FROM notifications
        WHERE school_id = $1 AND (
          recipient_phone = $2 OR
          recipient_phone LIKE $3
        )
        ORDER BY created_at DESC
        LIMIT 50
      `;

      const notifRows = await query<any>(notifSql, [
        schoolId,
        parent.phone,
        `%${last10}`,
      ]);

      const formatTitle = (tpl?: string | null) => {
        if (!tpl) return 'WhatsApp Notice';
        switch (tpl.toUpperCase()) {
          case 'WELCOME_ONBOARDING':
            return 'Welcome & Onboarding Invite';
          case 'LIVE_TRACKING_INVITE':
            return 'Live Tracking Link Dispatched';
          case 'TRIP_STARTED':
            return 'Trip Commenced Alert';
          case 'DELAY_ALERT':
            return 'Route Delay Advisory';
          case 'STUDENT_BOARDED':
            return 'Student Boarded Bus';
          case 'STUDENT_DEBOARDED':
            return 'Student Deboarded Bus';
          case 'EMERGENCY_SOS':
            return 'Emergency Transport Alert';
          default:
            return tpl.replace(/_/g, ' ');
        }
      };

      for (const row of notifRows) {
        items.push({
          id: row.id,
          type: 'NOTIFICATION',
          channel: (row.channel as any) || 'WHATSAPP',
          title: formatTitle(row.template_name),
          templateName: row.template_name || null,
          messageBody: row.message_body,
          status: (row.status as any) || 'SENT',
          recipientPhone: row.recipient_phone,
          createdAt: new Date(row.created_at).toISOString(),
          failureReason: row.failure_reason || null,
        });
      }
    }

    // Token audit events
    const tokenSql = `
      SELECT 
        id,
        purpose,
        token_prefix,
        expires_at,
        revoked_at,
        access_count,
        last_accessed_at,
        created_at
      FROM parent_tracking_tokens
      WHERE parent_id = $1 AND school_id = $2 AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 20
    `;

    const tokenRows = await query<any>(tokenSql, [parentId, schoolId]);

    for (const row of tokenRows) {
      const isRevoked = Boolean(row.revoked_at);
      const isExpired = new Date(row.expires_at).getTime() <= Date.now();
      const status: ParentCommunicationItem['status'] = isRevoked
        ? 'REVOKED'
        : isExpired
          ? 'FAILED'
          : 'ACTIVE';

      const expiryStr = new Date(row.expires_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

      items.push({
        id: `token-${row.id}`,
        type: 'TOKEN_EVENT',
        channel: 'SYSTEM',
        title: isRevoked ? 'Live Tracking Link Revoked' : 'Live Tracking Link Generated',
        templateName: row.purpose,
        messageBody: isRevoked
          ? `Token prefix ${row.token_prefix}... was revoked. Total parent views: ${row.access_count}.`
          : `Token prefix ${row.token_prefix}... generated. Valid until ${expiryStr}. Views so far: ${row.access_count}.`,
        status,
        recipientPhone: parent.phone || '',
        createdAt: new Date(row.created_at).toISOString(),
      });
    }

    // Sort combined chronological desc
    return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Logs and dispatches an outbound notice / message to parent's WhatsApp phone
   */
  public static async sendParentNotice(
    schoolId: string,
    parentId: string,
    payload: SendParentNoticeRequest
  ): Promise<ParentCommunicationItem> {
    const parentRows = await query<any>(
      `SELECT id, student_id, phone, full_name FROM parents WHERE id = $1 AND school_id = $2`,
      [parentId, schoolId]
    );

    if (parentRows.length === 0) {
      throw new NotFoundError('Parent record not found');
    }

    const parent = parentRows[0];
    if (!parent.phone || !parent.phone.trim()) {
      throw new ValidationError('Cannot dispatch notification: parent has no registered mobile number');
    }

    const channel = payload.channel || 'WHATSAPP';
    const templateName = payload.templateName || 'MANUAL_NOTICE';
    const messageBody = payload.messageBody.trim();

    const insertSql = `
      INSERT INTO notifications (
        school_id,
        recipient_phone,
        recipient_role,
        channel,
        template_name,
        message_body,
        status,
        provider_message_id,
        created_at
      ) VALUES ($1, $2, 'PARENT', $3, $4, $5, 'SENT', $6, NOW())
      RETURNING id, created_at, status
    `;

    const mockProviderId = `wa_msg_${crypto.randomUUID().slice(0, 12)}`;
    const inserted = await query<any>(insertSql, [
      schoolId,
      parent.phone,
      channel,
      templateName,
      messageBody,
      mockProviderId,
    ]);

    const row = inserted[0];

    logger.info('Outbound parent notice dispatched', {
      schoolId,
      parentId,
      phone: parent.phone,
      channel,
      templateName,
    });

    return {
      id: row.id,
      type: 'NOTIFICATION',
      channel: channel as any,
      title: templateName.replace(/_/g, ' '),
      templateName,
      messageBody,
      status: 'SENT',
      recipientPhone: parent.phone,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }
}


