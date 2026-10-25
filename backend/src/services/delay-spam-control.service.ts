import { query } from '../config/database.js';
import { logger } from './logger.service.js';
import {
  DELAY_SPAM_CONTROL_CONFIG,
  DelaySpamControlEvaluation,
  DelaySpamControlEvaluationSchema,
} from '@school-bus/shared';

interface ActiveDelayRow {
  id: string;
  delay_minutes: number;
  notified_parents_count: number;
  created_at: string;
}

export class DelaySpamControlService {
  /**
   * Micro-phase 25.5: Evaluate whether a delay alert should be dispatched or suppressed as spam
   * Rules:
   * 1. First alert for a trip is always allowed if threshold is met.
   * 2. Repeated alerts with identical or lower delay are suppressed.
   * 3. Subsequent alerts are only dispatched if delay increases by >= 5 minutes OR crosses into CRITICAL (>= 20m).
   * 4. Minor fluctuations (1-4 mins) are filtered out as GPS/traffic noise.
   */
  public static async evaluateSpamControl(params: {
    tripId: string;
    schoolId: string;
    currentDelayMinutes: number;
  }): Promise<DelaySpamControlEvaluation> {
    try {
      // 1. Query most recent active delay record for this trip
      const activeRows = await query<ActiveDelayRow>(
        `SELECT id, delay_minutes, notified_parents_count, created_at
         FROM delays
         WHERE trip_id = $1 AND school_id = $2 AND resolved_at IS NULL AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`,
        [params.tripId, params.schoolId]
      );

      // Case 1: First delay alert for this trip
      if (activeRows.length === 0 || !activeRows[0] || (activeRows[0].notified_parents_count || 0) === 0) {
        const evalResult: DelaySpamControlEvaluation = {
          allowed: true,
          isFirstAlert: true,
          isEscalation: false,
          suppressedAsSpam: false,
          previousDelayMinutes: null,
          currentDelayMinutes: params.currentDelayMinutes,
          deltaMinutes: null,
          reason: 'Initial delay alert eligible for dispatch',
        };
        return DelaySpamControlEvaluationSchema.parse(evalResult);
      }

      const activeRecord = activeRows[0];
      const previousDelayMinutes = activeRecord.delay_minutes;
      const deltaMinutes = params.currentDelayMinutes - previousDelayMinutes;

      // Case 2: Identical or reduced delay -> Suppress repeated duplicate
      if (deltaMinutes <= 0) {
        const evalResult: DelaySpamControlEvaluation = {
          allowed: false,
          isFirstAlert: false,
          isEscalation: false,
          suppressedAsSpam: true,
          previousDelayMinutes,
          currentDelayMinutes: params.currentDelayMinutes,
          deltaMinutes,
          reason: `Identical or reduced delay already notified (${previousDelayMinutes}m vs ${params.currentDelayMinutes}m)`,
        };
        return DelaySpamControlEvaluationSchema.parse(evalResult);
      }

      // Case 3: Check meaningful change threshold (>= 5 minutes) or crossing into CRITICAL (>= 20 minutes)
      const isCriticalEscalation =
        previousDelayMinutes < DELAY_SPAM_CONTROL_CONFIG.CRITICAL_DELAY_THRESHOLD_MINUTES &&
        params.currentDelayMinutes >= DELAY_SPAM_CONTROL_CONFIG.CRITICAL_DELAY_THRESHOLD_MINUTES;

      const isMeaningfulIncrease =
        deltaMinutes >= DELAY_SPAM_CONTROL_CONFIG.MEANINGFUL_CHANGE_THRESHOLD_MINUTES;

      if (!isMeaningfulIncrease && !isCriticalEscalation) {
        const evalResult: DelaySpamControlEvaluation = {
          allowed: false,
          isFirstAlert: false,
          isEscalation: false,
          suppressedAsSpam: true,
          previousDelayMinutes,
          currentDelayMinutes: params.currentDelayMinutes,
          deltaMinutes,
          reason: `Minor delay increase (${deltaMinutes}m) below meaningful change threshold (${DELAY_SPAM_CONTROL_CONFIG.MEANINGFUL_CHANGE_THRESHOLD_MINUTES}m)`,
        };
        return DelaySpamControlEvaluationSchema.parse(evalResult);
      }

      // Case 4: Meaningful escalation!
      const reason = isCriticalEscalation
        ? `Critical delay escalation to ${params.currentDelayMinutes}m (+${deltaMinutes}m)`
        : `Meaningful delay escalation (+${deltaMinutes}m increase)`;

      const evalResult: DelaySpamControlEvaluation = {
        allowed: true,
        isFirstAlert: false,
        isEscalation: true,
        suppressedAsSpam: false,
        previousDelayMinutes,
        currentDelayMinutes: params.currentDelayMinutes,
        deltaMinutes,
        reason,
      };

      return DelaySpamControlEvaluationSchema.parse(evalResult);
    } catch (err: any) {
      logger.warn(`[DelaySpamControlService] Error during evaluation (allowing alert): ${err.message}`);
      return {
        allowed: true,
        isFirstAlert: true,
        isEscalation: false,
        suppressedAsSpam: false,
        previousDelayMinutes: null,
        currentDelayMinutes: params.currentDelayMinutes,
        deltaMinutes: null,
        reason: 'Error during spam evaluation, allowing alert non-blockingly',
      };
    }
  }

  /**
   * Helper: Updates active delay record with the escalated delay minutes
   */
  public static async updateActiveDelayRecord(
    delayRecordId: string,
    newDelayMinutes: number,
    notifiedParentsCount: number
  ): Promise<void> {
    await query(
      `UPDATE delays
       SET
         delay_minutes = $1,
         notified_parents_count = $2,
         predicted_arrival = NOW() + ($1 || ' minutes')::interval
       WHERE id = $3`,
      [newDelayMinutes, notifiedParentsCount, delayRecordId]
    );
  }
}
