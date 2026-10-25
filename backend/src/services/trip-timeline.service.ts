import { query } from '../config/database.js';
import { logger } from './logger.service.js';
import {
  TripStopTimelineItem,
  TripExpectedTimeline,
  calculateHaversineDistanceMeters,
} from '@school-bus/shared';
import { NotFoundError } from '../middlewares/error.middleware.js';

interface TripRow {
  id: string;
  school_id: string;
  route_id: string;
  route_name: string;
  scheduled_date: string;
  scheduled_start_time: string;
}

interface StopRow {
  id: string;
  stop_name: string;
  sequence_order: number;
  latitude: number;
  longitude: number;
  scheduled_time: string | null;
  geofence_radius_meters: number;
}

export class TripTimelineService {
  /** Standard average school transit bus speed across Indian urban corridors (25 km/h) */
  public static readonly AVERAGE_SPEED_KMH = 25;
  /** Urban road path winding factor applied to straight-line distance */
  public static readonly WINDING_FACTOR = 1.25;
  /** Standard stop dwell time for boarding/deboarding */
  public static readonly DEFAULT_DWELL_SECONDS = 45;

  /**
   * Helper: Parse a time string (HH:MM:SS or HH:MM) on a date in IST (UTC+05:30)
   */
  public static parseIstDateTime(dateStr: string, timeStr: string): string {
    const cleanTime = timeStr.trim().length === 5 ? `${timeStr.trim()}:00` : timeStr.trim();
    return `${dateStr}T${cleanTime}+05:30`;
  }

  /**
   * 1. Calculate Expected ETA for Each Pickup Stop
   * Computes expected arrival timestamps, inter-stop distances, and cumulative duration.
   */
  public static async calculateExpectedTimeline(
    tripId: string,
    schoolId: string
  ): Promise<TripExpectedTimeline> {
    // 1. Fetch trip details with route
    const tripRows = await query<TripRow>(
      `SELECT
         t.id,
         t.school_id,
         t.route_id,
         r.name AS route_name,
         t.scheduled_date::text AS scheduled_date,
         t.scheduled_start_time::text AS scheduled_start_time
       FROM trips t
       JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
       WHERE t.id = $1 AND t.school_id = $2 AND t.deleted_at IS NULL
       LIMIT 1`,
      [tripId, schoolId]
    );

    if (tripRows.length === 0 || !tripRows[0]) {
      throw new NotFoundError(`Trip ${tripId} not found for school ${schoolId}`);
    }

    const trip = tripRows[0];

    // 2. Fetch pickup stops in strict sequence order
    const stopRows = await query<StopRow>(
      `SELECT
         id,
         stop_name,
         sequence_order,
         latitude,
         longitude,
         scheduled_time::text AS scheduled_time,
         geofence_radius_meters
       FROM pickup_locations
       WHERE route_id = $1 AND school_id = $2 AND deleted_at IS NULL
       ORDER BY sequence_order ASC`,
      [trip.route_id, schoolId]
    );

    // 3. Resolve base start timestamp
    let tripStartMs: number;
    if (trip.scheduled_start_time) {
      tripStartMs = new Date(trip.scheduled_start_time).getTime();
    } else {
      tripStartMs = new Date(this.parseIstDateTime(trip.scheduled_date, '07:30:00')).getTime();
    }

    if (isNaN(tripStartMs)) {
      tripStartMs = Date.now();
    }

    const timeline: TripStopTimelineItem[] = [];
    let cumulativeDistanceMeters = 0;
    let cumulativeDurationSeconds = 0;
    let currentCursorMs = tripStartMs;
    const speedMs = (this.AVERAGE_SPEED_KMH * 1000) / 3600; // ~6.94 m/s

    for (let i = 0; i < stopRows.length; i++) {
      const stop = stopRows[i]!;

      // Calculate distance from previous point (origin or previous stop)
      let legDistanceMeters = 0;
      if (i > 0) {
        const prevStop = stopRows[i - 1]!;
        const straight = calculateHaversineDistanceMeters(
          { latitude: prevStop.latitude, longitude: prevStop.longitude },
          { latitude: stop.latitude, longitude: stop.longitude }
        );
        legDistanceMeters = Math.round(straight * this.WINDING_FACTOR);
      }

      cumulativeDistanceMeters += legDistanceMeters;
      const legTravelSeconds = legDistanceMeters > 0 ? Math.round(legDistanceMeters / speedMs) : 0;
      cumulativeDurationSeconds += legTravelSeconds;

      // Determine expected arrival timestamp:
      // Priority 1: If stop has explicit scheduled_time, map to that time on the trip's scheduled date in IST
      let expectedArrivalIso: string;
      if (stop.scheduled_time) {
        expectedArrivalIso = new Date(
          this.parseIstDateTime(trip.scheduled_date, stop.scheduled_time)
        ).toISOString();
        currentCursorMs = new Date(expectedArrivalIso).getTime();
      } else {
        currentCursorMs += legTravelSeconds * 1000;
        expectedArrivalIso = new Date(currentCursorMs).toISOString();
      }

      // Expected departure = arrival + dwell time
      const dwellSeconds = this.DEFAULT_DWELL_SECONDS;
      const expectedDepartureIso = new Date(
        new Date(expectedArrivalIso).getTime() + dwellSeconds * 1000
      ).toISOString();

      currentCursorMs += dwellSeconds * 1000;
      cumulativeDurationSeconds += dwellSeconds;

      timeline.push({
        tripId,
        schoolId,
        stopId: stop.id,
        stopName: stop.stop_name,
        sequenceOrder: stop.sequence_order,
        scheduledTime: stop.scheduled_time || null,
        expectedArrival: expectedArrivalIso,
        expectedDeparture: expectedDepartureIso,
        distanceFromStartMeters: cumulativeDistanceMeters,
        durationFromStartSeconds: cumulativeDurationSeconds,
        dwellSeconds,
      });
    }

    const lastItem = timeline[timeline.length - 1];
    const expectedCompletionAt = lastItem
      ? lastItem.expectedDeparture || lastItem.expectedArrival
      : new Date(tripStartMs).toISOString();

    return {
      tripId,
      schoolId,
      routeId: trip.route_id,
      routeName: trip.route_name,
      scheduledDate: trip.scheduled_date,
      scheduledStartTime: new Date(tripStartMs).toISOString(),
      totalDistanceMeters: cumulativeDistanceMeters,
      totalDurationSeconds: cumulativeDurationSeconds,
      expectedCompletionAt,
      stopsCount: timeline.length,
      timeline,
    };
  }

  /**
   * 2. Store Expected Arrival Timelines in Database
   * Calculates and upserts timeline records into trip_stop_timelines table.
   */
  public static async generateAndStoreTimeline(
    tripId: string,
    schoolId: string
  ): Promise<TripExpectedTimeline> {
    const computed = await this.calculateExpectedTimeline(tripId, schoolId);

    for (const item of computed.timeline) {
      const stored = await query<{ id: string; created_at: string }>(
        `INSERT INTO trip_stop_timelines (
           school_id, trip_id, stop_id, sequence_order,
           scheduled_time, expected_arrival, expected_departure,
           distance_from_start_meters, duration_from_start_seconds,
           dwell_seconds
         ) VALUES ($1, $2, $3, $4, $5::time, $6::timestamptz, $7::timestamptz, $8, $9, $10)
         ON CONFLICT (trip_id, stop_id)
         DO UPDATE SET
           sequence_order = EXCLUDED.sequence_order,
           scheduled_time = EXCLUDED.scheduled_time,
           expected_arrival = EXCLUDED.expected_arrival,
           expected_departure = EXCLUDED.expected_departure,
           distance_from_start_meters = EXCLUDED.distance_from_start_meters,
           duration_from_start_seconds = EXCLUDED.duration_from_start_seconds,
           dwell_seconds = EXCLUDED.dwell_seconds,
           updated_at = NOW(),
           deleted_at = NULL
         RETURNING id, created_at::text AS created_at`,
        [
          schoolId,
          tripId,
          item.stopId,
          item.sequenceOrder,
          item.scheduledTime || null,
          item.expectedArrival,
          item.expectedDeparture,
          item.distanceFromStartMeters,
          item.durationFromStartSeconds,
          item.dwellSeconds,
        ]
      );

      if (stored[0]?.id) {
        item.id = stored[0].id;
        item.createdAt = stored[0].created_at;
      }
    }

    logger.info('[TripTimelineService] Stored expected timeline for trip', {
      tripId,
      stopsCount: computed.timeline.length,
      totalDistanceMeters: computed.totalDistanceMeters,
    });

    return computed;
  }

  /**
   * 3. Retrieve Expected Timeline for Trip
   * Reads from database; if not yet generated, generates and stores it on demand.
   */
  public static async getTripTimeline(
    tripId: string,
    schoolId: string
  ): Promise<TripExpectedTimeline> {
    const rows = await query<any>(
      `SELECT
         tst.id,
         tst.trip_id AS "tripId",
         tst.school_id AS "schoolId",
         tst.stop_id AS "stopId",
         pl.stop_name AS "stopName",
         tst.sequence_order AS "sequenceOrder",
         tst.scheduled_time::text AS "scheduledTime",
         tst.expected_arrival::text AS "expectedArrival",
         tst.expected_departure::text AS "expectedDeparture",
         tst.distance_from_start_meters AS "distanceFromStartMeters",
         tst.duration_from_start_seconds AS "durationFromStartSeconds",
         tst.dwell_seconds AS "dwellSeconds",
         tst.created_at::text AS "createdAt",
         t.route_id AS "routeId",
         r.name AS "routeName",
         t.scheduled_date::text AS "scheduledDate",
         t.scheduled_start_time::text AS "scheduledStartTime"
       FROM trip_stop_timelines tst
       JOIN pickup_locations pl ON tst.stop_id = pl.id AND pl.deleted_at IS NULL
       JOIN trips t ON tst.trip_id = t.id AND t.deleted_at IS NULL
       JOIN routes r ON t.route_id = r.id AND r.deleted_at IS NULL
       WHERE tst.trip_id = $1 AND tst.school_id = $2 AND tst.deleted_at IS NULL
       ORDER BY tst.sequence_order ASC`,
      [tripId, schoolId]
    );

    if (rows.length > 0) {
      const first = rows[0];
      const last = rows[rows.length - 1];
      const timeline: TripStopTimelineItem[] = rows.map((r: any) => ({
        id: r.id,
        tripId: r.tripId,
        schoolId: r.schoolId,
        stopId: r.stopId,
        stopName: r.stopName,
        sequenceOrder: Number(r.sequenceOrder),
        scheduledTime: r.scheduledTime || null,
        expectedArrival: new Date(r.expectedArrival).toISOString(),
        expectedDeparture: r.expectedDeparture ? new Date(r.expectedDeparture).toISOString() : null,
        distanceFromStartMeters: Number(r.distanceFromStartMeters) || 0,
        durationFromStartSeconds: Number(r.durationFromStartSeconds) || 0,
        dwellSeconds: Number(r.dwellSeconds) || 45,
        createdAt: r.createdAt,
      }));

      return {
        tripId,
        schoolId,
        routeId: first.routeId,
        routeName: first.routeName,
        scheduledDate: first.scheduledDate,
        scheduledStartTime: first.scheduledStartTime
          ? new Date(first.scheduledStartTime).toISOString()
          : new Date().toISOString(),
        totalDistanceMeters: last.distanceFromStartMeters || 0,
        totalDurationSeconds: last.durationFromStartSeconds || 0,
        expectedCompletionAt: last.expectedDeparture || last.expectedArrival,
        stopsCount: timeline.length,
        timeline,
      };
    }

    // Not found in cache/DB -> generate, store, and return
    return await this.generateAndStoreTimeline(tripId, schoolId);
  }

  /**
   * 4. Quick lookup for expected arrival at a single stop
   */
  public static async getStopExpectedArrival(
    tripId: string,
    stopId: string
  ): Promise<{ expectedArrival: string; scheduledTime: string | null } | null> {
    const rows = await query<{ expected_arrival: string; scheduled_time: string | null }>(
      `SELECT expected_arrival::text, scheduled_time::text
       FROM trip_stop_timelines
       WHERE trip_id = $1 AND stop_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [tripId, stopId]
    );

    if (rows.length === 0 || !rows[0]) {
      return null;
    }

    return {
      expectedArrival: new Date(rows[0].expected_arrival).toISOString(),
      scheduledTime: rows[0].scheduled_time || null,
    };
  }
}
