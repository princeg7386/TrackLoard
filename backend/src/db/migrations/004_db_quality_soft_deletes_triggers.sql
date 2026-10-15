-- ==============================================================================
-- Migration 004: Database Quality, Auto-Updating Timestamps & Soft Deletes
-- ==============================================================================

-- 1. Reusable Timestamp Auto-Update Trigger Function
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backward compatibility alias
CREATE OR REPLACE FUNCTION update_timestamp_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Soft-Delete Columns (`deleted_at`) for Core Entities
ALTER TABLE schools ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE buses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE parents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- 3. Automatic `BEFORE UPDATE` Triggers
DROP TRIGGER IF EXISTS set_timestamp_schools ON schools;
CREATE TRIGGER set_timestamp_schools
BEFORE UPDATE ON schools
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp_admins ON admins;
CREATE TRIGGER set_timestamp_admins
BEFORE UPDATE ON admins
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp_drivers ON drivers;
CREATE TRIGGER set_timestamp_drivers
BEFORE UPDATE ON drivers
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp_buses ON buses;
CREATE TRIGGER set_timestamp_buses
BEFORE UPDATE ON buses
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp_routes ON routes;
CREATE TRIGGER set_timestamp_routes
BEFORE UPDATE ON routes
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp_pickup_locations ON pickup_locations;
CREATE TRIGGER set_timestamp_pickup_locations
BEFORE UPDATE ON pickup_locations
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp_students ON students;
CREATE TRIGGER set_timestamp_students
BEFORE UPDATE ON students
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp_parents ON parents;
CREATE TRIGGER set_timestamp_parents
BEFORE UPDATE ON parents
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp_trips ON trips;
CREATE TRIGGER set_timestamp_trips
BEFORE UPDATE ON trips
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_timestamp_incidents ON incidents;
CREATE TRIGGER set_timestamp_incidents
BEFORE UPDATE ON incidents
FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

-- 4. Partial Performance Indexes for Active (Non-Deleted) Entities
CREATE INDEX IF NOT EXISTS idx_active_schools ON schools(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_active_drivers ON drivers(school_id, phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_active_buses ON buses(school_id, registration_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_active_routes ON routes(school_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_active_students ON students(school_id, class_grade, section) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_active_parents ON parents(school_id, student_id) WHERE deleted_at IS NULL;
