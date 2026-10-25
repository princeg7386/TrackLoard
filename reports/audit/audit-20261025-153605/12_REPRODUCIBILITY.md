# TrackLoard — Engineering Audit Reproducibility Guide

- **Audit Identifier:** `audit-20261025-153605`
- **Target Git Commit:** `9015de9e2f9b028f364f25f8fc761b4e2b3529de`
- **Target Audience:** Any software engineer, QA lead, or AI coding assistant reproducing or remediating this audit.

---

## 1. Environment & Prerequisite Baseline

| Tool | Audited Version | Minimum Supported | Installation / Check |
| :--- | :--- | :--- | :--- |
| **Node.js** | `v22.17.1` | `>= 20.10.0 LTS` | `node --version` |
| **npm** | `10.9.2` | `>= 10.0.0` | `npm --version` |
| **Flutter** | `3.24.5` (Dart `3.5.4`)| `>= 3.22.0` | `flutter --version` |
| **Docker** | `29.8.2` | `>= 24.0.0` | `docker --version` |
| **Git** | `2.51.0` | `>= 2.30.0` | `git --version` |

---

## 2. Workspace Initialization

Execute the following commands in the root repository directory:
```bash
# 1. Clean checkout
git checkout main
git pull origin main

# 2. Install monorepo dependencies across all workspaces
npm install

# 3. Build the core shared ESM library (mandatory prerequisite)
npm --prefix shared run build
```

---

## 3. Test Reproduction Protocol

### Step A: Verify Full Backend Vitest Suite (928 tests)
```bash
npm --prefix backend run test
```
*Expected Result:* Exit code `0`. 83 test files passed, 928 tests passed in ~60 seconds.

### Step B: Verify Production Builds (School Dashboard & Parent Web)
```bash
# School Dashboard (17 routes)
npm --prefix school-dashboard run build

# Parent Web (5 routes)
npm --prefix parent-web run build
```
*Expected Result:* Both exit with code `0`, confirming complete static prerendering and zero Next.js type errors.

### Step C: Verify Flutter Driver Client
```bash
cd driver-app

# 1. Static Analysis
flutter analyze
# Expected Result: Exit code 0 ("No issues found!").

# 2. Widget Smoke Test (Reproduces BUG-001)
flutter test
# Expected Result: Exit code 1 with:
# "A Timer is still pending even after the widget tree was disposed"
cd ..
```

### Step D: Execute Root Audit Tests (Reproduces BUG-002 and BUG-003)
```bash
# 1. Route Auth Whitelist Test (Reproduces BUG-002)
npm run test:audit
# Expected Result: Exit code 1 with:
# "UNAUTHENTICATED: GET /api/v1/parent/track/:token/verify-entry"

# 2. Consistency Cross-Layer Test (Reproduces BUG-003)
npx tsx --test audit-tests/consistency.test.ts
# Expected Result: Exit code 1 with:
# "not ok 9 - parent admin routes restrict role: ['/track/:token/verify-entry']"
```

---

## 4. Local Development Environment Spin-up

To run the complete platform locally with live database and UI servers:

```bash
# 1. Start PostgreSQL 16 + PostGIS and Redis
docker-compose -f infrastructure/docker-compose.yml up -d

# 2. Apply all 21 database migrations
npm --prefix backend run db:migrate

# 3. Seed demonstration fleet, schools, drivers and routes
npm --prefix backend run db:seed

# 4. Launch backend API (Port 4000)
npm run dev:backend

# 5. Launch School Admin Dashboard (Port 3000)
npm run dev:admin

# 6. Launch Parent Live Web View (Port 3001)
npm run dev:parent
```
