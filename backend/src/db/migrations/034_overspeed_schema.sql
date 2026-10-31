-- ==============================================================================
-- Migration 034: Overspeed Schema
-- Domain: Overspeed Detection, Rule Configuration, Event Logging
-- Phase 29.1 — Rule: Configurable speed threshold + optional duration threshold
-- ==============================================================================

-- 1. Speed limit threshold on schools (default for all routes in the school)
ALTER TABLE schools ADD COLUMN IF NOT EXISTS speed_limit_kmh INTEGER DEFAULT 40;

-- 2. Optional duration the bus must exceed limit before an event triggers (seconds)
ALTER TABLE schools ADD COLUMN IF NOT EXISTS overspeed_duration_threshold_seconds INTEGER DEFAULT 10;

-- 3. Per-route speed limit override (NULL = inherit from school default)
ALTER TABLE routes ADD COLUMN IF NOT EXISTS speed_limit_kmh INTEGER;

-- 4. Per-route duration override (NULL = inherit from school default)
ALTER TABLE routes ADD COLUMN IF NOT EXISTS overspeed_duration_threshold_seconds INTEGER;

-- 5. Overspeed event log table
CREATE TABLE IF NOT EXISTS overspeed_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    bus_id UUID NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
    route_id UUID REFERENCES routes(id) ON DELETE SET NULL,

    -- Lifecycle
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',  -- 'ACTIVE' | 'RESOLVED'
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER NOT NULL DEFAULT 0,

    -- Speed data
    speed_limit_kmh INTEGER NOT NULL,
    max_speed_kmh NUMERIC(5, 2) NOT NULL,
    current_speed_kmh NUMERIC(5, 2) NOT NULL DEFAULT 0.00,

    -- Peak location (where highest speed was recorded)
    peak_latitude DOUBLE PRECISION NOT NULL,
    peak_longitude DOUBLE PRECISION NOT NULL,
    peak_location GEOGRAPHY(Point, 4326) NOT NULL,

    -- Notification tracking
    school_notified_at TIMESTAMPTZ,
    driver_notified_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overspeed_events_school ON overspeed_events(school_id);
CREATE INDEX IF NOT EXISTS idx_overspeed_events_trip ON overspeed_events(trip_id);
CREATE INDEX IF NOT EXISTS idx_overspeed_events_status ON overspeed_events(status);
CREATE INDEX IF NOT EXISTS idx_overspeed_events_active_trip ON overspeed_events(trip_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_overspeed_events_location ON overspeed_events USING GIST(peak_location);
