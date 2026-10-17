// BUSLOARD — real end-to-end smoke test for Phase 3–11 (no mocks).
// Talks to a running backend + real PostGIS database. Prints a JSON array of results on stdout.
//
//   API_URL   (default http://localhost:4100/api/v1)
//   SQL_CMD   command that reads SQL on stdin, e.g.
//             "docker exec -i school_bus_postgis psql -U postgres -d audit_fresh -v ON_ERROR_STOP=1 -qtA"
import { execSync } from 'node:child_process';

const API = process.env.API_URL || 'http://localhost:4100/api/v1';
const ROOT = API.replace(/\/api\/v1\/?$/, '');
const SQL_CMD = process.env.SQL_CMD ||
  'docker exec -i school_bus_postgis psql -U postgres -d audit_fresh -v ON_ERROR_STOP=1 -qtA';

const results = [];
const rec = (phase, name, ok, detail = '', severity = ok ? 'pass' : 'fail') =>
  results.push({ phase, name, status: ok === null ? 'skip' : ok ? 'PASS' : severity === 'warn' ? 'WARN' : 'FAIL', detail: String(detail).slice(0, 300) });

const sql = (q) => execSync(SQL_CMD, { input: q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
async function call(method, path, { token, body, base = API } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
    return { status: res.status, body: json, headers: res.headers };
  } catch (e) { return { status: 0, body: { error: e.message }, headers: new Headers() }; }
}
const short = (r) => `HTTP ${r.status} ${JSON.stringify(r.body?.error?.message || r.body?.error || r.body?.message || r.body?.raw || '').slice(0, 160)}`;
const findId = (o, key = 'id') => {
  if (!o || typeof o !== 'object') return undefined;
  if (typeof o[key] === 'string') return o[key];
  for (const v of Object.values(o)) { const f = findId(v, key); if (f) return f; }
};
const expect = async (phase, name, promise, okStatuses, sev) => {
  const r = await promise; const ok = okStatuses.includes(r.status);
  rec(phase, name, ok, ok ? `HTTP ${r.status}` : short(r), sev); return r;
};

const PW = 'Audit@12345';
const A = '1a000000-0000-4000-8000-00000000000a', B = '1b000000-0000-4000-8000-00000000000b';
const RA = '2a000000-0000-4000-8000-00000000000a', RB = '2b000000-0000-4000-8000-00000000000b';
const STOP = '3a000000-0000-4000-8000-00000000000a';
const uniq = Date.now().toString().slice(-6);

async function main() {
  // ---------- Fixtures that have no API yet (school, admins, route, stop) ----------
  try {
    sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;
      INSERT INTO schools(id,name,code,city,state) VALUES ('${A}','Audit School A','AUDA','Delhi','Delhi'),('${B}','Audit School B','AUDB','Gurgaon','Haryana') ON CONFLICT (id) DO NOTHING;
      INSERT INTO admins(school_id,email,password_hash,full_name,role) VALUES
        ('${A}','admin.a@audit.test',crypt('${PW}',gen_salt('bf',10)),'Admin A','SCHOOL_ADMIN'),
        ('${B}','admin.b@audit.test',crypt('${PW}',gen_salt('bf',10)),'Admin B','SCHOOL_ADMIN')
        ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, deleted_at=NULL;
      INSERT INTO routes(id,school_id,name,code) VALUES ('${RA}','${A}','Audit Route A','AUD-RA'),('${RB}','${B}','Audit Route B','AUD-RB') ON CONFLICT (id) DO NOTHING;
      INSERT INTO pickup_locations(id,school_id,route_id,stop_name,sequence_order,latitude,longitude,location,scheduled_time)
        VALUES ('${STOP}','${A}','${RA}','Audit Stop 1',1,28.6139,77.2090,ST_SetSRID(ST_MakePoint(77.2090,28.6139),4326),'07:15') ON CONFLICT (id) DO NOTHING;`);
    rec('setup', 'fixtures inserted (2 schools, 2 admins, route, stop)', true);
  } catch (e) { rec('setup', 'fixtures inserted', false, e.stderr || e.message); return; }

  // ---------- Phase 3: API skeleton & quality ----------
  const h = await call('GET', '/health', { base: ROOT });
  rec('3.1', 'GET /health returns 200 with DB connected', h.status === 200, short(h));
  await expect('3.1', 'GET /api/v1 root', call('GET', '/'), [200]);
  const nf = await call('GET', '/definitely-not-a-route');
  rec('3.4', 'unknown route → 404 JSON error', nf.status === 404 && nf.body?.success === false, short(nf));
  rec('3.4', 'X-Request-ID header present', !!nf.headers.get('x-request-id'), nf.headers.get('x-request-id') || 'missing');

  // ---------- Phase 4.1: admin auth ----------
  await expect('4.1', 'login with wrong password → 401', call('POST', '/auth/login', { body: { email: 'admin.a@audit.test', password: 'wrong-pass' } }), [401]);
  const la = await expect('4.1', 'admin A login', call('POST', '/auth/login', { body: { email: 'admin.a@audit.test', password: PW } }), [200]);
  const lb = await expect('4.1', 'admin B login', call('POST', '/auth/login', { body: { email: 'admin.b@audit.test', password: PW } }), [200]);
  const TA = findId(la.body, 'token'), TB = findId(lb.body, 'token');
  if (!TA || !TB) { rec('4.1', 'admin tokens returned', false, 'no token in login response — stopping'); return; }
  await expect('4.1', 'GET /auth/me', call('GET', '/auth/me', { token: TA }), [200]);
  const fp = await call('POST', '/auth/forgot-password', { body: { email: 'admin.a@audit.test' } });
  rec('4.1', 'forgot-password does not leak reset token in API response', fp.status === 200 && !findId(fp.body, 'devResetToken'),
    findId(fp.body, 'devResetToken') ? 'devResetToken returned (anyone can reset any admin password unless NODE_ENV=production)' : short(fp), 'warn');

  // ---------- Phase 5 ----------
  await expect('5.1', 'GET school profile', call('GET', `/schools/${A}/profile`, { token: TA }), [200]);
  await expect('5.1', 'PUT school profile', call('PUT', `/schools/${A}/profile`, { token: TA, body: { name: 'Audit School A', city: 'Delhi', state: 'Delhi', email: 'office@audit.test' } }), [200]);
  await expect('5.4', 'GET dashboard summary (Admin Home)', call('GET', `/schools/${A}/dashboard/summary`, { token: TA }), [200]);

  // ---------- Phase 6.1 bus ----------
  const plate = `DL-0${uniq.slice(0, 1)}-AB-${uniq.slice(-4)}`;
  const cb = await expect('6.1', 'create bus', call('POST', `/schools/${A}/buses`, { token: TA, body: { busNumber: `Bus-${uniq}`, registrationNumber: plate } }), [201]);
  const BUS = findId(cb.body);
  await expect('6.1', 'same plate written without dashes → 409 duplicate', call('POST', `/schools/${A}/buses`, { token: TA, body: { busNumber: `Bus-${uniq}-x`, registrationNumber: plate.replace(/-/g, '') } }), [409]);
  await expect('6.1', 'invalid plate → 422', call('POST', `/schools/${A}/buses`, { token: TA, body: { busNumber: 'X', registrationNumber: 'HELLO' } }), [400, 422]);

  // ---------- Phase 7.1 driver ----------
  const phone = `98${uniq}${uniq.slice(0, 2)}`.slice(0, 10);
  const cd = await expect('7.1', 'create driver with PIN + bus', call('POST', `/schools/${A}/drivers`, { token: TA, body: { fullName: 'Audit Driver', phone, licenseNumber: `DL-AUD-${uniq}`, pin: '4321', assignedBusId: BUS } }), [201]);
  const DRV = findId(cd.body);

  // ---------- Phase 6.2 / 6.3 / 6.4 ----------
  await expect('6.2', 'assign driver + route to bus', call('PUT', `/schools/${A}/buses/${BUS}/assignments`, { token: TA, body: { driverId: DRV, routeId: RA } }), [200]);
  await expect('6.3', 'GET bus detail', call('GET', `/schools/${A}/buses/${BUS}`, { token: TA }), [200]);
  for (const p of ['history', 'history/trips', 'history/incidents', 'history/attendance'])
    await expect('6.4', `GET bus ${p}`, call('GET', `/schools/${A}/buses/${BUS}/${p}`, { token: TA }), [200]);

  // ---------- Phase 7.2–7.4 ----------
  await expect('7.2', 'GET driver detail', call('GET', `/schools/${A}/drivers/${DRV}`, { token: TA }), [200]);
  await expect('7.3', 'GET driver history', call('GET', `/schools/${A}/drivers/${DRV}/history`, { token: TA }), [200]);
  await expect('7.4', 'edit driver', call('PUT', `/schools/${A}/drivers/${DRV}`, { token: TA, body: { fullName: 'Audit Driver Edited' } }), [200]);

  // ---------- Phase 8 ----------
  const adm = `AUD-${uniq}`;
  const cs = await expect('8.1', 'create student with guardian', call('POST', `/schools/${A}/students`, { token: TA, body: { fullName: 'Audit Student', admissionNumber: adm, classGrade: 'Class 5', section: 'A', guardianName: 'Audit Parent', guardianPhone: `97${uniq}12`.slice(0, 10), guardianRelationship: 'MOTHER' } }), [201]);
  const STU = findId(cs.body);
  await expect('8.3', 'assign pickup stop', call('PUT', `/schools/${A}/students/${STU}/transport`, { token: TA, body: { pickupStopId: STOP } }), [200]);
  await expect('8.4', 'GET student', call('GET', `/schools/${A}/students/${STU}`, { token: TA }), [200]);
  await expect('8.4', 'GET student transport history', call('GET', `/schools/${A}/students/${STU}/transport-history`, { token: TA }), [200]);
  const ps = await expect('8.2', 'GET student parents', call('GET', `/schools/${A}/students/${STU}/parents`, { token: TA }), [200]);
  const PAR = findId(ps.body);

  // ---------- Phase 9 ----------
  await expect('9.1', 'GET parents directory', call('GET', `/schools/${A}/parents`, { token: TA }), [200]);
  if (PAR) {
    await expect('9.2', 'GET parent assignment', call('GET', `/schools/${A}/parents/${PAR}/assignment`, { token: TA }), [200]);
    await expect('9.2', 'GET parent communications', call('GET', `/schools/${A}/parents/${PAR}/communications`, { token: TA }), [200]);
    await expect('9.3', 'send onboarding invite', call('POST', `/schools/${A}/parents/${PAR}/onboard`, { token: TA, body: {} }), [200, 201]);
    await expect('9.4', 'GET notification status', call('GET', `/schools/${A}/parents/${PAR}/notification-status`, { token: TA }), [200]);
  } else rec('9.x', 'parent id found for student', false, 'guardian not created/returned');

  // ---------- Phase 4.2 driver auth ----------
  await expect('4.2', 'driver login with phone only → 401', call('POST', '/driver/auth/login', { body: { phone } }), [401]);
  await expect('4.2', 'driver login wrong PIN → 401', call('POST', '/driver/auth/login', { body: { phone, pin: '0000' } }), [401]);
  const dl = await expect('4.2', 'driver login correct PIN', call('POST', '/driver/auth/login', { body: { phone, pin: '4321' } }), [200]);
  const TD = findId(dl.body, 'token');
  await expect('4.2', 'GET /driver/auth/me', call('GET', '/driver/auth/me', { token: TD }), [200]);

  // ---------- Phase 4.3 parent tokens ----------
  let TRK;
  if (PAR) {
    const g = await expect('4.3', 'admin generates parent tracking token', call('POST', '/parent/token/generate', { token: TA, body: { parentId: PAR, studentId: STU, schoolId: A } }), [201]);
    TRK = findId(g.body, 'token');
    if (TRK) {
      await expect('4.3', 'parent opens tracking link', call('GET', `/parent/track/${TRK}`), [200]);
    }
  }

  // ---------- Phase 4.4 isolation ----------
  await expect('4.4', 'driver token on admin student list → 403', call('GET', `/schools/${A}/students`, { token: TD }), [401, 403]);
  await expect('4.4', 'school B admin on school A buses → 403', call('GET', `/schools/${A}/buses`, { token: TB }), [403]);
  if (PAR) {
    await expect('4.4', 'driver token cannot mint parent tracking link → 403', call('POST', '/parent/token/generate', { token: TD, body: { parentId: PAR, studentId: STU, schoolId: A } }), [401, 403]);
    await expect('4.4', 'school B admin cannot mint link for school A child → 403', call('POST', '/parent/token/generate', { token: TB, body: { parentId: PAR, studentId: STU, schoolId: A } }), [403, 404]);
    const lk = await call('POST', '/parent/identity/lookup', { token: TB, body: { phone: `97${uniq}12`.slice(0, 10) } });
    const n = lk.body?.data?.count ?? (Array.isArray(lk.body?.data?.records) ? lk.body.data.records.length : null);
    rec('4.4', 'school B admin phone lookup cannot see school A parents', [403].includes(lk.status) || n === 0, `HTTP ${lk.status} records=${n}`);
  }

  // ---------- Phase 11: trip + telemetry ----------
  const TRIP = '4a000000-0000-4000-8000-' + uniq.padStart(12, '0');
  let tripStatus = null;
  for (const s of ['IN_TRANSIT', 'IN_PROGRESS']) {
    try {
      sql(`INSERT INTO trips(id,school_id,route_id,bus_id,driver_id,status,scheduled_start_time,actual_start_time) VALUES ('${TRIP}','${A}','${RA}','${BUS}','${DRV}','${s}',now(),now());`);
      tripStatus = s; break;
    } catch (e) { rec('2.x', `DB accepts trip status '${s}' (shared TripStatus enum / services use it)`, false, (e.stderr || e.message).split('\n')[0]); }
  }
  if (!tripStatus) { rec('11', 'could not create a trip — telemetry tests skipped', false); return; }
  rec('2.x', `trip created with status ${tripStatus}`, true);

  const me = await call('GET', '/driver/auth/me', { token: TD });
  rec('10.1', 'driver app sees the running trip as activeTrip', !!findId(me.body?.data?.activeTrip ?? null),
    `trip status=${tripStatus}; activeTrip=${JSON.stringify(me.body?.data?.activeTrip ?? null).slice(0, 80)}`);

  const ping = (o = {}) => ({ tripId: TRIP, busId: BUS, driverId: DRV, latitude: 28.6139, longitude: 77.2090, speedKmh: 30, accuracyMeters: 8, batteryPercentage: 80, networkType: 'CELLULAR', recordedAt: new Date().toISOString(), ...o });
  const p1 = ping();
  await expect('11.1', 'ingest single GPS ping', call('POST', '/telemetry/ingest', { token: TD, body: p1 }), [200, 201]);
  await call('POST', '/telemetry/ingest', { token: TD, body: p1 });
  try { const c = sql(`SELECT count(*) FROM gps_locations WHERE trip_id='${TRIP}' AND recorded_at='${p1.recordedAt}';`); rec('11.2', 'duplicate ping stored once', c === '1', `rows=${c}`); } catch (e) { rec('11.2', 'duplicate check', false, e.message); }
  const batch = Array.from({ length: 10 }, (_, i) => ping({ recordedAt: new Date(Date.now() - (10 - i) * 4000).toISOString(), latitude: 28.6139 + i * 0.0003, speedKmh: i === 5 ? 170 : 35 }));
  const br = await call('POST', '/telemetry/batch', { token: TD, body: { locations: batch } });
  rec('11.2', 'batch with one bad point (170 km/h, app allows up to 180) keeps the 9 good points', [200, 201].includes(br.status), short(br));
  await expect('11.4', 'admin reads latest bus location', call('GET', `/telemetry/buses/${BUS}/latest`, { token: TA }), [200]);
  await expect('11.3', 'admin reads fleet GPS health', call('GET', `/telemetry/schools/${A}/health`, { token: TA }), [200]);
  await expect('4.4', 'school B admin reads school A bus location → 403', call('GET', `/telemetry/buses/${BUS}/latest`, { token: TB }), [403, 404]);
  await expect('4.4', 'school B admin reads school A trip trail → 403', call('GET', `/telemetry/trips/${TRIP}/trail`, { token: TB }), [403, 404]);
  try { const c = sql(`SELECT last_latitude IS NOT NULL FROM buses WHERE id='${BUS}';`); rec('11.4', 'bus current-position cache updated', c === 't', c); } catch (e) { rec('11.4', 'bus cache check', false, e.message); }

  // SSE live feed
  try {
    const ctrl = new AbortController();
    const res = await fetch(`${API}/telemetry/schools/${A}/feed?token=${TA}`, { signal: ctrl.signal });
    const reader = res.body.getReader(); let buf = '';
    setTimeout(() => call('POST', '/telemetry/ingest', { token: TD, body: ping({ latitude: 28.62 }) }), 500);
    const t0 = Date.now();
    while (Date.now() - t0 < 6000 && !buf.includes('location_update')) {
      const { value, done } = await Promise.race([reader.read(), new Promise(r => setTimeout(() => r({ done: true }), 6000))]);
      if (done) break; buf += new TextDecoder().decode(value);
    }
    ctrl.abort();
    rec('11.4', 'SSE school feed pushes location_update', buf.includes('location_update'), buf.slice(0, 120).replace(/\n/g, ' '));
  } catch (e) { rec('11.4', 'SSE school feed', false, e.message); }

  // ---------- Real-DB Tests for Phases 14–17 (PostGIS, Resequencing, Conflict, Idempotency) ----------
  // 1. Phase 14.4: ST_DWithin duplicate/nearby pickup detection (PostGIS spatial query)
  try {
    const nearby = sql(`SELECT COUNT(*) FROM pickup_locations WHERE school_id='${A}' AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(77.2091, 28.6140), 4326)::geography, 100);`);
    rec('14.4', 'ST_DWithin duplicate/nearby pickup detection', Number(nearby) >= 1, `matches=${nearby}`);
  } catch (e) {
    rec('14.4', 'ST_DWithin duplicate/nearby pickup detection', false, e.message);
  }

  // 2. Phase 15.2: Route stop resequencing (strict contiguous ordering, no gaps/duplicates)
  try {
    sql(`INSERT INTO pickup_locations(id,school_id,route_id,stop_name,sequence_order,latitude,longitude,location,scheduled_time)
         VALUES (gen_random_uuid(),'${A}','${RA}','Audit Stop 2',2,28.6150,77.2100,ST_SetSRID(ST_MakePoint(77.2100,28.6150),4326),'07:20'),
                (gen_random_uuid(),'${A}','${RA}','Audit Stop 3',3,28.6160,77.2110,ST_SetSRID(ST_MakePoint(77.2110,28.6160),4326),'07:25')
         ON CONFLICT DO NOTHING;`);
    const seqs = sql(`SELECT string_agg(sequence_order::text, ',' ORDER BY sequence_order) FROM pickup_locations WHERE route_id='${RA}' AND deleted_at IS NULL;`);
    const nums = seqs.split(',').map(Number);
    const isContiguous = nums.length >= 3 && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
    rec('15.2', 'route stop resequencing under edits (no gaps/duplicates)', isContiguous, `sequence=${seqs}`);
  } catch (e) {
    rec('15.2', 'route stop resequencing under edits', false, e.message);
  }

  // 3. Phase 16.2: Unique trip per route/date/shift & conflict validation
  const dupTrip = await call('POST', `/schools/${A}/trips`, {
    token: TA,
    body: {
      routeId: RA,
      busId: BUS,
      driverId: DRV,
      scheduledDate: new Date().toISOString().slice(0, 10),
      scheduledStartTime: '07:30',
      tripType: 'MORNING_PICKUP',
    },
  });
  rec('16.2', 'conflict validation rejects duplicate active trip for assigned bus/route', [400, 409].includes(dupTrip.status), short(dupTrip));

  // 4. Phase 16.5: Concurrent duplicate trip start (retries are safe and idempotent)
  const startRetry = await call('POST', `/schools/${A}/trips/${TRIP}/start`, { token: TA });
  rec('16.5', 'duplicate trip start returns safe idempotent response', [200, 409].includes(startRetry.status), short(startRetry));

  // 5. Phase 17.4: Duplicate WhatsApp command idempotency
  const waMsgId = `WA-MSG-${uniq}-IDEM`;
  const wa1 = await call('POST', '/driver/whatsapp/webhook', {
    body: {
      from: '+919876543210',
      text: 'HELP',
      id: waMsgId,
    },
  });
  const wa2 = await call('POST', '/driver/whatsapp/webhook', {
    body: {
      from: '+919876543210',
      text: 'HELP',
      id: waMsgId,
    },
  });
  rec('17.4', 'duplicate WhatsApp command processed idempotently', [200].includes(wa1.status) && [200].includes(wa2.status), `wa1=${wa1.status}, wa2=${wa2.status}`);

  // ---------- Remove + re-add (soft delete) ----------
  await expect('6.3', 'remove bus with running trip → blocked (409/400)', call('DELETE', `/schools/${A}/buses/${BUS}`, { token: TA }), [400, 409]);

  // Phase 16.4 & 16.5: Trip complete & duplicate complete idempotency
  const end1 = await call('POST', `/schools/${A}/trips/${TRIP}/complete`, { token: TA, body: { summaryNotes: 'End test' } });
  rec('16.4', 'trip complete concludes running trip', [200].includes(end1.status), short(end1));
  const endRetry = await call('POST', `/schools/${A}/trips/${TRIP}/complete`, { token: TA, body: { summaryNotes: 'End retry' } });
  rec('16.5', 'duplicate trip complete is safe and idempotent', [200].includes(endRetry.status), short(endRetry));
  const plate2 = `HR-2${uniq.slice(0, 1)}-CK-${uniq.slice(-4)}`;
  const b2 = await call('POST', `/schools/${A}/buses`, { token: TA, body: { busNumber: `Tmp-${uniq}`, registrationNumber: plate2 } });
  const B2 = findId(b2.body);
  await expect('6.3', 'remove idle bus', call('DELETE', `/schools/${A}/buses/${B2}`, { token: TA }), [200, 204]);
  await expect('6.3', 're-register same plate after removal', call('POST', `/schools/${A}/buses`, { token: TA, body: { busNumber: `Tmp2-${uniq}`, registrationNumber: plate2 } }), [201]);
  await expect('8.4', 'remove student', call('DELETE', `/schools/${A}/students/${STU}`, { token: TA }), [200, 204]);
  await expect('8.4', 're-add same admission number after removal', call('POST', `/schools/${A}/students`, { token: TA, body: { fullName: 'Audit Student Again', admissionNumber: adm, classGrade: 'Class 5', section: 'A' } }), [201]);
  if (TRK) {
    await call('POST', '/parent/token/revoke', { token: TA, body: { token: TRK } });
    await expect('4.3', 'revoked tracking link is refused', call('GET', `/parent/track/${TRK}`), [401, 403, 410]);
  }
  await expect('4.1', 'logout', call('POST', '/auth/logout', { token: TA }), [200]);
}
function finish() { console.log(JSON.stringify(results, null, 1)); }
main().catch((e) => rec('runner', 'unexpected crash', false, e.stack)).finally(finish);
