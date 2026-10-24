-- ==============================================================================
-- Migration 018: Geofence Notification Log
-- Domain: dedup guard for approach-to-stop WhatsApp notifications
--         one message per (trip, stop, student) per trip lifecycle
-- ==============================================================================

CREATE TABLE IF NOT EXISTS geofence_notification_log (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id           UUID        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  stop_id           UUID        NOT NULL REFERENCES pickup_locations(id) ON DELETE CASCADE,
  student_id        UUID        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  parent_id         UUID        NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  school_id         UUID        NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  -- distance at time of trigger (metres)
  trigger_distance_meters NUMERIC(10,1),
  -- ETA in minutes at time of trigger (may be NULL if ETA unavailable)
  eta_minutes       INTEGER,
  -- messaging provider message/status ID for delivery tracking
  message_sid       TEXT,
  triggered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One approach notification per child per stop per trip
CREATE UNIQUE INDEX IF NOT EXISTS uq_geofence_log_trip_stop_student
  ON geofence_notification_log (trip_id, stop_id, student_id);

-- Lookup indexes
CREATE INDEX IF NOT EXISTS idx_geofence_log_trip_id
  ON geofence_notification_log (trip_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_geofence_log_school_id
  ON geofence_notification_log (school_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_geofence_log_parent_id
  ON geofence_notification_log (parent_id, triggered_at DESC);
