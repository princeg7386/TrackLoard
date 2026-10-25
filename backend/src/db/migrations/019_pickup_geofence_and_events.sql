-- ==============================================================================
-- Migration 019: Pickup Geofence Radius/Shape & Transition Events
-- Domain: Pickup stop geofence models (Radius vs Polygon),
--         Transition events ledger (ENTRY, EXIT, DWELL),
--         Active trip stop geofence states with dwell time tracking
-- ==============================================================================

-- 1. Extend pickup_locations with polygon and type support
ALTER TABLE pickup_locations
  ADD COLUMN IF NOT EXISTS geofence_type VARCHAR(20) NOT NULL DEFAULT 'RADIUS'
    CHECK (geofence_type IN ('RADIUS', 'POLYGON')),
  ADD COLUMN IF NOT EXISTS geofence_polygon JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS geofence_geometry GEOGRAPHY(Polygon, 4326) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_stops_geofence_geom_gist
  ON pickup_locations USING GIST(geofence_geometry)
  WHERE geofence_geometry IS NOT NULL;

-- 2. Immutable geofence transition events ledger
CREATE TABLE IF NOT EXISTS geofence_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  bus_id UUID NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
  stop_id UUID NOT NULL REFERENCES pickup_locations(id) ON DELETE CASCADE,
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('ENTRY', 'EXIT', 'DWELL')),
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  location GEOGRAPHY(Point, 4326),
  distance_to_center_meters NUMERIC(10,1),
  dwell_time_seconds INTEGER DEFAULT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_geofence_events_trip_stop
  ON geofence_events (trip_id, stop_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_geofence_events_school_recorded
  ON geofence_events (school_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_geofence_events_bus_id
  ON geofence_events (bus_id, recorded_at DESC);

-- 3. Live trip stop geofence states (per active trip)
CREATE TABLE IF NOT EXISTS trip_stop_geofence_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  stop_id UUID NOT NULL REFERENCES pickup_locations(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'OUTSIDE' CHECK (status IN ('INSIDE', 'OUTSIDE')),
  entered_at TIMESTAMPTZ DEFAULT NULL,
  exited_at TIMESTAMPTZ DEFAULT NULL,
  dwell_time_seconds INTEGER DEFAULT 0,
  last_evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_trip_stop_geofence_state UNIQUE (trip_id, stop_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_stop_geofence_trip
  ON trip_stop_geofence_states (trip_id);

CREATE INDEX IF NOT EXISTS idx_trip_stop_geofence_stop
  ON trip_stop_geofence_states (stop_id);
