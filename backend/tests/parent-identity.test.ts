import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from '../src/app.js';
import { ParentIdentityService } from '../src/services/parent-identity.service.js';
import { normalizeIndianPhoneNumber, TripStatus, RouteType } from '@school-bus/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Parent Identity & Secure Tracking Tokens (Micro-phase 4.3)', () => {
  const app = createApp();

  const mockSchoolId = '111e4567-e89b-12d3-a456-426614174001';
  const mockParentId = '222e4567-e89b-12d3-a456-426614174002';
  const mockStudentId = '333e4567-e89b-12d3-a456-426614174003';
  const mockStopId = '444e4567-e89b-12d3-a456-426614174004';
  const mockTripId = '555e4567-e89b-12d3-a456-426614174005';

  const mockParentRecord = {
    id: mockParentId,
    schoolId: mockSchoolId,
    studentId: mockStudentId,
    fullName: 'Sunita Sharma',
    relationship: 'MOTHER',
    phone: '+919876543210',
    email: 'sunita.sharma@example.in',
    student: {
      id: mockStudentId,
      schoolId: mockSchoolId,
      fullName: 'Aarav Sharma',
      admissionNumber: 'SCH-2026-089',
      classGrade: '5',
      section: 'A',
      rollNumber: '14',
      emergencyContactPhone: '+919876543210',
    },
    school: {
      id: mockSchoolId,
      name: 'Delhi Public Academy',
      code: 'DPA-ND',
      city: 'New Delhi',
      timezone: 'Asia/Kolkata',
    },
    pickupStop: {
      id: mockStopId,
      stopName: 'Sector 14 Community Gate',
      sequenceOrder: 3,
      scheduledTime: '07:35:00',
      latitude: 28.6139,
      longitude: 77.209,
      geofenceRadiusMeters: 300,
    },
  };

  const mockLiveSession = {
    isValid: true,
    expiresAt: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    parent: {
      id: mockParentId,
      fullName: 'Sunita Sharma',
      relationship: 'MOTHER',
      phone: '+919876543210',
    },
    student: mockParentRecord.student,
    school: mockParentRecord.school,
    pickupStop: mockParentRecord.pickupStop,
    activeTrip: {
      id: mockTripId,
      routeId: '666e4567-e89b-12d3-a456-426614174006',
      routeName: 'Route 4 - South Delhi Express',
      routeType: RouteType.MORNING_PICKUP,
      status: TripStatus.IN_TRANSIT,
      busNumber: 'Bus 04',
      registrationNumber: 'DL-01-AB-1234',
      driverName: 'Ramesh Kumar Singh',
      driverPhone: '+919811223344',
      delayMinutes: 0,
      currentStopSequence: 2,
      lastGpsLocation: {
        latitude: 28.612,
        longitude: 77.205,
        speedKmh: 34,
        bearingDegrees: 85,
        recordedAt: new Date().toISOString(),
      },
    },
  };

  describe('1. Token Utilities & Cryptography', () => {
    it('generates high-entropy secure tokens with trk_ prefix', () => {
      const token1 = ParentIdentityService.generateSecureToken();
      const token2 = ParentIdentityService.generateSecureToken();

      expect(token1.startsWith('trk_')).toBe(true);
      expect(token2.startsWith('trk_')).toBe(true);
      expect(token1).not.toBe(token2);
      expect(token1.length).toBeGreaterThan(25);
    });

    it('consistently hashes tokens with SHA-256', () => {
      const raw = 'trk_test_token_abc_123';
      const hash1 = ParentIdentityService.hashToken(raw);
      const hash2 = ParentIdentityService.hashToken(raw);
      const hashWithSpace = ParentIdentityService.hashToken('  trk_test_token_abc_123  ');

      expect(hash1).toBe(hash2);
      expect(hash1).toBe(hashWithSpace);
      expect(hash1).toHaveLength(64); // SHA-256 hex is 64 characters
    });

    it('generates standardized tracking URLs', () => {
      const token = 'trk_sample_xyz';
      const url = ParentIdentityService.generateTrackingUrl(token);
      expect(url).toContain('/track/trk_sample_xyz');

      const customUrl = ParentIdentityService.generateTrackingUrl(token, 'https://bus.myschool.edu/t');
      expect(customUrl).toBe('https://bus.myschool.edu/t/trk_sample_xyz');
    });

    it('normalizes Indian phone numbers correctly for WhatsApp lookup', () => {
      expect(normalizeIndianPhoneNumber('9876543210')).toBe('+919876543210');
      expect(normalizeIndianPhoneNumber('09876543210')).toBe('+919876543210');
      expect(normalizeIndianPhoneNumber('+91 98765 43210')).toBe('+919876543210');
      expect(normalizeIndianPhoneNumber('919876543210')).toBe('+919876543210');
    });
  });

  describe('2. WhatsApp Phone Identity Resolution', () => {
    it('POST /api/v1/parent/identity/lookup validates phone requirement', async () => {
      const res = await request(app).post('/api/v1/parent/identity/lookup').send({});
      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('POST /api/v1/parent/identity/lookup returns matched student relationships', async () => {
      const lookupSpy = vi
        .spyOn(ParentIdentityService, 'lookupParentsByPhone')
        .mockResolvedValueOnce([mockParentRecord]);

      const res = await request(app)
        .post('/api/v1/parent/identity/lookup')
        .send({ phone: '9876543210', schoolId: mockSchoolId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.count).toBe(1);
      expect(res.body.data.records[0].parent_name || res.body.data.records[0].fullName).toBe('Sunita Sharma');
      expect(res.body.data.records[0].student.fullName).toBe('Aarav Sharma');
      expect(res.body.data.records[0].pickupStop.stopName).toBe('Sector 14 Community Gate');

      lookupSpy.mockRestore();
    });
  });

  describe('3. Token Generation & Revocation Lifecycle', () => {
    it('POST /api/v1/parent/token/generate validates required fields', async () => {
      const res = await request(app).post('/api/v1/parent/token/generate').send({
        parentId: 'not-a-uuid',
      });
      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('POST /api/v1/parent/token/generate creates secure token and tracking URL', async () => {
      const rawToken = 'trk_mock_token_1234567890';
      const createSpy = vi
        .spyOn(ParentIdentityService, 'createTrackingToken')
        .mockResolvedValueOnce({
          id: '999e4567-e89b-12d3-a456-426614174099',
          token: rawToken,
          trackingUrl: `http://localhost:3000/track/${rawToken}`,
          expiresAt: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
          purpose: 'LIVE_TRACKING',
          parentId: mockParentId,
          studentId: mockStudentId,
          schoolId: mockSchoolId,
          tripId: mockTripId,
        });

      const res = await request(app)
        .post('/api/v1/parent/token/generate')
        .send({
          parentId: mockParentId,
          studentId: mockStudentId,
          schoolId: mockSchoolId,
          tripId: mockTripId,
          ttlHours: 12,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBe(rawToken);
      expect(res.body.data.trackingUrl).toContain(rawToken);
      expect(res.body.data.studentId).toBe(mockStudentId);

      createSpy.mockRestore();
    });

    it('POST /api/v1/parent/token/revoke revokes specific token', async () => {
      const revokeSpy = vi
        .spyOn(ParentIdentityService, 'revokeToken')
        .mockResolvedValueOnce(true);

      const res = await request(app)
        .post('/api/v1/parent/token/revoke')
        .send({ token: 'trk_sample_to_revoke', reason: 'Driver route reassigned' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.revoked).toBe(true);

      revokeSpy.mockRestore();
    });

    it('POST /api/v1/parent/token/revoke-student revokes all tokens for a student', async () => {
      const revokeStudentSpy = vi
        .spyOn(ParentIdentityService, 'revokeAllTokensForStudent')
        .mockResolvedValueOnce(3);

      const res = await request(app)
        .post('/api/v1/parent/token/revoke-student')
        .send({
          studentId: mockStudentId,
          schoolId: mockSchoolId,
          reason: 'Parent updated emergency contact phone',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.revokedCount).toBe(3);

      revokeStudentSpy.mockRestore();
    });
  });

  describe('4. Live Tracking Session Verification (Web View)', () => {
    it('GET /api/v1/parent/track/:token requires valid token', async () => {
      const verifySpy = vi
        .spyOn(ParentIdentityService, 'verifyTrackingToken')
        .mockResolvedValueOnce(mockLiveSession);

      const res = await request(app).get('/api/v1/parent/track/trk_valid_token_123');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.student.fullName).toBe('Aarav Sharma');
      expect(res.body.data.activeTrip.busNumber).toBe('Bus 04');
      expect(res.body.data.activeTrip.driverName).toBe('Ramesh Kumar Singh');
      expect(res.body.data.activeTrip.lastGpsLocation.speedKmh).toBe(34);

      verifySpy.mockRestore();
    });

    it('GET /api/v1/parent/track?token=... works via query parameter', async () => {
      const verifySpy = vi
        .spyOn(ParentIdentityService, 'verifyTrackingToken')
        .mockResolvedValueOnce(mockLiveSession);

      const res = await request(app).get('/api/v1/parent/track?token=trk_valid_query_token');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.student.admissionNumber).toBe('SCH-2026-089');

      verifySpy.mockRestore();
    });

    it('GET /api/v1/parent/track with missing token returns 401 Unauthorized', async () => {
      const res = await request(app).get('/api/v1/parent/track');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UnauthorizedError');
    });
  });

  describe('5. Database Migration Schema Check', () => {
    it('verifies 007_parent_tracking_tokens.sql migration exists with required indexes and triggers', () => {
      const migrationFile = path.join(
        __dirname,
        '../src/db/migrations/007_parent_tracking_tokens.sql'
      );
      expect(fs.existsSync(migrationFile)).toBe(true);
      const sql = fs.readFileSync(migrationFile, 'utf-8');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS parent_tracking_tokens');
      expect(sql).toContain('token_hash');
      expect(sql).toContain('expires_at');
      expect(sql).toContain('revoked_at');
      expect(sql).toContain('access_count');
      expect(sql).toContain('idx_parent_tokens_hash');
      expect(sql).toContain('idx_parent_tokens_student');
    });
  });
});
