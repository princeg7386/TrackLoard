# TrackLoard — Bugs, Defects & Integration Gaps

- **Audit Identifier:** `audit-20261025-153605`
- **Audit Date:** 2026-10-25

---

## 1. Concrete Code Defects & Test Failures

### BUG-001: Flutter Driver App Smoke Test Timer Assertion Failure
- **Severity:** High (CI Blocker)
- **Component:** `driver-app/lib/main.dart` & `driver-app/test/widget_test.dart`
- **Reproduction:** Run `flutter test` in `driver-app/`
- **Output:**
  ```
  A Timer is still pending even after the widget tree was disposed.
  'package:flutter_test/src/binding.dart':
  Failed assertion: line 1542 pos 12: '!timersPending'
  ```
- **Root Cause:** When `DriverTelemetryApp` is mounted by `tester.pumpWidget()`, internal services (such as GPS simulation timers, battery monitoring tickers, or location sync timers) are started as periodic asynchronous timers. When the widget test completes, these pending timers remain active in the Dart event loop, violating Flutter Test Framework's clean tree assertion.
- **Recommended Fix:** 
  1. Add a `dispose()` lifecycle method to cancel active timers in background services.
  2. In `widget_test.dart`, use `await tester.pumpAndSettle()` or provide an environment flag to disable background ticker simulation during unit tests.

---

### BUG-002: Audit Route Auth Whitelist Desynchronisation
- **Severity:** Medium (CI Blocker)
- **Component:** `audit-tests/route-auth.test.ts`
- **Reproduction:** Run `npm run test:audit` at repository root
- **Output:**
  ```
  not ok 8 - every non-public route requires authentication (94 routes scanned)
    error: |-
      UNAUTHENTICATED:
        GET /api/v1/parent/track/:token/verify-entry
        GET /api/v1/parent/track/verify-entry
  ```
- **Root Cause:** In Micro-phase 23.1, two public token-verification endpoints were introduced in `backend/src/routes/parent-identity.routes.ts` (`/track/:token/verify-entry` and `/track/verify-entry`). The static route security scanner `audit-tests/route-auth.test.ts` maintains a static `PUBLIC` Set that was not updated with these endpoints, causing an assertion failure.
- **Recommended Fix:** Add `'GET /api/v1/parent/track/:token/verify-entry'` and `'GET /api/v1/parent/track/verify-entry'` to the `PUBLIC` set in `audit-tests/route-auth.test.ts`.

---

### BUG-003: Audit Consistency Route Matching False Positive
- **Severity:** Medium (CI Blocker)
- **Component:** `audit-tests/consistency.test.ts`
- **Reproduction:** Run `npx tsx --test audit-tests/consistency.test.ts` at repository root
- **Output:**
  ```
  not ok 9 - parent admin routes restrict role
    error: |-
      Expected values to be strictly deep-equal:
      + actual - expected
      + [
      +   '/track/:token/verify-entry'
      + ]
      - []
  ```
- **Root Cause:** In `audit-tests/consistency.test.ts`, line 98 checks for unauthenticated admin routes using the regular expression:
  ```typescript
  routeBlocks('backend/src/routes/parent-identity.routes.ts')
    .filter((r) => /identity|token\//.test(r.path))
    .filter((r) => !/requireRoles|requirePermission/.test(r.block))
  ```
  Because `/track/:token/verify-entry` contains `:token/`, it matches `token\/` and is mistakenly evaluated as an administrative token endpoint rather than a public parent token verification endpoint.
- **Recommended Fix:** Refine the regular expression to match admin token endpoints strictly (e.g. `/^\/(?:identity|token\/)/` or excluding `/track/`).

---

## 2. Integration & Infrastructure Gaps

### GAP-001: Production WhatsApp Messaging Provider
- **Status:** **MOCK / SIMULATOR READY**
- **Detail:** In local development and automated testing, `MESSAGING_PROVIDER=mock` captures outbound WhatsApp messages to in-memory buffers and logger outputs. Production deployment requires live Meta Cloud WhatsApp Business API credentials (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`) or Twilio credentials.

### GAP-002: Public OSRM Routing Rate Limits
- **Status:** **FREE-TIER DEFAULT**
- **Detail:** The default routing engine connects to `https://router.project-osrm.org`. This public server provides excellent zero-cost routing for testing and development, but is subject to fair-use rate limiting. For high-density fleets (100+ buses emitting telemetry every 5 seconds), a self-hosted Valhalla/OSRM Docker container or paid Google Maps Roads API key is recommended.

### GAP-003: Database Down-Migrations Absent
- **Status:** **OPERATIONAL RISK**
- **Detail:** All 21 migrations in `backend/src/db/migrations/` provide `UP` SQL statements. No `DOWN` rollback files or transactional rollback downgrade scripts exist.
