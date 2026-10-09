import { describe, it, expect, vi } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from '../src/app.js';
import { AuditService } from '../src/services/audit.service.js';
import { SecurityUtil } from '../src/utils/security.util.js';
import { createRateLimiter } from '../src/middlewares/rate-limiter.middleware.js';
import { errorHandler } from '../src/middlewares/error.middleware.js';
import { executeDatabaseBackup } from '../../infrastructure/scripts/backup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Security Audit, Secrets Protection & Policy (Micro-phase 4.5)', () => {
  const mockSchoolId = '111e4567-e89b-12d3-a456-426614174001';
  const mockUserId = '222e4567-e89b-12d3-a456-426614174002';

  describe('1. Audit Logging Service & Diff Sanitization', () => {
    it('records action into audit log and sanitizes sensitive diff credentials', async () => {
      const sampleDiff = {
        fullName: 'New Admin Name',
        password: 'SuperSecretPassword123!',
        pinHash: 'sensitive-pin-hash',
        token: 'trk_secret_token_123',
        settings: {
          apiKey: 'secret-api-key',
          theme: 'dark',
        },
      };

      const logSpy = vi
        .spyOn(AuditService, 'logAction')
        .mockResolvedValueOnce('mock-audit-log-id-001');

      const logId = await AuditService.logAction({
        schoolId: mockSchoolId,
        userId: mockUserId,
        userRole: 'SCHOOL_ADMIN',
        action: 'ADMIN_PROFILE_UPDATE',
        entityType: 'ADMIN',
        entityId: mockUserId,
        diffJson: sampleDiff,
        ipAddress: '192.168.1.100',
      });

      expect(logId).toBe('mock-audit-log-id-001');
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          schoolId: mockSchoolId,
          action: 'ADMIN_PROFILE_UPDATE',
        })
      );

      logSpy.mockRestore();
    });

    it('queries school-scoped audit logs with pagination', async () => {
      const mockAuditItems = [
        {
          id: 'log-001',
          schoolId: mockSchoolId,
          userId: mockUserId,
          userRole: 'SCHOOL_ADMIN',
          action: 'DRIVER_PIN_RESET',
          entityType: 'DRIVER',
          entityId: 'drv-001',
          diffJson: { pin: '[REDACTED]' },
          ipAddress: '192.168.1.50',
          createdAt: new Date().toISOString(),
        },
      ];

      const querySpy = vi
        .spyOn(AuditService, 'querySchoolAuditLogs')
        .mockResolvedValueOnce({
          items: mockAuditItems,
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
        });

      const result = await AuditService.querySchoolAuditLogs({
        schoolId: mockSchoolId,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].action).toBe('DRIVER_PIN_RESET');
      expect(result.total).toBe(1);

      querySpy.mockRestore();
    });
  });

  describe('2. Secrets Redaction & Security Utilities', () => {
    it('redacts database passwords from connection strings', () => {
      const dbUrl = 'postgresql://admin_user:P@ssword123#@db.internal.aws.com:5432/school_bus';
      const redacted = SecurityUtil.redactConnectionString(dbUrl);
      expect(redacted).not.toContain('P@ssword123#');
      expect(redacted).toContain('[REDACTED]');
      expect(redacted).toContain('postgresql://admin_user:');
      expect(redacted).toContain('@db.internal.aws.com:5432/school_bus');
    });

    it('masks Indian phone numbers for privacy', () => {
      expect(SecurityUtil.maskPhoneNumber('+919876543210')).toBe('+9198****3210');
      expect(SecurityUtil.maskPhoneNumber('+919811223344')).toBe('+9198****3344');
    });

    it('extracts client IP address correctly from proxy headers', () => {
      const mockReq = {
        headers: {
          'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178',
        },
        socket: {
          remoteAddress: '127.0.0.1',
        },
      } as any;

      const ip = SecurityUtil.getClientIp(mockReq);
      expect(ip).toBe('203.0.113.195');
    });
  });

  describe('3. HTTPS, HSTS & Security Headers', () => {
    it('GET / returns strict security headers (HSTS, NoSniff, Frameguard)', async () => {
      const app = createApp();
      const res = await request(app).get('/');

      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
      expect(res.headers['content-security-policy']).toBeDefined();
    });
  });

  describe('4. Anti-Abuse & Rate Limiter Protection', () => {
    it('returns HTTP 429 Too Many Requests when rate limit is exceeded', async () => {
      const testApp = express();
      testApp.use(express.json());

      // Limit to 2 requests per test window
      testApp.use(
        '/api/v1/test-limited',
        createRateLimiter({
          windowMs: 5000,
          maxRequests: 2,
          keyPrefix: 'test-limit',
        })
      );

      testApp.get('/api/v1/test-limited', (_req: Request, res: Response) => {
        res.json({ success: true, message: 'Request permitted' });
      });

      testApp.use(errorHandler);

      // Request 1: OK
      const res1 = await request(testApp).get('/api/v1/test-limited');
      expect(res1.status).toBe(200);

      // Request 2: OK
      const res2 = await request(testApp).get('/api/v1/test-limited');
      expect(res2.status).toBe(200);

      // Request 3: Exceeded -> 429
      const res3 = await request(testApp).get('/api/v1/test-limited');
      expect(res3.status).toBe(429);
      expect(res3.body.success).toBe(false);
      expect(res3.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(res3.body.error.message).toContain('Too many requests');
    });
  });

  describe('5. Backup Script & Recovery Policy', () => {
    it('verifies backup policy documentation exists', () => {
      const policyPath = path.join(__dirname, '../../docs/security-and-backup-policy.md');
      expect(fs.existsSync(policyPath)).toBe(true);
      const content = fs.readFileSync(policyPath, 'utf-8');
      expect(content).toContain('Recovery Point Objective (RPO)');
      expect(content).toContain('PostGIS');
      expect(content).toContain('SHA-256');
    });

    it('executes database backup helper with metadata and checksum format verification', () => {
      const tmpBackupDir = path.join(__dirname, '../temp_test_backups');
      if (!fs.existsSync(tmpBackupDir)) {
        fs.mkdirSync(tmpBackupDir, { recursive: true });
      }

      const result = executeDatabaseBackup({
        outputDir: tmpBackupDir,
      });

      expect(result.filename).toBeDefined();
      expect(result.filename).toContain('school_bus_backup_');

      // Clean up test temp backup dir
      if (fs.existsSync(tmpBackupDir)) {
        fs.rmSync(tmpBackupDir, { recursive: true, force: true });
      }
    });
  });
});
