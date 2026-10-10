-- ==============================================================================
-- Migration 013: Bus Latest Location Cache & GPS Health State
-- Extends buses table with cached latest GPS coordinates, speed, battery,
-- network mode, and calculated health state for O(1) live map lookups.
-- ==============================================================================

ALTER TABLE buses
ADD COLUMN IF NOT EXISTS last_latitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS last_longitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS last_location GEOGRAPHY(Point, 4326),
ADD COLUMN IF NOT EXISTS last_speed_kmh NUMERIC(5, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS last_accuracy_meters NUMERIC(6, 2),
ADD COLUMN IF NOT EXISTS last_bearing_degrees NUMERIC(5, 2),
ADD COLUMN IF NOT EXISTS last_battery_percentage SMALLINT,
ADD COLUMN IF NOT EXISTS last_is_charging BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_network_type VARCHAR(20) DEFAULT 'CELLULAR',
ADD COLUMN IF NOT EXISTS last_gps_recorded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS gps_health_status VARCHAR(30) DEFAULT 'OFFLINE';

CREATE INDEX IF NOT EXISTS idx_buses_gps_health ON buses(school_id, gps_health_status);
CREATE INDEX IF NOT EXISTS idx_buses_last_location_gist ON buses USING GIST(last_location);
