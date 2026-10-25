import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import * as db from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { LongStopDetectionService } from '../src/services/long-stop-detection.service.js';
import { DriverWhatsappService } from '../src/services/driver-whatsapp.service.js';
import {
  LongStopDriverReason,
  LONG_STOP_REASON_LABELS,
  UserRole,
} from '@school-bus/shared';
import jwt from 'jsonwebtoken';

// Mock database query
vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  pool: { end: vi.fn() },
}));

describe('Phase 26.2: Long Stop Driver Reason (Traffic, Vehicle problem, Student issue, Road block, Other, No problem)', () => {
  const schoolId = '11111111-1111-1111-1111-111111111111';
  const tripId = '22222222-2222-2222-2222-222222222222';
  const busId = '33333333-3333-3333-3333-333333333333';
  const driverId = '44444444-4444-4444-4444-444444444444';
  const activeLongStopId = '55555555-5555-5555-5555-555555555555';
  const mockQuery = vi.mocked(db.query);

  const driverToken = jwt.sign(
    {
      sub: driverId,
      id: driverId,
      schoolId,
      role: UserRole.DRIVER,
      phone: '+919876543210',
    },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  const adminToken = jwt.sign(
    {
      sub: 'admin-1',
      id: 'admin-1',
      schoolId,
      role: UserRole.SCHOOL_ADMIN,
    },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  let app: any;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('1. Parsing Driver Reason from Inbound Text (parseLongStopReason)', () => {
    it('parses TRAFFIC from various inputs', () => {
      expect(DriverWhatsappService.parseLongStopReason('traffic')?.reason).toBe(LongStopDriverReason.TRAFFIC);
      expect(DriverWhatsappService.parseLongStopReason('traffic jam')?.reason).toBe(LongStopDriverReason.TRAFFIC);
      expect(DriverWhatsappService.parseLongStopReason('traffic 15 mins')?.reason).toBe(LongStopDriverReason.TRAFFIC);
      expect(DriverWhatsappService.parseLongStopReason('traffic 15 mins')?.notes).toBe('15 mins');
      expect(DriverWhatsappService.parseLongStopReason('reason traffic')?.reason).toBe(LongStopDriverReason.TRAFFIC);
      expect(DriverWhatsappService.parseLongStopReason('reason 1')?.reason).toBe(LongStopDriverReason.TRAFFIC);
      expect(DriverWhatsappService.parseLongStopReason('stop 1')?.reason).toBe(LongStopDriverReason.TRAFFIC);
    });

    it('parses VEHICLE_PROBLEM from various inputs', () => {
      expect(DriverWhatsappService.parseLongStopReason('vehicle problem')?.reason).toBe(LongStopDriverReason.VEHICLE_PROBLEM);
      expect(DriverWhatsappService.parseLongStopReason('breakdown')?.reason).toBe(LongStopDriverReason.VEHICLE_PROBLEM);
      expect(DriverWhatsappService.parseLongStopReason('puncture')?.reason).toBe(LongStopDriverReason.VEHICLE_PROBLEM);
      expect(DriverWhatsappService.parseLongStopReason('mechanical')?.reason).toBe(LongStopDriverReason.VEHICLE_PROBLEM);
      expect(DriverWhatsappService.parseLongStopReason('reason 2')?.reason).toBe(LongStopDriverReason.VEHICLE_PROBLEM);
      expect(DriverWhatsappService.parseLongStopReason('stop 2')?.reason).toBe(LongStopDriverReason.VEHICLE_PROBLEM);
      expect(DriverWhatsappService.parseLongStopReason('breakdown flat tire')?.notes).toBe('flat tire');
    });

    it('parses STUDENT_ISSUE from various inputs', () => {
      expect(DriverWhatsappService.parseLongStopReason('student issue')?.reason).toBe(LongStopDriverReason.STUDENT_ISSUE);
      expect(DriverWhatsappService.parseLongStopReason('waiting student')?.reason).toBe(LongStopDriverReason.STUDENT_ISSUE);
      expect(DriverWhatsappService.parseLongStopReason('waiting for student')?.reason).toBe(LongStopDriverReason.STUDENT_ISSUE);
      expect(DriverWhatsappService.parseLongStopReason('reason 3')?.reason).toBe(LongStopDriverReason.STUDENT_ISSUE);
      expect(DriverWhatsappService.parseLongStopReason('stop 3')?.reason).toBe(LongStopDriverReason.STUDENT_ISSUE);
      expect(DriverWhatsappService.parseLongStopReason('student issue unwell')?.notes).toBe('unwell');
    });

    it('parses ROAD_BLOCK from various inputs', () => {
      expect(DriverWhatsappService.parseLongStopReason('road block')?.reason).toBe(LongStopDriverReason.ROAD_BLOCK);
      expect(DriverWhatsappService.parseLongStopReason('roadblock')?.reason).toBe(LongStopDriverReason.ROAD_BLOCK);
      expect(DriverWhatsappService.parseLongStopReason('diversion')?.reason).toBe(LongStopDriverReason.ROAD_BLOCK);
      expect(DriverWhatsappService.parseLongStopReason('road closed')?.reason).toBe(LongStopDriverReason.ROAD_BLOCK);
      expect(DriverWhatsappService.parseLongStopReason('reason 4')?.reason).toBe(LongStopDriverReason.ROAD_BLOCK);
      expect(DriverWhatsappService.parseLongStopReason('stop 4')?.reason).toBe(LongStopDriverReason.ROAD_BLOCK);
      expect(DriverWhatsappService.parseLongStopReason('roadblock construction')?.notes).toBe('construction');
    });

    it('parses OTHER with custom notes from various inputs', () => {
      expect(DriverWhatsappService.parseLongStopReason('other')?.reason).toBe(LongStopDriverReason.OTHER);
      expect(DriverWhatsappService.parseLongStopReason('other waiting for teacher')?.reason).toBe(LongStopDriverReason.OTHER);
      expect(DriverWhatsappService.parseLongStopReason('other waiting for teacher')?.notes).toBe('waiting for teacher');
      expect(DriverWhatsappService.parseLongStopReason('reason 5')?.reason).toBe(LongStopDriverReason.OTHER);
      expect(DriverWhatsappService.parseLongStopReason('stop 5')?.reason).toBe(LongStopDriverReason.OTHER);
    });

    it('parses NO_PROBLEM from various inputs', () => {
      expect(DriverWhatsappService.parseLongStopReason('no problem')?.reason).toBe(LongStopDriverReason.NO_PROBLEM);
      expect(DriverWhatsappService.parseLongStopReason('all good')?.reason).toBe(LongStopDriverReason.NO_PROBLEM);
      expect(DriverWhatsappService.parseLongStopReason('all ok')?.reason).toBe(LongStopDriverReason.NO_PROBLEM);
      expect(DriverWhatsappService.parseLongStopReason('safe')?.reason).toBe(LongStopDriverReason.NO_PROBLEM);
      expect(DriverWhatsappService.parseLongStopReason('reason 6')?.reason).toBe(LongStopDriverReason.NO_PROBLEM);
      expect(DriverWhatsappService.parseLongStopReason('stop 6')?.reason).toBe(LongStopDriverReason.NO_PROBLEM);
    });

    it('returns null for unrelated commands', () => {
      expect(DriverWhatsappService.parseLongStopReason('menu')).toBeNull();
      expect(DriverWhatsappService.parseLongStopReason('start trip')).toBeNull();
      expect(DriverWhatsappService.parseLongStopReason('end trip')).toBeNull();
      expect(DriverWhatsappService.parseLongStopReason('board Aarav')).toBeNull();
    });
  });

  describe('2. Domain Service: LongStopDetectionService.recordDriverReason', () => {
    it('throws NotFoundError if trip does not exist in school', async () => {
      mockQuery.mockResolvedValueOnce([]); // No trip row

      await expect(
        LongStopDetectionService.recordDriverReason({
          schoolId,
          tripId,
          reason: LongStopDriverReason.TRAFFIC,
        })
      ).rejects.toThrow(/not found/i);
    });

    it('records reason on active long stop and sets stop_type', async () => {
      // 1. Mock trip lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_TRANSIT',
        },
      ]);

      // 2. Mock find active long stop
      mockQuery.mockResolvedValueOnce([{ id: activeLongStopId }]);

      // 3. Mock update query
      mockQuery.mockResolvedValueOnce([]);

      const result = await LongStopDetectionService.recordDriverReason({
        schoolId,
        tripId,
        driverId,
        reason: LongStopDriverReason.TRAFFIC,
        notes: 'Dense gridlock at Outer Ring Road',
        source: 'WHATSAPP',
      });

      expect(result.success).toBe(true);
      expect(result.longStopId).toBe(activeLongStopId);
      expect(result.reason).toBe(LongStopDriverReason.TRAFFIC);
      expect(result.reasonLabel).toBe(LONG_STOP_REASON_LABELS.TRAFFIC);
      expect(result.notes).toBe('Dense gridlock at Outer Ring Road');

      // Verify update query executed
      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(mockQuery.mock.calls[2]![0]).toMatch(/UPDATE long_stops/i);
      expect(mockQuery.mock.calls[2]![1]![0]).toBe(LongStopDriverReason.TRAFFIC);
    });

    it('records reason proactively when no long stop was previously created', async () => {
      // 1. Mock trip lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_TRANSIT',
        },
      ]);

      // 2. Mock active long stop (none)
      mockQuery.mockResolvedValueOnce([]);

      // 3. Mock recent long stop (none)
      mockQuery.mockResolvedValueOnce([]);

      // 4. Mock insert long stop
      const proactiveId = '99999999-9999-9999-9999-999999999999';
      mockQuery.mockResolvedValueOnce([{ id: proactiveId }]);

      const result = await LongStopDetectionService.recordDriverReason({
        schoolId,
        tripId,
        driverId,
        reason: LongStopDriverReason.VEHICLE_PROBLEM,
        notes: 'Punctured rear tire, replacing with spare',
        source: 'APP',
      });

      expect(result.success).toBe(true);
      expect(result.longStopId).toBe(proactiveId);
      expect(result.reason).toBe(LongStopDriverReason.VEHICLE_PROBLEM);
      expect(result.reasonLabel).toBe(LONG_STOP_REASON_LABELS.VEHICLE_PROBLEM);

      // Verify insert query executed
      expect(mockQuery).toHaveBeenCalledTimes(4);
      expect(mockQuery.mock.calls[3]![0]).toMatch(/INSERT INTO long_stops/i);
    });
  });

  describe('3. Driver WhatsApp Inbound Message Flow', () => {
    it('records reason and returns formatted WhatsApp confirmation for "traffic"', async () => {
      // 1. Mock find driver by phone
      mockQuery.mockResolvedValueOnce([
        {
          id: driverId,
          school_id: schoolId,
          full_name: 'Rajesh Sharma',
          phone: '+919876543210',
          license_number: 'DL-01-2015-1234',
          default_bus_id: busId,
          bus_number: 'BUS-101',
          registration_number: 'DL-01-AB-1234',
        },
      ]);

      // 2. Mock menu check (active trip found)
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          route_id: 'route-1',
          route_name: 'North Campus Route',
          route_code: 'RTE-NC-01',
          bus_id: busId,
          bus_number: 'BUS-101',
          registration_number: 'DL-01-AB-1234',
          status: 'IN_TRANSIT',
          scheduled_date: '2026-10-25',
          scheduled_start_time: '2026-10-25T07:30:00Z',
          actual_start_time: '2026-10-25T07:32:00Z',
        },
      ]);

      // 3. Mock trip lookup inside recordDriverReason
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_TRANSIT',
        },
      ]);

      // 4. Mock active long stop check inside recordDriverReason
      mockQuery.mockResolvedValueOnce([{ id: activeLongStopId }]);

      // 5. Mock update long_stops inside recordDriverReason
      mockQuery.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/message')
        .send({
          from: '+919876543210',
          text: 'traffic heavy bottleneck at flyover',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe('LONG_STOP_REASON');
      expect(res.body.data.replyText).toContain('Stop Reason Recorded');
      expect(res.body.data.replyText).toContain('Traffic');
      expect(res.body.data.replyText).toContain('heavy bottleneck at flyover');
      expect(res.body.data.replyText).toContain('North Campus Route');
    });

    it('records NO_PROBLEM via "no problem" WhatsApp command', async () => {
      // 1. Mock driver lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: driverId,
          school_id: schoolId,
          full_name: 'Rajesh Sharma',
          phone: '+919876543210',
          license_number: 'DL-01-2015-1234',
          default_bus_id: busId,
        },
      ]);

      // 2. Mock menu check (active trip found)
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          route_id: 'route-1',
          route_name: 'North Campus Route',
          route_code: 'RTE-NC-01',
          bus_id: busId,
          status: 'IN_TRANSIT',
        },
      ]);

      // 3. Mock trip lookup inside recordDriverReason
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_TRANSIT',
        },
      ]);

      // 4. Mock active long stop check
      mockQuery.mockResolvedValueOnce([{ id: activeLongStopId }]);

      // 5. Mock update long_stops
      mockQuery.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/message')
        .send({
          from: '+919876543210',
          text: 'no problem',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.actionTriggered).toBe('LONG_STOP_REASON');
      expect(res.body.data.replyText).toContain('Stop Reason Recorded');
      expect(res.body.data.replyText).toContain('No problem');
    });

    it('informs driver when no active trip is running', async () => {
      // 1. Mock driver lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: driverId,
          school_id: schoolId,
          full_name: 'Rajesh Sharma',
          phone: '+919876543210',
          license_number: 'DL-01-2015-1234',
        },
      ]);

      // 2. Mock menu check (no active trip)
      mockQuery.mockResolvedValueOnce([]);

      // 3. Mock menu check (no scheduled trip)
      mockQuery.mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/v1/driver/whatsapp/message')
        .send({
          from: '+919876543210',
          text: 'reason traffic',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.replyText).toContain('No Active Trip Found');
    });
  });

  describe('4. HTTP Endpoint: POST /api/v1/schools/:schoolId/trips/:tripId/long-stop/reason', () => {
    it('successfully records driver reason via authenticated API', async () => {
      // 1. Mock trip lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_TRANSIT',
        },
      ]);

      // 2. Mock active long stop lookup
      mockQuery.mockResolvedValueOnce([{ id: activeLongStopId }]);

      // 3. Mock update query
      mockQuery.mockResolvedValueOnce([]);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolId}/trips/${tripId}/long-stop/reason`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          reason: LongStopDriverReason.ROAD_BLOCK,
          notes: 'Pipeline repair work ahead, taking bypass',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reason).toBe('ROAD_BLOCK');
      expect(res.body.data.reasonLabel).toBe('Road block');
      expect(res.body.data.notes).toBe('Pipeline repair work ahead, taking bypass');
    });

    it('rejects invalid reason enum with 422 Unprocessable Entity', async () => {
      const res = await request(app)
        .post(`/api/v1/schools/${schoolId}/trips/${tripId}/long-stop/reason`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'INVALID_REASON_CODE',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('rejects unauthenticated request with 401 Unauthorized', async () => {
      const res = await request(app)
        .post(`/api/v1/schools/${schoolId}/trips/${tripId}/long-stop/reason`)
        .send({
          reason: LongStopDriverReason.TRAFFIC,
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });
});
