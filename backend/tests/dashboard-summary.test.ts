import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { DashboardService } from '../src/services/dashboard.service.js';
import { AuthService } from '../src/services/auth.service.js';
import { UserRole } from '@school-bus/shared';

describe('School Admin Dashboard Summary (Micro-phase 5.4)', () => {
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

  const mockSummary = {
    schoolId: schoolIdA,
    metrics: {
      totalBuses: 12,
      totalDrivers: 10,
      totalRoutes: 8,
      totalStudents: 340,
      activeTripsCount: 4,
      activeIncidentsCount: 0,
      activeDelaysCount: 1,
    },
    transportStatus: {
      totalTripsToday: 8,
      scheduledTrips: 2,
      inProgressTrips: 4,
      completedTrips: 2,
      cancelledTrips: 0,
      morningPickupCount: 4,
      eveningDropCount: 4,
    },
    alertSummary: {
      openIncidents: 0,
      activeSos: 0,
      delaysToday: 1,
      notificationsSentToday: 128,
      criticalAlertsList: [],
    },
    recentActivity: [
      {
        id: 'act-1',
        action: 'TRIP_STARTED',
        entityType: 'TRIP',
        description: 'Bus trip started by driver.',
        userRole: 'DRIVER',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'act-2',
        action: 'PARENT_TRACKING_ACCESSED',
        entityType: 'PARENT',
        description: 'Parent accessed secure live tracking web link.',
        userRole: 'PARENT',
        createdAt: new Date().toISOString(),
      },
    ],
  };

  describe('GET /api/v1/schools/:schoolId/dashboard/summary', () => {
    it('returns 200 OK with aggregated metrics for authorized school admin', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi
        .spyOn(DashboardService, 'getSchoolDashboardSummary')
        .mockResolvedValueOnce(mockSummary);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/dashboard/summary`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.metrics.totalBuses).toBe(12);
      expect(res.body.data.metrics.totalStudents).toBe(340);
      expect(res.body.data.transportStatus.inProgressTrips).toBe(4);
      expect(res.body.data.recentActivity.length).toBe(2);

      spy.mockRestore();
    });

    it('rejects cross-tenant access to another school with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdB}/dashboard/summary`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
    });

    it('returns 401 Unauthorized when Bearer token is missing', async () => {
      const res = await request(app).get(`/api/v1/schools/${schoolIdA}/dashboard/summary`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });
});
