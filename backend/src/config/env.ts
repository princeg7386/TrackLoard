import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  APP_NAME: z.string().default('School Bus Tracking System'),
  APP_TIMEZONE: z.string().default('Asia/Kolkata'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:4000'),

  // Database
  DATABASE_URL: z.string().default('postgresql://postgres:postgrespassword@localhost:5432/school_bus_tracker?schema=public'),
  DB_MAX_CONNECTIONS: z.coerce.number().int().default(20),

  // Security & Auth
  JWT_SECRET: z.string().default('development-jwt-secret-key-min-32-chars-strictly-for-testing-only'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  PARENT_TOKEN_SECRET: z.string().default('development-parent-secret-key-min-32-chars-strictly-for-testing-only'),
  PARENT_TOKEN_TTL_HOURS: z.coerce.number().int().default(12),
  PARENT_TRACKING_BASE_URL: z.string().default('http://localhost:3000/track'),

  // Providers & GIS
  ROUTING_PROVIDER: z.enum(['osrm', 'valhalla', 'google_maps']).default('osrm'),
  OSRM_BASE_URL: z.string().default('https://router.project-osrm.org'),
  MESSAGING_PROVIDER: z.enum(['mock', 'meta_cloud', 'twilio']).default('mock'),

  // Telemetry Tuning
  GEOFENCE_RADIUS_METERS: z.coerce.number().int().default(300),
  MAX_SPEED_THRESHOLD_KMH: z.coerce.number().int().default(120),
  SPEEDING_ALERT_THRESHOLD_KMH: z.coerce.number().int().default(60),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

function loadConfig(): EnvConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('âŒ Invalid environment variables configuration:', parsed.error.format());
    throw new Error('Environment configuration validation failed');
  }
  return parsed.data;
}

export const env = loadConfig();

