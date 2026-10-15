import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/services/auth.service.js';
import { GpsHealthService } from '../src/services/gps-health.service.js';
import { RealtimeFeedService } from '../src/services/realtime-feed.service.js';
import { UserRole, BusGpsHealthSummary } from '@school-bus/shared';

/**
 * Phase 12.2 — Real-time Transport (SSE Streams & Subscriptions)
 * Tests for GET /api/v1/telemetry/schools/:schoolId/feed and /api/v1/telemetry/buses/:busId/feed
 */
describe('Phase 12.2 — Real-time Transport (SSE Streams)', () => {
  const app = createApp();

  const SCHOOL_A_ID = '1a000000-0000-4000-8000-00000000000a';
  const SCHOOL_B_ID = '1b000000-0000-4000-8000-00000000000b';
  const BUS_ID = '3b000000-0000-4000-8000-00000000000b';

  const adminAToken = AuthService.generateToken({
    id: 'aa000000-0000-4000-8000-000000000001',
    schoolId: SCHOOL_A_ID,
    email: 'admin-a@school.test',
    role: UserRole.SCHOOL_ADMIN,
  });

  const adminBToken = AuthService.generateToken({
    id: 'bb000000-0000-4000-8000-000000000002',
    schoolId: SCHOOL_B_ID,
    email: 'admin-b@school.test',
    role: UserRole.SCHOOL_ADMIN,
  });

  const mockBusGpsHealth: BusGpsHealthSummary = {
    busId: BUS_ID,
    busNumber: 'Bus 04 (South)',
    registrationNumber: 'DL04AB0011',
    healthStatus: 'HEALTHY',
    lastLatitude: 28.6139,
    lastLongitude: 77.209,
    lastSpeedKmh: 32.5,
    lastAccuracyMeters: 8.4,
    lastBatteryPercentage: 87,
    lastIsCharging: false,
    lastNetworkType: 'CELLULAR',
    lastRecordedAt: new Date().toISOString(),
    ageSeconds: 5,
    activeTripId: 't1000000-0000-4000-8000-000000000001',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. GET /api/v1/telemetry/buses/:busId/feed (Subscription by Bus)', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get(`/api/v1/telemetry/buses/${BUS_ID}/feed`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects non-admin role (DRIVER) with 403 Forbidden', async () => {
      const driverToken = AuthService.generateToken({
        id: 'd9999999-0000-4000-8000-000000000099',
        schoolId: SCHOOL_A_ID,
        email: undefined as any,
        role: UserRole.DRIVER,
      });

      const res = await request(app)
        .get(`/api/v1/telemetry/buses/${BUS_ID}/feed`)
        .set('Authorization', `Bearer ${driverToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('enforces tenant isolation: rejects bus from different school with 404', async () => {
      const { NotFoundError } = await import('../src/middlewares/error.middleware.js');
      vi.spyOn(GpsHealthService, 'getBusGpsHealth').mockRejectedValueOnce(
        new NotFoundError('Bus not found')
      );

      const res = await request(app)
        .get(`/api/v1/telemetry/buses/${BUS_ID}/feed`)
        .set('Authorization', `Bearer ${adminBToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('authenticates via ?token= query parameter (EventSource standard)', async () => {
      vi.spyOn(GpsHealthService, 'getBusGpsHealth').mockResolvedValueOnce(mockBusGpsHealth);

      const res = await request(app)
        .get(`/api/v1/telemetry/buses/${BUS_ID}/feed?token=${adminAToken}`)
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
      expect(res.headers['cache-control']).toContain('no-cache');
      expect(res.body).toContain('event: initial_state');
      expect(res.body).toContain(BUS_ID);
    });
  });

  describe('2. GET /api/v1/telemetry/schools/:schoolId/feed (Subscription by School)', () => {
    it('enforces tenant isolation when school B tries to subscribe to school A feed', async () => {
      const res = await request(app)
        .get(`/api/v1/telemetry/schools/${SCHOOL_A_ID}/feed`)
        .set('Authorization', `Bearer ${adminBToken}`);

      // requireTenantScope enforces params.schoolId === req.user.schoolId
      expect(res.status).toBe(403);
    });

    it('successfully initiates school fleet SSE stream with initial_state', async () => {
      vi.spyOn(GpsHealthService, 'getSchoolFleetGpsHealth').mockResolvedValueOnce({
        schoolId: SCHOOL_A_ID,
        totalBuses: 1,
        healthyCount: 1,
        degradedCount: 0,
        staleCount: 0,
        lostCount: 0,
        offlineCount: 0,
        buses: [mockBusGpsHealth],
      });

      const res = await request(app)
        .get(`/api/v1/telemetry/schools/${SCHOOL_A_ID}/feed?token=${adminAToken}`)
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
      expect(res.body).toContain(SCHOOL_A_ID);
    });
  });

  describe('3. RealtimeFeedService Pub-Sub Dispatch', () => {
    it('dispatches location_update to bus subscriber channel', () => {
      let receivedEvent: any = null;
      const unsubscribe = RealtimeFeedService.subscribeBus(BUS_ID, (event) => {
        receivedEvent = event;
      });

      RealtimeFeedService.publish({
        type: 'LOCATION_UPDATE',
        schoolId: SCHOOL_A_ID,
        busId: BUS_ID,
        tripId: 't1000000-0000-4000-8000-000000000001',
        latitude: 28.614,
        longitude: 77.2091,
        speedKmh: 35.0,
        healthStatus: 'HEALTHY',
        recordedAt: new Date().toISOString(),
        timestamp: new Date().toISOString(),
      });

      expect(receivedEvent).not.toBeNull();
      expect(receivedEvent.busId).toBe(BUS_ID);
      expect(receivedEvent.speedKmh).toBe(35.0);

      unsubscribe();
    });
  });
});
