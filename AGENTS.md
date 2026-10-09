# Master Agent Prompt & Rules — AGENTS.md

## 1. Product Identity & Purpose
Build a production-grade school and college bus transportation safety and tracking platform for India.
- **Target Audience:** School Administrators, Drivers, and Parents.
- **Parent Experience:** WhatsApp-first notifications and interactions, plus a secure, responsive live web tracking page (no mandatory native parent app).
- **Driver Experience:** Minimal Flutter Android app for rock-solid background GPS tracking and telemetry; daily quick operations handled via WhatsApp (Start/End Trip, Student Search, Report Problem, Emergency/SOS, Help).
- **School Admin Experience:** High-density, calm, operational dashboard (Next.js/React) for fleet tracking, exception handling, route management, attendance, delays, and incident response.

---

## 2. Technical Architecture & Stack
- **Backend:** Node.js + TypeScript (modular, domain-driven, strictly typed).
- **Database:** PostgreSQL + PostGIS (geospatial indexing, spatial queries, geofencing, route matching).
- **Driver App:** Flutter Android (lightweight, battery-efficient, background location service).
- **School Dashboard:** Next.js / React (calm, data-dense, 8px grid, accessible).
- **Parent Web:** Responsive, secure, mobile-first web view.
- **Core Domains:**
  1. Authentication & School Isolation (Multi-tenant)
  2. School & Academic Setup
  3. Fleet & Vehicle Tracking (Bus)
  4. Driver Directory & Assignment
  5. Student & Parent Records
  6. Route & Pickup Stop Management
  7. Trip Lifecycle & State Machine (Scheduled, In-Progress, Completed, Cancelled)
  8. GPS Telemetry Ingestion & Real-Time Processing
  9. Geofencing & ETA Prediction Engine
  10. Student Pickup/Drop Attendance
  11. Notification & WhatsApp Dispatch Adapter
  12. Delay & Deviation Detection
  13. Incident & Emergency / SOS Dispatch
  14. Operational Reports & Audit Logs

---

## 3. Strict Scope Boundaries & Anti-Patterns (Explicit Non-Goals)
To prevent scope creep and keep the solution reliable, the following are strictly **PROHIBITED** unless explicitly introduced in a future phase:
- ❌ **NO Bus Capacity constraints:** Do not build seat counting or bus capacity limits.
- ❌ **NO Bus Active/Inactive toggles:** Buses are managed via active route and trip assignments.
- ❌ **NO Parent Child-Selection dropdowns / Switchers:** Direct context per student token/link.
- ❌ **NO One-Parent-Multiple-Children complex workflow:** Keep parent link 1:1 direct access.
- ❌ **NO Mandatory School Approval for normal pickup updates:** Direct verified coordinator workflow.
- ❌ **NO Payments, Invoicing, or Subscriptions:** Postponed until the final commercial phase.
- ❌ **NO CCTV / Video streaming, RFID hardware integration, Face Recognition, Payroll, or heavyweight ERP features.**
- ❌ **NO Generic AI-generated SaaS aesthetics:** No random gradient cards, fake KPI numbers, stock illustrations, or decorative WebGL.

---

## 4. Engineering & Code Standards
1. **Domain Logic Isolation:** Keep business logic in testable services/controllers, separate from UI components.
2. **Provider Adapters:** External providers (SMS/WhatsApp, Geocoding, Maps, Cloud Storage) MUST be behind abstract interfaces/adapters.
3. **Open-Source & Free First:** Leverage OSS tooling, open mapping primitives, and standards.
4. **State Completeness:** Every interface and data fetch MUST handle:
   - `Loading`
   - `Empty`
   - `Success / Data`
   - `Validation Error`
   - `Failure / Retry`
   - `Unauthorized / Forbidden`
   - `Offline / Reconnecting`
5. **Zero Hardcoded Data:** Never hardcode student names, bus IDs, coordinates, or business thresholds in UI files. Use typed models and isolated mock fixtures for tests.
6. **Security & Data Isolation:** Enforce strict school-level tenant isolation across all queries. Drivers only access assigned buses; parents access only authorized student trip tokens.

---

## 5. UI/UX Guidelines (Inspired by ThreeUI Interaction Quality)
- **Visual Feel:** Calm, trustworthy, precise, fast, human.
- **Color & Rhythm:** Neutral surfaces, single confident brand accent, restrained semantic status colors (Green = Normal/On-Time, Amber = Delay/Warning, Red = Incident/SOS, Slate = Inactive/Offline).
- **Information Density:** High information density without visual clutter; 8px grid.
- **Maps:** Maps are functional operational canvases, not decorative backgrounds.
- **Motion:** Subtle motion for status transitions, live bus updates, and feedback only.

---

## 6. Execution & Verification Protocol
- **One Micro-Phase at a Time:** Plan $\rightarrow$ Model/DB $\rightarrow$ API/Domain $\rightarrow$ UI/Client $\rightarrow$ Test $\rightarrow$ Verify $\rightarrow$ Document.
- **Verify Diff & Evidence:** Check for zero regressions, type integrity (`tsc`), linting, and clear dependency logging before completing each step.
