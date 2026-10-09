# ADR 0003: Definition of Done (DoD) & Quality Gates

## Status
**Accepted** — 2026-10-09

## Context
In a mission-critical child transport and safety platform, partial implementations, unhandled network failures, missing error states, or unverified assumptions pose severe safety and operational risks. A strict, verifiable "Definition of Done" (DoD) is required before any feature or micro-phase can be marked as `Done`.

---

## The Master Definition of Done (DoD) Matrix

For every feature across the stack, the following 6 gates must be satisfied:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        6-TIER QUALITY GATES (DoD)                      │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Database & Schema Gate    │ • PostGIS indexes, Tenant isolation     │
│ 2. Domain & API Gate         │ • Zod validation, Typed DTOs, Adapters  │
│ 3. UI State Completeness     │ • 7 States: Load/Empty/Data/Err/Offline │
│ 4. Test Coverage Gate        │ • Unit + Domain Integration tests       │
│ 5. End-to-End (E2E) Gate     │ • Real telemetry/state transition flow  │
│ 6. Verification & Diff Gate  │ • Zero secrets, zero hardcoded fixtures │
└────────────────────────────────────────────────────────────────────────┘
```

### 1. Database & Persistence Layer Gate
- Schema migrations must be idempotent, strictly typed, and include tenant isolation foreign keys (`school_id`).
- Spatial columns must use PostGIS `GEOGRAPHY(Point, 4326)` or `GEOGRAPHY(Polygon, 4326)` with spatial GIST indexes (`CREATE INDEX ... USING GIST(geom)`).
- Temporal tracking data must have indexing on `(trip_id, recorded_at DESC)`.

### 2. Domain Logic & API Gate
- All inbound requests must be validated using runtime validation schemas (e.g. Zod).
- Domain services must be strictly isolated from HTTP/framework layers.
- External providers (WhatsApp, Maps, SMS) must be interfaced via provider adapters (`IMessagingProvider`, `IRoutingProvider`).
- No business logic or secret keys in controllers or client bundles.

### 3. UI & Client State Completeness Gate
Every interactive component or page MUST explicitly handle:
1. `Loading` (Skeleton / Shimmer / Spinner with layout stability)
2. `Empty` (Helpful illustration/text, no blank voids)
3. `Success / Data` (High-density, calm, 8px grid layout)
4. `Validation Error` (Inline field-level error messages)
5. `Failure / Server Error` (Human-readable message + Retry action)
6. `Unauthorized / Forbidden` (Clear auth redirect or permission banner)
7. `Offline / Reconnecting` (Persistent status banner with background queue sync)

### 4. Automated Testing Gate
- Every domain service must have unit test suites covering both sunny and rainy paths (e.g. invalid GPS coords, out-of-order timestamps, duplicate stop marks).
- Every API endpoint must have integration tests verifying schema validation, tenant isolation, and error status codes.

### 5. End-to-End (E2E) & State Transition Gate
- **No feature is marked `Done` without an end-to-end verification test:**
  - *Example for Trips:* Trip Scheduled $\rightarrow$ Started $\rightarrow$ GPS points ingested $\rightarrow$ Geofence evaluated $\rightarrow$ Parent notified $\rightarrow$ Trip Completed.
  - *Example for Attendance:* Driver marks boarding $\rightarrow$ PostGIS verifies stop radius $\rightarrow$ Attendance logged $\rightarrow$ WhatsApp message dispatched.

### 6. Code Quality, Security & Diff Gate
- `tsc --noEmit` must pass with zero TypeScript errors.
- Linter and formatter checks must pass without warnings.
- Diff review ensures:
  - ❌ Zero hardcoded test names, phone numbers, coordinates, or tokens in production code.
  - ❌ Zero API keys or secrets in source code.
  - ❌ Zero scope creep beyond the active micro-phase.

---

## Consequences
- **Positive:** Zero regressions, rock-solid reliability, production-grade safety guarantees, and deterministic deployment readiness.
- **Negative / Trade-off:** Requires rigorous test writing and verification reporting on every micro-phase before advancement.
