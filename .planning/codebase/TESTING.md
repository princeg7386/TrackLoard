# Testing Guide

> Last updated: 2026-10-24 · Focus: quality

This document describes the test framework, structure, naming conventions, mocking
patterns, and critical rules for every contributor (human or AI) adding or modifying
tests in the BUSLOARD monorepo.

---

## 1. Test Framework Overview

| Package | Framework | Runner command |
|---|---|---|
| `backend/` | Vitest 2.1 | `npm test -w backend` |
| `shared/` | — (covered by backend tests) | — |
| `driver-app/` | flutter_test (standard) | `flutter test` in `driver-app/` |
| `dashboard/` | None yet (scaffold stage) | — |
| `parent-web/` | None yet (scaffold stage) | — |

### Backend Runner Flags

The backend test command expands to:

```
vitest run --fileParallelism=false
```

- `--fileParallelism=false` is **mandatory** — tests run serially to avoid port conflicts,
  mock contamination, and shared in-process state corruption.
- Do not add `--parallel` or remove this flag.

---

## 2. Current Test Metrics

| Metric | Value (Phase 20.3) |
|---|---|
| Test files | 70 |
| Total tests | 782 |
| Failures | 0 |
| DB required | No (all mocked / in-process) |

These numbers grow with each phase. When adding tests, verify the total remains at 0 failures
before closing a phase.

---

## 3. Test File Location & Naming

All backend tests live in `backend/tests/`.

### Naming Convention

```
backend/tests/<domain>-<aspect>.test.ts
```

| Part | Description |
|---|---|
| `<domain>` | The feature domain (e.g., `eta`, `trip`, `driver-whatsapp`) |
| `<aspect>` | The specific slice being tested (e.g., `calculation`, `lifecycle`, `error-handling`) |

### Examples

```
backend/tests/eta-calculation.test.ts
backend/tests/eta-inputs.test.ts
backend/tests/eta-refresh.test.ts
backend/tests/telemetry-ingestion.test.ts
backend/tests/telemetry-processing.test.ts
backend/tests/driver-whatsapp-start-trip.test.ts
backend/tests/driver-whatsapp-error-handling.test.ts
backend/tests/trip-lifecycle.test.ts
backend/tests/trip-start.test.ts
```

When splitting a large test file by aspect, keep the domain prefix consistent so files
group together alphabetically.

---

## 4. Test File Structure

Every test file follows the same skeleton:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Service under test — static import only
import { EtaService } from '../src/services/eta.service.js';
// Dependencies to mock — static import only
import { RealtimeFeedService } from '../src/services/realtime-feed.service.js';

describe('Phase N.M — Feature Name', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear service-level caches if any:
    // EtaRefreshService.clearCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Success path ──────────────────────────────────────────────
  it('returns ETA for valid trip', async () => {
    // Arrange
    vi.spyOn(EtaService, 'assembleContext').mockResolvedValueOnce({ ... });

    // Act
    const result = await EtaService.calculateTripEta('trip-1', 'school-1');

    // Expect
    expect(result.etaMinutes).toBe(12);
  });

  // ── Error / edge paths ────────────────────────────────────────
  it('throws NotFoundError when trip does not exist', async () => { ... });
});
```

### Phase Labelling

Use the `Phase N.M — Feature Name` convention in `describe` blocks. This makes it easy
to trace which phase introduced a test and filter output by phase.

---

## 5. Import Rules

> [!IMPORTANT]
> Static top-level imports are **mandatory**. Dynamic `await import()` inside test bodies
> or `beforeEach`/`afterEach` blocks is **forbidden**.

```typescript
// ✅ Correct — static top-level
import { BusService } from '../src/services/bus.service.js';

// ❌ Wrong — dynamic import inside test body
it('...', async () => {
  const { BusService } = await import('../src/services/bus.service.js');
});
```

Vitest's module registry and `vi.spyOn` depend on stable module references established
at import time. Dynamic imports break spy registration and produce silent failures.

### Import Path Convention

From `backend/tests/` to services:

```
../src/services/<name>.service.js
../src/middlewares/<name>.middleware.js
../src/utils/<name>.util.js
../src/config/database.js
```

Always use the `.js` extension (NodeNext resolution) even though the source files are `.ts`.

---

## 6. Mocking Pattern

### Service Method Mocks with `vi.spyOn`

```typescript
// Mock a single call
vi.spyOn(EtaService, 'assembleContext').mockResolvedValueOnce({
  trip: mockTrip,
  stops: mockStops,
  telemetry: mockTelemetry,
});

// Mock for all calls in a test
vi.spyOn(BusService, 'getById').mockResolvedValue(mockBus);

// Assert a side-effect service was called
vi.spyOn(RealtimeFeedService, 'publish');
expect(RealtimeFeedService.publish).toHaveBeenCalledWith('trip:update', expect.objectContaining({ tripId: 'trip-1' }));
```

### Database Mocking

Tests must **never** connect to a real database.

- Mock the `query` and `transaction` helpers from `backend/src/config/database.ts`:

```typescript
import { query, transaction } from '../src/config/database.js';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
}));

// In a test:
(query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([mockBusRow]);
```

- Alternatively, mock the entire service that wraps the DB call, which is often cleaner.

### Resetting Mocks

```typescript
beforeEach(() => {
  vi.clearAllMocks();           // Reset call history and return values
  EtaRefreshService.clearCache(); // Clear any in-process module-level caches
});

afterEach(() => {
  vi.restoreAllMocks();         // Restore original implementations (for vi.spyOn)
});
```

Both `clearAllMocks` and `restoreAllMocks` are needed: clear resets call counts before each
test; restore returns spied originals after each test so the next test starts clean.

---

## 7. State Compliance Testing

Every feature must have test coverage for **all six states**. This is not optional —
it is a project-level requirement derived from `AGENTS.md`.

| State | What to test |
|---|---|
| **Success** | Happy path returns correct data |
| **Empty / not found** | Missing resource throws `NotFoundError` |
| **Validation error** | Invalid input throws `ValidationError` or is rejected by Zod |
| **Forbidden** | Wrong `school_id` → `ForbiddenError` (tenant isolation) |
| **Auth failure** | No / invalid token → `UnauthorizedError` |
| **Loading / async** | Async flows resolve in expected order |

```typescript
describe('Phase 12.1 — Bus Retrieval', () => {
  it('returns bus for valid id and matching school', async () => { ... });
  it('throws NotFoundError when bus does not exist', async () => { ... });
  it('throws ForbiddenError when bus belongs to different school', async () => { ... });
  it('throws UnauthorizedError when no auth token provided', async () => { ... });
  it('throws ValidationError when busId is not a UUID', async () => { ... });
});
```

---

## 8. Special Test Files

These files have cross-cutting scope and must be kept up to date with every phase:

| File | Purpose |
|---|---|
| `backend/tests/core-entities.test.ts` | Schema shape validation — confirms Zod schema structure for all core entities |
| `backend/tests/api-skeleton.test.ts` | Route registration audit — every declared route must be resolvable |
| `backend/tests/security-audit.test.ts` | Auth and tenant middleware presence on every protected route |
| `backend/tests/roles-and-isolation.test.ts` | RBAC correctness and cross-tenant isolation |
| `backend/tests/db-quality-and-seed.test.ts` | Seed data integrity and foreign key consistency |
| `audit-tests/consistency.test.ts` | Cross-repo consistency checks (shared schema ↔ backend ↔ migrations) |

> [!WARNING]
> Never skip or comment out tests in these files to make a phase pass. Fix the underlying issue instead.

---

## 9. Writing Tests for a New Feature

Follow this checklist when adding a new service or route:

1. **Create** `backend/tests/<domain>-<aspect>.test.ts`.
2. **Label** the `describe` block with the current phase: `'Phase N.M — Feature Name'`.
3. **Import** the service under test and all dependencies statically.
4. **Mock** all DB calls and external service calls.
5. **Add `beforeEach`** to clear mocks and any module-level caches.
6. **Add `afterEach`** calling `vi.restoreAllMocks()`.
7. **Cover all six states** (see §7).
8. **Run** `npm test -w backend` — verify 0 failures.
9. **Check** that `backend/tests/security-audit.test.ts` still passes (new routes need auth middleware).

---

## 10. Flutter Tests

Flutter tests live in `driver-app/test/` and use the standard `flutter_test` package.

```bash
# Run all Flutter tests
flutter test
```

### Conventions
- Test files mirror the `lib/` structure: `test/services/telemetry_queue_service_test.dart`.
- Use `mockito` or manual fakes for service dependencies.
- Background location and sqflite are always mocked — no device required.

---

## 11. What Tests Are NOT

- **No end-to-end or browser tests** — no Playwright, Cypress, or WebDriver at this stage.
- **No real DB** — even integration tests use mocked DB helpers.
- **No real HTTP** — no live server; use direct service/controller calls or `supertest`
  with a mounted Express app (no external network).
- **No snapshot tests** — avoid brittle snapshot assertions on large objects; prefer
  `expect.objectContaining({ ... })`.

---

## 12. Quick Reference

```bash
# Run all backend tests
npm test -w backend

# Run a specific test file
npx vitest run backend/tests/eta-calculation.test.ts

# Run tests matching a name pattern
npx vitest run --reporter=verbose -t "ForbiddenError"

# Run Flutter tests
flutter test
```

Import path template (from `backend/tests/`):

```typescript
import { XyzService } from '../src/services/xyz.service.js';
```

Mock reset template:

```typescript
beforeEach(() => { vi.clearAllMocks(); /* clearCache() calls */ });
afterEach(() => { vi.restoreAllMocks(); });
```
