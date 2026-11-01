# ADR 0004: Software SOS vs. AIS-140 Hardware Panic Button — Scope Boundary

## Status
**Accepted** — 2026-11-01

## Context

India's Ministry of Road Transport and Highways (MoRTH) mandates **AIS-140** (Automotive Industry Standard 140) compliance for all inter-state commercial passenger vehicles and many state-regulated school buses. An AIS-140 compliant **Vehicle Location Tracking Device (VLTD)** is a hardwired in-bus GPS unit that includes:

- A **physical panic button** (hardware SOS) wired directly to the device.
- An HTTPS/MQTT channel that pushes panic events to the state government's **VAHAN / iRAD** portal.
- A standardised data format (AIS-140 Part 4 / Part 6) for emergency events.

Our platform also includes a **software SOS** system (Phase 30.1–30.4):

- Triggered by the driver via the Flutter app **SOS button** (`APP_SOS_BUTTON`) or a WhatsApp `/sos` command (`WHATSAPP_DRIVER_CONFIRM_SOS`).
- Stored in `sos_events` table with full trip snapshot.
- Dispatches immediate WhatsApp alerts to school administrators.
- Managed through an admin acknowledge → resolve lifecycle.

These are **two distinct, parallel, non-overlapping systems**.

---

## Decision

### 1. The two systems are kept strictly separate — no integration in the current product build.

| Dimension | Software SOS (Phase 30) | AIS-140 Hardware Panic |
|-----------|------------------------|------------------------|
| **Trigger** | Driver app button / WhatsApp `/sos` | Physical panic button wired to VLTD |
| **Data path** | Flutter app → our backend API | VLTD → State VAHAN portal |
| **Recipient** | School admin via our WhatsApp alerts | State govt portal (not school app) |
| **Storage** | `sos_events` table, school-scoped | Government VAHAN/iRAD system |
| **Authentication** | Driver JWT / WhatsApp session | AIS-140 device certificate |
| **Platform scope** | ✅ In scope (Phase 30) | ❌ Out of scope (this ADR) |

### 2. `triggerSource` deliberately excludes `AIS140_PANIC_BUTTON`

The `triggerSource` field on `sos_events` and the shared `SosEventSchema` enum currently allows:

```
'APP_SOS_BUTTON' | 'WHATSAPP_DRIVER_CONFIRM_SOS' | 'ADMIN_OVERRIDE'
```

`AIS140_PANIC_BUTTON` is **intentionally absent**. Adding it would require:
- Receiving and parsing AIS-140 Part 4/6 MQTT/HTTP messages from the VLTD.
- Validating VLTD device certificates against a school's registered devices.
- Deduplicating hardware and software triggers for the same event.
- Deciding whether to forward to the state portal, or treat ours as a secondary record.

None of these are in scope. Any future engineer who adds a new `triggerSource` value **must** open a new ADR before doing so.

### 3. Schools with existing AIS-140 hardware are not blocked

Schools that already have AIS-140 compliant buses are served by the state portal's parallel channel. Our software SOS operates independently as an **additional** layer of safety notification reaching the school's own administrators directly — not a replacement for the government mandate.

### 4. Future integration path is reserved, not closed

If a future phase integrates AIS-140 hardware panic events, the correct architecture is:

```
VLTD Panic Button
       │
       ▼
AIS-140 Ingest Adapter  ←── new ADR required
  (validates cert, parses Part-4 format)
       │
       ▼
SosService.triggerSos({ triggerSource: 'AIS140_PANIC_BUTTON', ... })
       │
       ▼
Existing sos_events + alert pipeline (reused without change)
```

The adapter pattern is the correct extension point. The core SOS domain (Phases 30.1–30.4) requires **zero changes** to support AIS-140 in future.

---

## Consequences

### Positive
- **No premature complexity:** AIS-140 MQTT ingestion, device certificate management, and government portal integration are non-trivial infrastructure; deferring them keeps Phase 30 focused and shippable.
- **Compliance-safe:** Schools comply with AIS-140 via the VLTD → state portal path independently. Our software SOS does not interfere with that channel.
- **Clean extension point:** The abstract `triggerSource` field and adapter pattern make future AIS-140 integration additive, not invasive.
- **No false deduplication problem today:** Since we don't receive AIS-140 events, there is no risk of double-alerting or confusion between the two channels.

### Negative / Mitigations
- **Gap:** If a driver presses the AIS-140 hardware panic button but does NOT trigger our software SOS, school administrators receive no WhatsApp alert from our platform. **Mitigation:** Train transport coordinators to use both systems independently; driver SOP should include pressing both.
- **Gap:** Our `sos_events` table will not have a complete record of hardware panic events. **Mitigation:** Acceptable at this product stage; physical VLTD events are recorded by the state government system.

---

## References
- AIS-140 Standard: [MoRTH AIS-140 Part 1–6](https://morth.nic.in/sites/default/files/AIS-140.pdf)
- VAHAN Portal: State transport authority Vehicle Location Tracking
- Phase 30.1 commit: `3dd7acf` — SOS trigger implementation
- Phase 30.2 commit: `dd3f1b9` — SOS capture (snapshot, GPS quality, active trip guard)
- Phase 30.3 commit: `a468ee3` — SOS school alert (WhatsApp dispatch, Google Maps link)
- Phase 30.4 commit: `76c2e7c` — SOS resolution (incident history endpoint)
- ADR 0001: [Scope Exclusions and MVP Guardrails](./0001-scope-exclusions-and-mvp-boundaries.md)
