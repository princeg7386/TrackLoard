import { describe, it, expect } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { requestIdMiddleware } from '../src/middlewares/request-id.middleware.js';
import {
  createRateLimiter,
  InMemoryRateLimiterStore,
} from '../src/middlewares/rate-limiter.middleware.js';
import { errorHandler, NotFoundError } from '../src/middlewares/error.middleware.js';

describe('API Quality (Request IDs, Rate Limiter & Central Error Handler)', () => {
  it('propagates or generates X-Request-ID header on all requests', async () => {
    const app = createApp();

    // 1. Auto-generated request ID
    const res1 = await request(app).get('/api/v1');
    expect(res1.status).toBe(200);
    expect(res1.headers['x-request-id']).toBeDefined();

    // 2. Client-provided request ID
    const customId = 'client-custom-req-id-12345';
    const res2 = await request(app)
      .get('/api/v1')
      .set('X-Request-ID', customId);
    expect(res2.status).toBe(200);
    expect(res2.headers['x-request-id']).toBe(customId);
  });

  it('attaches requestId to error response payloads from central error handler', async () => {
    const app = createApp();
    const customId = 'error-tracking-req-999';

    const res = await request(app)
      .get('/api/v1/invalid-route-for-testing')
      .set('X-Request-ID', customId);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.requestId).toBe(customId);
    expect(res.body.error.requestId).toBe(customId);
    expect(res.body.error.code).toBe('NotFoundError');
  });

  it('enforces rate limiting and returns 429 when threshold is exceeded', async () => {
    const testApp = express();
    const testStore = new InMemoryRateLimiterStore();

    testApp.use(requestIdMiddleware);
    // Rate limit: 3 requests per 10 seconds
    testApp.use(
      createRateLimiter(
        {
          windowMs: 10 * 1000,
          maxRequests: 3,
          message: 'Rate limit test exceeded',
          keyGenerator: () => 'test-ip-key',
        },
        testStore
      )
    );

    testApp.get('/test-rate-limit', (_req: Request, res: Response) => {
      res.json({ success: true, message: 'ok' });
    });

    testApp.use(errorHandler);

    // Request 1: OK (Remaining 2)
    const r1 = await request(testApp).get('/test-rate-limit');
    expect(r1.status).toBe(200);
    expect(r1.headers['x-ratelimit-remaining']).toBe('2');

    // Request 2: OK (Remaining 1)
    const r2 = await request(testApp).get('/test-rate-limit');
    expect(r2.status).toBe(200);
    expect(r2.headers['x-ratelimit-remaining']).toBe('1');

    // Request 3: OK (Remaining 0)
    const r3 = await request(testApp).get('/test-rate-limit');
    expect(r3.status).toBe(200);
    expect(r3.headers['x-ratelimit-remaining']).toBe('0');

    // Request 4: Blocked with 429
    const r4 = await request(testApp).get('/test-rate-limit');
    expect(r4.status).toBe(429);
    expect(r4.body.success).toBe(false);
    expect(r4.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(r4.headers['retry-after']).toBeDefined();
  });
});
