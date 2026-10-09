import crypto from 'crypto';
import { query } from '../config/database.js';
import { env } from '../config/env.js';
import {
  ParentIdentityRecord,
  ParentTrackingTokenData,
  ParentLiveTrackingSession,
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
}
