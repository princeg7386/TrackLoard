import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from '../src/app.js';
import { AuthService } from '../src/services/auth.service.js';
import { GpsHealthService } from '../src/services/gps-health.service.js';
import { UserRole, GPS_THRESHOLDS } from '@school-bus/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('GPS Health Monitoring & Location Cache (Micro-phase 11.3)', () => {
  const app = createApp();

  const schoolId = '223e4567-e89b-12d3-a456-426614174001';
  const adminUser = {
    id: '123e4567-e89b-12d3-a456-426614174099',
    schoolId,
    email: 'admin@school.com',
    role: UserRole.SCHOOL_ADMIN,
  };
  const adminToken = AuthService.generateToken(adminUser);

  describe('1. Pure Health Evaluation Rules (calculateHealthStatus)', () => {
    it('returns HEALTHY for fresh ping with high accuracy (<=15m) and online status', () => {
      const nowIso = new Date(Date.now() - 10 * 1000).toISOString(); // 10s old
      const status = GpsHealthService.calculateHealthStatus({
        accuracyMeters: 5.2,
        recordedAt: nowIso,
        isOnline: true,
        hasActiveTrip: true,
      });

      expect(status).toBe('HEALTHY');
    });

    it('returns DEGRADED_ACCURACY for fresh ping with poor accuracy (>30m)', () => {
      const nowIso = new Date(Date.now() - 15 * 1000).toISOString(); // 15s old
      const status = GpsHealthService.calculateHealthStatus({
        accuracyMeters: 45.0, // > 30m
        recordedAt: nowIso,
        isOnline: true,
        hasActiveTrip: true,
      });

      expect(status).toBe('DEGRADED_ACCURACY');
    });

    it('returns STALE_SIGNAL for ping aged between 60s and 300s', () => {
      const staleIso = new Date(Date.now() - 90 * 1000).toISOString(); // 90s old
      const status = GpsHealthService.calculateHealthStatus({
        accuracyMeters: 8.0,
        recordedAt: staleIso,
        isOnline: true,
        hasActiveTrip: true,
      });

      expect(status).toBe('STALE_SIGNAL');
    });

    it('returns SIGNAL_LOST for ping aged >= 300s (5 minutes)', () => {
      const lostIso = new Date(Date.now() - 360 * 1000).toISOString(); // 6 min old
      const status = GpsHealthService.calculateHealthStatus({
        accuracyMeters: 10.0,
        recordedAt: lostIso,
        isOnline: true,
        hasActiveTrip: true,
      });

      expect(status).toBe('SIGNAL_LOST');
    });

    it('returns OFFLINE when isOnline is false or recordedAt is missing', () => {
      expect(
        GpsHealthService.calculateHealthStatus({
          accuracyMeters: 5.0,
          recordedAt: new Date().toISOString(),
          isOnline: false,
        })
      ).toBe('OFFLINE');

      expect(
        GpsHealthService.calculateHealthStatus({
          accuracyMeters: null,
          recordedAt: null,
          isOnline: true,
        })
      ).toBe('OFFLINE');
    });
  });

  describe('2. Bus & Fleet GPS Health Summaries', () => {
    const mockBusHealth = {
      busId: '323e4567-e89b-12d3-a456-426614174002',
      busNumber: 'BUS-01',
      registrationNumber: 'DL 01 AB 1234',
      healthStatus: 'HEALTHY' as const,
      lastLatitude: 28.6139,
      lastLongitude: 77.2090,
      lastSpeedKmh: 35.5,
      lastAccuracyMeters: 6.0,
      lastBatteryPercentage: 88,
      lastIsCharging: true,
      lastNetworkType: 'CELLULAR',
      lastRecordedAt: new Date(Date.now() - 20 * 1000).toISOString(),
      ageSeconds: 20,
      activeTripId: '423e4567-e89b-12d3-a456-426614174003',
    };

    it('returns bus GPS health summary via GET /api/v1/telemetry/buses/:busId/health', async () => {
      const spy = vi
        .spyOn(GpsHealthService, 'getBusGpsHealth')
        .mockResolvedValueOnce(mockBusHealth);

      const res = await request(app).get(
        `/api/v1/telemetry/buses/${mockBusHealth.busId}/health`
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.busId).toBe(mockBusHealth.busId);
      expect(res.body.data.healthStatus).toBe('HEALTHY');
      expect(res.body.data.lastLatitude).toBe(28.6139);
      expect(res.body.data.lastLongitude).toBe(77.2090);

      spy.mockRestore();
    });

    it('returns school fleet GPS overview via GET /api/v1/telemetry/schools/:schoolId/health', async () => {
      const mockFleetOverview = {
        schoolId,
        totalBuses: 3,
        healthyCount: 2,
        degradedCount: 1,
        staleCount: 0,
        lostCount: 0,
        offlineCount: 0,
        buses: [
          mockBusHealth,
          {
            ...mockBusHealth,
            busId: '323e4567-e89b-12d3-a456-426614174003',
            busNumber: 'BUS-02',
            healthStatus: 'DEGRADED_ACCURACY' as const,
            lastAccuracyMeters: 40.0,
          },
        ],
      };

      const spy = vi
        .spyOn(GpsHealthService, 'getSchoolFleetGpsHealth')
        .mockResolvedValueOnce(mockFleetOverview);

      const res = await request(app)
        .get(`/api/v1/telemetry/schools/${schoolId}/health`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalBuses).toBe(3);
      expect(res.body.data.healthyCount).toBe(2);
      expect(res.body.data.degradedCount).toBe(1);
      expect(res.body.data.buses.length).toBe(2);

      spy.mockRestore();
    });

    it('enforces tenant isolation on GET /api/v1/telemetry/schools/:schoolId/health', async () => {
      const foreignSchoolId = '999e4567-e89b-12d3-a456-426614174999';

      const res = await request(app)
        .get(`/api/v1/telemetry/schools/${foreignSchoolId}/health`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ForbiddenError');
    });
  });

  describe('3. Database Migration 013 Verification', () => {
    it('verifies 013_bus_latest_location_cache.sql creates last location columns and indexes', () => {
      const migrationPath = path.join(
        __dirname,
        '../src/db/migrations/013_bus_latest_location_cache.sql'
      );
      expect(fs.existsSync(migrationPath)).toBe(true);
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS last_latitude');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS last_longitude');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS last_location');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS last_speed_kmh');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS last_accuracy_meters');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS gps_health_status');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_buses_gps_health');
      expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_buses_last_location_gist');
    });
  });
});
