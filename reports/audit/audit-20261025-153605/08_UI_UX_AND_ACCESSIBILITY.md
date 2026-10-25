# TrackLoard — UI/UX, Design System & Accessibility Audit

- **Audit Identifier:** `audit-20261025-153605`
- **Audit Date:** 2026-10-25
- **Frontends Audited:**
  1. `@school-bus/school-dashboard` (Next.js 15, Tailwind CSS, Lucide Icons)
  2. `@school-bus/parent-web` (Next.js 15 App Router, Responsive Mobile Web)

---

## 1. UI/UX Design System & Aesthetics

### ThreeUI Operational Principles
The visual feel is calm, trustworthy, precise, and fast:
- **8px Grid Rhythm:** Padding, margins, and component dimensions adhere strictly to multiples of 8px (`p-2`, `p-4`, `p-6`, `gap-4`).
- **Surface Palette:** Clean neutral surfaces (`bg-slate-50`, `bg-white`, `border-slate-200`) prevent visual fatigue for school dispatchers monitoring screens throughout the day.
- **Semantic Status Signals:**
  - **Emerald / Green:** On-Time, Normal Operation, Healthy GPS, Present.
  - **Amber / Orange:** Delay Alert, Degraded GPS, Approaching Stop.
  - **Rose / Red:** Emergency SOS, Critical Incident, Route Deviation, Absent.
  - **Slate / Gray:** Scheduled / Inactive, Offline, Unassigned.
- **Maps as Functional Canvases:**
  Maps are interactive operational surfaces with clear iconography, stop sequence numbers, and directional bus arrows—never decorative backgrounds.

---

## 2. School Admin Dashboard Review

### Page Routing & Component Architecture
The dashboard compiles into 17 statically prerendered routes:
- `/admin/live`: Operational fleet command canvas. Shows live active bus positions, speed gauges, telemetry freshness indicators, and instant SOS alert banners.
- `/admin/buses`: Data-dense table of all school buses with registration formatting (DL-01-AB-1234), model metadata, and assigned route linkages.
- `/admin/drivers`: Driver roster with license verification status, bus assignments, and PIN credential resets.
- `/admin/students`: Complete student list with class/section chips, assigned pickup stops, and 1:1 parent contact link badges.
- `/admin/routes`: Multi-stop route manager showing ordered sequence stops, scheduled stop times, and PostGIS geocoded coordinates.
- `/admin/trips`: Real-time and historical trip monitoring with lifecycle control actions.
- `/admin/reports`: Operational reports, punctuality percentages, attendance summaries, and CSV export capabilities.

### State Completeness
Every data table and view handles the required 7 operational states:
1. `Loading`: Neutral skeleton shimmer animations.
2. `Empty`: Contextual illustrations with direct creation actions.
3. `Success / Data`: High-density responsive tables with pagination.
4. `Validation Error`: Inline red error notices with input highlighting.
5. `Failure / Retry`: Clear error message with "Try Again" action button.
6. `Unauthorized / Forbidden`: Clean 403 access denied redirection.
7. `Offline / Reconnecting`: Top bar badge alerting dispatcher of connection loss.

---

## 3. Parent Web Live View & Failure State UX

### Zero-App Barrier & WhatsApp Onboarding
Parents access live tracking directly through secure links sent via WhatsApp (`https://track.school.edu/track?token=...`), eliminating app store downloads, logins, or password friction.

### Live View Components
1. **Header Card:** Bus number, driver name, call button, active trip progress bar, and real-time ETA countdown.
2. **Interactive Map Canvas:**
   - SVG map renderer with OpenStreetMap tile background.
   - Heading-oriented bus marker that updates in real-time via Server-Sent Events (SSE).
   - Route polyline with pickup stops and highlighted student home stop.
3. **Failure States (Micro-phase 23.3):**
   - **Bus Offline:** Amber banner displaying last known update timestamp and advisory notice.
   - **Trip Ended:** Calm slate card stating the trip completed with arrival timestamp at school.
   - **Invalid or Expired Link:** Red security notice instructing the parent on how to request a fresh link via WhatsApp.
   - **Stale Location Warning:** Caution badge shown when telemetry is older than 2 minutes.

---

## 4. Accessibility & Responsive Verification

- **Color Contrast:** Text meets WCAG 2.1 AA standards ($> 4.5:1$ contrast ratio for body text, $> 3:1$ for large headings).
- **Touch Targets:** Buttons and interactive elements on mobile parent web maintain a minimum touch target size of $44 \times 44\text{ px}$.
- **Screen Reader Support:** Semantic HTML elements (`<main>`, `<nav>`, `<aside>`, `<header>`, `<table>`) with `aria-label` attributes on icon-only buttons.
- **Keyboard Navigation:** Modals, dialogs, and tables support full keyboard focus navigation (`Tab`, `Escape`, `Enter`).
