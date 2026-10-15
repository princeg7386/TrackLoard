// BUSLOARD Phase 0–11 verification runner. Cross-platform (Windows/macOS/Linux).
//   node audit-tests/run-report.mjs
// Needs: Node 20+, npm install done, Docker Desktop running. Flutter optional.
// Writes audit-tests/report/REPORT.md (+ raw logs in audit-tests/report/logs/).
import { spawnSync, spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'audit-tests', 'report');
const LOGS = path.join(OUT, 'logs');
fs.mkdirSync(LOGS, { recursive: true });
const isWin = process.platform === 'win32';
const PG = 'school_bus_postgis';
const DBNAME = 'audit_fresh';
const DB_URL = `postgresql://postgres:postgrespassword@localhost:5432/${DBNAME}`;
const PORT = 4100;
const steps = [];

function run(name, cmd, args, opts = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd: opts.cwd ?? ROOT, encoding: 'utf8', shell: isWin, maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 15 * 60e3, env: { ...process.env, ...opts.env }, input: opts.input });
  const log = `$ ${cmd} ${args.join(' ')}\n\n${r.stdout || ''}\n${r.stderr || ''}${r.error ? '\n' + r.error.message : ''}`;
  const file = path.join(LOGS, name.replace(/[^a-z0-9]+/gi, '_') + '.log');
  fs.writeFileSync(file, log);
  const ok = r.status === 0;
  if (!opts.silent) steps.push({ name, ok, secs: ((Date.now() - t0) / 1000).toFixed(1), log: path.relative(ROOT, file), tail: tail(log, opts.tail ?? 25) });
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  return { ok, out: (r.stdout || '') + (r.stderr || '') };
}
const tail = (s, n) => s.trim().split('\n').slice(-n).join('\n');
const psql = (sql, db = DBNAME) => spawnSync('docker', ['exec', '-i', PG, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-qtA'], { input: sql, encoding: 'utf8' });
const has = (bin) => spawnSync(isWin ? 'where' : 'which', [bin], { encoding: 'utf8' }).status === 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 1. Build & static checks ----------
run('Build shared package', 'npm', ['run', 'build', '--workspace=shared']);
run('Typecheck backend', 'npm', ['run', 'typecheck', '--workspace=backend']);
run('Typecheck school-dashboard', 'npm', ['run', 'typecheck', '--workspace=school-dashboard']);
const vt = run('Existing vitest suite (backend, mocked)', 'npx', ['vitest', 'run'], { env: { NODE_ENV: 'test' }, tail: 12, cwd: path.join(ROOT, 'backend') });
run('Audit unit tests (logic + route auth)', 'npx', ['tsx', '--test', 'audit-tests/logic.test.ts', 'audit-tests/route-auth.test.ts'], { tail: 30 });
run('Audit consistency tests (v2)', 'npx', ['tsx', '--test', 'audit-tests/consistency.test.ts'], { tail: 40 });

// ---------- 2. Database on a brand-new PostGIS ----------
run('docker compose up (PostGIS + Redis)', 'docker', ['compose', '-f', 'infrastructure/docker-compose.yml', 'up', '-d'], { tail: 8 });
let ready = false;
for (let i = 0; i < 40 && !ready; i++) { ready = spawnSync('docker', ['exec', PG, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8' }).status === 0; if (!ready) await sleep(1500); }
steps.push({ name: 'PostGIS container ready', ok: ready, secs: '-', log: '', tail: ready ? 'ready' : 'container not ready — is Docker running?' });
if (ready) {
  psql(`DROP DATABASE IF EXISTS ${DBNAME};`, 'postgres'); psql(`CREATE DATABASE ${DBNAME};`, 'postgres');
  psql('CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  run('Migrations 001→latest on fresh DB', 'npx', ['tsx', 'backend/src/db/migrate.ts'], { env: { DATABASE_URL: DB_URL } });
  run('Seed script (npm run db:seed)', 'npx', ['tsx', 'backend/src/db/seed.ts'], { env: { DATABASE_URL: DB_URL } });

  // SQL-vs-schema: PREPARE every SQL literal in backend/src
  const ex = run('Extract SQL from services', 'node', ['audit-tests/extract-sql.cjs', 'backend/src', path.join(LOGS, 'queries.json')], { silent: true });
  if (ex.ok) {
    const q = JSON.parse(fs.readFileSync(path.join(LOGS, 'queries.json'), 'utf8'));
    let s = '';
    q.forEach((x, i) => { const body = x.sql.replace(/\$\{whereSql\}/g, 'school_id = $1').replace(/\$\{[^}]+\}/g, '').trim().replace(/;\s*$/, ''); s += `\\echo @@${i}\nPREPARE p${i} AS ${body};\n`; });
    const r = spawnSync('docker', ['exec', '-i', PG, 'psql', '-U', 'postgres', '-d', DBNAME], { input: s, encoding: 'utf8', maxBuffer: 64e6 });
    let cur = null; const bad = [];
    for (const l of ((r.stdout || '') + (r.stderr || '')).split('\n')) {
      const m = l.match(/^@@(\d+)/); if (m) { cur = +m[1]; continue; }
      if (/ERROR/.test(l) && !/schema_migrations|syntax error at or near "\$"|inconsistent types|could not determine data type/.test(l)) bad.push(`${q[cur].file}:${q[cur].line}  ${l.replace(/^.*ERROR:\s*/, '')}`);
    }
    fs.writeFileSync(path.join(LOGS, 'sql_vs_schema.log'), bad.join('\n') || 'all OK');
    steps.push({ name: `SQL vs schema (${q.length} queries)`, ok: bad.length === 0, secs: '-', log: 'audit-tests/report/logs/sql_vs_schema.log', tail: bad.join('\n') || `all ${q.length} queries match the schema` });
  }
  const dbb = psql(fs.readFileSync(path.join(ROOT, 'audit-tests', 'db-behaviour.sql'), 'utf8').replace('\\set ON_ERROR_STOP 0', ''), DBNAME);
  const dbOut = ((dbb.stdout || '') + (dbb.stderr || '')).split('\n').filter((l) => /PASS|FAIL|WARN|ERROR/.test(l)).join('\n');
  fs.writeFileSync(path.join(LOGS, 'db_behaviour.log'), dbOut);
  steps.push({ name: 'DB behaviour checks', ok: !/FAIL/.test(dbOut), secs: '-', log: 'audit-tests/report/logs/db_behaviour.log', tail: dbOut });
  // db-behaviour leaves fixtures; recreate a clean DB for the E2E run
  psql(`DROP DATABASE IF EXISTS ${DBNAME};`, 'postgres'); psql(`CREATE DATABASE ${DBNAME};`, 'postgres');
  psql('CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  run('Migrations (clean DB for E2E)', 'npx', ['tsx', 'backend/src/db/migrate.ts'], { env: { DATABASE_URL: DB_URL }, silent: true });

  // ---------- 3. Real server + E2E ----------
  const logFile = fs.openSync(path.join(LOGS, 'backend_server.log'), 'w');
  const srv = spawn('npx', ['tsx', 'backend/src/index.ts'], { cwd: ROOT, shell: isWin, stdio: ['ignore', logFile, logFile], env: { ...process.env, DATABASE_URL: DB_URL, PORT: String(PORT), NODE_ENV: 'development' } });
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { try { up = (await fetch(`http://localhost:${PORT}/health`)).ok; } catch { } if (!up) await sleep(1000); }
  steps.push({ name: 'Backend server boots against fresh DB', ok: up, secs: '-', log: 'audit-tests/report/logs/backend_server.log', tail: up ? `listening on ${PORT}` : tail(fs.readFileSync(path.join(LOGS, 'backend_server.log'), 'utf8'), 20) });
  if (up) {
    const e = run('E2E smoke (real API + DB)', 'node', ['audit-tests/e2e-smoke.mjs'], { env: { API_URL: `http://localhost:${PORT}/api/v1`, SQL_CMD: `docker exec -i ${PG} psql -U postgres -d ${DBNAME} -v ON_ERROR_STOP=1 -qtA` }, silent: true });
    try {
      const rows = JSON.parse(e.out.slice(e.out.indexOf('['), e.out.lastIndexOf(']') + 1));
      fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify(rows, null, 1));
      globalThis.E2E = rows;
    } catch { steps.push({ name: 'E2E smoke (real API + DB)', ok: false, secs: '-', log: '', tail: tail(e.out, 30) }); }
  }
  if (isWin) spawnSync('taskkill', ['/pid', String(srv.pid), '/T', '/F']); else srv.kill('SIGTERM');
}

// ---------- 4. Frontend + driver app builds ----------
run('Build school-dashboard (next build)', 'npm', ['run', 'build', '--workspace=school-dashboard'], { tail: 30 });
if (has('flutter')) {
  run('Flutter pub get', 'flutter', ['pub', 'get'], { cwd: path.join(ROOT, 'driver-app'), tail: 10 });
  run('Flutter analyze', 'flutter', ['analyze'], { cwd: path.join(ROOT, 'driver-app'), tail: 30 });
  run('Flutter build apk --debug', 'flutter', ['build', 'apk', '--debug'], { cwd: path.join(ROOT, 'driver-app'), tail: 30, timeout: 30 * 60e3 });
} else steps.push({ name: 'Flutter checks', ok: null, secs: '-', log: '', tail: 'flutter not on PATH — skipped' });

// ---------- Report ----------
const icon = (ok) => (ok === null ? '⏭️' : ok ? '✅' : '❌');
let md = `# BUSLOARD Phase 0–11 verification report\n\nGenerated: ${new Date().toISOString()}  \nCommit: ${(() => { try { return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { return '?'; } })()}  \nNode: ${process.version}  OS: ${process.platform}\n\n## Pipeline\n\n| Step | Result | Time (s) |\n|---|---|---|\n`;
for (const s of steps) md += `| ${s.name} | ${icon(s.ok)} | ${s.secs} |\n`;
if (globalThis.E2E) {
  const rows = globalThis.E2E; const c = (st) => rows.filter((r) => r.status === st).length;
  md += `\n## End-to-end results (${c('PASS')} pass, ${c('FAIL')} fail, ${c('WARN')} warn)\n\n| Phase | Check | Result | Detail |\n|---|---|---|---|\n`;
  for (const r of rows) md += `| ${r.phase} | ${r.name} | ${r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '⚠️' : r.status === 'skip' ? '⏭️' : '❌'} | ${r.status === 'PASS' ? '' : r.detail.replace(/\|/g, '/').replace(/\n/g, ' ')} |\n`;
}
md += `\n## Step output (last lines)\n`;
for (const s of steps) if (!s.ok) md += `\n### ${icon(s.ok)} ${s.name}\nLog: \`${s.log}\`\n\n\`\`\`\n${s.tail}\n\`\`\`\n`;
fs.writeFileSync(path.join(OUT, 'REPORT.md'), md);
console.log(`\nReport written to ${path.relative(ROOT, path.join(OUT, 'REPORT.md'))}`);
