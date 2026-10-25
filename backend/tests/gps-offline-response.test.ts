import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { GpsOfflineDetectionService } from '../src/services/gps-offline-detection.service.js';
import { OperationalNotificationService } from '../src/services/operational-notification.service.js';
import { MessagingService } from '../src/services/messaging/messaging.service.js';
import { RealtimeFeedService } from '../src/services/realtime-feed.service.js';
import { AuthService } from '../src/services/auth.service.js';
import { UserRole } from '@school-bus/shared';
import * as database from '../src/config/database.js';

// Mock database query
vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  pool: { end: vi.fn() },
}));

// Spies on external notification adapters
vi.spyOn(OperationalNotificationService, 'notifyGpsUnavailable').mockResolvedValue({
  tripId: 'mock-trip',
  eventType: 'GPS_UNAVAILABLE',
  notificationsSent: 1,
  recipientsCount: 1,
  cooldownActive: false,
});
vi.spyOn(MessagingService, 'sendMessage').mockResolvedValue({
  success: true,
  providerMessageId: 'msg-123',
  delivered: true,
});
vi.spyOn(RealtimeFeedService, 'publish').mockImplementation(() => {});

describe('Phase 27.2: GPS Offline Response (Store Last Known Location, Notify School, Notify Driver)', () => {
  const app = createApp();

  const schoolId = '11111111-1111-1111-1111-111111111111';
  const tripId = '22222222-2222-2222-2222-222222222222';
  const busId = '33333333-3333-3333-3333-333333333333';
  const eventId = '55555555-5555-5555-5555-555555555555';
  const driverId = '44444444-4444-4444-4444-444444444444';

  const mockAdminUser = {
    id: 'admin-111',
    schoolId,
    email: 'admin@school.com',
    role: UserRole.SCHOOL_ADMIN,
  };
  const adminToken = AuthService.generateToken(mockAdminUser);

  const mockQuery = vi.mocked(database.query);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Task 1: Store & Lock Last Known Location (getLastKnownLocation)', () => {
    it('retrieves locked last known location details with kinematics and staleness', async () => {
      const now = Date.now();
      const recordedAt = new Date(now - 100 * 1000); // 100s ago (> 60s)

      mockQuery.mockResolvedValueOnce([
        {
          last_latitude: 28.6139,
          last_longitude: 77.2090,
          last_speed_kmh: 32.5,
          last_bearing_degrees: 180.0,
          last_accuracy_meters: 8.5,
          last_battery_percentage: 78,
          last_network_type: 'CELLULAR',
          last_gps_recorded_at: recordedAt,
          event_address: 'Near Connaught Place Outer Circle, New Delhi',
        },
      ]);

      const result = await GpsOfflineDetectionService.getLastKnownLocation(tripId);

      expect(result.latitude).toBe(28.6139);
      expect(result.longitude).toBe(77.2090);
      expect(result.speedKmh).toBe(32.5);
      expect(result.bearingDegrees).toBe(180.0);
      expect(result.accuracyMeters).toBe(8.5);
      expect(result.batteryPercentage).toBe(78);
      expect(result.networkType).toBe('CELLULAR');
      expect(result.address).toBe('Near Connaught Place Outer Circle, New Delhi');
      expect(result.isStale).toBe(true);
      expect(result.ageSeconds).toBeGreaterThanOrEqual(99);
    });

    it('throws NotFoundError when trip does not exist', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await expect(
        GpsOfflineDetectionService.getLastKnownLocation('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('Trip with ID \'00000000-0000-0000-0000-000000000000\' not found');
    });
  });

  describe('2. Task 2: Notify School (notifySchoolGpsOffline)', () => {
    it('notifies school transport coordinators and staff via OperationalNotificationService', async () => {
      // 1. Mock trip context
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          bus_number: 'DL-01-AB-1234',
          route_name: 'Route 4 - Central Delhi',
          last_gps_recorded_at: new Date(),
          last_latitude: 28.6139,
          last_longitude: 77.2090,
        },
      ]);

      // 2. Mock update school_notified_at on event
      mockQuery.mockResolvedValueOnce([]);

      const notified = await GpsOfflineDetectionService.notifySchoolGpsOffline({
        tripId,
        eventId,
        schoolId,
        detectionType: 'INTERNET_LOSS',
      });

      expect(notified).toBe(true);

      // Verify OperationalNotificationService dispatch
      expect(OperationalNotificationService.notifyGpsUnavailable).toHaveBeenCalledWith(
        expect.objectContaining({
          schoolId,
          tripId,
          reason: 'GPS Offline: INTERNET_LOSS',
        })
      );

      // Verify update query executed
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[1]![0]).toMatch(/school_notified_at = NOW\(\)/i);

      // Verify RealtimeFeedService published alert
      expect(RealtimeFeedService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'NOTIFICATION_ALERT',
          notificationAlert: expect.objectContaining({
            eventType: 'GPS_UNAVAILABLE',
            title: 'GPS Offline Alert',
          }),
        })
      );
    });

    it('respects 10-minute cooldown and skips duplicate school notifications', async () => {
      // 1. Mock trip context
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          bus_number: 'DL-01-AB-1234',
          route_name: 'Route 4',
          last_gps_recorded_at: new Date(),
          last_latitude: 28.6139,
          last_longitude: 77.2090,
        },
      ]);

      // 2. Mock cooldown check (notified 2 minutes ago)
      mockQuery.mockResolvedValueOnce([
        {
          id: eventId,
          school_notified_at: new Date(Date.now() - 2 * 60 * 1000), // 2 mins ago (< 10 mins)
        },
      ]);

      const notified = await GpsOfflineDetectionService.notifySchoolGpsOffline({
        tripId,
        detectionType: 'STALE_LOCATION',
      });

      expect(notified).toBe(false);
      expect(OperationalNotificationService.notifyGpsUnavailable).not.toHaveBeenCalled();
    });
  });

  describe('3. Task 3: Notify Driver (notifyDriverGpsOffline)', () => {
    it('dispatches tailored guidance to driver for INTERNET_LOSS', async () => {
      // 1. Mock driver & bus context
      mockQuery.mockResolvedValueOnce([
        {
          driver_phone: '+919876543210',
          driver_name: 'Driver Ramesh',
          bus_number: 'DL-01-AB-1234',
          school_id: schoolId,
        },
      ]);

      // 2. Mock update driver_notified_at
      mockQuery.mockResolvedValueOnce([]);

      const notified = await GpsOfflineDetectionService.notifyDriverGpsOffline({
        tripId,
        eventId,
        detectionType: 'INTERNET_LOSS',
      });

      expect(notified).toBe(true);

      // Verify tailored message for internet loss
      expect(MessagingService.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientPhone: '+919876543210',
          recipientRole: 'DRIVER',
          directText: expect.stringContaining('Mobile data/internet connection lost'),
        })
      );

      // Verify update query
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[1]![0]).toMatch(/driver_notified_at = NOW\(\)/i);
    });

    it('dispatches tailored guidance to driver for STALE_LOCATION', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          driver_phone: '+919876543210',
          driver_name: 'Driver Ramesh',
          bus_number: 'DL-01-AB-1234',
          school_id: schoolId,
        },
      ]);
      mockQuery.mockResolvedValueOnce([]);

      const notified = await GpsOfflineDetectionService.notifyDriverGpsOffline({
        tripId,
        eventId,
        detectionType: 'STALE_LOCATION',
      });

      expect(notified).toBe(true);
      expect(MessagingService.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          directText: expect.stringContaining('GPS location fix is frozen'),
        })
      );
    });

    it('dispatches tailored guidance to driver for APP_DISCONNECT', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          driver_phone: '+919876543210',
          driver_name: 'Driver Ramesh',
          bus_number: 'DL-01-AB-1234',
          school_id: schoolId,
        },
      ]);
      mockQuery.mockResolvedValueOnce([]);

      const notified = await GpsOfflineDetectionService.notifyDriverGpsOffline({
        tripId,
        eventId,
        detectionType: 'APP_DISCONNECT',
      });

      expect(notified).toBe(true);
      expect(MessagingService.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          directText: expect.stringContaining('Background tracking disconnected'),
        })
      );
    });

    it('skips driver notification when driver phone is absent', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          driver_phone: null,
          driver_name: 'Unassigned',
          bus_number: 'DL-01-AB-1234',
          school_id: schoolId,
        },
      ]);

      const notified = await GpsOfflineDetectionService.notifyDriverGpsOffline({
        tripId,
        eventId,
        detectionType: 'APP_DISCONNECT',
      });

      expect(notified).toBe(false);
      expect(MessagingService.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('4. Coordinated Response Workflow: respondToOfflineTrip', () => {
    it('executes complete response workflow for an offline trip', async () => {
      const now = Date.now();

      // 1. Mock trip and bus lookup for detectTripOfflineStatus
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_TRANSIT',
          last_latitude: 28.6139,
          last_longitude: 77.2090,
          last_speed_kmh: 0,
          last_bearing_degrees: 0,
          last_accuracy_meters: 10,
          last_battery_percentage: 65,
          last_network_type: 'OFFLINE',
          last_gps_recorded_at: new Date(now - 120 * 1000),
          last_ping_at: new Date(now - 120 * 1000),
        },
      ]);

      // 2. Mock active event query in detectTripOfflineStatus
      mockQuery.mockResolvedValueOnce([]);

      // 3. Mock insert into gps_offline_events
      mockQuery.mockResolvedValueOnce([
        {
          id: eventId,
          school_id: schoolId,
          trip_id: tripId,
          bus_id: busId,
          driver_id: driverId,
          detection_type: 'APP_DISCONNECT',
          status: 'ACTIVE',
          started_at: new Date(),
          duration_seconds: 0,
          stale_threshold_seconds: 60,
          disconnect_threshold_seconds: 120,
          last_known_latitude: 28.6139,
          last_known_longitude: 77.2090,
          last_known_recorded_at: new Date(now - 120 * 1000),
          last_network_type: 'OFFLINE',
          last_battery_percentage: 65,
        },
      ]);

      // 4. Mock trip context for notifySchoolGpsOffline
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          bus_number: 'DL-01-AB-1234',
          route_name: 'Route 4',
          last_gps_recorded_at: new Date(now - 120 * 1000),
          last_latitude: 28.6139,
          last_longitude: 77.2090,
        },
      ]);

      // 5. Mock update school_notified_at
      mockQuery.mockResolvedValueOnce([]);

      // 6. Mock driver context for notifyDriverGpsOffline
      mockQuery.mockResolvedValueOnce([
        {
          driver_phone: '+919876543210',
          driver_name: 'Driver Ramesh',
          bus_number: 'DL-01-AB-1234',
          school_id: schoolId,
        },
      ]);

      // 7. Mock update driver_notified_at
      mockQuery.mockResolvedValueOnce([]);

      // 8. Mock getLastKnownLocation
      mockQuery.mockResolvedValueOnce([
        {
          last_latitude: 28.6139,
          last_longitude: 77.2090,
          last_speed_kmh: 0,
          last_bearing_degrees: 0,
          last_accuracy_meters: 10,
          last_battery_percentage: 65,
          last_network_type: 'OFFLINE',
          last_gps_recorded_at: new Date(now - 120 * 1000),
          event_address: 'Near AIIMS Gate 2, Delhi',
        },
      ]);

      const result = await GpsOfflineResponseServiceOrMethod();

      async function GpsOfflineResponseServiceOrMethod() {
        return GpsOfflineDetectionService.respondToOfflineTrip({
          tripId,
          schoolId,
          forceNotify: true,
        });
      }

      expect(result.success).toBe(true);
      expect(result.eventId).toBe(eventId);
      expect(result.detectionType).toBe('APP_DISCONNECT');
      expect(result.schoolNotified).toBe(true);
      expect(result.driverNotified).toBe(true);
      expect(result.lastKnownLocation.latitude).toBe(28.6139);
      expect(result.lastKnownLocation.address).toBe('Near AIIMS Gate 2, Delhi');
    });

    it('returns clean resolved state when trip is healthy', async () => {
      // 1. Mock trip and bus (healthy)
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_TRANSIT',
          last_latitude: 28.6200,
          last_longitude: 77.2150,
          last_speed_kmh: 30,
          last_bearing_degrees: 90,
          last_accuracy_meters: 5,
          last_battery_percentage: 88,
          last_network_type: 'CELLULAR',
          last_gps_recorded_at: new Date(),
          last_ping_at: new Date(),
        },
      ]);

      // 2. Mock resolve check in detectTripOfflineStatus
      mockQuery.mockResolvedValueOnce([]);

      // 3. Mock getLastKnownLocation
      mockQuery.mockResolvedValueOnce([
        {
          last_latitude: 28.6200,
          last_longitude: 77.2150,
          last_speed_kmh: 30,
          last_bearing_degrees: 90,
          last_accuracy_meters: 5,
          last_battery_percentage: 88,
          last_network_type: 'CELLULAR',
          last_gps_recorded_at: new Date(),
          event_address: null,
        },
      ]);

      const result = await GpsOfflineDetectionService.respondToOfflineTrip({
        tripId,
        schoolId,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('RESOLVED');
      expect(result.schoolNotified).toBe(false);
      expect(result.driverNotified).toBe(false);
      expect(result.message).toContain('Trip telemetry is currently healthy');
    });
  });

  describe('5. HTTP Endpoints: School Offline Response APIs', () => {
    it('POST /schools/:schoolId/trips/:tripId/offline/respond executes response via authenticated API', async () => {
      // 1. detectTripOfflineStatus lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_TRANSIT',
          last_latitude: 28.6139,
          last_longitude: 77.2090,
          last_speed_kmh: 0,
          last_bearing_degrees: 0,
          last_accuracy_meters: 10,
          last_battery_percentage: 70,
          last_network_type: 'CELLULAR',
          last_gps_recorded_at: new Date(Date.now() - 90 * 1000), // stale
          last_ping_at: new Date(),
        },
      ]);
      // 2. active event check
      mockQuery.mockResolvedValueOnce([]);
      // 3. insert
      mockQuery.mockResolvedValueOnce([
        {
          id: eventId,
          school_id: schoolId,
          trip_id: tripId,
          bus_id: busId,
          driver_id: driverId,
          detection_type: 'STALE_LOCATION',
          status: 'ACTIVE',
          started_at: new Date(),
          duration_seconds: 0,
          stale_threshold_seconds: 60,
          disconnect_threshold_seconds: 120,
          last_known_latitude: 28.6139,
          last_known_longitude: 77.2090,
          last_known_recorded_at: new Date(),
          last_network_type: 'CELLULAR',
          last_battery_percentage: 70,
        },
      ]);
      // 4. trip context for school notify
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          bus_number: 'DL-01-AB-1234',
          route_name: 'Route 4',
          last_gps_recorded_at: new Date(),
          last_latitude: 28.6139,
          last_longitude: 77.2090,
        },
      ]);
      // 5. update school_notified_at
      mockQuery.mockResolvedValueOnce([]);
      // 6. driver context
      mockQuery.mockResolvedValueOnce([
        {
          driver_phone: '+919876543210',
          driver_name: 'Driver Ramesh',
          bus_number: 'DL-01-AB-1234',
          school_id: schoolId,
        },
      ]);
      // 7. update driver_notified_at
      mockQuery.mockResolvedValueOnce([]);
      // 8. getLastKnownLocation
      mockQuery.mockResolvedValueOnce([
        {
          last_latitude: 28.6139,
          last_longitude: 77.2090,
          last_speed_kmh: 0,
          last_bearing_degrees: 0,
          last_accuracy_meters: 10,
          last_battery_percentage: 70,
          last_network_type: 'CELLULAR',
          last_gps_recorded_at: new Date(),
          event_address: 'Safdarjung Enclave',
        },
      ]);

      const res = await request(app)
        .post(`/api/v1/telemetry/schools/${schoolId}/trips/${tripId}/offline/respond`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ forceNotify: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.eventId).toBe(eventId);
      expect(res.body.data.schoolNotified).toBe(true);
      expect(res.body.data.driverNotified).toBe(true);
    });

    it('GET /trips/:tripId/last-known-location returns locked location details via authenticated API', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          last_latitude: 28.6139,
          last_longitude: 77.2090,
          last_speed_kmh: 25.0,
          last_bearing_degrees: 45.0,
          last_accuracy_meters: 6.0,
          last_battery_percentage: 85,
          last_network_type: 'CELLULAR',
          last_gps_recorded_at: new Date(),
          event_address: 'Dhaula Kuan',
        },
      ]);

      const res = await request(app)
        .get(`/api/v1/telemetry/trips/${tripId}/last-known-location`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.latitude).toBe(28.6139);
      expect(res.body.data.speedKmh).toBe(25.0);
      expect(res.body.data.address).toBe('Dhaula Kuan');
    });
  });
});
