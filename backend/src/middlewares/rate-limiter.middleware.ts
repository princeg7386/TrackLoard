import { Request, Response, NextFunction } from 'express';

export interface RateLimiterOptions {
  windowMs: number; // Duration of window in milliseconds (e.g. 60,000 for 1 minute)
  maxRequests: number; // Maximum allowed requests in window
  message?: string;
  keyGenerator?: (req: Request) => string;
}

export interface IRateLimiterStore {
  increment(key: string, windowMs: number): Promise<{ count: number; resetTimeMs: number }>;
  reset(key: string): Promise<void>;
}

/**
 * In-Memory Sliding Window Rate Limiter Store (Default FOSS)
 */
export class InMemoryRateLimiterStore implements IRateLimiterStore {
  private hits = new Map<string, { count: number; resetTimeMs: number }>();

  async increment(
    key: string,
    windowMs: number
  ): Promise<{ count: number; resetTimeMs: number }> {
    const now = Date.now();
    const record = this.hits.get(key);

    if (!record || now > record.resetTimeMs) {
      const newRecord = { count: 1, resetTimeMs: now + windowMs };
      this.hits.set(key, newRecord);
      return newRecord;
    }

    record.count += 1;
    return record;
  }

  async reset(key: string): Promise<void> {
    this.hits.delete(key);
  }

  // Periodic memory cleanup of expired records
  cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.hits.entries()) {
      if (now > record.resetTimeMs) {
        this.hits.delete(key);
      }
    }
  }
}

const defaultStore = new InMemoryRateLimiterStore();
// Cleanup every 5 minutes
setInterval(() => defaultStore.cleanup(), 5 * 60 * 1000).unref();

/**
 * Creates an Express Rate Limiter Middleware
 */
export function createRateLimiter(options: RateLimiterOptions, store: IRateLimiterStore = defaultStore) {
  const {
    windowMs,
    maxRequests,
    message = 'Too many requests, please try again later.',
    keyGenerator = (req: Request) =>
      req.ip || (req.headers['x-forwarded-for'] as string) || 'unknown-client',
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = keyGenerator(req);
      const { count, resetTimeMs } = await store.increment(key, windowMs);

      const remaining = Math.max(0, maxRequests - count);
      const resetSeconds = Math.ceil((resetTimeMs - Date.now()) / 1000);

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', resetSeconds);

      if (count > maxRequests) {
        res.setHeader('Retry-After', resetSeconds);
        res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message,
            details: {
              limit: maxRequests,
              windowSeconds: Math.ceil(windowMs / 1000),
              retryAfterSeconds: resetSeconds,
            },
            requestId: req.id,
          },
          timestamp: new Date().toISOString(),
        });
        return;
      }

      next();
    } catch (err) {
      // In case of rate limiter storage failure, fail open to avoid service outage
      console.error('[RateLimiter Error] Failed to evaluate rate limit:', err);
      next();
    }
  };
}

/**
 * Specialized rate limiter for Admin & Driver authentication
 * Policy: 10 attempts per 15 minutes per IP
 */
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: 'Too many authentication attempts. Please try again after 15 minutes.',
});

/**
 * Specialized rate limiter for Parent token lookup and generation
 * Policy: 20 requests per 5 minutes per IP
 */
export const parentTokenRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  maxRequests: 20,
  message: 'Too many parent tracking requests. Please try again in 5 minutes.',
});

/**
 * High-throughput rate limiter for GPS telemetry ingestion
 * Policy: 60 telemetry pings per minute per driver session
 */
export const telemetryIngestRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 120, // generous allowance for rapid batches
  keyGenerator: (req: Request) =>
    req.driver?.id || req.ip || (req.headers['x-forwarded-for'] as string) || 'telemetry-client',
  message: 'Telemetry ingestion threshold exceeded.',
});

