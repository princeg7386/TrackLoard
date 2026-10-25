import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { GpsOfflineDetectionService } from '../src/services/gps-offline-detection.service.js';
import { AuthService } from '../src/services/auth.service.js';
import { DriverAuthService } from '../src/services/driver-auth.service.js';
import { RealtimeFeedService } from '../src/services/realtime-feed.service.js';
import {
  GPS_OFFLINE_THRESHOLDS,
  UserRole,
} from '@school-bus/shared';
import * as database from '../src/config/database.js';

// Mock database query
vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  pool: { end: vi.fn() },
}));

// Spy on RealtimeFeedService
vi.spyOn(RealtimeFeedService, 'publish').mockImplementation(() => {});

describe('Phase 27.1: GPS Offline Detection (Stale Location, Internet Loss, App Disconnect)', () => {
  const app = createApp();

  const schoolId = '11111111-1111-1111-1111-111111111111';
  const tripId = '22222222-2222-2222-2222-222222222222';
  const busId = '33333333-3333-3333-3333-333333333333';
  const driverId = '44444444-4444-4444-4444-444444444444';

  const mockAdminUser = {
    id: 'admin-111',
    schoolId,
    email: 'admin@school.com',
    role: UserRole.SCHOOL_ADMIN,
  };
  const adminToken = AuthService.generateToken(mockAdminUser);

  const mockDriver = {
    id: driverId,
    schoolId,
    phone: '+919876543210',
    fullName: 'Driver Ramesh',
    role: UserRole.DRIVER as const,
    assignedBusId: busId,
    tokenVersion: 1,
  };
  const driverToken = DriverAuthService.generateDriverToken(mockDriver);

  const mockQuery = vi.mocked(database.query);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Pure Domain Evaluation: evaluateOfflineState', () => {
    it('returns HEALTHY for fresh ping with active cellular network and recent heartbeat', () => {
      const now = 1700000000000;
      const result = GpsOfflineDetectionService.evaluateOfflineState({
        lastGpsRecordedAt: new Date(now - 15 * 1000), // 15s ago
        lastPingAt: new Date(now - 10 * 1000),        // 10s ago
        networkType: 'CELLULAR',
        isOnline: true,
        hasActiveTrip: true,
        now,
      });

      expect(result.status).toBe('HEALTHY');
      expect(result.isOffline).toBe(false);
      expect(result.detectionType).toBeNull();
      expect(result.ageSeconds).toBe(15);
      expect(result.disconnectAgeSeconds).toBe(10);
    });

    it('TASK 1: Detects STALE_LOCATION when GPS coordinate age exceeds stale threshold (>= 60s)', () => {
      const now = 1700000000000;
      const result = GpsOfflineDetectionService.evaluateOfflineState({
        lastGpsRecordedAt: new Date(now - 75 * 1000), // 75s ago (> 60s)
        lastPingAt: new Date(now - 20 * 1000),        // heartbeat is fresh (20s)
        networkType: 'CELLULAR',
        isOnline: true,
        hasActiveTrip: true,
        now,
      });

      expect(result.status).toBe('STALE_LOCATION');
      expect(result.isOffline).toBe(true);
      expect(result.detectionType).toBe('STALE_LOCATION');
      expect(result.ageSeconds).toBe(75);
      expect(result.message).toContain('Stale GPS location');
      expect(result.message).toContain('threshold: 60s');
    });

    it('TASK 1: Respects custom configurable stale location threshold (e.g. 30s)', () => {
      const now = 1700000000000;
      const result = GpsOfflineDetectionService.evaluateOfflineState({
        lastGpsRecordedAt: new Date(now - 40 * 1000), // 40s ago
        lastPingAt: new Date(now - 10 * 1000),
        networkType: 'WIFI',
        isOnline: true,
        hasActiveTrip: true,
        staleThresholdSeconds: 30,
        now,
      });

      expect(result.status).toBe('STALE_LOCATION');
      expect(result.isOffline).toBe(true);
      expect(result.staleThresholdSeconds).toBe(30);
    });

    it('TASK 2: Detects INTERNET_LOSS when network is OFFLINE, NONE, or isOnline is false', () => {
      const now = 1700000000000;
      // Case A: networkType is OFFLINE
      const resultA = GpsOfflineDetectionService.evaluateOfflineState({
        lastGpsRecordedAt: new Date(now - 20 * 1000), // GPS fix was recent (20s)
        lastPingAt: new Date(now - 20 * 1000),
        networkType: 'OFFLINE',
        isOnline: false,
        hasActiveTrip: true,
        now,
      });

      expect(resultA.status).toBe('INTERNET_LOSS');
      expect(resultA.isOffline).toBe(true);
      expect(resultA.detectionType).toBe('INTERNET_LOSS');
      expect(resultA.message).toContain('Internet connection lost');

      // Case B: networkType is NONE
      const resultB = GpsOfflineDetectionService.evaluateOfflineState({
        lastGpsRecordedAt: new Date(now - 10 * 1000),
        lastPingAt: new Date(now - 10 * 1000),
        networkType: 'NONE',
        hasActiveTrip: true,
        now,
      });

      expect(resultB.status).toBe('INTERNET_LOSS');
      expect(resultB.isOffline).toBe(true);
    });

    it('TASK 3: Detects APP_DISCONNECT when ping/heartbeat age exceeds disconnect threshold (>= 120s)', () => {
      const now = 1700000000000;
      const result = GpsOfflineDetectionService.evaluateOfflineState({
        lastGpsRecordedAt: new Date(now - 150 * 1000), // 150s ago
        lastPingAt: new Date(now - 150 * 1000),        // 150s ago (> 120s)
        networkType: 'CELLULAR',
        isOnline: true,
        hasActiveTrip: true,
        now,
      });

      expect(result.status).toBe('APP_DISCONNECT');
      expect(result.isOffline).toBe(true);
      expect(result.detectionType).toBe('APP_DISCONNECT');
      expect(result.disconnectAgeSeconds).toBe(150);
      expect(result.message).toContain('Driver app disconnected');
      expect(result.message).toContain('threshold: 120s');
    });

    it('returns HEALTHY when hasActiveTrip is false, even if GPS coordinates are hours old', () => {
      const now = 1700000000000;
      const result = GpsOfflineDetectionService.evaluateOfflineState({
        lastGpsRecordedAt: new Date(now - 3600 * 1000), // 1 hour ago
        lastPingAt: new Date(now - 3600 * 1000),
        networkType: 'OFFLINE',
        isOnline: false,
        hasActiveTrip: false, // Bus is parked in depot, no active trip running
        now,
      });

      expect(result.status).toBe('HEALTHY');
      expect(result.isOffline).toBe(false);
      expect(result.message).toContain('No active trip');
    });

    it('handles missing or unparseable timestamps gracefully without throwing', () => {
      const result = GpsOfflineDetectionService.evaluateOfflineState({
        lastGpsRecordedAt: null,
        lastPingAt: undefined,
        hasActiveTrip: true,
      });

      expect(result.isOffline).toBe(true);
      expect(result.status).toBe('APP_DISCONNECT');
    });
  });

  describe('2. Trip Offline Detection & Persistence: detectTripOfflineStatus', () => {
    it('throws NotFoundError when trip does not exist', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await expect(
        GpsOfflineDetectionService.detectTripOfflineStatus('00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('Trip with ID \'00000000-0000-0000-0000-000000000000\' not found');
    });

    it('detects STALE_LOCATION on active trip and persists new ACTIVE event', async () => {
      const now = Date.now();
      const staleGpsTime = new Date(now - 90 * 1000); // 90s ago

      // 1. Mock trip and bus lookup
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
          last_accuracy_meters: 10,
          last_battery_percentage: 82,
          last_network_type: 'CELLULAR',
          last_gps_recorded_at: staleGpsTime,
          last_ping_at: new Date(now - 15 * 1000), // ping is fresh (15s)
        },
      ]);

      // 2. Mock query for existing active event (none exists)
      mockQuery.mockResolvedValueOnce([]);

      // 3. Mock insert into gps_offline_events
      const eventId = '99999999-9999-9999-9999-999999999999';
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
          last_known_recorded_at: staleGpsTime,
          last_network_type: 'CELLULAR',
          last_battery_percentage: 82,
          resolved_at: null,
          recovery_reason: null,
          school_notified_at: null,
          driver_notified_at: null,
          notes: null,
        },
      ]);

      const result = await GpsOfflineDetectionService.detectTripOfflineStatus(tripId, { now });

      expect(result.hasActiveTrip).toBe(true);
      expect(result.evaluation.isOffline).toBe(true);
      expect(result.evaluation.status).toBe('STALE_LOCATION');
      expect(result.activeOfflineEvent).toBeDefined();
      expect(result.activeOfflineEvent?.id).toBe(eventId);
      expect(result.activeOfflineEvent?.detectionType).toBe('STALE_LOCATION');

      // Verify real-time health update broadcast
      expect(RealtimeFeedService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HEALTH_UPDATE',
          schoolId,
          busId,
          tripId,
          healthStatus: 'STALE_SIGNAL',
        })
      );
    });

    it('updates existing ACTIVE event when trip continues in offline/stale state', async () => {
      const now = Date.now();
      const existingEventId = '88888888-8888-8888-8888-888888888888';

      // 1. Mock trip & bus lookup
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
          last_accuracy_meters: 10,
          last_battery_percentage: 75,
          last_network_type: 'OFFLINE',
          last_gps_recorded_at: new Date(now - 120 * 1000),
          last_ping_at: new Date(now - 60 * 1000),
        },
      ]);

      // 2. Mock existing active event check
      mockQuery.mockResolvedValueOnce([
        {
          id: existingEventId,
          detection_type: 'INTERNET_LOSS',
          started_at: new Date(now - 120 * 1000),
          duration_seconds: 60,
        },
      ]);

      // 3. Mock update query
      mockQuery.mockResolvedValueOnce([
        {
          id: existingEventId,
          school_id: schoolId,
          trip_id: tripId,
          bus_id: busId,
          driver_id: driverId,
          detection_type: 'INTERNET_LOSS',
          status: 'ACTIVE',
          started_at: new Date(now - 120 * 1000),
          duration_seconds: 120,
          stale_threshold_seconds: 60,
          disconnect_threshold_seconds: 120,
          last_known_latitude: 28.6139,
          last_known_longitude: 77.2090,
          last_known_recorded_at: new Date(now - 120 * 1000),
          last_network_type: 'OFFLINE',
          last_battery_percentage: 75,
          resolved_at: null,
          recovery_reason: null,
          school_notified_at: null,
          driver_notified_at: null,
          notes: null,
        },
      ]);

      const result = await GpsOfflineDetectionService.detectTripOfflineStatus(tripId, { now });

      expect(result.evaluation.status).toBe('INTERNET_LOSS');
      expect(result.activeOfflineEvent?.id).toBe(existingEventId);
      expect(mockQuery.mock.calls[2]![0]).toMatch(/UPDATE gps_offline_events/i);
    });

    it('resolves active offline event when vehicle resumes fresh telemetry', async () => {
      const now = Date.now();

      // 1. Mock trip & bus lookup (healthy)
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_TRANSIT',
          last_latitude: 28.6200,
          last_longitude: 77.2150,
          last_speed_kmh: 35,
          last_accuracy_meters: 8,
          last_battery_percentage: 80,
          last_network_type: 'CELLULAR',
          last_gps_recorded_at: new Date(now - 5 * 1000), // 5s ago
          last_ping_at: new Date(now - 5 * 1000),
        },
      ]);

      // 2. Mock resolve query
      mockQuery.mockResolvedValueOnce([
        {
          id: 'resolved-event-id',
          status: 'RESOLVED',
        },
      ]);

      const result = await GpsOfflineDetectionService.detectTripOfflineStatus(tripId, { now });

      expect(result.evaluation.isOffline).toBe(false);
      expect(result.evaluation.status).toBe('HEALTHY');
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery.mock.calls[1]![0]).toMatch(/SET status = 'RESOLVED'/i);
    });
  });

  describe('3. Fleet-Wide Offline Scanning: scanActiveTripsForOffline', () => {
    it('scans active trips and aggregates counts for healthy, stale, internet loss, and disconnected', async () => {
      const now = Date.now();

      // 1. Mock active trips list
      mockQuery.mockResolvedValueOnce([
        { id: 'trip-1', school_id: schoolId },
        { id: 'trip-2', school_id: schoolId },
        { id: 'trip-3', school_id: schoolId },
      ]);

      // Trip 1: Healthy
      mockQuery.mockResolvedValueOnce([
        {
          id: 'trip-1',
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_TRANSIT',
          last_latitude: 28.6139,
          last_longitude: 77.2090,
          last_speed_kmh: 40,
          last_accuracy_meters: 6,
          last_battery_percentage: 90,
          last_network_type: 'CELLULAR',
          last_gps_recorded_at: new Date(now - 10 * 1000),
          last_ping_at: new Date(now - 10 * 1000),
        },
      ]);
      mockQuery.mockResolvedValueOnce([]); // resolve check

      // Trip 2: Stale Location (70s old)
      mockQuery.mockResolvedValueOnce([
        {
          id: 'trip-2',
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_TRANSIT',
          last_latitude: 28.6139,
          last_longitude: 77.2090,
          last_speed_kmh: 0,
          last_accuracy_meters: 10,
          last_battery_percentage: 85,
          last_network_type: 'CELLULAR',
          last_gps_recorded_at: new Date(now - 70 * 1000),
          last_ping_at: new Date(now - 15 * 1000),
        },
      ]);
      mockQuery.mockResolvedValueOnce([]); // active check
      mockQuery.mockResolvedValueOnce([ // insert
        {
          id: 'event-2',
          school_id: schoolId,
          trip_id: 'trip-2',
          bus_id: busId,
          driver_id: driverId,
          detection_type: 'STALE_LOCATION',
          status: 'ACTIVE',
          started_at: new Date(),
          duration_seconds: 0,
          stale_threshold_seconds: 60,
          disconnect_threshold_seconds: 120,
        },
      ]);

      // Trip 3: App Disconnect (180s old)
      mockQuery.mockResolvedValueOnce([
        {
          id: 'trip-3',
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_TRANSIT',
          last_latitude: 28.6139,
          last_longitude: 77.2090,
          last_speed_kmh: 0,
          last_accuracy_meters: 10,
          last_battery_percentage: 40,
          last_network_type: 'CELLULAR',
          last_gps_recorded_at: new Date(now - 180 * 1000),
          last_ping_at: new Date(now - 180 * 1000),
        },
      ]);
      mockQuery.mockResolvedValueOnce([]); // active check
      mockQuery.mockResolvedValueOnce([ // insert
        {
          id: 'event-3',
          school_id: schoolId,
          trip_id: 'trip-3',
          bus_id: busId,
          driver_id: driverId,
          detection_type: 'APP_DISCONNECT',
          status: 'ACTIVE',
          started_at: new Date(),
          duration_seconds: 0,
          stale_threshold_seconds: 60,
          disconnect_threshold_seconds: 120,
        },
      ]);

      const summary = await GpsOfflineDetectionService.scanActiveTripsForOffline(schoolId, { now });

      expect(summary.totalActiveTrips).toBe(3);
      expect(summary.healthyCount).toBe(1);
      expect(summary.staleLocationCount).toBe(1);
      expect(summary.appDisconnectCount).toBe(1);
      expect(summary.totalOfflineCount).toBe(2);
      expect(summary.trips).toHaveLength(3);
    });
  });

  describe('4. Explicit Driver App Disconnect Beacon: reportAppDisconnect', () => {
    it('records explicit disconnect beacon from driver app when background service stops', async () => {
      // 1. Mock trip lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_TRANSIT',
          last_latitude: 28.6139,
          last_longitude: 77.2090,
          last_battery_percentage: 15,
          last_network_type: 'CELLULAR',
          last_gps_recorded_at: new Date(),
        },
      ]);

      // 2. Mock existing check (none)
      mockQuery.mockResolvedValueOnce([]);

      // 3. Mock insert
      mockQuery.mockResolvedValueOnce([
        {
          id: 'disconnect-event-id',
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
          last_known_recorded_at: new Date(),
          last_network_type: 'CELLULAR',
          last_battery_percentage: 15,
          notes: 'Low battery device shutdown',
        },
      ]);

      const record = await GpsOfflineDetectionService.reportAppDisconnect({
        tripId,
        driverId,
        payload: {
          reason: 'Low battery device shutdown',
          batteryPercentage: 15,
        },
      });

      expect(record.detectionType).toBe('APP_DISCONNECT');
      expect(record.status).toBe('ACTIVE');
      expect(record.notes).toBe('Low battery device shutdown');

      // Verify health update broadcast
      expect(RealtimeFeedService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HEALTH_UPDATE',
          healthStatus: 'OFFLINE',
        })
      );
    });
  });

  describe('5. HTTP Endpoints: School & Driver Offline APIs', () => {
    it('GET /api/v1/telemetry/schools/:schoolId/offline-events returns active events', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: 'event-1',
          school_id: schoolId,
          trip_id: tripId,
          bus_id: busId,
          driver_id: driverId,
          detection_type: 'STALE_LOCATION',
          status: 'ACTIVE',
          started_at: new Date(),
          duration_seconds: 120,
          stale_threshold_seconds: 60,
          disconnect_threshold_seconds: 120,
          last_known_latitude: 28.6139,
          last_known_longitude: 77.2090,
          last_known_recorded_at: new Date(),
          last_network_type: 'CELLULAR',
          last_battery_percentage: 88,
          resolved_at: null,
          recovery_reason: null,
          school_notified_at: null,
          driver_notified_at: null,
          notes: null,
        },
      ]);

      const res = await request(app)
        .get(`/api/v1/telemetry/schools/${schoolId}/offline-events`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].detectionType).toBe('STALE_LOCATION');
    });

    it('POST /api/v1/telemetry/schools/:schoolId/offline-events/scan triggers scan and returns summary', async () => {
      // 1. Mock active trips list
      mockQuery.mockResolvedValueOnce([
        { id: tripId, school_id: schoolId },
      ]);

      // 2. Mock trip & bus lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_TRANSIT',
          last_latitude: 28.6139,
          last_longitude: 77.2090,
          last_speed_kmh: 40,
          last_accuracy_meters: 5,
          last_battery_percentage: 95,
          last_network_type: 'CELLULAR',
          last_gps_recorded_at: new Date(),
          last_ping_at: new Date(),
        },
      ]);

      // 3. Mock resolve check
      mockQuery.mockResolvedValueOnce([]);

      const res = await request(app)
        .post(`/api/v1/telemetry/schools/${schoolId}/offline-events/scan`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalActiveTrips).toBe(1);
      expect(res.body.data.healthyCount).toBe(1);
    });

    it('GET /api/v1/telemetry/trips/:tripId/offline-status returns trip offline details', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_TRANSIT',
          last_latitude: 28.6139,
          last_longitude: 77.2090,
          last_speed_kmh: 35,
          last_accuracy_meters: 6,
          last_battery_percentage: 90,
          last_network_type: 'CELLULAR',
          last_gps_recorded_at: new Date(),
          last_ping_at: new Date(),
        },
      ]);
      mockQuery.mockResolvedValueOnce([]); // resolve check

      const res = await request(app)
        .get(`/api/v1/telemetry/trips/${tripId}/offline-status`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hasActiveTrip).toBe(true);
      expect(res.body.data.evaluation.status).toBe('HEALTHY');
    });

    it('POST /api/v1/telemetry/trips/:tripId/app-disconnect allows authenticated driver to report disconnect', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_TRANSIT',
          last_latitude: 28.6139,
          last_longitude: 77.2090,
          last_battery_percentage: 12,
          last_network_type: 'CELLULAR',
          last_gps_recorded_at: new Date(),
        },
      ]);
      mockQuery.mockResolvedValueOnce([]); // active check
      mockQuery.mockResolvedValueOnce([ // insert
        {
          id: 'driver-disconnect-event',
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
          last_known_recorded_at: new Date(),
          last_network_type: 'CELLULAR',
          last_battery_percentage: 12,
          notes: 'Driver app closing due to critical battery',
        },
      ]);

      const res = await request(app)
        .post(`/api/v1/telemetry/trips/${tripId}/app-disconnect`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          reason: 'Driver app closing due to critical battery',
          batteryPercentage: 12,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.detectionType).toBe('APP_DISCONNECT');
    });
  });
});
