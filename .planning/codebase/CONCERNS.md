# BUSLOARD — Codebase Concerns

> **Generated:** 2026-10-24  
> **Scope:** Known technical debt, security concerns, performance concerns, fragile areas, and explicitly deferred out-of-scope items.

---

## Table of Contents

1. [Technical Debt](#technical-debt)
2. [Security Concerns](#security-concerns)
3. [Performance Concerns](#performance-concerns)
4. [Fragile Areas](#fragile-areas)
5. [Out-of-Scope Items (Explicitly Deferred)](#out-of-scope-items-explicitly-deferred)

---

## Technical Debt

### TD-01 · 42 `as any` Casts in Backend TypeScript

**Severity:** Medium  
**Location:** Backend TypeScript source — controllers and middleware

The backend contains approximately **42 occurrences** of `as any` type casts, concentrated in controller request-parsing code. The primary pattern involves accessing non-standard properties on Express `Request` objects — `req.user`, `req.driver`, and `(req as any).tenantSchoolId` — without a formal typed request augmentation.

**Root cause:** Express `Request` type was never extended via declaration merging or a custom typed wrapper to carry auth/tenant context. Each controller improvises its own cast.

**Risk:** Type safety gaps mean TypeScript's compiler cannot catch incorrect property access or mismatched shapes. A renamed field or middleware reorder would produce a runtime error with no compile-time warning.

**Recommended fix:**
- Define a `TypedRequest` interface (or augment `express.Request` via `declare global`) that includes `user`, `driver`, and `tenantSchoolId` with proper typed shapes.
- Replace all `(req as any).*` usages progressively; enforce via an ESLint rule (`@typescript-eslint/no-explicit-any`).

---

### TD-02 · In-Memory ETA Cache is Process-Scoped

**Severity:** Medium (deferred until horizontal scaling)  
**Location:** `backend/src/services/eta-refresh.service.ts`

`EtaRefreshService` maintains an in-memory ETA smoothing cache. The cache is scoped to the Node.js process and is **not shared** across multiple backend instances. In a multi-instance (horizontally scaled) deployment, each process maintains its own independent ETA history, causing diverging smoothed-ETA values per instance depending on which instance serves a given SSE client.

**Documented resolution path:** _"Replace with Redis adapter behind the same interface when scaling out."_ The service interface is already abstracted — only the backing store needs swapping.

**Risk:** Non-critical at single-instance MVP scale. Becomes a correctness bug if load-balanced before Redis is wired.

---

### TD-03 · `EtaRefreshService.evictCache()` Not Called on Trip End

**Severity:** Low  
**Location:** `backend/src/services/eta-refresh.service.ts` and `TripService.endTrip()`

`TripService.endTrip()` does **not** call `EtaRefreshService.evictCache(tripId)` after completing a trip. Cache entries for ended trips accumulate until they expire naturally or the process restarts.

**Risk:** Memory leak on long-running processes with high trip throughput. No correctness impact (expired ETAs are never served), but wasted memory.

**Recommended fix:** Add `await etaRefreshService.evictCache(tripId)` as the final step in `TripService.endTrip()`, or hook it via a domain event on the `COMPLETED`/`CANCELLED` trip state transition.

---

### TD-04 · No Automated UI Tests for `school-dashboard` or `parent-web`

**Severity:** Medium  
**Location:** `school-dashboard/`, `parent-web/`

Both frontend packages have scaffold page structures but **zero automated test files**. There is no Playwright, Cypress, Vitest component, or React Testing Library coverage for any UI component or page.

**Risk:** Frontend regressions go undetected until manual QA. As the dashboard grows in complexity (fleet map, live SSE state, student attendance), untested UI becomes increasingly risky to refactor.

**Recommended fix:** Start with smoke-level Playwright E2E tests for the most critical user journeys:
- Admin: login → see fleet on map → acknowledge delay.
- Parent: open tracking link → see bus position → receive ETA.

---

### TD-05 · Storage Adapter is a Placeholder

**Severity:** Low (no feature depends on it yet)  
**Location:** `backend/src/services/storage/storage.adapter.ts`

The storage adapter interface exists but is **not wired to any cloud storage provider**. File upload capability (e.g., for incident photos, driver documents, or route attachments) is unavailable at the API level.

**Risk:** Zero functional risk until a feature requiring file upload is built. Becomes a blocker at that point.

**Recommended fix:** Wire to an S3-compatible provider (AWS S3, Cloudflare R2, MinIO for self-hosted) behind the existing abstract interface. No application code outside the adapter should change.

---

### TD-06 · `--fileParallelism=false` in Test Runner

**Severity:** Low (acceptable now, degrades with scale)  
**Location:** Test runner configuration

All **70 test files** are executed serially due to `--fileParallelism=false`. Current run time is approximately **48 seconds**, which is acceptable. However, serial execution will degrade linearly as the test suite grows.

**Risk:** Developer iteration speed. No correctness impact.

**Recommended fix:** Investigate why parallelism was disabled (likely shared DB state or port conflicts). Address root cause (e.g., per-worker schema isolation or port randomization) and re-enable parallelism to reduce CI turnaround time.

---

### TD-07 · No CI Pipeline Defined

**Severity:** High  
**Location:** `.github/` directory (workflows absent)

The `.github/` directory exists but contains **no workflow YAML files**. There is no automated CI pipeline. All test runs are manual.

**Risk:** Regressions merged without automated gate. No enforcement of lint, type-check, or test passage on pull requests. Critical for a safety-critical transport system.

**Recommended fix:** Define at minimum a `.github/workflows/ci.yml` that runs on every push/PR:
1. `tsc --noEmit` (type check)
2. ESLint
3. `pnpm test` (backend Jest suite)
4. (Optional) Playwright smoke tests against a test DB

---

## Security Concerns

### SEC-01 · `devResetToken` Exposure in Auth Responses

**Severity:** High (environment-gated, but monitor closely)  
**Location:** Auth controller

The auth controller returns a `devResetToken` in responses when `NODE_ENV=test`. This token provides a mechanism to bypass normal password reset flows for testing.

**Current guard:** Restricted to `NODE_ENV=test` only — not `development`.  
**Risk:** If a production deployment is accidentally started with `NODE_ENV=development` or if this guard is ever loosened, the token becomes exposed on a public endpoint.

**Recommended action:**
- Add a deployment checklist assertion: `NODE_ENV` must be `production` in all production environments.
- Consider removing `devResetToken` from the response entirely and using test fixtures to seed reset tokens directly in the DB for integration tests.

---

### SEC-02 · Cross-Tenant Read Risk on Telemetry GET Routes

**Severity:** Medium (historically fixed, audit ongoing)  
**Location:** Telemetry GET routes, `requireRoles` middleware

An earlier implementation lacked `requireRoles` middleware on some GET telemetry routes, creating a cross-tenant read vulnerability. This has been corrected during the security audit phase.

**Risk:** Pattern recurrence on new routes. Any new GET route that returns bus/trip/telemetry data and is written without applying `requireRoles` and tenant-scoping would reintroduce the vulnerability.

**Recommended action:**
- Treat `requireRoles(...)` as mandatory on every data route — include as a code review checklist item.
- Consider a default-deny middleware that rejects any route not explicitly decorated with a role guard.

---

### SEC-03 · JWT Token Accepted in Query String (SSE)

**Severity:** Low (acceptable for SSE, requires operational hygiene)  
**Location:** `auth.middleware.ts`

`auth.middleware.ts` accepts `?token=<jwt>` as a fallback authentication mechanism specifically to support SSE (Server-Sent Events) connections, which cannot set Authorization headers via `EventSource`.

**Risk:** Query-string tokens appear in:
- Nginx/CDN access logs
- Browser history
- Referrer headers if a link is followed

**Recommended action:**
- Ensure Nginx, CDN, and load balancer access logs are configured to **redact** the `token` query parameter.
- Consider rotating SSE tokens to short-lived, single-use tokens to minimize the window of exposure if a token is logged.

---

### SEC-04 · Parent Token in Live-Tracking URL

**Severity:** Low (same category as SEC-03)  
**Location:** Parent live-tracking URL generation

The signed parent access token is embedded directly in the live-tracking URL shared with parents (e.g., via WhatsApp). The URL is the access credential.

**Risk:** Token logged by proxies, shared inadvertently by the parent, or visible in browser history.

**Recommended action:**
- Log hygiene as per SEC-03.
- Evaluate short-lived token refresh: issue a new signed URL per trip (already expires per trip start, but confirm expiry is enforced at the API layer).
- Consider a URL-shortener redirect layer that strips the token from the final browser URL bar (optional, cosmetic).

---

### SEC-05 · WhatsApp Webhook Verification Skipped in Dev

**Severity:** Medium  
**Location:** WhatsApp adapter, `META_WA_WEBHOOK_VERIFY_TOKEN` env var

The WhatsApp mock adapter used in development skips webhook signature verification. Production requires `META_WA_WEBHOOK_VERIFY_TOKEN` to be set and verified against Meta's HMAC signature on every incoming webhook request.

**Risk:** If the production adapter is deployed without `META_WA_WEBHOOK_VERIFY_TOKEN` set, any external actor could send forged WhatsApp webhook payloads (e.g., fake parent replies, fake driver commands).

**Recommended action:**
- Add a startup assertion: if `NODE_ENV=production` and `META_WA_WEBHOOK_VERIFY_TOKEN` is empty or unset, fail fast with a clear error.
- Add to the production deployment runbook.

---

## Performance Concerns

### PERF-01 · ETA Refresh on Every GPS Ping

**Severity:** High (at scale)  
**Location:** `EtaRefreshService.scheduleRefresh()`, telemetry ingestion pipeline

`EtaRefreshService.scheduleRefresh()` is invoked after **every telemetry ping** from every bus (approximately every 5 seconds per bus). Each refresh invokes `EtaService.assembleContext()`, which issues 2–3 database queries plus a routing service call.

**Load projection:**
| Buses | Ping interval | Refresh calls/sec | DB queries/sec | Routing calls/sec |
|------:|:-------------:|:-----------------:|:--------------:|:-----------------:|
| 10    | 5 s           | 2                 | 6              | 2                 |
| 50    | 5 s           | 10                | 30             | 10                |
| 200   | 5 s           | 40                | 120            | 40                |

**Recommended fix:** Introduce a **debounce** on `scheduleRefresh()` per trip — e.g., suppress calls arriving within a 10–15 second window after a preceding refresh. At 50 buses with a 15 s debounce, routing calls drop from ~10/s to ~3.3/s.

---

### PERF-02 · PostGIS Spatial Queries — Index Coverage Unverified

**Severity:** Medium  
**Location:** Geofencing queries using `ST_DWithin`

Geofencing uses PostGIS `ST_DWithin` for proximity checks. `ST_DWithin` leverages spatial indexes (GiST on geometry columns) for performance — but only if the index exists and the query planner chooses it.

**Risk:** Missing or unused spatial index causes sequential scans at scale. For 50 buses × multiple geofences, this can cause query latency spikes during active trips.

**Recommended action:**
- Run `EXPLAIN ANALYZE` on all `ST_DWithin` queries in a staging environment with realistic data volume.
- Confirm GiST indexes exist on all geometry columns involved in geofencing (`BUSLOARD=# \d+ <table>` to verify).
- Add index verification to the pre-load-test checklist.

---

### PERF-03 · SSE Connections Held Open Per Client

**Severity:** Low for MVP, High at 10k+ clients  
**Location:** School admin fleet view, parent web live tracking

Each connected admin dashboard and parent browser holds an open SSE connection to the backend. The backend correctly sets `X-Accel-Buffering: no` for Nginx compatibility and sends a heartbeat every 20 seconds.

**Resource impact:**
| Connected clients | Open connections | Heartbeat events/min |
|:-----------------:|:----------------:|:--------------------:|
| 100               | 100              | 300                  |
| 1 000             | 1 000            | 3 000                |
| 10 000            | 10 000           | 30 000               |

Node.js handles long-lived connections well, but at 10k+ parents the memory and file-descriptor footprint becomes significant.

**Recommended action (phased):**
1. **MVP:** Current approach is acceptable.
2. **Growth:** Introduce Redis pub-sub so SSE events can be broadcast across multiple backend instances.
3. **Scale:** Evaluate a dedicated SSE/WebSocket gateway (e.g., Soketi, Centrifugo) to offload connection management from the application server.

---

### PERF-04 · No Redis / Message Broker — In-Process EventEmitter Pub-Sub

**Severity:** Medium (blocks horizontal scaling)  
**Location:** SSE event broadcasting, `EtaRefreshService`

SSE event publishing uses Node's in-process `EventEmitter`. If multiple backend instances are deployed behind a load balancer, a telemetry event processed by Instance A will **not** be broadcast to SSE clients connected to Instance B.

**Risk:** Silent data inconsistency — parents/admins connected to different instances see different bus states, or miss updates entirely.

**Recommended action:** Wire a Redis pub-sub adapter (e.g., `ioredis`) behind the existing `EventEmitter` interface before any horizontal scaling is attempted. The `EtaRefreshService` in-memory cache (TD-02) should be migrated simultaneously.

---

## Fragile Areas

### FRAG-01 · Migration 015 Constraint Drops by Exact Name

**Severity:** Medium  
**Location:** `backend/db/migrations/015_*.sql` (or equivalent)

Migration 015 drops uniqueness constraints by their **exact constraint name** as stored in `pg_constraint`. The drop statements are wrapped in a `DO $$ ... EXCEPTION WHEN ... END $$` block, meaning a name mismatch causes a **silent failure** rather than an error.

**Risk:** On a DB restored from backup, or provisioned differently, constraint names may differ. Migration 015 runs without error but leaves the old constraints in place, causing subsequent uniqueness semantics to be wrong.

**Recommended action:**
- Before running migrations in a new environment, verify constraint names: `SELECT conname FROM pg_constraint WHERE conrelid = '<table>'::regclass;`
- Consider replacing the silent exception block with a strict `IF EXISTS` check that raises a notice so the failure is visible in migration logs.

---

### FRAG-02 · Seed `ON CONFLICT` Targets Partial Unique Index

**Severity:** Low  
**Location:** Database seed scripts

Seed upserts use `ON CONFLICT ... WHERE deleted_at IS NULL` to target a partial unique index. This requires:
1. PostgreSQL 9.5+
2. The corresponding partial unique index (created in migration 015) to already exist

**Risk:** If seed runs against a DB where migration 015 has not yet been applied, the `ON CONFLICT` target will not resolve to any index and PostgreSQL will raise an error.

**Recommended action:** Enforce strict migration ordering in the seed entry point — assert that all migrations are applied before running seed data. Document this in the local dev setup guide.

---

### FRAG-03 · Driver Session Version Can Silently Reject Valid JWTs

**Severity:** Medium  
**Location:** `drivers` table (`driver_session_version` column), auth middleware

The `driver_session_version` column in the `drivers` table is used to invalidate all existing JWTs for a driver. If a session version bump occurs (e.g., on password change or admin-forced logout), any JWT issued before the bump is silently rejected by auth middleware.

**Risk:** If a session version bump fails mid-flight (e.g., DB error after JWT issuance but before version write), the driver holds a JWT that is immediately invalid and cannot authenticate — requiring manual intervention or re-login.

**Debugging note:** Version mismatch rejections may look identical to expired-token rejections in logs. Add a distinct log tag (e.g., `[SESSION_VERSION_MISMATCH]`) to make this diagnosable.

---

### FRAG-04 · Trip State Machine Not Enforced by DB Transitions

**Severity:** Medium  
**Location:** `trips` table, `chk_trips_status` CHECK constraint

Migration 015 adds `chk_trips_status` to enforce that the `status` column contains only valid values: `SCHEDULED`, `IN_TRANSIT`, `DELAYED`, `COMPLETED`, `CANCELLED`, `EMERGENCY`. However, the CHECK constraint **only validates the value**, not the transition.

**Risk:** Raw SQL (e.g., from a migration, admin tool, or future bulk-update script) can write invalid transitions such as `COMPLETED → IN_TRANSIT`. The application-layer state machine guards against this in normal flows, but the DB provides no safety net.

**Recommended action:** Either:
- Accept the risk (application-layer guard is sufficient for controlled access paths), and document that raw SQL edits to `trips.status` must follow the state machine manually.
- Or implement a PostgreSQL trigger that enforces valid transitions via an allowed-transition matrix table.

---

### FRAG-05 · Flutter Driver App Has No Automated Integration Tests

**Severity:** High (safety-critical surface)  
**Location:** `driver-app/test/`

The `driver-app/test/` directory exists but contains only the **default Flutter scaffold widget test**. The following critical components have **zero automated test coverage**:

- GPS background location service
- Offline telemetry buffering (when connectivity is lost mid-trip)
- Telemetry retry logic on reconnect
- SOS / emergency dispatch flow

**Risk:** These are the most safety-critical paths in the system. A regression in GPS reporting or SOS dispatch could go undetected until a live incident.

**Recommended action:**
- Add integration tests using `flutter_test` + `mockito` for the location service and telemetry buffer.
- Add a Flutter driver integration test (or Maestro/Patrol) for the SOS flow end-to-end on a device/emulator.
- Treat the SOS dispatch test as a **mandatory CI gate** before any driver-app release.

---

## Out-of-Scope Items (Explicitly Deferred)

The following are **not technical debt** — they are intentional product decisions deferred to future phases, as defined in `AGENTS.md`. They must not be built unless explicitly introduced in a future scope change.

| Item | Rationale |
|:-----|:----------|
| Payments, invoicing, subscriptions | Deferred to final commercial phase |
| Bus capacity / seat counting | Explicitly prohibited — managed via route/trip assignment |
| Bus active/inactive toggle | Not a concept in current model |
| Parent child-selection / multi-child switcher | Parent link is 1:1 per student token |
| Mandatory school approval for normal pickup updates | Direct verified coordinator workflow only |
| CCTV / video streaming | Out of scope |
| RFID hardware integration | Out of scope |
| Face recognition | Out of scope |
| Payroll | Out of scope |
| Heavyweight ERP features | Out of scope |

Any request to implement the above should be challenged against the current phase scope and only proceed with an explicit `AGENTS.md` update.

---

*Document maintained by the BUSLOARD planning system. Update when new concerns are identified or existing ones are resolved.*
