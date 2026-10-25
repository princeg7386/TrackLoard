-- ==============================================================================
-- Migration 030: Long Stop School Workflow
-- Domain: School Transport Desk Notifications, Acknowledgement & Event Resolution
-- ==============================================================================

ALTER TABLE long_stops
ADD COLUMN IF NOT EXISTS school_notified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES admins(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES admins(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS resolution_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_long_stops_acknowledged ON long_stops(acknowledged_at);
CREATE INDEX IF NOT EXISTS idx_long_stops_resolved ON long_stops(resolved_at);
