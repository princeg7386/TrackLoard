-- ==============================================================================
-- Migration 001: Core Entities Schema
-- Domain: School Multi-Tenancy, Admins, Drivers, Buses, Students, Parents
-- ==============================================================================

-- 1. Schools (Tenant Root)
CREATE TABLE IF NOT EXISTS schools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    address TEXT,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20),
    phone VARCHAR(20),
    email VARCHAR(255),
    timezone VARCHAR(50) DEFAULT 'Asia/Kolkata',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick school code lookup during tenant resolution
CREATE INDEX IF NOT EXISTS idx_schools_code ON schools(code);

-- 2. School Admins & Users
CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    role VARCHAR(50) NOT NULL DEFAULT 'SCHOOL_ADMIN',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admins_school_id ON admins(school_id);
CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);

-- 3. Drivers (WhatsApp-linked Driver Profiles)
CREATE TABLE IF NOT EXISTS drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    license_number VARCHAR(100) NOT NULL,
    license_expiry DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_driver_phone_school UNIQUE (school_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_drivers_school_id ON drivers(school_id);
CREATE INDEX IF NOT EXISTS idx_drivers_phone ON drivers(phone);

-- 4. Buses (Fleet Vehicles - NO capacity / NO active-inactive flags)
CREATE TABLE IF NOT EXISTS buses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    registration_number VARCHAR(50) NOT NULL,
    bus_number VARCHAR(50) NOT NULL,
    default_driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
    device_identifier VARCHAR(100),
    make_model VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_bus_reg_school UNIQUE (school_id, registration_number)
);

CREATE INDEX IF NOT EXISTS idx_buses_school_id ON buses(school_id);
CREATE INDEX IF NOT EXISTS idx_buses_default_driver_id ON buses(default_driver_id);

-- 5. Students (Student Directory)
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    full_name VARCHAR(255) NOT NULL,
    admission_number VARCHAR(100) NOT NULL,
    class_grade VARCHAR(50) NOT NULL,
    section VARCHAR(10) NOT NULL,
    roll_number VARCHAR(50),
    emergency_contact_phone VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_student_admission_school UNIQUE (school_id, admission_number)
);

CREATE INDEX IF NOT EXISTS idx_students_school_id ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_students_class_section ON students(school_id, class_grade, section);

-- 6. Parents (1:1 Direct Child Context)
CREATE TABLE IF NOT EXISTS parents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    full_name VARCHAR(255) NOT NULL,
    relationship VARCHAR(50) DEFAULT 'PARENT',
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_parent_student_phone UNIQUE (student_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_parents_school_id ON parents(school_id);
CREATE INDEX IF NOT EXISTS idx_parents_student_id ON parents(student_id);
CREATE INDEX IF NOT EXISTS idx_parents_phone ON parents(phone);
