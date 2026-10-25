-- ==============================================================================
-- Migration 029: Long Stop Driver Reasons
-- Domain: Driver-Reported Categorization for Unplanned Dwells & Long Stops
-- ==============================================================================

ALTER TABLE long_stops
ADD COLUMN IF NOT EXISTS driver_reason VARCHAR(50),
ADD COLUMN IF NOT EXISTS driver_notes TEXT,
ADD COLUMN IF NOT EXISTS reason_reported_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS reason_source VARCHAR(50) DEFAULT 'WHATSAPP';

CREATE INDEX IF NOT EXISTS idx_long_stops_driver_reason ON long_stops(driver_reason);
