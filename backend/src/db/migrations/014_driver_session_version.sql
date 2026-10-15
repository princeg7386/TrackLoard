-- ==============================================================================
-- Migration 014: Driver Session Token Version and Revocation Timestamp
-- ==============================================================================

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS session_revoked_at TIMESTAMPTZ DEFAULT NULL;
