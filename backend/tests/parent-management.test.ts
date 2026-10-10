import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ParentIdentityService } from '../src/services/parent-identity.service.js';
import { AuthService } from '../src/services/auth.service.js';
import { UserRole, ParentRecordWithStudent } from '@school-bus/shared';

describe('Parent Management & WhatsApp Directory (Micro-phase 9.1: Parent record)', () => {
  const app = createApp();

  const schoolIdA = '111e4567-e89b-12d3-a456-426614174001';
  const schoolIdB = '999e4567-e89b-12d3-a456-426614174999';

  const adminUserA = {
    id: 'aaa11111-e89b-12d3-a456-426614174001',
    schoolId: schoolIdA,
    email: 'admin.a@dpa.edu.in',
    fullName: 'Principal Sharma',
    role: UserRole.SCHOOL_ADMIN,
  };

  const coordinatorUserA = {
    id: 'ccc11111-e89b-12d3-a456-426614174001',
    schoolId: schoolIdA,
    email: 'coordinator@dpa.edu.in',
    fullName: 'Transport Lead Roy',
    role: UserRole.TRANSPORT_COORDINATOR,
  };

  const adminUserB = {
    id: 'bbb22222-e89b-12d3-a456-426614174002',
    schoolId: schoolIdB,
    email: 'admin.b@other.edu.in',
    fullName: 'Other Admin',
    role: UserRole.SCHOOL_ADMIN,
  };

  const mockParents: ParentRecordWithStudent[] = [
    {
      id: 'p-1',
      schoolId: schoolIdA,
      studentId: 's-1',
      fullName: 'Vikram Sharma',
      relationship: 'FATHER',
      phone: '+919876543210',
      email: 'vikram.sharma@example.in',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      whatsAppStatus: 'ACTIVE_TOKEN',
      activeTokenCount: 2,
      lastTokenCreatedAt: new Date().toISOString(),
      lastTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      student: {
        id: 's-1',
        fullName: 'Aarav Sharma',
        admissionNumber: 'ADM-2026-0042',
        classGrade: 'Class 5',
        section: 'A',
        rollNumber: '14',
        emergencyContactPhone: '+919876543210',
        pickupStopName: 'Greenwood Heights Gate 1',
        pickupScheduledTime: '07:30:00',
        assignedBusNumber: 'BUS-01',
        assignedRouteCode: 'R-NORTH-01',
      },
    },
    {
      id: 'p-2',
      schoolId: schoolIdA,
      studentId: 's-2',
      fullName: 'Meera Patel',
      relationship: 'MOTHER',
      phone: '+919811122233',
      email: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      whatsAppStatus: 'LINKED',
      activeTokenCount: 0,
      lastTokenCreatedAt: null,
      lastTokenExpiresAt: null,
      student: {
        id: 's-2',
        fullName: 'Rohan Patel',
        admissionNumber: 'ADM-2026-0088',
        classGrade: 'Class 8',
        section: 'B',
        rollNumber: '22',
        emergencyContactPhone: '+919811122233',
        pickupStopName: 'Sector 14 Market',
        pickupScheduledTime: '07:45:00',
        assignedBusNumber: 'BUS-03',
        assignedRouteCode: 'R-EAST-02',
      },
    },
    {
      id: 'p-3',
      schoolId: schoolIdA,
      studentId: 's-3',
      fullName: 'Sunil Verma',
      relationship: 'GUARDIAN',
      phone: '',
      email: 'sunil.v@example.in',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      whatsAppStatus: 'NOT_LINKED',
      activeTokenCount: 0,
      lastTokenCreatedAt: null,
      lastTokenExpiresAt: null,
      student: {
        id: 's-3',
        fullName: 'Ananya Verma',
        admissionNumber: 'ADM-2026-0105',
        classGrade: 'Class 3',
        section: 'C',
        rollNumber: '05',
        emergencyContactPhone: '',
        pickupStopName: null,
        pickupScheduledTime: null,
        assignedBusNumber: null,
        assignedRouteCode: null,
      },
    },
  ];

  describe('GET /api/v1/schools/:schoolId/parents', () => {
    it('returns parent records list with student info and WhatsApp status', async () => {
      const token = AuthService.generateToken(adminUserA);
      const spy = vi
        .spyOn(ParentIdentityService, 'getSchoolParents')
        .mockResolvedValueOnce(mockParents);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/parents`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);

      const first = res.body.data[0];
      expect(first.fullName).toBe('Vikram Sharma');
      expect(first.phone).toBe('+919876543210');
      expect(first.relationship).toBe('FATHER');
      expect(first.whatsAppStatus).toBe('ACTIVE_TOKEN');
      expect(first.student.fullName).toBe('Aarav Sharma');
      expect(first.student.admissionNumber).toBe('ADM-2026-0042');

      expect(spy).toHaveBeenCalledWith(schoolIdA, {
        relationship: undefined,
        search: undefined,
        whatsAppStatus: undefined,
      });

      spy.mockRestore();
    });

    it('allows transport coordinator to view parents directory', async () => {
      const token = AuthService.generateToken(coordinatorUserA);
      const spy = vi
        .spyOn(ParentIdentityService, 'getSchoolParents')
        .mockResolvedValueOnce(mockParents);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/parents`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      spy.mockRestore();
    });

    it('passes search, relationship and whatsAppStatus filters to service', async () => {
      const token = AuthService.generateToken(adminUserA);
      const filtered = [mockParents[0]];
      const spy = vi
        .spyOn(ParentIdentityService, 'getSchoolParents')
        .mockResolvedValueOnce(filtered);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/parents?search=sharma&relationship=FATHER&whatsAppStatus=ACTIVE_TOKEN`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(spy).toHaveBeenCalledWith(schoolIdA, {
        relationship: 'FATHER',
        search: 'sharma',
        whatsAppStatus: 'ACTIVE_TOKEN',
      });

      spy.mockRestore();
    });

    it('enforces multi-tenant isolation (403 Forbidden for cross-school access)', async () => {
      const token = AuthService.generateToken(adminUserB);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/parents`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/parents`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });
});
