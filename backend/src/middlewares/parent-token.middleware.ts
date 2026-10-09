import { Request, Response, NextFunction } from 'express';
import { ParentLiveTrackingSession } from '@school-bus/shared';
import { ParentIdentityService } from '../services/parent-identity.service.js';
import { UnauthorizedError } from './error.middleware.js';

// Extend Express Request to include parent live tracking session
declare global {
  namespace Express {
    interface Request {
      parentTrackingSession?: ParentLiveTrackingSession;
    }
  }
}

/**
 * Middleware to authenticate and authorize live tracking requests via secure token
 */
export async function authenticateParentTrackingToken(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    let token: string | undefined;

    // 1. Check path parameters (:token)
    if (req.params.token) {
      token = typeof req.params.token === 'string' ? req.params.token : req.params.token[0];
    }

    // 2. Check query string (?token=...)
    if (!token && typeof req.query.token === 'string') {
      token = req.query.token;
    }

    // 3. Check custom header (X-Tracking-Token)
    const customHeader = req.headers['x-tracking-token'];
    if (!token && customHeader) {
      token = Array.isArray(customHeader) ? customHeader[0] : customHeader;
    }

    // 4. Check Authorization Bearer header
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next(new UnauthorizedError('Parent live tracking token is missing'));
    }

    const session = await ParentIdentityService.verifyTrackingToken(token);
    req.parentTrackingSession = session;
    next();
  } catch (error) {
    next(error);
  }
}
