import { env } from '../config/env.js';

export class TimeUtil {
  /**
   * Returns the current timestamp in ISO format
   */
  static nowIso(): string {
    return new Date().toISOString();
  }

  /**
   * Returns current date string in YYYY-MM-DD in school timezone (Asia/Kolkata)
   */
  static todayDateString(timezone: string = env.APP_TIMEZONE): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  }

  /**
   * Calculates delay in minutes between scheduled time and actual/predicted time
   */
  static calculateDelayMinutes(
    scheduledTime: Date | string,
    actualOrPredictedTime: Date | string
  ): number {
    const scheduledMs = new Date(scheduledTime).getTime();
    const actualMs = new Date(actualOrPredictedTime).getTime();
    const diffMs = actualMs - scheduledMs;
    const diffMins = Math.round(diffMs / (1000 * 60));
    return Math.max(0, diffMins);
  }

  /**
   * Formats duration in seconds to a friendly Indian transport ETA string
   */
  static formatEtaDuration(durationSeconds: number): string {
    if (durationSeconds <= 60) {
      return 'Arriving now';
    }
    const minutes = Math.round(durationSeconds / 60);
    if (minutes < 60) {
      return `${minutes} min${minutes > 1 ? 's' : ''}`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;
    return `${hours} hr${hours > 1 ? 's' : ''} ${remainingMins} min${remainingMins !== 1 ? 's' : ''}`;
  }

  /**
   * Converts a scheduled time string (e.g. "07:15:00") and date into a full ISO Date
   */
  static combineDateAndTime(
    dateStr: string,
    timeStr: string,
    timezoneOffset: string = '+05:30'
  ): Date {
    // e.g. "2026-10-10T07:15:00+05:30"
    const cleanTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
    const fullIso = `${dateStr}T${cleanTime}${timezoneOffset}`;
    return new Date(fullIso);
  }
}
