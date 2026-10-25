-- ==============================================================================
-- Migration 031: GPS Offline & Recovery Schema
-- Domain: GPS Stale Location, Internet Loss, and Driver App Disconnect Detection
-- Phase: 27 — GPS Offline & Recovery (Micro-phase 27.1)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS gps_offline_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    bus_id UUID NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
    detection_type VARCHAR(50) NOT NULL, -- 'STALE_LOCATION', 'INTERNET_LOSS', 'APP_DISCONNECT'
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'RESOLVED'
    started_at TIMESTAMPTZ NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    stale_threshold_seconds INTEGER NOT NULL DEFAULT 60,
    disconnect_threshold_seconds INTEGER NOT NULL DEFAULT 120,
    last_known_latitude DOUBLE PRECISION,
    last_known_longitude DOUBLE PRECISION,
    last_known_location GEOGRAPHY(Point, 4326),
    last_known_recorded_at TIMESTAMPTZ,
    last_network_type VARCHAR(50),
    last_battery_percentage INTEGER,
    resolved_at TIMESTAMPTZ,
    recovery_reason VARCHAR(100),
    school_notified_at TIMESTAMPTZ,
    driver_notified_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gps_offline_school ON gps_offline_events(school_id);
CREATE INDEX IF NOT EXISTS idx_gps_offline_trip ON gps_offline_events(trip_id);
CREATE INDEX IF NOT EXISTS idx_gps_offline_bus ON gps_offline_events(bus_id);
CREATE INDEX IF NOT EXISTS idx_gps_offline_status ON gps_offline_events(status);
CREATE INDEX IF NOT EXISTS idx_gps_offline_type ON gps_offline_events(detection_type);
CREATE INDEX IF NOT EXISTS idx_gps_offline_location_gist ON gps_offline_events USING GIST(last_known_location);
