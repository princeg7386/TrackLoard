-- ==============================================================================
-- Migration 005: Admin Authentication, Password Reset & Security
-- ==============================================================================

ALTER TABLE admins ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(255) DEFAULT NULL;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_admins_reset_token ON admins(password_reset_token) WHERE password_reset_token IS NULL;
