-- Migration: 027_trip_stop_expected_timeline.sql
-- Phase 25.1: Smart Delay Engine — Expected Timeline & Pickup Arrival Table
-- Stores pre-calculated baseline timeline and expected arrival for each pickup stop on a trip

CREATE TABLE IF NOT EXISTS trip_stop_timelines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    stop_id UUID NOT NULL REFERENCES pickup_locations(id) ON DELETE CASCADE,
    sequence_order INTEGER NOT NULL,
    scheduled_time TIME,
    expected_arrival TIMESTAMPTZ NOT NULL,
    expected_departure TIMESTAMPTZ,
    distance_from_start_meters INTEGER NOT NULL DEFAULT 0,
    duration_from_start_seconds INTEGER NOT NULL DEFAULT 0,
    dwell_seconds INTEGER NOT NULL DEFAULT 45,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ DEFAULT NULL,
    CONSTRAINT uq_trip_stop_timeline UNIQUE (trip_id, stop_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_stop_timelines_trip ON trip_stop_timelines(trip_id, sequence_order);
CREATE INDEX IF NOT EXISTS idx_trip_stop_timelines_school ON trip_stop_timelines(school_id);
CREATE INDEX IF NOT EXISTS idx_trip_stop_timelines_stop ON trip_stop_timelines(stop_id);
CREATE INDEX IF NOT EXISTS idx_trip_stop_timelines_deleted_at ON trip_stop_timelines(deleted_at);
