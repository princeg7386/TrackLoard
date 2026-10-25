import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import * as db from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { LongStopDetectionService } from '../src/services/long-stop-detection.service.js';
import { OperationalNotificationService } from '../src/services/operational-notification.service.js';
import { RealtimeFeedService } from '../src/services/realtime-feed.service.js';
import {
  LongStopDriverReason,
  UserRole,
} from '@school-bus/shared';
import jwt from 'jsonwebtoken';

// Mock database query
vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  pool: { end: vi.fn() },
}));

// Mock OperationalNotificationService
vi.mock('../src/services/operational-notification.service.js', () => ({
  OperationalNotificationService: {
    notifyUnusualStop: vi.fn().mockResolvedValue({
      tripId: 'trip-1',
      eventType: 'UNUSUAL_STOP',
      notificationsSent: 1,
      recipientsCount: 1,
      cooldownActive: false,
    }),
  },
}));

// Mock RealtimeFeedService
vi.mock('../src/services/realtime-feed.service.js', () => ({
  RealtimeFeedService: {
    publish: vi.fn(),
  },
}));

describe('Phase 26.3: Long Stop School Workflow (Create event, Notify school, Store reason, Resolve event)', () => {
  const schoolId = '11111111-1111-1111-1111-111111111111';
  const tripId = '22222222-2222-2222-2222-222222222222';
  const busId = '33333333-3333-3333-3333-333333333333';
  const driverId = '44444444-4444-4444-4444-444444444444';
  const longStopId = '55555555-5555-5555-5555-555555555555';
  const coordinatorId = '66666666-6666-6666-6666-666666666666';
  const mockQuery = vi.mocked(db.query);

  const coordinatorToken = jwt.sign(
    {
      sub: coordinatorId,
      id: coordinatorId,
      schoolId,
      role: UserRole.TRANSPORT_COORDINATOR,
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

  describe('1. Create Event & Notify School (notifySchoolLongStop)', () => {
    it('notifies school staff and broadcasts real-time dashboard alert', async () => {
      // Mock update school_notified_at in long_stops
      mockQuery.mockResolvedValueOnce([]);

      const success = await LongStopDetectionService.notifySchoolLongStop({
        schoolId,
        tripId,
        busId,
        longStopId,
        durationMinutes: 7,
        latitude: 28.6139,
        longitude: 77.2090,
      });

      expect(success).toBe(true);

      // Verify OperationalNotificationService was called
      expect(OperationalNotificationService.notifyUnusualStop).toHaveBeenCalledWith({
        schoolId,
        tripId,
        stoppedDurationMinutes: 7,
        latitude: 28.6139,
        longitude: 77.2090,
      });

      // Verify DB was updated with school_notified_at
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0]![0]).toMatch(/school_notified_at = NOW\(\)/i);
      expect(mockQuery.mock.calls[0]![1]).toEqual([longStopId]);

      // Verify RealtimeFeedService published alert
      expect(RealtimeFeedService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'NOTIFICATION_ALERT',
          schoolId,
          busId,
          tripId,
          notificationAlert: expect.objectContaining({
            eventType: 'UNUSUAL_STOP',
            priority: 'HIGH',
          }),
        })
      );
    });

    it('suppresses errors gracefully if notification service throws', async () => {
      vi.mocked(OperationalNotificationService.notifyUnusualStop).mockRejectedValueOnce(
        new Error('Network timeout')
      );

      const success = await LongStopDetectionService.notifySchoolLongStop({
        schoolId,
        tripId,
        busId,
        longStopId,
        durationMinutes: 6,
        latitude: 28.6139,
        longitude: 77.2090,
      });

      expect(success).toBe(false);
    });
  });

  describe('2. Store Reason in Workflow (recordDriverReason)', () => {
    it('stores coordinator/driver reason and updates stop_type', async () => {
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
      mockQuery.mockResolvedValueOnce([{ id: longStopId }]);

      // 3. Mock update query
      mockQuery.mockResolvedValueOnce([]);

      const result = await LongStopDetectionService.recordDriverReason({
        schoolId,
        tripId,
        reason: LongStopDriverReason.ROAD_BLOCK,
        notes: 'Waterlogging on main road, diverted via link road',
        source: 'MANUAL_OVERRIDE',
        longStopId,
      });

      expect(result.success).toBe(true);
      expect(result.reason).toBe(LongStopDriverReason.ROAD_BLOCK);
      expect(result.reasonLabel).toBe('Road block');
      expect(result.notes).toContain('Waterlogging');

      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(mockQuery.mock.calls[2]![0]).toMatch(/UPDATE long_stops/i);
    });
  });

  describe('3. Resolve Long Stop Event', () => {
    it('automatically resolves active long stop on vehicle resumption', async () => {
      // Mock update status = RESOLVED returning id, school_id, bus_id
      mockQuery.mockResolvedValueOnce([
        {
          id: longStopId,
          school_id: schoolId,
          bus_id: busId,
        },
      ]);

      const resolved = await LongStopDetectionService.resolveActiveLongStop(tripId);
      expect(resolved).toBe(true);

      // Verify update query executed
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0]![0]).toMatch(/SET status = 'RESOLVED'/i);

      // Verify RealtimeFeedService published resolution
      expect(RealtimeFeedService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'NOTIFICATION_ALERT',
          notificationAlert: expect.objectContaining({
            title: 'Long Stop Resolved',
          }),
        })
      );
    });

    it('manually resolves active long stop with coordinator notes', async () => {
      // 1. Mock trip lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          bus_id: busId,
        },
      ]);

      // 2. Mock active long stop lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: longStopId,
          status: 'ACTIVE',
          driver_reason: 'TRAFFIC',
        },
      ]);

      // 3. Mock update query
      mockQuery.mockResolvedValueOnce([]);

      const result = await LongStopDetectionService.resolveLongStopManual({
        schoolId,
        tripId,
        longStopId,
        resolvedBy: coordinatorId,
        resolutionNotes: 'Spoke with traffic police; clearance confirmed.',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('RESOLVED');
      expect(result.resolved).toBe(true);
      expect(result.driverReason).toBe('TRAFFIC');

      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(mockQuery.mock.calls[2]![0]).toMatch(/SET status = 'RESOLVED'/i);
    });
  });

  describe('4. Acknowledge Long Stop Event', () => {
    it('records coordinator acknowledgement on active long stop', async () => {
      // 1. Mock trip lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          bus_id: busId,
        },
      ]);

      // 2. Mock active long stop lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: longStopId,
          driver_reason: 'VEHICLE_PROBLEM',
        },
      ]);

      // 3. Mock update query
      mockQuery.mockResolvedValueOnce([]);

      const result = await LongStopDetectionService.acknowledgeLongStop({
        schoolId,
        tripId,
        longStopId,
        acknowledgedBy: coordinatorId,
        notes: 'Contacted driver Rajesh; mechanic en route.',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('ACTIVE');
      expect(result.message).toContain('acknowledged');

      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(mockQuery.mock.calls[2]![0]).toMatch(/acknowledged_by = \$1/i);
    });
  });

  describe('5. HTTP Endpoints: School Workflow', () => {
    it('POST /long-stop/resolve manually resolves event via authenticated API', async () => {
      // 1. Mock trip lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          bus_id: busId,
        },
      ]);

      // 2. Mock active long stop lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: longStopId,
          status: 'ACTIVE',
          driver_reason: 'TRAFFIC',
        },
      ]);

      // 3. Mock update query
      mockQuery.mockResolvedValueOnce([]);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolId}/trips/${tripId}/long-stop/resolve`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          longStopId,
          resolutionNotes: 'Congestion cleared, vehicle proceeding to next stop',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('RESOLVED');
      expect(res.body.data.resolved).toBe(true);
    });

    it('POST /long-stop/acknowledge records coordinator acknowledgement', async () => {
      // 1. Mock trip lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          bus_id: busId,
        },
      ]);

      // 2. Mock active long stop lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: longStopId,
          driver_reason: 'STUDENT_ISSUE',
        },
      ]);

      // 3. Mock update query
      mockQuery.mockResolvedValueOnce([]);

      const res = await request(app)
        .post(`/api/v1/schools/${schoolId}/trips/${tripId}/long-stop/acknowledge`)
        .set('Authorization', `Bearer ${coordinatorToken}`)
        .send({
          longStopId,
          notes: 'Driver informed us student was feeling nauseous',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toContain('acknowledged');
    });

    it('rejects unauthenticated request to /long-stop/resolve with 401', async () => {
      const res = await request(app)
        .post(`/api/v1/schools/${schoolId}/trips/${tripId}/long-stop/resolve`)
        .send({
          longStopId,
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });
});
