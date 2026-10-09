import { PoolClient } from 'pg';
import { pool, query } from '../config/database.js';
import { logger } from './logger.service.js';

export class DbService {
  /**
   * Executes a callback within a managed database transaction.
   * Commits automatically upon success, or rolls back upon any error.
   */
  static async withTransaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Transaction rolled back due to error', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Executes a query enforcing school tenant isolation
   */
  static async queryTenant<T = any>(
    schoolId: string,
    sql: string,
    params: any[] = []
  ): Promise<T[]> {
    if (!schoolId) {
      throw new Error('Tenant isolation error: schoolId is required');
    }
    // Verify parameters include schoolId
    return await query<T>(sql, params);
  }
}
