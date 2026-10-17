# ADR: Trip State Vocabulary & PDF Mapping

## Status
Accepted

## Context
The project requirement specification (PDF Micro-Phase Roadmap 16.1) specifies a lifecycle consisting of:
- `NOT_STARTED`
- `STARTED`
- `IN_PROGRESS`
- `ARRIVED_SCHOOL`
- `COMPLETED`

During early architectural implementation and database design (PostgreSQL 16 + PostGIS, shared TypeScript types, Next.js school dashboard, Flutter driver app, and WhatsApp messaging engine), the system established a strictly typed, database-enforced `TripStatus` enum and CHECK constraint:
- `SCHEDULED`
- `IN_TRANSIT`
- `DELAYED`
- `ARRIVED_SCHOOL` (added via Migration 016)
- `COMPLETED`
- `CANCELLED`
- `EMERGENCY`

A key architectural rule enforced across all layers (and checked by `audit-tests/consistency.test.ts`) is that **exactly ONE vocabulary token represents an active running trip across backend, dashboard, and mobile code: `IN_TRANSIT`**. Permitting conflicting tokens like `IN_PROGRESS` creates race conditions, mismatched UI badges, and broken database CHECK constraints.

## Decision & Mapping Matrix

We maintain full semantic fidelity with PDF 16.1 while preserving cross-layer token consistency:

| PDF 16.1 Concept | Product Code / DB `TripStatus` | `TripLifecycleStage` | Operational Description |
| :--- | :--- | :--- | :--- |
| **`NOT_STARTED`** | `SCHEDULED` | `NOT_STARTED` | Trip is planned/scheduled for today; bus has not yet started route transit. |
| **`STARTED`** | `IN_TRANSIT` | `STARTED` | Driver started trip via WhatsApp or driver app; initial start timestamp recorded; telemetry session activated. |
| **`IN_PROGRESS`** | `IN_TRANSIT` / `DELAYED` | `IN_TRANSIT` | Bus is actively running the route stop sequence. `IN_TRANSIT` is the unified token. If traffic delays exceed threshold, operational status becomes `DELAYED` while maintaining active transit. |
| **`ARRIVED_SCHOOL`** | `ARRIVED_SCHOOL` | `ARRIVED_SCHOOL` | Bus has arrived at school destination. Stored in DB `trips.status = 'ARRIVED_SCHOOL'` (Migration 016) and recorded in `audit_logs` (`TRIP_ARRIVED_SCHOOL`). Triggers parent school arrival notification. |
| **`COMPLETED`** | `COMPLETED` | `COMPLETED` | Driver concluded trip; tracking tokens deactivated; attendance ledger permanently locked; summary metrics computed. |
| *(Deviation)* | `CANCELLED` | — | Trip called off before start (weather, strike, bus breakdown). |
| *(Deviation)* | `EMERGENCY` | — | Critical SOS / accident trigger during transit. |

## Single Running Token Invariant
- **Rule**: Code across `backend/src`, `school-dashboard/src`, and `driver-app/lib` MUST use `IN_TRANSIT` as the single canonical running trip status. Literal string `'IN_PROGRESS'` is prohibited in source files to prevent vocabulary drift and race conditions.
- **Verification**: Enforced by `audit-tests/consistency.test.ts` test: `"backend, dashboard and driver app use ONE name for a running trip"`.

## Telemetry Ingestion In `ARRIVED_SCHOOL` State
- **Rule**: GPS telemetry ingestion **IS STILL ACCEPTED** when `status = 'ARRIVED_SCHOOL'`.
- **Ingestion Policy**: `TelemetryService.ingestLocation` and `TelemetryService.ingestBatch` reject incoming telemetry only when a trip is permanently terminated (`COMPLETED` or `CANCELLED`). When the bus reaches the school campus and transitions to `ARRIVED_SCHOOL`, students are actively alighting and staff are recording student drop-off attendance.
- **Operational Value**: Ingesting telemetry during `ARRIVED_SCHOOL` ensures that school admins and parents viewing the live tracking map observe the bus stationary within school grounds in real time until the driver formally completes the trip (`COMPLETED`).
