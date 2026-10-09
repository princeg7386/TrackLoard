-- ==============================================================================
-- Migration 007: Parent Tracking Tokens & WhatsApp Identity
-- Domain: Parent Live Tracking Tokens, Expiry, Revocation & Auditing
-- ==============================================================================

CREATE TABLE IF NOT EXISTS parent_tracking_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    parent_id UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    token_prefix VARCHAR(16) NOT NULL,
    purpose VARCHAR(50) NOT NULL DEFAULT 'LIVE_TRACKING',
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    last_accessed_at TIMESTAMPTZ,
    access_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- Fast lookup index for token validation by token hash
CREATE INDEX IF NOT EXISTS idx_parent_tokens_hash ON parent_tracking_tokens(token_hash) WHERE deleted_at IS NULL;

-- Fast index for student and parent level batch revocation
CREATE INDEX IF NOT EXISTS idx_parent_tokens_student ON parent_tracking_tokens(student_id) WHERE deleted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_parent_tokens_parent ON parent_tracking_tokens(parent_id) WHERE deleted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_parent_tokens_school ON parent_tracking_tokens(school_id);
CREATE INDEX IF NOT EXISTS idx_parent_tokens_expires ON parent_tracking_tokens(expires_at);

-- Attach standard updated_at trigger
DROP TRIGGER IF EXISTS trg_parent_tracking_tokens_updated_at ON parent_tracking_tokens;
CREATE TRIGGER trg_parent_tracking_tokens_updated_at
BEFORE UPDATE ON parent_tracking_tokens
FOR EACH ROW
EXECUTE FUNCTION update_timestamp_column();
