# Master Feature Registry & Scope Lock

> **Last Updated:** 2026-10-17 — Phases 0–18.1 all verified.  
> **Test Suite:** **524 backend Vitest tests across 61 files (all passing) + 26 consistency tests + 25 audit unit tests + 70+ real-DB Docker E2E checks.**  
> **Database:** PostgreSQL 16 + PostGIS 3.4 (`postgis/postgis:16-3.4`).  
> **Detailed Evidence:** See [docs/phase-audit-12-18.md](./phase-audit-12-18.md).

| Feature / Phase ID | Category | Domain / Subsystem | Feature Name & Description | Dependencies | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Phase 0** | Supporting | Project Control | **Scope Exclusions & Guardrails**: Formal lock preventing billing, RFID, CCTV, iOS driver, ERP bloat. Master scope register, architecture and quality gates. | None | **Done** |
| **Phase 1** | Core | Database & Setup | **Core & Transport Schema**: PostgreSQL 16 + PostGIS 3.4 migrations (001–003) for Schools, Admins, Drivers, Buses, Students, Parents, Routes, Stops, Trips. | Phase 0 | **Done** |
| **Phase 2** | Core | Spatial Engine | **PostGIS Spatial Location Model & Geofence Engine**: Geography geometry points, GIST indexing, ST_DWithin/ST_Distance calculations, SpatialService. | Phase 1 | **Done** |
| **Phase 3** | Core | Backend Foundation | **API Skeleton & Infrastructure**: Express app factory, Zod validation, request ID tracking, centralized error handling, and /health diagnostics. | Phase 2 | **Done** |
| **Phase 4** | Security | Auth & Isolation | **Multi-Tenant RBAC, Driver Auth & Parent Token Engine**: Admin auth, Driver PIN auth, session version revocation, cryptographically secure parent tracking tokens, school tenant isolation. | Phase 3 | **Done** |
| **Phase 5** | Core | School Admin | **School Profile & Dashboard Shell**: School profile settings, operational dashboard summary, metrics, and 7-state UI. | Phase 4 | **Done** |
| **Phase 6** | Core | Fleet Management | **Bus Directory & Management**: Plate validation (`DL-01-AB-1234`), atomic driver/route pairing, running trip deletion guards, history audit logs. | Phase 5 | **Done** |
| **Phase 7** | Core | Driver Management | **Driver Profile & Directory**: Verification, license info, photo upload, bus assignment, PIN login, driver JWT session versioning. | Phase 5 | **Done** |
| **Phase 8** | Core | Student Management | **Student Directory & Parent Association**: Student records, parent contact linkage, pickup-stop assignment, audit trail. | Phase 5 | **Done** |
| **Phase 9** | Core | Parent Directory | **Parent WhatsApp Directory**: Parent directory, communication history, onboarding invite, notification preferences. | Phase 8 | **Done** |
| **Phase 10** | Core | Driver Mobile App | **Flutter Android Driver App Foundation**: Background GPS tracking, battery optimization, SQLite offline retry queue, app lifecycle, UI status bar. | Phase 7 | **Done** |
| **Phase 11** | Core | Telemetry Pipeline | **GPS Telemetry Ingestion Pipeline**: Ingestion (`POST /telemetry/batch`), driver/bus assignment validation, stationary filter, bus position cache, real-time SSE feed, GPS health monitoring. | Phase 10 | **Done** |
| **Phase 12** | Core | Live Tracking | **Real-Time Live Tracking (12.1–12.4)**: Current bus state endpoint, SSE streams (by school/bus), school map feed canvas, tokenized parent live feed with immediate revocation and offline handling. | Phase 11 | **Done** |
| **Phase 13** | Core | Map & Routing | **Map & Routing Layer (13.1–13.4)**: MapService & RoutingService abstractions, free-first OpenStreetMap & OSRM adapters, Valhalla routing adapter, road snapping, tiered fallbacks, Google Maps commercial adapter with env key guard & usage tracker. | Phase 12 | **Done** |
| **Phase 14** | Core | Dynamic Pickup | **Dynamic Pickup Engine (14.1–14.4)**: Parent location sharing via WhatsApp, nearest road snapping, reverse geocoding, direct immediate stop assignment (no approval gate), safety checks, ST_DWithin cluster deduplication. | Phase 13 | **Done** |
| **Phase 15** | Core | Route Management | **Route Management (15.1–15.4)**: Route creation with assigned bus & driver, contiguous stop sequence management (no gaps/duplicates), route map canvas, route history & audit trail. | Phase 14 | **Done** |
| **Phase 16** | Core | Trip Engine | **Trip Engine (16.1–16.5)**: Trip state machine (`SCHEDULED`, `IN_TRANSIT`, `DELAYED`, `ARRIVED_SCHOOL`, `COMPLETED`, `CANCELLED`, `EMERGENCY`), Migration 016 (`ARRIVED_SCHOOL`), daily trip creation, conflict validation, trip start/end timestamps, tracking session activation/deactivation, attendance locking, and idempotency guards. | Phase 15 | **Done** |
| **Phase 17** | Supporting | Driver WhatsApp | **Driver WhatsApp Core (17.1–17.4)**: Driver WhatsApp operational menu (Start, End, Student Search, Report Problem, Emergency, Help), Start Trip flow, End Trip flow, error handling, command deduplication & fallback recovery. | Phase 16 | **Done** |
| **Phase 18.1** | Safety | Driver Attendance | **Driver Attendance: Registered Student List**: Assigned bus student roster query, pickup stop sequence ordering, pickup location details, parent contact, attendance badges, Flutter manifest sheet, WhatsApp text manifest formatting. | Phase 17 | **Done** |
| **Phase 18.2–18.4** | Safety | Driver Attendance | **Boarding & Drop Logging, Journey History**: Marking individual boarding/drop events, absent status, and attendance correction logs. | Phase 18.1 | **Done** |
| **Phase 19** | Supporting | Student Search | **Driver Student Search**: Quick search by name or stop via WhatsApp & driver app. Schema-validated query, ILIKE name search, stop-name filter, role-scoped result. | Phase 18.1 | **Done** |
| **Phase 20** | Core | ETA Engine | **Dynamic ETA Prediction Engine (20.1–20.3)**: Input context assembly (`EtaService.assembleContext`), per-stop ETA calculation with cumulative chaining + haversine fallback (`EtaService.calculateStopEtas`), fire-and-forget refresh on every GPS ping with exponential smoothing + jump-clamp + stopped-bus hold (`EtaRefreshService.scheduleRefresh`), `ETA_UPDATE` SSE broadcast, cache eviction on trip completion/cancellation. No new DB migrations. | Phase 13, 16 | **Done** |
| **Phase 21** | Safety | Geofencing | **Geofencing & Boundary Alerts**: Pickup geofence arrival/departure triggers, school perimeter geofence. | Phase 2, 11 | *Planned* |
| **Phase 22+** | Supporting | Parent WhatsApp | **Parent WhatsApp Bot & Notifications**: WhatsApp templates, proactive ETA updates, arrival alerts. | Phase 20, 21 | *Planned* |

---

## Verified Build State (as of 2026-10-25)

| Check | Result | Evidence |
|---|---|---|
| `npx tsc --noEmit -p backend/tsconfig.json` | ✅ Exit 0 | Clean TypeScript compile |
| `npx tsc --noEmit -p school-dashboard/tsconfig.json` | ✅ Exit 0 | Clean TypeScript compile |
| `npm test -w backend` | ✅ **782 tests, 70 files** | All passed |
| `npm run test:audit` | ✅ **25 tests** | All passed (logic + route-auth) |
| `npx tsx --test audit-tests/consistency.test.ts` | ✅ **26 tests** | All passed (5 test suites) |
| `node audit-tests/run-report.mjs` | ✅ **70+ E2E checks, 17 pipeline steps** | Real Docker PostGIS 16 + Redis |
| `flutter analyze` | ✅ 0 issues | Clean Dart code |
| GitHub `main` | ✅ Up to date | Synced & pushed to `princeg7386/TrackLoard` |

---

## Known Limitations & Architecture Alignment
1. **WhatsApp Adapter**: Currently operational via structured mock/log adapter and webhook receiver. Production Twilio/Meta Cloud API credentials plug into existing adapter interfaces without business logic changes.
2. **Trip Status Vocabulary**: Code strictly uses `IN_TRANSIT` as the single canonical running trip status (DB CHECK constraint, TypeScript enum, mobile app, dashboard). Mapping from PDF 16.1 concepts is formally documented in [docs/adr/trip-state-vocabulary.md](./adr/trip-state-vocabulary.md).
3. **Normal Pickup Approval**: By architectural rule and scope lock, normal nearest-stop pickup assignments activate immediately with zero school coordinator approval needed.
4. **Database Stack**: Production standard is strictly **PostgreSQL 16 + PostGIS 3.4** (`postgis/postgis:16-3.4`).
