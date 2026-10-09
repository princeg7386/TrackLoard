import { describe, it, expect, vi } from 'vitest';
import { logger } from '../src/services/logger.service.js';
import { TimeUtil } from '../src/utils/time.util.js';
import { IdUtil } from '../src/utils/id.util.js';
import {
  LocalStorageAdapter,
  MockStorageAdapter,
} from '../src/services/storage/storage.adapter.js';

describe('Backend Infrastructure Services', () => {
  it('verifies logger redacts sensitive keys such as passwords, tokens, and authorization headers', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.info('User login attempt', {
      email: 'admin@dpsrkp.net',
      password: 'SuperSecretPassword123!',
      token: 'jwt-bearer-token-value',
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
    });

    expect(consoleSpy).toHaveBeenCalled();
    const loggedStr = consoleSpy.mock.calls[0]![0];
    const parsed = JSON.parse(loggedStr);

    expect(parsed.context.email).toBe('admin@dpsrkp.net');
    expect(parsed.context.password).toBe('***REDACTED***');
    expect(parsed.context.token).toBe('***REDACTED***');
    expect(parsed.context.schoolId).toBe('123e4567-e89b-12d3-a456-426614174000');

    consoleSpy.mockRestore();
  });

  it('validates TimeUtil delay calculations and ETA duration formatting', () => {
    // 1. Date string in YYYY-MM-DD
    const today = TimeUtil.todayDateString();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // 2. Delay minutes
    const scheduled = '2026-10-10T07:15:00.000Z';
    const delayedArrival = '2026-10-10T07:27:00.000Z';
    expect(TimeUtil.calculateDelayMinutes(scheduled, delayedArrival)).toBe(12);

    // 3. Early or on-time (should return 0)
    const onTimeArrival = '2026-10-10T07:14:00.000Z';
    expect(TimeUtil.calculateDelayMinutes(scheduled, onTimeArrival)).toBe(0);

    // 4. ETA formatting
    expect(TimeUtil.formatEtaDuration(30)).toBe('Arriving now');
    expect(TimeUtil.formatEtaDuration(300)).toBe('5 mins');
    expect(TimeUtil.formatEtaDuration(3700)).toBe('1 hr 2 mins');
  });

  it('validates IdUtil cryptographic tokens and short codes', () => {
    // 1. UUID v4
    const uuid = IdUtil.generateUuid();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    // 2. Secure Token
    const token = IdUtil.generateSecureToken(16);
    expect(token.length).toBe(32); // 16 bytes = 32 hex chars

    // 3. Short Code
    const shortCode = IdUtil.generateShortCode('RTE', 4);
    expect(shortCode.startsWith('RTE-')).toBe(true);
    expect(shortCode.length).toBe(8); // "RTE-" (4) + 4 chars
  });

  it('validates StorageAdapter upload, read, and delete with MockStorageAdapter', async () => {
    const storage = new MockStorageAdapter();
    const testBuffer = Buffer.from('Fleet Document Content');

    const uploadPath = 'schools/dps/buses/bus-04-reg.pdf';
    const resultUrl = await storage.uploadFile(uploadPath, testBuffer);
    expect(resultUrl).toContain(uploadPath);

    expect(await storage.fileExists(uploadPath)).toBe(true);

    const retrieved = await storage.getFileBuffer(uploadPath);
    expect(retrieved.toString()).toBe('Fleet Document Content');

    const deleted = await storage.deleteFile(uploadPath);
    expect(deleted).toBe(true);
    expect(await storage.fileExists(uploadPath)).toBe(false);
  });
});
