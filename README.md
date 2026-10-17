# 🚌 BUSLOARD — School & College Bus Tracking Platform (India)

<p align="center">
  <img src="https://img.shields.io/badge/Status-Active%20Development-brightgreen?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Stack-Node.js%20%7C%20Flutter%20%7C%20Next.js-blue?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Database-PostgreSQL%20%2B%20PostGIS-336791?style=for-the-badge&logo=postgresql" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" />
</p>

> A **production-grade, multi-tenant** school bus tracking, attendance, and student transport safety system built specifically for Indian schools, colleges, drivers, and parents.

---

## ✨ What is BUSLOARD?

BUSLOARD solves real transport safety challenges faced by Indian schools every day:

- 📍 **Live GPS tracking** of every school bus — visible to parents in real-time
- 📲 **WhatsApp-first** notifications — no app download required for parents
- 🧑‍✈️ **Driver Android app** — lightweight, battery-efficient background GPS
- 🖥️ **Admin Dashboard** — high-density operational console for school coordinators
- 🔔 **Smart alerts** — delays, geofence breaches, SOS/emergency dispatch
- 🛡️ **Fully multi-tenant** — complete school-level data isolation

---

## 🏗️ Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────┐
│                        BUSLOARD                             │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌───────────────┐  │
│  │ Flutter App  │   │  Next.js     │   │  Parent Web   │  │
│  │ (Driver GPS) │   │  Dashboard   │   │  (Track Page) │  │
│  └──────┬───────┘   └──────┬───────┘   └──────┬────────┘  │
│         │                  │                   │           │
│         └──────────────────▼───────────────────┘           │
│                     Node.js + TypeScript API                │
│                     ┌─────────────────────┐                │
│                     │  PostgreSQL+PostGIS  │                │
│                     │  (Geospatial Engine) │                │
│                     └─────────────────────┘                │
│                                                             │
│   WhatsApp Notifications ← Twilio / Meta Cloud API adapter │
└─────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|---|---|
| **Backend API** | Node.js + TypeScript (strict mode) |
| **Database** | PostgreSQL 16 + PostGIS 3.4 (geospatial) |
| **Driver App** | Flutter Android (background GPS service) |
| **School Dashboard** | Next.js 14 / React |
| **Parent Web** | Responsive Next.js page (no install needed) |
| **Notifications** | WhatsApp via provider adapter (Twilio/Meta) |
| **Mapping** | OpenStreetMap + PostGIS (FOSS-first) |
| **Auth** | JWT with session revocation + token versioning |

---

## 📂 Repository Structure

```
BUSLOARD/
├── backend/                  # Node.js + TypeScript API server
│   ├── src/
│   │   ├── config/           # DB pool, env, middleware setup
│   │   ├── controllers/      # Route handlers (thin layer)
│   │   ├── services/         # Business logic (auth, trips, telemetry…)
│   │   ├── middlewares/      # Auth, rate limiting, validation
│   │   ├── routes/           # Express route definitions
│   │   └── types/            # TypeScript types and interfaces
│   ├── migrations/           # PostgreSQL migration files (001–015)
│   └── tests/                # Vitest unit + integration tests (268 tests)
│
├── driver-app/               # Flutter Android app
│   └── lib/
│       ├── core/             # Constants, config, theme
│       ├── models/           # Dart data models
│       ├── screens/          # UI screens (home, login, trip)
│       └── services/         # GPS, telemetry, auth, SQLite, queue
│
├── school-dashboard/         # Next.js school admin dashboard
│   └── src/
│       ├── app/admin/        # Admin pages (live, buses, drivers…)
│       ├── components/       # Reusable UI components
│       ├── contexts/         # Auth context
│       └── services/         # API client, dashboard/bus/driver APIs
│
├── shared/                   # Shared TypeScript types (backend ↔ dashboard)
├── parent-web/               # Parent live tracking web page
├── docs/                     # Architecture, ADRs, feature registry
│   ├── architecture.md
│   ├── feature-registry.md
│   ├── product-spec.md
│   └── adr/                  # Architecture Decision Records
├── infrastructure/           # Docker, deployment configs
├── .env.example              # Environment variable template
├── AGENTS.md                 # Master AI agent rules & scope guardrails
└── package.json              # Monorepo workspace root
```

---

## 🚀 Getting Started

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | v20+ or v22 LTS |
| npm | v10+ |
| PostgreSQL | v16 with PostGIS 3.4 extension |
| Flutter SDK | v3.x (for driver app only) |
| Android Studio | Latest (for driver app only) |

### 1. Clone the repository

```bash
git clone https://github.com/princeg7386/TrackLoard.git
cd TrackLoard
```

### 2. Set up environment variables

```bash
cp .env.example .env
# Edit .env with your DB credentials, JWT secret, WhatsApp API keys, etc.
```

### 3. Install dependencies

```bash
npm install          # Installs all workspace packages (backend, shared, dashboard)
```

### 4. Run database migrations

```bash
# Apply all 15 migrations in order
npm --prefix backend run db:migrate
```

### 5. Start the backend

```bash
npm --prefix backend run dev
# API available at http://localhost:3000/api/v1
```

### 6. Start the school dashboard

```bash
npm --prefix school-dashboard run dev
# Dashboard at http://localhost:3001
```

### 7. Build the driver app

```bash
cd driver-app
flutter pub get
flutter run                      # Run on connected Android device / emulator
# Or build APK:
flutter build apk --dart-define=API_BASE_URL=https://your-api-url.com
```

---

## 🔑 Key Features Built

### ✅ Backend (Node.js + TypeScript)
- Multi-tenant authentication with school isolation
- Driver JWT auth with **session revocation + token versioning**
- GPS telemetry ingestion with **deduplication** and **stationary filter**
- Real-time bus position cache (PostgreSQL)
- **SSE (Server-Sent Events)** live feed for dashboard
- Rate limiting per route (auth, telemetry, parent tracking)
- 268 passing tests (Vitest)

### ✅ Driver App (Flutter Android)
- Background GPS capture with 5m distance filter
- Local **SQLite offline queue** — never loses a telemetry point
- Automatic **retry with exponential backoff + jitter**
- Poison-pill protection — 4xx errors drop bad batches, don't block queue
- **Battery + network status** telemetry included in every ping
- Configurable API base URL via `--dart-define` (no hardcoding)
- Full app lifecycle handling (foreground/background/killed)

### ✅ School Dashboard (Next.js)
- Live operations page with real API data (no hardcoded metrics)
- All 6 UI states: Loading → Success → Empty → Error → Offline → Unauthorized
- Proper auth token management (`sb_auth_token`)
- Dashboard summary with active trips, fleet online count, alerts

### ✅ GPS Telemetry Pipeline (Phases 11.1–11.4)
- Location capture: lat, lng, speed, accuracy, bearing, altitude
- Upload coordinator with batch queue and stationary filter
- GPS health monitoring: stale detection, poor accuracy alerts, internet loss
- Backend validation, raw storage, bus position cache, real-time SSE feed

---

## 🗺️ Roadmap & Phase Completion

All phase definitions and numbers strictly align with the **Master Micro-Phase Roadmap**:

| Phase | Description | Status | Evidence |
|---|---|---|---|
| **0–5** | Architecture, PostgreSQL 16 schema, multi-tenant RBAC, school onboarding | ✅ Done | Migrations 001–005, Vitest suites |
| **6–9** | Fleet management, driver records, student/parent directory & WhatsApp | ✅ Done | Migrations 006–010, Vitest suites |
| **10** | Driver mobile app foundation (Flutter background GPS, SQLite queue) | ✅ Done | `driver-app/` scaffold, zero flutter analyze issues |
| **11** | GPS telemetry ingestion pipeline (batching, dedup, stationary filter, SSE) | ✅ Done | Migrations 011–015, telemetry tests |
| **12** | Real-time live tracking (bus state, SSE transport, map canvas, parent live) | ✅ Done | `backend/src/services/live-tracking.service.ts` |
| **13** | Map & routing layer (OSM, OSRM, Valhalla, road snapping, fallback & usage) | ✅ Done | `backend/src/services/routing/` |
| **14** | Dynamic pickup engine (WhatsApp location share, nearest road, direct assign) | ✅ Done | `backend/src/services/dynamic-pickup/` |
| **15** | Route management (assigned driver/bus, stop sequence, route canvas, audit) | ✅ Done | `backend/src/services/route.service.ts` |
| **16** | Trip engine (state machine, `ARRIVED_SCHOOL`, conflict check, idempotency) | ✅ Done | `backend/src/services/trip.service.ts`, Migration 016 |
| **17** | Driver WhatsApp core (menu, start/end trip, error handling & deduplication) | ✅ Done | `backend/src/services/driver-whatsapp.service.ts` |
| **18.1** | Driver attendance student list (stop sequence roster, WhatsApp manifest) | ✅ Done | `backend/src/services/driver-attendance.service.ts` |
| **18.2+** | Boarding & drop logging, journey history, ETA engine, geofencing | 🔜 Planned | Next execution phases |

> Detailed verification table and file evidence: see [docs/phase-audit-12-18.md](./docs/phase-audit-12-18.md) and [docs/adr/trip-state-vocabulary.md](./docs/adr/trip-state-vocabulary.md).

---

## 🛡️ Scope Guardrails

To keep the system lean and reliable, these are **permanently out of scope** unless explicitly introduced:

| ❌ Not Building | Reason |
|---|---|
| Bus seat capacity counting | Not needed for safety tracking |
| Bus active/inactive toggles | Managed via trip assignments |
| Mandatory school approval for normal pickup | Direct verified coordinator workflow |
| Parent child-selection switchers | Direct 1:1 tokenized sessions |
| Payments / Billing / Subscriptions | Deferred to commercial phase |
| RFID / CCTV / Face recognition | Hardware dependencies avoided |
| Generic AI SaaS aesthetics | Calm, data-dense operational UI only |

---

## 🧪 Testing

```bash
# Run all backend unit & integration tests (524 tests, 61 files)
npm test -w backend

# Run cross-layer consistency audit tests (26 tests, 5 test suites)
npx tsx --test audit-tests/consistency.test.ts

# Run security and route authorization audit tests (25 tests)
npm run test:audit

# Run full end-to-end audit with Docker PostgreSQL 16 + PostGIS 3.4
node audit-tests/run-report.mjs

# Type check backend
npx tsc --noEmit -p backend/tsconfig.json

# Type check dashboard
npx tsc --noEmit -p school-dashboard/tsconfig.json
```

**Current verified status: 524 backend tests + 26 consistency tests + 25 audit tests + 70+ E2E checks, all passing ✅**

---

## 📖 Documentation

- [AGENTS.md](./AGENTS.md) — Master agent rules & quality guardrails
- [Phase 12–18 Audit Evidence](./docs/phase-audit-12-18.md) — Detailed micro-phase verification table
- [ADR: Trip State Vocabulary](./docs/adr/trip-state-vocabulary.md) — PDF 16.1 state mapping & token consistency
- [Architecture](./docs/architecture.md) — System design & adapter interfaces
- [Feature Registry](./docs/feature-registry.md) — Master feature registry & status
- [Product Spec](./docs/product-spec.md) — Role matrix & user journeys
- [ADR Records](./docs/adr/) — Architecture decision records

---

## 👤 Author

**Prince** — [@princeg7386](https://github.com/princeg7386)

---

## 📄 License

MIT License — see [LICENSE](./LICENSE) for details.
