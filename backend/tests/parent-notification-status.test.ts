import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ParentIdentityService } from '../src/services/parent-identity.service.js';
import { AuthService } from '../src/services/auth.service.js';
import {
  UserRole,
  ParentNotificationStatusResponse,
  ParentNotificationHistoryItem,
} from '@school-bus/shared';
import { ValidationError } from '../src/middlewares/error.middleware.js';

describe('Parent Notification Status & Opt-out (Micro-phase 9.4)', () => {
  const app = createApp();

  const schoolIdA = '111e4567-e89b-12d3-a456-426614174001';
  const schoolIdB = '999e4567-e89b-12d3-a456-426614174999';
  const parentIdA = '222e4567-e89b-12d3-a456-426614174002';
  const studentIdA = '333e4567-e89b-12d3-a456-426614174003';
  const notificationIdA = '444e4567-e89b-12d3-a456-426614174004';

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

  const tokenAdminA = AuthService.generateToken(adminUserA);
  const tokenAdminB = AuthService.generateToken(adminUserB);

  const mockNotificationStatus: ParentNotificationStatusResponse = {
    parent: {
      id: parentIdA,
      fullName: 'Vikram Sharma',
      phone: '+919876543210',
      relationship: 'FATHER',
      notificationsEnabled: true,
      optedOutAt: null,
      optOutReason: null,
    },
    student: {
      id: studentIdA,
      fullName: 'Aarav Sharma',
      admissionNumber: 'ADM-2026-0042',
      classGrade: 'Class 5',
      section: 'A',
    },
    deliverySummary: {
      totalDispatches: 12,
      sentCount: 2,
      deliveredCount: 6,
      readCount: 3,
      failedCount: 1,
      deliverySuccessRatePercent: 92,
    },
    linkActivity: {
      totalTokensIssued: 3,
      activeTokenCount: 1,
      totalAccessCount: 15,
      lastAccessedAt: new Date().toISOString(),
      recentAccesses: [
        {
          id: 'acc-1',
          tokenId: 'tok-1',
          accessedAt: new Date().toISOString(),
          ipAddress: '49.36.120.15',
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
        },
      ],
    },
    recentNotifications: [
      {
        id: notificationIdA,
        channel: 'WHATSAPP',
        templateName: 'WELCOME_ONBOARDING',
        messageBody: 'Welcome to school bus tracking for Aarav',
        status: 'DELIVERED',
        deliveredAt: new Date().toISOString(),
        readAt: null,
        failureReason: null,
        createdAt: new Date().toISOString(),
      },
    ],
  };

  describe('1. GET /:schoolId/parents/:parentId/notification-status', () => {
    it('retrieves comprehensive notification status and link activity for authorized school admin', async () => {
      vi.spyOn(ParentIdentityService, 'getParentNotificationStatus').mockResolvedValue(
        mockNotificationStatus
      );

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/parents/${parentIdA}/notification-status`)
        .set('Authorization', `Bearer ${tokenAdminA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.parent.fullName).toBe('Vikram Sharma');
      expect(res.body.data.deliverySummary.deliverySuccessRatePercent).toBe(92);
      expect(res.body.data.linkActivity.totalAccessCount).toBe(15);
      expect(res.body.data.recentNotifications).toHaveLength(1);
    });

    it('enforces multi-tenant isolation with 403 Forbidden for cross-school status check', async () => {
      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/parents/${parentIdA}/notification-status`)
        .set('Authorization', `Bearer ${tokenAdminB}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. PATCH /:schoolId/parents/:parentId/notification-preferences', () => {
    it('updates parent notification preferences to opted-out with reason', async () => {
      const mockPrefResponse = {
        parentId: parentIdA,
        notificationsEnabled: false,
        optedOutAt: new Date().toISOString(),
        optOutReason: 'Parent requested temporary pause during family vacation',
      };

      vi.spyOn(
        ParentIdentityService,
        'updateParentNotificationPreferences'
      ).mockResolvedValue(mockPrefResponse);

      const res = await request(app)
        .patch(`/api/v1/schools/${schoolIdA}/parents/${parentIdA}/notification-preferences`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          notificationsEnabled: false,
          optOutReason: 'Parent requested temporary pause during family vacation',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.notificationsEnabled).toBe(false);
      expect(res.body.data.optOutReason).toContain('temporary pause');
    });

    it('enforces multi-tenant isolation with 403 Forbidden on preference updates', async () => {
      const res = await request(app)
        .patch(`/api/v1/schools/${schoolIdA}/parents/${parentIdA}/notification-preferences`)
        .set('Authorization', `Bearer ${tokenAdminB}`)
        .send({
          notificationsEnabled: false,
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('3. Opt-out enforcement in notification dispatches', () => {
    it('rejects sending outbound notice if parent is opted out with 422', async () => {
      vi.spyOn(ParentIdentityService, 'sendParentNotice').mockRejectedValue(
        new ValidationError('Cannot dispatch notification: parent has opted out of notifications')
      );

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/parents/${parentIdA}/communications`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          messageBody: 'Bus will arrive 10 minutes early today.',
          templateName: 'BUS_DELAY_NOTICE',
          channel: 'WHATSAPP',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('opted out of notifications');
    });
  });

  describe('4. POST /:schoolId/notifications/:notificationId/status', () => {
    it('updates outbound notification delivery status', async () => {
      const mockUpdated: ParentNotificationHistoryItem = {
        id: notificationIdA,
        channel: 'WHATSAPP',
        templateName: 'WELCOME_ONBOARDING',
        messageBody: 'Welcome to school bus tracking for Aarav',
        status: 'READ',
        deliveredAt: new Date().toISOString(),
        readAt: new Date().toISOString(),
        failureReason: null,
        createdAt: new Date().toISOString(),
      };

      vi.spyOn(
        ParentIdentityService,
        'updateNotificationDeliveryStatus'
      ).mockResolvedValue(mockUpdated);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/notifications/${notificationIdA}/status`)
        .set('Authorization', `Bearer ${tokenAdminA}`)
        .send({
          status: 'READ',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('READ');
      expect(res.body.data.readAt).toBeDefined();
    });

    it('enforces multi-tenant isolation with 403 Forbidden for cross-school status updates', async () => {
      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/notifications/${notificationIdA}/status`)
        .set('Authorization', `Bearer ${tokenAdminB}`)
        .send({
          status: 'DELIVERED',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });
});
