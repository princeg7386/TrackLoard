-- ==============================================================================
-- Migration 010: Parent Notification Status, Delivery Tracking & Opt-Out
-- Domain: Delivery states, link access logs, opt-out preferences
-- ==============================================================================

-- 1. Extend parents table with notification preference and opt-out columns
ALTER TABLE parents
ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS opt_out_reason VARCHAR(255);

-- 2. Extend notifications table with parent/student links and delivery timestamps
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES parents(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- Indexes for rapid delivery history and status queries
CREATE INDEX IF NOT EXISTS idx_notifications_parent_id ON notifications(parent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_student_id ON notifications(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_school_status ON notifications(school_id, status);

-- 3. Token Access Activity Logs (Live Tracking visits)
CREATE TABLE IF NOT EXISTS parent_token_access_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_id UUID NOT NULL REFERENCES parent_tracking_tokens(id) ON DELETE CASCADE,
    parent_id UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    ip_address VARCHAR(45),
    user_agent TEXT,
    accessed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_access_logs_token_id ON parent_token_access_logs(token_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_access_logs_parent_id ON parent_token_access_logs(parent_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_access_logs_school_id ON parent_token_access_logs(school_id, accessed_at DESC);
