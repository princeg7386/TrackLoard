import { Request, Response, NextFunction } from 'express';
import { DriverAuthPayload } from '@school-bus/shared';
import { DriverAuthService } from '../services/driver-auth.service.js';
import { UnauthorizedError, ForbiddenError } from './error.middleware.js';

// Extend Express Request to include driver session
declare global {
  namespace Express {
    interface Request {
      driver?: DriverAuthPayload;
    }
  }
}

/**
 * Middleware to authenticate requests using Driver JWT Bearer token
 */
export function authenticateDriver(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Driver authorization token is missing'));
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return next(new UnauthorizedError('Invalid authorization token format'));
  }

  try {
    const driverPayload = DriverAuthService.verifyDriverToken(token);
    req.driver = driverPayload;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware to verify that the authenticated driver is authorized to operate the target bus
 */
export function requireAssignedBus(busIdSource: 'params' | 'body' = 'params', busIdKey: string = 'busId') {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.driver) {
        throw new UnauthorizedError('Driver is not authenticated');
      }

      const busId =
        busIdSource === 'params'
          ? req.params[busIdKey]
          : req.body[busIdKey];

      if (!busId) {
        throw new ForbiddenError(`Bus identifier (${busIdKey}) is required for authorization`);
      }

      const isAuthorized = await DriverAuthService.verifyAssignedBus(req.driver.id, busId);
      if (!isAuthorized) {
        throw new ForbiddenError(
          `Forbidden: Driver '${req.driver.fullName}' is not assigned to operate Bus ID ${busId}`
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
