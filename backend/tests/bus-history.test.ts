import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { BusService } from '../src/services/bus.service.js';
import { AuthService } from '../src/services/auth.service.js';
import {
  UserRole,
  BusTripHistoryItem,
  BusIncidentHistoryItem,
  BusAttendanceHistoryResponse,
  BusFullHistoryResponse,
} from '@school-bus/shared';

describe('Bus History (Micro-phase 6.4: Trips, Incidents & Attendance)', () => {
  const app = createApp();

  const schoolIdA = '111e4567-e89b-12d3-a456-426614174001';
  const schoolIdB = '999e4567-e89b-12d3-a456-426614174999';
  const busIdA = '11111111-e89b-12d3-a456-426614174001';
  const driverIdA = '22222222-e89b-12d3-a456-426614174001';
  const routeIdA = '33333333-e89b-12d3-a456-426614174001';

  const adminUserA = {
    id: 'aaa11111-e89b-12d3-a456-426614174001',
    schoolId: schoolIdA,
    email: 'admin.a@dpa.edu.in',
    fullName: 'Principal Sharma',
    role: UserRole.SCHOOL_ADMIN,
  };

  const mockTrips: BusTripHistoryItem[] = [
    {
      id: 'trip-11111111-e89b-12d3-a456-426614174001',
      schoolId: schoolIdA,
      routeId: routeIdA,
      routeName: 'North Campus Morning Express',
      routeCode: 'NC-AM-01',
      routeType: 'MORNING_PICKUP',
      driverId: driverIdA,
      driverName: 'Ramesh Kumar',
      driverPhone: '+919876543210',
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
      driverId: driverIdA,
      driverName: 'Ramesh Kumar',
      driverPhone: '+919876543210',
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

  const mockIncidents: BusIncidentHistoryItem[] = [
    {
      id: 'inc-11111111-e89b-12d3-a456-426614174001',
      schoolId: schoolIdA,
      tripId: 'trip-11111111-e89b-12d3-a456-426614174001',
      category: 'INCIDENT',
      type: 'TRAFFIC_CONGESTION',
      severity: 'MEDIUM',
      status: 'RESOLVED',
      description: 'Heavy congestion near Ring Road flyover causing 15 min delay.',
      driverName: 'Ramesh Kumar',
      routeName: 'North Campus Morning Express',
      latitude: 28.6139,
      longitude: 77.209,
      reportedBy: 'DRIVER',
      acknowledgedAt: '2026-10-09T02:15:00.000Z',
      resolvedAt: '2026-10-09T02:45:00.000Z',
      resolutionNotes: 'Traffic cleared by traffic police; resumed standard route.',
      createdAt: '2026-10-09T02:10:00.000Z',
    },
    {
      id: 'sos-11111111-e89b-12d3-a456-426614174001',
      schoolId: schoolIdA,
      tripId: 'trip-22222222-e89b-12d3-a456-426614174001',
      category: 'SOS',
      type: 'APP_SOS_BUTTON',
      severity: 'CRITICAL',
      status: 'RESOLVED',
      description: 'Emergency SOS triggered via APP_SOS_BUTTON',
      driverName: 'Ramesh Kumar',
      routeName: 'North Campus Afternoon Drop',
      latitude: 28.5355,
      longitude: 77.1555,
      reportedBy: 'DRIVER',
      acknowledgedAt: '2026-10-09T08:40:00.000Z',
      resolvedAt: '2026-10-09T08:55:00.000Z',
      resolutionNotes: 'Minor tire puncture replaced with spare tire in 15 mins.',
      createdAt: '2026-10-09T08:38:00.000Z',
    },
  ];

  const mockAttendance: BusAttendanceHistoryResponse = {
    summaries: [
      {
        tripId: 'trip-11111111-e89b-12d3-a456-426614174001',
        scheduledDate: '2026-10-09',
        routeName: 'North Campus Morning Express',
        routeCode: 'NC-AM-01',
        shiftType: 'MORNING_PICKUP',
        driverName: 'Ramesh Kumar',
        totalBoarded: 24,
        totalAbsent: 2,
        totalDeboarded: 0,
        totalEvents: 26,
      },
    ],
    recentRecords: [
      {
        id: 'evt-11111111-e89b-12d3-a456-426614174001',
        tripId: 'trip-11111111-e89b-12d3-a456-426614174001',
        scheduledDate: '2026-10-09',
        studentId: 'stu-11111111-e89b-12d3-a456-426614174001',
        studentName: 'Aarav Sharma',
        admissionNumber: 'ADM-2024-001',
        classGrade: '5',
        section: 'A',
        stopName: 'Sector 14 Market Gate',
        eventType: 'BOARDING',
        status: 'BOARDED',
        markedBy: 'DRIVER',
        recordedAt: '2026-10-09T02:12:00.000Z',
      },
    ],
  };

  const mockFullHistory: BusFullHistoryResponse = {
    bus: {
      id: busIdA,
      schoolId: schoolIdA,
      busNumber: 'Bus-01',
      registrationNumber: 'DL-01-AB-1234',
      makeModel: 'Tata Starbus 32',
      defaultDriverId: driverIdA,
      driverName: 'Ramesh Kumar',
      driverPhone: '+919876543210',
      assignedRouteId: routeIdA,
      assignedRouteName: 'North Campus Morning Express',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    trips: mockTrips,
    incidents: mockIncidents,
    attendance: mockAttendance,
  };

  describe('1. GET /api/v1/schools/:schoolId/buses/:busId/history (Consolidated History)', () => {
    it('returns 200 OK with bus profile, trips, incidents, and attendance logs', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi
        .spyOn(BusService, 'getBusFullHistory')
        .mockResolvedValueOnce(mockFullHistory);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/buses/${busIdA}/history`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.bus.busNumber).toBe('Bus-01');
      expect(res.body.data.trips.length).toBe(2);
      expect(res.body.data.incidents.length).toBe(2);
      expect(res.body.data.attendance.summaries.length).toBe(1);
      expect(res.body.data.attendance.recentRecords.length).toBe(1);

      spy.mockRestore();
    });

    it('rejects cross-tenant access with 403 Forbidden', async () => {
      const token = AuthService.generateToken(adminUserA);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdB}/buses/${busIdA}/history`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
    });
  });

  describe('2. GET /api/v1/schools/:schoolId/buses/:busId/history/trips (Trip History)', () => {
    it('returns 200 OK with list of completed trips and delay statistics', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi
        .spyOn(BusService, 'getBusTripHistory')
        .mockResolvedValueOnce(mockTrips);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/buses/${busIdA}/history/trips?limit=20`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].routeName).toBe('North Campus Morning Express');
      expect(res.body.data[0].totalBoarded).toBe(24);

      spy.mockRestore();
    });
  });

  describe('3. GET /api/v1/schools/:schoolId/buses/:busId/history/incidents (Incident & SOS Log)', () => {
    it('returns 200 OK with safety incidents and SOS events', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi
        .spyOn(BusService, 'getBusIncidentHistory')
        .mockResolvedValueOnce(mockIncidents);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/buses/${busIdA}/history/incidents`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].category).toBe('INCIDENT');
      expect(res.body.data[1].category).toBe('SOS');
      expect(res.body.data[1].severity).toBe('CRITICAL');

      spy.mockRestore();
    });
  });

  describe('4. GET /api/v1/schools/:schoolId/buses/:busId/history/attendance (Attendance Ledger)', () => {
    it('returns 200 OK with trip summaries and individual student boarding records', async () => {
      const token = AuthService.generateToken(adminUserA);

      const spy = vi
        .spyOn(BusService, 'getBusAttendanceHistory')
        .mockResolvedValueOnce(mockAttendance);

      const res = await request(app)
        .get(`/api/v1/schools/${schoolIdA}/buses/${busIdA}/history/attendance`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.summaries[0].totalBoarded).toBe(24);
      expect(res.body.data.recentRecords[0].studentName).toBe('Aarav Sharma');

      spy.mockRestore();
    });
  });
});
