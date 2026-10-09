import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import healthRouter from './routes/health.routes.js';
import apiRouter from './routes/api.routes.js';
import { errorHandler, NotFoundError } from './middlewares/error.middleware.js';
import { env } from './config/env.js';

export function createApp(): Express {
  const app = express();

  // 1. Security Headers & CORS
  app.use(helmet());
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

  // 2. Request Parsers
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // 3. Mount Routes
  app.use(healthRouter); // /health
  app.use('/api/v1', apiRouter);

  // 4. Root Info Route
  app.get('/', (_req: Request, res: Response) => {
    res.json({
      service: env.APP_NAME,
      status: 'operational',
      health: '/health',
      api: '/api/v1',
    });
  });

  // 5. 404 Handler
  app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
  });

  // 6. Centralized Error Handler
  app.use(errorHandler);

  return app;
}

export default createApp();
