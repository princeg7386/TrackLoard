-- ==============================================================================
-- Migration 016: Add ARRIVED_SCHOOL to trip status CHECK constraint
-- Domain: Trip Lifecycle State Machine (Micro-phase 16.1)
-- ==============================================================================

ALTER TABLE trips DROP CONSTRAINT IF EXISTS chk_trips_status;
ALTER TABLE trips ADD CONSTRAINT chk_trips_status
  CHECK (status IN ('SCHEDULED', 'IN_TRANSIT', 'DELAYED', 'ARRIVED_SCHOOL', 'COMPLETED', 'CANCELLED', 'EMERGENCY'));
