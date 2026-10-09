import { describe, it, expect } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import { z } from 'zod';
import {
  normalizeIndianPhoneNumber,
  sanitizeString,
  PaginationQuerySchema,
  SchoolSchema,
} from '@school-bus/shared';
import { validateRequest } from '../src/middlewares/validate.middleware.js';
import { errorHandler } from '../src/middlewares/error.middleware.js';
import {
  sendSuccess,
  sendCreated,
  sendPaginated,
} from '../src/utils/response.util.js';

describe('Validation Middleware & Input Sanitization', () => {
  it('normalizes Indian phone numbers correctly', () => {
    expect(normalizeIndianPhoneNumber('9876543210')).toBe('+919876543210');
    expect(normalizeIndianPhoneNumber('09876543210')).toBe('+919876543210');
    expect(normalizeIndianPhoneNumber('+91 98765 43210')).toBe('+919876543210');
    expect(normalizeIndianPhoneNumber('91-98765-43210')).toBe('+919876543210');
  });

  it('sanitizes strings by trimming and stripping script tags and null bytes', () => {
    expect(sanitizeString('  Hello World   ')).toBe('Hello World');
    expect(sanitizeString('Hello\0World')).toBe('HelloWorld');
    expect(
      sanitizeString('Welcome <script>alert("hack")</script> To Bus')
    ).toBe('Welcome  To Bus');
  });

  it('validates and sanitizes HTTP requests via validateRequest middleware', async () => {
    const testApp = express();
    testApp.use(express.json());

    const TestBodySchema = z.object({
      name: z.string().min(2),
      email: z.string().email(),
    });

    testApp.post(
      '/test-validation',
      validateRequest({ body: TestBodySchema }),
      (req: Request, res: Response) => {
        sendCreated(res, req.body, 'Created successfully');
      }
    );

    testApp.use(errorHandler);

    // 1. Valid request with whitespace that should be sanitized
    const validRes = await request(testApp)
      .post('/test-validation')
      .send({
        name: '   DPS RKP   ',
        email: 'info@dpsrkp.net',
      });

    expect(validRes.status).toBe(201);
    expect(validRes.body.success).toBe(true);
    expect(validRes.body.data.name).toBe('DPS RKP'); // Sanitized & trimmed

    // 2. Invalid request (invalid email format)
    const invalidRes = await request(testApp)
      .post('/test-validation')
      .send({
        name: 'A',
        email: 'not-an-email',
      });

    expect(invalidRes.status).toBe(422);
    expect(invalidRes.body.success).toBe(false);
    expect(invalidRes.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalidRes.body.error.details.length).toBeGreaterThan(0);
  });

  it('formats standardized paginated responses with sendPaginated', async () => {
    const testApp = express();
    testApp.get('/test-pagination', (_req: Request, res: Response) => {
      const items = [{ id: 1, name: 'Bus 1' }, { id: 2, name: 'Bus 2' }];
      sendPaginated(res, items, 15, 1, 10);
    });

    const res = await request(testApp).get('/test-pagination');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items.length).toBe(2);
    expect(res.body.data.total).toBe(15);
    expect(res.body.data.totalPages).toBe(2);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.pageSize).toBe(10);
  });
});
