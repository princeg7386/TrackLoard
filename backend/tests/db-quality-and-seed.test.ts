import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  SchoolSchema,
  DriverSchema,
  BusSchema,
  RouteSchema,
  PickupLocationSchema,
  StudentSchema,
  ParentSchema,
  TripSchema,
} from '@school-bus/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Database Quality, Triggers & Seed Schema Integrity', () => {
  it('verifies migration 004 contains triggers, soft deletes, and partial indexes', () => {
    const migrationPath = path.join(
      __dirname,
      '../src/db/migrations/004_db_quality_soft_deletes_triggers.sql'
    );
    expect(fs.existsSync(migrationPath)).toBe(true);

    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION trigger_set_timestamp()');
    expect(sql).toContain('ALTER TABLE drivers ADD COLUMN IF NOT EXISTS deleted_at');
    expect(sql).toContain('ALTER TABLE buses ADD COLUMN IF NOT EXISTS deleted_at');
    expect(sql).toContain('ALTER TABLE routes ADD COLUMN IF NOT EXISTS deleted_at');
    expect(sql).toContain('CREATE TRIGGER set_timestamp_trips');
    expect(sql).toContain('WHERE deleted_at IS NULL');
  });

  it('validates that seed fixture definitions comply with all strict Zod contracts', () => {
    // 1. School
    const seedSchool = {
      name: 'Delhi Public School, R.K. Puram',
      code: 'DPS_RKP',
      address: 'Kaifi Azmi Marg, Sector XII, R.K. Puram',
      city: 'New Delhi',
      state: 'Delhi',
      phone: '+911126177000',
      email: 'transport@dpsrkp.net',
      timezone: 'Asia/Kolkata',
    };
    expect(SchoolSchema.parse(seedSchool).code).toBe('DPS_RKP');

    // 2. Driver
    const seedDriver = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      fullName: 'Ramesh Kumar Singh',
      phone: '+919876543210',
      licenseNumber: 'DL-0420110012345',
    };
    expect(DriverSchema.parse(seedDriver).phone).toBe('+919876543210');

    // 3. Bus (Zero capacity, zero active toggle)
    const seedBus = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      registrationNumber: 'DL-01-AB-1234',
      busNumber: 'Bus 04 (South Route)',
    };
    expect(BusSchema.parse(seedBus).registrationNumber).toBe('DL-01-AB-1234');

    // 4. Route & Stops
    const seedRoute = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      name: 'South Delhi Morning Route 04',
      code: 'RTE-S04',
      estimatedDurationMinutes: 40,
    };
    expect(RouteSchema.parse(seedRoute).code).toBe('RTE-S04');

    const seedStop = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      routeId: '223e4567-e89b-12d3-a456-426614174001',
      stopName: 'Green Park Metro Gate 2',
      sequenceOrder: 1,
      latitude: 28.5589,
      longitude: 77.2065,
      scheduledTime: '07:05:00',
      geofenceRadiusMeters: 300,
    };
    expect(PickupLocationSchema.parse(seedStop).latitude).toBe(28.5589);

    // 5. Student & 1:1 Parent
    const seedStudent = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      fullName: 'Aarav Sharma',
      admissionNumber: 'DPS-2026-881',
      classGrade: 'Class 8',
      section: 'A',
    };
    expect(StudentSchema.parse(seedStudent).fullName).toBe('Aarav Sharma');

    const seedParent = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      studentId: '223e4567-e89b-12d3-a456-426614174002',
      fullName: 'Vikram Sharma',
      phone: '+919811223344',
      relationship: 'PARENT' as const,
    };
    expect(ParentSchema.parse(seedParent).phone).toBe('+919811223344');

    // 6. Trip
    const seedTrip = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      routeId: '223e4567-e89b-12d3-a456-426614174001',
      busId: '323e4567-e89b-12d3-a456-426614174002',
      driverId: '423e4567-e89b-12d3-a456-426614174003',
      scheduledDate: '2026-10-10',
      scheduledStartTime: '2026-10-10T07:00:00Z',
    };
    expect(TripSchema.parse(seedTrip).scheduledDate).toBe('2026-10-10');
  });

  it('verifies that seed file is isolated to db/seed.ts and not bundled in production code', () => {
    const seedFilePath = path.join(__dirname, '../src/db/seed.ts');
    expect(fs.existsSync(seedFilePath)).toBe(true);

    const backendIndexPath = path.join(__dirname, '../src/index.ts');
    const indexSource = fs.readFileSync(backendIndexPath, 'utf-8');
    expect(indexSource).not.toContain('seedDatabase');
    expect(indexSource).not.toContain('Ramesh Kumar Singh');
  });
});
