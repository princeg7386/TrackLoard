-- ==============================================================================
-- Migration 023: Parent Notification Events Lifecycle & Deduplication
-- Domain: Dedup index on (trip_id, student_id, event_type) and fast milestone queries
-- ==============================================================================

-- 1. Index for fast idempotency & dedup checking per trip, student, and event type
CREATE INDEX IF NOT EXISTS idx_notifications_trip_student_event
  ON notifications(trip_id, student_id, event_type)
  WHERE trip_id IS NOT NULL AND student_id IS NOT NULL;

-- 2. Index for trip milestone querying and tracking
CREATE INDEX IF NOT EXISTS idx_notifications_trip_event_created
  ON notifications(trip_id, event_type, created_at DESC)
  WHERE trip_id IS NOT NULL;
