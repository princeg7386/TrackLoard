-- ==============================================================================
-- Migration 017: Attendance Corrections & Journey History Audit Ledger
-- Domain: Driver Attendance (Micro-phase 18.4)
-- Description: Immutable audit trail for attendance corrections made during
--              or post-trip with mandatory reason, user attribution, and PostGIS location.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS attendance_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('BOARDING', 'DROP')),
    previous_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    reason TEXT NOT NULL,
    -- corrected_by stores either admins.id (for SCHOOL_ADMIN/TRANSPORT_COORDINATOR)
    -- or drivers.id (for DRIVER role). No FK because these live in separate tables;
    -- corrected_by_role disambiguates which table the UUID refers to.
    corrected_by UUID NOT NULL,
    corrected_by_role VARCHAR(50) NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    location GEOGRAPHY(Point, 4326),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for high-performance multi-tenant history and student journey lookup
CREATE INDEX IF NOT EXISTS idx_attendance_corrections_school_id ON attendance_corrections(school_id);
CREATE INDEX IF NOT EXISTS idx_attendance_corrections_trip_id ON attendance_corrections(trip_id);
CREATE INDEX IF NOT EXISTS idx_attendance_corrections_student_id ON attendance_corrections(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_corrections_created_at ON attendance_corrections(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_corrections_location_gist ON attendance_corrections USING GIST(location);
