/**
 * SosService — Phase 30.1: Emergency / SOS Trigger
 *
 * Responsible for:
 *  - triggerSos()           — fetch last known GPS, insert sos_events, dispatch notifications
 *  - getActiveSosEvents()   — list TRIGGERED + ACKNOWLEDGED events for a school
 *  - getSosEventById()      — single event (tenant-scoped)
 *  - acknowledgeSos()       — admin acknowledges an active SOS
 *  - resolveSos()           — admin marks SOS resolved
 *
 * All queries enforce school_id tenant isolation.
 * Business logic is here; controllers are thin wrappers.
 */

import { query } from '../config/database.js';
import { SosStatus } from '@school-bus/shared';
import { OperationalNotificationService } from './operational-notification.service.js';
import { logger } from './logger.service.js';

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
}

// ── Service ───────────────────────────────────────────────────────────────────

export class SosService {
  /**
   * Trigger an SOS event.
   * 1. Verify trip exists and belongs to the school.
   * 2. Fetch last known GPS point for the trip (fallback to 0,0 if none).
   * 3. Insert into sos_events.
   * 4. Fire OperationalNotificationService.notifyEmergencySos() (fire-and-forget).
   * 5. Return sosEventId + resolved coordinates.
   */
  static async triggerSos(params: TriggerSosParams): Promise<TriggerSosResult> {
    // 1. Verify trip + bus + driver context
    const tripRows = await query<{
      id: string;
      busId: string;
      driverId: string;
      schoolId: string;
      status: string;
    }>(
      `SELECT t.id,
              t.bus_id      AS "busId",
              t.driver_id   AS "driverId",
              t.school_id   AS "schoolId",
              t.status
         FROM trips t
        WHERE t.id        = $1
          AND t.school_id = $2
          AND t.deleted_at IS NULL
        LIMIT 1`,
      [params.tripId, params.schoolId]
    );

    if (tripRows.length === 0) {
      throw new Error(`Trip ${params.tripId} not found or does not belong to school ${params.schoolId}`);
    }

    const trip = tripRows[0]!;

    // 2. Resolve coordinates — prefer explicit override, then last known GPS
    let latitude = params.latitude ?? 0;
    let longitude = params.longitude ?? 0;
    let speedKmh = params.speedKmh ?? 0;

    if (!params.latitude || !params.longitude) {
      try {
        const gpsRows = await query<{
          latitude: number;
          longitude: number;
          speedKmh: number;
        }>(
          `SELECT latitude,
                  longitude,
                  COALESCE(speed_kmh, 0) AS "speedKmh"
             FROM gps_locations
            WHERE trip_id = $1
            ORDER BY recorded_at DESC
            LIMIT 1`,
          [params.tripId]
        );
        if (gpsRows.length > 0) {
          latitude = Number(gpsRows[0]!.latitude);
          longitude = Number(gpsRows[0]!.longitude);
          speedKmh = Number(gpsRows[0]!.speedKmh);
        }
      } catch (err) {
        logger.warn('[SosService] Could not fetch last GPS point — using 0,0', {
          tripId: params.tripId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 3. Insert sos_events
    const insertRows = await query<{ id: string }>(
      `INSERT INTO sos_events (
         school_id, trip_id, bus_id, driver_id,
         trigger_source, latitude, longitude,
         location, speed_kmh, status, resolution_notes
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, $7,
         ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography, $8, 'TRIGGERED', $9
       )
       RETURNING id`,
      [
        params.schoolId,
        params.tripId,
        trip.busId,
        trip.driverId,
        params.triggerSource ?? 'APP_SOS_BUTTON',
        latitude,
        longitude,
        speedKmh,
        params.notes ?? 'Emergency SOS triggered',
      ]
    );

    const sosEventId = insertRows[0]!.id;

    // 4. Dispatch notifications (fire-and-forget — never block the response)
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
      latitude,
      longitude,
    });

    return {
      sosEventId,
      status: SosStatus.TRIGGERED,
      latitude,
      longitude,
      notificationsSent: 0, // fire-and-forget — actual count resolved asynchronously
    };
  }

  /**
   * List TRIGGERED and ACKNOWLEDGED SOS events for a school (active ones).
   */
  static async getActiveSosEvents(schoolId: string): Promise<SosEventRecord[]> {
    const rows = await query<{
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
    }>(
      `SELECT id, school_id, trip_id, bus_id, driver_id,
              trigger_source, latitude, longitude, speed_kmh, status,
              acknowledged_by, acknowledged_at, resolved_at,
              resolution_notes, created_at
         FROM sos_events
        WHERE school_id = $1
          AND status IN ('TRIGGERED', 'ACKNOWLEDGED', 'FIRST_RESPONDERS_NOTIFIED')
        ORDER BY created_at DESC`,
      [schoolId]
    );

    return rows.map((r) => ({
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
    }));
  }

  /**
   * Fetch a single SOS event by id, scoped to school for tenant isolation.
   */
  static async getSosEventById(id: string, schoolId: string): Promise<SosEventRecord | null> {
    const rows = await query<{
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
    }>(
      `SELECT id, school_id, trip_id, bus_id, driver_id,
              trigger_source, latitude, longitude, speed_kmh, status,
              acknowledged_by, acknowledged_at, resolved_at,
              resolution_notes, created_at
         FROM sos_events
        WHERE id        = $1
          AND school_id = $2
        LIMIT 1`,
      [id, schoolId]
    );

    if (rows.length === 0) return null;
    const r = rows[0]!;
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
    };
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
