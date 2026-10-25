-- ==============================================================================
-- Migration 028: Long Stop Detection Schema
-- Domain: Unplanned Long Stop Detection, Stationary Duration, & Jitter Filtering
-- ==============================================================================

CREATE TABLE IF NOT EXISTS long_stops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    bus_id UUID NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    location GEOGRAPHY(Point, 4326) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    threshold_minutes INTEGER NOT NULL DEFAULT 5,
    speed_kmh NUMERIC(5, 2) DEFAULT 0.00,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'RESOLVED'
    stop_type VARCHAR(50) DEFAULT 'UNKNOWN',
    resolved_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_long_stops_school ON long_stops(school_id);
CREATE INDEX IF NOT EXISTS idx_long_stops_trip ON long_stops(trip_id);
CREATE INDEX IF NOT EXISTS idx_long_stops_status ON long_stops(status);
CREATE INDEX IF NOT EXISTS idx_long_stops_location_gist ON long_stops USING GIST(location);
