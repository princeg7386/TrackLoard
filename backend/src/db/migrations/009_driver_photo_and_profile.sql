-- ==============================================================================
-- Migration 009: Driver Photo URL & Profile Fields
-- ==============================================================================

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS photo_url VARCHAR(500) DEFAULT NULL;
