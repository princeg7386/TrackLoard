import { query } from '../config/database.js';
import {
  AuthUserPayload,
  DriverAuthPayload,
  ParentLiveTrackingSession,
  UserRole,
  ResourceDomain,
  PermissionAction,
  hasRolePermission,
  ParentIdentityStudentInfo,
} from '@school-bus/shared';
import {
  ForbiddenError,
  UnauthorizedError,
  NotFoundError,
} from '../middlewares/error.middleware.js';
import { logger } from './logger.service.js';

export class TenantIsolationService {
  /**
   * Asserts that an actor (Admin, Driver, or Parent session) has permission to access a target school tenant
   */
  public static assertSchoolTenantIsolation(
    actor: AuthUserPayload | DriverAuthPayload | ParentLiveTrackingSession | undefined,
    targetSchoolId: string
  ): void {
    if (!actor) {
      throw new UnauthorizedError('Authentication is required to verify tenant access');
    }

    if (!targetSchoolId) {
      throw new ForbiddenError('Target school identifier is missing for tenant validation');
    }

    // 1. Super Admin has universal platform scope
    if ('role' in actor && actor.role === UserRole.SUPER_ADMIN) {
      return;
    }

    // 2. Admin User
    if ('role' in actor && (actor.role === UserRole.SCHOOL_ADMIN || actor.role === UserRole.TRANSPORT_COORDINATOR)) {
      if (actor.schoolId !== targetSchoolId) {
        logger.warn('Cross-tenant unauthorized access attempt by school admin', {
          userId: actor.id,
          userSchoolId: actor.schoolId,
          targetSchoolId,
        });
        throw new ForbiddenError(
          'Forbidden: You are not authorized to access or modify data belonging to another school'
        );
      }
      return;
    }

    // 3. Driver
    if ('role' in actor && actor.role === UserRole.DRIVER) {
      if (actor.schoolId !== targetSchoolId) {
        logger.warn('Cross-tenant access attempt by driver', {
          driverId: actor.id,
          driverSchoolId: actor.schoolId,
          targetSchoolId,
        });
        throw new ForbiddenError(
          'Forbidden: Driver is not registered under the target school tenant'
        );
      }
      return;
    }

    // 4. Parent Live Tracking Session
    if ('parent' in actor && 'student' in actor) {
      if (actor.student.schoolId !== targetSchoolId) {
        logger.warn('Cross-tenant access attempt by parent session', {
          parentId: actor.parent.id,
          studentSchoolId: actor.student.schoolId,
          targetSchoolId,
        });
        throw new ForbiddenError(
          'Forbidden: Parent tracking session does not belong to the target school tenant'
        );
      }
      return;
    }

    throw new ForbiddenError('Forbidden: Actor does not possess a valid tenant context');
  }

  /**
   * Asserts that a driver is operating strictly on their assigned bus
   */
  public static assertDriverBusAssignment(
    driver: DriverAuthPayload,
    busId: string
  ): void {
    if (!driver || driver.role !== UserRole.DRIVER) {
      throw new UnauthorizedError('Driver authentication required');
    }

    if (!busId) {
      throw new ForbiddenError('Target bus ID is required for driver authorization check');
    }

    if (driver.assignedBusId && driver.assignedBusId !== busId) {
      logger.warn('Driver attempted to access unassigned bus', {
        driverId: driver.id,
        assignedBusId: driver.assignedBusId,
        requestedBusId: busId,
      });
      throw new ForbiddenError(
        `Forbidden: Driver '${driver.fullName}' is not assigned to operate Bus ID ${busId}`
      );
    }
  }

  /**
   * Asserts that a driver is authorized for a specific active trip in the database
   */
  public static async assertDriverTripAssignment(
    driverId: string,
    schoolId: string,
    tripId: string
  ): Promise<void> {
    const rows = await query<any>(
      `
      SELECT id, bus_id, driver_id, status 
      FROM trips 
      WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
      `,
      [tripId, schoolId]
    );

    if (rows.length === 0) {
      throw new NotFoundError(`Trip with ID ${tripId} not found for this school`);
    }

    const trip = rows[0];
    if (trip.driver_id !== driverId) {
      logger.warn('Driver attempted to access trip assigned to another driver', {
        driverId,
        tripDriverId: trip.driver_id,
        tripId,
      });
      throw new ForbiddenError(
        `Forbidden: You are not the assigned driver for Trip ${tripId}`
      );
    }
  }

  /**
   * Asserts that a parent session is restricted only to their own child's student record
   */
  public static assertParentStudentScope(
    session: ParentLiveTrackingSession,
    targetStudentId: string
  ): void {
    if (!session || !session.isValid) {
      throw new UnauthorizedError('Valid parent tracking session required');
    }

    if (!targetStudentId) {
      throw new ForbiddenError('Target student ID is required for parent access validation');
    }

    if (session.student.id !== targetStudentId) {
      logger.warn('Parent attempted unauthorized cross-student data access', {
        parentId: session.parent.id,
        authorizedStudentId: session.student.id,
        requestedStudentId: targetStudentId,
      });
      throw new ForbiddenError(
        'Forbidden: You are only authorized to access live tracking and attendance for your linked child'
      );
    }
  }

  /**
   * Asserts RBAC permission for an action on a specific resource domain
   */
  public static assertRolePermission(
    role: UserRole,
    domain: ResourceDomain,
    action: PermissionAction
  ): void {
    const allowed = hasRolePermission(role, domain, action);
    if (!allowed) {
      throw new ForbiddenError(
        `Forbidden: Role '${role}' lacks permission to perform action '${action}' on domain '${domain}'`
      );
    }
  }

  /**
   * Sanitizes student details for parent view, ensuring no cross-student or internal administrative metadata leaks
   */
  public static filterSafeStudentViewForParent(
    student: any
  ): ParentIdentityStudentInfo {
    return {
      id: student.id,
      schoolId: student.schoolId || student.school_id,
      fullName: student.fullName || student.full_name,
      admissionNumber: student.admissionNumber || student.admission_number,
      classGrade: student.classGrade || student.class_grade,
      section: student.section,
      rollNumber: student.rollNumber || student.roll_number || null,
      emergencyContactPhone: student.emergencyContactPhone || student.emergency_contact_phone || null,
    };
  }
}

