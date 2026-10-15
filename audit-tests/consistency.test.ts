// Audit v2 — cross-layer consistency checks for Phase 0–11.
//   npx tsx --test audit-tests/consistency.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TripStatus, TelemetryIngestSchema } from '@school-bus/shared';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));
const migrations = fs.readdirSync(path.join(ROOT, 'backend/src/db/migrations')).sort()
  .map((f) => read(`backend/src/db/migrations/${f}`)).join('\n');
const walk = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
const routeBlocks = (file: string) => read(file).split(/\n(?=\w+\.(?:get|post|put|patch|delete)\()/)
  .map((b) => ({ b, m: b.match(/^\w+\.(get|post|put|patch|delete)\(\s*'([^']+)'/) })).filter((x) => x.m)
  .map(({ b, m }) => ({ method: m![1]!.toUpperCase(), path: m![2]!, block: b }));

describe('Trip status vocabulary (Phase 2 ↔ 10 ↔ 11)', () => {
  const check = migrations.match(/chk_trips_status[\s\S]*?CHECK\s*\(status IN \(([^)]*)\)/);
  const allowed = check ? check[1]!.match(/'([A-Z_]+)'/g)!.map((s) => s.replace(/'/g, '')) : null;
  test('every shared TripStatus value is allowed by the DB CHECK constraint', () => {
    if (!allowed) return;
    const missing = Object.values(TripStatus).filter((v) => !allowed.includes(v as string));
    assert.deepEqual(missing, [], `DB rejects: ${missing.join(', ')} (allowed: ${allowed.join(', ')})`);
  });
  test('backend, dashboard and driver app use ONE name for a running trip', () => {
    const files = [...walk('backend/src'), ...walk('school-dashboard/src'), ...walk('driver-app/lib')]
      .filter((f) => /\.(ts|tsx|dart)$/.test(f));
    const uses = (word: string) => files.filter((f) => read(f).includes(`'${word}'`));
    const a = uses('IN_PROGRESS'), b = uses('IN_TRANSIT');
    assert.ok(!(a.length && b.length), `IN_PROGRESS used in: ${a.join(', ')}\n  IN_TRANSIT used in: ${b.join(', ')}`);
  });
});

describe('Soft delete + unique constraints (Phase 2.5 / 6.3 / 8.4)', () => {
  for (const [table, con] of [['buses', 'uq_bus_reg_school'], ['students', 'uq_student_admission_school'], ['parents', 'uq_parent_student_phone'], ['drivers', 'uq_driver_phone_school']]) {
    test(`${table}: old full UNIQUE constraint ${con} is dropped (so removed rows can be re-added)`, () => {
      assert.match(migrations, new RegExp(`DROP CONSTRAINT IF EXISTS ${con}\\b`), `${con} still blocks re-adding a soft-deleted ${table.slice(0, -1)}`);
    });
  }
  test('seed ON CONFLICT targets still match a usable unique index', () => {
    const seed = read('backend/src/db/seed.ts');
    const partialOnly = [['routes', 'school_id, code', 'uq_route_code_school'], ['buses', 'school_id, registration_number', 'uq_bus_reg_school'], ['students', 'school_id, admission_number', 'uq_student_admission_school']]
      .filter(([, , con]) => new RegExp(`DROP CONSTRAINT IF EXISTS ${con}\\b`).test(migrations));
    const broken = partialOnly.filter(([t, cols]) => new RegExp(`INSERT INTO ${t}[\\s\\S]*?ON CONFLICT \\(${cols}\\)(?!\\s*WHERE)`).test(seed)).map(([t]) => t);
    assert.deepEqual(broken, [], `seed.ts ON CONFLICT has no matching constraint for: ${broken.join(', ')} → "no unique or exclusion constraint matching the ON CONFLICT specification"`);
  });
});

describe('Authorization depth (Phase 4.3 / 4.4)', () => {
  const tele = routeBlocks('backend/src/routes/telemetry.routes.ts').filter((r) => r.method === 'GET');
  test('telemetry read routes check role AND that the bus/trip belongs to the caller\'s school', () => {
    const weak = tele.filter((r) => !/requireRoles|requirePermission/.test(r.block) || !/Tenant|Scope|Owner|assert/i.test(r.block))
      .map((r) => `GET /api/v1/telemetry${r.path}`);
    assert.deepEqual(weak, [], `any logged-in user (incl. other schools / drivers) can read:\n  ${weak.join('\n  ')}`);
  });
  const par = routeBlocks('backend/src/routes/parent-identity.routes.ts').filter((r) => /identity|token\//.test(r.path));
  test('parent identity / token admin routes restrict role and school', () => {
    const weak = par.filter((r) => !/requireRoles|requirePermission/.test(r.block) || !/requireTenantScope/.test(r.block))
      .map((r) => `${r.method} /api/v1/parent${r.path}`);
    assert.deepEqual(weak, [], `driver tokens / other schools can call:\n  ${weak.join('\n  ')}`);
  });
  test('forgot-password returns the reset token only in NODE_ENV=test', () => {
    const c = read('backend/src/controllers/auth.controller.ts');
    assert.doesNotMatch(c, /NODE_ENV !== 'production' \? \{ devResetToken/, 'reset token is returned in development (the default NODE_ENV)');
  });
});

describe('Telemetry pipeline (Phase 10 ↔ 11)', () => {
  test('driver app speed clamp ≤ API schema max speed', () => {
    const dart = read('driver-app/lib/services/location_capture_service.dart');
    const clamp = Number(dart.match(/clamp\(0(?:\.0)?,\s*([\d.]+)\)/)?.[1]);
    const max = (TelemetryIngestSchema.shape.speedKmh as any)._def.innerType?._def.checks?.find((c: any) => c.kind === 'max')?.value;
    assert.ok(!(clamp > max), `app sends up to ${clamp} km/h but API rejects > ${max} → whole batch 422 → app deletes it`);
  });
  test('offline queue does not delete data on 401/403 (expired or revoked session)', () => {
    const q = read('driver-app/lib/services/telemetry_queue_service.dart');
    const dropBranch = q.match(/else if \(batchResult\.statusCode >= 400[^)]*\)/)?.[0] ?? '';
    assert.ok(!dropBranch || /401/.test(dropBranch), `drop branch: ${dropBranch}`);
  });
  test('batch ingest verifies trip belongs to the same bus and driver', () => {
    const s = read('backend/src/services/telemetry.service.ts');
    const batch = s.slice(s.indexOf('static async ingestBatch'));
    assert.match(batch.slice(0, 4000), /bus_id\s*!==|driver_id\s*!==|\.bus_id\s*!==/, 'batch path never compares trip.bus_id / trip.driver_id with the payload');
  });
  test('Android foreground/background location service is actually started', () => {
    const dart = walk('driver-app/lib').filter((f) => f.endsWith('.dart')).map(read).join('\n');
    assert.match(dart, /FlutterBackgroundService\(\)|startService\(|AndroidServiceConfiguration/, 'flutter_background_service is declared but never configured/started → GPS stops when screen locks');
  });
  test('Android project scaffold is committed (gradle + MainActivity)', () => {
    const need = ['driver-app/android/settings.gradle', 'driver-app/android/app/build.gradle'];
    const kts = need.map((p) => p + '.kts');
    const missing = need.filter((p, i) => !exists(p) && !exists(kts[i]!));
    const main = walk('driver-app/android').some((f) => /MainActivity\.(kt|java)$/.test(f));
    assert.ok(missing.length === 0 && main, `missing: ${[...missing, ...(main ? [] : ['MainActivity'])].join(', ')}`);
  });
});

describe('Project control (Phase 0 / 1)', () => {
  test('parent-web has an app (not just package.json)', () => {
    assert.ok(exists('parent-web/src') || exists('parent-web/app'), 'parent-web/ is an empty shell; parent page lives inside school-dashboard/src/app/track');
  });
});
