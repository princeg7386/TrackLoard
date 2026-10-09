import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiResponse } from '@school-bus/shared';
import { env } from '../config/env.js';

export class AppError extends Error {
  public statusCode: number;
  public details?: any;

  constructor(message: string, statusCode: number = 400, details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(message, 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized access') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden: insufficient permissions') {
    super(message, 403);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message: string = 'Rate limit exceeded, please retry later') {
    super(message, 429);
  }
}

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.id;

  // 1. Handle Zod Schema Validation Errors
  if (err instanceof ZodError) {
    const payload: ApiResponse = {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request schema validation failed',
        details: err.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
        requestId,
      },
      requestId,
      timestamp: new Date().toISOString(),
    };
    res.status(422).json(payload);
    return;
  }

  // 2. Handle Custom Domain / Application Errors
  if (err instanceof AppError) {
    const payload: ApiResponse = {
      success: false,
      error: {
        code: err.constructor.name,
        message: err.message,
        details: err.details,
        requestId,
      },
      requestId,
      timestamp: new Date().toISOString(),
    };
    res.status(err.statusCode).json(payload);
    return;
  }

  // 3. Handle Uncaught Server Exceptions
  console.error(`[Unhandled Server Exception] [ReqID: ${requestId}]:`, err);
  const payload: ApiResponse = {
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal error occurred. Please retry shortly.',
      details: env.NODE_ENV === 'development' ? { stack: err?.stack } : undefined,
      requestId,
    },
    requestId,
    timestamp: new Date().toISOString(),
  };
  res.status(500).json(payload);
}
