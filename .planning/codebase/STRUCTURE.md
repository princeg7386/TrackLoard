# BUSLOARD — Codebase Structure Reference

> Last updated: 2026-10-24 | Focus: arch

---

## 1. Repository Root Layout

```
BUSLOARD/
├── backend/                  Node.js + Express REST API + SSE real-time
├── shared/                   Shared Zod schemas + TypeScript types (workspace pkg)
├── school-dashboard/         Next.js 15 school admin dashboard SPA
├── parent-web/               Next.js 15 parent live-tracking page
├── driver-app/               Flutter Android GPS tracking app
├── infrastructure/           Deployment scripts, Docker, CI config
├── audit-tests/              Cross-cutting consistency test suite
├── tests/                    Legacy / placeholder test directory
├── docs/                     Project-level documentation
├── scratch/                  Developer scratch files (not committed to prod)
├── .env.example              Environment variable template
├── tsconfig.base.json        Shared TypeScript base configuration
└── package.json              pnpm/npm workspace root manifest
```

---

## 2. `backend/` — Node.js API

### Top-Level

```
backend/
├── src/                      All application source code
├── package.json
├── tsconfig.json             Extends tsconfig.base.json
└── .env                      Local env (gitignored)
```

### `backend/src/` — Full Layout

```
backend/src/
├── index.ts                  Entry point: HTTP server start, graceful shutdown (SIGTERM)
├── app.ts                    Express app factory: middleware mounting, CORS, Helmet, route aggregation
│
├── config/
│   ├── database.ts           pg Pool singleton, query() helper, transaction() helper
│   └── env.ts                Zod-parsed typed environment variables
│
├── middlewares/
│   ├── auth.middleware.ts           JWT verification + requireRoles() RBAC guard
│   ├── driver-auth.middleware.ts    Driver-specific JWT + session version check
│   ├── parent-token.middleware.ts   Signed parent token validation (time-limited)
│   ├── tenant-isolation.middleware.ts  requireTenantScope, requireActorTenantScope
│   ├── validate.middleware.ts       Zod schema request body/query/params validation
│   ├── rate-limiter.middleware.ts   express-rate-limit configuration
│   ├── error.middleware.ts          Centralized error handler + typed AppError classes
│   └── request-id.middleware.ts     X-Request-ID header injection
│
├── routes/
│   ├── api.routes.ts                Master aggregator — mounts all domain routers under /api/v1
│   ├── auth.routes.ts
│   ├── driver-auth.routes.ts
│   ├── school.routes.ts
│   ├── bus.routes.ts
│   ├── driver.routes.ts
│   ├── student.routes.ts
│   ├── parent.routes.ts
│   ├── route.routes.ts              (transport route, not Express route)
│   ├── trip.routes.ts
│   ├── telemetry.routes.ts
│   ├── realtime.routes.ts           SSE endpoint registration
│   ├── whatsapp.routes.ts
│   ├── dynamic-pickup.routes.ts
│   ├── incident.routes.ts
│   └── reports.routes.ts
│
├── controllers/
│   ├── auth.controller.ts
│   ├── driver-auth.controller.ts
│   ├── school.controller.ts
│   ├── bus.controller.ts
│   ├── driver.controller.ts
│   ├── student.controller.ts
│   ├── parent.controller.ts
│   ├── route.controller.ts
│   ├── trip.controller.ts
│   ├── telemetry.controller.ts
│   ├── realtime.controller.ts
│   ├── whatsapp.controller.ts
│   ├── dynamic-pickup.controller.ts
│   ├── incident.controller.ts
│   └── reports.controller.ts
│
├── services/
│   │
│   ├── routing/                     IRoutingProvider + adapters
│   │   ├── routing.provider.interface.ts
│   │   ├── osrm.provider.ts
│   │   ├── valhalla.provider.ts
│   │   ├── google-maps.provider.ts
│   │   └── mock.provider.ts
│   │
│   ├── maps/                        IMapProvider + adapters
│   │   ├── map.provider.interface.ts
│   │   ├── osm.provider.ts
│   │   ├── google-maps.provider.ts
│   │   └── mock.provider.ts
│   │
│   ├── messaging/                   IMessagingProvider + adapters
│   │   ├── messaging.provider.interface.ts
│   │   ├── meta-cloud-whatsapp.provider.ts
│   │   └── mock.provider.ts
│   │
│   ├── dynamic-pickup/              Student stop reassignment logic
│   │   └── dynamic-pickup.service.ts
│   │
│   ├── storage/                     IStorageAdapter (placeholder)
│   │   └── storage.adapter.ts
│   │
│   ├── auth.service.ts              Admin login, password reset, JWT issuance
│   ├── driver-auth.service.ts       Driver login, session version management
│   ├── school.service.ts            School profile CRUD
│   ├── bus.service.ts               Bus registration, live cache reads
│   ├── driver.service.ts            Driver directory CRUD
│   ├── student.service.ts           Student records CRUD
│   ├── parent.service.ts            Parent records, access token generation
│   ├── route.service.ts             Route + stop management
│   ├── trip.service.ts              Trip state machine, lifecycle transitions
│   ├── telemetry.service.ts         GPS ingest (single + batch), dedup, bus cache refresh
│   ├── realtime-feed.service.ts     SSE EventEmitter pub-sub broker
│   ├── eta.service.ts               ETA assembleContext + calculateStopEtas (Phase 20)
│   ├── eta-refresh.service.ts       ETA smoothing + fire-and-forget refresh scheduler (Phase 20.3)
│   ├── geofence.service.ts          PostGIS ST_DWithin geofence event detection
│   ├── delay.service.ts             Delay detection + resolution
│   ├── incident.service.ts          Incident recording + SOS dispatch
│   ├── whatsapp.service.ts          Inbound webhook parsing, command dispatch, outbound replies
│   ├── reports.service.ts           Operational report queries
│   └── audit.service.ts             Structured audit log writes
│
├── db/
│   ├── migrate.ts                   Sequential migration runner
│   ├── seed.ts                      Dev seed data (typed fixtures, no hardcoded prod data)
│   ├── migrations/
│   │   ├── 001_core_entities.sql
│   │   ├── 002_fleet.sql
│   │   ├── 003_personnel.sql
│   │   ├── 004_transport.sql
│   │   ├── 005_pickup_locations.sql
│   │   ├── 006_student_stop_assignments.sql
│   │   ├── 007_trips.sql
│   │   ├── 008_gps_locations.sql
│   │   ├── 009_safety_events.sql
│   │   ├── 010_notifications.sql
│   │   ├── 011_soft_deletes.sql
│   │   ├── 012_auth_tokens.sql
│   │   ├── 013_parent_access_tokens.sql
│   │   ├── 014_telemetry_extensions.sql
│   │   ├── 015_trip_attendance.sql
│   │   ├── 016_audit_logs.sql
│   │   └── 017_eta_geofence_config.sql
│   └── scripts/
│       └── verify-schema.ts         DB schema verification helper
│
└── utils/
    ├── id.ts                        UUID / ULID generation helpers
    ├── response.ts                  Typed API response formatters (success, error, paginated)
    ├── security.ts                  Token signing, hash helpers
    └── time.ts                      Date arithmetic, ISO formatting, IST timezone helpers
```

---

## 3. `shared/` — Shared Types & Schemas

```
shared/
├── src/
│   ├── schemas/             Zod schemas (source of truth for validation)
│   │   ├── auth.schema.ts
│   │   ├── bus.schema.ts
│   │   ├── driver.schema.ts
│   │   ├── student.schema.ts
│   │   ├── parent.schema.ts
│   │   ├── route.schema.ts
│   │   ├── trip.schema.ts
│   │   ├── telemetry.schema.ts
│   │   └── ...
│   ├── types/               TypeScript types inferred from schemas + standalone domain types
│   │   ├── trip.types.ts    TripStatus enum, TripState, TripSummary, etc.
│   │   └── ...
│   └── index.ts             Barrel export
├── package.json
└── tsconfig.json
```

Naming conventions for `shared/`:
- Zod schemas: `PascalCaseSchema` (e.g., `CreateTripSchema`)
- TypeScript types: `PascalCase` (e.g., `TripStatus`, `BusTelemetry`)
- Imported in `backend/` as `@busloard/shared` workspace reference
- Imported in `school-dashboard/` and `parent-web/` as `@busloard/shared`

---

## 4. `school-dashboard/` — Next.js 15 Admin SPA

```
school-dashboard/
├── src/
│   ├── app/                          Next.js App Router root
│   │   ├── layout.tsx                Root layout (fonts, providers, global styles)
│   │   ├── page.tsx                  Home → redirect to /admin or /login
│   │   ├── login/
│   │   │   └── page.tsx              Login page (credential form, JWT cookie set)
│   │   ├── admin/                    Protected admin area (requires auth cookie)
│   │   │   ├── layout.tsx            Admin shell: sidebar nav, topbar, SSE initializer
│   │   │   ├── page.tsx              Dashboard home (fleet summary, active trips, alerts)
│   │   │   ├── live/
│   │   │   │   └── page.tsx          Real-time fleet map (all buses, SSE LOCATION_UPDATE)
│   │   │   ├── buses/
│   │   │   │   ├── page.tsx          Bus list
│   │   │   │   └── [busId]/page.tsx  Bus detail + history
│   │   │   ├── drivers/
│   │   │   │   ├── page.tsx          Driver directory
│   │   │   │   └── [driverId]/page.tsx Driver detail
│   │   │   ├── students/
│   │   │   │   ├── page.tsx          Student records
│   │   │   │   └── [studentId]/page.tsx Student detail + stop assignment
│   │   │   ├── routes/
│   │   │   │   ├── page.tsx          Route list
│   │   │   │   └── [routeId]/page.tsx Route editor (stop sequencing, map canvas)
│   │   │   ├── trips/
│   │   │   │   ├── page.tsx          Trip list (today + history)
│   │   │   │   └── [tripId]/page.tsx Trip detail (live or completed)
│   │   │   ├── safety/
│   │   │   │   └── page.tsx          SOS events + incident log
│   │   │   ├── reports/
│   │   │   │   └── page.tsx          Operational reports
│   │   │   ├── profile/
│   │   │   │   └── page.tsx          School profile settings
│   │   │   └── account/
│   │   │       └── page.tsx          User account settings
│   │   └── track/
│   │       └── page.tsx              Parent-facing tracking page (token-gated)
│   │
│   └── components/                   Domain UI component library
│       ├── bus/                      BusCard, BusStatusBadge, BusMapMarker
│       ├── driver/                   DriverCard, DriverForm, DriverSessionStatus
│       ├── student/                  StudentCard, StudentForm, StopAssignmentPanel
│       ├── route/                    RouteEditor, StopList, StopForm, RouteMapCanvas
│       ├── trip/                     TripCard, TripStatusBadge, TripTimeline, EtaColumn
│       ├── safety/                   SosAlertBanner, IncidentCard
│       ├── reports/                  ReportTable, ExportButton
│       ├── live/                     LiveFleetMap, BusTrail, EtaFeedPanel
│       ├── layout/                   Sidebar, Topbar, PageHeader, EmptyState
│       └── shared/                   DataTable, StatusBadge, LoadingSpinner, ErrorBoundary
│
├── public/                           Static assets
├── package.json
├── tsconfig.json
└── next.config.ts
```

---

## 5. `parent-web/` — Next.js 15 Parent Live-Tracking Page

```
parent-web/
├── src/
│   ├── app/
│   │   ├── layout.tsx                Root layout (mobile-first, PWA meta)
│   │   ├── page.tsx                  Root → token validation → live tracking
│   │   └── track/
│   │       └── page.tsx              Live bus map + ETA + trip status
│   └── components/
│       ├── LiveMap.tsx               Single bus position on map
│       ├── EtaCountdown.tsx          "Bus arrives in X min"
│       ├── TripStatusBar.tsx         Trip state chip (In Transit, Delayed, etc.)
│       └── WhatsAppSupportLink.tsx   WhatsApp deep-link for parent support
├── package.json
├── tsconfig.json
└── next.config.ts
```

---

## 6. `driver-app/` — Flutter Android App

```
driver-app/
├── lib/
│   ├── main.dart                     App entry: provider wiring, MaterialApp
│   │
│   ├── core/
│   │   ├── constants/
│   │   │   └── api_endpoints.dart    All API base URLs and path constants
│   │   ├── theme/
│   │   │   └── app_theme.dart        MaterialTheme (brand accent, status colors)
│   │   └── utils/
│   │       ├── formatters.dart       Date, distance, ETA formatting
│   │       └── retry_helper.dart     Exponential backoff for network calls
│   │
│   ├── models/
│   │   ├── trip.dart                 TripModel, TripStatus enum
│   │   ├── student.dart              StudentModel, AttendanceState
│   │   ├── attendance.dart           AttendanceRecord
│   │   ├── device_status.dart        BatteryLevel, GpsAccuracy, NetworkType
│   │   ├── telemetry_batch.dart      TelemetryBatch payload model
│   │   ├── sos_event.dart            SosPayload model
│   │   └── driver_profile.dart       DriverProfile model
│   │
│   ├── screens/
│   │   ├── splash_screen.dart        App init, auth check, redirect
│   │   ├── login_screen.dart         Driver credential login form
│   │   ├── permissions_screen.dart   Location + notification permission request
│   │   └── home_screen.dart          Main operational screen (active trip card + controls)
│   │
│   ├── services/
│   │   ├── location_service.dart     Background GPS collection (Geolocator / foreground service)
│   │   ├── telemetry_upload_service.dart  Batch upload scheduler + retry logic
│   │   ├── auth_service.dart         Driver login, JWT storage (FlutterSecureStorage)
│   │   ├── trip_service.dart         Trip fetch, start/end operations
│   │   ├── attendance_service.dart   Student boarding/drop mark
│   │   ├── gps_health_service.dart   GPS accuracy monitoring, satellite count
│   │   ├── connectivity_service.dart Network type detection, offline queue
│   │   └── sos_service.dart          SOS trigger, emergency payload dispatch
│   │
│   └── widgets/
│       ├── active_trip_card.dart     Trip summary: route, student count, status
│       ├── status_bar.dart           GPS accuracy, battery, connectivity indicators
│       └── sync_indicator.dart       Pending telemetry upload count badge
│
├── android/                          Android-specific config (manifest, gradle)
├── pubspec.yaml                      Flutter dependencies
└── README.md
```

---

## 7. `infrastructure/` — Deployment

```
infrastructure/
├── docker/
│   ├── docker-compose.yml            Local dev: postgres+postgis, backend, dashboards
│   └── Dockerfile.backend
├── scripts/
│   ├── deploy.sh                     Production deploy script
│   └── db-backup.sh                  PostgreSQL backup helper
└── nginx/
    └── nginx.conf                    Reverse proxy config (API, dashboards, parent-web)
```

---

## 8. `audit-tests/` — Cross-Cutting Consistency Tests

```
audit-tests/
├── route-auth-coverage.test.ts       Asserts every route file applies auth middleware
├── service-audit-coverage.test.ts    Asserts every mutating service method writes audit log
├── tenant-isolation.test.ts          Asserts every DB query includes school_id filter
└── schema-sync.test.ts               Asserts shared/ schemas match DB migration column sets
```

---

## 9. Naming Conventions

### Backend (TypeScript)

| Artifact | Convention | Example |
|---|---|---|
| Service files | `kebab-case.service.ts` | `trip.service.ts`, `eta-refresh.service.ts` |
| Controller files | `kebab-case.controller.ts` | `trip.controller.ts` |
| Route files | `kebab-case.routes.ts` | `trip.routes.ts` |
| Middleware files | `kebab-case.middleware.ts` | `tenant-isolation.middleware.ts` |
| Provider interfaces | `kebab-case.provider.interface.ts` | `routing.provider.interface.ts` |
| Provider implementations | `name.provider.ts` | `osrm.provider.ts` |
| DB migrations | `NNN_description.sql` (zero-padded 3 digits) | `007_trips.sql` |
| DB tables | `snake_case`, plural | `trip_attendance`, `pickup_locations` |

### Shared (Zod + TypeScript)

| Artifact | Convention | Example |
|---|---|---|
| Zod schemas | `PascalCaseSchema` | `CreateTripSchema`, `BusTelemetrySchema` |
| TypeScript types | `PascalCase` | `TripStatus`, `BusTelemetry`, `PickupLocation` |
| Enum values | `SCREAMING_SNAKE_CASE` | `TripStatus.IN_TRANSIT`, `TripStatus.EMERGENCY` |

### Flutter (Dart)

| Artifact | Convention | Example |
|---|---|---|
| Source files | `snake_case.dart` | `trip_service.dart`, `active_trip_card.dart` |
| Classes | `PascalCase` | `TripService`, `ActiveTripCard` |
| Enums | `PascalCase` (values: `camelCase`) | `TripStatus.inTransit` |

### Next.js (App Router)

| Artifact | Convention | Example |
|---|---|---|
| Page files | `page.tsx` (App Router convention) | `app/admin/trips/page.tsx` |
| Layout files | `layout.tsx` | `app/admin/layout.tsx` |
| Components | `PascalCase.tsx` | `TripCard.tsx`, `LiveFleetMap.tsx` |
| Component dirs | `kebab-case/` or domain noun | `components/live/`, `components/trip/` |

---

## 10. Key File Cross-Reference

| Concern | File(s) |
|---|---|
| Server bootstrap | `backend/src/index.ts` |
| Express app setup | `backend/src/app.ts` |
| All API routes mounted | `backend/src/routes/api.routes.ts` |
| DB pool + helpers | `backend/src/config/database.ts` |
| Env parsing | `backend/src/config/env.ts` |
| JWT auth guard | `backend/src/middlewares/auth.middleware.ts` |
| Tenant isolation | `backend/src/middlewares/tenant-isolation.middleware.ts` |
| Request validation | `backend/src/middlewares/validate.middleware.ts` |
| Error handling | `backend/src/middlewares/error.middleware.ts` |
| Trip state machine | `backend/src/services/trip.service.ts` |
| GPS ingest | `backend/src/services/telemetry.service.ts` |
| SSE pub-sub | `backend/src/services/realtime-feed.service.ts` |
| ETA calculation | `backend/src/services/eta.service.ts` |
| ETA refresh + smoothing | `backend/src/services/eta-refresh.service.ts` |
| Geofencing | `backend/src/services/geofence.service.ts` |
| Audit log writes | `backend/src/services/audit.service.ts` |
| WhatsApp integration | `backend/src/services/whatsapp.service.ts` |
| Migration runner | `backend/src/db/migrate.ts` |
| Flutter entry | `driver-app/lib/main.dart` |
| Flutter background GPS | `driver-app/lib/services/location_service.dart` |
| Flutter telemetry upload | `driver-app/lib/services/telemetry_upload_service.dart` |
| Admin dashboard root | `school-dashboard/src/app/admin/layout.tsx` |
| Live fleet map | `school-dashboard/src/app/admin/live/page.tsx` |
| Parent tracking page | `parent-web/src/app/track/page.tsx` |
