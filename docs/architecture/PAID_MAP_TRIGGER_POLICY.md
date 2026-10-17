# Architecture Policy: Paid Map & Provider Fallback Guidelines

## 1. Executive Summary & Free-First Principle

BUSLOARD is architected with a strict **Free & Open-Source First (FOSS Priority)** philosophy for geospatial operations. Standard school and college bus operations across India (route design, student pickup stop sequencing, driver GPS telemetry ingestion, real-time parent tracking, and geofencing) operate by default on open mapping primitives:
- **Map Tiles:** OpenStreetMap (OSM) Standard & CartoDB Positron
- **Routing & Matrix:** Open Source Routing Machine (OSRM) and Valhalla
- **Geocoding:** OpenStreetMap Nominatim
- **Spatial Indexing & Geofencing:** PostgreSQL + PostGIS (ST_DWithin, ST_Distance, ST_Contains)

This default stack incurs **₹0.00 / $0.00** in recurring commercial mapping API licensing fees, protecting school operating budgets while maintaining sub-second performance.

---

## 2. When Paid Maps May Be Used (Objective Triggers)

Paid commercial map providers (such as Google Maps Platform, Mapbox, or HERE) are supported via abstract adapters (`IMapProvider`, `IRoutingProvider`) and may be activated **only** when one or more of the following operational triggers are met:

### Trigger A: Informal & Ambiguous Indian Address Geocoding
- **Operational Reality:** Many student residences in Tier-2/Tier-3 towns, suburban colonies, and rural villages lack formal structured street numbers (e.g., *"Near Hanuman Mandir, Gali No. 3, Ward 12, Rampur"*).
- **Condition for Paid Fallback:**
  1. Nominatim returns 0 results for a parent or school address query.
  2. Nominatim returns results with low geocoding confidence (`importance < 0.60` or bounding box radius $> 5\text{ km}$).
- **Action:** Fall back to Google Places API / Google Geocoding API to resolve the exact doorstep coordinates, cache the resolved coordinates permanently in PostgreSQL, and avoid recurring queries.

### Trigger B: Dynamic Live Traffic & Rush-Hour Congestion Re-routing
- **Operational Reality:** During morning school arrival (07:00–08:30) and afternoon dispersal (13:30–15:30) in dense metropolitan corridors (e.g. Bengaluru Silk Board, Delhi-NCR Ring Road, Mumbai Western Express), unpredicted road closures, accidents, or extreme congestion can skew static road network travel times.
- **Condition for Paid Fallback:**
  1. Active trip telemetry detects sustained delay $> 20\text{ minutes}$ against scheduled ETA.
  2. The school administration has enabled dynamic congestion routing and provided a commercial API key with `traffic_model="best_guess"`.
- **Action:** Query Google Maps Distance Matrix / Directions API with live traffic flow tensors to calculate dynamic detour ETAs and push push-notifications to parents.

### Trigger C: Scale & Fair-Use Rate Limit Exhaustion
- **Operational Reality:** Public Nominatim endpoints enforce strict fair-use limits: maximum 1 request per second and prohibited bulk scraping. Public OSM tile servers similarly limit automated batch usage.
- **Condition for Paid Fallback:**
  1. The school district onboarding cohort exceeds 50 buses and 3,000 students running concurrent real-time queries.
  2. The deployment does not yet operate a dedicated self-hosted Valhalla/OSRM and Tile CDN cluster.
- **Action:** Switch to managed commercial geocoding/tiles or activate a commercial tile CDN to prevent IP-level rate-limiting and ensure 99.99% uptime.

### Trigger D: Satellite & Aerial Imagery Safety Audits
- **Operational Reality:** Transport safety coordinators need to inspect physical road width, cul-de-sacs, low-hanging overhead cables, and school entrance gates to verify if a 40-seater bus can safely make a turn.
- **Condition for Paid Fallback:**
  1. Admin opens the Route Builder / Stop Management canvas in "Aerial Safety Audit" mode.
- **Action:** Render satellite imagery tiles (e.g. Google Maps Satellite or Mapbox Satellite) on the admin canvas.

---

## 3. Provider Comparison & Capability Matrix

| Feature | OpenStreetMap / Nominatim | OSRM / Valhalla | Google Maps Platform | Mapbox |
| :--- | :--- | :--- | :--- | :--- |
| **Licensing Cost** | Free (ODbL) | Free (Apache 2.0 / MIT) | Paid (~$5 to $10 / 1k reqs) | Paid (~$4 to $7 / 1k reqs) |
| **Turn-by-turn Routing** | N/A (Tiles/Geocoding) | High Performance | High Performance | High Performance |
| **Live Congestion Traffic** | None (Static graph) | Static / Speed-annotated | Industry-leading live flow | High-quality live flow |
| **Indian Landmark Parsing** | Moderate | N/A (Routing only) | Exceptional | Good |
| **Self-Hostable (On-Premise)** | Yes | Yes (Dockerized) | No (Cloud SaaS only) | No (Cloud SaaS only) |
| **Offline Vector Canvas** | Yes (Built-in fallback) | Yes (Geometric fallback) | No | Limited |
| **Data Privacy (Student Data)** | Zero data leakage | Zero data leakage | Telemetry shared with SaaS | Telemetry shared with SaaS |

---

## 4. Cost Controls & Economic Safeguards

When commercial map providers are configured, the system enforces the following safeguards to prevent runaway billing:

1. **Strict Geocoding Caching:**
   - Every geocoded pickup stop or school location is written to PostgreSQL `pickup_locations`. Repeated queries for the same stop or address hit the database cache, resulting in **zero** external API calls.
2. **Per-School Daily Budget Circuit-Breaker:**
   - Schools configure a maximum daily paid API call budget (e.g., max 500 paid requests/day).
   - If the limit is reached, the system automatically drops down to free OSRM/Valhalla/Nominatim and alerts the Transport Coordinator.
3. **Multi-Tiered Fallback Hierarchy:**
   - `Google Maps` $\rightarrow$ `Valhalla` $\rightarrow$ `OSRM` $\rightarrow$ `MockHaversine`
   - External API errors (HTTP 401, 403, 429, 500, or socket timeouts) **never bubble up** as 500 errors to drivers, parents, or admins. The fallback adapter transparently takes over within 50ms.
4. **Savings & Usage Tracking:**
   - Every request records the provider used, latency, estimated commercial cost avoided, and savings generated in INR and USD.

---

## 5. Runtime Provider Switching

Providers can be switched on the fly without system restart or code deployment:
- **API Endpoint:** `POST /api/v1/routing/options/select`
  - Body: `{ "tileLayer": "carto_light", "geocodingProvider": "osm_nominatim", "routingProvider": "valhalla" }`
- **Environment Variables:**
  - `ROUTING_PROVIDER="osrm" | "valhalla" | "google_maps"`
  - `GOOGLE_MAPS_API_KEY="..."` (Optional: If absent when `google_maps` is selected, system gracefully falls back to free Valhalla/OSRM).
