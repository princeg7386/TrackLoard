-- ==============================================================================
-- Migration 022: Notification Event Model, Recipients & Priority Tiers
-- Domain: Event taxonomy, role-based recipients, priority routing
-- ==============================================================================

-- 1. Extend notifications table with event_type and priority
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS event_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL';

-- 2. Add priority check constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_notifications_priority'
  ) THEN
    ALTER TABLE notifications
      ADD CONSTRAINT chk_notifications_priority
      CHECK (priority IN ('CRITICAL', 'HIGH', 'NORMAL', 'LOW'));
  END IF;
END $$;

-- 3. Indexes for fast event querying, filtering, and priority queues
CREATE INDEX IF NOT EXISTS idx_notifications_event_type
  ON notifications(event_type);

CREATE INDEX IF NOT EXISTS idx_notifications_priority
  ON notifications(priority);

CREATE INDEX IF NOT EXISTS idx_notifications_school_event_priority
  ON notifications(school_id, event_type, priority, created_at DESC);

-- 4. Backfill existing notification records
UPDATE notifications
SET
  event_type = CASE
    WHEN template_name IN ('bus_proximity_alert', 'APPROACH') THEN 'BUS_APPROACHING'
    WHEN template_name = 'LOCATION_REQUEST' THEN 'PARENT_INVITE'
    ELSE 'GENERAL_ALERT'
  END,
  priority = CASE
    WHEN template_name IN ('bus_proximity_alert', 'APPROACH') THEN 'HIGH'
    WHEN template_name = 'LOCATION_REQUEST' THEN 'LOW'
    ELSE 'NORMAL'
  END
WHERE event_type IS NULL;
