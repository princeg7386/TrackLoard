// Audit behavioural tests — run with: npx tsx --test audit-tests/logic.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeIndianPhoneNumber, IndianVehicleRegistrationRegex, normalizeIndianRegistrationNumber,
  CreateBusRequestSchema, TelemetryIngestSchema, TelemetryBatchIngestSchema,
  calculateHaversineDistanceMeters, CreateDriverRequestSchema, CreateStudentRequestSchema,
} from '@school-bus/shared';
import { TelemetryService } from '../backend/src/services/telemetry.service.js';
import { GpsHealthService } from '../backend/src/services/gps-health.service.js';
import { env } from '../backend/src/config/env.js';
import { SecurityUtil } from '../backend/src/utils/security.util.js';

const uuid = () => crypto.randomUUID();
const ping = (o: Record<string, unknown> = {}) => ({
  tripId: uuid(), busId: uuid(), driverId: uuid(), latitude: 28.6139, longitude: 77.209,
  speedKmh: 40, accuracyMeters: 8, recordedAt: new Date().toISOString(), ...o,
});

describe('Phase 3.2 / 7.1 — Indian phone normalisation', () => {
  test('10-digit, 0-prefixed, 91-prefixed and +91 all normalise to E.164', () => {
    for (const p of ['9876543210', '09876543210', '919876543210', '+91 98765-43210'])
      assert.equal(normalizeIndianPhoneNumber(p), '+919876543210');
  });
  test('invalid number is NOT rejected by normaliser (returns garbage silently)', () => {
    assert.equal(normalizeIndianPhoneNumber('12345'), '12345');
  });
  test('CreateDriverRequestSchema rejects an invalid mobile', () => {
    const r = CreateDriverRequestSchema.safeParse({ fullName: 'Ramesh', phone: '12345', licenseNumber: 'DL-0420110012345' });
    assert.equal(r.success, false, 'driver with invalid phone accepted');
  });
});

describe('Phase 6.1 — Bus registration validation', () => {
  test('accepts common Indian formats', () => {
    for (const r of ['DL-01-AB-1234', 'MH12DE1433', 'HR 26 CK 9087', '22-BH-1234-AA'])
      assert.ok(IndianVehicleRegistrationRegex.test(r), r);
  });
  test('rejects junk', () => {
    for (const r of ['HELLO', '1234', 'DL-01-AB-12'])
      assert.ok(!IndianVehicleRegistrationRegex.test(r), r);
  });
  test('same plate written two ways normalises to the same key (duplicate guard)', () => {
    assert.equal(normalizeIndianRegistrationNumber('DL01AB1234'), normalizeIndianRegistrationNumber('DL-01-AB-1234'));
  });
  test('scope guard: capacity / isActive are not part of Create Bus contract', () => {
    const r = CreateBusRequestSchema.safeParse({ busNumber: 'B1', registrationNumber: 'DL-01-AB-1234', capacity: 40, isActive: true });
    assert.ok(r.success);
    assert.ok(!('capacity' in (r.data as object)) && !('isActive' in (r.data as object)));
  });
});

describe('Phase 8.1 — Student contract', () => {
  test('requires name, class, section, student id', () => {
    const r = CreateStudentRequestSchema.safeParse({});
    assert.equal(r.success, false);
  });
});

describe('Phase 2.4 — Spatial maths', () => {
  test('Haversine Connaught Place → Cyber Hub ≈ 20–25 km', () => {
    const d = calculateHaversineDistanceMeters({ latitude: 28.6315, longitude: 77.2167 }, { latitude: 28.4950, longitude: 77.0895 });
    assert.ok(d > 18000 && d < 26000, String(d));
  });
});

describe('Phase 11.2 / 11.4 — Telemetry validation consistency', () => {
  test('API schema and service agree on max speed', () => {
    const schemaOk = TelemetryIngestSchema.safeParse(ping({ speedKmh: 170 })).success;
    let serviceOk = true;
    try { TelemetryService.validateKinematics({ speedKmh: 170, latitude: 28.6, longitude: 77.2 }); } catch { serviceOk = false; }
    assert.equal(schemaOk, serviceOk, `schema accepts 170 km/h = ${schemaOk}, service accepts = ${serviceOk}`);
  });
  test('one bad point must not reject the whole offline batch', async () => {
    const driverId = uuid(), tripId = uuid(), busId = uuid();
    const batch = Array.from({ length: 50 }, (_, i) =>
      ping({ driverId, tripId, busId, recordedAt: new Date(Date.now() - (50 - i) * 5000).toISOString(), speedKmh: i === 25 ? 165 : 40 }));
    let err: any = null;
    try { await TelemetryService.ingestBatch(batch as any, driverId); } catch (e) { err = e; }
    // Reaching the DB layer (or pg stub/connection) means in-memory validation let the good points through
    assert.ok(
      !err || /pg stub|ECONNREFUSED|connect|AggregateError/i.test(String(err?.message || err?.name)),
      `whole batch rejected before DB: ${err?.message || err?.name}`
    );
  });
  test('future timestamps (>5 min) and >24h old timestamps are rejected', () => {
    assert.throws(() => TelemetryService.validateTimestamp(new Date(Date.now() + 10 * 60e3).toISOString()));
    assert.throws(() => TelemetryService.validateTimestamp(new Date(Date.now() - 25 * 3600e3).toISOString()));
    assert.doesNotThrow(() => TelemetryService.validateTimestamp(new Date().toISOString()));
  });
  test('batch upper bound 500 enforced by schema', () => {
    const many = Array.from({ length: 501 }, () => ping());
    assert.equal(TelemetryBatchIngestSchema.safeParse({ locations: many }).success, false);
  });
});

describe('Phase 11.3 — GPS health classification', () => {
  const now = () => new Date().toISOString();
  test('fresh + accurate → HEALTHY', () => assert.equal(GpsHealthService.calculateHealthStatus({ accuracyMeters: 10, recordedAt: now(), isOnline: true }), 'HEALTHY'));
  test('poor accuracy → DEGRADED_ACCURACY', () => assert.equal(GpsHealthService.calculateHealthStatus({ accuracyMeters: 500, recordedAt: now(), isOnline: true }), 'DEGRADED_ACCURACY'));
  test('offline → OFFLINE', () => assert.equal(GpsHealthService.calculateHealthStatus({ recordedAt: now(), isOnline: false }), 'OFFLINE'));
  test('2 min old → STALE_SIGNAL or SIGNAL_LOST', () => {
    const s = GpsHealthService.calculateHealthStatus({ accuracyMeters: 10, recordedAt: new Date(Date.now() - 120e3).toISOString(), isOnline: true });
    assert.ok(['STALE_SIGNAL', 'SIGNAL_LOST'].includes(s), s);
  });
  test('30 min old → SIGNAL_LOST', () => assert.equal(GpsHealthService.calculateHealthStatus({ recordedAt: new Date(Date.now() - 1800e3).toISOString(), isOnline: true }), 'SIGNAL_LOST'));
});

describe('Phase 4.5 — Secrets protection', () => {
  test('NODE_ENV defaults to a non-production mode when unset', () => {
    assert.equal(env.NODE_ENV, 'development');
  });
  test('a production secrets validator exists', () => {
    assert.equal(typeof SecurityUtil.validateProductionSecrets, 'function');
  });
  test('…and the server enforces it at startup', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../backend/src/index.ts', import.meta.url), 'utf8') + fs.readFileSync(new URL('../backend/src/app.ts', import.meta.url), 'utf8') + fs.readFileSync(new URL('../backend/src/config/env.ts', import.meta.url), 'utf8');
    assert.match(src, /validateProductionSecrets/, 'validateProductionSecrets() is never called on boot');
  });
});
