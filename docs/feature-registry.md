# Master Feature Registry & Scope Lock

| Feature ID | Category | Domain / Subsystem | Feature Name & Description | Dependencies | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P0-REG-01** | Supporting | Project Control | **Master Scope Register**: Master feature list, unique IDs, status tracking, and dependency mapping. | None | **Done** |
| **P0-EXC-02** | Supporting | Project Control | **Scope Exclusions & Guardrails**: Formal lock preventing billing, RFID, CCTV, iOS driver, ERP bloat. | P0-REG-01 | **Done** |
| **P0-RUL-03** | Supporting | Project Control | **Product Rules & Channel Architecture**: WhatsApp-first workflows, Zero-App Parent Web, Minimalist Driver Flutter App, FOSS-first strategy. | P0-REG-01 | **Done** |
| **P0-DOD-04** | Supporting | Project Control | **Definition of Done & Quality Gates**: 6-tier quality gates, UI 7-state completeness, unit/integration/E2E test plan. | P0-REG-01 | **Done** |
| **P0-DEV-05** | Supporting | Development Env | **Developer Workstation Audit & Tooling**: Audit of Git, VS Code, Node.js, npm, and winget automated install scripts for Docker/Flutter. | P0-REG-01 | **Done** |
| **P0-GIT-06** | Supporting | Development Env | **Git Repository & Branch Management**: Initialized repo, main & development branches, .gitignore, .env.example, PR/issue templates. | P0-REG-01 | **Done** |
| **P0-ENV-02** | Supporting | Infrastructure | **Environment & Monorepo Scaffold**: Repository structure, TypeScript configs, monorepo workspaces (backend, driver-app, school-dashboard, parent-web, shared, infrastructure, tests). | P0-REG-01 | **Done** |
| **P1-LOC-04** | Supporting | Infrastructure | **Local Services & PostGIS / Redis**: Docker Compose configuration for PostgreSQL 16 + PostGIS 3.4 & Redis 7, init scripts, and connection pool module. | P0-ENV-02 | **Done** |
| **P1-COR-01** | Core | Database & Domain | **Core Entities Data Model & Schema**: Idempotent SQL migration (001_core_entities.sql), migration runner, and Zod/TypeScript contracts for Schools, Admins, Drivers, Buses, Students, and Parents. | P1-LOC-04 | **Done** |
| **P1-TRN-02** | Core | Database & Domain | **Transport Entities Data Model & Spatial Schema**: PostGIS migration (002_transport_entities.sql), GIST spatial indexing, and Zod contracts for Routes, Pickup Locations, Trips, GPS Telemetry, Boarding & Drop Events. | P1-COR-01 | **Done** |
| **P1-OPS-03** | Safety | Database & Domain | **Operations & Safety Entities Schema**: Migration (003_operations_entities.sql) and contracts for Notifications, Delays, Incidents, SOS Events, Temporary Pickups, Absence Records, Reports, and Audit Logs. | P1-TRN-02 | **Done** |
| **P2-LOC-04** | Core | Spatial Engine | **PostGIS Spatial Location Model & Geofence Engine**: Geography geometry points, GIST spatial index queries, ST_DWithin/ST_Distance calculations, SpatialService, and Haversine geo math helpers. | P1-OPS-03 | **Done** |
| **P2-QUA-05** | Supporting | Database & Quality | **Database Quality, Triggers, Soft-Deletes & Seed Harness**: Migration (004_db_quality_soft_deletes_triggers.sql), auto-timestamp triggers, deleted_at partial indexes, and isolated seed runner (seed.ts). | P2-LOC-04 | **Done** |
| **P3-API-01** | Core | Backend Foundation | **API Skeleton, Router, Config Loader & Health Diagnostics**: Express application factory, Zod env config validation, centralized error handling, /health endpoint, and /api/v1 root router. | P2-QUA-05 | **Done** |
| **P3-VAL-02** | Core | Backend Foundation | **Request Validation, Response Schemas & Input Sanitization**: Zod validateRequest middleware, ApiResponse / PaginatedResult envelopes, Indian phone normalizer (+91), string sanitizer, and 422 error handlers. | P3-API-01 | **Done** |
| **P3-INF-03** | Supporting | Backend Foundation | **Infrastructure Services**: DbService transaction manager, structured JSON logger with sensitive data redaction, TimeUtil (IST & ETA formatter), IdUtil (UUIDv4/tokens), and IStorageAdapter (local/mock). | P3-VAL-02 | **Done** |
| **P3-QLT-04** | Core | Backend Foundation | **API Quality & Middleware Pipeline**: API versioning (/api/v1), Request ID tagging (X-Request-ID), sliding-window rate-limiter abstraction (IRateLimiterStore, 429), and central error handler with correlation IDs. | P3-INF-03 | **Done** |
| **P0-SEC-03** | Core | Security & Auth | **Multi-Tenant RBAC & Admin Auth Engine**: Bcrypt password hashing, JWT signed session tokens, Login, Logout, Forgot Password, Reset Password, Change Password, and role verification middleware (/api/v1/auth). | P3-QLT-04 | **Done** |
| **P0-SEC-04** | Core | Security & Auth | **Driver Authentication & Bus Authorization**: 006_driver_auth_credentials migration (PIN hash/last active), phone/PIN login, driver-scoped JWT, /api/v1/driver/auth endpoints, authenticateDriver & requireAssignedBus middlewares. | P0-SEC-03 | **Done** |
| **P0-SEC-05** | Security | Parent Identity & Auth | **Parent WhatsApp Identity & Secure Tracking Link Engine**: 007_parent_tracking_tokens migration, WhatsApp phone resolution, cryptographically secure parent tokens, live tracking verification, instant and student-wide token revocation. | P0-SEC-04 | **Done** |
| **P0-SEC-06** | Security | RBAC & Tenant Isolation | **Multi-Tenant Isolation & Role Guard Engine**: TenantIsolationService and middlewares (requireTenantScope, requireDriverTripScope, requireParentStudentScope, requirePermission), cross-tenant leak prevention, driver bus/trip scoping, parent child data boundary. | P0-SEC-05 | **Done** |
| **P0-SEC-07** | Security | Security Audit & Ops | **Security Audit, Secrets Protection & Policy**: AuditService with sanitized diffs, SecurityUtil (secret compliance & URI redaction), strict Helmet HSTS/CSP headers, reverse proxy trust, anti-abuse rate limiters, and PostGIS backup utility. | P0-SEC-06 | **Done** |
| **P1-SCH-01** | Core | School Management | **School Profile & Dashboard Shell**: School configuration, name, address, contacts, branding logo, affiliation number, 7-state Next.js admin UI, responsive sidebar drawer, IST live clock, auth guard, operator profile & security, and empty states. | P0-SEC-03 | **Done** |
| **P1-FLT-02** | Core | Fleet Management | **Bus / Vehicle Directory & Creation**: Registration number with Indian format validator, internal bus number, make/model, GPS device identifier, driver assignment, multi-tenant queries, and 7-state UI. *(No capacity / active-inactive toggles)* | P1-SCH-01 | **In Progress** |
| **P1-DRV-03** | Core | Driver Management | **Driver Profile & WhatsApp Binding**: Phone verification, licensing info, bus binding. | P1-SCH-01 | Not Started |
| **P1-STD-04** | Core | Student Management | **Student Directory & Parent Association**: Student details, class/section, primary parent contact, pickup point assignment. | P1-SCH-01 | Not Started |
| **P1-RTE-05** | Core | Route Management | **Route & Stop Geo-Definitions**: Ordered pickup/drop stop coordinates, sequence, scheduled stop timings. | P1-SCH-01 | Not Started |
| **P2-GPS-01** | Core | Telemetry Engine | **GPS Location Ingestion Pipeline**: Ingestion endpoint/adapter for driver app telemetry, spatial points indexing (PostGIS). | P0-SEC-03, P1-FLT-02 | Not Started |
| **P2-GEO-02** | Safety | Geofencing Engine | **Pickup Stop Geofence Trigger**: PostGIS spatial boundary checks for stop arrival, dwell time, and departure events. | P2-GPS-01, P1-RTE-05 | Not Started |
| **P2-ETA-03** | Core | ETA & Routing | **Dynamic ETA Calculation Service**: Real-time stop ETA estimation based on speed, distance, and historical transit. | P2-GPS-01, P1-RTE-05 | Not Started |
| **P2-TRP-04** | Core | Trip Engine | **Trip State Machine**: Scheduled, In-Transit, Delayed, Completed, and Aborted states with event timeline. | P1-RTE-05, P1-FLT-02, P1-DRV-03 | Not Started |
| **P3-DRV-01** | Core | Driver Mobile App | **Driver Android Flutter App**: Battery-optimized background location tracking, network failure queue, and offline sync. | P2-GPS-01, P1-DRV-03 | Not Started |
| **P3-DWA-02** | Supporting | Driver WhatsApp | **Driver WhatsApp Command Bot**: Start Trip, End Trip, Student Search, Report Problem, SOS dispatch. | P2-TRP-04, P1-DRV-03 | Not Started |
| **P3-ATT-03** | Safety | Attendance Engine | **Student Boarding/Deboarding Attendance**: Driver-marked boarding status, missing student alerts, stop validation. | P2-TRP-04, P1-STD-04 | Not Started |
| **P4-NOT-01** | Supporting | Notification Engine | **WhatsApp & Webhook Dispatch Adapter**: Template management, rate limiting, parent notification triggers. | P2-GEO-02, P2-ETA-03 | Not Started |
| **P4-PAR-02** | Safety | Parent Live Tracking | **Secure Parent Live Web View**: Responsive, secure tokenized web tracking showing live bus location, stop ETA, and driver contact. | P2-ETA-03, P2-TRP-04, P0-SEC-03 | Not Started |
| **P5-DLY-01** | Safety | Anomaly & Delay | **Delay & Route Deviation Detection**: Automated detection of unapproved stops, route divergence, and heavy traffic delays. | P2-GPS-01, P2-GEO-02 | Not Started |
| **P5-SOS-02** | Safety | Emergency & Incident | **Driver SOS & Incident Management**: Instant alert dispatch to school admin, priority WhatsApp broadcast, incident audit trail. | P2-GPS-01, P3-DWA-02, P4-NOT-01 | Not Started |
| **P5-ADM-03** | Core | School Dashboard UI | **Operational Admin Dashboard & Home Overview**: Dashboard cards, transport status summary, safety alert monitor, real-time audit activity feed, live dispatch quick actions, and 7-state UI. | P0-SEC-03, P1-SCH-01 | **Done** |
| **P6-RPT-01** | Supporting | Reports & Analytics | **Fleet Operations & Safety Reports**: On-time performance, driver route adherence, attendance logs, SOS resolution records. | P2-TRP-04, P3-ATT-03, P5-SOS-02 | Not Started |

---

## Status Key & Workflow
- **Not Started**: Spec defined, ready for implementation once dependencies are met.
- **In Progress**: Currently under active micro-phase execution.
- **Blocked**: Waiting on external prerequisite or preceding micro-phase.
- **Done**: Fully implemented, tested, verified, and diff-inspected.

## Category Definitions
- **Core**: Mission-critical transport logistics, routing, tenant management, and tracking mechanisms.
- **Safety**: High-stakes child safety features (Geofencing, Attendance, SOS/Incidents, Delay alerts, Parent Live tracking).
- **Supporting**: Operational enhancements, bot workflows, adapters, and reporting tools.
