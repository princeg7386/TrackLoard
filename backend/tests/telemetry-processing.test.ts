import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/services/auth.service.js';
import { DriverAuthService } from '../src/services/driver-auth.service.js';
import { TelemetryService } from '../src/services/telemetry.service.js';
import { RealtimeFeedService } from '../src/services/realtime-feed.service.js';
import { GpsHealthService } from '../src/services/gps-health.service.js';
import { UserRole, TelemetryFeedEvent } from '@school-bus/shared';
import * as db from '../src/config/database.js';

describe('GPS Backend Processing & Real-Time Feed (Micro-phase 11.4)', () => {
  const app = createApp();

  const schoolId = '223e4567-e89b-12d3-a456-426614174001';
  const driverId = '123e4567-e89b-12d3-a456-426614174000';
  const busId = '323e4567-e89b-12d3-a456-426614174002';
  const tripId = '423e4567-e89b-12d3-a456-426614174003';

  const mockDriver = {
    id: driverId,
    schoolId,
    phone: '+919876543210',
    fullName: 'Ramesh Driver',
    role: UserRole.DRIVER as const,
    assignedBusId: busId,
  };
  const driverToken = DriverAuthService.generateDriverToken(mockDriver);

  const mockAdmin = {
    id: 'aaa11111-e89b-12d3-a456-426614174001',
    schoolId,
    email: 'admin@school.com',
    role: UserRole.SCHOOL_ADMIN,
  };
  const adminToken = AuthService.generateToken(mockAdmin);

  const validPing = {
    tripId,
    busId,
    driverId,
    latitude: 28.6139,
    longitude: 77.2090,
    speedKmh: 42.0,
    bearingDegrees: 180.0,
    accuracyMeters: 6.5,
    batteryPercentage: 85,
    isCharging: false,
    networkType: 'CELLULAR' as const,
    recordedAt: new Date().toISOString(),
  };

  describe('1. Source & Kinematic Validation', () => {
    it('rejects future timestamps exceeding 5 minutes clock skew with 400 Bad Request', async () => {
      const futurePing = {
        ...validPing,
        recordedAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes in the future
      };

      const res = await request(app)
        .post('/api/v1/telemetry/ingest')
        .set('Authorization', `Bearer ${driverToken}`)
        .send(futurePing);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('future');
    });

    it('rejects stale timestamps older than 24 hours with 400 Bad Request', async () => {
      const oldPing = {
        ...validPing,
        recordedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours old
      };

      const res = await request(app)
        .post('/api/v1/telemetry/ingest')
        .set('Authorization', `Bearer ${driverToken}`)
        .send(oldPing);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('too old');
    });

    it('rejects speed exceeding vehicle threshold (> 160 km/h) with 400 Bad Request', async () => {
      const hyperSpeedPing = {
        ...validPing,
        speedKmh: 175.0,
      };

      const res = await request(app)
        .post('/api/v1/telemetry/ingest')
        .set('Authorization', `Bearer ${driverToken}`)
        .send(hyperSpeedPing);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('160 km/h');
    });

    it('rejects payload when authenticated driver does not match driverId in payload with 403 Forbidden', async () => {
      const mismatchedPing = {
        ...validPing,
        driverId: '999e4567-e89b-12d3-a456-426614174999', // Mismatched driver
      };

      const res = await request(app)
        .post('/api/v1/telemetry/ingest')
        .set('Authorization', `Bearer ${driverToken}`)
        .send(mismatchedPing);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('rejects telemetry ingestion when target trip is already COMPLETED with 400 Bad Request', async () => {
      const querySpy = vi.spyOn(db, 'query').mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'COMPLETED',
        },
      ] as any);

      const res = await request(app)
        .post('/api/v1/telemetry/ingest')
        .set('Authorization', `Bearer ${driverToken}`)
        .send(validPing);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('completed');

      querySpy.mockRestore();
    });

    it('rejects telemetry ingestion when target trip is CANCELLED with 400 Bad Request', async () => {
      const querySpy = vi.spyOn(db, 'query').mockResolvedValueOnce([
        {
          id: tripId,
          school_id: schoolId,
          bus_id: busId,
          driver_id: driverId,
          status: 'CANCELLED',
        },
      ] as any);

      const res = await request(app)
        .post('/api/v1/telemetry/ingest')
        .set('Authorization', `Bearer ${driverToken}`)
        .send(validPing);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('cancelled');

      querySpy.mockRestore();
    });
  });

  describe('2. Raw Storage, Bus Position Cache & Real-Time Feed Dispatch', () => {
    it('ingests raw location, updates bus position cache, and publishes real-time feed event', async () => {
      // Mock trip lookup
      const tripMock = {
        id: tripId,
        school_id: schoolId,
        bus_id: busId,
        driver_id: driverId,
        status: 'IN_TRANSIT',
      };

      // Mock DB query sequence: 1) trip check, 2) insert raw gps, 3) update bus cache
      const querySpy = vi.spyOn(db, 'query')
        .mockResolvedValueOnce([tripMock] as any) // Trip check
        .mockResolvedValueOnce([
          {
            id: '101',
            tripId,
            busId,
            driverId,
            latitude: validPing.latitude,
            longitude: validPing.longitude,
            speedKmh: validPing.speedKmh,
            bearingDegrees: validPing.bearingDegrees,
            accuracyMeters: validPing.accuracyMeters,
            batteryPercentage: validPing.batteryPercentage,
            isCharging: validPing.isCharging,
            networkType: validPing.networkType,
            recordedAt: validPing.recordedAt,
            createdAt: new Date().toISOString(),
          },
        ] as any) // Insert raw gps
        .mockResolvedValueOnce([] as any); // Update bus cache

      // Track published feed event
      let publishedEvent: TelemetryFeedEvent | null = null;
      const unsubscribe = RealtimeFeedService.subscribeSchool(schoolId, (event) => {
        publishedEvent = event;
      });

      const res = await request(app)
        .post('/api/v1/telemetry/ingest')
        .set('Authorization', `Bearer ${driverToken}`)
        .send(validPing);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(publishedEvent).not.toBeNull();
      expect(publishedEvent?.schoolId).toBe(schoolId);
      expect(publishedEvent?.busId).toBe(busId);
      expect(publishedEvent?.tripId).toBe(tripId);
      expect(publishedEvent?.speedKmh).toBe(42.0);
      expect(publishedEvent?.healthStatus).toBe('HEALTHY');

      unsubscribe();
      querySpy.mockRestore();
    });
  });

  describe('3. Real-Time Feed Streaming Endpoints (SSE)', () => {
    it('provides real-time SSE stream for school fleet canvas on GET /api/v1/telemetry/schools/:schoolId/feed', async () => {
      // Mock fleet initial state
      const fleetSpy = vi.spyOn(GpsHealthService, 'getSchoolFleetGpsHealth').mockResolvedValueOnce({
        schoolId,
        totalBuses: 1,
        healthyCount: 1,
        degradedCount: 0,
        staleCount: 0,
        lostCount: 0,
        offlineCount: 0,
        buses: [
          {
            busId,
            busNumber: 'BUS-01',
            registrationNumber: 'DL 01 AB 1234',
            healthStatus: 'HEALTHY',
            lastLatitude: 28.6139,
            lastLongitude: 77.2090,
          },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/telemetry/schools/${schoolId}/feed`)
        .set('Authorization', `Bearer ${adminToken}`)
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk.toString();
            // Once initial_state arrives, terminate response for test
            if (data.includes('event: initial_state')) {
              res.destroy();
              callback(null, data);
            }
          });
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.body).toContain('event: initial_state');
      expect(res.body).toContain('BUS-01');

      fleetSpy.mockRestore();
    });

    it('supports query parameter token authentication for browser EventSource client', async () => {
      const fleetSpy = vi.spyOn(GpsHealthService, 'getSchoolFleetGpsHealth').mockResolvedValueOnce({
        schoolId,
        totalBuses: 0,
        healthyCount: 0,
        degradedCount: 0,
        staleCount: 0,
        lostCount: 0,
        offlineCount: 0,
        buses: [],
      });

      const res = await request(app)
        .get(`/api/v1/telemetry/schools/${schoolId}/feed?token=${adminToken}`)
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk.toString();
            if (data.includes('event: initial_state')) {
              res.destroy();
              callback(null, data);
            }
          });
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');

      fleetSpy.mockRestore();
    });

    it('enforces multi-tenant isolation on SSE school feed (403 Forbidden for cross-tenant)', async () => {
      const foreignSchoolId = '999e4567-e89b-12d3-a456-426614174999';

      const res = await request(app)
        .get(`/api/v1/telemetry/schools/${foreignSchoolId}/feed`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
    });

    it('provides trip-specific SSE stream on GET /api/v1/telemetry/trips/:tripId/feed', async () => {
      const trailSpy = vi.spyOn(TelemetryService, 'getTripLocationTrail').mockResolvedValueOnce([
        {
          id: 1,
          latitude: 28.6139,
          longitude: 77.2090,
          speedKmh: 35.0,
          recordedAt: new Date().toISOString(),
        },
      ]);

      const res = await request(app)
        .get(`/api/v1/telemetry/trips/${tripId}/feed`)
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk.toString();
            if (data.includes('event: initial_state')) {
              res.destroy();
              callback(null, data);
            }
          });
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.body).toContain('event: initial_state');
      expect(res.body).toContain(tripId);

      trailSpy.mockRestore();
    });
  });
});
