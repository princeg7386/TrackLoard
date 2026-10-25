import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { GpsOfflineDetectionService } from '../src/services/gps-offline-detection.service.js';
import { RealtimeFeedService } from '../src/services/realtime-feed.service.js';
import { AuthService } from '../src/services/auth.service.js';
import { DriverAuthService } from '../src/services/driver-auth.service.js';
import { UserRole, TelemetryIngestPayload } from '@school-bus/shared';
import * as database from '../src/config/database.js';

// Mock database query
vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  pool: { end: vi.fn() },
}));

// Spies on RealtimeFeedService
vi.spyOn(RealtimeFeedService, 'publish').mockImplementation(() => {});

describe('Phase 27.3: GPS Offline Recovery (Reconnect Automatically, Upload Queued Points, Mark Recovered, Avoid Duplicate Points)', () => {
  const app = createApp();

  const schoolId = '11111111-1111-1111-1111-111111111111';
  const tripId = '22222222-2222-2222-2222-222222222222';
  const busId = '33333333-3333-3333-3333-333333333333';
  const driverId = '44444444-4444-4444-4444-444444444444';
  const eventId = '55555555-5555-5555-5555-555555555555';

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

  describe('1. Task 3: Mark Recovered (markTripRecovered)', () => {
    it('marks active GPS offline event as RESOLVED with recovery reason and duration', async () => {
      const startedAt = new Date(Date.now() - 300 * 1000); // 5 min ago

      mockQuery.mockResolvedValueOnce([
        {
          id: eventId,
          school_id: schoolId,
          bus_id: busId,
          started_at: startedAt,
          duration_seconds: 300,
        },
      ]);

      const result = await GpsOfflineDetectionService.markTripRecovered({
        tripId,
        recoveryReason: 'TELEMETRY_RESUMED',
      });

      expect(result.success).toBe(true);
      expect(result.wasOffline).toBe(true);
      expect(result.resolvedEventId).toBe(eventId);
      expect(result.recoveryReason).toBe('TELEMETRY_RESUMED');
      expect(result.recoveredAt).toBeDefined();

      // Verify atomic update executed
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0]![0]).toMatch(/SET status = 'RESOLVED'/i);

      // Verify RealtimeFeedService published HEALTH_UPDATE & NOTIFICATION_ALERT
      expect(RealtimeFeedService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HEALTH_UPDATE',
          schoolId,
          busId,
          healthStatus: 'HEALTHY',
        })
      );
      expect(RealtimeFeedService.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'NOTIFICATION_ALERT',
          notificationAlert: expect.objectContaining({
            title: 'GPS Signal Restored',
          }),
        })
      );
    });

    it('returns wasOffline: false when trip was already healthy', async () => {
      mockQuery.mockResolvedValueOnce([]); // No ACTIVE offline event

      const result = await GpsOfflineDetectionService.markTripRecovered({
        tripId,
        recoveryReason: 'CLIENT_RECONNECTED',
      });

      expect(result.success).toBe(true);
      expect(result.wasOffline).toBe(false);
      expect(result.resolvedEventId).toBeNull();
      expect(result.message).toContain('already in a healthy/recovered state');
    });
  });

  describe('2. Tasks 1, 2, 4: processRecoveryBatch (Reconnect, Upload Queued Points, Deduplication)', () => {
    it('handles reconnect with empty queue by marking recovered directly', async () => {
      // 1. Mock trip lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_TRANSIT',
          bus_number: 'DL-01-AB-1234',
        },
      ]);

      // 2. Mock markTripRecovered update query
      mockQuery.mockResolvedValueOnce([
        {
          id: eventId,
          school_id: schoolId,
          bus_id: busId,
          started_at: new Date(),
          duration_seconds: 120,
        },
      ]);

      // 3. Mock getLastKnownLocation
      mockQuery.mockResolvedValueOnce([
        {
          last_latitude: 28.6139,
          last_longitude: 77.2090,
          last_speed_kmh: 0,
          last_bearing_degrees: 0,
          last_accuracy_meters: 10,
          last_battery_percentage: 90,
          last_network_type: 'CELLULAR',
          last_gps_recorded_at: new Date(),
          event_address: null,
        },
      ]);

      const result = await GpsOfflineDetectionService.processRecoveryBatch({
        tripId,
        locations: [],
        authenticatedDriverId: driverId,
      });

      expect(result.success).toBe(true);
      expect(result.isRecovered).toBe(true);
      expect(result.totalPointsReceived).toBe(0);
      expect(result.validPointsIngested).toBe(0);
      expect(result.resolvedEventId).toBe(eventId);
    });

    it('uploads queued offline batch chronologically, skips duplicates, rejects invalid, and marks recovered', async () => {
      const now = Date.now();
      const validT1 = new Date(now - 120 * 1000).toISOString();
      const validT2 = new Date(now - 60 * 1000).toISOString();
      const futureInvalidT = new Date(now + 10 * 60 * 1000).toISOString(); // 10 min in future (> 5 min)

      const queuedLocations: TelemetryIngestPayload[] = [
        // Point 1: Valid
        {
          tripId,
          busId,
          driverId,
          latitude: 28.6139,
          longitude: 77.2090,
          speedKmh: 35.0,
          recordedAt: validT1,
          networkType: 'CELLULAR',
        },
        // Point 2: Duplicate of Point 1 (same tripId and recordedAt)
        {
          tripId,
          busId,
          driverId,
          latitude: 28.6139,
          longitude: 77.2090,
          speedKmh: 35.0,
          recordedAt: validT1,
          networkType: 'CELLULAR',
        },
        // Point 3: Invalid Kinematics (speed > 160 km/h)
        {
          tripId,
          busId,
          driverId,
          latitude: 28.6145,
          longitude: 77.2100,
          speedKmh: 220.0,
          recordedAt: new Date(now - 90 * 1000).toISOString(),
          networkType: 'CELLULAR',
        },
        // Point 4: Invalid Timestamp (future > 5m)
        {
          tripId,
          busId,
          driverId,
          latitude: 28.6150,
          longitude: 77.2110,
          speedKmh: 30.0,
          recordedAt: futureInvalidT,
          networkType: 'CELLULAR',
        },
        // Point 5: Valid Latest Point
        {
          tripId,
          busId,
          driverId,
          latitude: 28.6160,
          longitude: 77.2120,
          speedKmh: 42.0,
          bearingDegrees: 90.0,
          accuracyMeters: 5.0,
          batteryPercentage: 74,
          recordedAt: validT2,
          networkType: 'CELLULAR',
        },
      ];

      // 1. Mock trip lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_TRANSIT',
          bus_number: 'DL-01-AB-1234',
        },
      ]);

      // 2. Mock insert query for Point 1 (ingested)
      mockQuery.mockResolvedValueOnce([{ id: 101 }]);

      // 3. Mock insert query for Point 5 (ingested)
      mockQuery.mockResolvedValueOnce([{ id: 102 }]);

      // 4. Mock update buses latest cache
      mockQuery.mockResolvedValueOnce([]);

      // 5. Mock markTripRecovered update query
      mockQuery.mockResolvedValueOnce([
        {
          id: eventId,
          school_id: schoolId,
          bus_id: busId,
          started_at: new Date(now - 180 * 1000),
          duration_seconds: 180,
        },
      ]);

      const result = await GpsOfflineDetectionService.processRecoveryBatch({
        tripId,
        locations: queuedLocations,
        authenticatedDriverId: driverId,
      });

      expect(result.success).toBe(true);
      expect(result.isRecovered).toBe(true);
      expect(result.totalPointsReceived).toBe(5);
      expect(result.validPointsIngested).toBe(2);
      expect(result.duplicatePointsSkipped).toBe(1);
      expect(result.invalidPointsSkipped).toBe(2);
      expect(result.resolvedEventId).toBe(eventId);
      expect(result.latestLocation?.latitude).toBe(28.6160);
      expect(result.latestLocation?.speedKmh).toBe(42.0);

      // Verify database update query called with ON CONFLICT DO NOTHING
      expect(mockQuery.mock.calls[1]![0]).toMatch(/ON CONFLICT \(trip_id, recorded_at\) DO NOTHING/i);

      // Verify buses table updated to HEALTHY
      expect(mockQuery.mock.calls[3]![0]).toMatch(/gps_health_status = 'HEALTHY'/i);
    });

    it('rejects batch when authenticated driver is not assigned to trip', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: 'other-driver-id',
          status: 'IN_TRANSIT',
          bus_number: 'DL-01-AB-1234',
        },
      ]);

      await expect(
        GpsOfflineDetectionService.processRecoveryBatch({
          tripId,
          locations: [],
          authenticatedDriverId: driverId,
        })
      ).rejects.toThrow('Authenticated driver is not assigned to trip');
    });
  });

  describe('3. HTTP Endpoints: Recovery APIs', () => {
    it('POST /trips/:tripId/reconnect allows authenticated driver to reconnect and flush queue', async () => {
      const now = Date.now();
      const validPoint = {
        tripId,
        busId,
        driverId,
        latitude: 28.6139,
        longitude: 77.2090,
        speedKmh: 30.0,
        recordedAt: new Date(now - 30 * 1000).toISOString(),
      };

      // 1. Mock trip lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'IN_TRANSIT',
          bus_number: 'DL-01-AB-1234',
        },
      ]);

      // 2. Mock insert point
      mockQuery.mockResolvedValueOnce([{ id: 101 }]);

      // 3. Mock update buses
      mockQuery.mockResolvedValueOnce([]);

      // 4. Mock markTripRecovered
      mockQuery.mockResolvedValueOnce([
        {
          id: eventId,
          school_id: schoolId,
          bus_id: busId,
          started_at: new Date(),
          duration_seconds: 60,
        },
      ]);

      const res = await request(app)
        .post(`/api/v1/telemetry/trips/${tripId}/reconnect`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          locations: [validPoint],
          networkType: 'CELLULAR',
          batteryPercentage: 80,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isRecovered).toBe(true);
      expect(res.body.data.validPointsIngested).toBe(1);
    });

    it('POST /schools/:schoolId/trips/:tripId/offline/recover allows coordinator to manually mark recovered', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: eventId,
          school_id: schoolId,
          bus_id: busId,
          started_at: new Date(),
          duration_seconds: 240,
        },
      ]);

      const res = await request(app)
        .post(`/api/v1/telemetry/schools/${schoolId}/trips/${tripId}/offline/recover`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          recoveryReason: 'COORDINATOR_VERIFIED_PHONE_CONFIRMATION',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.wasOffline).toBe(true);
      expect(res.body.data.recoveryReason).toBe('COORDINATOR_VERIFIED_PHONE_CONFIRMATION');
    });
  });
});
