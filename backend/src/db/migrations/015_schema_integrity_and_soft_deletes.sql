-- ==============================================================================
-- Migration 015: Schema Integrity, Missing Soft-Deletes & Constraints
-- Domain: soft-delete columns (deleted_at) for operational tables,
--         partial unique indexes for re-registering soft-deleted entities,
--         CHECK constraint aligned with shared TripStatus enum
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

-- 3. Replace hard UNIQUE constraints with partial unique indexes (WHERE deleted_at IS NULL)
--    This allows soft-deleted rows to be re-added without constraint violations.
--    Drop both the old wrong name (from the previous repair attempt) AND the correct
--    original name (from migration 001) so the migration is idempotent on any DB state.

-- Buses
ALTER TABLE buses DROP CONSTRAINT IF EXISTS uq_bus_registration;
ALTER TABLE buses DROP CONSTRAINT IF EXISTS uq_bus_reg_school;
ALTER TABLE buses DROP CONSTRAINT IF EXISTS buses_registration_number_key;
DROP INDEX IF EXISTS idx_buses_registration_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_buses_registration_active
  ON buses(school_id, registration_number)
  WHERE deleted_at IS NULL;

-- Students
ALTER TABLE students DROP CONSTRAINT IF EXISTS uq_student_admission;
ALTER TABLE students DROP CONSTRAINT IF EXISTS uq_student_admission_school;
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_school_id_admission_number_key;
DROP INDEX IF EXISTS idx_students_admission_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_admission_active
  ON students(school_id, admission_number)
  WHERE deleted_at IS NULL;

-- Drivers
ALTER TABLE drivers DROP CONSTRAINT IF EXISTS uq_driver_phone_school;
ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_school_id_phone_key;
DROP INDEX IF EXISTS idx_drivers_phone_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_phone_active
  ON drivers(school_id, phone)
  WHERE deleted_at IS NULL;

-- Parents
ALTER TABLE parents DROP CONSTRAINT IF EXISTS uq_parent_student_phone;
ALTER TABLE parents DROP CONSTRAINT IF EXISTS parents_student_id_phone_key;
DROP INDEX IF EXISTS idx_parents_student_phone_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_parents_student_phone_active
  ON parents(student_id, phone)
  WHERE deleted_at IS NULL;

-- Routes
ALTER TABLE routes DROP CONSTRAINT IF EXISTS uq_route_code_school;
ALTER TABLE routes DROP CONSTRAINT IF EXISTS routes_school_id_code_key;
DROP INDEX IF EXISTS idx_routes_code_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_routes_code_active
  ON routes(school_id, code)
  WHERE deleted_at IS NULL;

-- 4. Trip status CHECK constraint — aligned with shared TripStatus enum:
--    SCHEDULED | IN_TRANSIT | DELAYED | COMPLETED | CANCELLED | EMERGENCY
--    Drop old constraint first (previous attempt used IN_PROGRESS which is wrong).
DO $$
BEGIN
  ALTER TABLE trips DROP CONSTRAINT IF EXISTS chk_trips_status;
  ALTER TABLE trips ADD CONSTRAINT chk_trips_status
    CHECK (status IN ('SCHEDULED', 'IN_TRANSIT', 'DELAYED', 'COMPLETED', 'CANCELLED', 'EMERGENCY'));
END $$;
