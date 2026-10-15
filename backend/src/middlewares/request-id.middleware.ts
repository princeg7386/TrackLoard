import { Request, Response, NextFunction } from 'express';
import { IdUtil } from '../utils/id.util.js';

// Extend Express Request interface to include request ID
declare global {
  namespace Express {
    interface Request {
      id: string;
      startTime: number;
    }
  }
}

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Use incoming X-Request-ID if provided, else generate a new UUIDv4
  const incomingId = req.headers['x-request-id'];
  const requestId =
    typeof incomingId === 'string' && incomingId.trim().length > 0
      ? incomingId.trim()
      : IdUtil.generateUuid();

  req.id = requestId;
  req.startTime = Date.now();
  res.setHeader('X-Request-ID', requestId);

  next();
}

