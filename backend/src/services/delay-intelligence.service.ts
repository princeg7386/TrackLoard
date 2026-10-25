import { query } from '../config/database.js';
import { logger } from './logger.service.js';
import { env } from '../config/env.js';
import {
  DelaySeverity,
  StopDelayComparison,
  TripDelayComparisonResult,
  TripDelayComparisonResultSchema,
  WaitingParentTarget,
  AffectedPickupStopSummary,
  TripAffectedParentsResult,
  TripAffectedParentsResultSchema,
} from '@school-bus/shared';
import { TripTimelineService } from './trip-timeline.service.js';
import { EtaService } from './eta.service.js';
import { NotFoundError } from '../middlewares/error.middleware.js';

interface TripStateRow {
  id: string;
  status: string;
  current_stop_sequence: number;
  delay_minutes: number;
  scheduled_date: string;
  scheduled_start_time: string | null;
  actual_start_time: string | null;
}

export class DelayIntelligenceService {
  /**
   * Helper: Classify delay severity based on operational minutes discrepancy
   */
  public static classifyDelaySeverity(delayMinutes: number): DelaySeverity {
    if (delayMinutes < -3) {
      return 'EARLY';
    }
    if (delayMinutes <= 5) {
      return 'ON_TIME';
    }
    if (delayMinutes <= 10) {
      return 'MINOR_DELAY';
    }
    if (delayMinutes <= 20) {
      return 'MODERATE_DELAY';
    }
    return 'SEVERE_DELAY';
  }

  /**
   * Micro-phase 25.2: Compare Live ETA against Baseline Timeline and Calculate Delay Minutes
   */
  public static async compareTripTimeline(
    tripId: string,
    schoolId: string
  ): Promise<TripDelayComparisonResult> {
    // 1. Fetch trip current state
    const tripRows = await query<TripStateRow>(
      `SELECT
         id,
         status,
         current_stop_sequence,
         delay_minutes,
         scheduled_date::text,
         scheduled_start_time::text,
         actual_start_time::text
       FROM trips
       WHERE id = $1 AND school_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [tripId, schoolId]
    );

    if (tripRows.length === 0 || !tripRows[0]) {
      throw new NotFoundError(`Trip ${tripId} not found for school ${schoolId}`);
    }

    const trip = tripRows[0];
    const currentStopSequence = trip.current_stop_sequence || 0;

    // 2. Fetch baseline expected timeline from Phase 25.1
    const baselineTimeline = await TripTimelineService.getTripTimeline(tripId, schoolId);

    // 3. Obtain live ETA predictions if trip is running (IN_TRANSIT)
    const liveEtaMap = new Map<string, string>();
    let isLiveTracking = false;

    if (trip.status === 'IN_TRANSIT') {
      try {
        const liveEtaSummary = await EtaService.calculateTripEta(tripId, schoolId);
        if (liveEtaSummary?.stopEtas) {
          isLiveTracking = true;
          for (const stopEta of liveEtaSummary.stopEtas) {
            liveEtaMap.set(stopEta.stopId, stopEta.estimatedArrivalAt);
          }
        }
      } catch (err: any) {
        logger.warn(
          `[DelayIntelligenceService] Live ETA lookup failed for trip ${tripId}: ${err.message}. Using baseline progression.`
        );
      }
    }

    // 4. Check departure delay if trip is SCHEDULED but past scheduled start time
    let departureDelayMinutes = 0;
    if (trip.status === 'SCHEDULED' && baselineTimeline.scheduledStartTime) {
      const nowMs = Date.now();
      const scheduledStartMs = new Date(baselineTimeline.scheduledStartTime).getTime();
      if (!isNaN(scheduledStartMs) && nowMs > scheduledStartMs) {
        departureDelayMinutes = Math.round((nowMs - scheduledStartMs) / 60000);
      }
    }

    // 5. Build stop-by-stop delay comparisons
    const stopComparisons: StopDelayComparison[] = [];
    let nextStopDelayMinutes = 0;
    let nextStopId: string | null = null;
    let foundNextStop = false;

    for (const item of baselineTimeline.timeline) {
      const hasPassed = item.sequenceOrder <= currentStopSequence;
      const expectedArrivalMs = new Date(item.expectedArrival).getTime();

      let predictedArrivalIso = item.expectedArrival;
      let delayMinutes = 0;

      if (hasPassed) {
        // Stop has already been visited or passed
        predictedArrivalIso = item.expectedArrival;
        delayMinutes = 0;
      } else if (isLiveTracking && liveEtaMap.has(item.stopId)) {
        // Live GPS-derived prediction available
        predictedArrivalIso = liveEtaMap.get(item.stopId)!;
        const predictedMs = new Date(predictedArrivalIso).getTime();
        delayMinutes = Math.round((predictedMs - expectedArrivalMs) / 60000);
      } else if (departureDelayMinutes > 0) {
        // Scheduled trip delayed at origin
        delayMinutes = departureDelayMinutes;
        predictedArrivalIso = new Date(expectedArrivalMs + departureDelayMinutes * 60000).toISOString();
      }

      const delayStatus = this.classifyDelaySeverity(delayMinutes);

      stopComparisons.push({
        stopId: item.stopId,
        stopName: item.stopName,
        sequenceOrder: item.sequenceOrder,
        expectedArrival: item.expectedArrival,
        predictedArrival: predictedArrivalIso,
        delayMinutes,
        delayStatus,
        hasPassed,
      });

      // Track next upcoming stop
      if (!hasPassed && !foundNextStop) {
        nextStopDelayMinutes = delayMinutes;
        nextStopId = item.stopId;
        foundNextStop = true;
      }
    }

    // 6. Compute trip-level overall delay
    const overallDelayMinutes = foundNextStop
      ? nextStopDelayMinutes
      : (stopComparisons[stopComparisons.length - 1]?.delayMinutes ?? 0);

    const overallDelayStatus = this.classifyDelaySeverity(overallDelayMinutes);
    const delayedStopsCount = stopComparisons.filter((s) => !s.hasPassed && s.delayMinutes > 5).length;

    // 7. Update trips.delay_minutes in database for operational reporting
    try {
      await query(
        `UPDATE trips
         SET delay_minutes = $1, updated_at = NOW()
         WHERE id = $2 AND school_id = $3`,
        [overallDelayMinutes, tripId, schoolId]
      );
    } catch (err: any) {
      logger.warn(`[DelayIntelligenceService] Failed to sync trip delay_minutes: ${err.message}`);
    }

    const result: TripDelayComparisonResult = {
      tripId,
      schoolId,
      overallDelayMinutes,
      overallDelayStatus,
      nextStopDelayMinutes,
      nextStopId,
      stopsEvaluatedCount: stopComparisons.length,
      delayedStopsCount,
      stopComparisons,
      evaluatedAt: new Date().toISOString(),
    };

    return TripDelayComparisonResultSchema.parse(result);
  }

  /**
   * Micro-phase 25.3: Identify upcoming affected pickups, exclude already-served pickups,
   * and resolve waiting parent targets.
   */
  public static async identifyWaitingParents(params: {
    schoolId: string;
    tripId: string;
    minDelayMinutes?: number;
  }): Promise<TripAffectedParentsResult> {
    const minDelay = params.minDelayMinutes ?? 5;

    // 1. Run live timeline comparison to get stop-by-stop delay status and hasPassed flag
    const comparison = await this.compareTripTimeline(params.tripId, params.schoolId);

    // 2. Classify pickups: Already served vs Upcoming affected
    const alreadyServedPickups = comparison.stopComparisons.filter((s) => s.hasPassed);
    const affectedStopComparisons = comparison.stopComparisons.filter(
      (s) => !s.hasPassed && s.delayMinutes >= minDelay
    );

    if (affectedStopComparisons.length === 0) {
      return {
        tripId: params.tripId,
        schoolId: params.schoolId,
        overallDelayMinutes: comparison.overallDelayMinutes,
        overallDelayStatus: comparison.overallDelayStatus,
        minDelayThresholdMinutes: minDelay,
        alreadyServedPickupsCount: alreadyServedPickups.length,
        affectedPickupsCount: 0,
        waitingParentsCount: 0,
        affectedPickups: [],
        waitingParents: [],
        evaluatedAt: new Date().toISOString(),
      };
    }

    const affectedStopIds = affectedStopComparisons.map((s) => s.stopId);
    const stopComparisonMap = new Map<string, StopDelayComparison>();
    for (const stop of affectedStopComparisons) {
      stopComparisonMap.set(stop.stopId, stop);
    }

    // 3. Query candidate parents & students assigned to the affected upcoming stops
    // Exclude:
    // a) Inactive/opted-out parents (notifications_enabled = false)
    // b) Students absent today (absence_records on CURRENT_DATE)
    // c) Students already boarded for this trip (boarding_events where trip_id = $1)
    // d) Students already deboarded for this trip (drop_events where trip_id = $1)
    const candidates = await query<any>(
      `SELECT DISTINCT
         p.id AS "parentId",
         p.full_name AS "parentName",
         p.phone AS "parentPhone",
         s.id AS "studentId",
         s.full_name AS "studentName",
         pl.id AS "stopId",
         pl.stop_name AS "stopName",
         pl.sequence_order AS "sequenceOrder",
         ptt.token AS "trackingToken"
       FROM student_stop_assignments ssa
       JOIN pickup_locations pl ON (ssa.pickup_stop_id = pl.id OR ssa.drop_stop_id = pl.id)
         AND pl.id = ANY($3::uuid[])
         AND pl.deleted_at IS NULL
       JOIN students s ON ssa.student_id = s.id AND s.deleted_at IS NULL
       JOIN parents p ON p.student_id = s.id AND p.deleted_at IS NULL
       LEFT JOIN parent_tracking_tokens ptt
         ON ptt.student_id = s.id AND ptt.revoked_at IS NULL AND ptt.expires_at > NOW() AND ptt.deleted_at IS NULL
       WHERE s.school_id = $2
         AND ssa.deleted_at IS NULL
         AND p.notifications_enabled = TRUE
         AND NOT EXISTS (
           SELECT 1
           FROM absence_records ar
           WHERE ar.student_id = s.id
             AND ar.school_id = $2
             AND ar.absence_date = CURRENT_DATE
             AND ar.deleted_at IS NULL
         )
         AND NOT EXISTS (
           SELECT 1
           FROM boarding_events be
           WHERE be.trip_id = $1
             AND be.student_id = s.id
             AND be.status = 'BOARDED'
         )
         AND NOT EXISTS (
           SELECT 1
           FROM drop_events de
           WHERE de.trip_id = $1
             AND de.student_id = s.id
             AND de.status = 'DEBOARDED'
         )
       ORDER BY pl.sequence_order ASC, s.full_name ASC`,
      [params.tripId, params.schoolId, affectedStopIds]
    );

    // 4. Map candidates to WaitingParentTarget and count per stop
    const stopStudentCountMap = new Map<string, number>();
    const waitingParents: WaitingParentTarget[] = [];

    for (const row of candidates) {
      const stopComp = stopComparisonMap.get(row.stopId);
      if (!stopComp) continue;

      stopStudentCountMap.set(row.stopId, (stopStudentCountMap.get(row.stopId) || 0) + 1);

      const trackingUrl = row.trackingToken
        ? `${env.PARENT_TRACKING_BASE_URL}?token=${row.trackingToken}`
        : null;

      waitingParents.push({
        parentId: row.parentId,
        parentName: row.parentName,
        parentPhone: row.parentPhone,
        studentId: row.studentId,
        studentName: row.studentName,
        stopId: row.stopId,
        stopName: row.stopName,
        sequenceOrder: Number(row.sequenceOrder),
        expectedArrival: stopComp.expectedArrival,
        predictedArrival: stopComp.predictedArrival,
        delayMinutes: stopComp.delayMinutes,
        delayStatus: stopComp.delayStatus,
        trackingToken: row.trackingToken || null,
        trackingUrl,
      });
    }

    // 5. Construct AffectedPickupStopSummary list
    const affectedPickups: AffectedPickupStopSummary[] = affectedStopComparisons.map((sc) => ({
      stopId: sc.stopId,
      stopName: sc.stopName,
      sequenceOrder: sc.sequenceOrder,
      expectedArrival: sc.expectedArrival,
      predictedArrival: sc.predictedArrival,
      delayMinutes: sc.delayMinutes,
      delayStatus: sc.delayStatus,
      waitingStudentsCount: stopStudentCountMap.get(sc.stopId) || 0,
    }));

    const result: TripAffectedParentsResult = {
      tripId: params.tripId,
      schoolId: params.schoolId,
      overallDelayMinutes: comparison.overallDelayMinutes,
      overallDelayStatus: comparison.overallDelayStatus,
      minDelayThresholdMinutes: minDelay,
      alreadyServedPickupsCount: alreadyServedPickups.length,
      affectedPickupsCount: affectedPickups.length,
      waitingParentsCount: waitingParents.length,
      affectedPickups,
      waitingParents,
      evaluatedAt: new Date().toISOString(),
    };

    return TripAffectedParentsResultSchema.parse(result);
  }
}
