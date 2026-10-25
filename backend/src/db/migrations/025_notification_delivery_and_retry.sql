-- ==============================================================================
-- Migration 025: Notification Delivery Lifecycle, Webhook Status & Retry Engine
-- Domain: Retry counters, timestamps, provider message indexing, dead-letter state
-- ==============================================================================

-- 1. Extend notifications table with retry tracking columns
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Index for polling / processing retry-eligible failed notifications
CREATE INDEX IF NOT EXISTS idx_notifications_retry
  ON notifications(status, next_retry_at)
  WHERE status = 'FAILED';

-- 3. Index for fast webhook status lookup by WhatsApp/SMS provider message ID
CREATE INDEX IF NOT EXISTS idx_notifications_provider_msg_id
  ON notifications(provider_message_id)
  WHERE provider_message_id IS NOT NULL;
