# TrackLoard — Repository Inventory & Component Manifest

- **Audit Identifier:** `audit-20261025-153605`
- **Repository Name:** `school-bus-tracking-platform` (`TrackLoard`)
- **Workspace Architecture:** npm Monorepo (`workspaces: ["backend", "school-dashboard", "parent-web", "shared"]`) + Flutter Android Client (`driver-app`)

---

## 1. Directory Tree & Monorepo Layout

```
BUSLOARD/
├── package.json                         # Root package manifest & workspace coordinator
├── package-lock.json                    # Monorepo dependency lockfile
├── audit-tests/                         # Audit test suites & verification runners
│   ├── consistency.test.ts              # Cross-layer vocabulary & schema consistency
│   ├── logic.test.ts                    # Business logic & secrets protection tests
│   ├── route-auth.test.ts               # Static route authorization scanner
│   ├── e2e-smoke.mjs                    # End-to-end integration test runner
│   └── run-report.mjs                   # JSON audit reporter
├── backend/                             # Core Express + TypeScript REST/SSE API
│   ├── src/
│   │   ├── config/                      # Database (pg pool) and environment (Zod)
│   │   ├── controllers/                 # HTTP controllers (15 domain controllers)
│   │   ├── db/                          # Migrations (001–021) and seed scripts
│   │   ├── middlewares/                 # Auth, tenant isolation, rate limiter, error
│   │   ├── routes/                      # Express routers (17 route files, 94 endpoints)
│   │   ├── services/                    # Domain logic & provider adapters (25 services)
│   │   └── utils/                       # Security, crypto, spatial & phone utilities
│   ├── tests/                           # Vitest test suite (83 test files, 928 tests)
│   └── package.json                     # Backend dependencies & test scripts
├── driver-app/                          # Lightweight Flutter Android Driver Client
│   ├── lib/
│   │   ├── config/                      # API constants, theme, and environment
│   │   ├── models/                      # Telemetry point, trip, and student models
│   │   ├── screens/                     # Live trip HUD, student checklist, SOS
│   │   ├── services/                    # Background GPS, battery, SQLite queue, HTTP
│   │   └── main.dart                    # Application entry point
│   ├── android/                         # Native Android Gradle wrapper & Manifest
│   ├── pubspec.yaml                     # Flutter & Dart dependencies
│   └── test/                            # Flutter widget & unit tests
├── parent-web/                          # Mobile-First Parent Live Web App (Next.js 15)
│   ├── src/
│   │   └── app/                         # App Router (`/` and `/track?token=...`)
│   │   └── components/                  # Live bus marker, route canvas, ETA banner
│   ├── package.json                     # Next.js 15, React 19, Tailwind CSS
│   └── tsconfig.json
├── school-dashboard/                    # School Administrator Operational Dashboard
│   ├── src/
│   │   └── app/                         # App Router (17 pages: buses, drivers, routes...)
│   │   └── components/                  # Dense data grids, metrics, SVG live map
│   ├── package.json                     # Next.js 15, React 19, Tailwind CSS, Lucide
│   └── tsconfig.json
├── shared/                              # Shared Domain Contracts, Enums & Schemas
│   ├── src/
│   │   ├── enums/                       # TripStatus, UserRole, GpsHealthStatus, etc.
│   │   ├── interfaces/                  # Domain entity types & API payloads
│   │   ├── schemas/                     # Zod request/response validation schemas
│   │   └── utils/                       # Phone normalisation, coordinate validators
│   └── package.json
└── infrastructure/                      # Deployment & Container Manifests
    ├── docker-compose.yml               # PostgreSQL 16 + PostGIS 3.4 & Redis 7
    └── Dockerfile                       # Multi-stage production container build
```

---

## 2. Package & Dependency Inventory

### A. `@school-bus/shared`
- **Role:** Pure TypeScript ESM package providing canonical domain models, Zod validation schemas, and types shared across backend, school-dashboard, and parent-web.
- **Dependencies:** `zod` (`^3.23.8`).
- **Build Output:** Compiled into `dist/` with full `.d.ts` declaration maps.

### B. `@school-bus/backend`
- **Role:** Central REST and SSE API server with PostGIS geospatial database layer.
- **Runtime Dependencies:**
  - `express` (`^4.21.1`)
  - `pg` (`^8.13.1`) + `@types/pg`
  - `zod` (`^3.23.8`)
  - `bcryptjs` (`^2.4.3`)
  - `jsonwebtoken` (`^9.0.2`)
  - `helmet` (`^8.0.0`)
  - `cors` (`^2.8.5`)
  - `dotenv` (`^16.4.5`)
- **Dev & Test Dependencies:**
  - `vitest` (`^2.1.4`)
  - `tsx` (`^4.19.2`)
  - `typescript` (`^5.6.3`)

### C. `@school-bus/school-dashboard`
- **Role:** Calming, data-dense web application for school administrators and transport coordinators.
- **Runtime Dependencies:**
  - `next` (`15.0.3` / `15.5.27`)
  - `react` (`^19.0.0`) + `react-dom` (`^19.0.0`)
  - `lucide-react` (`^0.454.0`)
  - `tailwindcss` (`^3.4.14`)
  - `clsx` (`^2.1.1`) + `tailwind-merge` (`^2.5.4`)
- **Page Count:** 17 statically prerendered routes.

### D. `@school-bus/parent-web`
- **Role:** WhatsApp-accessible live tracking view for parents with instant zero-install web rendering.
- **Runtime Dependencies:**
  - `next` (`15.0.3` / `15.5.27`)
  - `react` (`^19.0.0`) + `react-dom` (`^19.0.0`)
  - `lucide-react` (`^0.454.0`)
  - `tailwindcss` (`^3.4.14`)
- **Page Count:** 5 statically prerendered routes (`/`, `/track`, `/_not-found`).

### E. `school_bus_driver_app` (Flutter Android)
- **Role:** Minimal background location telemetry client for school bus drivers.
- **SDK Target:** Android API 34 (Android 14) / Min SDK 21 (Android 5.0).
- **Core Flutter Plugins:**
  - `geolocator`: High-accuracy location capture.
  - `flutter_foreground_task`: Persistent background tracking service.
  - `sqflite`: Local SQLite database for offline telemetry buffering.
  - `connectivity_plus`: Network status monitoring.
  - `http`: HTTP client for telemetry ingestion batch uploads.
  - `wakelock_plus`: Prevents CPU sleep while trips are actively running.

---

## 3. Database Migration Inventory

All migrations reside in `backend/src/db/migrations/`:
1. `001_core_entities.sql`: Schools, admins, audit logs, pgcrypto/postgis extensions.
2. `002_transport_entities.sql`: Buses, drivers, routes, pickup locations, PostGIS geometries.
3. `003_operations_entities.sql`: Students, parents, student_transport, trips, trip_stops, student_attendance, gps_locations.
4. `004_db_quality_soft_deletes_triggers.sql`: Triggers for updated_at, soft deletes.
5. `005_auth_password_reset.sql`: Password reset tokens table.
6. `006_driver_auth_credentials.sql`: Driver PIN hash, license number, and driver auth.
7. `007_parent_tracking_tokens.sql`: Secure tokenized parent access tables.
8. `008_school_profile_enhancements.sql`: School operating hours, contact fields.
9. `009_driver_photo_and_profile.sql`: Driver photo URL and emergency contact.
10. `010_parent_notification_status_and_optout.sql`: Parent notification preferences.
11. `011_gps_telemetry_battery_network.sql`: Battery level and network signal metrics.
12. `012_gps_locations_deduplication.sql`: GPS timestamp duplicate guards.
13. `013_bus_latest_location_cache.sql`: Fast single-row cached bus location table.
14. `014_driver_session_version.sql`: Driver multi-device session invalidation.
15. `015_schema_integrity_and_soft_deletes.sql`: Soft-delete unique constraint fixes.
16. `016_add_arrived_school_trip_status.sql`: ARRIVED_AT_SCHOOL status constraint update.
17. `017_attendance_corrections_and_journey.sql`: Attendance correction audit trails.
18. `018_geofence_notification_log.sql`: Geofence entry/exit notification idempotency.
19. `019_pickup_geofence_and_events.sql`: Pickup radius geofences and event tracking.
20. `020_school_geofence_and_arrival.sql`: School campus polygon geofences.
21. `021_geofence_event_handling.sql`: Event processing queues and triggers.
