-- ==============================================================================
-- Initialization Script for School Bus Tracking & Safety Platform
-- ==============================================================================

-- Enable UUID extension for robust distributed primary keys
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable PostGIS geospatial engine
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "postgis_topology";

-- Verify PostGIS installation
DO $$
BEGIN
    RAISE NOTICE 'PostGIS Version: %', PostGIS_Full_Version();
END $$;
