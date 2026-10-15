import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestIdMiddleware } from './middlewares/request-id.middleware.js';
import { createRateLimiter } from './middlewares/rate-limiter.middleware.js';
import healthRouter from './routes/health.routes.js';
import apiRouter from './routes/api.routes.js';
import { errorHandler, NotFoundError } from './middlewares/error.middleware.js';
import { env } from './config/env.js';

export function createApp(): Express {
  const app = express();

  // 1. Trust Reverse Proxy (when deployed behind Cloudflare, AWS ALB, Nginx)
  if (env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  // 2. Request ID Tagging & Logging
  app.use(requestIdMiddleware);

  // 3. Strict Security Headers (HSTS, CSP, Frameguard, NoSniff)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
          connectSrc: ["'self'", 'https:'],
          fontSrc: ["'self'", 'https:'],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
      frameguard: {
        action: 'deny',
      },
      noSniff: true,
      referrerPolicy: {
        policy: 'strict-origin-when-cross-origin',
      },
    })
  );

  const allowedOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || env.NODE_ENV !== 'production') {
          callback(null, true);
        } else {
          callback(new Error('CORS Not Allowed'));
        }
      },
      credentials: true,
    })
  );

  // 4. Global API Rate Limiter (e.g. 120 req/min in prod, high in test)
  if (env.NODE_ENV !== 'test') {
    app.use(
      createRateLimiter({
        windowMs: 60 * 1000,
        maxRequests: 120,
      })
    );
  }

  // 4. Request Parsers
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // 5. Mount Routes & API Versioning
  app.use(healthRouter); // /health
  app.use('/api/v1', apiRouter); // /api/v1

  // 6. Root Info Route
  app.get('/', (req: Request, res: Response) => {
    res.json({
      service: env.APP_NAME,
      status: 'operational',
      version: '1.0.0',
      requestId: req.id,
      health: '/health',
      api: '/api/v1',
      apiV1: '/api/v1',
    });
  });

  // 7. 404 Handler
  app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
  });

  // 8. Centralized Error Handler
  app.use(errorHandler);

  return app;
}

export default createApp();

