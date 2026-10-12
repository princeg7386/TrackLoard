import { Pool, PoolConfig, PoolClient } from 'pg';
import { env } from './env.js';

const poolConfig: PoolConfig = {
  connectionString: env.DATABASE_URL,
  max: env.DB_MAX_CONNECTIONS,
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
  if (env.NODE_ENV === 'development' && duration > 100) {
    console.warn(`[Slow Query ${duration}ms]: ${text}`);
  }
  return res.rows;
}

/**
 * Execute operations within an atomic PostgreSQL transaction.
 * Automatically acquires client, executes BEGIN, commits on success,
 * rolls back on error, and safely releases client back to the pool.
 */
export async function transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
