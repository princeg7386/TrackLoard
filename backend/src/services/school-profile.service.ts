import { query } from '../config/database.js';
import {
  School,
  UpdateSchoolProfileRequest,
  normalizeIndianPhoneNumber,
} from '@school-bus/shared';
import { NotFoundError } from '../middlewares/error.middleware.js';
import { AuditService } from './audit.service.js';
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

    return school;
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

    const normalizedPhone = normalizeIndianPhoneNumber(updateData.phone);
    const cleanedLogo = updateData.logoUrl || null;
    const cleanedWebsite = updateData.website || null;
    const cleanedAffiliation = updateData.affiliationNumber || null;
    const cleanedPostal = updateData.postalCode || null;

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
        updated_at = NOW()
      WHERE id = $12 AND deleted_at IS NULL
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
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    const rows = await query<School>(sql, [
      updateData.name.trim(),
      updateData.address.trim(),
      updateData.city.trim(),
      updateData.state.trim(),
      cleanedPostal,
      normalizedPhone,
      updateData.email.trim().toLowerCase(),
      cleanedLogo,
      cleanedAffiliation,
      cleanedWebsite,
      updateData.timezone || 'Asia/Kolkata',
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

    return updated;
  }
}

