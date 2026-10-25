# TrackLoard — GPS Telemetry, ETA Prediction, Geofencing & WhatsApp Engine Audit

- **Audit Identifier:** `audit-20261025-153605`
- **Audit Date:** 2026-10-25

---

## 1. GPS Telemetry Ingestion & Health Engine

### Telemetry Pipeline Architecture
```
[Flutter Driver App]
  ├── Geolocator (High Accuracy GPS)
  ├── Speed Clamp (≤ 120 km/h)
  ├── SQLite Offline Queue (Buffered when disconnected)
  └── HTTP POST Batch Ingestion
          │
          ▼
[Backend Ingestion API (/api/v1/telemetry/batch)]
  ├── Zod Batch Validation (Max 500 points/batch)
  ├── Speed & Time Sanity Filter (> 160 km/h or > 5m future rejected)
  ├── PostGIS Spatial Insertion (ST_SetSRID Point)
  ├── Bus Latest Location Cache Update (Single Row Cache)
  └── SSE Real-time Feed Broadcast
```

### Telemetry Quality & Health Monitoring
The GPS health engine (`gps-health.service.ts`) classifies every bus into four distinct health states:
1. `HEALTHY`: Location received within 30 seconds with accuracy $\le 25\text{ meters}$.
2. `DEGRADED_ACCURACY`: Fresh location ($< 30\text{s}$) but GPS accuracy $> 30\text{ meters}$ (e.g. urban canyon or severe weather).
3. `STALE_SIGNAL`: No telemetry update for $2\text{ to }10\text{ minutes}$ (driver in tunnel or mobile connectivity blackout).
4. `OFFLINE`: No location data received for $> 10\text{ minutes}$ while a trip is marked active.

---

## 2. ETA Prediction & Routing Engine

### Multi-Provider Architecture
The routing subsystem (`backend/src/services/routing/`) provides provider abstraction:
- **Default Engine:** OpenStreetMap via OSRM (`https://router.project-osrm.org`).
- **Enterprise Fallbacks:** Self-hosted Valhalla or Google Maps Distance Matrix API.
- **Fail-Safe Offline Mode:** Spherical Haversine distance computation with estimated vehicle transit speeds ($25\text{ km/h}$ city average for India) ensures ETAs continue functioning even if all external routing providers fail.

### Stop-by-Stop ETA Propagation
During an active trip:
1. The bus's current coordinate is matched against remaining sequence stops.
2. Estimated travel time and distance are computed for each upcoming stop.
3. When the calculated ETA to a parent's pickup stop drops below $5\text{ minutes}$, an automated WhatsApp dispatch event is emitted.

---

## 3. Geofencing & Event Detection

### Geofence Types
1. **Pickup Stop Radial Geofences:**
   - Circular buffer around pickup coordinates (default $300\text{m}$).
   - Entry triggers "Bus Approaching" notification.
   - Exit logs stop departure event.
2. **School Campus Polygon Geofences:**
   - Multi-vertex polygon encompassing school grounds (`school_geofences`).
   - `ST_Contains(boundary, location)` triggers automatic `ARRIVED_AT_SCHOOL` trip status update.

### Event Idempotency & Notification Spam Protection
To prevent repeated notification triggers when a bus hovers near a boundary, the system records dispatches in `geofence_notification_logs`:
- Unique constraint: `(trip_id, stop_id, event_type)` ensures only one approach/arrival alert is sent per student per trip.

---

## 4. WhatsApp Dispatch & Safety Workflows

### Driver Daily Operations via WhatsApp
Drivers execute daily trips without opening complex mobile screens:
- Send `1` or `START`: Starts scheduled morning/evening route.
- Send `2` or `END`: Concludes trip, locks attendance, triggers school arrival alerts.
- Send `3` or `ATTENDANCE`: Pulls student checklist with quick boarding toggles.
- Send `4` or `REPORT PROBLEM`: Reports flat tire, heavy traffic, or vehicle breakdown.
- Send `5` or `SOS` / `EMERGENCY`: Instantly flags trip with critical alarm on school dashboard.

### Parent Notification Sequence
1. **Trip Started:** "Bus 04 has started Morning Route A. Track live: [link]".
2. **Bus Approaching:** "Bus 04 is 5 mins away from your stop (Sector 14 Main Gate)".
3. **Student Boarded:** "Aarav has boarded Bus 04 at 07:22 AM".
4. **School Arrival:** "Bus 04 has arrived safely at Delhi Public School at 07:55 AM".
