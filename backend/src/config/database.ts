import { Pool, PoolConfig } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const poolConfig: PoolConfig = {
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgrespassword@localhost:5432/school_bus_tracker',
  max: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('[PostGIS Pool Error] Unexpected client error:', err);
});

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development' && duration > 100) {
    console.warn(`[Slow Query ${duration}ms]: ${text}`);
  }
  return res.rows;
}

export async function verifyPostGisConnection(): Promise<{
  connected: boolean;
  postgisVersion?: string;
  error?: string;
}> {
  try {
    const rows = await query<{ version: string }>(
      'SELECT PostGIS_Full_Version() as version;'
    );
    return {
      connected: true,
      postgisVersion: rows[0]?.version,
    };
  } catch (error: any) {
    return {
      connected: false,
      error: error?.message || 'Database connection error',
    };
  }
}
