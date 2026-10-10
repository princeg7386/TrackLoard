import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ParentIdentityService } from '../src/services/parent-identity.service.js';
import { AuthService } from '../src/services/auth.service.js';
import {
  UserRole,
  ParentAssignmentDetails,
  ParentCommunicationItem,
} from '@school-bus/shared';

describe('Parent Student Assignment & Communication History (Micro-phase 9.2)', () => {
  const app = createApp();

  const schoolIdA = '111e4567-e89b-12d3-a456-426614174001';
  const schoolIdB = '999e4567-e89b-12d3-a456-426614174999';
  const parentIdA = '222e4567-e89b-12d3-a456-426614174002';
  const studentIdA = '333e4567-e89b-12d3-a456-426614174003';
  const studentIdB = '444e4567-e89b-12d3-a456-426614174004';

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
    fullName: 'Other School Admin',
    role: UserRole.SCHOOL_ADMIN,
  };

  const mockAssignment: ParentAssignmentDetails = {
    parent: {
      id: parentIdA,
      schoolId: schoolIdA,
      studentId: studentIdA,
      fullName: 'Vikram Sharma',
      relationship: 'FATHER',
      phone: '+919876543210',
      email: 'vikram.sharma@example.in',
      whatsAppStatus: 'ACTIVE_TOKEN',
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
    transport: {
      busId: 'bus-01',
      busNumber: 'BUS-01',
      registrationNumber: 'DL-01-AB-1234',
      routeId: 'route-01',
      routeName: 'North Campus Express',
      routeCode: 'R-NORTH-01',
      pickupStopId: 'stop-01',
      pickupStopName: 'Greenwood Heights Gate 1',
      pickupScheduledTime: '07:30:00',
      pickupLatitude: 28.6139,
      pickupLongitude: 77.209,
      dropStopId: 'stop-01',
      dropStopName: 'Greenwood Heights Gate 1',
      dropScheduledTime: '14:30:00',
    },
    activeTrackingToken: {
      id: 'token-01',
      tokenPrefix: 'trk_abc123',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      accessCount: 4,
      lastAccessedAt: new Date().toISOString(),
      isRevoked: false,
    },
  };

  const mockCommunications: ParentCommunicationItem[] = [
    {
      id: 'notif-01',
      type: 'NOTIFICATION',
      channel: 'WHATSAPP',
      title: 'Welcome & Onboarding Invite',
      templateName: 'WELCOME_ONBOARDING',
      messageBody: 'Welcome to Delhi Public Academy transport tracker! Aarav Sharma is assigned to Bus BUS-01.',
      status: 'DELIVERED',
      recipientPhone: '+919876543210',
      createdAt: new Date().toISOString(),
      failureReason: null,
    },
    {
      id: 'token-tok1',
      type: 'TOKEN_EVENT',
      channel: 'SYSTEM',
      title: 'Live Tracking Link Generated',
      templateName: 'LIVE_TRACKING',
      messageBody: 'Token prefix trk_abc123... generated. Valid until tomorrow. Views so far: 4.',
      status: 'ACTIVE',
      recipientPhone: '+919876543210',
      createdAt: new Date(Date.now() - 3600000).toISOString(),
    },
  ];

  describe('1. GET /api/v1/schools/:schoolId/parents/:parentId/assignment', () => {
    it('successfully retrieves full assignment details for a parent', async () => {
      const token = AuthService.generateToken(adminUserA);
      const spy = vi
        .spyOn(ParentIdentityService, 'getParentAssignmentDetails')
        .mockResolvedValueOnce(mockAssignment);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/parents/${parentIdA}/assignment`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.parent.fullName).toBe('Vikram Sharma');
      expect(res.body.data.student.fullName).toBe('Aarav Sharma');
      expect(res.body.data.transport.busNumber).toBe('BUS-01');
      expect(res.body.data.activeTrackingToken?.tokenPrefix).toBe('trk_abc123');

      expect(spy).toHaveBeenCalledWith(schoolIdA, parentIdA);
      spy.mockRestore();
    });

    it('enforces multi-tenant isolation (403 Forbidden for cross-school assignment view)', async () => {
      const token = AuthService.generateToken(adminUserB);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/parents/${parentIdA}/assignment`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. PUT /api/v1/schools/:schoolId/parents/:parentId/relink', () => {
    it('successfully re-links a parent to another authorized student', async () => {
      const token = AuthService.generateToken(adminUserA);
      const updatedAssignment = {
        ...mockAssignment,
        parent: { ...mockAssignment.parent, studentId: studentIdB },
        student: { ...mockAssignment.student, id: studentIdB, fullName: 'Diya Sharma' },
      };

      const spy = vi
        .spyOn(ParentIdentityService, 'relinkParentStudent')
        .mockResolvedValueOnce(updatedAssignment);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/parents/${parentIdA}/relink`)
        .set('Authorization', `Bearer ${token}`)
        .send({ studentId: studentIdB });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.student.id).toBe(studentIdB);
      expect(res.body.data.student.fullName).toBe('Diya Sharma');

      expect(spy).toHaveBeenCalledWith(schoolIdA, parentIdA, studentIdB, adminUserA.id);
      spy.mockRestore();
    });

    it('rejects invalid or missing studentId payload with 422 Validation Error', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .put(`/api/v1/schools/${schoolIdA}/parents/${parentIdA}/relink`)
        .set('Authorization', `Bearer ${token}`)
        .send({ studentId: 'not-a-valid-uuid' });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe('3. GET /api/v1/schools/:schoolId/parents/:parentId/communications', () => {
    it('returns parent communication history with notifications and token lifecycle events', async () => {
      const token = AuthService.generateToken(adminUserA);
      const spy = vi
        .spyOn(ParentIdentityService, 'getParentCommunicationHistory')
        .mockResolvedValueOnce(mockCommunications);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/parents/${parentIdA}/communications`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].type).toBe('NOTIFICATION');
      expect(res.body.data[1].type).toBe('TOKEN_EVENT');

      expect(spy).toHaveBeenCalledWith(schoolIdA, parentIdA);
      spy.mockRestore();
    });
  });

  describe('4. POST /api/v1/schools/:schoolId/parents/:parentId/communications', () => {
    it('dispatches outbound WhatsApp notice to parent and returns 201 Created', async () => {
      const token = AuthService.generateToken(adminUserA);
      const newNotice: ParentCommunicationItem = {
        id: 'notif-new-99',
        type: 'NOTIFICATION',
        channel: 'WHATSAPP',
        title: 'Welcome & Onboarding Invite',
        templateName: 'WELCOME_ONBOARDING',
        messageBody: 'Hello Mr. Sharma, welcome to DPA live tracking!',
        status: 'SENT',
        recipientPhone: '+919876543210',
        createdAt: new Date().toISOString(),
      };

      const spy = vi
        .spyOn(ParentIdentityService, 'sendParentNotice')
        .mockResolvedValueOnce(newNotice);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/parents/${parentIdA}/communications`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          templateName: 'WELCOME_ONBOARDING',
          messageBody: 'Hello Mr. Sharma, welcome to DPA live tracking!',
          channel: 'WHATSAPP',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.messageBody).toBe('Hello Mr. Sharma, welcome to DPA live tracking!');
      expect(res.body.data.status).toBe('SENT');

      expect(spy).toHaveBeenCalledWith(schoolIdA, parentIdA, {
        templateName: 'WELCOME_ONBOARDING',
        messageBody: 'Hello Mr. Sharma, welcome to DPA live tracking!',
        channel: 'WHATSAPP',
      });
      spy.mockRestore();
    });

    it('rejects notice with empty messageBody with 422 Validation Error', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolIdA}/parents/${parentIdA}/communications`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          templateName: 'WELCOME_ONBOARDING',
          messageBody: '',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });
});
