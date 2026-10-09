import { z } from 'zod';

/**
 * User Roles in School Transport
 */
export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  SCHOOL_ADMIN = 'SCHOOL_ADMIN',
  TRANSPORT_COORDINATOR = 'TRANSPORT_COORDINATOR',
  DRIVER = 'DRIVER',
  PARENT = 'PARENT',
}

/**
 * Trip Lifecycle States
 */
export enum TripStatus {
  SCHEDULED = 'SCHEDULED',
  IN_TRANSIT = 'IN_TRANSIT',
  DELAYED = 'DELAYED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  EMERGENCY = 'EMERGENCY',
}

/**
 * Stop Arrival / Boarding States
 */
export enum StopStatus {
  PENDING = 'PENDING',
  APPROACHING = 'APPROACHING',
  ARRIVED = 'ARRIVED',
  DEPARTED = 'DEPARTED',
  SKIPPED = 'SKIPPED',
}

/**
 * Student Boarding Attendance States
 */
export enum AttendanceStatus {
  PENDING = 'PENDING',
  BOARDED = 'BOARDED',
  ABSENT = 'ABSENT',
  DEBOARDED = 'DEBOARDED',
}

/**
 * Core Entity Schemas & Types
 */

// 1. School (Tenant Root)
export const SchoolSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2, 'School name must be at least 2 characters'),
  code: z.string().min(2).max(50).regex(/^[A-Za-z0-9_-]+$/, 'Code must be alphanumeric'),
  address: z.string().optional(),
  city: z.string().min(2, 'City is required'),
  state: z.string().min(2, 'State is required'),
  postalCode: z.string().optional(),
  phone: z.string().min(10, 'Valid contact phone required'),
  email: z.string().email().optional(),
  timezone: z.string().default('Asia/Kolkata'),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type School = z.infer<typeof SchoolSchema>;

// 2. Admin User
export const AdminUserSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid().optional(), // Nullable for Super Admin
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  fullName: z.string().min(2),
  phone: z.string().optional(),
  role: z.nativeEnum(UserRole).default(UserRole.SCHOOL_ADMIN),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

// 3. Driver (WhatsApp Linked)
export const DriverSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  fullName: z.string().min(2, 'Full name required'),
  phone: z.string().regex(/^\+?[1-9]\d{9,14}$/, 'Valid phone number with country code required'),
  licenseNumber: z.string().min(5, 'Valid license number required'),
  licenseExpiry: z.string().optional(), // ISO date YYYY-MM-DD
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type Driver = z.infer<typeof DriverSchema>;

// 4. Bus (Fleet Vehicle - NO capacity / NO active-inactive toggles)
export const BusSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  registrationNumber: z.string().min(3, 'Registration number required'), // e.g. "DL-01-AB-1234"
  busNumber: z.string().min(1, 'Bus internal identifier required'), // e.g. "Bus 04"
  defaultDriverId: z.string().uuid().nullable().optional(),
  deviceIdentifier: z.string().optional(),
  makeModel: z.string().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type Bus = z.infer<typeof BusSchema>;

// 5. Student
export const StudentSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  fullName: z.string().min(2, 'Student full name required'),
  admissionNumber: z.string().min(1, 'Admission number required'),
  classGrade: z.string().min(1, 'Class/Grade required'),
  section: z.string().min(1, 'Section required'),
  rollNumber: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type Student = z.infer<typeof StudentSchema>;

// 6. Parent (1:1 Direct Child Context)
export const ParentSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  studentId: z.string().uuid(),
  fullName: z.string().min(2, 'Parent full name required'),
  relationship: z.enum(['MOTHER', 'FATHER', 'GUARDIAN', 'PARENT']).default('PARENT'),
  phone: z.string().regex(/^\+?[1-9]\d{9,14}$/, 'WhatsApp phone number with country code required'),
  email: z.string().email().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type Parent = z.infer<typeof ParentSchema>;

/**
 * Geographic Coordinate Schema
 */
export const GeoCoordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type GeoCoordinates = z.infer<typeof GeoCoordinatesSchema>;

/**
 * Driver GPS Telemetry Ingestion Payload Schema
 */
export const TelemetryIngestSchema = z.object({
  tripId: z.string().uuid(),
  busId: z.string().uuid(),
  driverId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speedKmh: z.number().min(0).max(180).default(0),
  bearingDegrees: z.number().min(0).max(360).optional(),
  accuracyMeters: z.number().min(0).optional(),
  recordedAt: z.string().datetime(),
});
export type TelemetryIngestPayload = z.infer<typeof TelemetryIngestSchema>;

/**
 * Parent Live Web Tracking Session Token Payload
 */
export interface ParentTrackingTokenPayload {
  schoolId: string;
  studentId: string;
  tripId: string;
  stopId: string;
  exp: number;
}
