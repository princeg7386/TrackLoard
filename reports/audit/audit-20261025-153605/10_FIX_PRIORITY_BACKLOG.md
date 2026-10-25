# TrackLoard — Prioritised Engineering Fix & Remediation Backlog

- **Audit Identifier:** `audit-20261025-153605`
- **Audit Date:** 2026-10-25
- **Prioritisation Criteria:** Severity $\times$ Blast Radius $\times$ CI/Production Impact

---

## 1. Remediation Backlog Matrix

| Rank | Issue ID | Severity | Category | Target File(s) | Estimated Effort |
| :---: | :--- | :--- | :--- | :--- | :---: |
| **P1** | **BUG-001** | **High** | Test / CI | `driver-app/lib/main.dart`, `driver-app/test/widget_test.dart` | **S** (< 1 hour) |
| **P2** | **BUG-002** | **High** | Test / CI | `audit-tests/route-auth.test.ts` | **S** (< 15 mins) |
| **P3** | **BUG-003** | **High** | Test / CI | `audit-tests/consistency.test.ts` | **S** (< 15 mins) |
| **P4** | **SEC-001** | **Medium** | Security | `backend/src/routes/parent-identity.routes.ts` | **S** (< 30 mins) |
| **P5** | **SEC-002** | **Medium** | Security | `backend/src/services/realtime-feed.service.ts` | **M** (2–3 hours) |
| **P6** | **GAP-003** | **Medium** | Database | `backend/src/db/migrations/`, `backend/src/db/migrate.ts` | **M** (4 hours) |
| **P7** | **GAP-001** | **Low** | Integration | `backend/src/services/messaging/`, `.env.example` | **M** (2–4 hours) |
| **P8** | **GAP-002** | **Low** | Performance | `infrastructure/docker-compose.yml`, `backend/src/services/routing/` | **L** (1–2 days) |

---

## 2. Actionable Issue Specifications

### P1: Fix Flutter Driver App Smoke Test Timer Assertion (BUG-001)
- **Problem:** `flutter test` fails with `!timersPending` because `DriverTelemetryApp` starts background tickers/timers that outlive widget tree disposal.
- **Remediation Specification:**
  1. In `driver-app/lib/main.dart`, expose an optional parameter `enableBackgroundTickers = true`.
  2. In `driver-app/test/widget_test.dart`, instantiate `DriverTelemetryApp(enableBackgroundTickers: false)` or invoke `await tester.pumpWidget(...)` followed by disposing background controllers.

### P2: Update Audit Route Auth Whitelist (BUG-002)
- **Problem:** `npm run test:audit` fails because `audit-tests/route-auth.test.ts` does not include public parent entry verification endpoints in its whitelist.
- **Remediation Specification:**
  Update line 19 of `audit-tests/route-auth.test.ts`:
  ```typescript
  const PUBLIC = new Set([
    'POST /api/v1/auth/login', 'POST /api/v1/auth/logout', 'POST /api/v1/auth/forgot-password', 'POST /api/v1/auth/reset-password',
    'POST /api/v1/driver/auth/login', 'POST /api/v1/driver/auth/logout',
    'GET /api/v1/parent/track/:token', 'GET /api/v1/parent/track', 
    'GET /api/v1/parent/track/:token/verify-entry', 'GET /api/v1/parent/track/verify-entry',
    'GET /api/v1/parent/onboard/verify', 'POST /api/v1/parent/onboard/confirm',
  ]);
  ```

### P3: Fix Regex Collision in Consistency Test (BUG-003)
- **Problem:** `consistency.test.ts` incorrectly matches `/track/:token/verify-entry` with `/token\//` and expects school admin `requireRoles` on a public parent route.
- **Remediation Specification:**
  Update line 98 in `audit-tests/consistency.test.ts`:
  ```typescript
  test('parent admin routes restrict role', () => {
    const weak = routeBlocks('backend/src/routes/parent-identity.routes.ts')
      .filter((r) => !r.path.startsWith('/track'))
      .filter((r) => /identity|token\//.test(r.path))
      .filter((r) => !/requireRoles|requirePermission/.test(r.block))
      .map((r) => r.path);
    assert.deepEqual(weak, []);
  });
  ```

### P4: Attach Rate Limiting to Parent Token Verify Entry (SEC-001)
- **Problem:** Public endpoints `/track/:token/verify-entry` and `/track/verify-entry` do not have `parentTokenRateLimiter` applied.
- **Remediation Specification:**
  In `backend/src/routes/parent-identity.routes.ts`:
  ```typescript
  parentRouter.get(
    '/track/:token/verify-entry',
    parentTokenRateLimiter,
    ParentIdentityController.verifyLiveWebEntry
  );
  parentRouter.get(
    '/track/verify-entry',
    parentTokenRateLimiter,
    ParentIdentityController.verifyLiveWebEntry
  );
  ```

### P5: SSE Connection Termination on Parent Token Revocation (SEC-002)
- **Problem:** Revoking a parent token does not instantly disconnect active SSE streams.
- **Remediation Specification:**
  In `realtime-feed.service.ts`, maintain a Map of active parent token SSE connections. When `ParentIdentityService.revokeToken()` is called, invoke `RealtimeFeedService.closeParentStreams(tokenId)` to terminate the HTTP response immediately.

### P6: Database Down-Migrations (GAP-003)
- **Problem:** Migrations 001 through 021 are up-only.
- **Remediation Specification:**
  Create paired `.down.sql` scripts for all 21 migrations and implement `npm run db:rollback` in `backend/src/db/migrate.ts`.
