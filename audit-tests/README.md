# BUSLOARD audit tests — Phase 0–11

## Ek command
```bash
npm install
node audit-tests/run-report.mjs
```
Docker Desktop chalu hona chahiye. Flutter PATH pe ho toh Android build bhi check hoga.

Result: `audit-tests/report/REPORT.md` (+ raw logs `audit-tests/report/logs/`).

## Kya-kya chalta hai
| Step | File |
|---|---|
| shared build, backend + dashboard typecheck | — |
| tera existing vitest suite (mocked) | `backend/tests/*` |
| logic + route-auth unit tests | `logic.test.ts`, `route-auth.test.ts` |
| cross-layer consistency (trip status, constraints, app↔API, Android) | `consistency.test.ts` |
| fresh PostGIS DB pe saari migrations + seed | `backend/src/db/migrate.ts`, `seed.ts` |
| har service SQL query vs schema | `extract-sql.cjs` |
| DB behaviour (soft delete, dedupe, triggers) | `db-behaviour.sql` |
| **real server + real DB end-to-end** (Phase 3–11, 60+ checks, 2 schools, cross-tenant) | `e2e-smoke.mjs` |
| `next build` dashboard, `flutter analyze` + `flutter build apk` | — |

Sab green = Phase 0–11 verified.
