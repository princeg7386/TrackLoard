# System Architecture & Provider Abstractions

## 1. High-Level Architecture Diagram

```
                 ┌──────────────────────────────────────────────────────────┐
                 │                 SCHOOL ADMIN DASHBOARD                   │
                 │                 (Next.js / React 19)                     │
                 └──────────────┬────────────────────────────┬──────────────┘
                                │ REST / WebSocket           │ Server Actions
                                ▼                            ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                       CORE TRANSPORT BACKEND (Node.js/TS)                 │
├───────────────────────┬───────────────────────────┬───────────────────────┤
│ Domain Services:      │ Ingestion & Engines:      │ Provider Adapters:    │
│ • School & Fleet Svc  │ • GPS Telemetry Ingest    │ • IMessagingAdapter   │
│ • Student & Route Svc │ • Geofencing (PostGIS)    │ • IRoutingAdapter     │
│ • Trip State Machine  │ • Dynamic ETA Estimator   │ • ITelemetryIngest    │
│ • Attendance Engine   │ • Anomaly & Delay Detect  │ • IStorageAdapter     │
└───────────▲───────────┴─────────────▲─────────────┴───────────▲───────────┘
            │                         │                         │
            │                         │ Location Batch          │ Inbound Hook
            ▼                         │                         ▼
┌───────────────────────┐ ┌───────────┴───────────┐ ┌───────────────────────┐
│  PostgreSQL + PostGIS │ │  DRIVER FLUTTER APP   │ │  WHATSAPP DISPATCH &  │
│  (Spatial & Temporal) │ │  (Background Service) │ │  WEBHOOK GATEWAY      │
└───────────────────────┘ └───────────────────────┘ └───────────┬───────────┘
                                                                │
                                                                ▼
                                                    ┌───────────────────────┐
                                                    │   PARENT LIVE WEB     │
                                                    │   (/track/:tripToken) │
                                                    └───────────────────────┘
```

---

## 2. Provider Abstraction Contracts

To uphold the **Free/Open-Source First** and **Zero Vendor Lock-in** principles, all external systems interface through strict TypeScript contracts:

### A. Messaging Adapter (`IMessagingProvider`)
```typescript
export interface SendMessageOptions {
  recipientPhone: string;
  templateId?: string;
  variables?: Record<string, string>;
  directText?: string;
  actionButtons?: Array<{ title: string; payload: string }>;
}

export interface IMessagingProvider {
  sendMessage(options: SendMessageOptions): Promise<{ messageId: string; status: 'sent' | 'queued' | 'failed' }>;
  sendUrgentAlert(recipientPhone: string, text: string): Promise<boolean>;
  validateWebhookSignature(rawBody: string, signature: string): boolean;
}
```
* **Implementations:**
  - `MetaCloudWhatsAppAdapter` (Official WhatsApp Cloud API)
  - `TwilioWhatsAppAdapter` (Twilio fallback)
  - `MockWhatsAppAdapter` (Local dev & automated unit test suite)

### B. Routing & Distance Matrix Adapter (`IRoutingProvider`)
```typescript
export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface RouteCalculationResult {
  distanceMeters: number;
  durationSeconds: number;
  geometryPolyline: string; // Encoded polyline or GeoJSON LineString
  waypoints: Array<{ name: string; location: Coordinates }>;
}

export interface IRoutingProvider {
  calculateRoute(origin: Coordinates, destination: Coordinates, waypoints?: Coordinates[]): Promise<RouteCalculationResult>;
  getDistanceMatrix(origins: Coordinates[], destinations: Coordinates[]): Promise<Array<{ distanceMeters: number; durationSeconds: number }>>;
}
```
* **Implementations:**
  - `OSRMProvider` (Default Free/OSS Open Source Routing Machine)
  - `ValhallaProvider` (Advanced FOSS routing & map matching)
  - `GoogleMapsRoutingProvider` (Enterprise commercial fallback)

### C. Telemetry & Geofence Engine (`IGeofenceEngine`)
* Leverages native PostgreSQL `ST_DWithin` and `ST_Contains` spatial queries against PostGIS geography types (`GEOGRAPHY(Point, 4326)` and `GEOGRAPHY(Polygon, 4326)`).
* Zero external GIS licensing costs while providing sub-second spatial evaluation.

---

## 3. Data Flow & Security Protocol

1. **Driver Telemetry Flow:**
   - Flutter Android app reads GPS $\rightarrow$ buffers in local SQLite if offline $\rightarrow$ POST `/api/v1/telemetry/ingest` with Driver Bearer Token.
   - PostGIS saves coordinate point with timestamp, speed, bearing, and HDOP (accuracy).
   - Geofence trigger checks distance against next scheduled stop in the active trip.
   - If distance $\le 300\text{m}$, geofence event is emitted $\rightarrow$ ETA recalculator updates next stops $\rightarrow$ WhatsApp Proximity alert dispatched to relevant parents.

2. **Parent Live Web Flow:**
   - WhatsApp message sends unique signed token: `https://track.schoolbus.app/t/{signedJwt}`.
   - Parent browser accesses route: Backend verifies token (school ID, trip ID, student ID, expiry).
   - Parent web client connects to lightweight SSE / WebSocket for live bus coordinates, ETA countdown, and safety badges.
   - **Zero child selection, zero app install, zero complex login.**
