import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import * as db from '../src/config/database.js';
import { AuthService } from '../src/services/auth.service.js';
import { DriverAttendanceService } from '../src/services/driver-attendance.service.js';
import { DriverWhatsappService } from '../src/services/driver-whatsapp.service.js';
import { UserRole } from '@school-bus/shared';
import { BadRequestError, ForbiddenError, NotFoundError } from '../src/middlewares/error.middleware.js';

const schoolA = '111e4567-e89b-12d3-a456-426614174001';
const schoolB = '999e4567-e89b-12d3-a456-426614174999';
const driverAId = 'ddd11111-e89b-12d3-a456-426614174001';
const driverBId = 'ddd22222-e89b-12d3-a456-426614174002';
const busAId = '222e4567-e89b-12d3-a456-426614174222';
const routeAId = '555e4567-e89b-12d3-a456-426614174555';
const tripAId = '777e4567-e89b-12d3-a456-426614174777';
const stop1Id = '888e4567-e89b-12d3-a456-426614174881';
const student1Id = '444e4567-e89b-12d3-a456-426614174441';
const student2Id = '444e4567-e89b-12d3-a456-426614174442';

describe('Phase 18.2: Driver Attendance — Boarding (Boarded, Not boarded, Timestamp, Location)', () => {
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

  describe('1. DriverAttendanceService.recordBoarding Domain Logic', () => {
    it('successfully records student as BOARDED with timestamp and GPS coordinates', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Trip lookup
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          bus_id: busAId,
          route_id: routeAId,
          driver_id: driverAId,
          status: 'IN_TRANSIT',
        },
      ] as any);

      // 2. Student lookup
      querySpy.mockResolvedValueOnce([
        {
          id: student1Id,
          full_name: 'Aarav Sharma',
          admission_number: 'ADM-101',
          school_id: schoolA,
        },
      ] as any);

      // 3. Stop check on route
      querySpy.mockResolvedValueOnce([{ id: stop1Id }] as any);

      // 4. Upsert into boarding_events
      const recordedAtIso = '2026-10-23T07:45:00.000Z';
      querySpy.mockResolvedValueOnce([
        {
          id: 'bev-001',
          trip_id: tripAId,
          student_id: student1Id,
          stop_id: stop1Id,
          status: 'BOARDED',
          marked_by: 'DRIVER',
          latitude: 12.9716,
          longitude: 77.5946,
          recorded_at: recordedAtIso,
        },
      ] as any);

      // 5. Updated counts query
      querySpy.mockResolvedValueOnce([
        {
          total_students: 15,
          boarded_count: 1,
          absent_count: 0,
        },
      ] as any);

      const result = await DriverAttendanceService.recordBoarding(
        schoolA,
        {
          tripId: tripAId,
          studentId: student1Id,
          stopId: stop1Id,
          status: 'BOARDED',
          latitude: 12.9716,
          longitude: 77.5946,
          recordedAt: recordedAtIso,
        },
        {
          userId: driverAId,
          isDriver: true,
          userRole: 'DRIVER',
          schoolId: schoolA,
        }
      );

      expect(result.event.id).toBe('bev-001');
      expect(result.event.status).toBe('BOARDED');
      expect(result.event.latitude).toBe(12.9716);
      expect(result.event.longitude).toBe(77.5946);
      expect(result.event.recordedAt).toBe(recordedAtIso);
      expect(result.student.fullName).toBe('Aarav Sharma');
      expect(result.student.admissionNumber).toBe('ADM-101');
      expect(result.summary.boardedCount).toBe(1);
      expect(result.summary.absentCount).toBe(0);
      expect(result.summary.pendingCount).toBe(14);
    });

    it('successfully records student as ABSENT (Not boarded)', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Trip lookup
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          bus_id: busAId,
          route_id: routeAId,
          driver_id: driverAId,
          status: 'IN_TRANSIT',
        },
      ] as any);

      // 2. Student lookup
      querySpy.mockResolvedValueOnce([
        {
          id: student2Id,
          full_name: 'Diya Patel',
          admission_number: 'ADM-102',
          school_id: schoolA,
        },
      ] as any);

      // 3. Stop check
      querySpy.mockResolvedValueOnce([{ id: stop1Id }] as any);

      // 4. Upsert into boarding_events
      const recordedAtIso = '2026-10-23T07:46:00.000Z';
      querySpy.mockResolvedValueOnce([
        {
          id: 'bev-002',
          trip_id: tripAId,
          student_id: student2Id,
          stop_id: stop1Id,
          status: 'ABSENT',
          marked_by: 'DRIVER',
          latitude: 12.9716,
          longitude: 77.5946,
          recorded_at: recordedAtIso,
        },
      ] as any);

      // 5. Updated counts
      querySpy.mockResolvedValueOnce([
        {
          total_students: 15,
          boarded_count: 1,
          absent_count: 1,
        },
      ] as any);

      const result = await DriverAttendanceService.recordBoarding(
        schoolA,
        {
          tripId: tripAId,
          studentId: student2Id,
          stopId: stop1Id,
          status: 'ABSENT',
          latitude: 12.9716,
          longitude: 77.5946,
          recordedAt: recordedAtIso,
        },
        {
          userId: driverAId,
          isDriver: true,
          userRole: 'DRIVER',
          schoolId: schoolA,
        }
      );

      expect(result.event.status).toBe('ABSENT');
      expect(result.summary.absentCount).toBe(1);
      expect(result.summary.pendingCount).toBe(13);
    });

    it('resolves pickup stop from student stop assignment when stopId is omitted', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Trip lookup
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          bus_id: busAId,
          route_id: routeAId,
          driver_id: driverAId,
          status: 'IN_TRANSIT',
        },
      ] as any);

      // 2. Student lookup
      querySpy.mockResolvedValueOnce([
        {
          id: student1Id,
          full_name: 'Aarav Sharma',
          admission_number: 'ADM-101',
          school_id: schoolA,
        },
      ] as any);

      // 3. Resolve assigned stop for student on this route
      querySpy.mockResolvedValueOnce([{ stop_id: stop1Id }] as any);

      // 4. Upsert into boarding_events
      querySpy.mockResolvedValueOnce([
        {
          id: 'bev-001',
          trip_id: tripAId,
          student_id: student1Id,
          stop_id: stop1Id,
          status: 'BOARDED',
          marked_by: 'DRIVER',
          latitude: null,
          longitude: null,
          recorded_at: '2026-10-23T07:45:00.000Z',
        },
      ] as any);

      // 5. Updated counts query
      querySpy.mockResolvedValueOnce([
        {
          total_students: 15,
          boarded_count: 1,
          absent_count: 0,
        },
      ] as any);

      const result = await DriverAttendanceService.recordBoarding(
        schoolA,
        {
          tripId: tripAId,
          studentId: student1Id,
          status: 'BOARDED',
        },
        {
          userId: driverAId,
          isDriver: true,
          userRole: 'DRIVER',
          schoolId: schoolA,
        }
      );

      expect(result.event.stopId).toBe(stop1Id);
    });

    it('rejects recording boarding when trip is COMPLETED (attendance ledger locked)', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          bus_id: busAId,
          route_id: routeAId,
          driver_id: driverAId,
          status: 'COMPLETED',
        },
      ] as any);

      await expect(
        DriverAttendanceService.recordBoarding(
          schoolA,
          {
            tripId: tripAId,
            studentId: student1Id,
            status: 'BOARDED',
          },
          {
            userId: driverAId,
            isDriver: true,
            userRole: 'DRIVER',
            schoolId: schoolA,
          }
        )
      ).rejects.toThrow(BadRequestError);
    });

    it('rejects when driver is not assigned to the trip', async () => {
      const querySpy = vi.spyOn(db, 'query');

      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          bus_id: busAId,
          route_id: routeAId,
          driver_id: driverBId, // Assigned to Driver B
          status: 'IN_TRANSIT',
        },
      ] as any);

      await expect(
        DriverAttendanceService.recordBoarding(
          schoolA,
          {
            tripId: tripAId,
            studentId: student1Id,
            status: 'BOARDED',
          },
          {
            userId: driverAId, // Driver A attempting
            isDriver: true,
            userRole: 'DRIVER',
            schoolId: schoolA,
          }
        )
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects cross-tenant boarding attempt with 403 Forbidden', async () => {
      await expect(
        DriverAttendanceService.recordBoarding(
          schoolA,
          {
            tripId: tripAId,
            studentId: student1Id,
            status: 'BOARDED',
          },
          {
            userId: driverAId,
            isDriver: true,
            userRole: 'DRIVER',
            schoolId: schoolB, // Caller belongs to School B
          }
        )
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('2. Batch Boarding Attendance', () => {
    it('records boarding for multiple students at a pickup stop', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // Student 1: Trip lookup, Student lookup, Stop check, Upsert, Counts
      querySpy.mockResolvedValueOnce([
        { id: tripAId, school_id: schoolA, bus_id: busAId, route_id: routeAId, driver_id: driverAId, status: 'IN_TRANSIT' },
      ] as any);
      querySpy.mockResolvedValueOnce([{ id: student1Id, full_name: 'Aarav Sharma', admission_number: 'ADM-101', school_id: schoolA }] as any);
      querySpy.mockResolvedValueOnce([{ id: stop1Id }] as any);
      querySpy.mockResolvedValueOnce([{ id: 'bev-001', trip_id: tripAId, student_id: student1Id, stop_id: stop1Id, status: 'BOARDED', marked_by: 'DRIVER', latitude: null, longitude: null, recorded_at: '2026-10-23T07:45:00Z' }] as any);
      querySpy.mockResolvedValueOnce([{ total_students: 15, boarded_count: 1, absent_count: 0 }] as any);

      // Student 2: Trip lookup, Student lookup, Stop check, Upsert, Counts
      querySpy.mockResolvedValueOnce([
        { id: tripAId, school_id: schoolA, bus_id: busAId, route_id: routeAId, driver_id: driverAId, status: 'IN_TRANSIT' },
      ] as any);
      querySpy.mockResolvedValueOnce([{ id: student2Id, full_name: 'Diya Patel', admission_number: 'ADM-102', school_id: schoolA }] as any);
      querySpy.mockResolvedValueOnce([{ id: stop1Id }] as any);
      querySpy.mockResolvedValueOnce([{ id: 'bev-002', trip_id: tripAId, student_id: student2Id, stop_id: stop1Id, status: 'BOARDED', marked_by: 'DRIVER', latitude: null, longitude: null, recorded_at: '2026-10-23T07:45:00Z' }] as any);
      querySpy.mockResolvedValueOnce([{ total_students: 15, boarded_count: 2, absent_count: 0 }] as any);

      // Final summary count
      querySpy.mockResolvedValueOnce([{ total_students: 15, boarded_count: 2, absent_count: 0 }] as any);

      const batchResult = await DriverAttendanceService.recordBoardingBatch(
        schoolA,
        {
          tripId: tripAId,
          stopId: stop1Id,
          records: [
            { studentId: student1Id, status: 'BOARDED' },
            { studentId: student2Id, status: 'BOARDED' },
          ],
        },
        {
          userId: driverAId,
          isDriver: true,
          userRole: 'DRIVER',
          schoolId: schoolA,
        }
      );

      expect(batchResult.updatedCount).toBe(2);
      expect(batchResult.events).toHaveLength(2);
      expect(batchResult.summary.boardedCount).toBe(2);
    });
  });

  describe('3. Driver WhatsApp Boarding Commands', () => {
    it('parses "board Aarav" and records boarding via WhatsApp', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Driver lookup by phone
      querySpy.mockResolvedValueOnce([
        {
          id: driverAId,
          school_id: schoolA,
          full_name: 'Ramesh Driver',
          phone: '+919876543210',
          license_number: 'DL-01-AB-1234',
        },
      ] as any);

      // 2. getDriverTripContext query
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          status: 'IN_TRANSIT',
          current_stop_sequence: 1,
          route_name: 'Route 1',
          route_code: 'R1',
          bus_number: 'BUS-01',
          total_stops: 5,
        },
      ] as any);

      // 3. Active trip lookup in recordBoardingViaWhatsApp
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          bus_id: busAId,
          route_id: routeAId,
          status: 'IN_TRANSIT',
        },
      ] as any);

      // 4. Search student
      querySpy.mockResolvedValueOnce([
        {
          id: student1Id,
          full_name: 'Aarav Sharma',
          admission_number: 'ADM-101',
          stop_id: stop1Id,
          stop_name: 'Main Gate Stop',
        },
      ] as any);

      // 5. Trip lookup inside recordBoarding
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          bus_id: busAId,
          route_id: routeAId,
          driver_id: driverAId,
          status: 'IN_TRANSIT',
        },
      ] as any);

      // 6. Student lookup inside recordBoarding
      querySpy.mockResolvedValueOnce([
        {
          id: student1Id,
          full_name: 'Aarav Sharma',
          admission_number: 'ADM-101',
          school_id: schoolA,
        },
      ] as any);

      // 7. Stop check
      querySpy.mockResolvedValueOnce([{ id: stop1Id }] as any);

      // 8. Upsert into boarding_events
      querySpy.mockResolvedValueOnce([
        {
          id: 'bev-001',
          trip_id: tripAId,
          student_id: student1Id,
          stop_id: stop1Id,
          status: 'BOARDED',
          marked_by: 'DRIVER',
          latitude: null,
          longitude: null,
          recorded_at: '2026-10-23T07:45:00Z',
        },
      ] as any);

      // 9. Summary counts
      querySpy.mockResolvedValueOnce([
        {
          total_students: 15,
          boarded_count: 1,
          absent_count: 0,
        },
      ] as any);

      const res = await DriverWhatsappService.handleInboundMessage({
        from: '+919876543210',
        text: 'board Aarav',
      });

      expect(res.replyText).toContain('Aarav Sharma');
      expect(res.replyText).toContain('Marked as BOARDED');
      expect(res.replyText).toContain('1 / 15');
    });

    it('parses "absent Diya" and records absent via WhatsApp', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Driver lookup
      querySpy.mockResolvedValueOnce([
        {
          id: driverAId,
          school_id: schoolA,
          full_name: 'Ramesh Driver',
          phone: '+919876543210',
          license_number: 'DL-01-AB-1234',
        },
      ] as any);

      // 2. getDriverTripContext query
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          route_id: routeAId,
          status: 'IN_TRANSIT',
          current_stop_sequence: 1,
          route_name: 'Route 1',
          route_code: 'R1',
          bus_number: 'BUS-01',
          total_stops: 5,
        },
      ] as any);

      // 3. Active trip lookup in recordBoardingViaWhatsApp
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          bus_id: busAId,
          route_id: routeAId,
          status: 'IN_TRANSIT',
        },
      ] as any);

      // 4. Search student
      querySpy.mockResolvedValueOnce([
        {
          id: student2Id,
          full_name: 'Diya Patel',
          admission_number: 'ADM-102',
          stop_id: stop1Id,
          stop_name: 'Main Gate Stop',
        },
      ] as any);

      // 5. Trip lookup
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          bus_id: busAId,
          route_id: routeAId,
          driver_id: driverAId,
          status: 'IN_TRANSIT',
        },
      ] as any);

      // 6. Student lookup
      querySpy.mockResolvedValueOnce([
        {
          id: student2Id,
          full_name: 'Diya Patel',
          admission_number: 'ADM-102',
          school_id: schoolA,
        },
      ] as any);

      // 7. Stop check
      querySpy.mockResolvedValueOnce([{ id: stop1Id }] as any);

      // 8. Upsert into boarding_events
      querySpy.mockResolvedValueOnce([
        {
          id: 'bev-002',
          trip_id: tripAId,
          student_id: student2Id,
          stop_id: stop1Id,
          status: 'ABSENT',
          marked_by: 'DRIVER',
          latitude: null,
          longitude: null,
          recorded_at: '2026-10-23T07:46:00Z',
        },
      ] as any);

      // 9. Summary counts
      querySpy.mockResolvedValueOnce([
        {
          total_students: 15,
          boarded_count: 1,
          absent_count: 1,
        },
      ] as any);

      const res = await DriverWhatsappService.handleInboundMessage({
        from: '+919876543210',
        text: 'absent Diya',
      });

      expect(res.replyText).toContain('Diya Patel');
      expect(res.replyText).toContain('Marked as ABSENT');
    });
  });

  describe('4. HTTP Endpoints: POST /api/v1/driver/attendance/boarding', () => {
    it('returns 201 Created and structured boarding response', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // 1. Trip lookup
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          bus_id: busAId,
          route_id: routeAId,
          driver_id: driverAId,
          status: 'IN_TRANSIT',
        },
      ] as any);

      // 2. Student lookup
      querySpy.mockResolvedValueOnce([
        {
          id: student1Id,
          full_name: 'Aarav Sharma',
          admission_number: 'ADM-101',
          school_id: schoolA,
        },
      ] as any);

      // 3. Stop check
      querySpy.mockResolvedValueOnce([{ id: stop1Id }] as any);

      // 4. Upsert
      querySpy.mockResolvedValueOnce([
        {
          id: 'bev-001',
          trip_id: tripAId,
          student_id: student1Id,
          stop_id: stop1Id,
          status: 'BOARDED',
          marked_by: 'DRIVER',
          latitude: 12.9716,
          longitude: 77.5946,
          recorded_at: '2026-10-23T07:45:00Z',
        },
      ] as any);

      // 5. Counts
      querySpy.mockResolvedValueOnce([
        {
          total_students: 15,
          boarded_count: 1,
          absent_count: 0,
        },
      ] as any);

      const res = await request(app)
        .post('/api/v1/driver/attendance/boarding')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          tripId: tripAId,
          studentId: student1Id,
          stopId: stop1Id,
          status: 'BOARDED',
          latitude: 12.9716,
          longitude: 77.5946,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.event.status).toBe('BOARDED');
      expect(res.body.data.summary.boardedCount).toBe(1);
    });

    it('rejects unauthenticated request with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/v1/driver/attendance/boarding')
        .send({
          tripId: tripAId,
          studentId: student1Id,
          status: 'BOARDED',
        });

      expect(res.status).toBe(401);
    });

    it('rejects invalid payload with 422 Unprocessable Entity', async () => {
      const res = await request(app)
        .post('/api/v1/driver/attendance/boarding')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          tripId: 'not-a-uuid',
          studentId: student1Id,
          status: 'INVALID_STATUS',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });
});
