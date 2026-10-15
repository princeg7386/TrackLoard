import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from '../src/app.js';
import { DriverAuthService } from '../src/services/driver-auth.service.js';
import { AuthService } from '../src/services/auth.service.js';
import { TelemetryService } from '../src/services/telemetry.service.js';
import { UserRole } from '@school-bus/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('GPS Telemetry Capture & Ingestion (Micro-phase 11.1)', () => {
  const app = createApp();

  const mockDriver = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    schoolId: '223e4567-e89b-12d3-a456-426614174001',
    phone: '+919876543210',
    fullName: 'Ramesh Driver',
    role: UserRole.DRIVER as const,
    assignedBusId: '323e4567-e89b-12d3-a456-426614174002',
  };

  const driverToken = DriverAuthService.generateDriverToken(mockDriver);
  const adminToken = AuthService.generateToken({
    id: '999e4567-e89b-12d3-a456-426614174099',
    schoolId: '223e4567-e89b-12d3-a456-426614174001',
    email: 'admin@school.com',
    role: UserRole.SCHOOL_ADMIN,
  });

  const validPingPayload = {
    tripId: '423e4567-e89b-12d3-a456-426614174003',
    busId: '323e4567-e89b-12d3-a456-426614174002',
    driverId: '123e4567-e89b-12d3-a456-426614174000',
    latitude: 28.6139,
    longitude: 77.2090,
    speedKmh: 34.5,
    bearingDegrees: 182.0,
    accuracyMeters: 6.4,
    batteryPercentage: 88,
    isCharging: false,
    networkType: 'CELLULAR',
    recordedAt: new Date().toISOString(),
  };

  describe('1. POST /api/v1/telemetry/ingest (Single GPS Ping)', () => {
    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/v1/telemetry/ingest')
        .send(validPingPayload);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects invalid latitude and longitude ranges with 422 Unprocessable Entity', async () => {
      const invalidPayload = {
        ...validPingPayload,
        latitude: 95.5, // Invalid > 90
        longitude: 195.0, // Invalid > 180
      };

      const res = await request(app)
        .post('/api/v1/telemetry/ingest')
        .set('Authorization', `Bearer ${driverToken}`)
        .send(invalidPayload);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects payload when driver ID does not match authenticated token with 403 Forbidden', async () => {
      const mismatchedPayload = {
        ...validPingPayload,
        driverId: '999e4567-e89b-12d3-a456-426614174999', // Different driver
      };

      const res = await request(app)
        .post('/api/v1/telemetry/ingest')
        .set('Authorization', `Bearer ${driverToken}`)
        .send(mismatchedPayload);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('does not match authenticated session');
    });

    it('successfully ingests valid single GPS ping with 201 Created', async () => {
      const ingestSpy = vi
        .spyOn(TelemetryService, 'ingestLocation')
        .mockResolvedValueOnce({
          id: 101,
          tripId: validPingPayload.tripId,
          busId: validPingPayload.busId,
          driverId: validPingPayload.driverId,
          latitude: validPingPayload.latitude,
          longitude: validPingPayload.longitude,
          speedKmh: validPingPayload.speedKmh,
          bearingDegrees: validPingPayload.bearingDegrees,
          accuracyMeters: validPingPayload.accuracyMeters,
          batteryPercentage: validPingPayload.batteryPercentage,
          isCharging: validPingPayload.isCharging,
          networkType: 'CELLULAR',
          recordedAt: validPingPayload.recordedAt,
          createdAt: new Date().toISOString(),
        });

      const res = await request(app)
        .post('/api/v1/telemetry/ingest')
        .set('Authorization', `Bearer ${driverToken}`)
        .send(validPingPayload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.latitude).toBe(28.6139);
      expect(res.body.data.longitude).toBe(77.2090);
      expect(res.body.data.speedKmh).toBe(34.5);
      expect(res.body.data.batteryPercentage).toBe(88);
      expect(res.body.data.networkType).toBe('CELLULAR');

      ingestSpy.mockRestore();
    });
  });

  describe('2. POST /api/v1/telemetry/batch (Batch Offline Telemetry)', () => {
    it('validates non-empty array of location records', async () => {
      const res = await request(app)
        .post('/api/v1/telemetry/batch')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ locations: [] });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('ingests batch of 3 buffered GPS pings returning 200 OK', async () => {
      const batchPayload = {
        locations: [
          { ...validPingPayload, latitude: 28.6139, longitude: 77.2090, recordedAt: '2026-10-10T10:00:00Z' },
          { ...validPingPayload, latitude: 28.6145, longitude: 77.2095, recordedAt: '2026-10-10T10:00:05Z' },
          { ...validPingPayload, latitude: 28.6152, longitude: 77.2102, recordedAt: '2026-10-10T10:00:10Z' },
        ],
      };

      const batchSpy = vi
        .spyOn(TelemetryService, 'ingestBatch')
        .mockResolvedValueOnce({
          ingestedCount: 3,
          latestLocation: {
            tripId: validPingPayload.tripId,
            busId: validPingPayload.busId,
            driverId: validPingPayload.driverId,
            latitude: 28.6152,
            longitude: 77.2102,
            speedKmh: 34.5,
            batteryPercentage: 88,
            isCharging: false,
            networkType: 'CELLULAR',
            recordedAt: '2026-10-10T10:00:10Z',
          },
        });

      const res = await request(app)
        .post('/api/v1/telemetry/batch')
        .set('Authorization', `Bearer ${driverToken}`)
        .send(batchPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ingestedCount).toBe(3);
      expect(res.body.data.latestLocation.latitude).toBe(28.6152);

      batchSpy.mockRestore();
    });
  });

  describe('3. GET /api/v1/telemetry/buses/:busId/latest', () => {
    it('returns latest coordinates and telemetry snapshot for the bus', async () => {
      const busId = '323e4567-e89b-12d3-a456-426614174002';
      const latestSpy = vi
        .spyOn(TelemetryService, 'getLatestBusLocation')
        .mockResolvedValueOnce({
          id: 500,
          tripId: validPingPayload.tripId,
          busId,
          driverId: validPingPayload.driverId,
          latitude: 28.6139,
          longitude: 77.2090,
          speedKmh: 42.0,
          accuracyMeters: 5.0,
          batteryPercentage: 92,
          isCharging: true,
          networkType: 'CELLULAR',
          recordedAt: new Date().toISOString(),
        });

      const res = await request(app)
        .get(`/api/v1/telemetry/buses/${busId}/latest`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.latitude).toBe(28.6139);
      expect(res.body.data.speedKmh).toBe(42.0);
      expect(res.body.data.isCharging).toBe(true);

      latestSpy.mockRestore();
    });
  });

  describe('4. GET /api/v1/telemetry/trips/:tripId/trail', () => {
    it('returns chronological array of trip location trail breadcrumbs', async () => {
      const tripId = '423e4567-e89b-12d3-a456-426614174003';
      const trailSpy = vi
        .spyOn(TelemetryService, 'getTripLocationTrail')
        .mockResolvedValueOnce([
          { id: 1, latitude: 28.61, longitude: 77.20, speedKmh: 20, recordedAt: '2026-10-10T10:00:00Z' },
          { id: 2, latitude: 28.62, longitude: 77.21, speedKmh: 35, recordedAt: '2026-10-10T10:00:10Z' },
        ]);

      const res = await request(app)
        .get(`/api/v1/telemetry/trips/${tripId}/trail`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tripId).toBe(tripId);
      expect(res.body.data.count).toBe(2);
      expect(res.body.data.trail.length).toBe(2);

      trailSpy.mockRestore();
    });
  });

  describe('5. Database Migration 011 Verification', () => {
    it('verifies 011_gps_telemetry_battery_network.sql exists with correct fields', () => {
      const migrationPath = path.join(
        __dirname,
        '../src/db/migrations/011_gps_telemetry_battery_network.sql'
      );
      expect(fs.existsSync(migrationPath)).toBe(true);
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      expect(sql).toContain('battery_percentage');
      expect(sql).toContain('is_charging');
      expect(sql).toContain('network_type');
    });
  });
});
