# Codebase Conventions

> Last updated: 2026-10-24 · Focus: quality

This document captures the established conventions, patterns, and rules across the
BUSLOARD monorepo. All contributors — human or AI — must follow these exactly.
Deviations require an explicit, justified exception tracked in a code review comment.

---

## 1. Language & Compiler

| Setting | Value |
|---|---|
| TypeScript version | 5.6 |
| `strict` | `true` |
| `noUncheckedIndexedAccess` | `true` |
| `exactOptionalPropertyTypes` | `false` |
| `target` | `ES2022` |
| `module` | `NodeNext` |

### Rules
- **No `@ts-ignore`** — explicitly prohibited by project rules in `AGENTS.md`. Use proper types, overloads, or runtime guards instead.
- **`as any` is technical debt** — 42 occurrences exist in the backend source as known debt. Do not add new ones; clean up existing ones incrementally.
- `noUncheckedIndexedAccess: true` means array/object index access returns `T | undefined`; always guard before use.
- Import paths for local modules must use the `.js` extension (NodeNext resolution), even when importing `.ts` source files.

---

## 2. Monorepo Structure

```
BUSLOARD/
├── backend/          # Node.js + TypeScript API server
│   ├── src/
│   │   ├── config/       # DB, env, app bootstrap
│   │   ├── controllers/  # Thin HTTP handlers
│   │   ├── middlewares/  # Auth, validation, error handling
│   │   ├── routes/       # Express router definitions
│   │   ├── services/     # All business logic (static methods)
│   │   └── utils/        # Pure helpers (response, crypto, etc.)
│   └── tests/            # Vitest test suite (70 files, 782 tests)
├── shared/           # @school-bus/shared — Zod schemas + shared types
│   └── src/
│       └── index.ts  # Single entry (~3488 lines of schemas + types)
├── dashboard/        # Next.js / React school admin UI
├── parent-web/       # Responsive parent tracking web view
├── driver-app/       # Flutter Android driver app
└── .planning/        # Planning, mapping, and phase documents
```

---

## 3. Error Handling

All service and controller errors use typed error classes. Import from
`backend/src/middlewares/error.middleware.ts`.

### Error Class Hierarchy

```typescript
AppError          // Base — carries statusCode and optional details
├── BadRequestError       // 400
├── UnauthorizedError     // 401
├── ForbiddenError        // 403
├── NotFoundError         // 404
├── ConflictError         // 409
├── ValidationError       // 422
└── TooManyRequestsError  // 429
```

### Centralized Error Handler

The Express `errorHandler` middleware (defined in `backend/src/middlewares/error.middleware.ts`)
is the **sole** place where errors are transformed into HTTP responses.

- Catches all errors propagated via `next(err)` or thrown in async handlers.
- `ZodError` is caught and reformatted into field-level details automatically.
- Never call `res.status(...).json(...)` inside a catch block — always `throw` or `next(err)`.

### Usage Pattern

```typescript
// In a service
if (!bus) throw new NotFoundError('Bus not found', { busId });

// In a controller — just let it propagate
const result = await BusService.getById(busId, schoolId);
return sendSuccess(res, result);
```

---

## 4. Request Validation

- **All route inputs** (body, query, params) are validated via Zod schemas.
- Schemas are defined in `shared/src/index.ts` and exported from `@school-bus/shared`.
- The `validate` middleware from `backend/src/middlewares/validate.middleware.ts`
  wraps `schema.parse()` and throws a `ValidationError` on failure.

### Attach Validation to Routes

```typescript
import { validate } from '../middlewares/validate.middleware.js';
import { CreateRouteSchema } from '@school-bus/shared';

router.post('/', authenticate, validate(CreateRouteSchema), controller.create);
```

- Do **not** call `schema.parse()` manually inside controllers or services — use the middleware.
- Query param schemas must use `.optional()` / `.default()` appropriately; never assume presence.

---

## 5. API Response Format

All successful responses are sent through helpers from
`backend/src/utils/response.util.ts`.

```typescript
// 200 OK
sendSuccess(res, data, message?)
// 201 Created
sendCreated(res, data, message?)
```

Wire format:

```json
{
  "success": true,
  "data": { ... },
  "message": "Optional human-readable label",
  "timestamp": "2026-10-24T18:00:00.000Z"
}
```

- **Never** hand-craft `res.json({ success: true, ... })` inline — always use the helpers.
- Error responses are shaped by `errorHandler` and have `success: false`.

---

## 6. Authentication & Authorization

Middleware chain from `backend/src/middlewares/`:

| Middleware | Purpose |
|---|---|
| `authenticateToken` | Extracts Bearer JWT; attaches `req.user` |
| `requireRoles(...roles)` | RBAC guard — pass allowed role strings |
| `requireActorTenantScope` | Ensures the acting user belongs to the request's school |
| `requireTenantScope` | Simpler school-level scope check |
| `authenticateDriver` | Driver-specific JWT auth (separate token type) |
| `parentTokenMiddleware` | Signed URL token for parent access — student-scoped |

### Ordering Convention

```typescript
router.get(
  '/:tripId',
  authenticateToken,          // 1. who are you?
  requireRoles('admin'),      // 2. are you allowed?
  requireActorTenantScope,    // 3. is this your school?
  controller.getTrip          // 4. handler
);
```

- Parent routes use `parentTokenMiddleware` **instead of** `authenticateToken` — never both.
- Driver routes use `authenticateDriver` **instead of** `authenticateToken`.

---

## 7. Service Pattern

### Static Class Methods

All services expose **static methods**. No instantiation; no DI container.

```typescript
// ✅ Correct
export class EtaService {
  static async calculateTripEta(tripId: string, schoolId: string): Promise<EtaResult> { ... }
}

// ❌ Wrong — do not use instances
const svc = new EtaService();
svc.calculateTripEta(...);
```

### Database Access

Use the typed helpers from `backend/src/config/database.ts`:

```typescript
import { query, transaction } from '../config/database.js';

// Single query
const rows = await query<BusRow>('SELECT * FROM buses WHERE school_id = $1', [schoolId]);

// Transaction
await transaction(async (client) => {
  await client.query('UPDATE ...', [...]);
  await client.query('INSERT ...', [...]);
});
```

- Every DB row returned must be typed with an explicit interface (e.g., `BusRow`, `TripRow`).
- **Never** use raw `pg.Pool` directly outside of `database.ts`.

### Responsibility Boundary

| Layer | Responsibility |
|---|---|
| Route | Register path + attach middleware chain |
| Controller | Parse `req`, call service, call `sendSuccess` |
| Service | Business logic, DB access, throw typed errors |
| Middleware | Cross-cutting concerns (auth, validation, error) |

Business logic **must not** live in controllers or routes. Controllers are thin adapters.

---

## 8. Provider Adapter Pattern

External integrations (routing, maps, WhatsApp, geocoding, storage) are always
hidden behind an interface. This allows swapping providers via environment variables
without touching business logic.

```typescript
// 1. Define interface (in shared or a local interfaces/ file)
export interface IRoutingProvider {
  calculateEta(origin: LatLng, destination: LatLng): Promise<EtaCalculationResult>;
}

// 2. Implement concrete adapter
export class OsrmRoutingAdapter implements IRoutingProvider {
  async calculateEta(...) { /* OSRM HTTP call */ }
}

// 3. Service selects adapter at runtime
class RoutingService {
  private static getProvider(): IRoutingProvider {
    const name = process.env.ROUTING_PROVIDER ?? 'osrm';
    if (name === 'osrm') return new OsrmRoutingAdapter();
    throw new Error(`Unknown routing provider: ${name}`);
  }
}
```

- Adapter selection is driven by environment variables — never hardcoded.
- Adapters must not contain business logic — only the transport/protocol translation.

---

## 9. Logging

Use the structured logger from `backend/src/services/logger.service.ts`.

```typescript
import { logger } from '../services/logger.service.js';

logger.info('Trip started', { tripId, schoolId, driverId });
logger.warn('ETA stale — falling back to scheduled time', { tripId });
logger.error('DB query failed', { error, query: sql });
```

Log format (JSON):

```json
{
  "timestamp": "2026-10-24T18:00:00.000Z",
  "level": "info",
  "message": "Trip started",
  "context": { "tripId": "...", "schoolId": "..." }
}
```

- **Do not use `console.log`** anywhere in application code — only in migrations or one-off scripts.
- Structured context (the second argument) is preferred over string interpolation.
- Levels: `debug` (dev tracing), `info` (operational events), `warn` (degraded but continuing), `error` (failure requiring attention).

---

## 10. Tenant Isolation

This is the most critical security invariant in the codebase.

### Rules

1. **Every DB query MUST include a `school_id = $N` filter** — no exceptions.
2. Cross-tenant access (requesting data from a school the caller does not belong to)
   must throw `ForbiddenError` and produce a `logger.warn` log entry.
3. Parent tokens are **student-scoped**, not school-scoped — validate `student_id` from
   the token, then derive `school_id` from the student record; do not trust a caller-supplied `school_id`.
4. `requireActorTenantScope` middleware enforces school-level isolation on admin/driver
   routes — always include it on protected routes.

```typescript
// ✅ Correct — always filter by schoolId
const rows = await query<StudentRow>(
  'SELECT * FROM students WHERE id = $1 AND school_id = $2',
  [studentId, schoolId]
);
if (rows.length === 0) throw new NotFoundError('Student not found');

// ❌ Wrong — missing school_id filter allows cross-tenant data leak
const rows = await query<StudentRow>('SELECT * FROM students WHERE id = $1', [studentId]);
```

---

## 11. Security Practices

- **Secrets validation at startup** — `SecurityUtil.validateProductionSecrets()` runs
  before the server accepts traffic; missing or weak secrets abort startup in production.
- **JWT secret** — minimum length enforced in production; rotating is a `config/` concern.
- **CORS** — whitelist driven by `CORS_ORIGINS` env var; wildcard origin is never acceptable in production.
- **HTTP headers** — Helmet is configured with CSP, HSTS, frameguard, `noSniff`.
- **Rate limiting** — `telemetryIngestRateLimiter` protects the GPS ingest endpoint;
  apply equivalent limiters to any high-frequency or unauthenticated endpoint.
- **`.env` files** — never committed. Only `.env.example` with placeholder values lives in source control.

---

## 12. Flutter (Driver App) Conventions

Located in `driver-app/`.

### File Naming
- Services: `snake_case_service.dart` (e.g., `telemetry_queue_service.dart`)
- Screens: `snake_case_screen.dart`
- Models: `snake_case_model.dart`

### Architecture
- Services are plain Dart classes (no Provider, Bloc, or Riverpod yet).
- `LocalDatabaseService` (sqflite) buffers all telemetry locally first — offline-first.
- `TelemetryQueueService` drains the local queue and uploads when the device is online.
- Speed values are **clamped to 160 km/h** before upload — never send raw unclamped GPS speed.

### Background Location
- GPS tracking runs in a background service (platform channel or a background_location plugin).
- Battery efficiency is a primary constraint — avoid excessive polling intervals.

---

## 13. Scope Boundaries (AGENTS.md Enforced)

The following features are **strictly prohibited** in this codebase. Do not implement,
scaffold, or stub them — not even as a comment:

| Prohibited Feature | Reason |
|---|---|
| Bus capacity / seat counting | Anti-pattern for this product |
| Bus active/inactive toggle | Managed via trip/route assignment instead |
| Parent child-selection dropdown | 1:1 student-token model; no switcher |
| One-parent-multiple-children complex workflow | Direct access per student link |
| Mandatory school approval for normal pickup | Direct coordinator workflow |
| Payments, invoicing, or subscriptions | Deferred to a future commercial phase |
| CCTV, RFID, face recognition, payroll | Out of scope entirely |
| Generic AI-generated SaaS aesthetics | No gradient cards, fake KPIs, stock art |

---

## 14. UI/UX Conventions (Dashboard & Parent Web)

- **Grid:** 8px base grid — all spacing, sizing, and layout in multiples of 8.
- **Color palette:** Neutral surface, single brand accent, four semantic status colors:
  - 🟢 Green — Normal / On-Time
  - 🟡 Amber — Delay / Warning
  - 🔴 Red — Incident / SOS
  - ⬛ Slate — Inactive / Offline
- **Maps** are operational canvases, not decorative backgrounds.
- **Motion** is used only for status transitions, live bus position updates, and user feedback — never decorative.
- **State completeness** — every data-fetching component must handle all six states:
  `Loading`, `Empty`, `Success`, `Validation Error`, `Failure/Retry`, `Unauthorized/Forbidden`, `Offline/Reconnecting`.
- **Zero hardcoded data** — no student names, bus IDs, coordinates, or business thresholds in UI component files.

---

## 15. Development Workflow

- **One micro-phase at a time:** Plan → Model/DB → API/Domain → UI/Client → Test → Verify → Document.
- **Type check before committing:** `tsc --noEmit` must pass with zero errors.
- **No regressions:** Run `npm test -w backend` and confirm 0 failures before marking a phase complete.
- **Dependency changes:** Log additions/removals explicitly in phase notes.
