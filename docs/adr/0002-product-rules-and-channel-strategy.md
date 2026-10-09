# ADR 0002: Product Rules and Channel Architecture Strategy

## Status
**Accepted** — 2026-10-09

## Context
In Indian school transport operations, high friction in app installation, battery drain, intermittent 4G/cellular data, and varying levels of digital literacy among drivers and parents frequently lead to system abandonment. To achieve maximum adoption and operational reliability, the interaction channel strategy must be optimized for zero friction, maximum accessibility, and minimal operational cost.

## Decision & Product Rules

### 1. WhatsApp-First for Simple Parent & Driver Actions
* **Parent Channel:**
  - Automated WhatsApp alerts triggered on critical milestones:
    1. Trip Started (Morning/Afternoon).
    2. Proximity Alert (Bus is 5–10 mins away / Entering stop geofence).
    3. Student Boarded / Deboarded (attendance confirmation).
    4. Trip Delayed / Route Deviation / Incident alert.
  - Interactive Parent actions via WhatsApp: Check Status, Query ETA, Report Absent.
* **Driver Channel:**
  - WhatsApp quick-action bot for daily transit operations:
    1. `/start` — Start scheduled trip.
    2. `/end` — Complete trip.
    3. `/search <name/id>` — Quick student lookup.
    4. `/problem <text>` — Report traffic / vehicle / road issue.
    5. `/sos` — Priority emergency alert to school transport coordinator.
    6. `/help` — List available commands.

### 2. Zero Mandatory Parent App (Secure Live Web View)
* **Rule:** Parents are NOT required to download an app from Play Store / App Store.
* **Live Web View:**
  - WhatsApp notifications contain a secure, time-limited, signed token link: `https://track.schoolbus.app/t/{token}`.
  - Opens instantly in any mobile browser (Safari, Chrome, Firefox, WhatsApp in-app browser).
  - Clean, responsive mobile interface displaying:
    - Live bus location pin on an interactive map.
    - Current stop sequence, child's pickup point, and live dynamic ETA.
    - Bus driver name and verified one-tap call button.
    - Safety reassurance badges (Last updated timestamp, bus speed).

### 3. Minimal Driver Android App Dedicated to Background Telemetry
* **Rule:** The driver app does ONE thing with 100% reliability — background GPS tracking and telemetry ingestion.
* **Core Responsibilities:**
  - Android Foreground Service with continuous wake-lock.
  - High-precision location updates (sampled every 3–5 seconds, throttled or batched depending on motion).
  - SQLite local buffer queue for offline caching during cellular dead zones.
  - Auto-flushing telemetry upon network recovery.
  - Large, tactile, high-contrast Start/Stop button and emergency SOS trigger.
* **Cognitive Load:** Minimalist UI, large fonts, no unnecessary dashboards or complex forms.

### 4. Free & Open-Source First (FOSS Priority)
* **Mapping & GIS:**
  - Primary: OpenStreetMap (OSM) map tiles, PostGIS for geospatial indexing and geofencing.
  - Routing & Matrix: OSRM (Open Source Routing Machine) or Valhalla for open-source turn-by-turn routing and ETA distance matrices.
  - Map Rendering: MapLibre GL / Leaflet for zero-licensing-cost, lightweight web rendering.
* **Pluggable Paid Fallbacks (Via Abstract Adapters):**
  - Mapping: Abstract `IMapProvider` / `IRoutingProvider` allows drop-in replacement with Google Maps or Mapbox if a school requires satellite traffic data.
  - Messaging: Abstract `IMessagingProvider` supports Meta Cloud WhatsApp API, Gupshup, Twilio, or Baileys/WPPConnect open-source WhatsApp bridges.

## Consequences
- **Positive:**
  - **Parent Adoption:** 100% immediate reach without app store friction or storage issues on entry-level smartphones.
  - **Driver Compliance:** Near-zero training required; drivers already know how to use WhatsApp; background app runs silently.
  - **Infrastructure Cost:** Drastically reduced mapping and messaging costs by relying on FOSS primitives with enterprise adapter fallback.
- **Negative / Mitigations:**
  - WhatsApp API message costs: Optimized by sending combined milestone messages and using the live web tracking link for continuous real-time view rather than spamming per-second WhatsApp updates.
