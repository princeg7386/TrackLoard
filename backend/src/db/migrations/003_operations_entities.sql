-- ==============================================================================
-- Migration 003: Operations & Safety Entities Schema
-- Domain: Notifications, Delays, Incidents, SOS Events, Temporary Pickups,
--         Absence Records, Operations Reports, Audit Logs
-- ==============================================================================

-- 1. Notifications (WhatsApp & SMS Outbound Dispatch Records)
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
    recipient_phone VARCHAR(20) NOT NULL,
    recipient_role VARCHAR(50) DEFAULT 'PARENT',
    channel VARCHAR(50) DEFAULT 'WHATSAPP',
    template_name VARCHAR(100),
    message_body TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'SENT',
    provider_message_id VARCHAR(255),
    failure_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_school_id ON notifications(school_id);
CREATE INDEX IF NOT EXISTS idx_notifications_trip_id ON notifications(trip_id);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_phone ON notifications(recipient_phone);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);

-- 2. Delays (Live Delay & Anomaly Detection Records)
CREATE TABLE IF NOT EXISTS delays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    stop_id UUID REFERENCES pickup_locations(id) ON DELETE SET NULL,
    expected_arrival TIMESTAMPTZ NOT NULL,
    predicted_arrival TIMESTAMPTZ NOT NULL,
    delay_minutes INTEGER NOT NULL,
    reason VARCHAR(255),
    notified_parents_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_delays_trip_id ON delays(trip_id);
CREATE INDEX IF NOT EXISTS idx_delays_school_id ON delays(school_id);

-- 3. Incidents (Vehicle Breakdown, Traffic, Route Issues)
CREATE TABLE IF NOT EXISTS incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
    bus_id UUID REFERENCES buses(id) ON DELETE SET NULL,
    driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
    incident_type VARCHAR(50) NOT NULL,
    severity VARCHAR(50) NOT NULL DEFAULT 'MEDIUM',
    status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
    description TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    location GEOGRAPHY(Point, 4326),
    reported_by VARCHAR(50) NOT NULL DEFAULT 'DRIVER',
    acknowledged_by UUID REFERENCES admins(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_school_status ON incidents(school_id, status);
CREATE INDEX IF NOT EXISTS idx_incidents_trip_id ON incidents(trip_id);
CREATE INDEX IF NOT EXISTS idx_incidents_location_gist ON incidents USING GIST(location);

-- 4. SOS Events (Priority Emergency Alerts)
CREATE TABLE IF NOT EXISTS sos_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    bus_id UUID NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    trigger_source VARCHAR(50) NOT NULL DEFAULT 'APP_SOS_BUTTON',
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    location GEOGRAPHY(Point, 4326) NOT NULL,
    speed_kmh NUMERIC(5, 2) DEFAULT 0.00,
    status VARCHAR(50) NOT NULL DEFAULT 'TRIGGERED',
    acknowledged_by UUID REFERENCES admins(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sos_school_status ON sos_events(school_id, status);
CREATE INDEX IF NOT EXISTS idx_sos_trip_id ON sos_events(trip_id);
CREATE INDEX IF NOT EXISTS idx_sos_location_gist ON sos_events USING GIST(location);

-- 5. Temporary Pickup Requests (Single-day Stop Override via Coordinator)
CREATE TABLE IF NOT EXISTS temporary_pickup_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    requested_by_phone VARCHAR(20) NOT NULL,
    original_stop_id UUID NOT NULL REFERENCES pickup_locations(id) ON DELETE CASCADE,
    requested_stop_id UUID NOT NULL REFERENCES pickup_locations(id) ON DELETE CASCADE,
    effective_date DATE NOT NULL,
    trip_type VARCHAR(50) DEFAULT 'MORNING_PICKUP',
    verified_by_coordinator BOOLEAN DEFAULT TRUE,
    coordinator_id UUID REFERENCES admins(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_temp_pickups_student_date ON temporary_pickup_requests(student_id, effective_date);
CREATE INDEX IF NOT EXISTS idx_temp_pickups_school ON temporary_pickup_requests(school_id);

-- 6. Absence Records (WhatsApp / Web Parent Absence Alerts)
CREATE TABLE IF NOT EXISTS absence_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    absence_date DATE NOT NULL,
    trip_type VARCHAR(50) DEFAULT 'FULL_DAY',
    reported_via VARCHAR(50) DEFAULT 'WHATSAPP',
    reported_by_phone VARCHAR(20) NOT NULL,
    reason VARCHAR(255),
    driver_notified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_student_absence_date_type UNIQUE (student_id, absence_date, trip_type)
);

CREATE INDEX IF NOT EXISTS idx_absence_student_date ON absence_records(student_id, absence_date);
CREATE INDEX IF NOT EXISTS idx_absence_school_date ON absence_records(school_id, absence_date);

-- 7. Reports (Fleet Operations & Safety Analytics Summaries)
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    report_type VARCHAR(50) NOT NULL,
    report_date DATE NOT NULL,
    metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_school_date ON reports(school_id, report_date);
CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(school_id, report_type);

-- 8. Audit Logs (Tenant-Isolated Administrative Audit Trail)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    user_id UUID,
    user_role VARCHAR(50) NOT NULL DEFAULT 'SCHOOL_ADMIN',
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    diff_json JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_school_id ON audit_logs(school_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
