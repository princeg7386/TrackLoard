import { describe, it, expect, vi } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import {
  UserRole,
  ResourceDomain,
  PermissionAction,
  hasRolePermission,
  AuthUserPayload,
  DriverAuthPayload,
  ParentLiveTrackingSession,
  TripStatus,
  RouteType,
} from '@school-bus/shared';
import {
  TenantIsolationService,
} from '../src/services/tenant-isolation.service.js';
import {
  requireTenantScope,
  requireDriverTripScope,
  requireParentStudentScope,
  requirePermission,
} from '../src/middlewares/tenant-isolation.middleware.js';
import { authenticateToken } from '../src/middlewares/auth.middleware.js';
import { authenticateDriver } from '../src/middlewares/driver-auth.middleware.js';
import { authenticateParentTrackingToken } from '../src/middlewares/parent-token.middleware.js';
import { errorHandler } from '../src/middlewares/error.middleware.js';
import { AuthService } from '../src/services/auth.service.js';
import { DriverAuthService } from '../src/services/driver-auth.service.js';
import { ParentIdentityService } from '../src/services/parent-identity.service.js';

describe('Roles, RBAC & Multi-Tenant Isolation (Micro-phase 4.4)', () => {
  const schoolA = '111e4567-e89b-12d3-a456-426614174001';
  const schoolB = '999e4567-e89b-12d3-a456-426614174999';

  const adminSchoolA: AuthUserPayload = {
    id: 'aaa11111-e89b-12d3-a456-426614174001',
    schoolId: schoolA,
    email: 'admin.a@dpa.edu.in',
    fullName: 'Admin School A',
    role: UserRole.SCHOOL_ADMIN,
  };

  const coordinatorSchoolA: AuthUserPayload = {
    id: 'aaa22222-e89b-12d3-a456-426614174002',
    schoolId: schoolA,
    email: 'coord.a@dpa.edu.in',
    fullName: 'Coordinator School A',
    role: UserRole.TRANSPORT_COORDINATOR,
  };

  const superAdminUser: AuthUserPayload = {
    id: 'aaa00000-e89b-12d3-a456-426614174000',
    schoolId: null,
    email: 'super@platform.internal',
    fullName: 'Platform Super Admin',
    role: UserRole.SUPER_ADMIN,
  };

  const driverSchoolA: DriverAuthPayload = {
    id: 'drv11111-e89b-12d3-a456-426614174001',
    schoolId: schoolA,
    phone: '+919876543210',
    fullName: 'Ramesh Singh',
    role: UserRole.DRIVER,
    assignedBusId: 'bus11111-e89b-12d3-a456-426614174001',
  };

  const parentSessionChildA: ParentLiveTrackingSession = {
    isValid: true,
    expiresAt: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    parent: {
      id: 'par11111-e89b-12d3-a456-426614174001',
      fullName: 'Sunita Sharma',
      relationship: 'MOTHER',
      phone: '+919876543210',
    },
    student: {
      id: 'stu11111-e89b-12d3-a456-426614174001',
      schoolId: schoolA,
      fullName: 'Aarav Sharma',
      admissionNumber: 'SCH-2026-089',
      classGrade: '5',
      section: 'A',
    },
    school: {
      id: schoolA,
      name: 'Delhi Public Academy',
      code: 'DPA-ND',
      timezone: 'Asia/Kolkata',
    },
    activeTrip: null,
  };

  describe('1. Role Permissions Matrix (hasRolePermission)', () => {
    it('SUPER_ADMIN has unrestricted permissions on all domains', () => {
      expect(hasRolePermission(UserRole.SUPER_ADMIN, ResourceDomain.SCHOOL, PermissionAction.DELETE)).toBe(true);
      expect(hasRolePermission(UserRole.SUPER_ADMIN, ResourceDomain.AUDIT_LOG, PermissionAction.READ)).toBe(true);
    });

    it('SCHOOL_ADMIN has full access in their tenant', () => {
      expect(hasRolePermission(UserRole.SCHOOL_ADMIN, ResourceDomain.FLEET_BUS, PermissionAction.CREATE)).toBe(true);
      expect(hasRolePermission(UserRole.SCHOOL_ADMIN, ResourceDomain.DRIVER, PermissionAction.DELETE)).toBe(true);
      expect(hasRolePermission(UserRole.SCHOOL_ADMIN, ResourceDomain.REPORT, PermissionAction.READ)).toBe(true);
    });

    it('TRANSPORT_COORDINATOR cannot delete school tenant or audit logs', () => {
      expect(hasRolePermission(UserRole.TRANSPORT_COORDINATOR, ResourceDomain.FLEET_BUS, PermissionAction.UPDATE)).toBe(true);
      expect(hasRolePermission(UserRole.TRANSPORT_COORDINATOR, ResourceDomain.SCHOOL, PermissionAction.DELETE)).toBe(false);
      expect(hasRolePermission(UserRole.TRANSPORT_COORDINATOR, ResourceDomain.AUDIT_LOG, PermissionAction.DELETE)).toBe(false);
    });

    it('DRIVER is restricted to operational telemetry, trip execution, and attendance', () => {
      expect(hasRolePermission(UserRole.DRIVER, ResourceDomain.TELEMETRY, PermissionAction.CREATE)).toBe(true);
      expect(hasRolePermission(UserRole.DRIVER, ResourceDomain.ATTENDANCE, PermissionAction.CREATE)).toBe(true);
      expect(hasRolePermission(UserRole.DRIVER, ResourceDomain.TRIP, PermissionAction.EXECUTE)).toBe(true);
      expect(hasRolePermission(UserRole.DRIVER, ResourceDomain.SCHOOL, PermissionAction.DELETE)).toBe(false);
      expect(hasRolePermission(UserRole.DRIVER, ResourceDomain.REPORT, PermissionAction.CREATE)).toBe(false);
    });

    it('PARENT is restricted to reading student tracking and trip data', () => {
      expect(hasRolePermission(UserRole.PARENT, ResourceDomain.TELEMETRY, PermissionAction.READ)).toBe(true);
      expect(hasRolePermission(UserRole.PARENT, ResourceDomain.TRIP, PermissionAction.READ)).toBe(true);
      expect(hasRolePermission(UserRole.PARENT, ResourceDomain.FLEET_BUS, PermissionAction.DELETE)).toBe(false);
      expect(hasRolePermission(UserRole.PARENT, ResourceDomain.DRIVER, PermissionAction.CREATE)).toBe(false);
    });
  });

  describe('2. School-to-School Multi-Tenant Isolation', () => {
    it('authorizes School Admin accessing their own school tenant', () => {
      expect(() => {
        TenantIsolationService.assertSchoolTenantIsolation(adminSchoolA, schoolA);
      }).not.toThrow();
    });

    it('rejects School Admin attempting cross-tenant access with ForbiddenError', () => {
      expect(() => {
        TenantIsolationService.assertSchoolTenantIsolation(adminSchoolA, schoolB);
      }).toThrowError(/not authorized to access or modify data belonging to another school/);
    });

    it('authorizes Super Admin to access any school tenant', () => {
      expect(() => {
        TenantIsolationService.assertSchoolTenantIsolation(superAdminUser, schoolA);
        TenantIsolationService.assertSchoolTenantIsolation(superAdminUser, schoolB);
      }).not.toThrow();
    });

    it('rejects Driver attempting cross-tenant access to another school', () => {
      expect(() => {
        TenantIsolationService.assertSchoolTenantIsolation(driverSchoolA, schoolB);
      }).toThrowError(/Driver is not registered under the target school tenant/);
    });
  });

  describe('3. Driver Bus & Trip Assignment Isolation', () => {
    it('authorizes Driver for their assigned bus', () => {
      expect(() => {
        TenantIsolationService.assertDriverBusAssignment(
          driverSchoolA,
          'bus11111-e89b-12d3-a456-426614174001'
        );
      }).not.toThrow();
    });

    it('rejects Driver for an unassigned bus with 403 ForbiddenError', () => {
      expect(() => {
        TenantIsolationService.assertDriverBusAssignment(
          driverSchoolA,
          'bus99999-e89b-12d3-a456-426614174999'
        );
      }).toThrowError(/is not assigned to operate Bus ID/);
    });
  });

  describe('4. Parent Student Scope & Data Sanitization', () => {
    it('authorizes Parent for their linked child student ID', () => {
      expect(() => {
        TenantIsolationService.assertParentStudentScope(
          parentSessionChildA,
          'stu11111-e89b-12d3-a456-426614174001'
        );
      }).not.toThrow();
    });

    it('rejects Parent attempting to access another student record', () => {
      expect(() => {
        TenantIsolationService.assertParentStudentScope(
          parentSessionChildA,
          'stu99999-e89b-12d3-a456-426614174999'
        );
      }).toThrowError(/only authorized to access live tracking and attendance for your linked child/);
    });

    it('sanitizes student details removing administrative fields for parent view', () => {
      const rawStudent = {
        id: 'stu11111-e89b-12d3-a456-426614174001',
        schoolId: schoolA,
        fullName: 'Aarav Sharma',
        admissionNumber: 'SCH-2026-089',
        classGrade: '5',
        section: 'A',
        internalAdminNotes: 'Sensitive administrative tag',
        tuitionFeeStatus: 'PAID',
      };

      const sanitized = TenantIsolationService.filterSafeStudentViewForParent(rawStudent);
      expect(sanitized.fullName).toBe('Aarav Sharma');
      expect((sanitized as any).internalAdminNotes).toBeUndefined();
      expect((sanitized as any).tuitionFeeStatus).toBeUndefined();
    });
  });

  describe('5. Express Middlewares End-to-End Integration', () => {
    const testApp = express();
    testApp.use(express.json());

    // Route 1: School Tenant Guard
    testApp.get(
      '/api/v1/schools/:schoolId/buses',
      authenticateToken,
      requireTenantScope('params', 'schoolId'),
      (_req: Request, res: Response) => {
        res.json({ success: true, message: 'Authorized access to school buses' });
      }
    );

    // Route 2: Driver Trip Guard
    testApp.post(
      '/api/v1/driver/trips/:tripId/start',
      authenticateDriver,
      requireDriverTripScope('params', 'tripId'),
      (_req: Request, res: Response) => {
        res.json({ success: true, message: 'Driver started trip successfully' });
      }
    );

    // Route 3: Parent Student Scope Guard
    testApp.get(
      '/api/v1/parent/students/:studentId/attendance',
      authenticateParentTrackingToken,
      requireParentStudentScope('params', 'studentId'),
      (_req: Request, res: Response) => {
        res.json({ success: true, message: 'Authorized access to child attendance' });
      }
    );

    // Route 4: Permission Guard
    testApp.delete(
      '/api/v1/admin/schools/:schoolId',
      authenticateToken,
      requirePermission(ResourceDomain.SCHOOL, PermissionAction.DELETE),
      (_req: Request, res: Response) => {
        res.json({ success: true, message: 'School deleted' });
      }
    );

    testApp.use(errorHandler);

    it('School Admin accessing own school -> 200 OK', async () => {
      const token = AuthService.generateToken(adminSchoolA);
      const res = await request(testApp)
        .get(`/api/v1/schools/${schoolA}/buses`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('School Admin accessing another school -> 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminSchoolA);
      const res = await request(testApp)
        .get(`/api/v1/schools/${schoolB}/buses`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
      expect(res.body.error.message).toContain('another school');
    });

    it('Driver starting an assigned trip -> 200 OK', async () => {
      const driverToken = DriverAuthService.generateDriverToken(driverSchoolA);
      const assignedTripId = 'trip1111-e89b-12d3-a456-426614174001';

      const tripSpy = vi
        .spyOn(TenantIsolationService, 'assertDriverTripAssignment')
        .mockResolvedValueOnce();

      const res = await request(testApp)
        .post(`/api/v1/driver/trips/${assignedTripId}/start`)
        .set('Authorization', `Bearer ${driverToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      tripSpy.mockRestore();
    });

    it('Parent accessing authorized student -> 200 OK', async () => {
      const rawToken = 'trk_sample_valid_token';
      const verifySpy = vi
        .spyOn(ParentIdentityService, 'verifyTrackingToken')
        .mockResolvedValueOnce(parentSessionChildA);

      const res = await request(testApp)
        .get(`/api/v1/parent/students/stu11111-e89b-12d3-a456-426614174001/attendance?token=${rawToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      verifySpy.mockRestore();
    });

    it('Parent accessing another student -> 403 Forbidden', async () => {
      const rawToken = 'trk_sample_valid_token';
      const verifySpy = vi
        .spyOn(ParentIdentityService, 'verifyTrackingToken')
        .mockResolvedValueOnce(parentSessionChildA);

      const res = await request(testApp)
        .get(`/api/v1/parent/students/stu99999-e89b-12d3-a456-426614174999/attendance?token=${rawToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('linked child');

      verifySpy.mockRestore();
    });

    it('Coordinator attempting to DELETE school -> 403 Forbidden (RBAC)', async () => {
      const coordToken = AuthService.generateToken(coordinatorSchoolA);
      const res = await request(testApp)
        .delete(`/api/v1/admin/schools/${schoolA}`)
        .set('Authorization', `Bearer ${coordToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
    });

    it('Super Admin attempting to DELETE school -> 200 OK (RBAC)', async () => {
      const superToken = AuthService.generateToken(superAdminUser);
      const res = await request(testApp)
        .delete(`/api/v1/admin/schools/${schoolA}`)
        .set('Authorization', `Bearer ${superToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
