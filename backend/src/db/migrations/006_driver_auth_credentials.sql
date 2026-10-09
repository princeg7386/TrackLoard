-- ==============================================================================
-- Migration 006: Driver Authentication Credentials & Assigned Bus Authorization
-- ==============================================================================

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pin_hash VARCHAR(255) DEFAULT NULL;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS otp_code VARCHAR(10) DEFAULT NULL;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_drivers_phone_active ON drivers(phone) WHERE deleted_at IS NULL;
