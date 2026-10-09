# ADR 0001: Scope Exclusions and MVP Guardrails

## Status
**Accepted** — 2026-10-09

## Context
In building a production-grade school and college bus transportation safety and tracking platform for India, scope creep is a major risk. Hardware dependencies, complex enterprise ERP features, billing logic, and convoluted multi-child workflows often derail transport tracking core reliability.

To ensure operational excellence, high reliability, battery efficiency, and rapid deployment in Indian school environments, clear architectural and scope boundaries must be formally locked.

## Decision & Explicit Scope Exclusions

### 1. Commercial & Billing Systems
* **Excluded:** Payments, payment gateways, parent subscriptions, school invoicing, tuition billing, fee collection modules.
* **Rationale:** Core safety, tracking accuracy, driver adherence, and parent reassurance must be fully stabilized before commercial monetization layers are introduced.
* **Deferred to:** Final commercial release phase.

### 2. Heavyweight Hardware & Biometric Integrations
* **Excluded:**
  * In-bus CCTV / live video streaming infrastructure.
  * Physical RFID card readers and bus-door turnstiles.
  * Facial recognition cameras / AI biometric scanners.
  * Fuel tank sensors and OBD-II / CAN bus diagnostic integrations.
* **Rationale:** Hardware maintenance, connectivity dropouts in Indian rural/semi-urban routes, high upfront capital expenditure, and sensor failures reduce platform reliability.
* **MVP Alternative:** Smartphone GPS + lightweight Flutter driver telemetry + WhatsApp-driven driver attendance verification.

### 3. Enterprise ERP & Administrative Bloat
* **Excluded:** Payroll, driver salary management, vehicle depreciation accounting, inventory/spare parts management, timetable/curriculum scheduling.
* **Rationale:** The system is an operational transport tracking and safety command center, not a full-scale school ERP.

### 4. Custom GPS Hardware Devices
* **Excluded:** Proprietary OBD/hardwired GPS trackers in the initial software build.
* **MVP Alternative:** Driver's Android smartphone running the Flutter background location service (with abstract ingestion APIs that can accept standard GPS telematics protocols later).

### 5. iOS Driver App
* **Excluded:** Driver app for Apple iOS in the initial build.
* **Rationale:** Over 99% of school bus drivers and transport operators in India use Android smartphones. Focusing exclusively on Flutter Android ensures deep background location optimization, battery management, and Android OEM (Xiaomi, Samsung, Realme) wake-lock tuning.
* **Note:** Parents using iOS will access the responsive live web tracking view without any device limitation.

### 6. Complex UX Anti-Patterns
* **Excluded:**
  * Bus capacity constraints and seat allotment counting.
  * Bus active/inactive status toggles (managed via active trip/route schedules).
  * Parent child-selection switchers (parent links are 1:1 direct tokenized sessions per student).
  * Mandatory school admin approvals for standard pickup location updates (handled via authorized coordinator workflow).

## Consequences
- **Positive:**
  - Zero bloat; razor-sharp focus on GPS accuracy, ETA calculation, geofence alerts, and incident dispatch.
  - Faster test cycles, lower infrastructure overhead, and simpler schema designs.
  - Clean separation of concerns with abstract adapter interfaces ready for future hardware or billing extensions.
- **Negative / Mitigations:**
  - Schools with pre-existing hardwired GPS trackers must use our driver smartphone app initially; abstracted ingestion adapters (`GPSLocationAdapter`) will enable external GPS device telemetry in a future phase.
