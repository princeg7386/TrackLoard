import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { sanitizeString } from '@school-bus/shared';

export interface RequestValidators {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

/**
 * Deeply sanitizes string properties in an object (trims, removes dangerous characters)
 */
function sanitizeObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeString(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  if (typeof obj === 'object') {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      cleaned[key] = sanitizeObject(value);
    }
    return cleaned;
  }
  return obj;
}

/**
 * Express middleware to sanitize and validate request body, query, and params against Zod schemas
 */
export function validateRequest(validators: RequestValidators) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (validators.body) {
        const sanitizedBody = sanitizeObject(req.body);
        req.body = await validators.body.parseAsync(sanitizedBody);
      }

      if (validators.query) {
        const sanitizedQuery = sanitizeObject(req.query);
        req.query = await validators.query.parseAsync(sanitizedQuery);
      }

      if (validators.params) {
        const sanitizedParams = sanitizeObject(req.params);
        req.params = await validators.params.parseAsync(sanitizedParams);
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(error);
      } else {
        next(error);
      }
    }
  };
}
