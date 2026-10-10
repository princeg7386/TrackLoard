-- ==============================================================================
-- Migration 011: GPS Telemetry Battery & Network Tracking
-- Extends gps_locations table with device battery percentage, charging state,
-- and network carrier mode for comprehensive fleet telemetry.
-- ==============================================================================

ALTER TABLE gps_locations
ADD COLUMN IF NOT EXISTS battery_percentage SMALLINT,
ADD COLUMN IF NOT EXISTS is_charging BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS network_type VARCHAR(20) DEFAULT 'CELLULAR';

CREATE INDEX IF NOT EXISTS idx_gps_bus_recorded ON gps_locations(bus_id, recorded_at DESC);
