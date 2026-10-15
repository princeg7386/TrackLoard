import { Request, Response, NextFunction } from 'express';
import { ResourceDomain, PermissionAction, UserRole } from '@school-bus/shared';
import { TenantIsolationService } from '../services/tenant-isolation.service.js';
import { UnauthorizedError, ForbiddenError } from './error.middleware.js';

// Extend Express Request to include resolved tenant scope
declare global {
  namespace Express {
    interface Request {
      tenantSchoolId?: string;
    }
  }
}

/**
 * Middleware to enforce strict multi-tenant school isolation
 */
export function requireTenantScope(
  source: 'params' | 'query' | 'body' = 'params',
  key: string = 'schoolId'
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      let targetSchoolId: string | undefined;

      if (source === 'params') {
        const paramVal = req.params[key];
        targetSchoolId = typeof paramVal === 'string' ? paramVal : paramVal ? paramVal[0] : undefined;
      } else if (source === 'query') {
        const queryVal = req.query[key];
        targetSchoolId = typeof queryVal === 'string' ? queryVal : undefined;
      } else if (source === 'body') {
        targetSchoolId = req.body?.[key];
      }

      if (!targetSchoolId) {
        return next(
          new ForbiddenError(`Target tenant identifier (${key}) is missing from request`)
        );
      }

      const actor = req.user || req.driver || req.parentTrackingSession;
      if (!actor) {
        return next(
          new UnauthorizedError('Authentication is required to verify tenant isolation')
        );
      }

      TenantIsolationService.assertSchoolTenantIsolation(actor, targetSchoolId);
      req.tenantSchoolId = targetSchoolId;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware to ensure Driver is operating strictly on their assigned trip
 */
export function requireDriverTripScope(
  source: 'params' | 'body' = 'params',
  key: string = 'tripId'
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.driver) {
        return next(new UnauthorizedError('Driver authentication required'));
      }

      let tripId: string | undefined;
      if (source === 'params') {
        const paramVal = req.params[key];
        tripId = typeof paramVal === 'string' ? paramVal : paramVal ? paramVal[0] : undefined;
      } else {
        tripId = req.body?.[key];
      }

      if (!tripId) {
        return next(
          new ForbiddenError(`Trip identifier (${key}) is required for driver authorization`)
        );
      }

      await TenantIsolationService.assertDriverTripAssignment(
        req.driver.id,
        req.driver.schoolId,
        tripId
      );

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware to ensure Parent is accessing strictly their authorized student data
 */
export function requireParentStudentScope(
  source: 'params' | 'body' = 'params',
  key: string = 'studentId'
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (!req.parentTrackingSession) {
        return next(new UnauthorizedError('Parent tracking session required'));
      }

      let studentId: string | undefined;
      if (source === 'params') {
        const paramVal = req.params[key];
        studentId = typeof paramVal === 'string' ? paramVal : paramVal ? paramVal[0] : undefined;
      } else {
        studentId = req.body?.[key];
      }

      if (!studentId) {
        return next(
          new ForbiddenError(`Student identifier (${key}) is required for parent validation`)
        );
      }

      TenantIsolationService.assertParentStudentScope(
        req.parentTrackingSession,
        studentId
      );

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware to check granular domain and action permissions based on role
 */
export function requirePermission(domain: ResourceDomain, action: PermissionAction) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const role: UserRole | undefined =
        req.user?.role ||
        (req.driver ? UserRole.DRIVER : undefined) ||
        (req.parentTrackingSession ? UserRole.PARENT : undefined);

      if (!role) {
        return next(new UnauthorizedError('User session or authentication token missing'));
      }

      TenantIsolationService.assertRolePermission(role, domain, action);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Middleware to enforce that the authenticated JWT actor is scoped to a specific school.
 * Use on routes where tenant isolation is enforced via req.user.schoolId rather than
 * a body/param field (e.g. token revocation where the token ID itself is looked up
 * and its school is verified in the service layer against req.user.schoolId).
 *
 * Exported as requireTenantScope alias: requireActorTenantScope
 */
export function requireActorTenantScope(req: Request, _res: Response, next: NextFunction): void {
  try {
    const actor = req.user;
    if (!actor) {
      return next(new UnauthorizedError('Authentication is required'));
    }
    if (!actor.schoolId) {
      return next(new ForbiddenError('This action requires a school-scoped account'));
    }
    // requireTenantScope: schoolId verified from JWT — service layer validates resource ownership
    req.tenantSchoolId = actor.schoolId;
    next();
  } catch (error) {
    next(error);
  }
}
