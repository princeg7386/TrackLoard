/**
 * Phase 28.3 -- Route Deviation Notifications Tests
 * Tests for: notifySchoolRouteDeviation, notifyDriverRouteDeviation,
 *            dispatchDeviationNotifications
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks must be declared before module imports to avoid temporal dead zone
const { mockQuery, mockSendMessage } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockSendMessage: vi.fn(),
}));

vi.mock('../src/config/database.js', () => ({ query: mockQuery }));

vi.mock('../src/services/messaging/messaging.service.js', () => ({
  MessagingService: { sendMessage: mockSendMessage },
}));

vi.mock('../src/config/env.js', () => ({
  env: {
    JWT_SECRET: 'test-secret',
    MESSAGING_PROVIDER: 'mock',
    DATABASE_URL: 'postgresql://localhost/test',
    PORT: 3001,
    NODE_ENV: 'test',
  },
}));

// Import after mocks are registered
import { RouteDeviationService } from '../src/services/route-deviation.service.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';
const TRIP_ID   = '22222222-2222-2222-2222-222222222222';
const BUS_ID    = '33333333-3333-3333-3333-333333333333';
const DRIVER_ID = '44444444-4444-4444-4444-444444444444';
const DEV_ID    = '55555555-5555-5555-5555-555555555555';

const baseDeviationRow = {
  school_id: SCHOOL_ID,
  trip_id: TRIP_ID,
  bus_id: BUS_ID,
  driver_id: DRIVER_ID,
  severity: 'HIGH' as const,
  current_deviation_distance_meters: 650,
  duration_seconds: 120,
  deviation_latitude: 28.6139,
  deviation_longitude: 77.2090,
  school_notified_at: null,
  driver_notified_at: null,
};

const contextRow = {
  bus_number: 'DL-01-AB-1234',
  route_name: 'Morning Route A',
  school_name: 'Green Valley School',
};

const adminRow  = { phone: '+911234567890', name: 'Admin User' };
const driverRow = { phone: '+919876543210' };

// ---------------------------------------------------------------------------

describe('Phase 28.3 -- Route Deviation Notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockResolvedValue({ status: 'sent', messageId: 'msg-001' });
  });

  // -------------------------------------------------------------------------
  describe('notifySchoolRouteDeviation', () => {
    it('sends WhatsApp to admin phones and updates school_notified_at', async () => {
      mockQuery
        .mockResolvedValueOnce([{ school_notified_at: null }])   // cooldown check
        .mockResolvedValueOnce([contextRow])                      // trip/bus/route context
        .mockResolvedValueOnce([adminRow])                        // recipients
        .mockResolvedValueOnce([]);                               // UPDATE school_notified_at

      const result = await RouteDeviationService.notifySchoolRouteDeviation({
        deviationId: DEV_ID,
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        busId: BUS_ID,
        severity: 'HIGH',
        distanceMeters: 650,
        durationSeconds: 120,
        deviationLat: 28.6139,
        deviationLng: 77.2090,
      });

      expect(result.sent).toBe(true);
      expect(result.recipientsCount).toBe(1);
      expect(result.cooldownSkipped).toBe(false);
      expect(mockSendMessage).toHaveBeenCalledTimes(1);

      const msg = mockSendMessage.mock.calls[0][0];
      expect(msg.eventType).toBe('ROUTE_DEVIATION');
      expect(msg.recipientPhone).toBe('+911234567890');
      expect(msg.directText).toContain('Bus Off Route Alert');
      expect(msg.directText).toContain('DL-01-AB-1234');
      expect(msg.directText).toContain('650m');
    });

    it('skips sending when within 5-minute cooldown', async () => {
      const recentTime = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 min ago
      mockQuery.mockResolvedValueOnce([{ school_notified_at: recentTime }]);

      const result = await RouteDeviationService.notifySchoolRouteDeviation({
        deviationId: DEV_ID,
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        busId: BUS_ID,
        severity: 'HIGH',
        distanceMeters: 650,
        durationSeconds: 120,
        deviationLat: 28.6139,
        deviationLng: 77.2090,
      });

      expect(result.sent).toBe(false);
      expect(result.cooldownSkipped).toBe(true);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('bypasses cooldown when forceNotify=true', async () => {
      // forceNotify skips cooldown query -- straight to context + recipients + UPDATE
      mockQuery
        .mockResolvedValueOnce([contextRow])
        .mockResolvedValueOnce([adminRow])
        .mockResolvedValueOnce([]);

      const result = await RouteDeviationService.notifySchoolRouteDeviation({
        deviationId: DEV_ID,
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        busId: BUS_ID,
        severity: 'CRITICAL',
        distanceMeters: 1200,
        durationSeconds: 300,
        deviationLat: 28.6139,
        deviationLng: 77.2090,
        forceNotify: true,
      });

      expect(result.sent).toBe(true);
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    it('returns sent=false gracefully when no admin phones found', async () => {
      mockQuery
        .mockResolvedValueOnce([{ school_notified_at: null }])
        .mockResolvedValueOnce([contextRow])
        .mockResolvedValueOnce([]); // no recipients

      const result = await RouteDeviationService.notifySchoolRouteDeviation({
        deviationId: DEV_ID,
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        busId: BUS_ID,
        severity: 'LOW',
        distanceMeters: 150,
        durationSeconds: 30,
        deviationLat: 28.6139,
        deviationLng: 77.2090,
      });

      expect(result.sent).toBe(false);
      expect(result.recipientsCount).toBe(0);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('enforces tenant isolation -- all DB queries include schoolId', async () => {
      mockQuery
        .mockResolvedValueOnce([{ school_notified_at: null }])
        .mockResolvedValueOnce([contextRow])
        .mockResolvedValueOnce([adminRow])
        .mockResolvedValueOnce([]);

      await RouteDeviationService.notifySchoolRouteDeviation({
        deviationId: DEV_ID,
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        busId: BUS_ID,
        severity: 'MEDIUM',
        distanceMeters: 300,
        durationSeconds: 60,
        deviationLat: 28.0,
        deviationLng: 77.0,
      });

      for (const call of mockQuery.mock.calls) {
        expect(call[1]).toContain(SCHOOL_ID);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('notifyDriverRouteDeviation', () => {
    it('sends WhatsApp to driver and updates driver_notified_at', async () => {
      mockQuery
        .mockResolvedValueOnce([{ driver_notified_at: null }])
        .mockResolvedValueOnce([driverRow])
        .mockResolvedValueOnce([]);

      const result = await RouteDeviationService.notifyDriverRouteDeviation({
        deviationId: DEV_ID,
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        driverId: DRIVER_ID,
        severity: 'HIGH',
        distanceMeters: 650,
      });

      expect(result.sent).toBe(true);
      expect(result.cooldownSkipped).toBe(false);
      expect(mockSendMessage).toHaveBeenCalledTimes(1);

      const msg = mockSendMessage.mock.calls[0][0];
      expect(msg.eventType).toBe('ROUTE_DEVIATION');
      expect(msg.recipientPhone).toBe('+919876543210');
      expect(msg.directText).toContain('Route Alert');
      expect(msg.directText).toContain('650m');
    });

    it('skips when within 5-minute driver cooldown', async () => {
      const recentTime = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      mockQuery.mockResolvedValueOnce([{ driver_notified_at: recentTime }]);

      const result = await RouteDeviationService.notifyDriverRouteDeviation({
        deviationId: DEV_ID,
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        driverId: DRIVER_ID,
        severity: 'HIGH',
        distanceMeters: 650,
      });

      expect(result.sent).toBe(false);
      expect(result.cooldownSkipped).toBe(true);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('returns sent=false gracefully when driver phone not found', async () => {
      mockQuery
        .mockResolvedValueOnce([{ driver_notified_at: null }])
        .mockResolvedValueOnce([]); // no phone

      const result = await RouteDeviationService.notifyDriverRouteDeviation({
        deviationId: DEV_ID,
        schoolId: SCHOOL_ID,
        tripId: TRIP_ID,
        driverId: DRIVER_ID,
        severity: 'HIGH',
        distanceMeters: 650,
      });

      expect(result.sent).toBe(false);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('dispatchDeviationNotifications', () => {
    it('fetches context and dispatches both school and driver notifications', async () => {
      mockQuery
        .mockResolvedValueOnce([baseDeviationRow])             // deviation context
        .mockResolvedValueOnce([{ school_notified_at: null }]) // school cooldown
        .mockResolvedValueOnce([contextRow])                   // school message context
        .mockResolvedValueOnce([adminRow])                     // school recipients
        .mockResolvedValueOnce([])                             // UPDATE school_notified_at
        .mockResolvedValueOnce([{ driver_notified_at: null }]) // driver cooldown
        .mockResolvedValueOnce([driverRow])                    // driver phone
        .mockResolvedValueOnce([]);                            // UPDATE driver_notified_at

      const result = await RouteDeviationService.dispatchDeviationNotifications(DEV_ID);

      expect(result.deviationId).toBe(DEV_ID);
      expect(result.schoolNotified).toBe(true);
      expect(result.driverNotified).toBe(true);
      expect(result.schoolRecipientsCount).toBe(1);
    });

    it('skips driver notification when no active driver assignment (driver_id = null)', async () => {
      mockQuery
        .mockResolvedValueOnce([{ ...baseDeviationRow, driver_id: null }])
        .mockResolvedValueOnce([{ school_notified_at: null }])
        .mockResolvedValueOnce([contextRow])
        .mockResolvedValueOnce([adminRow])
        .mockResolvedValueOnce([]);

      const result = await RouteDeviationService.dispatchDeviationNotifications(DEV_ID);

      expect(result.schoolNotified).toBe(true);
      expect(result.driverNotified).toBe(false);
    });

    it('returns safe error result when deviation not found -- never throws', async () => {
      mockQuery.mockResolvedValueOnce([]); // empty result

      await expect(RouteDeviationService.dispatchDeviationNotifications(DEV_ID))
        .resolves
        .toMatchObject({
          deviationId: DEV_ID,
          schoolNotified: false,
          driverNotified: false,
          message: expect.stringContaining('not found'),
        });
    });

    it('returns safe error result on unexpected DB error -- never throws', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB connection lost'));

      await expect(RouteDeviationService.dispatchDeviationNotifications(DEV_ID))
        .resolves
        .toMatchObject({
          deviationId: DEV_ID,
          schoolNotified: false,
          driverNotified: false,
          message: expect.stringContaining('failed'),
        });
    });

    it('respects cooldown for both channels on repeated dispatch', async () => {
      const recentTime = new Date(Date.now() - 1 * 60 * 1000).toISOString(); // 1 min ago
      mockQuery
        .mockResolvedValueOnce([baseDeviationRow])
        .mockResolvedValueOnce([{ school_notified_at: recentTime }])  // school cooldown hit
        .mockResolvedValueOnce([{ driver_notified_at: recentTime }]); // driver cooldown hit

      const result = await RouteDeviationService.dispatchDeviationNotifications(DEV_ID);

      expect(result.schoolCooldownSkipped).toBe(true);
      expect(result.driverCooldownSkipped).toBe(true);
      expect(result.schoolNotified).toBe(false);
      expect(result.driverNotified).toBe(false);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });
});
