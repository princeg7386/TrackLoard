-- ==============================================================================
-- Migration 020: School Geofence & Automated Arrival Detection
-- Domain: School Campus Geofence Boundary (Radius vs Polygon),
--         Automated School Arrival Detection & Trip State Transition
-- ==============================================================================

-- 1. Extend schools table with location and geofence boundary columns
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS location GEOGRAPHY(Point, 4326) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS geofence_type VARCHAR(20) NOT NULL DEFAULT 'RADIUS'
    CHECK (geofence_type IN ('RADIUS', 'POLYGON')),
  ADD COLUMN IF NOT EXISTS geofence_radius_meters INTEGER NOT NULL DEFAULT 500
    CHECK (geofence_radius_meters >= 50 AND geofence_radius_meters <= 5000),
  ADD COLUMN IF NOT EXISTS geofence_polygon JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS geofence_geometry GEOGRAPHY(Polygon, 4326) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auto_arrival_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_schools_location_gist ON schools USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_schools_geofence_geom_gist ON schools USING GIST(geofence_geometry)
  WHERE geofence_geometry IS NOT NULL;

-- 2. Extend geofence_events to support school campus events
ALTER TABLE geofence_events ALTER COLUMN stop_id DROP NOT NULL;

ALTER TABLE geofence_events
  ADD COLUMN IF NOT EXISTS target_type VARCHAR(20) NOT NULL DEFAULT 'STOP'
    CHECK (target_type IN ('STOP', 'SCHOOL'));

ALTER TABLE geofence_events DROP CONSTRAINT IF EXISTS geofence_events_event_type_check;
ALTER TABLE geofence_events ADD CONSTRAINT geofence_events_event_type_check
  CHECK (event_type IN ('ENTRY', 'EXIT', 'DWELL', 'SCHOOL_ARRIVAL', 'SCHOOL_DEPARTURE'));

CREATE INDEX IF NOT EXISTS idx_geofence_events_target_school
  ON geofence_events (school_id, target_type, recorded_at DESC);
