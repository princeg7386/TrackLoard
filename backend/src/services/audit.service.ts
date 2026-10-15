import { PoolClient } from 'pg';
import { query } from '../config/database.js';
import { AuditLog, PaginatedResult } from '@school-bus/shared';
import { logger } from './logger.service.js';

export interface RecordAuditLogParams {
  schoolId: string;
  userId?: string | null;
  userRole?: string;
  action: string;
  entityType: string;
  entityId: string;
  diffJson?: Record<string, any>;
  ipAddress?: string;
  client?: PoolClient;
  throwOnError?: boolean;
}

export interface QueryAuditLogsParams {
  schoolId: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  page?: number;
  pageSize?: number;
}

export class AuditService {
  /**
   * Alias for logAction ensuring backward compatibility with AuditService.log calls
   */
  public static log = AuditService.logAction;

  /**
   * Records a security-relevant or operational action into the immutable audit trail
   */
  public static async logAction(params: RecordAuditLogParams): Promise<string> {
    const {
      schoolId,
      userId = null,
      userRole = 'SYSTEM',
      action,
      entityType,
      entityId,
      diffJson = {},
      ipAddress = '0.0.0.0',
      client,
      throwOnError = false,
    } = params;

    // Sanitize diffJson to ensure passwords or raw credentials are never persisted to audit logs
    const sanitizedDiff = this.sanitizeAuditDiff(diffJson);

    const sql = `
      INSERT INTO audit_logs (
        school_id,
        user_id,
        user_role,
        action,
        entity_type,
        entity_id,
        diff_json,
        ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `;

    try {
      let logId = '';
      if (client) {
        const res = await client.query<{ id: string }>(sql, [
          schoolId,
          userId,
          userRole,
          action,
          entityType,
          entityId,
          JSON.stringify(sanitizedDiff),
          ipAddress,
        ]);
        logId = res.rows[0]?.id || '';
      } else {
        const rows = await query<{ id: string }>(sql, [
          schoolId,
          userId,
          userRole,
          action,
          entityType,
          entityId,
          JSON.stringify(sanitizedDiff),
          ipAddress,
        ]);
        logId = rows[0]?.id || '';
      }

      logger.info('Audit log recorded', {
        logId,
        schoolId,
        action,
        entityType,
        entityId,
      });

      return logId;
    } catch (error: any) {
      logger.error('Failed to write audit log entry', {
        error: error.message,
        action,
        entityType,
        entityId,
        schoolId,
      });
      if (throwOnError || client) {
        throw error;
      }
      return '';
    }
  }

  /**
   * Retrieves paginated audit logs scoped strictly to a school tenant
   */
  public static async querySchoolAuditLogs(
    params: QueryAuditLogsParams
  ): Promise<PaginatedResult<AuditLog>> {
    const {
      schoolId,
      entityType,
      entityId,
      action,
      page = 1,
      pageSize = 20,
    } = params;

    const offset = (page - 1) * pageSize;
    const whereClauses = ['school_id = $1'];
    const queryParams: any[] = [schoolId];
    let paramIndex = 2;

    if (entityType) {
      whereClauses.push(`entity_type = $${paramIndex++}`);
      queryParams.push(entityType);
    }

    if (entityId) {
      whereClauses.push(`entity_id = $${paramIndex++}`);
      queryParams.push(entityId);
    }

    if (action) {
      whereClauses.push(`action = $${paramIndex++}`);
      queryParams.push(action);
    }

    const whereSql = whereClauses.join(' AND ');

    const countSql = `SELECT COUNT(*)::int AS total FROM audit_logs WHERE ${whereSql}`;
    const countResult = await query<{ total: number }>(countSql, queryParams);
    const total = countResult[0]?.total || 0;

    const dataSql = `
      SELECT 
        id,
        school_id AS "schoolId",
        user_id AS "userId",
        user_role AS "userRole",
        action,
        entity_type AS "entityType",
        entity_id AS "entityId",
        diff_json AS "diffJson",
        ip_address AS "ipAddress",
        created_at AS "createdAt"
      FROM audit_logs
      WHERE ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `;

    queryParams.push(pageSize, offset);
    const items = await query<AuditLog>(dataSql, queryParams);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    };
  }

  /**
   * Deeply sanitizes sensitive fields from audit payload diffs
   */
  private static sanitizeAuditDiff(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;

    const sensitiveKeys = [
      'password',
      'password_hash',
      'passwordHash',
      'pin',
      'pin_hash',
      'pinHash',
      'token',
      'token_hash',
      'tokenHash',
      'secret',
      'authorization',
      'jwt',
    ];

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeAuditDiff(item));
    }

    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (sensitiveKeys.some((k) => key.toLowerCase().includes(k))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeAuditDiff(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}

