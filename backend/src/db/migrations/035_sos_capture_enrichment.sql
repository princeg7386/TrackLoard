-- ==============================================================================
-- Migration 035: SOS Capture Enrichment
-- Domain: Emergency / SOS Capture
-- Phase 30.2 — Capture: Bus snapshot, Driver snapshot, GPS quality, Timestamp
-- ==============================================================================
--
-- Adds denormalised snapshot columns to sos_events so that the full context of
-- an SOS alert is preserved even if buses, drivers or routes are later edited
-- or soft-deleted.
--
-- Adds:
--   bus_number      TEXT          — bus registration at capture time
--   driver_name     TEXT          — driver full name at capture time
--   driver_phone    TEXT          — driver phone at capture time
--   route_name      TEXT          — route name at capture time
--   gps_accuracy_m  NUMERIC(6,1)  — GPS fix accuracy in metres (nullable — not always reported)
--   gps_recorded_at TIMESTAMPTZ   — when the GPS fix was taken (vs SOS trigger time)
-- ==============================================================================

ALTER TABLE sos_events
  ADD COLUMN IF NOT EXISTS bus_number      TEXT,
  ADD COLUMN IF NOT EXISTS driver_name     TEXT,
  ADD COLUMN IF NOT EXISTS driver_phone    TEXT,
  ADD COLUMN IF NOT EXISTS route_name      TEXT,
  ADD COLUMN IF NOT EXISTS gps_accuracy_m  NUMERIC(6,1),
  ADD COLUMN IF NOT EXISTS gps_recorded_at TIMESTAMPTZ;

-- Index: useful for admin history queries filtering by bus/driver identity
CREATE INDEX IF NOT EXISTS idx_sos_bus_number ON sos_events(bus_number);
