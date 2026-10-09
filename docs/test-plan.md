# Master Test Plan & Verification Protocol

## 1. Objectives & Scope
This test plan defines the testing strategy, test harness, acceptance criteria, and regression test suites for the School Bus Tracking & Safety Platform.

---

## 2. Test Pyramid & Automation Levels

```
                     ▲
                    / \
                   /E2E\     ──  Full Lifecycle Workflows (Driver App → Telemetry → PostGIS → Geofence → WhatsApp → Parent Live Web)
                  /=====\
                 / Integr \  ──  API Contracts, PostGIS Spatial Queries, Domain Services, Auth Isolation
                /==========\
               /  Unit Tests \── Pure Functions, State Machines, Haversine/Geo Math, DTO Validation
              /==============\
```

---

## 3. Core Test Matrices by Domain

### A. Authentication & Multi-Tenant Isolation (`P0-SEC-03`)
- **TC-AUTH-01:** Admin login with valid credentials returns scoped JWT.
- **TC-AUTH-02:** Admin of School A cannot query buses, routes, or students of School B (403 Forbidden).
- **TC-AUTH-03:** Driver token only permits submitting telemetry for their assigned bus and active trip.
- **TC-AUTH-04:** Parent trip token validates signature, expiration, and child-specific scoping.

### B. GPS Telemetry & PostGIS Geofencing (`P2-GPS-01`, `P2-GEO-02`)
- **TC-GEO-01:** Ingestion endpoint rejects out-of-order timestamps or impossible speed jumps ($>140\text{ km/h}$).
- **TC-GEO-02:** Spatial query (`ST_DWithin`) accurately triggers entry event when bus enters $300\text{m}$ radius of a scheduled stop.
- **TC-GEO-03:** Dwell time calculation accurately measures seconds spent inside stop perimeter before departure.
- **TC-GEO-04:** Offline telemetry batching test: Ingestion correctly processes an array of 50 queued points in historical sequence without corrupting live ETA.

### C. Trip State Machine (`P2-TRP-04`)
- **TC-TRP-01:** State transition `SCHEDULED` $\rightarrow$ `IN_PROGRESS` $\rightarrow$ `COMPLETED` records timestamps and trip history.
- **TC-TRP-02:** Invalid transition (e.g. `COMPLETED` $\rightarrow$ `IN_PROGRESS`) throws `InvalidStateTransitionError`.
- **TC-TRP-03:** Abrupt trip cancellation triggers `CANCELLED` state and dispatches alert to all associated parents.

### D. Attendance Engine (`P3-ATT-03`)
- **TC-ATT-01:** Driver marking student "Boarded" updates stop attendance ledger.
- **TC-ATT-02:** Unmarked student at stop departure triggers "Missing Student Warning" prompt.
- **TC-ATT-03:** Parent receives WhatsApp confirmation upon successful boarding timestamp.

### E. Anomaly, Delay & Emergency SOS (`P5-DLY-01`, `P5-SOS-02`)
- **TC-SOS-01:** Driver triggers `/sos` $\rightarrow$ System flags trip state as `EMERGENCY`, generates high-priority admin alert in $<1\text{s}$, logs coordinate snapshot.
- **TC-SOS-02:** Route deviation $>500\text{m}$ from scheduled polyline for $>3\text{ minutes}$ triggers automated Route Deviation alert.

---

## 4. UI & Interaction Quality Checklist
Every frontend screen (Admin Dashboard, Parent Live Tracking) must pass:
1. **Desktop & Mobile Responsiveness:** Verified on 375px (mobile), 768px (tablet), and 1440px (desktop).
2. **State Completeness:** Visual inspection of `loading` skeletons, `empty` placeholders, `error` alerts, and `offline` badges.
3. **Accessibility:** Proper contrast ratios (WCAG AA), semantic HTML, keyboard navigability.
4. **Data Integrity:** No hardcoded mock values in production components.
