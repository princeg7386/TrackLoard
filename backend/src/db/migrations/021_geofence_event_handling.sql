-- ==============================================================================
-- Migration 021: Geofence Event Handling — Debounce, DWELL Heartbeat, Workflows
-- Domain: DWELL heartbeat tracking, EXIT missed-boarding workflow notification type
-- ==============================================================================

-- 1. Add dwell heartbeat tracking to trip_stop_geofence_states
--    Tracks when the last DWELL event was written for debounce logic
ALTER TABLE trip_stop_geofence_states
  ADD COLUMN IF NOT EXISTS last_dwell_event_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Add notification_type to geofence_notification_log
--    Distinguishes APPROACH (bus nearing stop) vs MISSED_BOARDING (bus departed stop, student not boarded)
ALTER TABLE geofence_notification_log
  ADD COLUMN IF NOT EXISTS notification_type VARCHAR(30) NOT NULL DEFAULT 'APPROACH';

-- Re-create unique constraint to scope dedup per notification type
-- (A parent can receive an APPROACH and a MISSED_BOARDING for the same trip+stop+student)
DROP INDEX IF EXISTS uq_geofence_log_trip_stop_student;
CREATE UNIQUE INDEX IF NOT EXISTS uq_geofence_log_trip_stop_student_type
  ON geofence_notification_log (trip_id, stop_id, student_id, notification_type);

-- Index for DWELL event lookups
CREATE INDEX IF NOT EXISTS idx_trip_stop_geofence_dwell_at
  ON trip_stop_geofence_states (trip_id, last_dwell_event_at DESC NULLS LAST)
  WHERE last_dwell_event_at IS NOT NULL;
