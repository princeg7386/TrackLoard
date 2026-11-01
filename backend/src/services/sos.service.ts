/**
 * SosService — Phase 30.1 / 30.2: Emergency / SOS Trigger & Capture
 *
 * Responsible for:
 *  - triggerSos()           — enrich + validate trip, capture snapshot, insert sos_events, dispatch notifications
 *  - getActiveSosEvents()   — list TRIGGERED + ACKNOWLEDGED events for a school (with snapshot fields)
 *  - getSosEventById()      — single event (tenant-scoped, with snapshot fields)
 *  - acknowledgeSos()       — admin acknowledges an active SOS
 *  - resolveSos()           — admin marks SOS resolved
 *
 * Phase 30.2 adds:
 *  - Active trip guard: rejects SOS on SCHEDULED / COMPLETED / CANCELLED trips
 *  - Snapshot columns: bus_number, driver_name, driver_phone, route_name
 *  - GPS quality capture: gps_accuracy_m, gps_recorded_at
 *  - Extended result: busNumber, driverName, routeName in TriggerSosResult
 *
 * All queries enforce school_id tenant isolation.
 * Business logic is here; controllers are thin wrappers.
 */

import { query } from '../config/database.js';
import { SosStatus } from '@school-bus/shared';
import { OperationalNotificationService } from './operational-notification.service.js';
import { logger } from './logger.service.js';

// ── Active trip statuses ───────────────────────────────────────────────────────
// SOS is only meaningful while a trip is actively running.
// Canonical running statuses in this codebase: IN_TRANSIT, DELAYED, ARRIVED_SCHOOL.
const ACTIVE_TRIP_STATUSES = ['IN_TRANSIT', 'DELAYED', 'ARRIVED_SCHOOL'] as const;
type ActiveTripStatus = (typeof ACTIVE_TRIP_STATUSES)[number];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SosEventRecord {
  id: string;
  schoolId: string;
  tripId: string;
  busId: string;
  driverId: string;
  triggerSource: string;
  latitude: number;
  longitude: number;
  speedKmh: number;
  status: SosStatus;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  createdAt: string;
  // ── Phase 30.2 snapshot fields ────────────────────────────────────────────
  busNumber: string | null;
  driverName: string | null;
  driverPhone: string | null;
  routeName: string | null;
  gpsAccuracyM: number | null;
  gpsRecordedAt: string | null;
}

export interface TriggerSosParams {
  schoolId: string;
  tripId: string;
  /** Source of trigger — defaults to APP_SOS_BUTTON */
  triggerSource?: 'APP_SOS_BUTTON' | 'WHATSAPP_DRIVER_CONFIRM_SOS' | 'ADMIN_OVERRIDE';
  /** Override coordinates. If omitted, last known GPS point is used. */
  latitude?: number;
  longitude?: number;
  speedKmh?: number;
  notes?: string;
}

export interface TriggerSosResult {
  sosEventId: string;
  status: SosStatus;
  latitude: number;
  longitude: number;
  notificationsSent: number;
  // ── Phase 30.2 snapshot fields (confirmation context for Flutter) ──────────
  busNumber: string | null;
  driverName: string | null;
  routeName: string | null;
}

// ── Enriched trip context (Phase 30.2) ────────────────────────────────────────

interface TripContext {
  id: string;
  busId: string;
  driverId: string;
  schoolId: string;
  status: string;
  busNumber: string;
  driverName: string;
  driverPhone: string;
  routeName: string;
}

// ── GPS row with quality fields (Phase 30.2) ──────────────────────────────────

interface GpsRow {
  latitude: number;
  longitude: number;
  speedKmh: number;
  accuracyMeters: number | null;
  recordedAt: string | null;
}

// ── Row type shared by getActiveSosEvents and getSosEventById ─────────────────

interface SosEventDbRow {
  id: string;
  school_id: string;
  trip_id: string;
  bus_id: string;
  driver_id: string;
  trigger_source: string;
  latitude: string;
  longitude: string;
  speed_kmh: string;
  status: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
  bus_number: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  route_name: string | null;
  gps_accuracy_m: string | null;
  gps_recorded_at: string | null;
}

// ── Shared row → record mapper ────────────────────────────────────────────────

function mapRow(r: SosEventDbRow): SosEventRecord {
  return {
    id: r.id,
    schoolId: r.school_id,
    tripId: r.trip_id,
    busId: r.bus_id,
    driverId: r.driver_id,
    triggerSource: r.trigger_source,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    speedKmh: Number(r.speed_kmh),
    status: r.status as SosStatus,
    acknowledgedBy: r.acknowledged_by,
    acknowledgedAt: r.acknowledged_at,
    resolvedAt: r.resolved_at,
    resolutionNotes: r.resolution_notes,
    createdAt: r.created_at,
    busNumber: r.bus_number,
    driverName: r.driver_name,
    driverPhone: r.driver_phone,
    routeName: r.route_name,
    gpsAccuracyM: r.gps_accuracy_m !== null ? Number(r.gps_accuracy_m) : null,
    gpsRecordedAt: r.gps_recorded_at,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export class SosService {
  /**
   * Trigger an SOS event.
   *
   * Phase 30.1:
   *  1. Verify trip exists and belongs to the school.
   *  2. Fetch last known GPS point (fallback to 0,0 if none).
   *  3. Insert into sos_events.
   *  4. Fire notifyEmergencySos() fire-and-forget.
   *  5. Return sosEventId + coordinates.
   *
   * Phase 30.2 additions:
   *  - Active trip guard: rejects SCHEDULED / COMPLETED / CANCELLED trips.
   *  - Enriched trip query JOINs buses + drivers + routes → captures snapshot.
   *  - GPS query also fetches accuracy_meters + recorded_at.
   *  - INSERT stores bus_number, driver_name, driver_phone, route_name,
   *    gps_accuracy_m, gps_recorded_at.
   *  - TriggerSosResult includes busNumber, driverName, routeName.
   */
  static async triggerSos(params: TriggerSosParams): Promise<TriggerSosResult> {
    // ── 1. Verify trip + capture enriched context ──────────────────────────
    const tripRows = await query<TripContext>(
      `SELECT t.id,
              t.bus_id      AS "busId",
              t.driver_id   AS "driverId",
              t.school_id   AS "schoolId",
              t.status,
              b.bus_number  AS "busNumber",
              d.full_name   AS "driverName",
              d.phone       AS "driverPhone",
              r.name        AS "routeName"
         FROM trips t
         JOIN buses   b ON b.id = t.bus_id    AND b.deleted_at IS NULL
         JOIN drivers d ON d.id = t.driver_id AND d.deleted_at IS NULL
         JOIN routes  r ON r.id = t.route_id  AND r.deleted_at IS NULL
        WHERE t.id        = $1
          AND t.school_id = $2
          AND t.deleted_at IS NULL
        LIMIT 1`,
      [params.tripId, params.schoolId]
    );

    if (tripRows.length === 0) {
      throw new Error(
        `Trip ${params.tripId} not found or does not belong to school ${params.schoolId}`
      );
    }

    const trip = tripRows[0]!;

    // ── Phase 30.2: Active trip guard ─────────────────────────────────────
    const isActive = (ACTIVE_TRIP_STATUSES as ReadonlyArray<string>).includes(trip.status);
    if (!isActive) {
      throw new Error(
        `Cannot trigger SOS: trip ${params.tripId} is not active (status: ${trip.status}). ` +
          `SOS is only allowed during active trips (IN_TRANSIT, DELAYED, ARRIVED_SCHOOL).`
      );
    }

    // ── 2. Resolve coordinates + GPS quality ──────────────────────────────
    let latitude = params.latitude ?? 0;
    let longitude = params.longitude ?? 0;
    let speedKmh = params.speedKmh ?? 0;
    let gpsAccuracyM: number | null = null;
    let gpsRecordedAt: string | null = null;

    if (!params.latitude || !params.longitude) {
      try {
        const gpsRows = await query<GpsRow>(
          `SELECT latitude,
                  longitude,
                  COALESCE(speed_kmh, 0)   AS "speedKmh",
                  accuracy_meters          AS "accuracyMeters",
                  recorded_at              AS "recordedAt"
             FROM gps_locations
            WHERE trip_id = $1
            ORDER BY recorded_at DESC
            LIMIT 1`,
          [params.tripId]
        );
        if (gpsRows.length > 0) {
          const gps = gpsRows[0]!;
          latitude = Number(gps.latitude);
          longitude = Number(gps.longitude);
          speedKmh = Number(gps.speedKmh);
          gpsAccuracyM =
            gps.accuracyMeters !== null && gps.accuracyMeters !== undefined
              ? Number(gps.accuracyMeters)
              : null;
          gpsRecordedAt = gps.recordedAt ?? null;
        }
      } catch (err) {
        logger.warn('[SosService] Could not fetch last GPS point — using 0,0', {
          tripId: params.tripId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── 3. Insert sos_events with full snapshot ───────────────────────────
    const insertRows = await query<{ id: string }>(
      `INSERT INTO sos_events (
         school_id, trip_id, bus_id, driver_id,
         trigger_source, latitude, longitude,
         location, speed_kmh, status, resolution_notes,
         bus_number, driver_name, driver_phone, route_name,
         gps_accuracy_m, gps_recorded_at
       ) VALUES (
         $1,  $2,  $3,  $4,
         $5,  $6,  $7,
         ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography, $8, 'TRIGGERED', $9,
         $10, $11, $12, $13,
         $14, $15
       )
       RETURNING id`,
      [
        params.schoolId,                        // $1
        params.tripId,                          // $2
        trip.busId,                             // $3
        trip.driverId,                          // $4
        params.triggerSource ?? 'APP_SOS_BUTTON', // $5
        latitude,                               // $6
        longitude,                              // $7
        speedKmh,                               // $8
        params.notes ?? 'Emergency SOS triggered', // $9
        trip.busNumber,                         // $10
        trip.driverName,                        // $11
        trip.driverPhone,                       // $12
        trip.routeName,                         // $13
        gpsAccuracyM,                           // $14
        gpsRecordedAt,                          // $15
      ]
    );

    const sosEventId = insertRows[0]!.id;

    // ── 4. Dispatch notifications (fire-and-forget) ───────────────────────
    OperationalNotificationService.notifyEmergencySos({
      schoolId: params.schoolId,
      tripId: params.tripId,
      triggerSource: params.triggerSource ?? 'APP_SOS_BUTTON',
      latitude,
      longitude,
      notes: params.notes,
    }).catch((err: unknown) => {
      logger.warn('[SosService] notifyEmergencySos fire-and-forget error (suppressed)', {
        sosEventId,
        tripId: params.tripId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    logger.warn('[SosService] SOS triggered', {
      sosEventId,
      tripId: params.tripId,
      schoolId: params.schoolId,
      triggerSource: params.triggerSource ?? 'APP_SOS_BUTTON',
      busNumber: trip.busNumber,
      driverName: trip.driverName,
      latitude,
      longitude,
      gpsAccuracyM,
    });

    return {
      sosEventId,
      status: SosStatus.TRIGGERED,
      latitude,
      longitude,
      notificationsSent: 0, // fire-and-forget — actual count resolved asynchronously
      busNumber: trip.busNumber ?? null,
      driverName: trip.driverName ?? null,
      routeName: trip.routeName ?? null,
    };
  }

  /**
   * List TRIGGERED and ACKNOWLEDGED SOS events for a school (active ones).
   * Includes Phase 30.2 snapshot columns.
   */
  static async getActiveSosEvents(schoolId: string): Promise<SosEventRecord[]> {
    const rows = await query<SosEventDbRow>(
      `SELECT id, school_id, trip_id, bus_id, driver_id,
              trigger_source, latitude, longitude, speed_kmh, status,
              acknowledged_by, acknowledged_at, resolved_at,
              resolution_notes, created_at,
              bus_number, driver_name, driver_phone, route_name,
              gps_accuracy_m, gps_recorded_at
         FROM sos_events
        WHERE school_id = $1
          AND status IN ('TRIGGERED', 'ACKNOWLEDGED', 'FIRST_RESPONDERS_NOTIFIED')
        ORDER BY created_at DESC`,
      [schoolId]
    );

    return rows.map(mapRow);
  }

  /**
   * Fetch a single SOS event by id, scoped to school for tenant isolation.
   * Includes Phase 30.2 snapshot columns.
   */
  static async getSosEventById(id: string, schoolId: string): Promise<SosEventRecord | null> {
    const rows = await query<SosEventDbRow>(
      `SELECT id, school_id, trip_id, bus_id, driver_id,
              trigger_source, latitude, longitude, speed_kmh, status,
              acknowledged_by, acknowledged_at, resolved_at,
              resolution_notes, created_at,
              bus_number, driver_name, driver_phone, route_name,
              gps_accuracy_m, gps_recorded_at
         FROM sos_events
        WHERE id        = $1
          AND school_id = $2
        LIMIT 1`,
      [id, schoolId]
    );

    if (rows.length === 0) return null;
    return mapRow(rows[0]!);
  }

  /**
   * Admin acknowledges a SOS event.
   * Only TRIGGERED or FIRST_RESPONDERS_NOTIFIED events can be acknowledged.
   */
  static async acknowledgeSos(
    id: string,
    schoolId: string,
    adminId: string
  ): Promise<SosEventRecord> {
    const rows = await query<{ id: string }>(
      `UPDATE sos_events
          SET status          = 'ACKNOWLEDGED',
              acknowledged_by = $3,
              acknowledged_at = NOW()
        WHERE id        = $1
          AND school_id = $2
          AND status IN ('TRIGGERED', 'FIRST_RESPONDERS_NOTIFIED')
        RETURNING id`,
      [id, schoolId, adminId]
    );

    if (rows.length === 0) {
      throw new Error(`SOS event ${id} not found, already acknowledged, or does not belong to school`);
    }

    const updated = await this.getSosEventById(id, schoolId);
    return updated!;
  }

  /**
   * Admin resolves a SOS event.
   * Only TRIGGERED, ACKNOWLEDGED, or FIRST_RESPONDERS_NOTIFIED events can be resolved.
   */
  static async resolveSos(
    id: string,
    schoolId: string,
    notes?: string
  ): Promise<SosEventRecord> {
    const rows = await query<{ id: string }>(
      `UPDATE sos_events
          SET status           = 'RESOLVED',
              resolved_at      = NOW(),
              resolution_notes = COALESCE($3, resolution_notes)
        WHERE id        = $1
          AND school_id = $2
          AND status IN ('TRIGGERED', 'ACKNOWLEDGED', 'FIRST_RESPONDERS_NOTIFIED')
        RETURNING id`,
      [id, schoolId, notes ?? null]
    );

    if (rows.length === 0) {
      throw new Error(`SOS event ${id} not found, already resolved, or does not belong to school`);
    }

    const updated = await this.getSosEventById(id, schoolId);
    return updated!;
  }
}
