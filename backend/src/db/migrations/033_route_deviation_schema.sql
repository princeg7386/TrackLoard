-- ==============================================================================
-- Migration 033: Route Deviation Schema
-- Domain: Route Deviation Detection, Corridor Monitoring & Position Analysis
-- ==============================================================================

CREATE TABLE IF NOT EXISTS route_deviations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    bus_id UUID NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
    route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'RESOLVED'
    severity VARCHAR(50) NOT NULL DEFAULT 'LOW', -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
    started_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    max_deviation_distance_meters DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    current_deviation_distance_meters DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    threshold_distance_meters INTEGER NOT NULL DEFAULT 100,
    debounce_count INTEGER NOT NULL DEFAULT 1,
    deviation_latitude DOUBLE PRECISION NOT NULL,
    deviation_longitude DOUBLE PRECISION NOT NULL,
    deviation_location GEOGRAPHY(Point, 4326) NOT NULL,
    nearest_route_latitude DOUBLE PRECISION,
    nearest_route_longitude DOUBLE PRECISION,
    nearest_stop_id UUID REFERENCES pickup_locations(id) ON DELETE SET NULL,
    school_notified_at TIMESTAMPTZ,
    driver_notified_at TIMESTAMPTZ,
    incident_record_id UUID,
    driver_reason VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_route_deviations_school ON route_deviations(school_id);
CREATE INDEX IF NOT EXISTS idx_route_deviations_trip ON route_deviations(trip_id);
CREATE INDEX IF NOT EXISTS idx_route_deviations_status ON route_deviations(status);
CREATE INDEX IF NOT EXISTS idx_route_deviations_active_trip ON route_deviations(trip_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_route_deviations_location_gist ON route_deviations USING GIST(deviation_location);

-- Configurable deviation threshold per route (in meters, default 100m for urban corridors)
ALTER TABLE routes ADD COLUMN IF NOT EXISTS deviation_threshold_meters INTEGER DEFAULT 100;
