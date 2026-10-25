-- ==============================================================================
-- Migration 024: Operational Notification Events & Cooldown Indexes
-- Domain: Delay, GPS unavailable, Route deviation, Emergency SOS, Unusual stop
-- ==============================================================================

-- 1. Index for operational anomaly & cooldown checking per school and trip
CREATE INDEX IF NOT EXISTS idx_notifications_operational_events
  ON notifications(school_id, trip_id, event_type, created_at DESC)
  WHERE trip_id IS NOT NULL;

-- 2. Index for global operational event auditing and metrics
CREATE INDEX IF NOT EXISTS idx_notifications_event_created
  ON notifications(event_type, created_at DESC);
