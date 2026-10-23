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
const stop2Id = '888e4567-e89b-12d3-a456-426614174882';
const student1Id = '444e4567-e89b-12d3-a456-426614174441';
const student2Id = '444e4567-e89b-12d3-a456-426614174442';

describe('Phase 18.3: Driver Attendance — Drop (Dropped, Timestamp, Location)', () => {
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

  describe('1. DriverAttendanceService.recordDrop Domain Logic', () => {
    it('successfully records student as DEBOARDED with timestamp and GPS coordinates', async () => {
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
      querySpy.mockResolvedValueOnce([{ id: stop2Id }] as any);

      // 4. Upsert into drop_events
      querySpy.mockResolvedValueOnce([
        {
          id: 'dev-001',
          trip_id: tripAId,
          student_id: student1Id,
          stop_id: stop2Id,
          status: 'DEBOARDED',
          marked_by: 'DRIVER',
          latitude: 12.9716,
          longitude: 77.5946,
          recorded_at: '2026-10-23T08:15:00Z',
        },
      ] as any);

      // 5. Summary counts
      querySpy.mockResolvedValueOnce([
        {
          total_students: 20,
          boarded_count: 18,
          dropped_count: 1,
          absent_count: 2,
        },
      ] as any);

      const res = await DriverAttendanceService.recordDrop(
        schoolA,
        {
          tripId: tripAId,
          studentId: student1Id,
          stopId: stop2Id,
          status: 'DEBOARDED',
          latitude: 12.9716,
          longitude: 77.5946,
          recordedAt: '2026-10-23T08:15:00Z',
        },
        {
          userId: driverAId,
          isDriver: true,
          userRole: 'DRIVER',
          schoolId: schoolA,
        }
      );

      expect(res.event.id).toBe('dev-001');
      expect(res.event.status).toBe('DEBOARDED');
      expect(res.event.stopId).toBe(stop2Id);
      expect(res.event.latitude).toBe(12.9716);
      expect(res.event.longitude).toBe(77.5946);
      expect(res.student.fullName).toBe('Aarav Sharma');
      expect(res.summary.totalStudents).toBe(20);
      expect(res.summary.boardedCount).toBe(18);
      expect(res.summary.droppedCount).toBe(1);
      expect(res.summary.inBusCount).toBe(17); // 18 - 1 = 17 remaining in bus
    });

    it('records alternate drop status HANDOVER_CONFIRMED', async () => {
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
      querySpy.mockResolvedValueOnce([{ id: stop2Id }] as any);

      // 4. Upsert into drop_events
      querySpy.mockResolvedValueOnce([
        {
          id: 'dev-002',
          trip_id: tripAId,
          student_id: student2Id,
          stop_id: stop2Id,
          status: 'HANDOVER_CONFIRMED',
          marked_by: 'DRIVER',
          latitude: 12.972,
          longitude: 77.595,
          recorded_at: '2026-10-23T08:16:00Z',
        },
      ] as any);

      // 5. Summary counts
      querySpy.mockResolvedValueOnce([
        {
          total_students: 20,
          boarded_count: 18,
          dropped_count: 2,
          absent_count: 2,
        },
      ] as any);

      const res = await DriverAttendanceService.recordDrop(
        schoolA,
        {
          tripId: tripAId,
          studentId: student2Id,
          stopId: stop2Id,
          status: 'HANDOVER_CONFIRMED',
        },
        {
          userId: driverAId,
          isDriver: true,
          userRole: 'DRIVER',
          schoolId: schoolA,
        }
      );

      expect(res.event.status).toBe('HANDOVER_CONFIRMED');
      expect(res.summary.droppedCount).toBe(2);
      expect(res.summary.inBusCount).toBe(16);
    });

    it('resolves drop stop from student stop assignment when stopId is omitted', async () => {
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

      // 3. Assignment lookup resolves stop2Id
      querySpy.mockResolvedValueOnce([{ stop_id: stop2Id }] as any);

      // 4. Upsert into drop_events
      querySpy.mockResolvedValueOnce([
        {
          id: 'dev-003',
          trip_id: tripAId,
          student_id: student1Id,
          stop_id: stop2Id,
          status: 'DEBOARDED',
          marked_by: 'DRIVER',
          latitude: null,
          longitude: null,
          recorded_at: '2026-10-23T08:17:00Z',
        },
      ] as any);

      // 5. Summary counts
      querySpy.mockResolvedValueOnce([
        {
          total_students: 20,
          boarded_count: 18,
          dropped_count: 3,
          absent_count: 2,
        },
      ] as any);

      const res = await DriverAttendanceService.recordDrop(
        schoolA,
        {
          tripId: tripAId,
          studentId: student1Id,
        },
        {
          userId: driverAId,
          isDriver: true,
          userRole: 'DRIVER',
          schoolId: schoolA,
        }
      );

      expect(res.event.stopId).toBe(stop2Id);
    });

    it('rejects drop attendance for completed trips (permanently locked ledger)', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // Trip is COMPLETED
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
        DriverAttendanceService.recordDrop(
          schoolA,
          {
            tripId: tripAId,
            studentId: student1Id,
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

    it('rejects driver attempting to mark drop for a trip assigned to another driver', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // Trip is assigned to driverBId, but caller is driverAId
      querySpy.mockResolvedValueOnce([
        {
          id: tripAId,
          school_id: schoolA,
          bus_id: busAId,
          route_id: routeAId,
          driver_id: driverBId,
          status: 'IN_TRANSIT',
        },
      ] as any);

      await expect(
        DriverAttendanceService.recordDrop(
          schoolA,
          {
            tripId: tripAId,
            studentId: student1Id,
          },
          {
            userId: driverAId,
            isDriver: true,
            userRole: 'DRIVER',
            schoolId: schoolA,
          }
        )
      ).rejects.toThrow(ForbiddenError);
    });

    it('rejects cross-tenant drop attendance attempts with 403 Forbidden', async () => {
      await expect(
        DriverAttendanceService.recordDrop(
          schoolA,
          {
            tripId: tripAId,
            studentId: student1Id,
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

  describe('2. Batch Drop Attendance', () => {
    it('records drop for multiple students at a drop stop', async () => {
      const querySpy = vi.spyOn(db, 'query');

      // Student 1: Trip lookup
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
      // Student 1: Student lookup
      querySpy.mockResolvedValueOnce([
        {
          id: student1Id,
          full_name: 'Aarav Sharma',
          admission_number: 'ADM-101',
          school_id: schoolA,
        },
      ] as any);
      // Student 1: Stop check
      querySpy.mockResolvedValueOnce([{ id: stop2Id }] as any);
      // Student 1: Upsert
      querySpy.mockResolvedValueOnce([
        {
          id: 'dev-001',
          trip_id: tripAId,
          student_id: student1Id,
          stop_id: stop2Id,
          status: 'DEBOARDED',
          marked_by: 'DRIVER',
          latitude: null,
          longitude: null,
          recorded_at: '2026-10-23T08:18:00Z',
        },
      ] as any);
      // Student 1: Summary counts
      querySpy.mockResolvedValueOnce([
        {
          total_students: 20,
          boarded_count: 18,
          dropped_count: 1,
          absent_count: 2,
        },
      ] as any);

      // Student 2: Trip lookup
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
      // Student 2: Student lookup
      querySpy.mockResolvedValueOnce([
        {
          id: student2Id,
          full_name: 'Diya Patel',
          admission_number: 'ADM-102',
          school_id: schoolA,
        },
      ] as any);
      // Student 2: Stop check
      querySpy.mockResolvedValueOnce([{ id: stop2Id }] as any);
      // Student 2: Upsert
      querySpy.mockResolvedValueOnce([
        {
          id: 'dev-002',
          trip_id: tripAId,
          student_id: student2Id,
          stop_id: stop2Id,
          status: 'DEBOARDED',
          marked_by: 'DRIVER',
          latitude: null,
          longitude: null,
          recorded_at: '2026-10-23T08:18:00Z',
        },
      ] as any);
      // Student 2: Summary counts
      querySpy.mockResolvedValueOnce([
        {
          total_students: 20,
          boarded_count: 18,
          dropped_count: 2,
          absent_count: 2,
        },
      ] as any);

      // Final batch summary query
      querySpy.mockResolvedValueOnce([
        {
          total_students: 20,
          boarded_count: 18,
          dropped_count: 2,
          absent_count: 2,
        },
      ] as any);

      const batchResult = await DriverAttendanceService.recordDropBatch(
        schoolA,
        {
          tripId: tripAId,
          stopId: stop2Id,
          records: [
            { studentId: student1Id },
            { studentId: student2Id },
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
      expect(batchResult.summary.droppedCount).toBe(2);
      expect(batchResult.summary.inBusCount).toBe(16);
    });
  });

  describe('3. Driver WhatsApp Drop Commands', () => {
    it('parses "drop Aarav" and records drop via WhatsApp', async () => {
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
          current_stop_sequence: 3,
          route_name: 'Route 1',
          route_code: 'R1',
          bus_number: 'BUS-01',
          total_stops: 5,
        },
      ] as any);

      // 3. Active trip lookup in recordDropViaWhatsApp
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
          stop_id: stop2Id,
          stop_name: 'Sector 4 Drop Point',
        },
      ] as any);

      // 5. Trip lookup inside recordDrop
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

      // 6. Student lookup inside recordDrop
      querySpy.mockResolvedValueOnce([
        {
          id: student1Id,
          full_name: 'Aarav Sharma',
          admission_number: 'ADM-101',
          school_id: schoolA,
        },
      ] as any);

      // 7. Stop check
      querySpy.mockResolvedValueOnce([{ id: stop2Id }] as any);

      // 8. Upsert into drop_events
      querySpy.mockResolvedValueOnce([
        {
          id: 'dev-001',
          trip_id: tripAId,
          student_id: student1Id,
          stop_id: stop2Id,
          status: 'DEBOARDED',
          marked_by: 'DRIVER',
          latitude: null,
          longitude: null,
          recorded_at: '2026-10-23T08:20:00Z',
        },
      ] as any);

      // 9. Summary counts
      querySpy.mockResolvedValueOnce([
        {
          total_students: 15,
          boarded_count: 14,
          dropped_count: 1,
          absent_count: 1,
        },
      ] as any);

      const res = await DriverWhatsappService.handleInboundMessage({
        from: '+919876543210',
        text: 'drop Aarav',
      });

      expect(res.replyText).toContain('Aarav Sharma');
      expect(res.replyText).toContain('Marked as DROPPED / DEBOARDED');
      expect(res.replyText).toContain('Sector 4 Drop Point');
      expect(res.replyText).toContain('1 / 14');
      expect(res.replyText).toContain('Remaining On Bus: *13*');
    });

    it('parses "deboard Diya" and records drop via WhatsApp', async () => {
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
          current_stop_sequence: 3,
          route_name: 'Route 1',
          route_code: 'R1',
          bus_number: 'BUS-01',
          total_stops: 5,
        },
      ] as any);

      // 3. Active trip lookup in recordDropViaWhatsApp
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
          stop_id: stop2Id,
          stop_name: 'Sector 4 Drop Point',
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
      querySpy.mockResolvedValueOnce([{ id: stop2Id }] as any);

      // 8. Upsert into drop_events
      querySpy.mockResolvedValueOnce([
        {
          id: 'dev-002',
          trip_id: tripAId,
          student_id: student2Id,
          stop_id: stop2Id,
          status: 'DEBOARDED',
          marked_by: 'DRIVER',
          latitude: null,
          longitude: null,
          recorded_at: '2026-10-23T08:21:00Z',
        },
      ] as any);

      // 9. Summary counts
      querySpy.mockResolvedValueOnce([
        {
          total_students: 15,
          boarded_count: 14,
          dropped_count: 2,
          absent_count: 1,
        },
      ] as any);

      const res = await DriverWhatsappService.handleInboundMessage({
        from: '+919876543210',
        text: 'deboard Diya',
      });

      expect(res.replyText).toContain('Diya Patel');
      expect(res.replyText).toContain('Marked as DROPPED / DEBOARDED');
      expect(res.replyText).toContain('Remaining On Bus: *12*');
    });
  });

  describe('4. HTTP Endpoints: POST /api/v1/driver/attendance/drop', () => {
    it('returns 201 Created and structured drop response', async () => {
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
      querySpy.mockResolvedValueOnce([{ id: stop2Id }] as any);

      // 4. Upsert
      querySpy.mockResolvedValueOnce([
        {
          id: 'dev-001',
          trip_id: tripAId,
          student_id: student1Id,
          stop_id: stop2Id,
          status: 'DEBOARDED',
          marked_by: 'DRIVER',
          latitude: 12.9716,
          longitude: 77.5946,
          recorded_at: '2026-10-23T08:25:00Z',
        },
      ] as any);

      // 5. Summary counts
      querySpy.mockResolvedValueOnce([
        {
          total_students: 20,
          boarded_count: 18,
          dropped_count: 1,
          absent_count: 2,
        },
      ] as any);

      const res = await request(app)
        .post('/api/v1/driver/attendance/drop')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          tripId: tripAId,
          studentId: student1Id,
          stopId: stop2Id,
          status: 'DEBOARDED',
          latitude: 12.9716,
          longitude: 77.5946,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.event.status).toBe('DEBOARDED');
      expect(res.body.data.summary.droppedCount).toBe(1);
      expect(res.body.data.summary.inBusCount).toBe(17);
    });

    it('rejects unauthenticated request with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/v1/driver/attendance/drop')
        .send({
          tripId: tripAId,
          studentId: student1Id,
          status: 'DEBOARDED',
        });

      expect(res.status).toBe(401);
    });

    it('rejects invalid payload with 422 Unprocessable Entity', async () => {
      const res = await request(app)
        .post('/api/v1/driver/attendance/drop')
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
