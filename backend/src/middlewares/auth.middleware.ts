import { Request, Response, NextFunction } from 'express';
import { AuthUserPayload, UserRole } from '@school-bus/shared';
import { AuthService } from '../services/auth.service.js';
import {
  UnauthorizedError,
  ForbiddenError,
} from './error.middleware.js';

// Extend Express Request to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
    }
  }
}

/**
 * Middleware to authenticate requests using JWT Bearer token
 */
export function authenticateToken(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Authentication token is missing');
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    throw new UnauthorizedError('Invalid authorization token format');
  }

  try {
    const userPayload = AuthService.verifyToken(token);
    req.user = userPayload;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware to enforce Role-Based Access Control (RBAC)
 */
export function requireRoles(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('User is not authenticated');
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new ForbiddenError(
        `Forbidden: Role '${req.user.role}' is not authorized to access this resource`
      );
    }

    next();
  };
}
