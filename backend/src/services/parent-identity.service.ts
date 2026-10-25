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
  ParentOnboardInviteResponse,
  ParentOnboardVerificationResponse,
  ParentOnboardConfirmResponse,
  ParentNotificationStatusResponse,
  UpdateParentNotificationPreferences,
  UpdateNotificationStatusRequest,
  ParentNotificationHistoryItem,
  TokenAccessLogItem,
  normalizeIndianPhoneNumber,
  TripStatus,
  RouteType,
  ParentPickupEta,
  ParentLiveWebSecureEntryResponse,
} from '@school-bus/shared';
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../middlewares/error.middleware.js';
import { logger } from './logger.service.js';
import { AuditService } from './audit.service.js';
import { EtaService } from './eta.service.js';

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
      throw new UnauthorizedError('Tracking token is missing', { reason: 'TOKEN_MISSING' });
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
      throw new UnauthorizedError('Invalid tracking link or link does not exist', { reason: 'TOKEN_INVALID' });
    }

    const token = tokenRows[0];

    // Check revocation
    if (token.revoked_at) {
      throw new UnauthorizedError('This live tracking link has been revoked for security', {
        reason: 'TOKEN_REVOKED',
        revokedAt: token.revoked_at,
      });
    }

    // Check expiration
    const expiresAt = new Date(token.expires_at);
    if (expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError('This live tracking link has expired', {
        reason: 'TOKEN_EXPIRED',
        expiresAt: token.expires_at,
      });
    }

    // Asynchronously log access activity and increment access count
    this.recordTokenAccess(
      token.token_id,
      token.parent_id,
      token.student_id,
      token.school_id
    ).catch(() => {});

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
        r.code AS route_code,
        r.route_type,
        (SELECT COUNT(*)::int FROM pickup_locations WHERE route_id = t.route_id AND deleted_at IS NULL) AS total_stops,
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
        AND t.status IN ('IN_TRANSIT', 'SCHEDULED', 'DELAYED', 'ARRIVED_SCHOOL')
        ORDER BY t.scheduled_start_time DESC
        LIMIT 1
      `;
      tripParams.push(row.stop_id);
    } else {
      tripQuery += ` 
        AND t.status IN ('IN_TRANSIT', 'DELAYED', 'ARRIVED_SCHOOL')
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
        routeCode: trip.route_code || null,
        totalStops: trip.total_stops != null ? Number(trip.total_stops) : null,
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

    // Phase 20.4 — Calculate parent-specific ETA for this session
    let parentEta: ParentPickupEta | null = null;
    if (activeTrip && row.stop_id) {
      try {
        parentEta = await EtaService.calculateParentEta({
          tripId: activeTrip.id,
          schoolId: token.school_id,
          stopId: row.stop_id,
        });
      } catch (err: any) {
        logger.warn('[ParentIdentityService] Failed to calculate parent ETA for session', {
          tripId: activeTrip.id,
          stopId: row.stop_id,
          error: err.message,
        });
        parentEta = EtaService.getUnavailableParentEta(
          'CALCULATION_PENDING',
          'Calculating estimated arrival time...',
          {
            tripId: activeTrip.id,
            stopId: row.stop_id,
            stopName: row.stop_name,
            sequenceOrder: row.sequence_order,
          }
        );
      }
    } else if (row.stop_id) {
      parentEta = EtaService.getUnavailableParentEta(
        'NO_ACTIVE_TRIP',
        'No trip currently in progress for your student. Live ETA will activate automatically when a trip begins.',
        {
          stopId: row.stop_id,
          stopName: row.stop_name,
          sequenceOrder: row.sequence_order,
        }
      );
    } else {
      parentEta = EtaService.getUnavailableParentEta(
        'NO_STOP_ASSIGNED',
        'No pickup stop has been assigned for this student.',
        {
          tripId: activeTrip?.id ?? null,
        }
      );
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
      parentEta,
    };
  }

  /**
   * Micro-phase 23.1: Secure Entry Token Validation for Parent Web
   * Validates token and returns structured status, expiration time, revocation time,
   * school support contacts, and full tracking session without throwing HTTP exceptions.
   */
  public static async validateTrackingTokenForWeb(
    rawToken?: string | null
  ): Promise<ParentLiveWebSecureEntryResponse> {
    if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
      return {
        status: 'MISSING',
        isValid: false,
        errorCode: 'TOKEN_MISSING',
        message: 'Live tracking link is missing. Please use the secure link sent to your WhatsApp.',
        session: null,
        schoolSupport: null,
      };
    }

    const cleanToken = rawToken.trim();
    const tokenHash = this.hashToken(cleanToken);

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
        ptt.deleted_at,
        sch.name AS school_name,
        sch.phone AS school_phone,
        sch.emergency_contact_phone AS school_emergency_phone
      FROM parent_tracking_tokens ptt
      LEFT JOIN schools sch ON ptt.school_id = sch.id
      WHERE ptt.token_hash = $1
      `,
      [tokenHash]
    );

    if (tokenRows.length === 0 || tokenRows[0].deleted_at) {
      return {
        status: 'INVALID',
        isValid: false,
        errorCode: 'TOKEN_INVALID',
        message: 'Invalid tracking link or link does not exist in our system.',
        session: null,
        schoolSupport: null,
      };
    }

    const token = tokenRows[0];
    const schoolSupport = {
      schoolName: token.school_name || null,
      supportPhone: token.school_phone || null,
      emergencyPhone: token.school_emergency_phone || token.school_phone || null,
      supportEmail: null,
      whatsappHelpAction: 'Reply 1 or TRACK on WhatsApp to receive a fresh tracking link',
    };

    // Check revocation
    if (token.revoked_at) {
      return {
        status: 'REVOKED',
        isValid: false,
        errorCode: 'TOKEN_REVOKED',
        message: 'This live tracking link has been deactivated/revoked by school administration for security reasons.',
        revokedAt: new Date(token.revoked_at).toISOString(),
        expiresAt: new Date(token.expires_at).toISOString(),
        session: null,
        schoolSupport,
      };
    }

    // Check expiration
    const expiresAt = new Date(token.expires_at);
    if (expiresAt.getTime() <= Date.now()) {
      return {
        status: 'EXPIRED',
        isValid: false,
        errorCode: 'TOKEN_EXPIRED',
        message: 'This live tracking link has expired for student safety and privacy.',
        expiresAt: expiresAt.toISOString(),
        session: null,
        schoolSupport,
      };
    }

    // Token is valid — retrieve full session
    try {
      const session = await this.verifyTrackingToken(cleanToken);
      return {
        status: 'VALID',
        isValid: true,
        message: 'Live tracking link verified successfully.',
        expiresAt: session.expiresAt,
        session,
        schoolSupport: {
          schoolName: session.school.name,
          supportPhone: token.school_phone || null,
          emergencyPhone: token.school_emergency_phone || token.school_phone || null,
          supportEmail: null,
          whatsappHelpAction: 'Reply 1 or TRACK on WhatsApp',
        },
      };
    } catch (err: any) {
      return {
        status: 'INVALID',
        isValid: false,
        errorCode: 'TOKEN_INVALID',
        message: err.message || 'Unable to retrieve tracking session',
        session: null,
        schoolSupport,
      };
    }
  }

  /**
   * Revokes a specific parent tracking token by raw token or UUID
   */
  public static async revokeToken(
    tokenOrId: string,
    schoolId?: string,
    reason?: string
  ): Promise<boolean> {
    if (!tokenOrId) return false;

    let sql: string;
    let params: string[];

    if (tokenOrId.startsWith('trk_')) {
      const tokenHash = this.hashToken(tokenOrId);
      if (schoolId) {
        sql = `
          UPDATE parent_tracking_tokens
          SET revoked_at = NOW(), updated_at = NOW()
          WHERE token_hash = $1 AND school_id = $2 AND revoked_at IS NULL
          RETURNING id
        `;
        params = [tokenHash, schoolId];
      } else {
        sql = `
          UPDATE parent_tracking_tokens
          SET revoked_at = NOW(), updated_at = NOW()
          WHERE token_hash = $1 AND revoked_at IS NULL
          RETURNING id
        `;
        params = [tokenHash];
      }
    } else {
      if (schoolId) {
        sql = `
          UPDATE parent_tracking_tokens
          SET revoked_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND school_id = $2 AND revoked_at IS NULL
          RETURNING id
        `;
        params = [tokenOrId, schoolId];
      } else {
        sql = `
          UPDATE parent_tracking_tokens
          SET revoked_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND revoked_at IS NULL
          RETURNING id
        `;
        params = [tokenOrId];
      }
    }

    const rows = await query<{ id: string }>(sql, params);
    const revoked = rows.length > 0;

    if (revoked && rows[0]) {
      logger.info('Parent tracking token revoked', {
        tokenId: rows[0].id,
        schoolId,
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

  public static revokeAllStudentTokens = (
    studentId: string,
    schoolId: string,
    reason?: string
  ) => ParentIdentityService.revokeAllTokensForStudent(studentId, schoolId, reason);

  public static listParentsForSchool = (
    schoolId: string,
    filters?: {
      search?: string;
      relationship?: string;
      whatsAppStatus?: string;
    }
  ) => ParentIdentityService.getSchoolParents(schoolId, filters);

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
        COALESCE(p.notifications_enabled, TRUE) AS notifications_enabled,
        p.opted_out_at,
        p.opt_out_reason,
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
        notificationsEnabled: r.notifications_enabled !== undefined ? !!r.notifications_enabled : true,
        optedOutAt: r.opted_out_at ? new Date(r.opted_out_at).toISOString() : null,
        optOutReason: r.opt_out_reason || null,
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
      `SELECT id, student_id, phone, full_name, COALESCE(notifications_enabled, TRUE) AS notifications_enabled 
       FROM parents WHERE id = $1 AND school_id = $2`,
      [parentId, schoolId]
    );

    if (parentRows.length === 0) {
      throw new NotFoundError('Parent record not found');
    }

    const parent = parentRows[0];
    if (!parent.phone || !parent.phone.trim()) {
      throw new ValidationError('Cannot dispatch notification: parent has no registered mobile number');
    }

    if (parent.notifications_enabled === false) {
      throw new ValidationError('Cannot dispatch notification: parent has opted out of notifications');
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
        parent_id,
        student_id,
        created_at
      ) VALUES ($1, $2, 'PARENT', $3, $4, $5, 'SENT', $6, $7, $8, NOW())
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
      parentId,
      parent.student_id,
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

  /**
   * Generates and dispatches a verified WhatsApp onboarding invitation for a parent
   */
  public static async sendOnboardingInvite(
    schoolId: string,
    parentId: string,
    options?: {
      ttlHours?: number;
      customNote?: string;
      adminUserId?: string | null;
    }
  ): Promise<ParentOnboardInviteResponse> {
    const parentSql = `
      SELECT 
        p.id AS parent_id,
        p.full_name AS parent_name,
        p.phone AS parent_phone,
        p.relationship,
        COALESCE(p.notifications_enabled, TRUE) AS notifications_enabled,
        s.id AS student_id,
        s.full_name AS student_name,
        s.admission_number,
        sch.id AS school_id,
        sch.name AS school_name,
        b.bus_number,
        pl.stop_name
      FROM parents p
      JOIN students s ON p.student_id = s.id AND s.deleted_at IS NULL
      JOIN schools sch ON p.school_id = sch.id
      LEFT JOIN student_stop_assignments ssa ON s.id = ssa.student_id AND ssa.deleted_at IS NULL
      LEFT JOIN pickup_locations pl ON ssa.pickup_stop_id = pl.id AND pl.deleted_at IS NULL
      LEFT JOIN routes r ON pl.route_id = r.id AND r.deleted_at IS NULL
      LEFT JOIN buses b ON r.default_bus_id = b.id AND b.deleted_at IS NULL
      WHERE p.id = $1 AND p.school_id = $2
    `;

    const parentRows = await query<any>(parentSql, [parentId, schoolId]);

    if (parentRows.length === 0) {
      throw new NotFoundError('Parent record not found under this school');
    }

    const row = parentRows[0];

    if (!row.parent_phone || !row.parent_phone.trim()) {
      throw new ValidationError('Cannot dispatch onboarding invite: parent does not have a registered mobile number');
    }

    if (row.notifications_enabled === false) {
      throw new ValidationError('Cannot dispatch onboarding invite: parent has opted out of notifications');
    }

    const ttlHours = options?.ttlHours && options.ttlHours > 0 ? options.ttlHours : 72;

    // Generate cryptographically secure tracking token
    const tokenData = await this.createTrackingToken({
      parentId: row.parent_id,
      studentId: row.student_id,
      schoolId: row.school_id,
      ttlHours,
      purpose: 'WELCOME_ONBOARDING',
    });

    const parentWebBase = process.env.PARENT_WEB_URL || 'http://localhost:3000';
    const inviteUrl = `${parentWebBase}/track?token=${tokenData.token}`;

    const busSnippet = row.bus_number ? ` on Bus ${row.bus_number}` : '';
    const stopSnippet = row.stop_name ? ` (Pickup: ${row.stop_name})` : '';

    const messageBody = `Namaste ${row.parent_name}! Welcome to ${row.school_name} live school bus tracking.

Live safety tracking is active for ${row.student_name} (${row.admission_number})${busSnippet}${stopSnippet}.

Tap your secure one-click tracking link to start viewing live bus location:
${inviteUrl}

(Secure token expires in ${ttlHours} hours. No native app download required.)`;

    const mockProviderId = `wa_onboard_${crypto.randomUUID().slice(0, 12)}`;

    const notifSql = `
      INSERT INTO notifications (
        school_id,
        recipient_phone,
        recipient_role,
        channel,
        template_name,
        message_body,
        status,
        provider_message_id,
        parent_id,
        student_id,
        created_at
      ) VALUES ($1, $2, 'PARENT', 'WHATSAPP', 'WELCOME_ONBOARDING', $3, 'SENT', $4, $5, $6, NOW())
      RETURNING id
    `;

    const notifRows = await query<any>(notifSql, [
      schoolId,
      row.parent_phone,
      messageBody,
      mockProviderId,
      row.parent_id,
      row.student_id,
    ]);

    const notificationId = notifRows[0].id;

    // Record audit log
    await AuditService.logAction({
      schoolId,
      userId: options?.adminUserId || null,
      action: 'PARENT_ONBOARDING_INVITE_SENT',
      entityType: 'PARENT',
      entityId: parentId,
      diffJson: {
        tokenPrefix: tokenData.token.substring(0, 8),
        expiresAt: tokenData.expiresAt,
        phone: row.parent_phone,
        notificationId,
      },
    });

    logger.info('WhatsApp onboarding invite dispatched to parent', {
      schoolId,
      parentId,
      phone: row.parent_phone,
      tokenPrefix: tokenData.token.substring(0, 8),
    });

    return {
      token: tokenData.token,
      tokenPrefix: tokenData.token.substring(0, 8),
      expiresAt: tokenData.expiresAt,
      inviteUrl,
      messageBody,
      notificationId,
      parent: {
        id: row.parent_id,
        fullName: row.parent_name,
        phone: row.parent_phone,
      },
      student: {
        id: row.student_id,
        fullName: row.student_name,
        admissionNumber: row.admission_number,
      },
    };
  }

  /**
   * Verifies an onboarding / tracking token and returns structured status
   * (Handles valid, expired, revoked, and invalid tokens gracefully)
   */
  public static async verifyOnboardingToken(
    rawToken: string
  ): Promise<ParentOnboardVerificationResponse> {
    if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
      return {
        status: 'INVALID',
        errorCode: 'TOKEN_INVALID',
        errorMessage: 'Tracking token is missing or malformed',
        session: null,
      };
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
      return {
        status: 'INVALID',
        errorCode: 'TOKEN_INVALID',
        errorMessage: 'Invalid tracking link or link does not exist in our system',
        session: null,
      };
    }

    const token = tokenRows[0];

    // Check revocation
    if (token.revoked_at) {
      return {
        status: 'REVOKED',
        errorCode: 'TOKEN_REVOKED',
        errorMessage: 'This live tracking link has been revoked by school transport administration',
        session: null,
      };
    }

    // Check expiration
    const expiresAt = new Date(token.expires_at);
    if (expiresAt.getTime() <= Date.now()) {
      return {
        status: 'EXPIRED',
        errorCode: 'TOKEN_EXPIRED',
        errorMessage: 'This live tracking link has expired. Please request a new invite link from the school.',
        session: null,
      };
    }

    // Valid token - retrieve full live session
    try {
      const session = await this.verifyTrackingToken(rawToken);
      const cleanPhone = session.parent.phone.replace(/[^0-9]/g, '');
      const phoneLast4 = cleanPhone.slice(-4);

      return {
        status: 'VALID',
        session,
        phoneLast4,
      };
    } catch (err: any) {
      return {
        status: 'INVALID',
        errorCode: 'TOKEN_INVALID',
        errorMessage: err.message || 'Unable to retrieve tracking session',
        session: null,
      };
    }
  }

  /**
   * Confirms parent identity and activation of live tracking portal
   */
  public static async confirmOnboardingActivation(
    rawToken: string,
    phoneLast4?: string
  ): Promise<ParentOnboardConfirmResponse> {
    const verification = await this.verifyOnboardingToken(rawToken);

    if (verification.status !== 'VALID' || !verification.session) {
      throw new UnauthorizedError(verification.errorMessage || 'Invalid or expired tracking token');
    }

    const session = verification.session;

    if (phoneLast4 && phoneLast4.trim()) {
      const cleanPhone = session.parent.phone.replace(/[^0-9]/g, '');
      const actualLast4 = cleanPhone.slice(-4);

      if (phoneLast4.trim() !== actualLast4) {
        throw new ValidationError('Mobile number verification failed: the last 4 digits do not match');
      }
    }

    // Log confirmation notification
    const confirmMsg = `Parent ${session.parent.fullName} activated live tracking for ${session.student.fullName} (${session.student.admissionNumber}).`;
    await query(
      `INSERT INTO notifications (
        school_id, recipient_phone, recipient_role, channel, template_name, message_body, status, created_at
      ) VALUES ($1, $2, 'PARENT', 'WHATSAPP', 'ONBOARDING_CONFIRMED', $3, 'SENT', NOW())`,
      [session.school.id, session.parent.phone, confirmMsg]
    );

    logger.info('Parent tracking portal onboarding confirmed', {
      schoolId: session.school.id,
      parentId: session.parent.id,
      studentId: session.student.id,
    });

    return {
      confirmed: true,
      activatedAt: new Date().toISOString(),
      session,
    };
  }

  /**
   * Logs a tracking link access event and increments token access metrics
   */
  public static async recordTokenAccess(
    tokenId: string,
    parentId: string,
    studentId: string,
    schoolId: string,
    clientInfo?: { ipAddress?: string; userAgent?: string }
  ): Promise<void> {
    try {
      await query(
        `UPDATE parent_tracking_tokens
         SET last_accessed_at = NOW(), access_count = access_count + 1
         WHERE id = $1`,
        [tokenId]
      );

      await query(
        `INSERT INTO parent_token_access_logs (
           token_id, parent_id, student_id, school_id, ip_address, user_agent, accessed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          tokenId,
          parentId,
          studentId,
          schoolId,
          clientInfo?.ipAddress || null,
          clientInfo?.userAgent || null,
        ]
      );
    } catch (err: any) {
      logger.error('Failed to log token access activity', {
        tokenId,
        parentId,
        error: err.message,
      });
    }
  }

  /**
   * Aggregates notification delivery summary, link activity metrics, and dispatch logs for a parent
   */
  public static async getParentNotificationStatus(
    schoolId: string,
    parentId: string
  ): Promise<ParentNotificationStatusResponse> {
    const parentSql = `
      SELECT 
        p.id AS parent_id,
        p.full_name AS parent_name,
        p.relationship,
        p.phone AS parent_phone,
        COALESCE(p.notifications_enabled, TRUE) AS notifications_enabled,
        p.opted_out_at,
        p.opt_out_reason,
        s.id AS student_id,
        s.full_name AS student_name,
        s.admission_number,
        s.class_grade,
        s.section
      FROM parents p
      JOIN students s ON p.student_id = s.id AND s.deleted_at IS NULL
      WHERE p.id = $1 AND p.school_id = $2
    `;

    const parentRows = await query<any>(parentSql, [parentId, schoolId]);
    if (parentRows.length === 0) {
      throw new NotFoundError('Parent record not found');
    }
    const parent = parentRows[0];

    // Query notifications by parent_id OR recipient_phone
    const notifSql = `
      SELECT 
        id,
        channel,
        template_name,
        message_body,
        status,
        delivered_at,
        read_at,
        failure_reason,
        created_at
      FROM notifications
      WHERE school_id = $1 AND (parent_id = $2 OR recipient_phone = $3)
      ORDER BY created_at DESC
      LIMIT 50
    `;
    const notifRows = await query<any>(notifSql, [schoolId, parentId, parent.parent_phone]);

    const totalDispatches = notifRows.length;
    let sentCount = 0;
    let deliveredCount = 0;
    let readCount = 0;
    let failedCount = 0;

    for (const n of notifRows) {
      if (n.status === 'SENT') sentCount++;
      else if (n.status === 'DELIVERED') deliveredCount++;
      else if (n.status === 'READ') readCount++;
      else if (n.status === 'FAILED') failedCount++;
    }

    const deliverySuccessRatePercent = totalDispatches > 0
      ? Math.round(((totalDispatches - failedCount) / totalDispatches) * 100)
      : 100;

    // Query tracking tokens and access summary
    const tokenStatsSql = `
      SELECT 
        COUNT(*)::int AS total_tokens,
        COUNT(CASE WHEN revoked_at IS NULL AND expires_at > NOW() AND deleted_at IS NULL THEN 1 END)::int AS active_tokens,
        COALESCE(SUM(access_count), 0)::int AS total_access_count,
        MAX(last_accessed_at) AS last_accessed_at
      FROM parent_tracking_tokens
      WHERE parent_id = $1 AND school_id = $2
    `;
    const tokenStatsRows = await query<any>(tokenStatsSql, [parentId, schoolId]);
    const tokenStats = tokenStatsRows[0] || {
      total_tokens: 0,
      active_tokens: 0,
      total_access_count: 0,
      last_accessed_at: null,
    };

    // Query recent access logs
    const accessLogsSql = `
      SELECT 
        id,
        token_id,
        ip_address,
        user_agent,
        accessed_at
      FROM parent_token_access_logs
      WHERE parent_id = $1 AND school_id = $2
      ORDER BY accessed_at DESC
      LIMIT 10
    `;
    const accessRows = await query<any>(accessLogsSql, [parentId, schoolId]).catch(() => []);

    return {
      parent: {
        id: parent.parent_id,
        fullName: parent.parent_name,
        phone: parent.parent_phone,
        relationship: parent.relationship,
        notificationsEnabled: !!parent.notifications_enabled,
        optedOutAt: parent.opted_out_at ? new Date(parent.opted_out_at).toISOString() : null,
        optOutReason: parent.opt_out_reason || null,
      },
      student: {
        id: parent.student_id,
        fullName: parent.student_name,
        admissionNumber: parent.admission_number,
        classGrade: parent.class_grade,
        section: parent.section,
      },
      deliverySummary: {
        totalDispatches,
        sentCount,
        deliveredCount,
        readCount,
        failedCount,
        deliverySuccessRatePercent,
      },
      linkActivity: {
        totalTokensIssued: Number(tokenStats.total_tokens || 0),
        activeTokenCount: Number(tokenStats.active_tokens || 0),
        totalAccessCount: Number(tokenStats.total_access_count || 0),
        lastAccessedAt: tokenStats.last_accessed_at ? new Date(tokenStats.last_accessed_at).toISOString() : null,
        recentAccesses: accessRows.map((a: any) => ({
          id: a.id,
          tokenId: a.token_id,
          accessedAt: new Date(a.accessed_at).toISOString(),
          ipAddress: a.ip_address || null,
          userAgent: a.user_agent || null,
        })),
      },
      recentNotifications: notifRows.map((n: any) => ({
        id: n.id,
        channel: n.channel,
        templateName: n.template_name,
        messageBody: n.message_body,
        status: n.status,
        deliveredAt: n.delivered_at ? new Date(n.delivered_at).toISOString() : null,
        readAt: n.read_at ? new Date(n.read_at).toISOString() : null,
        failureReason: n.failure_reason || null,
        createdAt: new Date(n.created_at).toISOString(),
      })),
    };
  }

  /**
   * Updates notification preferences (opt-in / opt-out) for a parent
   */
  public static async updateParentNotificationPreferences(
    schoolId: string,
    parentId: string,
    dto: UpdateParentNotificationPreferences,
    actorUserId?: string | null
  ): Promise<{
    parentId: string;
    notificationsEnabled: boolean;
    optedOutAt: string | null;
    optOutReason: string | null;
  }> {
    const parentRows = await query<any>(
      `SELECT id, notifications_enabled FROM parents WHERE id = $1 AND school_id = $2`,
      [parentId, schoolId]
    );

    if (parentRows.length === 0) {
      throw new NotFoundError('Parent record not found');
    }

    const current = parentRows[0];
    const newEnabled = !!dto.notificationsEnabled;
    const optedOutAt = newEnabled ? null : new Date().toISOString();
    const optOutReason = newEnabled ? null : (dto.optOutReason || 'Parent opted out of transport alerts');

    await query(
      `UPDATE parents
       SET notifications_enabled = $1, opted_out_at = $2, opt_out_reason = $3, updated_at = NOW()
       WHERE id = $4 AND school_id = $5`,
      [newEnabled, optedOutAt, optOutReason, parentId, schoolId]
    );

    // Audit log
    await AuditService.logAction({
      schoolId,
      userId: actorUserId || null,
      action: 'PARENT_NOTIFICATION_PREFERENCES_UPDATED',
      entityType: 'PARENT',
      entityId: parentId,
      diffJson: {
        previousEnabled: current.notifications_enabled,
        newEnabled,
        optOutReason,
      },
    });

    logger.info('Parent notification preferences updated', {
      schoolId,
      parentId,
      notificationsEnabled: newEnabled,
      optOutReason,
    });

    return {
      parentId,
      notificationsEnabled: newEnabled,
      optedOutAt,
      optOutReason,
    };
  }

  /**
   * Updates delivery status for an outbound notification (e.g. webhook or simulated delivery)
   */
  public static async updateNotificationDeliveryStatus(
    schoolId: string,
    notificationId: string,
    dto: UpdateNotificationStatusRequest
  ): Promise<ParentNotificationHistoryItem> {
    const rows = await query<any>(
      `SELECT id, school_id, status FROM notifications WHERE id = $1 AND school_id = $2`,
      [notificationId, schoolId]
    );

    if (rows.length === 0) {
      throw new NotFoundError('Notification record not found');
    }

    const updateSql = `
      UPDATE notifications
      SET 
        status = $1,
        failure_reason = CASE WHEN $1 = 'FAILED' THEN $2 ELSE failure_reason END,
        delivered_at = CASE WHEN $1 IN ('DELIVERED', 'READ') AND delivered_at IS NULL THEN NOW() ELSE delivered_at END,
        read_at = CASE WHEN $1 = 'READ' AND read_at IS NULL THEN NOW() ELSE read_at END
      WHERE id = $3 AND school_id = $4
      RETURNING id, channel, template_name, message_body, status, delivered_at, read_at, failure_reason, created_at
    `;

    const updatedRows = await query<any>(updateSql, [
      dto.status,
      dto.failureReason || null,
      notificationId,
      schoolId,
    ]);

    const n = updatedRows[0];

    logger.info('Notification delivery status updated', {
      schoolId,
      notificationId,
      status: dto.status,
    });

    return {
      id: n.id,
      channel: n.channel,
      templateName: n.template_name,
      messageBody: n.message_body,
      status: n.status,
      deliveredAt: n.delivered_at ? new Date(n.delivered_at).toISOString() : null,
      readAt: n.read_at ? new Date(n.read_at).toISOString() : null,
      failureReason: n.failure_reason || null,
      createdAt: new Date(n.created_at).toISOString(),
    };
  }
}




