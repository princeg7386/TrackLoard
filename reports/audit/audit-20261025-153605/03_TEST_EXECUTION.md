# TrackLoard — Comprehensive Test Execution Log & Results

- **Audit Identifier:** `audit-20261025-153605`
- **Execution Date:** 2026-10-25
- **Host OS:** Windows 11 (PowerShell)
- **Node.js Version:** `v22.17.1`
- **npm Version:** `10.9.2`
- **Flutter Version:** `3.24.5` (Dart `3.5.4`)

---

## 1. Test Execution Summary Matrix

| # | Test Suite / Command | CWD | Exit Code | Result | Duration | Tests Passed / Total |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **T01** | `npx tsc --noEmit -p shared/tsconfig.json` | `shared/` | `0` | **PASS** | 4.0s | N/A (Static Types) |
| **T02** | `npx tsc --noEmit -p backend/tsconfig.json` | `backend/` | `0` | **PASS** | 5.0s | N/A (Static Types) |
| **T03** | `npm --prefix school-dashboard run typecheck` | `school-dashboard/` | `0` | **PASS** | 7.0s | N/A (Static Types) |
| **T04** | `npm --prefix school-dashboard run build` | `school-dashboard/` | `0` | **PASS** | 29.0s | 17 / 17 Pages Built |
| **T05** | `npm --prefix parent-web run typecheck` | `parent-web/` | `0` | **PASS** | 3.0s | N/A (Static Types) |
| **T06** | `npm --prefix parent-web run build` | `parent-web/` | `0` | **PASS** | 18.0s | 5 / 5 Pages Built |
| **T07** | `flutter analyze` | `driver-app/` | `0` | **PASS** | 72.4s | 0 Issues Found |
| **T08** | `flutter test` | `driver-app/` | `1` | **FAIL** | 15.0s | 0 / 1 (Timer leak) |
| **T09** | `npm run test:audit` | Root | `1` | **FAIL** | 3.0s | 24 / 25 Passed |
| **T10** | `npx tsx --test audit-tests/consistency.test.ts` | Root | `1` | **FAIL** | 2.0s | 25 / 26 Passed |
| **T11** | `npm --prefix backend run test` (Vitest) | `backend/` | `0` | **PASS** | 61.27s | **928 / 928 Passed (83 files)** |
| **T12** | `audit-tests/e2e-smoke.mjs` (Live PostGIS DB) | Root | N/A | **BLOCKED** | N/A | Docker daemon offline |

---

## 2. Detailed Execution Logs & Captured Output

### Test T01 — Shared Package Typecheck
- **Command:** `npx tsc --noEmit -p shared/tsconfig.json`
- **Exit Code:** `0`
- **Output:** Clean compilation with 0 diagnostics.

### Test T02 — Backend TypeScript Typecheck
- **Command:** `npx tsc --noEmit -p backend/tsconfig.json`
- **Exit Code:** `0`
- **Output:** Clean compilation with 0 diagnostics.

### Test T03 & T04 — School Dashboard Typecheck & Production Build
- **Command:** `npm --prefix school-dashboard run build`
- **Exit Code:** `0`
- **Sanitized Output:**
```
▲ Next.js 15.5.27
Creating an optimized production build ...
✓ Compiled successfully in 3.5s
Linting and checking validity of types ...
Collecting page data ...
✓ Generating static pages (17/17)
Finalizing page optimization ...

Route (app)                                 Size  First Load JS
┌ ○ /                                      123 B         102 kB
├ ○ /_not-found                            995 B         103 kB
├ ○ /admin                               8.68 kB         114 kB
├ ○ /admin/account                       4.68 kB         133 kB
├ ○ /admin/buses                           15 kB         147 kB
├ ○ /admin/drivers                       17.2 kB         149 kB
├ ○ /admin/live                          11.7 kB         143 kB
├ ○ /admin/profile                       5.93 kB         134 kB
├ ○ /admin/reports                       6.03 kB         134 kB
├ ○ /admin/routes                        11.9 kB         144 kB
├ ○ /admin/safety                        5.44 kB         107 kB
├ ○ /admin/students                      27.1 kB         159 kB
├ ○ /admin/trips                         9.68 kB         141 kB
├ ○ /login                               3.93 kB         106 kB
└ ○ /track                               10.4 kB         138 kB
```

### Test T05 & T06 — Parent Web Typecheck & Production Build
- **Command:** `npm --prefix parent-web run build`
- **Exit Code:** `0`
- **Sanitized Output:**
```
▲ Next.js 15.5.27
Creating an optimized production build ...
✓ Compiled successfully in 2.1s
Linting and checking validity of types ...
✓ Generating static pages (5/5)
Finalizing page optimization ...

Route (app)                                 Size  First Load JS
┌ ○ /                                      162 B         140 kB
├ ○ /_not-found                            995 B         103 kB
└ ○ /track                                 161 B         140 kB
```

### Test T07 — Driver App Static Analysis
- **Command:** `flutter analyze`
- **Exit Code:** `0`
- **Output:**
```
Analyzing driver-app...
No issues found! (ran in 72.4s)
```

### Test T08 — Driver App Widget Test (Failed)
- **Command:** `flutter test`
- **Exit Code:** `1`
- **Stack Trace & Error:**
```
00:00 +0 -1: Driver app smoke test [E]
══╡ EXCEPTION CAUGHT BY FLUTTER TEST FRAMEWORK ╞════════════════════════════════════════════════════
The following assertion was thrown running a test:
A Timer is still pending even after the widget tree was disposed.
'package:flutter_test/src/binding.dart':
Failed assertion: line 1542 pos 12: '!timersPending'
```
- **Analysis:** `DriverTelemetryApp` in `lib/main.dart` initialises a periodic timer (GPS capture simulation or heartbeat) upon mounting, but does not cancel it on disposal or provide a mockable configuration in `widget_test.dart`.

### Test T09 — Root Route Auth Audit (`route-auth.test.ts`)
- **Command:** `npm run test:audit`
- **Exit Code:** `1`
- **Assertion Failure:**
```
# Subtest: every non-public route requires authentication (94 routes scanned)
not ok 8 - every non-public route requires authentication (94 routes scanned)
  error: |-
    UNAUTHENTICATED:
      GET /api/v1/parent/track/:token/verify-entry
      GET /api/v1/parent/track/verify-entry
    + actual - expected
    + [
    +   'GET /api/v1/parent/track/:token/verify-entry',
    +   'GET /api/v1/parent/track/verify-entry'
    + ]
    - []
```
- **Analysis:** Micro-phase 23.1 added public live token entry validation endpoints without updating the static audit whitelist `PUBLIC` set in `audit-tests/route-auth.test.ts`.

### Test T10 — Root Consistency Audit (`consistency.test.ts`)
- **Command:** `npx tsx --test audit-tests/consistency.test.ts`
- **Exit Code:** `1`
- **Assertion Failure:**
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
- **Analysis:** The test regex `r.path.match(/identity|token\//)` incorrectly categorises `/track/:token/verify-entry` as an admin route requiring `requireRoles`, because it contains the path parameter token `:token/`.

### Test T11 — Backend Vitest Test Suite (Passed)
- **Command:** `npm --prefix backend run test`
- **Exit Code:** `0`
- **Summary:**
```
 Test Files  83 passed (83)
      Tests  928 passed (928)
   Start at  15:44:18
   Duration  61.27s
```
- **Scope Covered:** 83 test suites verifying authentication, tenant isolation, driver management, student assignments, GPS deduplication, geofencing, ETA calculations, delay detections, driver WhatsApp webhooks, parent tracking tokens, SSE feeds, and live web endpoints.

### Test T12 — Live End-to-End Database Smoke Test (`e2e-smoke.mjs`)
- **Command:** `node audit-tests/e2e-smoke.mjs`
- **Status:** **BLOCKED (HOST ENVIRONMENT)**
- **Reason:** Docker daemon is not active on host machine (`open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`). Mock-based database integration tests in Vitest executed with 100% pass rate.
