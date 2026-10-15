-- ==============================================================================
-- Migration 015: Schema Integrity, Missing Soft-Deletes & Constraints
-- Domain: soft-delete columns (deleted_at) for operational tables,
--         partial unique indexes for re-registering soft-deleted entities,
--         CHECK constraints for trip and incident statuses
-- ==============================================================================

-- 1. Add deleted_at columns to operational tables queried by services
ALTER TABLE trips ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE delays ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE sos_events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE student_stop_assignments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE pickup_locations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Indexes for soft-delete queries
CREATE INDEX IF NOT EXISTS idx_trips_deleted_at ON trips(deleted_at);
CREATE INDEX IF NOT EXISTS idx_incidents_deleted_at ON incidents(deleted_at);
CREATE INDEX IF NOT EXISTS idx_delays_deleted_at ON delays(deleted_at);
CREATE INDEX IF NOT EXISTS idx_sos_events_deleted_at ON sos_events(deleted_at);
CREATE INDEX IF NOT EXISTS idx_student_stop_assignments_deleted_at ON student_stop_assignments(deleted_at);
CREATE INDEX IF NOT EXISTS idx_pickup_locations_deleted_at ON pickup_locations(deleted_at);

-- 3. Replace hard unique constraints with partial unique indexes (WHERE deleted_at IS NULL)
-- Buses: Allow re-registration of bus after soft delete
ALTER TABLE buses DROP CONSTRAINT IF EXISTS uq_bus_registration;
ALTER TABLE buses DROP CONSTRAINT IF EXISTS buses_registration_number_key;
DROP INDEX IF EXISTS idx_buses_registration_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_buses_registration_active ON buses(registration_number) WHERE deleted_at IS NULL;

-- Students: Allow re-adding admission number after soft delete
ALTER TABLE students DROP CONSTRAINT IF EXISTS uq_student_admission;
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_school_id_admission_number_key;
DROP INDEX IF EXISTS idx_students_admission_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_admission_active ON students(school_id, admission_number) WHERE deleted_at IS NULL;

-- Routes: Allow recreating route code after soft delete
ALTER TABLE routes DROP CONSTRAINT IF EXISTS uq_route_code_school;
ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_school_id_code_key;
DROP INDEX IF EXISTS idx_routes_code_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_routes_code_active ON routes(school_id, code) WHERE deleted_at IS NULL;

-- 4. Status CHECK constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_trips_status'
  ) THEN
    ALTER TABLE trips ADD CONSTRAINT chk_trips_status 
      CHECK (status IN ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DELAYED'));
  END IF;
END $$;
