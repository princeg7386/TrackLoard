# Product Specification & Scope Guardrails

## 1. Executive Summary
A reliable, low-latency school and college bus tracking and transport safety platform engineered for the Indian context. It connects School Administrators, Bus Drivers, and Parents through clear, role-optimized touchpoints with a WhatsApp-first philosophy.

---

## 2. User Roles & Interaction Channels

| User Role | Primary Channel | Secondary Channel | Key Responsibilities / Interactions |
| :--- | :--- | :--- | :--- |
| **School Administrator / Transport Manager** | Next.js Web Dashboard | WhatsApp Urgent Alerts | Fleet oversight, route/stop creation, live map tracking, delay handling, driver assignment, emergency/SOS resolution. |
| **Bus Driver** | Android App (Flutter) | WhatsApp Command Bot | Background GPS telemetry streaming, Start/End Trip, student pickup attendance, reporting route issues, one-tap Emergency SOS. |
| **Parent / Guardian** | WhatsApp Notifications | Responsive Live Web View | Real-time ETA updates, arrival alerts, tokenized live map view of their child's bus, driver calling shortcut. |

---

## 3. Explicit MVP Scope Boundaries & Exclusions

```
┌───────────────────────────────────────────────────────────┐
│                    IN MVP SCOPE                           │
├─────────────────────────────┬─────────────────────────────┤
│ • School & Fleet Setup      │ • Dynamic ETA & Geofencing  │
│ • Driver Android GPS Engine │ • Student Stop Attendance   │
│ • Parent Live Web Tracking  │ • Driver WhatsApp Bot       │
│ • Admin Control Dashboard   │ • SOS & Delay Dispatches    │
└─────────────────────────────┴─────────────────────────────┘
                              ▼
┌───────────────────────────────────────────────────────────┐
│              EXPLICITLY EXCLUDED FROM MVP                 │
├─────────────────────────────┬─────────────────────────────┤
│ ❌ Payments & Billing       │ ❌ In-Bus CCTV Streaming    │
│ ❌ RFID Card Hardware       │ ❌ Face Recognition AI      │
│ ❌ iOS Driver App           │ ❌ Fuel & Diagnostic OBD-II │
│ ❌ Seat Capacity Counting   │ ❌ School ERP / Payroll     │
│ ❌ Multi-Child Switchers    │ ❌ Custom GPS Hardware Box  │
└─────────────────────────────┴─────────────────────────────┘
```

---

## 4. Architectural Guardrails
1. **Multi-Tenant Isolation:** Every data query, route lookup, and telemetry packet MUST carry and validate `school_id`. No cross-tenant data leakage is permissible.
2. **Provider Independence:** WhatsApp messaging, SMS, mapping/routing, and cloud storage MUST be accessed exclusively via typed adapter interfaces (`IMessagingProvider`, `IRoutingProvider`, `ITelemetryIngestion`).
3. **Resilient Offline-First Driver Telemetry:** Driver Android app MUST queue GPS coordinates locally in SQLite if 4G/cellular drops, flushing in ordered batches when connection restores.
4. **Tokenized Parent Security:** Parents access tracking via cryptographically secure, time-limited trip tokens (`/track/:tripToken`) without requiring cumbersome app installs or passwords.
