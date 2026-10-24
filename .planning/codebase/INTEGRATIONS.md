# INTEGRATIONS.md — BUSLOARD External & Internal Integrations

> **Generated:** 2026-10-24  
> **Focus:** Tech — all external providers, adapter interfaces, environment variables, and real-time delivery

---

## Overview

All external provider dependencies are hidden behind **abstract adapter interfaces**. The active provider is selected at runtime via environment variables, enabling zero-code swaps between free/OSS defaults, paid cloud APIs, and test mocks.

---

## 1. Routing Providers

### Interface

```
backend/src/services/routing/routing-provider.interface.ts
```

Defines the contract all routing adapters must satisfy (calculate route, get ETA, snap to road, etc.).

### Adapters

| Adapter | Notes | Default? |
|---|---|---|
| **OSRM** | Open-Source Routing Machine — free, self-hostable | ✅ Yes |
| **Valhalla** | OSS graph-based routing engine | — |
| **Google Maps** | Directions API — paid; best coverage | — |
| **Mock** | Deterministic fixture responses for tests | Test only |

### Selection

```env
ROUTING_PROVIDER=osrm        # osrm | valhalla | google | mock
```

### OSRM Default Endpoint

```
https://router.project-osrm.org
```

Override with `OSRM_BASE_URL` for a self-hosted instance.

---

## 2. Map / Geocoding Providers

### Interface

```
backend/src/services/maps/map-provider.interface.ts
```

Covers geocoding (address → coordinates), reverse geocoding (coordinates → address), and place search.

### Adapters

| Adapter | Notes | Default? |
|---|---|---|
| **OSM / Nominatim** | OpenStreetMap — free, no API key | ✅ Yes |
| **Google Maps Geocoding** | Paid; more accurate for Indian addresses | — |
| **Mock** | Fixture responses for unit/integration tests | Test only |

### Map Tile Source (frontend)

```
https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png
```

Used by both `school-dashboard/` and `parent-web/` for operational map canvases.

---

## 3. WhatsApp / Messaging Providers

### Interface

`IMessagingProvider` is defined in `@school-bus/shared` and consumed by the backend messaging service.

### Service

```
backend/src/services/messaging/messaging.service.ts
```

Orchestrates template selection, recipient resolution, and delivery via the active adapter.

### Adapters

| Adapter | Notes | Default? |
|---|---|---|
| **Mock** | Logs messages to console; no external calls | ✅ Dev / Test |
| **Meta Cloud WhatsApp API** | Official WhatsApp Business Cloud API | Production |
| **Twilio** | Alternative cloud messaging (declared in env enum) | Optional |

### Selection

```env
MESSAGING_PROVIDER=mock          # mock | meta_cloud | twilio
```

### Meta Cloud API Environment Variables

| Variable | Purpose |
|---|---|
| `META_WA_PHONE_NUMBER_ID` | WhatsApp Business phone number ID |
| `META_WA_ACCESS_TOKEN` | Bearer token for Meta Graph API calls |
| `META_WA_WEBHOOK_VERIFY_TOKEN` | Webhook challenge verification secret |

### Messaging Flows
- **Parent notifications:** Bus departing, bus approaching stop, student boarded/dropped, delay alerts
- **Driver daily ops:** Start/End Trip confirmation, Student Search, Report Problem, Emergency/SOS, Help — all via WhatsApp interactive messages
- **School admin alerts:** SOS escalation, deviation warnings, trip exception summaries

---

## 4. Database

### Technology

| Item | Detail |
|---|---|
| Engine | **PostgreSQL** with **PostGIS** extension |
| Node client | `pg` 8.13 |
| Spatial features | Geofencing, stop proximity matching, route deviation detection, ETA queries |

### Connection Pool

```
backend/src/config/database.ts
```

| Environment Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — (required) | Full PostgreSQL connection string |
| `DB_MAX_CONNECTIONS` | `20` | pg pool size |

### Migrations

- **Location:** `backend/src/db/migrations/` (17 SQL files, sequentially numbered)
- **Apply:** `npm run db:migrate` in `backend/`
- **Seed:** `npm run db:seed`
- **Verify:** `npm run db:verify`

---

## 5. Authentication

### School Admin / Coordinator

| Item | Detail |
|---|---|
| Library | `jsonwebtoken` 9.0 |
| Mechanism | Signed JWT issued on login; verified by Express middleware |
| Tenant isolation | `school_id` embedded in token payload; enforced on every query |

### Driver Auth

| Item | Detail |
|---|---|
| Middleware | `backend/src/middlewares/driver-auth.middleware.ts` |
| Mechanism | Separate JWT flow — drivers authenticate independently from school admins |
| Scope | Access restricted to the driver's assigned bus and active trip |

### Parent Tokens

| Item | Detail |
|---|---|
| Type | Time-limited secure tokens (not standard JWTs) |
| Secret | `PARENT_TOKEN_SECRET` |
| TTL | `PARENT_TOKEN_TTL_HOURS` (default `12`) |
| Scope | Single student context per token; no cross-student access |
| Delivery | Token embedded in WhatsApp message link to `parent-web/` |

---

## 6. Real-Time Delivery

### Server-Sent Events (SSE)

| Item | Detail |
|---|---|
| Service | `backend/src/services/realtime-feed.service.ts` |
| Transport | HTTP SSE — native Express `Response` streams |
| Consumers | `school-dashboard/` (fleet view), `parent-web/` (live bus position) |

### Pub-Sub Channels

| Channel pattern | Subscribers |
|---|---|
| `school:{id}` | School dashboard — all fleet events for a school |
| `trip:{id}` | Specific trip view — status, ETA, student attendance |
| `bus:{id}` | Real-time telemetry for a single bus |

### Event Emitter

- Internal pub-sub uses Node.js `EventEmitter`
- SSE listener ceiling: **2 000 concurrent listeners** before a warning is emitted (guards against memory leaks in high-connection scenarios)

### WebSocket (Driver Telemetry Ingestion)

| Item | Detail |
|---|---|
| Library | `ws` 8.18 |
| Direction | Driver app → backend (GPS telemetry push) |
| Offline buffer | `sqflite` on device; flushed on reconnect |

---

## 7. Storage Adapter

| Item | Detail |
|---|---|
| Adapter file | `backend/src/services/storage/storage.adapter.ts` |
| Pattern | Abstract adapter — concrete provider not yet wired |
| Status | Interface defined; cloud provider integration deferred to a future phase |

> **Note:** When a cloud storage provider is selected (e.g., GCS, S3-compatible), wire it into `storage.adapter.ts` without touching domain code.

---

## 8. Environment Variable Reference

| Variable | Workspace | Required | Description |
|---|---|---|---|
| `DATABASE_URL` | backend | ✅ | PostgreSQL connection string |
| `DB_MAX_CONNECTIONS` | backend | — | pg pool size (default `20`) |
| `ROUTING_PROVIDER` | backend | — | `osrm` \| `valhalla` \| `google` \| `mock` |
| `OSRM_BASE_URL` | backend | — | Override OSRM host (default public instance) |
| `MESSAGING_PROVIDER` | backend | — | `mock` \| `meta_cloud` \| `twilio` |
| `META_WA_PHONE_NUMBER_ID` | backend | Prod | Meta WhatsApp Business phone ID |
| `META_WA_ACCESS_TOKEN` | backend | Prod | Meta Graph API access token |
| `META_WA_WEBHOOK_VERIFY_TOKEN` | backend | Prod | Webhook challenge secret |
| `PARENT_TOKEN_SECRET` | backend | ✅ | Signing secret for parent access tokens |
| `PARENT_TOKEN_TTL_HOURS` | backend | — | Parent token lifetime (default `12`) |

---

## 9. Deferred / Out-of-Scope Integrations

The following are **explicitly not in scope** for the current build and must not be implemented:

| Integration | Status |
|---|---|
| Payments / subscription billing | ❌ Deferred — future commercial phase |
| CCTV / video streaming | ❌ Not in scope |
| RFID hardware | ❌ Not in scope |
| Face recognition | ❌ Not in scope |
| Payroll / ERP | ❌ Not in scope |
| Twilio (messaging) | Declared in env enum; adapter not yet implemented |
| Cloud storage provider | Interface defined; binding deferred |
