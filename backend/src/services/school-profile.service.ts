import { query } from '../config/database.js';
import {
  School,
  UpdateSchoolProfileRequest,
  normalizeIndianPhoneNumber,
  SchoolGeofence,
  UpdateSchoolGeofenceRequest,
  GeoCoordinates,
} from '@school-bus/shared';
import { NotFoundError, BadRequestError } from '../middlewares/error.middleware.js';
import { AuditService } from './audit.service.js';
import { SpatialService } from './spatial.service.js';
import { logger } from './logger.service.js';

export class SchoolProfileService {
  /**
   * Retrieves school profile metadata by school ID
   */
  public static async getSchoolProfile(schoolId: string): Promise<School> {
    const sql = `
      SELECT 
        id,
        name,
        code,
        address,
        city,
        state,
        postal_code AS "postalCode",
        phone,
        email,
        logo_url AS "logoUrl",
        affiliation_number AS "affiliationNumber",
        website,
        timezone,
        latitude,
        longitude,
        COALESCE(geofence_type, 'RADIUS') AS "geofenceType",
        COALESCE(geofence_radius_meters, 500) AS "geofenceRadiusMeters",
        geofence_polygon AS "geofencePolygon",
        COALESCE(auto_arrival_enabled, TRUE) AS "autoArrivalEnabled",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM schools
      WHERE id = $1 AND deleted_at IS NULL
    `;

    const rows = await query<School>(sql, [schoolId]);
    const school = rows[0];
    if (!school) {
      throw new NotFoundError(`School profile with ID ${schoolId} not found`);
    }

    return {
      ...school,
      latitude: school.latitude !== null && school.latitude !== undefined ? Number(school.latitude) : null,
      longitude: school.longitude !== null && school.longitude !== undefined ? Number(school.longitude) : null,
      geofenceRadiusMeters: Number(school.geofenceRadiusMeters ?? 500),
      autoArrivalEnabled: Boolean(school.autoArrivalEnabled ?? true),
    };
  }

  /**
   * Updates an existing school profile and logs the audit trail
   */
  public static async updateSchoolProfile(
    schoolId: string,
    updateData: UpdateSchoolProfileRequest,
    userId?: string,
    ipAddress?: string
  ): Promise<School> {
    const current = await this.getSchoolProfile(schoolId);

    const name = updateData.name !== undefined ? updateData.name.trim() : current.name;
    const address = updateData.address !== undefined ? updateData.address.trim() : (current.address ?? '');
    const city = updateData.city !== undefined ? updateData.city.trim() : current.city;
    const state = updateData.state !== undefined ? updateData.state.trim() : current.state;
    const cleanedPostal = updateData.postalCode !== undefined ? (updateData.postalCode || null) : (current.postalCode ?? null);
    const normalizedPhone = updateData.phone ? normalizeIndianPhoneNumber(updateData.phone) : (current.phone ?? '');
    const email = updateData.email !== undefined ? updateData.email.trim().toLowerCase() : current.email;
    const cleanedLogo = updateData.logoUrl !== undefined ? (updateData.logoUrl || null) : (current.logoUrl ?? null);
    const cleanedAffiliation = updateData.affiliationNumber !== undefined ? (updateData.affiliationNumber || null) : (current.affiliationNumber ?? null);
    const cleanedWebsite = updateData.website !== undefined ? (updateData.website || null) : (current.website ?? null);
    const timezone = updateData.timezone || current.timezone || 'Asia/Kolkata';

    const lat = updateData.latitude !== undefined ? updateData.latitude : current.latitude;
    const lng = updateData.longitude !== undefined ? updateData.longitude : current.longitude;
    const geofenceType = updateData.geofenceType || current.geofenceType || 'RADIUS';
    const geofenceRadiusMeters = updateData.geofenceRadiusMeters !== undefined ? updateData.geofenceRadiusMeters : (current.geofenceRadiusMeters ?? 500);
    const geofencePolygon = updateData.geofencePolygon !== undefined ? updateData.geofencePolygon : current.geofencePolygon;
    const autoArrivalEnabled = updateData.autoArrivalEnabled !== undefined ? updateData.autoArrivalEnabled : (current.autoArrivalEnabled ?? true);

    let locationSqlFragment = 'location';
    if (lat !== null && lng !== null && lat !== undefined && lng !== undefined) {
      locationSqlFragment = `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
    }

    let geometrySqlFragment = 'geofence_geometry';
    if (geofenceType === 'POLYGON' && geofencePolygon && geofencePolygon.length >= 3) {
      geometrySqlFragment = SpatialService.toGeographyPolygonSql(geofencePolygon);
    } else if (geofenceType === 'RADIUS') {
      geometrySqlFragment = 'NULL';
    }

    const sql = `
      UPDATE schools
      SET
        name = $1,
        address = $2,
        city = $3,
        state = $4,
        postal_code = $5,
        phone = $6,
        email = $7,
        logo_url = $8,
        affiliation_number = $9,
        website = $10,
        timezone = $11,
        latitude = $12,
        longitude = $13,
        location = ${locationSqlFragment},
        geofence_type = $14,
        geofence_radius_meters = $15,
        geofence_polygon = $16::jsonb,
        geofence_geometry = ${geometrySqlFragment},
        auto_arrival_enabled = $17,
        updated_at = NOW()
      WHERE id = $18 AND deleted_at IS NULL
      RETURNING 
        id,
        name,
        code,
        address,
        city,
        state,
        postal_code AS "postalCode",
        phone,
        email,
        logo_url AS "logoUrl",
        affiliation_number AS "affiliationNumber",
        website,
        timezone,
        latitude,
        longitude,
        geofence_type AS "geofenceType",
        geofence_radius_meters AS "geofenceRadiusMeters",
        geofence_polygon AS "geofencePolygon",
        auto_arrival_enabled AS "autoArrivalEnabled",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    const rows = await query<School>(sql, [
      name,
      address,
      city,
      state,
      cleanedPostal,
      normalizedPhone,
      email,
      cleanedLogo,
      cleanedAffiliation,
      cleanedWebsite,
      timezone,
      lat,
      lng,
      geofenceType,
      geofenceRadiusMeters,
      geofencePolygon ? JSON.stringify(geofencePolygon) : null,
      autoArrivalEnabled,
      schoolId,
    ]);

    const updated = rows[0];
    if (!updated) {
      throw new NotFoundError(`School profile with ID ${schoolId} could not be updated`);
    }

    // Record immutable audit entry
    await AuditService.logAction({
      schoolId,
      userId: userId || null,
      userRole: 'SCHOOL_ADMIN',
      action: 'SCHOOL_PROFILE_UPDATE',
      entityType: 'SCHOOL',
      entityId: schoolId,
      diffJson: {
        before: {
          name: current.name,
          phone: current.phone,
          city: current.city,
          state: current.state,
          email: current.email,
        },
        after: {
          name: updated.name,
          phone: updated.phone,
          city: updated.city,
          state: updated.state,
          email: updated.email,
        },
      },
      ipAddress,
    });

    logger.info('School profile updated successfully', {
      schoolId,
      name: updated.name,
      updatedBy: userId,
    });

    return {
      ...updated,
      latitude: updated.latitude !== null && updated.latitude !== undefined ? Number(updated.latitude) : null,
      longitude: updated.longitude !== null && updated.longitude !== undefined ? Number(updated.longitude) : null,
      geofenceRadiusMeters: Number(updated.geofenceRadiusMeters ?? 500),
      autoArrivalEnabled: Boolean(updated.autoArrivalEnabled ?? true),
    };
  }

  /**
   * Retrieves the school campus geofence configuration
   */
  public static async getSchoolGeofence(schoolId: string): Promise<SchoolGeofence> {
    const sql = `
      SELECT 
        id AS "schoolId",
        name AS "schoolName",
        latitude,
        longitude,
        COALESCE(geofence_type, 'RADIUS') AS "geofenceType",
        COALESCE(geofence_radius_meters, 500) AS "geofenceRadiusMeters",
        geofence_polygon AS "geofencePolygon",
        COALESCE(auto_arrival_enabled, TRUE) AS "autoArrivalEnabled",
        updated_at::text AS "updatedAt"
      FROM schools
      WHERE id = $1 AND deleted_at IS NULL
    `;

    const rows = await query<{
      schoolId: string;
      schoolName: string;
      latitude: number | string | null;
      longitude: number | string | null;
      geofenceType: 'RADIUS' | 'POLYGON';
      geofenceRadiusMeters: number | string;
      geofencePolygon: GeoCoordinates[] | null;
      autoArrivalEnabled: boolean;
      updatedAt: string;
    }>(sql, [schoolId]);

    const school = rows[0];
    if (!school) {
      throw new NotFoundError(`School ${schoolId} not found`);
    }

    return {
      schoolId: school.schoolId,
      schoolName: school.schoolName,
      latitude: school.latitude !== null && school.latitude !== undefined ? Number(school.latitude) : null,
      longitude: school.longitude !== null && school.longitude !== undefined ? Number(school.longitude) : null,
      geofenceType: school.geofenceType,
      geofenceRadiusMeters: Number(school.geofenceRadiusMeters),
      geofencePolygon: school.geofencePolygon,
      autoArrivalEnabled: Boolean(school.autoArrivalEnabled),
      updatedAt: school.updatedAt,
    };
  }

  /**
   * Updates the school campus geofence boundary (radius or custom polygon) and auto-arrival switch
   */
  public static async updateSchoolGeofence(
    schoolId: string,
    payload: UpdateSchoolGeofenceRequest,
    userId?: string,
    ipAddress?: string
  ): Promise<SchoolGeofence> {
    const current = await this.getSchoolGeofence(schoolId);

    const lat = payload.latitude !== undefined ? payload.latitude : current.latitude;
    const lng = payload.longitude !== undefined ? payload.longitude : current.longitude;
    const geofenceType = payload.geofenceType || current.geofenceType;
    const geofenceRadiusMeters = payload.geofenceRadiusMeters !== undefined ? payload.geofenceRadiusMeters : current.geofenceRadiusMeters;
    const geofencePolygon = payload.geofencePolygon !== undefined ? payload.geofencePolygon : current.geofencePolygon;
    const autoArrivalEnabled = payload.autoArrivalEnabled !== undefined ? payload.autoArrivalEnabled : current.autoArrivalEnabled;

    let geometrySqlFragment = 'NULL';
    if (geofenceType === 'POLYGON') {
      if (!geofencePolygon || geofencePolygon.length < 3) {
        throw new BadRequestError('Polygon geofence requires at least 3 vertices');
      }
      try {
        geometrySqlFragment = SpatialService.toGeographyPolygonSql(geofencePolygon);
      } catch (err) {
        throw new BadRequestError(`Invalid polygon coordinates: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    let locationSqlFragment = 'location';
    if (lat !== null && lng !== null && lat !== undefined && lng !== undefined) {
      locationSqlFragment = `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
    }

    const sql = `
      UPDATE schools
      SET
        latitude = $1,
        longitude = $2,
        location = ${locationSqlFragment},
        geofence_type = $3,
        geofence_radius_meters = $4,
        geofence_polygon = $5::jsonb,
        geofence_geometry = ${geometrySqlFragment},
        auto_arrival_enabled = $6,
        updated_at = NOW()
      WHERE id = $7 AND deleted_at IS NULL
      RETURNING
        id AS "schoolId",
        name AS "schoolName",
        latitude,
        longitude,
        geofence_type AS "geofenceType",
        geofence_radius_meters AS "geofenceRadiusMeters",
        geofence_polygon AS "geofencePolygon",
        auto_arrival_enabled AS "autoArrivalEnabled",
        updated_at::text AS "updatedAt"
    `;

    const rows = await query<{
      schoolId: string;
      schoolName: string;
      latitude: number | string | null;
      longitude: number | string | null;
      geofenceType: 'RADIUS' | 'POLYGON';
      geofenceRadiusMeters: number | string;
      geofencePolygon: GeoCoordinates[] | null;
      autoArrivalEnabled: boolean;
      updatedAt: string;
    }>(sql, [
      lat,
      lng,
      geofenceType,
      geofenceRadiusMeters,
      geofencePolygon ? JSON.stringify(geofencePolygon) : null,
      autoArrivalEnabled,
      schoolId,
    ]);

    const updated = rows[0];
    if (!updated) {
      throw new NotFoundError(`School ${schoolId} not found`);
    }

    await AuditService.logAction({
      schoolId,
      userId: userId || null,
      userRole: 'SCHOOL_ADMIN',
      action: 'SCHOOL_GEOFENCE_UPDATE',
      entityType: 'SCHOOL',
      entityId: schoolId,
      diffJson: {
        before: {
          latitude: current.latitude,
          longitude: current.longitude,
          geofenceType: current.geofenceType,
          geofenceRadiusMeters: current.geofenceRadiusMeters,
          autoArrivalEnabled: current.autoArrivalEnabled,
        },
        after: {
          latitude: updated.latitude !== null && updated.latitude !== undefined ? Number(updated.latitude) : null,
          longitude: updated.longitude !== null && updated.longitude !== undefined ? Number(updated.longitude) : null,
          geofenceType: updated.geofenceType,
          geofenceRadiusMeters: Number(updated.geofenceRadiusMeters),
          autoArrivalEnabled: Boolean(updated.autoArrivalEnabled),
        },
      },
      ipAddress,
    });

    logger.info(`[SchoolProfileService] Updated geofence for school ${schoolId}`, {
      schoolId,
      geofenceType: updated.geofenceType,
      autoArrivalEnabled: updated.autoArrivalEnabled,
    });

    return {
      schoolId: updated.schoolId,
      schoolName: updated.schoolName,
      latitude: updated.latitude !== null && updated.latitude !== undefined ? Number(updated.latitude) : null,
      longitude: updated.longitude !== null && updated.longitude !== undefined ? Number(updated.longitude) : null,
      geofenceType: updated.geofenceType,
      geofenceRadiusMeters: Number(updated.geofenceRadiusMeters),
      geofencePolygon: updated.geofencePolygon,
      autoArrivalEnabled: Boolean(updated.autoArrivalEnabled),
      updatedAt: updated.updatedAt,
    };
  }
}

