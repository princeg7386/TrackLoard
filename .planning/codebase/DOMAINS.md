# BUSLOARD — Domain Module Reference

> Last updated: 2026-10-24 | Focus: domains

This document maps every product domain to its concrete backend files, HTTP route prefix, database tables, and cross-domain dependencies. Use this as the primary lookup when adding a feature, debugging a regression, or understanding data ownership.

---

## Domain Map (Quick Reference)

| # | Domain | Route Prefix | Primary Service | Primary Tables |
|---|--------|-------------|-----------------|----------------|
| 1 | [Auth & Session](#1-auth--session) | `/api/v1/auth` | `auth.service.ts` | `admins`, `password_reset_tokens` |
| 2 | [Driver Auth](#2-driver-auth) | `/api/v1/driver/auth` | `driver-auth.service.ts` | `drivers` (session_version) |
| 3 | [School Profile](#3-school-profile) | `/api/v1/schools/:id` | `school-profile.service.ts` | `schools` |
| 4 | [Fleet / Bus Management](#4-fleet--bus-management) | `/api/v1/schools/:id/buses` | `bus.service.ts` | `buses` |
| 5 | [Driver Directory](#5-driver-directory) | `/api/v1/schools/:id/drivers` | `driver.service.ts` | `drivers` |
| 6 | [Student & Parent Records](#6-student--parent-records) | `/api/v1/schools/:id/students` | `student.service.ts` | `students`, `parents`, `parent_access_tokens` |
| 7 | [Route & Stop Management](#7-route--stop-management) | `/api/v1/schools/:id/routes` | `route.service.ts` | `routes`, `pickup_locations`, `student_stop_assignments` |
| 8 | [Trip Lifecycle](#8-trip-lifecycle) | `/api/v1/schools/:id/trips` | `trip.service.ts` | `trips`, `trip_attendance` |
| 9 | [GPS Telemetry](#9-gps-telemetry) | `/api/v1/telemetry` | `telemetry.service.ts` | `gps_locations`, `buses` (live cache) |
| 10 | [Real-Time Feed (SSE)](#10-real-time-feed-sse) | *(internal pub-sub)* | `realtime-feed.service.ts` | *(none — EventEmitter)* |
| 11 | [ETA Engine](#11-eta-engine) | *(internal pipeline)* | `eta.service.ts`, `eta-refresh.service.ts` | *(reads trips, pickup_locations, gps_locations)* |
| 12 | [Geofencing & Spatial](#12-geofencing--spatial) | *(internal)* | `spatial.service.ts` | `pickup_locations` (geom), `gps_locations` (geom) |
| 13 | [Driver Attendance](#13-driver-attendance) | `/api/v1/attendance` | `driver-attendance.service.ts` | `trip_attendance` |
| 14 | [Dynamic Pickup](#14-dynamic-pickup) | `/api/v1/parent/…` | `dynamic-pickup.service.ts` | `student_stop_assignments`, `audit_logs` |
| 15 | [Parent Identity & Tracking](#15-parent-identity--tracking) | `/api/v1/parent` | `parent-identity.service.ts` | `parents`, `parent_access_tokens` |
| 16 | [Driver WhatsApp Commands](#16-driver-whatsapp-commands) | `/api/v1/driver/whatsapp` | `driver-whatsapp.service.ts` | `notifications` |
| 17 | [Routing Provider](#17-routing-provider) | `/api/v1/routing` | `routing.service.ts` | *(none — external provider)* |
| 18 | [Notifications & Messaging](#18-notifications--messaging) | *(internal dispatch)* | `messaging.service.ts` | `notifications` |
| 19 | [Dashboard Summary](#19-dashboard-summary) | `/api/v1/schools/:id/dashboard` | `dashboard.service.ts` | *(reads across domains)* |
| 20 | [Audit Log](#20-audit-log) | *(internal)* | `audit.service.ts` | `audit_logs` |

---

## 1. Auth & Session

**Actor:** School Admin / Transport Coordinator

### Files
| Layer | File |
|-------|------|
| Routes | `backend/src/routes/auth.routes.ts` |
| Controller | `backend/src/controllers/auth.controller.ts` |
| Service | `backend/src/services/auth.service.ts` |
| Middleware | `backend/src/middlewares/auth.middleware.ts` |

### HTTP Routes
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/auth/login` | Admin login — returns JWT |
| `POST` | `/api/v1/auth/logout` | Invalidate session |
| `GET` | `/api/v1/auth/me` | Get authenticated admin profile |
| `POST` | `/api/v1/auth/request-password-reset` | Request reset link |
| `POST` | `/api/v1/auth/reset-password` | Complete reset via token |
| `PUT` | `/api/v1/auth/change-password` | Change password (authenticated) |

### Database Tables
| Table | Purpose |
|-------|---------|
| `admins` | School admin credentials and profile (`school_id`, `email`, `password_hash`, `role`) |
| `password_reset_tokens` | Short-lived reset tokens (migration 005) |

### Key Behaviour
- JWT payload: `{ school_id, user_id, role }`, 7-day expiry.
- `requireRoles('SCHOOL_ADMIN', ...)` guard exported by `auth.middleware.ts` and applied on all protected routes.
- `devResetToken` returned in `NODE_ENV=test` only — see **SEC-01** in `CONCERNS.md`.

---

## 2. Driver Auth

**Actor:** Driver (Flutter app)

### Files
| Layer | File |
|-------|------|
| Routes | `backend/src/routes/driver-auth.routes.ts` |
| Controller | `backend/src/controllers/driver-auth.controller.ts` |
| Service | `backend/src/services/driver-auth.service.ts` |
| Middleware | `backend/src/middlewares/driver-auth.middleware.ts` |

### HTTP Routes
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/driver/auth/login` | Driver login — returns Driver JWT |
| `POST` | `/api/v1/driver/auth/logout` | Invalidate driver session |
| `GET` | `/api/v1/driver/auth/me` | Get driver profile |

### Database Tables
| Table | Column | Purpose |
|-------|--------|---------|
| `drivers` | `password_hash` | Bcrypt-hashed password (migration 006) |
| `drivers` | `driver_session_version` | Incremented on logout/reassignment to invalidate all prior JWTs (migration 014) |

### Key Behaviour
- Driver JWT payload: `{ school_id, driver_id, session_version }`.
- `authenticateDriver` middleware validates session version against DB — see **FRAG-03** in `CONCERNS.md`.
- `authenticateDriverOptional` used on logout (allows already-invalidated tokens to attempt logout gracefully).

---

## 3. School Profile

**Actor:** School Admin

### Files
| Layer | File |
|-------|------|
| Routes | `backend/src/routes/school-profile.routes.ts` |
| Controller | `backend/src/controllers/school-profile.controller.ts` |
| Service | `backend/src/services/school-profile.service.ts` |

### HTTP Routes
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/schools/:schoolId` | Fetch school profile |
| `PUT` | `/api/v1/schools/:schoolId` | Update school profile |

### Database Tables
| Table | Purpose |
|-------|---------|
| `schools` | Tenant root — name, code, address, timezone |

### Key Behaviour
- All other entities reference `schools.id` as their tenant anchor.
- School `code` is unique — used during tenant resolution at login.
- `timezone` defaults to `Asia/Kolkata`; used for ETA display and trip scheduling.

---

## 4. Fleet / Bus Management

**Actor:** School Admin

### Files
| Layer | File |
|-------|------|
| Routes | `backend/src/routes/bus.routes.ts` |
| Controller | `backend/src/controllers/bus.controller.ts` |
| Service | `backend/src/services/bus.service.ts` |

### HTTP Routes
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/schools/:schoolId/buses` | Create bus |
| `GET` | `/api/v1/schools/:schoolId/buses` | List all buses |
| `GET` | `/api/v1/schools/:schoolId/buses/:busId` | Get bus detail |
| `PUT` | `/api/v1/schools/:schoolId/buses/:busId` | Update bus |
| `DELETE` | `/api/v1/schools/:schoolId/buses/:busId` | Soft-delete bus |
| `GET` | `/api/v1/schools/:schoolId/buses/:busId/location` | Live GPS cache |
| `GET` | `/api/v1/schools/:schoolId/buses/:busId/telemetry` | Historical telemetry |
| `GET` | `/api/v1/schools/:schoolId/buses/live` | All buses live positions |

### Database Tables
| Table | Column | Purpose |
|-------|--------|---------|
| `buses` | `registration_number`, `model`, `year` | Vehicle identity |
| `buses` | `last_latitude`, `last_longitude`, `last_speed`, `last_heading`, `last_seen_at` | Live GPS cache (migration 013) |
| `buses` | `deleted_at` | Soft-delete (migration 004) |

### Key Behaviour
- **No capacity fields, no active/inactive toggle** — explicitly prohibited by `AGENTS.md`.
- Live GPS cache (`last_*`) updated by `TelemetryService` on every ingest — avoids querying full `gps_locations` log for fleet view.
- `deleted_at IS NULL` partial index guards upserts and list queries.

---

## 5. Driver Directory

**Actor:** School Admin

### Files
| Layer | File |
|-------|------|
| Routes | `backend/src/routes/driver.routes.ts` |
| Controller | `backend/src/controllers/driver.controller.ts` |
| Service | `backend/src/services/driver.service.ts` |

### HTTP Routes
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/schools/:schoolId/drivers` | Create driver |
| `GET` | `/api/v1/schools/:schoolId/drivers` | List drivers |
| `GET` | `/api/v1/schools/:schoolId/drivers/:driverId` | Get driver |
| `PUT` | `/api/v1/schools/:schoolId/drivers/:driverId` | Update driver |
| `DELETE` | `/api/v1/schools/:schoolId/drivers/:driverId` | Soft-delete driver |
| `POST` | `/api/v1/schools/:schoolId/drivers/:driverId/assign-bus` | Assign bus |
| `POST` | `/api/v1/schools/:schoolId/drivers/:driverId/unassign-bus` | Unassign bus |

### Database Tables
| Table | Purpose |
|-------|---------|
| `drivers` | Profile, credentials, license, WhatsApp phone, session version |

### Key Behaviour
- `(school_id, phone)` unique constraint — driver phone doubles as WhatsApp contact.
- `photo_url` added in migration 009.
- Session version incremented via `driver.service.ts` on deactivation or reassignment.

---

## 6. Student & Parent Records

**Actor:** School Admin (write), Parent (read via token)

### Files
| Layer | File |
|-------|------|
| Routes | `backend/src/routes/student.routes.ts` |
| Controller | `backend/src/controllers/student.controller.ts` |
| Service | `backend/src/services/student.service.ts` |

### HTTP Routes (selection)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/schools/:schoolId/students` | Create student |
| `GET` | `/api/v1/schools/:schoolId/students` | List students |
| `GET` | `/api/v1/schools/:schoolId/students/:studentId` | Get student |
| `PUT` | `/api/v1/schools/:schoolId/students/:studentId` | Update student |
| `DELETE` | `/api/v1/schools/:schoolId/students/:studentId` | Soft-delete student |
| `POST` | `/api/v1/schools/:schoolId/students/:studentId/parent` | Link parent |
| `DELETE` | `/api/v1/schools/:schoolId/students/:studentId/parent` | Unlink parent |
| `GET` | `/api/v1/schools/:schoolId/students/:studentId/stop` | Get assigned stop |
| `PUT` | `/api/v1/schools/:schoolId/students/:studentId/stop` | Assign stop |
| `POST` | `/api/v1/schools/:schoolId/students/:studentId/attendance` | Record attendance |

### Database Tables
| Table | Purpose |
|-------|---------|
| `students` | Student profile, `school_id`, grade, section |
| `parents` | Parent profile, WhatsApp phone |
| `parent_access_tokens` | Signed time-limited tokens for parent-web access (migration 007) |

### Key Behaviour
- Parent-student relationship is **1:1 access** (no multi-child switcher — `AGENTS.md` constraint).
- `parent_access_tokens` carry `{ school_id, student_id, trip_id, expires_at }` in signed payload.
- Parent opt-out of notifications tracked in migration 010.

---

## 7. Route & Stop Management

**Actor:** School Admin

### Files
| Layer | File |
|-------|------|
| Routes | *(embedded in student / bus routes; no dedicated `route.routes.ts` — route CRUD accessed via `/schools/:id/routes`)* |
| Controller | `backend/src/controllers/route.controller.ts` (if present) |
| Service | `backend/src/services/route.service.ts` |

### Database Tables
| Table | Purpose |
|-------|---------|
| `routes` | Route definition — `route_type` (MORNING_PICKUP, EVENING_DROP), path polyline, timing |
| `pickup_locations` | Ordered stops — `geom GEOMETRY(Point,4326)`, `geofence_radius_meters`, `sequence_order`, `estimated_offset_minutes` |
| `student_stop_assignments` | Default student-to-stop mapping (`student_id`, `pickup_location_id`) |

### Key Behaviour
- Spatial column `pickup_locations.geom` is indexed with GiST for `ST_DWithin` queries.
- `route_type` determines morning vs. evening trip direction.
- `path_polyline` stores encoded route geometry used for deviation detection.

---

## 8. Trip Lifecycle

**Actor:** School Admin (schedule / cancel), Driver (start / end via WhatsApp or app)

### Files
| Layer | File |
|-------|------|
| Routes | `backend/src/routes/trip.routes.ts` |
| Controller | `backend/src/controllers/trip.controller.ts` |
| Service | `backend/src/services/trip.service.ts` |

### HTTP Routes
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/schools/:schoolId/trips` | Schedule trip |
| `POST` | `/api/v1/schools/:schoolId/trips/:tripId/start` | Start trip → `IN_TRANSIT` |
| `POST` | `/api/v1/schools/:schoolId/trips/:tripId/end` | End trip → `COMPLETED` |
| `GET` | `/api/v1/schools/:schoolId/trips` | List trips |
| `GET` | `/api/v1/schools/:schoolId/trips/:tripId` | Get trip detail |
| `PUT` | `/api/v1/schools/:schoolId/trips/:tripId` | Update trip metadata |
| `POST` | `/api/v1/schools/:schoolId/trips/:tripId/cancel` | Cancel trip |
| `POST` | `/api/v1/schools/:schoolId/trips/:tripId/sos` | Trigger SOS / `EMERGENCY` |
| `POST` | `/api/v1/schools/:schoolId/trips/:tripId/arrived-school` | Mark bus arrived at school |
| `GET` | `/api/v1/schools/:schoolId/trips/:tripId/live` | SSE stream for this trip |

### Database Tables
| Table | Purpose |
|-------|---------|
| `trips` | State machine entity — `status` CHECK constraint (migration 015): `SCHEDULED`, `IN_TRANSIT`, `DELAYED`, `COMPLETED`, `CANCELLED`, `EMERGENCY` |
| `trip_attendance` | Per-stop, per-student boarding records (migration 017) |
| `delays` | Delay detection records linked to trip |
| `sos_events` | SOS incidents linked to trip |
| `incidents` | General incident records |

### State Machine

```
SCHEDULED ──→ IN_TRANSIT ──→ ARRIVED_SCHOOL ──→ COMPLETED
                    │
                    ├──→ DELAYED ──→ IN_TRANSIT (resolved)
                    │
                    ├──→ CANCELLED
                    │
                    └──→ EMERGENCY (any state, SOS trigger)
```

> [!WARNING]
> DB `CHECK` constraint enforces valid status _values_ but not valid _transitions_. Application-layer guard in `trip.service.ts` is the sole transition enforcer. See **FRAG-04** in `CONCERNS.md`.

---

## 9. GPS Telemetry

**Actor:** Driver App (writes), Admin / Parent (reads)

### Files
| Layer | File |
|-------|------|
| Routes | `backend/src/routes/telemetry.routes.ts` |
| Controller | `backend/src/controllers/telemetry.controller.ts` |
| Service | `backend/src/services/telemetry.service.ts` |

### HTTP Routes
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/telemetry/ingest` | Single GPS ping |
| `POST` | `/api/v1/telemetry/batch` | Batch GPS pings (offline buffer flush) |
| `GET` | `/api/v1/telemetry/:tripId/history` | Full location history for a trip |
| `GET` | `/api/v1/telemetry/:tripId/latest` | Latest position for a trip |
| `GET` | `/api/v1/telemetry/bus/:busId/history` | Bus history |
| `GET` | `/api/v1/telemetry/bus/:busId/live` | SSE for bus live position |
| `GET` | `/api/v1/telemetry/health/:tripId` | GPS signal health for trip |

### Database Tables
| Table | Column | Purpose |
|-------|--------|---------|
| `gps_locations` | `geom GEOMETRY(Point,4326)` | Telemetry store (GiST indexed) |
| `gps_locations` | `battery_level`, `network_type` | Device telemetry (migration 011) |
| `gps_locations` | `dedup_key` | Deduplication (migration 012) |
| `buses` | `last_latitude/longitude/speed/heading/seen_at` | Live cache (migration 013) |

### Ingest Pipeline (per ping)
1. Validate payload (Zod schema from `shared/`)
2. Deduplicate via `dedup_key` (sequence + timestamp)
3. Insert into `gps_locations`
4. Update `buses.last_*` live cache
5. Publish `LOCATION_UPDATE` to `RealtimeFeedService`
6. Fire-and-forget `EtaRefreshService.scheduleRefresh(tripId)`

> [!NOTE]
> Batch ingest (`/batch`) processes pings sequentially inside a DB transaction, applying the same pipeline per entry.

---

## 10. Real-Time Feed (SSE)

**Actor:** School Admin dashboard, Parent web app

### Files
| Layer | File |
|-------|------|
| Service | `backend/src/services/realtime-feed.service.ts` |
| *(no routes file — SSE endpoints live in `telemetry.routes.ts` and `trip.routes.ts`)* | |

### Channels & Events
| Channel | Subscribers | Events Published |
|---------|-------------|-----------------|
| `school:{school_id}` | Admin dashboard | `LOCATION_UPDATE`, `TRIP_STATUS_CHANGE`, `DELAY_ALERT`, `SOS_ALERT`, `ETA_UPDATE` |
| `trip:{trip_id}` | Parent web app | `LOCATION_UPDATE`, `ETA_UPDATE`, `TRIP_STATUS_CHANGE` |
| `bus:{bus_id}` | Admin bus detail view | `LOCATION_UPDATE` |

### Key Behaviour
- In-process Node.js `EventEmitter` — **not** shareable across multiple backend instances.
- SSE connections: heartbeat every 20 s, `X-Accel-Buffering: no` for Nginx.
- JWT in query string (`?token=<jwt>`) accepted as SSE auth fallback — see **SEC-03** in `CONCERNS.md`.
- Horizontal scaling requires Redis pub-sub — see **PERF-04** in `CONCERNS.md`.

---

## 11. ETA Engine

**Actor:** Internal (triggered by telemetry ingest)

### Files
| Layer | File |
|-------|------|
| Service | `backend/src/services/eta.service.ts` |
| Service | `backend/src/services/eta-refresh.service.ts` |

### Pipeline
```
EtaRefreshService.scheduleRefresh(tripId)
  → EtaService.assembleContext(tripId)        [2–3 DB queries]
  → EtaService.calculateStopEtas(context)     [IRoutingProvider call]
  → EtaSmoothingService.smooth(raw, prev)     [exponential smoothing]
  → RealtimeFeedService.publish(ETA_UPDATE)
```

### Key Behaviour
- In-memory smoothing cache is process-scoped — see **TD-02** in `CONCERNS.md`.
- `evictCache(tripId)` must be called on trip end — currently not wired — see **TD-03** in `CONCERNS.md`.
- Called on every GPS ping — throttle recommended at scale — see **PERF-01** in `CONCERNS.md`.

---

## 12. Geofencing & Spatial

**Actor:** Internal (triggered by telemetry pipeline)

### Files
| Layer | File |
|-------|------|
| Service | `backend/src/services/spatial.service.ts` |

### Spatial Queries
| Use Case | Query Pattern | Table |
|----------|---------------|-------|
| Stop arrival detection | `ST_DWithin(geom, bus_point, radius)` | `pickup_locations` |
| School arrival | `ST_DWithin(school_geom, bus_point, school_radius)` | `schools` (geom column, migration 008) |
| Route deviation | Distance from `path_polyline` | `routes` |

### Key Behaviour
- All queries scoped by `school_id` before spatial predicate.
- GiST index on `pickup_locations.geom` required for `ST_DWithin` performance — index coverage unverified under load — see **PERF-02** in `CONCERNS.md`.

---

## 13. Driver Attendance

**Actor:** Driver (marks boarding/drop), Admin (reads)

### Files
| Layer | File |
|-------|------|
| Routes | `backend/src/routes/driver-attendance.routes.ts` |
| Controller | `backend/src/controllers/driver-attendance.controller.ts` |
| Service | `backend/src/services/driver-attendance.service.ts` |

### HTTP Routes
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/attendance/:tripId` | Get attendance for trip |
| `POST` | `/api/v1/attendance/:tripId/board` | Mark student boarded |
| `POST` | `/api/v1/attendance/:tripId/drop` | Mark student dropped |
| `POST` | `/api/v1/attendance/:tripId/absent` | Mark student absent |
| `POST` | `/api/v1/attendance/:tripId/corrections` | Attendance correction (migration 017) |
| `GET` | `/api/v1/attendance/:tripId/summary` | Attendance summary |

### Database Tables
| Table | Purpose |
|-------|---------|
| `trip_attendance` | Per-student, per-trip board/drop/absent records with timestamps and corrections |

---

## 14. Dynamic Pickup

**Actor:** Admin / Coordinator (reassign student stop without school approval)

### Files
| Layer | File |
|-------|------|
| Routes | `backend/src/routes/dynamic-pickup.routes.ts` *(mounted under `/api/v1/parent`)* |
| Controller | `backend/src/controllers/dynamic-pickup.controller.ts` |
| Service | `backend/src/services/dynamic-pickup/dynamic-pickup.service.ts` |

### HTTP Routes
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/parent/pickup/request` | Request stop reassignment |
| `POST` | `/api/v1/parent/pickup/confirm` | Confirm reassignment |
| `GET` | `/api/v1/parent/pickup/history` | Reassignment history for student |
| `PUT` | `/api/v1/parent/pickup/:id` | Update pending request |
| `DELETE` | `/api/v1/parent/pickup/:id` | Cancel request |

### Database Tables
| Table | Purpose |
|-------|---------|
| `student_stop_assignments` | Updated on reassignment confirmation |
| `audit_logs` | Every reassignment creates an audit record |

### Key Behaviour
- **No mandatory school approval** — direct coordinator action (per `AGENTS.md`).
- All changes are audited; audit log entry created by `audit.service.ts`.

---

## 15. Parent Identity & Tracking

**Actor:** Parent (read-only, token-gated)

### Files
| Layer | File |
|-------|------|
| Routes | `backend/src/routes/parent-identity.routes.ts` |
| Controller | `backend/src/controllers/parent-identity.controller.ts` |
| Service | `backend/src/services/parent-identity.service.ts` |
| Middleware | `backend/src/middlewares/parent-token.middleware.ts` |

### HTTP Routes
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/parent/track/:token` | Live trip state for parent |
| `GET` | `/api/v1/parent/trip/:tripId/eta` | ETA for student's stop |
| `GET` | `/api/v1/parent/student/:studentId/status` | Student boarding status |
| `POST` | `/api/v1/parent/notify/opt-out` | Opt out of notifications |

### Database Tables
| Table | Purpose |
|-------|---------|
| `parent_access_tokens` | Signed token store — `student_id`, `trip_id`, `expires_at` |
| `parents` | Parent contact, WhatsApp phone, notification opt-out |

### Key Behaviour
- Token URL shared via WhatsApp — carries signed token in URL param — see **SEC-04** in `CONCERNS.md`.
- `parent-token.middleware.ts` validates signature and expiry.
- No parent app install required — pure browser experience.

---

## 16. Driver WhatsApp Commands

**Actor:** Driver (via WhatsApp text messages)

### Files
| Layer | File |
|-------|------|
| Routes | `backend/src/routes/driver-whatsapp.routes.ts` |
| Controller | `backend/src/controllers/driver-whatsapp.controller.ts` |
| Service | `backend/src/services/driver-whatsapp.service.ts` |

### HTTP Routes
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/driver/whatsapp/webhook` | Inbound WhatsApp message from Meta |
| `GET` | `/api/v1/driver/whatsapp/menu` | Command menu for driver |
| `POST` | `/api/v1/driver/whatsapp/start-trip` | Start trip command |
| `POST` | `/api/v1/driver/whatsapp/end-trip` | End trip command |
| `POST` | `/api/v1/driver/whatsapp/sos` | SOS command |

### Supported Commands
| WhatsApp Text | Action |
|---------------|--------|
| `START` / `START TRIP` | Start assigned trip |
| `END` / `END TRIP` | End active trip |
| `SEARCH <name>` | Student search |
| `PROBLEM <description>` | Report problem / incident |
| `SOS` | Emergency dispatch |
| `HELP` | Show command menu |

### Key Behaviour
- Webhook signature verified via `META_WA_WEBHOOK_VERIFY_TOKEN` in production (skipped in dev mock) — see **SEC-05** in `CONCERNS.md`.
- Responses dispatched via `IMessagingProvider` (Meta Cloud API in prod, mock console logger in dev).

---

## 17. Routing Provider

**Actor:** Internal (ETA engine, route planning)

### Files
| Layer | File |
|-------|------|
| Routes | `backend/src/routes/routing.routes.ts` |
| Controller | `backend/src/controllers/routing.controller.ts` |
| Service | `backend/src/services/routing/routing.service.ts` |
| Interface | `backend/src/services/routing/routing-provider.interface.ts` |
| Adapters | `osrm-routing.adapter.ts`, `valhalla-routing.adapter.ts`, `google-maps-routing.adapter.ts`, `mock-routing.adapter.ts` |

### HTTP Routes
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/routing/directions` | Get route + travel time between points |
| `POST` | `/api/v1/routing/eta` | Calculate ETA to waypoint |
| `POST` | `/api/v1/routing/snap` | Snap GPS coordinates to road network |

### Provider Selection
| `ROUTING_PROVIDER` env value | Adapter Used |
|-----------------------------|-------------|
| `osrm` | `osrm-routing.adapter.ts` |
| `valhalla` | `valhalla-routing.adapter.ts` |
| `google-maps` | `google-maps-routing.adapter.ts` |
| *(default / test)* | `mock-routing.adapter.ts` |

---

## 18. Notifications & Messaging

**Actor:** Internal (dispatched by trip and telemetry events)

### Files
| Layer | File |
|-------|------|
| Service | `backend/src/services/messaging/messaging.service.ts` |
| Interface | `backend/src/services/messaging/messaging.provider.interface.ts` *(implied)* |
| Adapters | `meta-cloud-whatsapp.adapter.ts`, `mock-messaging.adapter.ts` |

### Database Tables
| Table | Purpose |
|-------|---------|
| `notifications` | Outbound dispatch record — `channel`, `status`, `provider_message_id`, `failure_reason` |

### Trigger Points
| Event | Notification Sent |
|-------|------------------|
| Trip started | Parent: "Bus has started, ETA X min" |
| Bus entering stop geofence | Parent: "Bus is near your stop" |
| Student boarded | Parent: "Your child has boarded" |
| Delay detected | Parent: "Bus is delayed by ~X min" |
| SOS / Emergency | Admin + emergency contact alert |
| Trip completed | Parent: "Your child has arrived at school" |

---

## 19. Dashboard Summary

**Actor:** School Admin

### Files
| Layer | File |
|-------|------|
| Routes | `backend/src/routes/dashboard.routes.ts` |
| Controller | `backend/src/controllers/dashboard.controller.ts` |
| Service | `backend/src/services/dashboard.service.ts` |

### HTTP Routes
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/schools/:schoolId/dashboard/summary` | Fleet overview — active trips, buses, delays, incidents |

### Key Behaviour
- Read-only aggregation query across `trips`, `buses`, `delays`, `sos_events`.
- Powers the school-dashboard home screen fleet status cards.
- No write operations.

---

## 20. Audit Log

**Actor:** Internal (written by all mutating services)

### Files
| Layer | File |
|-------|------|
| Service | `backend/src/services/audit.service.ts` |

### Database Tables
| Table | Purpose |
|-------|---------|
| `audit_logs` | Structured event log — `actor_type`, `actor_id`, `school_id`, `action`, `entity_type`, `entity_id`, `metadata JSONB`, `created_at` |

### Events Logged (non-exhaustive)
| Action | Entity |
|--------|--------|
| `TRIP_STARTED` / `TRIP_ENDED` / `TRIP_CANCELLED` | `trips` |
| `SOS_TRIGGERED` | `sos_events` |
| `STOP_REASSIGNED` | `student_stop_assignments` |
| `DRIVER_ASSIGNED` / `DRIVER_UNASSIGNED` | `drivers` |
| `STUDENT_ATTENDANCE_CORRECTED` | `trip_attendance` |
| `ADMIN_LOGIN` | `admins` |

---

## Cross-Domain Dependency Graph

```
                    ┌──────────┐
                    │  schools │  (tenant root)
                    └────┬─────┘
           ┌─────────────┼─────────────┬──────────────┐
      ┌────▼────┐   ┌────▼────┐  ┌─────▼────┐  ┌──────▼──────┐
      │  buses  │   │ drivers │  │ students │  │   routes    │
      └────┬────┘   └────┬────┘  └─────┬────┘  └──────┬──────┘
           │             │             │               │
           └──────┬──────┘             │        ┌──────▼──────┐
                  │                    │        │pickup_locs  │
             ┌────▼────┐               │        └──────┬──────┘
             │  trips  │◄──────────────┘               │
             └────┬────┘                               │
       ┌──────────┼──────────┬──────────────┐          │
  ┌────▼────┐ ┌───▼───┐ ┌────▼────┐  ┌──────▼───┐     │
  │gps_locs │ │delays │ │sos_evts │  │trip_att. │◄────┘
  └────┬────┘ └───────┘ └─────────┘  └──────────┘
       │
  ┌────▼──────────────┐
  │RealtimeFeedService│──→ SSE → admin dashboard / parent-web
  │EtaRefreshService  │──→ ETA_UPDATE events
  └───────────────────┘
```

---

*Document maintained by the BUSLOARD planning system. Update when new domains are added or route prefixes change.*
