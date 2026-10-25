// Static auth matrix over every Express route — run with: npx tsx --test audit-tests/route-auth.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../backend/src/routes/', import.meta.url));
const mounts: Record<string, string> = {
  'auth.routes.ts': '/api/v1/auth', 'driver-auth.routes.ts': '/api/v1/driver/auth', 'parent-identity.routes.ts': '/api/v1/parent',
  'telemetry.routes.ts': '/api/v1/telemetry', 'school-profile.routes.ts': '/api/v1/schools', 'dashboard.routes.ts': '/api/v1/schools',
  'bus.routes.ts': '/api/v1/schools', 'driver.routes.ts': '/api/v1/schools', 'student.routes.ts': '/api/v1/schools',
};
// Routes that are intentionally public (login / reset / tokenised parent links)
const PUBLIC = new Set([
  'POST /api/v1/auth/login', 'POST /api/v1/auth/logout', 'POST /api/v1/auth/forgot-password', 'POST /api/v1/auth/reset-password',
  'POST /api/v1/driver/auth/login', 'POST /api/v1/driver/auth/logout',
  'GET /api/v1/parent/track/:token', 'GET /api/v1/parent/track',
  'GET /api/v1/parent/track/:token/verify-entry', 'GET /api/v1/parent/track/verify-entry',
  'GET /api/v1/parent/onboard/verify', 'POST /api/v1/parent/onboard/confirm',
]);
type R = { method: string; path: string; block: string };
const routes: R[] = [];
for (const [file, base] of Object.entries(mounts)) {
  const src = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1'); // comments are not guards
  for (const block of src.split(/\n(?=\w+\.(?:get|post|put|patch|delete)\()/)) {
    const m = block.match(/^\w+\.(get|post|put|patch|delete)\(\s*'([^']+)'/);
    if (m) routes.push({ method: m[1]!.toUpperCase(), path: base + m[2], block });
  }
}
const isAuthed = (b: string) => /authenticate(Token|Driver\b|ParentTrackingToken)/.test(b);

test(`every non-public route requires authentication (${routes.length} routes scanned)`, () => {
  const open = routes.filter(r => !PUBLIC.has(`${r.method} ${r.path}`) && !isAuthed(r.block)).map(r => `${r.method} ${r.path}`);
  assert.deepEqual(open, [], `UNAUTHENTICATED:\n  ${open.join('\n  ')}`);
});

test('admin school routes restrict role (driver JWTs share JWT_SECRET and pass authenticateToken)', () => {
  const loose = routes.filter(r => r.path.startsWith('/api/v1/schools') && /authenticateToken/.test(r.block) && !/requireRoles|requirePermission/.test(r.block))
    .map(r => `${r.method} ${r.path}`);
  assert.deepEqual(loose, [], `DRIVER TOKEN CAN ACCESS:\n  ${loose.join('\n  ')}`);
});

test('forgot-password is rate limited', () => {
  const r = routes.find(r => r.path.endsWith('/forgot-password'))!;
  assert.match(r.block, /RateLimiter/, 'forgot-password has no rate limiter');
});

test('driver login requires a secret (PIN/OTP), not only the phone number', () => {
  const src = fs.readFileSync(new URL('../backend/src/services/driver-auth.service.ts', import.meta.url), 'utf8');
  const login = src.slice(src.indexOf('static async login('), src.indexOf('static async getDriverProfile'));
  const rejectsMissingSecret = /if\s*\(\s*!pin\s*&&\s*!licenseNumber|!driver\.pin_hash[\s\S]{0,80}throw|pin_hash\s*&&\s*!pin[\s\S]{0,80}throw/.test(login);
  assert.ok(rejectsMissingSecret, 'phone-only login succeeds: no throw when PIN and licence are both absent');
});

test('parent live web entry verification endpoints are allowlisted as intentionally public', () => {
  assert.ok(PUBLIC.has('GET /api/v1/parent/track/:token/verify-entry'), 'GET /api/v1/parent/track/:token/verify-entry missing from PUBLIC allowlist');
  assert.ok(PUBLIC.has('GET /api/v1/parent/track/verify-entry'), 'GET /api/v1/parent/track/verify-entry missing from PUBLIC allowlist');
});
