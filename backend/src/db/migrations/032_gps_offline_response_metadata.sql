-- ==============================================================================
-- Migration 032: GPS Offline Response Metadata Schema
-- Domain: Store Last Known Location Kinematics, School Notification, & Driver Alert Tracking
-- Phase: 27 — GPS Offline & Recovery (Micro-phase 27.2)
-- ==============================================================================

ALTER TABLE gps_offline_events
ADD COLUMN IF NOT EXISTS last_known_speed_kmh NUMERIC(5, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS last_known_bearing_degrees NUMERIC(5, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS last_known_address TEXT;

CREATE INDEX IF NOT EXISTS idx_gps_offline_school_notified ON gps_offline_events(school_notified_at);
CREATE INDEX IF NOT EXISTS idx_gps_offline_driver_notified ON gps_offline_events(driver_notified_at);
