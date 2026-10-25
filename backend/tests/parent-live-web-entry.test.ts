import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import * as db from '../src/config/database.js';
import { ParentIdentityService } from '../src/services/parent-identity.service.js';
import { parentTokenRateLimiterStore } from '../src/middlewares/rate-limiter.middleware.js';
import {
  ParentLiveTrackingSession,
  ParentLiveWebSecureEntryResponseSchema,
  TripStatus,
  RouteType,
} from '@school-bus/shared';

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
    lastGpsLocation: {
      latitude: 28.5601,
      longitude: 77.1802,
      speedKmh: 35,
      recordedAt: new Date().toISOString(),
    },
  },
};

describe('Phase 23.1: Parent Live Web Page — Secure Entry (Token Validation, Expiry, Revocation)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await parentTokenRateLimiterStore.clear?.();
  });

  describe('1. Task 1: Token Validation Domain Logic', () => {
    it('returns VALID status, full session, and school contacts for an active valid token', async () => {
      const querySpy = vi.spyOn(db, 'query');
      // 1. validateTrackingTokenForWeb token lookup
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          trip_id: null,
          purpose: 'LIVE_TRACKING',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          revoked_at: null,
          deleted_at: null,
          school_name: 'Delhi Public School',
          school_phone: '+91-11-26174567',
          school_emergency_phone: '+91-11-26179999',
        },
      ]);

      // Mock verifyTrackingToken returning full live session
      const verifySpy = vi
        .spyOn(ParentIdentityService, 'verifyTrackingToken')
        .mockResolvedValueOnce(mockLiveSession);

      const res = await ParentIdentityService.validateTrackingTokenForWeb('trk_active_valid_token');

      expect(res.status).toBe('VALID');
      expect(res.isValid).toBe(true);
      expect(res.errorCode).toBeUndefined();
      expect(res.session).not.toBeNull();
      expect(res.session?.student.fullName).toBe('Aarav Sharma');
      expect(res.schoolSupport?.schoolName).toBe('Delhi Public School');
      expect(res.schoolSupport?.supportPhone).toBe('+91-11-26174567');
      expect(res.schoolSupport?.emergencyPhone).toBe('+91-11-26179999');

      ParentLiveWebSecureEntryResponseSchema.parse(res);
      verifySpy.mockRestore();
    });

    it('returns MISSING status when no token is provided', async () => {
      const res = await ParentIdentityService.validateTrackingTokenForWeb('');
      expect(res.status).toBe('MISSING');
      expect(res.isValid).toBe(false);
      expect(res.errorCode).toBe('TOKEN_MISSING');
      expect(res.session).toBeNull();
    });

    it('returns INVALID status when token does not exist or is soft-deleted', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([]); // not found

      const res = await ParentIdentityService.validateTrackingTokenForWeb('trk_non_existent_token');
      expect(res.status).toBe('INVALID');
      expect(res.isValid).toBe(false);
      expect(res.errorCode).toBe('TOKEN_INVALID');
      expect(res.message).toContain('Invalid tracking link');
      expect(res.session).toBeNull();
    });
  });

  describe('2. Task 2: Token Expiry Domain Logic', () => {
    it('returns EXPIRED status and expiresAt timestamp when token has passed expiry', async () => {
      const pastExpiry = new Date(Date.now() - 3600000).toISOString();
      const querySpy = vi.spyOn(db, 'query');
      // validateTrackingTokenForWeb lookup
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          expires_at: pastExpiry,
          revoked_at: null,
          deleted_at: null,
          school_name: 'Delhi Public School',
          school_phone: '+91-11-26174567',
          school_emergency_phone: '+91-11-26179999',
        },
      ]);

      const res = await ParentIdentityService.validateTrackingTokenForWeb('trk_expired_token_123');

      expect(res.status).toBe('EXPIRED');
      expect(res.isValid).toBe(false);
      expect(res.errorCode).toBe('TOKEN_EXPIRED');
      expect(res.expiresAt).toBe(pastExpiry);
      expect(res.message).toContain('expired for student safety and privacy');
      expect(res.schoolSupport?.supportPhone).toBe('+91-11-26174567');
      expect(res.schoolSupport?.whatsappHelpAction).toContain('TRACK');
      expect(res.session).toBeNull();

      ParentLiveWebSecureEntryResponseSchema.parse(res);
    });

    it('verifyTrackingToken throws UnauthorizedError with TOKEN_EXPIRED reason details on expiry', async () => {
      const pastExpiry = new Date(Date.now() - 10000).toISOString();
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          expires_at: pastExpiry,
          revoked_at: null,
          deleted_at: null,
        },
      ]);

      try {
        await ParentIdentityService.verifyTrackingToken('trk_expired_direct');
        expect.unreachable('Should have thrown UnauthorizedError');
      } catch (err: any) {
        expect(err.statusCode).toBe(401);
        expect(err.message).toBe('This live tracking link has expired');
        expect(err.details).toEqual(
          expect.objectContaining({
            reason: 'TOKEN_EXPIRED',
          })
        );
      }
    });
  });

  describe('3. Task 3: Token Revocation Domain Logic', () => {
    it('returns REVOKED status and revokedAt timestamp when token has been revoked', async () => {
      const revocationTime = new Date(Date.now() - 1800000).toISOString();
      const futureExpiry = new Date(Date.now() + 3600000).toISOString();
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          expires_at: futureExpiry,
          revoked_at: revocationTime,
          deleted_at: null,
          school_name: 'Delhi Public School',
          school_phone: '+91-11-26174567',
          school_emergency_phone: '+91-11-26179999',
        },
      ]);

      const res = await ParentIdentityService.validateTrackingTokenForWeb('trk_revoked_token_123');

      expect(res.status).toBe('REVOKED');
      expect(res.isValid).toBe(false);
      expect(res.errorCode).toBe('TOKEN_REVOKED');
      expect(res.revokedAt).toBe(revocationTime);
      expect(res.message).toContain('revoked by school administration');
      expect(res.schoolSupport?.emergencyPhone).toBe('+91-11-26179999');
      expect(res.session).toBeNull();

      ParentLiveWebSecureEntryResponseSchema.parse(res);
    });

    it('verifyTrackingToken throws UnauthorizedError with TOKEN_REVOKED reason details on revocation', async () => {
      const revocationTime = new Date().toISOString();
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          revoked_at: revocationTime,
          deleted_at: null,
        },
      ]);

      try {
        await ParentIdentityService.verifyTrackingToken('trk_revoked_direct');
        expect.unreachable('Should have thrown UnauthorizedError');
      } catch (err: any) {
        expect(err.statusCode).toBe(401);
        expect(err.message).toBe('This live tracking link has been revoked for security');
        expect(err.details).toEqual(
          expect.objectContaining({
            reason: 'TOKEN_REVOKED',
          })
        );
      }
    });
  });

  describe('4. REST API Endpoint: GET /api/v1/parent/track/:token/verify-entry', () => {
    it('returns 200 with structured validation payload for valid token', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          revoked_at: null,
          deleted_at: null,
          school_name: 'Delhi Public School',
          school_phone: '+91-11-26174567',
        },
      ]);

      const verifySpy = vi
        .spyOn(ParentIdentityService, 'verifyTrackingToken')
        .mockResolvedValueOnce(mockLiveSession);

      const res = await request(app).get('/api/v1/parent/track/trk_valid_entry/verify-entry');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('VALID');
      expect(res.body.data.isValid).toBe(true);
      expect(res.body.data.session.student.fullName).toBe('Aarav Sharma');

      verifySpy.mockRestore();
    });

    it('returns 200 with EXPIRED status payload for expired token', async () => {
      const pastExpiry = new Date(Date.now() - 5000).toISOString();
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          expires_at: pastExpiry,
          revoked_at: null,
          deleted_at: null,
          school_name: 'Delhi Public School',
          school_phone: '+91-11-26174567',
        },
      ]);

      const res = await request(app).get('/api/v1/parent/track/trk_expired_link/verify-entry');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('EXPIRED');
      expect(res.body.data.isValid).toBe(false);
      expect(res.body.data.errorCode).toBe('TOKEN_EXPIRED');
      expect(res.body.data.expiresAt).toBe(pastExpiry);
    });

    it('returns 200 with REVOKED status payload for revoked token', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          revoked_at: new Date().toISOString(),
          deleted_at: null,
          school_name: 'Delhi Public School',
          school_phone: '+91-11-26174567',
        },
      ]);

      const res = await request(app).get('/api/v1/parent/track/verify-entry?token=trk_revoked_link');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('REVOKED');
      expect(res.body.data.isValid).toBe(false);
      expect(res.body.data.errorCode).toBe('TOKEN_REVOKED');
    });

    it('returns 200 with MISSING status when token is omitted', async () => {
      const res = await request(app).get('/api/v1/parent/track/verify-entry');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('MISSING');
      expect(res.body.data.isValid).toBe(false);
      expect(res.body.data.errorCode).toBe('TOKEN_MISSING');
    });
  });

  describe('5. REST API Endpoint: GET /api/v1/parent/track/:token (Direct Entry)', () => {
    it('returns 401 with details.reason = TOKEN_EXPIRED when expired', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          expires_at: new Date(Date.now() - 60000).toISOString(),
          revoked_at: null,
          deleted_at: null,
        },
      ]);

      const res = await request(app).get('/api/v1/parent/track/trk_direct_expired');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('This live tracking link has expired');
      expect(res.body.error.details.reason).toBe('TOKEN_EXPIRED');
    });

    it('returns 401 with details.reason = TOKEN_REVOKED when revoked', async () => {
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([
        {
          token_id: mockTokenId,
          school_id: mockSchoolId,
          parent_id: mockParentId,
          student_id: mockStudentId,
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          revoked_at: new Date().toISOString(),
          deleted_at: null,
        },
      ]);

      const res = await request(app).get('/api/v1/parent/track/trk_direct_revoked');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toBe('This live tracking link has been revoked for security');
      expect(res.body.error.details.reason).toBe('TOKEN_REVOKED');
    });
  });
});
