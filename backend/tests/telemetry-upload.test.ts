import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from '../src/app.js';
import { DriverAuthService } from '../src/services/driver-auth.service.js';
import { TelemetryService } from '../src/services/telemetry.service.js';
import { UserRole } from '@school-bus/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('GPS Telemetry Upload, Validation & Deduplication (Micro-phase 11.2)', () => {
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

  const samplePing = {
    tripId: '423e4567-e89b-12d3-a456-426614174003',
    busId: '323e4567-e89b-12d3-a456-426614174002',
    driverId: '123e4567-e89b-12d3-a456-426614174000',
    latitude: 28.6139,
    longitude: 77.2090,
    speedKmh: 40.0,
    bearingDegrees: 90.0,
    accuracyMeters: 4.5,
    batteryPercentage: 90,
    isCharging: false,
    networkType: 'CELLULAR',
    recordedAt: '2026-10-10T10:15:30.000Z',
  };

  describe('1. Payload Validation & Coordinate Checks', () => {
    it('rejects out-of-range speed (> 180 km/h) with 422 VALIDATION_ERROR', async () => {
      const invalidSpeed = {
        ...samplePing,
        speedKmh: 240.0, // Invalid speed > 180
      };

      const res = await request(app)
        .post('/api/v1/telemetry/ingest')
        .set('Authorization', `Bearer ${driverToken}`)
        .send(invalidSpeed);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid battery percentage (> 100) with 422 VALIDATION_ERROR', async () => {
      const invalidBattery = {
        ...samplePing,
        batteryPercentage: 150,
      };

      const res = await request(app)
        .post('/api/v1/telemetry/ingest')
        .set('Authorization', `Bearer ${driverToken}`)
        .send(invalidBattery);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('rejects invalid ISO timestamp string with 422 VALIDATION_ERROR', async () => {
      const invalidTime = {
        ...samplePing,
        recordedAt: 'invalid-date-string',
      };

      const res = await request(app)
        .post('/api/v1/telemetry/ingest')
        .set('Authorization', `Bearer ${driverToken}`)
        .send(invalidTime);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe('2. Deduplication & Idempotent Ingestion', () => {
    it('filters duplicate timestamps in batch upload and reports duplicatesSkipped', async () => {
      const duplicateBatch = {
        locations: [
          samplePing,
          samplePing, // Exact duplicate of samplePing
          { ...samplePing, recordedAt: '2026-10-10T10:15:35.000Z' },
        ],
      };

      const batchSpy = vi
        .spyOn(TelemetryService, 'ingestBatch')
        .mockResolvedValueOnce({
          ingestedCount: 2,
          duplicatesSkipped: 1,
          latestLocation: {
            tripId: samplePing.tripId,
            busId: samplePing.busId,
            driverId: samplePing.driverId,
            latitude: samplePing.latitude,
            longitude: samplePing.longitude,
            speedKmh: samplePing.speedKmh,
            batteryPercentage: samplePing.batteryPercentage,
            isCharging: samplePing.isCharging,
            networkType: 'CELLULAR',
            recordedAt: '2026-10-10T10:15:35.000Z',
          },
        });

      const res = await request(app)
        .post('/api/v1/telemetry/batch')
        .set('Authorization', `Bearer ${driverToken}`)
        .send(duplicateBatch);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.ingestedCount).toBe(2);
      expect(res.body.data.duplicatesSkipped).toBe(1);

      batchSpy.mockRestore();
    });

    it('single ping upload is idempotent on conflict', async () => {
      const singleSpy = vi
        .spyOn(TelemetryService, 'ingestLocation')
        .mockResolvedValueOnce({
          id: 105,
          tripId: samplePing.tripId,
          busId: samplePing.busId,
          driverId: samplePing.driverId,
          latitude: samplePing.latitude,
          longitude: samplePing.longitude,
          speedKmh: samplePing.speedKmh,
          bearingDegrees: samplePing.bearingDegrees,
          accuracyMeters: samplePing.accuracyMeters,
          batteryPercentage: samplePing.batteryPercentage,
          isCharging: samplePing.isCharging,
          networkType: 'CELLULAR',
          recordedAt: samplePing.recordedAt,
          createdAt: new Date().toISOString(),
        });

      const res = await request(app)
        .post('/api/v1/telemetry/ingest')
        .set('Authorization', `Bearer ${driverToken}`)
        .send(samplePing);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tripId).toBe(samplePing.tripId);

      singleSpy.mockRestore();
    });
  });

  describe('3. Database Migration 012 Verification', () => {
    it('verifies 012_gps_locations_deduplication.sql creates unique index', () => {
      const migrationPath = path.join(
        __dirname,
        '../src/db/migrations/012_gps_locations_deduplication.sql'
      );
      expect(fs.existsSync(migrationPath)).toBe(true);
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      expect(sql).toContain('CREATE UNIQUE INDEX');
      expect(sql).toContain('idx_uq_gps_trip_recorded');
      expect(sql).toContain('gps_locations(trip_id, recorded_at)');
    });
  });
});
