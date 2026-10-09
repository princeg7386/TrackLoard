-- ==============================================================================
-- Migration 008: School Profile Enhancements
-- Domain: School Profile, Logo, Affiliation & Website
-- ==============================================================================

ALTER TABLE schools 
ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500),
ADD COLUMN IF NOT EXISTS affiliation_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS website VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_schools_city_state ON schools(city, state) WHERE deleted_at IS NULL;
