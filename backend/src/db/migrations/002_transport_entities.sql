-- ==============================================================================
-- Migration 002: Transport Entities Schema
-- Domain: Routes, Pickup Locations (Stops), Student Stop Assignments,
--         Trips, GPS Telemetry Locations, Boarding Events, Drop Events
-- ==============================================================================

-- 1. Routes
CREATE TABLE IF NOT EXISTS routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL,
    route_type VARCHAR(50) NOT NULL DEFAULT 'MORNING_PICKUP',
    default_bus_id UUID REFERENCES buses(id) ON DELETE SET NULL,
    default_driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
    path_polyline TEXT,
    estimated_duration_minutes INTEGER DEFAULT 45,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_route_code_school UNIQUE (school_id, code)
);

CREATE INDEX IF NOT EXISTS idx_routes_school_id ON routes(school_id);
CREATE INDEX IF NOT EXISTS idx_routes_type ON routes(school_id, route_type);

-- 2. Pickup Locations (Stops with Spatial PostGIS Geographies)
CREATE TABLE IF NOT EXISTS pickup_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    stop_name VARCHAR(255) NOT NULL,
    sequence_order INTEGER NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    location GEOGRAPHY(Point, 4326) NOT NULL,
    scheduled_time TIME NOT NULL,
    geofence_radius_meters INTEGER DEFAULT 300,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_route_sequence UNIQUE (route_id, sequence_order)
);

CREATE INDEX IF NOT EXISTS idx_stops_school_id ON pickup_locations(school_id);
CREATE INDEX IF NOT EXISTS idx_stops_route_id ON pickup_locations(route_id);
CREATE INDEX IF NOT EXISTS idx_stops_location_gist ON pickup_locations USING GIST(location);

-- 3. Student Stop Assignments
CREATE TABLE IF NOT EXISTS student_stop_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    pickup_stop_id UUID NOT NULL REFERENCES pickup_locations(id) ON DELETE CASCADE,
    drop_stop_id UUID REFERENCES pickup_locations(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_student_assignment UNIQUE (school_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_assignments_pickup_stop ON student_stop_assignments(pickup_stop_id);
CREATE INDEX IF NOT EXISTS idx_assignments_drop_stop ON student_stop_assignments(drop_stop_id);

-- 4. Trips (Trip State Machine & Scheduling)
CREATE TABLE IF NOT EXISTS trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    bus_id UUID NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
    scheduled_date DATE NOT NULL DEFAULT CURRENT_DATE,
    scheduled_start_time TIMESTAMPTZ NOT NULL,
    actual_start_time TIMESTAMPTZ,
    actual_end_time TIMESTAMPTZ,
    current_stop_sequence INTEGER DEFAULT 0,
    delay_minutes INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trips_school_status ON trips(school_id, status);
CREATE INDEX IF NOT EXISTS idx_trips_bus_id ON trips(bus_id);
CREATE INDEX IF NOT EXISTS idx_trips_driver_id ON trips(driver_id);
CREATE INDEX IF NOT EXISTS idx_trips_scheduled_date ON trips(scheduled_date);

-- 5. GPS Telemetry Locations (High-volume spatial time-series)
CREATE TABLE IF NOT EXISTS gps_locations (
    id BIGSERIAL PRIMARY KEY,
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    bus_id UUID NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    location GEOGRAPHY(Point, 4326) NOT NULL,
    speed_kmh NUMERIC(5, 2) DEFAULT 0.00,
    bearing_degrees NUMERIC(5, 2) DEFAULT 0.00,
    accuracy_meters NUMERIC(6, 2),
    recorded_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gps_trip_time ON gps_locations(trip_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_gps_location_gist ON gps_locations USING GIST(location);

-- 6. Boarding Events (Pickup Attendance Ledger)
CREATE TABLE IF NOT EXISTS boarding_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    stop_id UUID NOT NULL REFERENCES pickup_locations(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'BOARDED',
    marked_by VARCHAR(50) NOT NULL DEFAULT 'DRIVER',
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    location GEOGRAPHY(Point, 4326),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_trip_student_boarding UNIQUE (trip_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_boarding_trip_id ON boarding_events(trip_id);
CREATE INDEX IF NOT EXISTS idx_boarding_student_id ON boarding_events(student_id);
CREATE INDEX IF NOT EXISTS idx_boarding_stop_id ON boarding_events(stop_id);
CREATE INDEX IF NOT EXISTS idx_boarding_location_gist ON boarding_events USING GIST(location);

-- 7. Drop Events (Drop-off Attendance Ledger)
CREATE TABLE IF NOT EXISTS drop_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    stop_id UUID NOT NULL REFERENCES pickup_locations(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'DEBOARDED',
    marked_by VARCHAR(50) NOT NULL DEFAULT 'DRIVER',
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    location GEOGRAPHY(Point, 4326),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_trip_student_drop UNIQUE (trip_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_drop_trip_id ON drop_events(trip_id);
CREATE INDEX IF NOT EXISTS idx_drop_student_id ON drop_events(student_id);
CREATE INDEX IF NOT EXISTS idx_drop_stop_id ON drop_events(stop_id);
CREATE INDEX IF NOT EXISTS idx_drop_location_gist ON drop_events USING GIST(location);
