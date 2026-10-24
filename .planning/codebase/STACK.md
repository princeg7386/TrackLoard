# STACK.md — BUSLOARD Codebase Technology Stack

> **Generated:** 2026-10-24  
> **Focus:** Tech — runtime, frameworks, libraries, tooling across all workspaces

---

## 1. Monorepo Structure

The repository is an **npm workspaces** monorepo. All TypeScript packages share a common base compiler configuration.

```
BUSLOARD/
├── package.json                  # workspace root — defines workspaces
├── tsconfig.base.json            # shared TS compiler base
├── backend/                      # Node.js API server
├── shared/                       # @school-bus/shared — contracts & schemas
├── school-dashboard/             # Next.js admin dashboard
├── parent-web/                   # Next.js parent live-tracking page
├── driver-app/                   # Flutter Android app
└── infrastructure/               # DB migrations, infra scripts
```

### Root `tsconfig.base.json` settings

| Option | Value |
|---|---|
| `target` | `ES2022` |
| `module` | `NodeNext` |
| `strict` | `true` |
| `noUncheckedIndexedAccess` | `true` |

---

## 2. Shared Library — `shared/`

**Package name:** `@school-bus/shared`  
**Purpose:** Single source of truth for data contracts shared between backend, dashboard, and parent-web.

| Category | Detail |
|---|---|
| Language | TypeScript (pure, no runtime) |
| Only dependency | `zod` 3.23 |
| Approximate size | ~3 488 lines |

### Exports
- All **Zod schemas** (request/response validation, entity shapes)
- **TypeScript types** inferred from schemas
- Shared **utility functions**

> Every other workspace imports from `@school-bus/shared` to guarantee contract consistency across the stack.

---

## 3. Backend — `backend/`

### Runtime & Language

| Item | Version |
|---|---|
| Runtime | Node.js (LTS) |
| Language | TypeScript 5.6 |
| Dev execution | `tsx` (TypeScript Execute — no compile step in dev) |

### Web Framework

| Item | Detail |
|---|---|
| Framework | **Express** 4.21 |
| Entry point | `backend/src/index.ts` |
| Middleware | `helmet` 8.0 (security headers), `cors` 2.8 |

### Database Layer

| Item | Detail |
|---|---|
| Database | **PostgreSQL** with **PostGIS** extension |
| Node driver | `pg` 8.13 |
| Connection pool | `backend/src/config/database.ts` |
| Migrations | 17 SQL files in `backend/src/db/migrations/` |
| Seed / Verify | `db:seed`, `db:verify` npm scripts |

### Authentication

| Item | Detail |
|---|---|
| Library | `jsonwebtoken` 9.0 |
| School admin/coordinator | Standard JWT — issued at login |
| Driver auth | Separate middleware at `backend/src/middlewares/driver-auth.middleware.ts` |
| Parent tokens | Time-limited secure tokens; secret: `PARENT_TOKEN_SECRET`, TTL: `PARENT_TOKEN_TTL_HOURS` (default 12 h) |

### Validation

| Item | Detail |
|---|---|
| Library | `zod` 3.23 |
| Schemas | Imported from `@school-bus/shared` where shared; local schemas for backend-only shapes |

### Real-Time

| Item | Detail |
|---|---|
| WebSocket | `ws` 8.18 |
| SSE | Native Express `Response` streams via `backend/src/services/realtime-feed.service.ts` |
| Pub-sub | Node.js `EventEmitter`; channels: `school:{id}`, `trip:{id}`, `bus:{id}` |
| SSE listener cap | Warning emitted after 2 000 concurrent listeners |

### Testing

| Item | Detail |
|---|---|
| Runner | **Vitest** 2.1 |
| Test files | 70 |
| Total tests | 782 |

### npm Scripts

| Script | Action |
|---|---|
| `dev` | `tsx watch` — hot-reload dev server |
| `build` | `tsc` — compile to `dist/` |
| `start` | Run compiled output |
| `typecheck` | `tsc --noEmit` |
| `test` | `vitest run` |
| `db:migrate` | Apply SQL migrations in `backend/src/db/migrations/` |
| `db:seed` | Seed reference data |
| `db:verify` | Sanity-check DB state |

---

## 4. School Dashboard — `school-dashboard/`

**Target audience:** School administrators and coordinators.

| Item | Version |
|---|---|
| Framework | **Next.js** 15 (App Router) |
| UI library | **React** 19 |
| Language | TypeScript 5.6 |
| Styling | **Tailwind CSS** 3.4 |
| Style utilities | `tailwind-merge`, `clsx` |
| Icons | `lucide-react` 0.454 |
| Shared contracts | `@school-bus/shared` |

### Design Principles
- High-density, operational UI on an **8 px grid**
- Calm, neutral surface palette with a single brand accent
- Semantic status colors: Green = On-Time · Amber = Delay · Red = Incident/SOS · Slate = Offline
- No decorative WebGL, stock illustrations, or random gradient cards

---

## 5. Parent Web — `parent-web/`

**Target audience:** Parents — live bus tracking via secure link (no app install required).

| Item | Version |
|---|---|
| Framework | **Next.js** 15 |
| UI library | **React** 19 |
| Language | TypeScript 5.6 |
| Styling | Tailwind CSS 3.4 + `tailwind-merge` + `clsx` |
| Icons | `lucide-react` 0.454 |
| Shared contracts | `@school-bus/shared` |

### Key File
- `parent-web/src/page.tsx` — single secure live-tracking page; access via time-limited parent token

---

## 6. Driver App — `driver-app/`

**Target audience:** Bus drivers — minimal Android app for background GPS and daily operations.

| Item | Version |
|---|---|
| Framework | **Flutter** 3 |
| Dart SDK | `>=3.0.0 <4.0.0` |
| Platform | Android only |

### Key Dependencies

| Package | Version | Purpose |
|---|---|---|
| `geolocator` | 12.0 | Background GPS location tracking |
| `sqflite` | 2.3 | Local SQLite — offline telemetry buffer |
| `connectivity_plus` | 6.0 | Network state detection |
| `battery_plus` | 6.0 | Battery level telemetry |
| `http` | 1.2 | REST API calls to backend |
| `shared_preferences` | 2.2 | Lightweight persistent key-value store |
| `url_launcher` | 6.3 | Deep-link to WhatsApp / external URLs |
| `permission_handler` | 11.3 | Runtime permission management |

### Design Goals
- **Lightweight** — minimal UI surface; daily operations via WhatsApp
- **Battery-efficient** — background location optimised to reduce drain
- **Offline-resilient** — telemetry buffered in `sqflite` and flushed on reconnect

---

## 7. Infrastructure — `infrastructure/`

| Item | Detail |
|---|---|
| Directory | `infrastructure/` |
| SQL migrations | 17 files in `backend/src/db/migrations/` |
| Spatial extension | PostGIS (geofencing, route matching, ETA queries) |

---

## 8. Cross-Cutting Concerns

### Multi-Tenancy
- Strict **school-level tenant isolation** enforced at the query layer on every domain
- Drivers access only their assigned bus; parents access only their authorised student token

### Provider Abstraction
- Routing, maps/geocoding, messaging, and storage are all behind **abstract adapter interfaces**
- Swap providers via environment variables without touching domain logic (see `INTEGRATIONS.md`)

### State Completeness (all UIs)
Every UI surface handles: `Loading` · `Empty` · `Success` · `Validation Error` · `Failure / Retry` · `Unauthorized` · `Offline / Reconnecting`

### Explicitly Out of Scope
- ❌ Payments / subscriptions
- ❌ Bus seat capacity constraints
- ❌ CCTV, RFID, face recognition, payroll, ERP
- ❌ Mandatory native parent app
