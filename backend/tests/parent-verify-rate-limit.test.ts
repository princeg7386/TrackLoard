import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import * as db from '../src/config/database.js';
import { ParentIdentityService } from '../src/services/parent-identity.service.js';
import { parentTokenRateLimiterStore } from '../src/middlewares/rate-limiter.middleware.js';
import { UnauthorizedError } from '../src/middlewares/error.middleware.js';
import { ParentLiveTrackingSession, TripStatus, RouteType } from '@school-bus/shared';

const mockSchoolId = '11111111-1111-1111-1111-111111111111';
const mockParentId = '22222222-2222-2222-2222-222222222222';
const mockStudentId = '33333333-3333-3333-3333-333333333333';
const mockTokenId = '44444444-4444-4444-4444-444444444444';

const mockLiveSession: ParentLiveTrackingSession = {
  isValid: true,
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  parent: {
    id: mockParentId,
    fullName: 'Pooja Verma',
    relationship: 'MOTHER',
    phone: '+919876543210',
  },
  student: {
    id: mockStudentId,
    schoolId: mockSchoolId,
    fullName: 'Aarav Sharma',
    admissionNumber: 'SCH-2026-089',
    classGrade: '5',
    section: 'B',
  },
  school: {
    id: mockSchoolId,
    name: 'Delhi Public School',
    code: 'DPS-DELHI',
    timezone: 'Asia/Kolkata',
  },
  pickupStop: {
    id: '55555555-5555-5555-5555-555555555555',
    stopName: 'Sector 4 Market',
    sequenceOrder: 2,
    scheduledTime: '07:30:00',
    latitude: 28.5678,
    longitude: 77.189,
    geofenceRadiusMeters: 150,
  },
  activeTrip: {
    id: '66666666-6666-6666-6666-666666666666',
    routeId: '77777777-7777-7777-7777-777777777777',
    routeName: 'Route 4 - South Delhi',
    routeType: RouteType.MORNING_PICKUP,
    status: TripStatus.IN_TRANSIT,
    busNumber: 'Bus 04',
    registrationNumber: 'DL-01-AB-1234',
    driverName: 'Ramesh Kumar',
    driverPhone: '+919811122233',
    delayMinutes: 0,
    currentStopSequence: 1,
  },
};

describe('SEC-001: Rate Limiting for Public Parent Token Verification Endpoints', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await parentTokenRateLimiterStore.clear?.();
  });

  describe('1. Rate Limiting Protection & Headers', () => {
    it('sets standard rate limit headers on GET /api/v1/parent/track/:token/verify-entry', async () => {
      vi.spyOn(ParentIdentityService, 'validateTrackingTokenForWeb').mockResolvedValueOnce({
        status: 'VALID',
        isValid: true,
        session: mockLiveSession,
      });

      const res = await request(app)
        .get('/api/v1/parent/track/trk_sample_token_123/verify-entry')
        .set('X-Forwarded-For', '198.51.100.10');

      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-limit']).toBe('20');
      expect(res.headers['x-ratelimit-remaining']).toBe('19');
      expect(Number(res.headers['x-ratelimit-reset'])).toBeGreaterThan(0);
    });

    it('sets standard rate limit headers on query parameter GET /api/v1/parent/track/verify-entry?token=...', async () => {
      vi.spyOn(ParentIdentityService, 'validateTrackingTokenForWeb').mockResolvedValueOnce({
        status: 'VALID',
        isValid: true,
        session: mockLiveSession,
      });

      const res = await request(app)
        .get('/api/v1/parent/track/verify-entry?token=trk_sample_query_token')
        .set('X-Forwarded-For', '198.51.100.11');

      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-limit']).toBe('20');
      expect(res.headers['x-ratelimit-remaining']).toBe('19');
      expect(Number(res.headers['x-ratelimit-reset'])).toBeGreaterThan(0);
    });
  });

  describe('2. Rate Limit Enforcement (HTTP 429)', () => {
    it('returns HTTP 429 when requests from an IP exceed 20 within window', async () => {
      const clientIp = '198.51.100.20';
      vi.spyOn(ParentIdentityService, 'validateTrackingTokenForWeb').mockResolvedValue({
        status: 'VALID',
        isValid: true,
        session: mockLiveSession,
      });

      // Send 20 requests within the limit
      for (let i = 1; i <= 20; i++) {
        const res = await request(app)
          .get('/api/v1/parent/track/trk_stress_test/verify-entry')
          .set('X-Forwarded-For', clientIp);
        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-remaining']).toBe(String(20 - i));
      }

      // Request 21 should be rejected with 429 Too Many Requests
      const blockedRes = await request(app)
        .get('/api/v1/parent/track/trk_stress_test/verify-entry')
        .set('X-Forwarded-For', clientIp);

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.headers['x-ratelimit-remaining']).toBe('0');
      expect(blockedRes.headers['retry-after']).toBeDefined();
      expect(blockedRes.body.success).toBe(false);
      expect(blockedRes.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(blockedRes.body.error.message).toContain('Too many parent tracking requests');
      expect(blockedRes.body.error.details).toEqual(
        expect.objectContaining({
          limit: 20,
          windowSeconds: 300,
          retryAfterSeconds: expect.any(Number),
        })
      );
    });

    it('executes rate limiting before calling service or database logic', async () => {
      const clientIp = '198.51.100.21';
      const validateSpy = vi.spyOn(ParentIdentityService, 'validateTrackingTokenForWeb').mockResolvedValue({
        status: 'VALID',
        isValid: true,
        session: mockLiveSession,
      });
      const dbSpy = vi.spyOn(db, 'query');

      // Consume all 20 tokens
      for (let i = 0; i < 20; i++) {
        await request(app)
          .get('/api/v1/parent/track/trk_pre_check/verify-entry')
          .set('X-Forwarded-For', clientIp);
      }

      expect(validateSpy).toHaveBeenCalledTimes(20);

      // Clear spy call counts before the 21st request
      validateSpy.mockClear();
      dbSpy.mockClear();

      // Request 21 (rate-limited)
      const res = await request(app)
        .get('/api/v1/parent/track/trk_pre_check/verify-entry')
        .set('X-Forwarded-For', clientIp);

      expect(res.status).toBe(429);
      // Service-layer validation and DB query MUST NOT have been invoked
      expect(validateSpy).not.toHaveBeenCalled();
      expect(dbSpy).not.toHaveBeenCalled();
    });

    it('does not leak raw tokens or sensitive security internals in 429 response', async () => {
      const clientIp = '198.51.100.22';
      const secretToken = 'trk_super_sensitive_raw_token_xyz987';
      vi.spyOn(ParentIdentityService, 'validateTrackingTokenForWeb').mockResolvedValue({
        status: 'VALID',
        isValid: true,
        session: mockLiveSession,
      });

      for (let i = 0; i < 20; i++) {
        await request(app)
          .get(`/api/v1/parent/track/${secretToken}/verify-entry`)
          .set('X-Forwarded-For', clientIp);
      }

      const res = await request(app)
        .get(`/api/v1/parent/track/${secretToken}/verify-entry`)
        .set('X-Forwarded-For', clientIp);

      expect(res.status).toBe(429);
      const rawBody = JSON.stringify(res.body);
      expect(rawBody).not.toContain(secretToken);
      expect(rawBody).not.toContain('sha256');
      expect(rawBody).not.toContain('sql');
      expect(rawBody).not.toContain('password');
    });
  });

  describe('3. Multi-Tenant & IP Isolation', () => {
    it('isolates rate-limit quotas per client IP so one client does not throttle another', async () => {
      const attackerIp = '198.51.100.50';
      const legitimateIp = '198.51.100.51';

      vi.spyOn(ParentIdentityService, 'validateTrackingTokenForWeb').mockResolvedValue({
        status: 'VALID',
        isValid: true,
        session: mockLiveSession,
      });

      // Attacker exhausts their quota
      for (let i = 0; i < 20; i++) {
        await request(app)
          .get('/api/v1/parent/track/trk_test/verify-entry')
          .set('X-Forwarded-For', attackerIp);
      }

      const blockedAttacker = await request(app)
        .get('/api/v1/parent/track/trk_test/verify-entry')
        .set('X-Forwarded-For', attackerIp);
      expect(blockedAttacker.status).toBe(429);

      // Legitimate client from distinct IP must NOT be blocked
      const legitimateRes = await request(app)
        .get('/api/v1/parent/track/trk_test/verify-entry')
        .set('X-Forwarded-For', legitimateIp);
      expect(legitimateRes.status).toBe(200);
      expect(legitimateRes.headers['x-ratelimit-remaining']).toBe('19');
    });

    it('does not affect unrelated parent endpoints when rate limited on verify-entry', async () => {
      const clientIp = '198.51.100.60';
      vi.spyOn(ParentIdentityService, 'validateTrackingTokenForWeb').mockResolvedValue({
        status: 'VALID',
        isValid: true,
        session: mockLiveSession,
      });

      // Exhaust verify-entry limit
      for (let i = 0; i < 20; i++) {
        await request(app)
          .get('/api/v1/parent/track/trk_test/verify-entry')
          .set('X-Forwarded-For', clientIp);
      }

      const blockedRes = await request(app)
        .get('/api/v1/parent/track/trk_test/verify-entry')
        .set('X-Forwarded-For', clientIp);
      expect(blockedRes.status).toBe(429);

      // Unrelated root route is not throttled
      const rootRes = await request(app)
        .get('/')
        .set('X-Forwarded-For', clientIp);
      expect(rootRes.status).toBe(200);
      expect(rootRes.body.status).toBe('operational');

      // Unrelated parent route (e.g. tracking feed /feed/:token) evaluates auth, not rate limited by verify-entry limiter
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockRejectedValueOnce(
        new UnauthorizedError('Invalid tracking token')
      );
      const feedRes = await request(app)
        .get('/api/v1/parent/feed/trk_arbitrary')
        .set('X-Forwarded-For', clientIp);
      // Status is 401 (token verification) rather than 429 (rate limited)
      expect(feedRes.status).toBe(401);
    });
  });

  describe('4. Token Status Contract Preservation Under Allowed Requests', () => {
    it('returns VALID contract within limit', async () => {
      vi.spyOn(ParentIdentityService, 'validateTrackingTokenForWeb').mockResolvedValueOnce({
        status: 'VALID',
        isValid: true,
        session: mockLiveSession,
      });

      const res = await request(app)
        .get('/api/v1/parent/track/valid-token/verify-entry')
        .set('X-Forwarded-For', '198.51.100.70');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('VALID');
      expect(res.body.data.isValid).toBe(true);
    });

    it('returns EXPIRED contract within limit', async () => {
      const past = new Date(Date.now() - 60000).toISOString();
      vi.spyOn(ParentIdentityService, 'validateTrackingTokenForWeb').mockResolvedValueOnce({
        status: 'EXPIRED',
        isValid: false,
        errorCode: 'TOKEN_EXPIRED',
        expiresAt: past,
        supportPhone: '+91-11-26174567',
      });

      const res = await request(app)
        .get('/api/v1/parent/track/expired-token/verify-entry')
        .set('X-Forwarded-For', '198.51.100.71');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('EXPIRED');
      expect(res.body.data.isValid).toBe(false);
      expect(res.body.data.errorCode).toBe('TOKEN_EXPIRED');
    });

    it('returns REVOKED contract within limit', async () => {
      const revokedTime = new Date().toISOString();
      vi.spyOn(ParentIdentityService, 'validateTrackingTokenForWeb').mockResolvedValueOnce({
        status: 'REVOKED',
        isValid: false,
        errorCode: 'TOKEN_REVOKED',
        revokedAt: revokedTime,
        supportPhone: '+91-11-26174567',
      });

      const res = await request(app)
        .get('/api/v1/parent/track/revoked-token/verify-entry')
        .set('X-Forwarded-For', '198.51.100.72');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('REVOKED');
      expect(res.body.data.isValid).toBe(false);
      expect(res.body.data.errorCode).toBe('TOKEN_REVOKED');
    });

    it('returns MISSING contract when token is omitted within limit', async () => {
      vi.spyOn(ParentIdentityService, 'validateTrackingTokenForWeb').mockResolvedValueOnce({
        status: 'MISSING',
        isValid: false,
        errorCode: 'TOKEN_MISSING',
      });

      const res = await request(app)
        .get('/api/v1/parent/track/verify-entry')
        .set('X-Forwarded-For', '198.51.100.73');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('MISSING');
      expect(res.body.data.isValid).toBe(false);
    });
  });
});
