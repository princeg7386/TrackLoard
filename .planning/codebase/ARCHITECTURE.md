# BUSLOARD — Architecture Reference

> Last updated: 2026-10-24 | Focus: arch

---

## 1. System Overview

BUSLOARD is a **multi-tenant school bus transport safety and real-time tracking platform** built for the Indian market. It connects three distinct user groups through purpose-built interfaces:

| Actor | Interface | Primary Concern |
|---|---|---|
| **School Admin / Transport Coordinator** | Next.js dashboard (`school-dashboard/`) | Fleet oversight, exception handling, route and student management |
| **Driver** | Flutter Android app (`driver-app/`) + WhatsApp | GPS transmission, daily trip operations, SOS |
| **Parent** | Responsive web page (`parent-web/`) + WhatsApp | Live bus location, ETA, pickup confirmation |

The platform is designed around **operational safety**, **real-time telemetry**, and **strict school-level data isolation**. It deliberately excludes payments, RFID, CCTV, seat capacity constraints, and complex parent multi-child workflows.

---

## 2. Monorepo Workspace Structure

```
BUSLOARD/                        ← workspace root
├── backend/                     Node.js + Express REST API + SSE
├── shared/                      Shared Zod schemas + TypeScript types
├── school-dashboard/            Next.js 15 school admin SPA
├── parent-web/                  Next.js 15 parent live-tracking page
├── driver-app/                  Flutter Android GPS app
├── infrastructure/              Deployment scripts and config
├── audit-tests/                 Cross-cutting consistency test suite
├── docs/                        Project documentation
├── scratch/                     Developer scratch files
├── tsconfig.base.json           Shared TypeScript base config
└── package.json                 pnpm/npm workspace root
```

All TypeScript workspaces (`backend/`, `school-dashboard/`, `parent-web/`) extend `tsconfig.base.json` and share `shared/` types via workspace imports.

---

## 3. Backend Architectural Pattern

The backend follows a strict **layered architecture** inside Express. Each request traverses layers top-to-bottom; business logic is confined to services.

```
HTTP Request
     │
     ▼
┌─────────────────────────────────┐
│          Middlewares            │  auth, tenant, validation, rate-limit, error
└─────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────┐
│            Routes               │  thin HTTP routing (backend/src/routes/)
└─────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────┐
│          Controllers            │  request/response extraction (backend/src/controllers/)
└─────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────┐
│           Services              │  ALL business logic (backend/src/services/)
└─────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────┐
│    Database / Provider Adapters │  pg Pool, PostGIS, external providers
└─────────────────────────────────┘
```

### Layer Responsibilities

- **Middlewares** — Cross-cutting concerns: JWT verification, role-based access control, school-scoped tenant guards, Zod request validation, rate limiting, centralized error handling, request ID injection.
- **Routes** (`backend/src/routes/`) — Express router files, one per domain. Mount controller handlers and apply route-level middleware. No logic.
- **Controllers** (`backend/src/controllers/`) — Extract `req` parameters, call exactly one service method, format and send `res`. No SQL, no business rules.
- **Services** (`backend/src/services/`) — All domain logic: state machines, DB queries via `config/database.ts`, calls to provider adapters, event publishing. Independently testable.
- **Config** (`backend/src/config/`) — `database.ts` exposes a `pg` Pool with `query()` and `transaction()` helpers. `env.ts` provides Zod-parsed, typed environment variables.

---

## 4. Key Domain Modules

### 4.1 Authentication & Session Management

| Module | File(s) | Notes |
|---|---|---|
| School Admin Auth | `auth.service.ts` | JWT (7-day), bcrypt password hashing, login + password reset |
| Driver Auth | `driver-auth.middleware.ts`, dedicated service | Short-lived Driver JWT with **session versioning** — invalidated on logout/reassignment |
| Parent Auth | `parent-token.middleware.ts` | Time-limited signed URL/header token, scoped per student |

All three auth flows issue tokens with the school's `school_id` embedded, enforcing tenant isolation at the token level.

### 4.2 School Profile (Multi-Tenant Core)

Each school is an isolated tenant. The `schools` table is the root entity. Every domain table carries a `school_id` foreign key. Multi-tenancy is enforced at both the middleware layer (token claims) and the query layer (explicit `WHERE school_id = $1`).

### 4.3 Fleet / Bus Management

The `buses` table stores vehicle registration and maintains a **live GPS cache** (`last_latitude`, `last_longitude`, `last_speed`, `last_heading`, `last_seen_at`). This cache allows the dashboard to render current positions without querying the full `gps_locations` telemetry log.

### 4.4 Driver Directory

Driver records track credentials, assignment history, and a `session_version` integer used to invalidate JWTs when a driver is reassigned or deactivated.

### 4.5 Student & Parent Records

Students are linked to parents via the `parents` table. Parents receive a **per-student signed access token** (stored in `parent_access_tokens`) which grants time-limited read access to their child's live trip data and the parent-web tracking page. No parent app installation is required.

### 4.6 Route & Pickup Stop Management

Routes define the ordered sequence of `pickup_locations` (stops), each with:
- GPS coordinates
- A `geofence_radius_meters` for automated arrival detection
- Estimated offset times from trip start

`student_stop_assignments` maps students to their default pickup stop.

### 4.7 Trip Lifecycle State Machine

Trips are the central operational entity. The state machine enforces legal transitions:

```
SCHEDULED
    │
    ▼
IN_TRANSIT ──────────────────────────────────────────────┐
    │                                                     │
    ├─→ DELAYED (auto-detected by delay engine)          │
    │       │                                             │
    │       └─→ IN_TRANSIT (delay resolved)              │
    │                                                     │
    ├─→ ARRIVED_SCHOOL                                   │
    │       │                                             │
    │       └─→ COMPLETED                                │
    │                                                     │
    ├─→ CANCELLED                                         │
    │                                                     │
    └─→ EMERGENCY (SOS triggered, any state)  ───────────┘
```

`trip.service.ts` owns all state transitions. Illegal transitions are rejected with typed errors.

### 4.8 GPS Telemetry Ingestion

Two ingest endpoints:
- `POST /api/v1/telemetry/ingest` — single ping
- `POST /api/v1/telemetry/batch` — buffered array from Flutter app

`telemetry.service.ts` responsibilities:
1. Deduplicate pings (timestamp + sequence guard)
2. Persist to `gps_locations` table
3. Refresh `buses` live cache columns
4. Publish `LOCATION_UPDATE` event to `RealtimeFeedService`
5. Fire-and-forget schedule of ETA refresh

### 4.9 Real-Time Feed (SSE Pub-Sub)

`realtime-feed.service.ts` uses Node.js `EventEmitter` as an in-process pub-sub broker. SSE connections are held open per school and per trip.

**Channels:**
- `school:{school_id}` — all school admin subscribers
- `trip:{trip_id}` — trip-specific subscribers (parent-web)
- `bus:{bus_id}` — bus-level subscribers

**Event types published:**
- `LOCATION_UPDATE` — raw telemetry position
- `ETA_UPDATE` — recalculated stop ETAs
- `TRIP_STATUS_CHANGE` — state machine transition
- `DELAY_ALERT` — delay detected/resolved
- `SOS_ALERT` — emergency event

### 4.10 ETA Engine (Phase 20)

The ETA pipeline runs asynchronously after each telemetry ingest:

```
EtaRefreshService.scheduleRefresh(tripId)
        │
        ▼
EtaService.assembleContext(tripId)
        │   ← loads trip, bus position, remaining stops, routing snapshot
        ▼
EtaService.calculateStopEtas(context)
        │   ← calls IRoutingProvider for travel time segments
        ▼
EtaSmoothingService.smooth(rawEtas, previousEtas)
        │   ← prevents ETA jitter with exponential smoothing
        ▼
RealtimeFeedService.publish(ETA_UPDATE, smoothedEtas)
```

`eta.service.ts` and `eta-refresh.service.ts` are the primary files.

### 4.11 Geofencing & Spatial Queries

PostGIS `ST_DWithin` is used for:
- **Pickup arrival detection** — bus enters stop geofence radius → mark student as available for boarding
- **School geofence** — bus arrives at school → trigger `ARRIVED_SCHOOL` state transition
- **Deviation detection** — bus departs significantly from planned route

All spatial queries are scoped by `school_id` and use indexed geometry columns.

### 4.12 Driver WhatsApp Integration

Inbound WhatsApp webhook payloads are routed to a command parser. Supported driver commands (via WhatsApp text):
- Start Trip / End Trip
- Student Search (by name/phone)
- Report Problem
- Emergency / SOS
- Help

Replies are dispatched via `IMessagingProvider` (see Provider Adapters).

### 4.13 Dynamic Pickup

`dynamic-pickup/` service handles student stop reassignment **without mandatory school approval** for routine changes. A coordinator or driver can reassign a student to a different stop for a specific trip. Audit log entries are written for every reassignment.

### 4.14 Audit Log

All domain operations (trip state changes, reassignments, incidents, SOS events, driver logins) emit structured audit log entries to the `audit_logs` table via a shared audit service. This supports compliance, dispute resolution, and incident review.

---

## 5. Provider Adapter Pattern

All external integrations are hidden behind abstract TypeScript interfaces. Implementations are selected at startup via environment variables, enabling local development with mocks and production deployment with real providers without code changes.

```
backend/src/services/
├── routing/
│   ├── routing.provider.interface.ts   ← IRoutingProvider
│   ├── osrm.provider.ts
│   ├── valhalla.provider.ts
│   ├── google-maps.provider.ts
│   └── mock.provider.ts
├── maps/
│   ├── map.provider.interface.ts       ← IMapProvider
│   ├── osm.provider.ts
│   ├── google-maps.provider.ts
│   └── mock.provider.ts
├── messaging/
│   ├── messaging.provider.interface.ts ← IMessagingProvider
│   ├── meta-cloud-whatsapp.provider.ts
│   └── mock.provider.ts
└── storage/
    └── storage.adapter.ts              ← IStorageAdapter (placeholder)
```

| Interface | Purpose | Production Impl | Dev/Test Impl |
|---|---|---|---|
| `IRoutingProvider` | Travel time + route geometry | OSRM or Valhalla | Mock (straight-line) |
| `IMapProvider` | Geocoding, reverse geocoding | OSM Nominatim or Google Maps | Mock |
| `IMessagingProvider` | WhatsApp message send/receive | Meta Cloud API | Mock (console log) |
| `IStorageAdapter` | File/media storage | Cloud bucket (TBD) | Local filesystem mock |

---

## 6. Multi-Tenant Isolation

Tenant isolation is enforced at three independent levels:

### 6.1 Token Level
JWTs and parent tokens carry `school_id` in their claims. Tokens from school A cannot be used against school B's endpoints.

### 6.2 Middleware Level
- `requireTenantScope` — validates that the authenticated user's `school_id` matches the resource being accessed
- `requireActorTenantScope` — validates driver and parent actor claims against the school context
- Both middlewares live in `backend/src/middlewares/tenant-isolation.middleware.ts`

### 6.3 Query Level
Every database query that accesses a school-scoped entity includes an explicit `WHERE school_id = $1` clause. Services receive `schoolId` as a typed parameter. There are no cross-tenant joins.

---

## 7. Real-Time Data Flow (End-to-End)

```
┌────────────────────┐
│  Driver App        │  Flutter background location service
│  (Flutter Android) │  → batches GPS pings every N seconds
└────────┬───────────┘
         │ POST /api/v1/telemetry/ingest  (or /batch)
         ▼
┌────────────────────┐
│  TelemetryService  │  dedup → persist gps_locations
│  (backend)         │  → refresh buses.last_* cache
└────────┬───────────┘
         │ RealtimeFeedService.publish(LOCATION_UPDATE)
         ▼
┌────────────────────┐         ┌──────────────────────────┐
│  SSE Subscribers   │◄────────┤  school-dashboard (admin) │
│  (EventEmitter)    │         │  parent-web (parent)      │
└────────┬───────────┘         └──────────────────────────┘
         │ EtaRefreshService.scheduleRefresh() [fire-and-forget]
         ▼
┌────────────────────┐
│  EtaService        │  assembleContext → calculateStopEtas
│                    │  → EtaSmoothingService.smooth()
└────────┬───────────┘
         │ RealtimeFeedService.publish(ETA_UPDATE)
         ▼
┌────────────────────┐
│  SSE Subscribers   │  → admin dashboard updates ETA columns
│                    │  → parent-web updates "Bus arrives in X min"
└────────────────────┘
```

---

## 8. Authentication Flows

### School Admin Login
```
POST /api/v1/auth/login
  → validate credentials (bcrypt)
  → issue JWT { school_id, user_id, role } expires 7d
  → school-dashboard stores in httpOnly cookie / memory
```

### Driver Login
```
POST /api/v1/driver-auth/login
  → validate credentials (bcrypt)
  → check session_version matches drivers table
  → issue Driver JWT { school_id, driver_id, session_version }
  → driver-app stores securely
```

### Parent Access
```
Parent receives WhatsApp link containing signed token
  → token encodes { school_id, student_id, trip_id, expires_at }
  → parent-web validates via parent-token.middleware.ts
  → read-only access to live trip for that student only
```

---

## 9. Database Schema

The schema is built via 17 numbered SQL migration files under `backend/src/db/migrations/`. Migrations are applied sequentially by `backend/src/db/migrate.ts`.

### Core Entity Groups

| Group | Tables |
|---|---|
| **Multi-tenant Core** | `schools`, `users` |
| **Fleet** | `buses` (with live GPS cache columns) |
| **Personnel** | `drivers` (session versioning), `parents` |
| **Students** | `students` |
| **Transport** | `routes`, `pickup_locations`, `student_stop_assignments` |
| **Operations** | `trips`, `trip_attendance` |
| **Telemetry** | `gps_locations` |
| **Safety** | `incidents`, `delays`, `sos_events` |
| **Comms** | `notifications` |
| **Access** | `parent_access_tokens` |
| **Compliance** | `audit_logs` |

### PostGIS Usage
- `pickup_locations.geom` — `GEOMETRY(Point, 4326)`
- `gps_locations.geom` — `GEOMETRY(Point, 4326)`, indexed
- Spatial index: `CREATE INDEX ... USING GIST(geom)`

### Migration Progression (001–017)
1–3: Core entities (schools, users, buses, drivers, students, parents)  
4–6: Transport entities (routes, pickup_locations, student_stop_assignments)  
7–9: Operations (trips, gps_locations, incidents, delays, sos_events, notifications)  
10–12: Soft-deletes, auth tokens, parent access tokens  
13–15: GPS telemetry extensions, trip attendance, audit logs  
16–17: ETA smoothing cache, geofencing configuration columns

---

## 10. Frontend Architecture

### school-dashboard (Next.js 15, App Router)

- **`app/admin/`** — protected area requiring admin JWT cookie
- **`app/track/`** — public-accessible parent tracking page (token-gated at API level)
- **`components/`** — domain-scoped UI components (buses, drivers, students, routes, trips, safety, reports)
- Data fetching: React Server Components for initial load, client-side SSE subscription for live updates
- Map rendering: Leaflet / MapLibre GL on operational canvas (not decorative)
- State: React context + `useReducer` for live feed state; React Query / SWR for REST data

### parent-web (Next.js 15, App Router)

- Single-page live tracking experience
- Token from URL param → API validates → SSE subscription opened
- Shows bus position on map, current ETA, trip status
- WhatsApp deep-link for parent support channel

### driver-app (Flutter Android)

- Background location service runs independently of app foreground state
- Battery-efficient telemetry batching
- Minimal UI: splash → permissions check → login → home (active trip card, status bar, sync indicator)
- WhatsApp handles daily command interactions (Start/End Trip, SOS, etc.)

---

## 11. Cross-Cutting Concerns

| Concern | Mechanism |
|---|---|
| **Error Handling** | Typed error classes in `error.middleware.ts`; all errors funnel to centralized handler |
| **Request Tracing** | `X-Request-ID` injected by `request-id.middleware.ts`, logged on every request |
| **Rate Limiting** | `rate-limiter.middleware.ts` using `express-rate-limit` |
| **Input Validation** | Zod schemas in `shared/` + `validate.middleware.ts` |
| **Logging** | Structured JSON logs (pino or equivalent), includes `request_id`, `school_id`, `actor_id` |
| **Graceful Shutdown** | `backend/src/index.ts` handles SIGTERM — drains SSE connections, closes DB pool |
| **Consistency Tests** | `audit-tests/` runs cross-cutting assertions (e.g. every route has auth middleware, every service logs audit events) |
