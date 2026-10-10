import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { DriverService } from '../src/services/driver.service.js';
import { AuthService } from '../src/services/auth.service.js';
import {
  UserRole,
  DriverTripHistoryItem,
  DriverIncidentHistoryItem,
  DriverAttendanceHistoryResponse,
  DriverFullHistoryResponse,
  DriverWithBus,
} from '@school-bus/shared';
import { NotFoundError } from '../src/middlewares/error.middleware.js';

describe('Driver History (Micro-phase 7.3: Trips, Incidents & Attendance)', () => {
  const app = createApp();

  const schoolIdA = '111e4567-e89b-12d3-a456-426614174001';
  const schoolIdB = '999e4567-e89b-12d3-a456-426614174999';
  const driverIdA = '22222222-e89b-12d3-a456-426614174001';
  const busIdA = '11111111-e89b-12d3-a456-426614174001';
  const routeIdA = '33333333-e89b-12d3-a456-426614174001';

  const adminUserA = {
    id: 'aaa11111-e89b-12d3-a456-426614174001',
    schoolId: schoolIdA,
    email: 'admin.a@dpa.edu.in',
    fullName: 'Principal Sharma',
    role: UserRole.SCHOOL_ADMIN,
  };

  const mockDriver: DriverWithBus = {
    id: driverIdA,
    schoolId: schoolIdA,
    fullName: 'Ramesh Kumar',
    phone: '+919876543210',
    licenseNumber: 'DL-RTO-2022-9901',
    licenseExpiry: '2028-12-31',
    photoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d',
    assignedBusId: busIdA,
    assignedBusNumber: 'Bus-01',
    assignedRegistrationNumber: 'DL-01-AB-1234',
    assignedRouteName: 'North Campus Morning Express',
    assignedRouteCode: 'NC-AM-01',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockTrips: DriverTripHistoryItem[] = [
    {
      id: 'trip-11111111-e89b-12d3-a456-426614174001',
      schoolId: schoolIdA,
      routeId: routeIdA,
      routeName: 'North Campus Morning Express',
      routeCode: 'NC-AM-01',
      routeType: 'MORNING_PICKUP',
      busId: busIdA,
      busNumber: 'Bus-01',
      busRegistrationNumber: 'DL-01-AB-1234',
      status: 'COMPLETED',
      scheduledDate: '2026-10-09',
      scheduledStartTime: '2026-10-09T02:00:00.000Z',
      actualStartTime: '2026-10-09T02:03:00.000Z',
      actualEndTime: '2026-10-09T03:15:00.000Z',
      currentStopSequence: 8,
      delayMinutes: 3,
      totalBoarded: 24,
    },
    {
      id: 'trip-22222222-e89b-12d3-a456-426614174001',
      schoolId: schoolIdA,
      routeId: routeIdA,
      routeName: 'North Campus Afternoon Drop',
      routeCode: 'NC-PM-01',
      routeType: 'AFTERNOON_DROP',
      busId: busIdA,
      busNumber: 'Bus-01',
      busRegistrationNumber: 'DL-01-AB-1234',
      status: 'COMPLETED',
      scheduledDate: '2026-10-09',
      scheduledStartTime: '2026-10-09T08:30:00.000Z',
      actualStartTime: '2026-10-09T08:30:00.000Z',
      actualEndTime: '2026-10-09T09:40:00.000Z',
      currentStopSequence: 8,
      delayMinutes: 0,
      totalBoarded: 24,
    },
  ];

  const mockIncidents: DriverIncidentHistoryItem[] = [
    {
      id: 'inc-11111111-e89b-12d3-a456-426614174001',
      schoolId: schoolIdA,
      tripId: 'trip-11111111-e89b-12d3-a456-426614174001',
      category: 'INCIDENT',
      type: 'TRAFFIC_CONGESTION',
      severity: 'MEDIUM',
      status: 'RESOLVED',
      description: 'Severe roadblock on Ring Road due to metro flyover work',
      busNumber: 'Bus-01',
      busRegistrationNumber: 'DL-01-AB-1234',
      routeName: 'North Campus Morning Express',
      latitude: 28.6139,
      longitude: 77.209,
      reportedBy: 'DRIVER',
      acknowledgedAt: null,
      resolvedAt: '2026-10-09T03:00:00.000Z',
      resolutionNotes: 'Rerouted through Outer Ring Road',
      createdAt: '2026-10-09T02:20:00.000Z',
    },
    {
      id: 'sos-11111111-e89b-12d3-a456-426614174001',
      schoolId: schoolIdA,
      tripId: 'trip-11111111-e89b-12d3-a456-426614174001',
      category: 'SOS',
      type: 'DRIVER_APP',
      severity: 'CRITICAL',
      status: 'ACKNOWLEDGED',
      description: 'Emergency SOS triggered via DRIVER_APP',
      busNumber: 'Bus-01',
      busRegistrationNumber: 'DL-01-AB-1234',
      routeName: 'North Campus Morning Express',
      latitude: 28.6145,
      longitude: 77.2095,
      reportedBy: 'DRIVER',
      acknowledgedAt: '2026-10-09T02:22:00.000Z',
      resolvedAt: null,
      resolutionNotes: null,
      createdAt: '2026-10-09T02:21:30.000Z',
    },
  ];

  const mockAttendance: DriverAttendanceHistoryResponse = {
    summaries: [
      {
        tripId: 'trip-11111111-e89b-12d3-a456-426614174001',
        scheduledDate: '2026-10-09',
        routeName: 'North Campus Morning Express',
        routeCode: 'NC-AM-01',
        shiftType: 'MORNING_PICKUP',
        busNumber: 'Bus-01',
        busRegistrationNumber: 'DL-01-AB-1234',
        totalBoarded: 24,
        totalAbsent: 2,
        totalDeboarded: 0,
        totalEvents: 26,
      },
    ],
    recentRecords: [
      {
        id: 'att-1',
        tripId: 'trip-11111111-e89b-12d3-a456-426614174001',
        scheduledDate: '2026-10-09',
        studentId: 'stu-1',
        studentName: 'Aarav Sharma',
        admissionNumber: 'DPS-2024-001',
        classGrade: '5',
        section: 'A',
        stopName: 'Sector 14 Main Gate',
        busNumber: 'Bus-01',
        eventType: 'BOARDING',
        status: 'BOARDED',
        markedBy: 'DRIVER_APP',
        recordedAt: '2026-10-09T02:15:00.000Z',
      },
      {
        id: 'att-2',
        tripId: 'trip-11111111-e89b-12d3-a456-426614174001',
        scheduledDate: '2026-10-09',
        studentId: 'stu-2',
        studentName: 'Ananya Verma',
        admissionNumber: 'DPS-2024-002',
        classGrade: '6',
        section: 'B',
        stopName: 'Sector 15 Community Center',
        busNumber: 'Bus-01',
        eventType: 'BOARDING',
        status: 'ABSENT',
        markedBy: 'DRIVER_APP',
        recordedAt: '2026-10-09T02:22:00.000Z',
      },
    ],
  };

  const mockFullHistory: DriverFullHistoryResponse = {
    driver: mockDriver,
    trips: mockTrips,
    incidents: mockIncidents,
    attendance: mockAttendance,
  };

  describe('1. GET /api/v1/schools/:schoolId/drivers/:driverId/history (Consolidated History)', () => {
    it('returns 200 OK with driver profile, trips, incidents, and boarding attendance logs', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi.spyOn(DriverService, 'getDriverFullHistory').mockResolvedValueOnce(mockFullHistory);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/drivers/${driverIdA}/history`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.driver.fullName).toBe('Ramesh Kumar');
      expect(res.body.data.trips).toHaveLength(2);
      expect(res.body.data.trips[0].routeName).toBe('North Campus Morning Express');
      expect(res.body.data.incidents).toHaveLength(2);
      expect(res.body.data.incidents[0].type).toBe('TRAFFIC_CONGESTION');
      expect(res.body.data.incidents[1].category).toBe('SOS');
      expect(res.body.data.attendance.summaries).toHaveLength(1);
      expect(res.body.data.attendance.recentRecords).toHaveLength(2);

      spy.mockRestore();
    });

    it('rejects cross-tenant access with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdB}/drivers/${driverIdA}/history`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
    });

    it('returns 404 NotFound if driver does not exist', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi.spyOn(DriverService, 'getDriverFullHistory').mockRejectedValueOnce(
        new NotFoundError(`Driver with ID non-existent not found in this school.`)
      );

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/drivers/99999999-e89b-12d3-a456-426614174999/history`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NotFoundError');

      spy.mockRestore();
    });

    it('returns 401 Unauthorized if no bearer token is supplied', async () => {
      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/drivers/${driverIdA}/history`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });
});
