import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ParentIdentityService } from '../src/services/parent-identity.service.js';
import { AuthService } from '../src/services/auth.service.js';
import {
  UserRole,
  ParentOnboardInviteResponse,
  ParentOnboardVerificationResponse,
  ParentOnboardConfirmResponse,
  ParentLiveTrackingSession,
} from '@school-bus/shared';

describe('WhatsApp Parent Onboarding (Micro-phase 9.3)', () => {
  const app = createApp();

  const schoolIdA = '111e4567-e89b-12d3-a456-426614174001';
  const schoolIdB = '999e4567-e89b-12d3-a456-426614174999';
  const parentIdA = '222e4567-e89b-12d3-a456-426614174002';
  const studentIdA = '333e4567-e89b-12d3-a456-426614174003';

  const adminUserA = {
    id: 'aaa11111-e89b-12d3-a456-426614174001',
    schoolId: schoolIdA,
    email: 'admin.a@dpa.edu.in',
    fullName: 'Principal Sharma',
    role: UserRole.SCHOOL_ADMIN,
  };

  const adminUserB = {
    id: 'bbb22222-e89b-12d3-a456-426614174002',
    schoolId: schoolIdB,
    email: 'admin.b@other.edu.in',
    fullName: 'Other Admin',
    role: UserRole.SCHOOL_ADMIN,
  };

  const mockSession: ParentLiveTrackingSession = {
    isValid: true,
    expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
    tokenPrefix: 'trk_onboard',
    parent: {
      id: parentIdA,
      fullName: 'Vikram Sharma',
      relationship: 'FATHER',
      phone: '+919876543210',
    },
    student: {
      id: studentIdA,
      fullName: 'Aarav Sharma',
      admissionNumber: 'ADM-2026-0042',
      classGrade: 'Class 5',
      section: 'A',
      rollNumber: '14',
      emergencyContactPhone: '+919876543210',
    },
    school: {
      id: schoolIdA,
      name: 'Delhi Public Academy',
      code: 'DPA-ND',
      timezone: 'Asia/Kolkata',
    },
    pickupStop: {
      id: 'stop-01',
      stopName: 'Greenwood Heights Gate 1',
      sequenceOrder: 1,
      scheduledTime: '07:30:00',
      latitude: 28.6139,
      longitude: 77.209,
      geofenceRadiusMeters: 300,
    },
    activeTrip: null,
  };

  const mockInviteResponse: ParentOnboardInviteResponse = {
    token: 'trk_raw_secure_token_1234567890',
    tokenPrefix: 'trk_raw_sec',
    expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
    inviteUrl: 'http://localhost:3000/track?token=trk_raw_secure_token_1234567890',
    messageBody: 'Namaste Vikram Sharma! Tap your tracking link to activate.',
    notificationId: 'notif-onboard-01',
    parent: {
      id: parentIdA,
      fullName: 'Vikram Sharma',
      phone: '+919876543210',
    },
    student: {
      id: studentIdA,
      fullName: 'Aarav Sharma',
      admissionNumber: 'ADM-2026-0042',
    },
  };

  describe('1. POST /api/v1/schools/:schoolId/parents/:parentId/onboard (Invitation Flow)', () => {
    it('dispatches onboarding invite to parent WhatsApp and returns 201 Created', async () => {
      const token = AuthService.generateToken(adminUserA);
      const spy = vi
        .spyOn(ParentIdentityService, 'sendOnboardingInvite')
        .mockResolvedValueOnce(mockInviteResponse);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/parents/${parentIdA}/onboard`)
        .set('Authorization', `Bearer ${token}`)
        .send({ ttlHours: 72 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tokenPrefix).toBe('trk_raw_sec');
      expect(res.body.data.inviteUrl).toContain('/track?token=');
      expect(res.body.data.parent.fullName).toBe('Vikram Sharma');

      expect(spy).toHaveBeenCalledWith(schoolIdA, parentIdA, {
        ttlHours: 72,
        customNote: undefined,
        adminUserId: adminUserA.id,
      });

      spy.mockRestore();
    });

    it('rejects cross-school invitation attempt with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserB);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/parents/${parentIdA}/onboard`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. GET /api/v1/parent/onboard/verify (Identity Verification)', () => {
    it('returns VALID verification status for an active onboarding token', async () => {
      const mockValid: ParentOnboardVerificationResponse = {
        status: 'VALID',
        session: mockSession,
        phoneLast4: '3210',
      };

      const spy = vi
        .spyOn(ParentIdentityService, 'verifyOnboardingToken')
        .mockResolvedValueOnce(mockValid);

      const res = await request(app)
        .get('/api/v1/parent/onboard/verify?token=trk_valid_token_123');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('VALID');
      expect(res.body.data.session.student.fullName).toBe('Aarav Sharma');
      expect(res.body.data.phoneLast4).toBe('3210');

      spy.mockRestore();
    });

    it('returns EXPIRED status gracefully when token has expired', async () => {
      const mockExpired: ParentOnboardVerificationResponse = {
        status: 'EXPIRED',
        errorCode: 'TOKEN_EXPIRED',
        errorMessage: 'This live tracking link has expired',
        session: null,
      };

      const spy = vi
        .spyOn(ParentIdentityService, 'verifyOnboardingToken')
        .mockResolvedValueOnce(mockExpired);

      const res = await request(app)
        .get('/api/v1/parent/onboard/verify?token=trk_expired_token_456');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('EXPIRED');
      expect(res.body.data.errorCode).toBe('TOKEN_EXPIRED');

      spy.mockRestore();
    });

    it('returns REVOKED status when token has been revoked by admin', async () => {
      const mockRevoked: ParentOnboardVerificationResponse = {
        status: 'REVOKED',
        errorCode: 'TOKEN_REVOKED',
        errorMessage: 'This live tracking link has been revoked',
        session: null,
      };

      const spy = vi
        .spyOn(ParentIdentityService, 'verifyOnboardingToken')
        .mockResolvedValueOnce(mockRevoked);

      const res = await request(app)
        .get('/api/v1/parent/onboard/verify?token=trk_revoked_token_789');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('REVOKED');
      expect(res.body.data.errorCode).toBe('TOKEN_REVOKED');

      spy.mockRestore();
    });

    it('returns INVALID status when token does not exist', async () => {
      const mockInvalid: ParentOnboardVerificationResponse = {
        status: 'INVALID',
        errorCode: 'TOKEN_INVALID',
        errorMessage: 'Invalid tracking link or link does not exist',
        session: null,
      };

      const spy = vi
        .spyOn(ParentIdentityService, 'verifyOnboardingToken')
        .mockResolvedValueOnce(mockInvalid);

      const res = await request(app)
        .get('/api/v1/parent/onboard/verify?token=trk_non_existent');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('INVALID');
      expect(res.body.data.errorCode).toBe('TOKEN_INVALID');

      spy.mockRestore();
    });
  });

  describe('3. POST /api/v1/parent/onboard/confirm (Activation Confirmation)', () => {
    it('successfully confirms activation and returns session details', async () => {
      const mockConfirm: ParentOnboardConfirmResponse = {
        confirmed: true,
        activatedAt: new Date().toISOString(),
        session: mockSession,
      };

      const spy = vi
        .spyOn(ParentIdentityService, 'confirmOnboardingActivation')
        .mockResolvedValueOnce(mockConfirm);

      const res = await request(app)
        .post('/api/v1/parent/onboard/confirm')
        .send({
          token: 'trk_valid_token_123',
          phoneLast4: '3210',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.confirmed).toBe(true);
      expect(res.body.data.session.student.fullName).toBe('Aarav Sharma');

      expect(spy).toHaveBeenCalledWith('trk_valid_token_123', '3210');
      spy.mockRestore();
    });

    it('rejects confirmation with missing token with 422 Validation Error', async () => {
      const res = await request(app)
        .post('/api/v1/parent/onboard/confirm')
        .send({
          phoneLast4: '3210',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });
});
