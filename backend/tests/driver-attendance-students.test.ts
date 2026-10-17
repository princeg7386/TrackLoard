import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import * as db from '../src/config/database.js';
import { AuthService } from '../src/services/auth.service.js';
import { DriverAttendanceService } from '../src/services/driver-attendance.service.js';
import { AttendanceStatus, UserRole } from '@school-bus/shared';

const schoolA = '111e4567-e89b-12d3-a456-426614174001';
const schoolB = '999e4567-e89b-12d3-a456-426614174999';
const driverAId = 'ddd11111-e89b-12d3-a456-426614174001';
const busAId = '222e4567-e89b-12d3-a456-426614174222';
const routeAId = '555e4567-e89b-12d3-a456-426614174555';
const tripAId = '777e4567-e89b-12d3-a456-426614174777';
const stop1Id = '888e4567-e89b-12d3-a456-426614174881';
const stop2Id = '888e4567-e89b-12d3-a456-426614174882';
const student1Id = '444e4567-e89b-12d3-a456-426614174441';
const student2Id = '444e4567-e89b-12d3-a456-426614174442';

describe('Phase 18.1: Driver Attendance — Registered Student List & Pickup Details', () => {
  let app: any;
  let driverToken: string;
  let adminToken: string;

  beforeEach(() => {
    app = createApp();

    driverToken = AuthService.generateToken({
      id: driverAId,
      phone: '+919876543210',
      role: UserRole.DRIVER,
      schoolId: schoolA,
    });

    adminToken = AuthService.generateToken({
      id: 'aaa11111-e89b-12d3-a456-426614174001',
      phone: '+919876543211',
      role: UserRole.SCHOOL_ADMIN,
      schoolId: schoolA,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. GET /api/v1/driver/attendance/students — Student List & Pickup Details', () => {
    it('retrieves registered students for driver assigned bus ordered by stop sequence', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Driver lookup: returns assigned bus and route
      querySpy.mockResolvedValueOnce([
        {
          driver_id: driverAId,
          bus_id: busAId,
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
          active_trip_id: tripAId,
          active_route_id: routeAId,
          active_route_name: 'North Campus Loop',
          active_route_code: 'R-101',
        },
      ] as any);

      // 2. Query registered students on this route with pickup details
      querySpy.mockResolvedValueOnce([
        {
          student_id: student1Id,
          admission_number: 'ADM-101',
          full_name: 'Aarav Sharma',
          grade: '5',
          section: 'A',
          emergency_phone: '+919876543210',
          pickup_stop_id: stop1Id,
          pickup_stop_name: 'Main Gate Stop',
          pickup_sequence_order: 1,
          pickup_expected_offset: 10,
          pickup_latitude: 12.9716,
          pickup_longitude: 77.5946,
          pickup_address: '100 Feet Road, Indiranagar',
          drop_stop_id: null,
          drop_stop_name: null,
          drop_sequence_order: null,
          drop_expected_offset: null,
          drop_latitude: null,
          drop_longitude: null,
          drop_address: null,
          parent_full_name: 'Ramesh Sharma',
          parent_phone: '+919811111111',
          parent_relationship: 'Father',
          boarding_status: 'BOARDED',
          boarded_at: '2026-10-17T07:45:00Z',
          boarding_marked_by: 'DRIVER',
          drop_status: null,
          dropped_at: null,
          drop_marked_by: null,
        },
        {
          student_id: student2Id,
          admission_number: 'ADM-102',
          full_name: 'Diya Patel',
          grade: '4',
          section: 'B',
          emergency_phone: '+919876543212',
          pickup_stop_id: stop2Id,
          pickup_stop_name: 'Crossroads Stop',
          pickup_sequence_order: 2,
          pickup_expected_offset: 20,
          pickup_latitude: 12.9780,
          pickup_longitude: 77.6000,
          pickup_address: 'Double Road Corner',
          drop_stop_id: null,
          drop_stop_name: null,
          drop_sequence_order: null,
          drop_expected_offset: null,
          drop_latitude: null,
          drop_longitude: null,
          drop_address: null,
          parent_full_name: 'Suresh Patel',
          parent_phone: '+919822222222',
          parent_relationship: 'Father',
          boarding_status: null,
          boarded_at: null,
          boarding_marked_by: null,
          drop_status: null,
          dropped_at: null,
          drop_marked_by: null,
        },
      ] as any);

      const res = await request(app)
        .get('/api/v1/driver/attendance/students')
        .set('Authorization', `Bearer ${driverToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.busId).toBe(busAId);
      expect(res.body.data.busNumber).toBe('BUS-01');
      expect(res.body.data.routeId).toBe(routeAId);
      expect(res.body.data.routeName).toBe('North Campus Loop');
      expect(res.body.data.routeCode).toBe('R-101');
      expect(res.body.data.totalStudents).toBe(2);
      expect(res.body.data.boardedCount).toBe(1);
      expect(res.body.data.pendingCount).toBe(1);

      // Verify Student 1 (Stop 1)
      const st1 = res.body.data.students[0];
      expect(st1.studentId).toBe(student1Id);
      expect(st1.fullName).toBe('Aarav Sharma');
      expect(st1.admissionNumber).toBe('ADM-101');
      expect(st1.grade).toBe('5');
      expect(st1.section).toBe('A');
      expect(st1.pickupStop.id).toBe(stop1Id);
      expect(st1.pickupStop.name).toBe('Main Gate Stop');
      expect(st1.pickupStop.sequenceOrder).toBe(1);
      expect(st1.pickupStop.expectedTimeOffsetMinutes).toBe(10);
      expect(st1.pickupStop.latitude).toBe(12.9716);
      expect(st1.pickupStop.longitude).toBe(77.5946);
      expect(st1.pickupStop.address).toBe('100 Feet Road, Indiranagar');
      expect(st1.parent.fullName).toBe('Ramesh Sharma');
      expect(st1.parent.phone).toBe('+919811111111');
      expect(st1.attendanceStatus).toBe(AttendanceStatus.BOARDED);
      expect(st1.boardedAt).toBe('2026-10-17T07:45:00Z');

      // Verify Student 2 (Stop 2)
      const st2 = res.body.data.students[1];
      expect(st2.studentId).toBe(student2Id);
      expect(st2.fullName).toBe('Diya Patel');
      expect(st2.pickupStop.sequenceOrder).toBe(2);
      expect(st2.attendanceStatus).toBe(AttendanceStatus.PENDING);
    });

    it('allows school admin to query student list by explicit busId', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Bus lookup
      querySpy.mockResolvedValueOnce([
        {
          id: busAId,
          bus_number: 'BUS-01',
          registration_number: 'KA-01-AB-1234',
        },
      ] as any);

      // 2. Route lookup for bus
      querySpy.mockResolvedValueOnce([
        {
          id: routeAId,
          name: 'North Campus Loop',
          code: 'R-101',
        },
      ] as any);

      // 3. Students query (empty)
      querySpy.mockResolvedValueOnce([]);

      const res = await request(app)
        .get(`/api/v1/driver/attendance/students?busId=${busAId}&schoolId=${schoolA}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.busId).toBe(busAId);
      expect(res.body.data.totalStudents).toBe(0);
      expect(res.body.data.students).toEqual([]);
    });

    it('rejects cross-tenant access when school admin requests another school student list', async () => {
      const res = await request(app)
        .get(`/api/v1/driver/attendance/students?schoolId=${schoolB}&busId=${busAId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('Cross-tenant');
    });

    it('rejects unauthenticated request with 401 Unauthorized', async () => {
      const res = await request(app).get('/api/v1/driver/attendance/students');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. WhatsApp Student Manifest Formatter', () => {
    it('formats multi-stop student manifest grouped by stop sequence with contact info', () => {
      const manifestText = DriverAttendanceService.formatWhatsAppStudentList({
        busId: busAId,
        busNumber: 'BUS-01',
        registrationNumber: 'KA-01-AB-1234',
        routeId: routeAId,
        routeName: 'North Campus Loop',
        routeCode: 'R-101',
        totalStudents: 2,
        boardedCount: 1,
        droppedCount: 0,
        absentCount: 0,
        pendingCount: 1,
        students: [
          {
            studentId: student1Id,
            admissionNumber: 'ADM-101',
            fullName: 'Aarav Sharma',
            grade: '5',
            section: 'A',
            pickupStop: {
              id: stop1Id,
              name: 'Main Gate Stop',
              sequenceOrder: 1,
              expectedTimeOffsetMinutes: 10,
              latitude: 12.9716,
              longitude: 77.5946,
            },
            parent: {
              fullName: 'Ramesh Sharma',
              phone: '+919811111111',
            },
            attendanceStatus: AttendanceStatus.BOARDED,
          },
          {
            studentId: student2Id,
            admissionNumber: 'ADM-102',
            fullName: 'Diya Patel',
            grade: '4',
            section: 'B',
            pickupStop: {
              id: stop2Id,
              name: 'Crossroads Stop',
              sequenceOrder: 2,
              expectedTimeOffsetMinutes: 20,
              latitude: 12.9780,
              longitude: 77.6000,
            },
            parent: {
              fullName: 'Suresh Patel',
              phone: '+919822222222',
            },
            attendanceStatus: AttendanceStatus.PENDING,
          },
        ],
      });

      expect(manifestText).toContain('Student Manifest — Bus BUS-01');
      expect(manifestText).toContain('R-101 - North Campus Loop');
      expect(manifestText).toContain('Total Registered: *2 students*');
      expect(manifestText).toContain('Stop #1: Main Gate Stop');
      expect(manifestText).toContain('Aarav Sharma (5-A) • 📞 +919811111111');
      expect(manifestText).toContain('Stop #2: Crossroads Stop');
      expect(manifestText).toContain('Diya Patel (4-B) • 📞 +919822222222');
      expect(manifestText).toContain('Legend: ⏳ Pending • ✅ Boarded');
    });

    it('returns informative empty message when no students are assigned to the route', () => {
      const emptyText = DriverAttendanceService.formatWhatsAppStudentList({
        busId: busAId,
        busNumber: 'BUS-01',
        registrationNumber: 'KA-01-AB-1234',
        totalStudents: 0,
        boardedCount: 0,
        droppedCount: 0,
        absentCount: 0,
        pendingCount: 0,
        students: [],
      });

      expect(emptyText).toContain('Student Manifest — Bus BUS-01');
      expect(emptyText).toContain('No registered students found assigned to this route');
      expect(emptyText).toContain('School Transport Coordinator');
    });
  });
});
