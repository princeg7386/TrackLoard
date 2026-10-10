-- ==============================================================================
-- Migration 012: GPS Locations Deduplication & Idempotent Ingestion
-- Enforces unique constraint on (trip_id, recorded_at) to prevent duplicate
-- points caused by network retries, offline buffer flushes, or duplicate transmissions.
-- ==============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_gps_trip_recorded
ON gps_locations(trip_id, recorded_at);
