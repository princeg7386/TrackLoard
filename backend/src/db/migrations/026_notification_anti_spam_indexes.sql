-- ==============================================================================
-- Migration 026: Notification Anti-Spam, Cooldown & Recipient Rate Limit Indexes
-- Domain: Burst throttling, recipient rate limits, stop-level deduplication
-- ==============================================================================

-- 1. Index for fast burst rate limiting per recipient phone
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
  ON notifications(recipient_phone, created_at DESC);

-- 2. Index for stop-level milestone deduplication per trip
CREATE INDEX IF NOT EXISTS idx_notifications_trip_stop_event
  ON notifications(trip_id, stop_id, event_type)
  WHERE trip_id IS NOT NULL AND stop_id IS NOT NULL;
