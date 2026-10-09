import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  SchoolSchema,
  AdminUserSchema,
  DriverSchema,
  BusSchema,
  StudentSchema,
  ParentSchema,
  UserRole,
} from '@school-bus/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Core Entity Schemas & Guardrails', () => {
  it('validates School entity schema correctly', () => {
    const validSchool = {
      name: 'Delhi Public School, R.K. Puram',
      code: 'DPS_RKP_01',
      city: 'New Delhi',
      state: 'Delhi',
      phone: '+911126177000',
      email: 'transport@dpsrkp.net',
      timezone: 'Asia/Kolkata',
    };
    const parsed = SchoolSchema.parse(validSchool);
    expect(parsed.code).toBe('DPS_RKP_01');
    expect(parsed.timezone).toBe('Asia/Kolkata');

    // Invalid school code with spaces
    expect(() =>
      SchoolSchema.parse({ ...validSchool, code: 'DPS INVALID CODE' })
    ).toThrow();
  });

  it('validates Driver entity schema with WhatsApp phone requirements', () => {
    const validDriver = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      fullName: 'Ramesh Singh',
      phone: '+919876543210',
      licenseNumber: 'DL-0420110012345',
    };
    const parsed = DriverSchema.parse(validDriver);
    expect(parsed.fullName).toBe('Ramesh Singh');
    expect(parsed.phone).toBe('+919876543210');

    // Invalid phone number format
    expect(() =>
      DriverSchema.parse({ ...validDriver, phone: 'invalid-phone' })
    ).toThrow();
  });

  it('validates Bus schema strictly without capacity or active/inactive flags', () => {
    const validBus = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      registrationNumber: 'DL-01-AB-1234',
      busNumber: 'Bus 04 (North Route)',
      makeModel: 'Tata Starbus Ultra',
    };
    const parsed = BusSchema.parse(validBus);
    expect(parsed.registrationNumber).toBe('DL-01-AB-1234');

    // Ensure capacity and active/inactive are not part of parsed schema fields
    expect((parsed as any).capacity).toBeUndefined();
    expect((parsed as any).isActive).toBeUndefined();
  });

  it('validates 1:1 Student and Parent relationships', () => {
    const validStudent = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      fullName: 'Aarav Sharma',
      admissionNumber: 'ADM-2026-8841',
      classGrade: 'Class 8',
      section: 'B',
      rollNumber: '14',
    };
    const parsedStudent = StudentSchema.parse(validStudent);
    expect(parsedStudent.admissionNumber).toBe('ADM-2026-8841');

    const validParent = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      studentId: '223e4567-e89b-12d3-a456-426614174001',
      fullName: 'Vikram Sharma',
      relationship: 'FATHER' as const,
      phone: '+919811223344',
      email: 'vikram.sharma@example.com',
    };
    const parsedParent = ParentSchema.parse(validParent);
    expect(parsedParent.relationship).toBe('FATHER');
    expect(parsedParent.studentId).toBe('223e4567-e89b-12d3-a456-426614174001');
  });

  it('verifies migration 001_core_entities.sql exists and contains required tables and constraints', () => {
    const migrationPath = path.join(
      __dirname,
      '../src/db/migrations/001_core_entities.sql'
    );
    expect(fs.existsSync(migrationPath)).toBe(true);

    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS schools');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS admins');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS drivers');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS buses');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS students');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS parents');

    // Verify scope constraints (no capacity or active flag in buses table)
    expect(sql).not.toContain('capacity INTEGER');
    expect(sql).not.toContain('is_active BOOLEAN');
  });
});
