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
 * Route Types
 */
export enum RouteType {
  MORNING_PICKUP = 'MORNING_PICKUP',
  AFTERNOON_DROP = 'AFTERNOON_DROP',
  SPECIAL_TRIP = 'SPECIAL_TRIP',
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
  SKIPPED = 'SKIPPED',
}

/**
 * Incident Severity & Status
 */
export enum IncidentSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum IncidentStatus {
  OPEN = 'OPEN',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  RESOLVED = 'RESOLVED',
}

export enum SosStatus {
  TRIGGERED = 'TRIGGERED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  FIRST_RESPONDERS_NOTIFIED = 'FIRST_RESPONDERS_NOTIFIED',
  RESOLVED = 'RESOLVED',
}

/**
 * Geographic Coordinate Schema
 */
export const GeoCoordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type GeoCoordinates = z.infer<typeof GeoCoordinatesSchema>;

/**
 * Pure Haversine distance formula (in meters) between two coordinates
 */
export function calculateHaversineDistanceMeters(
  point1: GeoCoordinates,
  point2: GeoCoordinates
): number {
  const R = 6371e3; // Earth radius in meters
  const lat1Rad = (point1.latitude * Math.PI) / 180;
  const lat2Rad = (point2.latitude * Math.PI) / 180;
  const deltaLat = ((point2.latitude - point1.latitude) * Math.PI) / 180;
  const deltaLng = ((point2.longitude - point1.longitude) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1Rad) *
      Math.cos(lat2Rad) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Checks if point is within circular geofence radius
 */
export function isPointInGeofence(
  point: GeoCoordinates,
  center: GeoCoordinates,
  radiusMeters: number
): boolean {
  const distance = calculateHaversineDistanceMeters(point, center);
  return distance <= radiusMeters;
}

/**
 * Calculates bearing angle in degrees (0 - 360) from start to destination
 */
export function calculateBearingDegrees(
  start: GeoCoordinates,
  end: GeoCoordinates
): number {
  const startLat = (start.latitude * Math.PI) / 180;
  const startLng = (start.longitude * Math.PI) / 180;
  const endLat = (end.latitude * Math.PI) / 180;
  const endLng = (end.longitude * Math.PI) / 180;

  const dLng = endLng - startLng;

  const y = Math.sin(dLng) * Math.cos(endLat);
  const x =
    Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(dLng);

  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return Math.round((brng + 360) % 360);
}

/**
 * -----------------------------------------------------------------------------
 * Core Entity Schemas & Types
 * -----------------------------------------------------------------------------
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
  logoUrl: z.string().url('Valid logo URL required').optional().nullable(),
  affiliationNumber: z.string().optional().nullable(),
  website: z.string().url('Valid website URL required').optional().nullable(),
  timezone: z.string().default('Asia/Kolkata'),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type School = z.infer<typeof SchoolSchema>;

export const UpdateSchoolProfileRequestSchema = z.object({
  name: z.string().min(2, 'School name must be at least 2 characters').max(255),
  address: z.string().min(5, 'Full street address is required').max(500),
  city: z.string().min(2, 'City is required').max(100),
  state: z.string().min(2, 'State is required').max(100),
  postalCode: z.string().regex(/^\d{6}$/, 'Valid 6-digit Indian PIN code required').optional().or(z.literal('')),
  phone: z.string().min(10, 'Valid contact phone required'),
  email: z.string().email('Please enter a valid official email address'),
  logoUrl: z.string().url('Please provide a valid logo image URL').optional().nullable().or(z.literal('')),
  affiliationNumber: z.string().max(100).optional().nullable().or(z.literal('')),
  website: z.string().url('Please provide a valid website URL').optional().nullable().or(z.literal('')),
  timezone: z.string().default('Asia/Kolkata'),
});
export type UpdateSchoolProfileRequest = z.infer<typeof UpdateSchoolProfileRequestSchema>;

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
  licenseExpiry: z.string().optional().nullable(),
  photoUrl: z.string().optional().nullable(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type Driver = z.infer<typeof DriverSchema>;

export const CreateDriverRequestSchema = z.object({
  fullName: z.string().min(2, 'Driver full name must be at least 2 characters').max(100),
  phone: z.string().min(10, 'Valid 10-digit mobile phone number required'),
  licenseNumber: z.string().min(5, 'Valid Indian driving license number required (min 5 chars)').max(50),
  licenseExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'License expiry must be in YYYY-MM-DD format').optional().nullable().or(z.literal('')),
  photoUrl: z.string().max(500).optional().nullable().or(z.literal('')),
  pin: z.string().regex(/^\d{4,6}$/, 'Driver login PIN must be 4 to 6 digits').optional().nullable().or(z.literal('')),
  assignedBusId: z.string().uuid('Please select a valid vehicle').optional().nullable().or(z.literal('')),
});
export type CreateDriverRequest = z.infer<typeof CreateDriverRequestSchema>;

export const UpdateDriverRequestSchema = CreateDriverRequestSchema.partial();
export type UpdateDriverRequest = z.infer<typeof UpdateDriverRequestSchema>;

export const ResetDriverPinRequestSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/, 'Driver login PIN must be 4 to 6 digits'),
});
export type ResetDriverPinRequest = z.infer<typeof ResetDriverPinRequestSchema>;

export const AssignDriverBusPayloadSchema = z.object({
  busId: z.string().uuid('Valid vehicle UUID required').nullable().optional(),
});
export type AssignDriverBusPayload = z.infer<typeof AssignDriverBusPayloadSchema>;


export interface DriverWithBus extends Driver {
  assignedBusId?: string | null;
  assignedBusNumber?: string | null;
  assignedRegistrationNumber?: string | null;
  assignedRouteId?: string | null;
  assignedRouteName?: string | null;
  assignedRouteCode?: string | null;
  lastActiveAt?: string | null;
}


// 4. Bus (Fleet Vehicle - NO capacity / NO active-inactive toggles)
export const IndianVehicleRegistrationRegex =
  /^[A-Z]{2}[ -]?[0-9]{1,2}[ -]?(?:[A-Z]{1,3}[ -]?)?[0-9]{4}$|^[0-9]{2}[ -]?BH[ -]?[0-9]{4}[ -]?[A-Z]{1,2}$/i;

export function normalizeIndianRegistrationNumber(reg: string): string {
  if (!reg) return '';
  return reg.trim().toUpperCase().replace(/[\s-]+/g, '-');
}

export const BusSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  registrationNumber: z.string().min(3, 'Registration number required'),
  busNumber: z.string().min(1, 'Bus internal identifier required'),
  defaultDriverId: z.string().uuid().nullable().optional(),
  deviceIdentifier: z.string().optional().nullable(),
  makeModel: z.string().optional().nullable(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type Bus = z.infer<typeof BusSchema>;

export const CreateBusRequestSchema = z.object({
  busNumber: z.string().min(1, 'Bus internal number is required (e.g. Bus-01 or Yellow-04)').max(50),
  registrationNumber: z
    .string()
    .min(4, 'Valid vehicle registration number required')
    .max(20)
    .regex(
      IndianVehicleRegistrationRegex,
      'Must be a valid Indian vehicle registration number (e.g. DL-01-AB-1234, MH-12-DE-1433, or 22-BH-1234-AA)'
    ),
  makeModel: z.string().max(100).optional().nullable().or(z.literal('')),
  deviceIdentifier: z.string().max(100).optional().nullable().or(z.literal('')),
  defaultDriverId: z.string().uuid('Please select a valid driver').optional().nullable().or(z.literal('')),
});
export type CreateBusRequest = z.infer<typeof CreateBusRequestSchema>;

export const UpdateBusRequestSchema = CreateBusRequestSchema.partial();
export type UpdateBusRequest = z.infer<typeof UpdateBusRequestSchema>;

export const AssignBusPayloadSchema = z.object({
  driverId: z.string().uuid('Valid driver UUID required').nullable().optional(),
  routeId: z.string().uuid('Valid route UUID required').nullable().optional(),
});
export type AssignBusPayload = z.infer<typeof AssignBusPayloadSchema>;

export interface BusWithDriver extends Bus {
  driverName?: string | null;
  driverPhone?: string | null;
  driverLicenseNumber?: string | null;
  assignedRouteId?: string | null;
  assignedRouteName?: string | null;
  assignedRouteCode?: string | null;
  assignedRouteType?: string | null;
}

export interface BusCurrentLocation {
  latitude: number;
  longitude: number;
  speedKmh: number;
  bearingDegrees?: number | null;
  accuracyMeters?: number | null;
  recordedAt: string;
}

export interface BusCurrentTrip {
  id: string;
  routeId: string;
  routeName: string;
  routeCode: string;
  routeType: string;
  status: string;
  scheduledStartTime: string;
  actualStartTime?: string | null;
  currentStopSequence: number;
  delayMinutes: number;
}

export interface BusDetailView extends BusWithDriver {
  currentLocation?: BusCurrentLocation | null;
  currentTrip?: BusCurrentTrip | null;
}

export interface BusTripHistoryItem {
  id: string;
  schoolId: string;
  routeId: string;
  routeName: string;
  routeCode: string;
  routeType: string;
  driverId: string;
  driverName: string;
  driverPhone?: string | null;
  status: string;
  scheduledDate: string;
  scheduledStartTime: string;
  actualStartTime?: string | null;
  actualEndTime?: string | null;
  currentStopSequence: number;
  delayMinutes: number;
  totalBoarded?: number;
  totalExpected?: number;
}

export interface BusIncidentHistoryItem {
  id: string;
  schoolId: string;
  tripId?: string | null;
  category: 'INCIDENT' | 'SOS';
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: string;
  description: string;
  driverName?: string | null;
  routeName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  reportedBy?: string | null;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  resolutionNotes?: string | null;
  createdAt: string;
}

export interface BusAttendanceSummaryItem {
  tripId: string;
  scheduledDate: string;
  routeName: string;
  routeCode: string;
  shiftType: string;
  driverName: string;
  totalBoarded: number;
  totalAbsent: number;
  totalDeboarded: number;
  totalEvents: number;
}

export interface BusAttendanceRecordItem {
  id: string;
  tripId: string;
  scheduledDate: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  classGrade: string;
  section: string;
  stopName: string;
  eventType: 'BOARDING' | 'DROP';
  status: string;
  markedBy: string;
  recordedAt: string;
}

export interface BusAttendanceHistoryResponse {
  summaries: BusAttendanceSummaryItem[];
  recentRecords: BusAttendanceRecordItem[];
}

export interface BusFullHistoryResponse {
  bus: BusWithDriver;
  trips: BusTripHistoryItem[];
  incidents: BusIncidentHistoryItem[];
  attendance: BusAttendanceHistoryResponse;
}

export interface DriverTripHistoryItem {
  id: string;
  schoolId: string;
  routeId: string;
  routeName: string;
  routeCode: string;
  routeType: string;
  busId: string;
  busNumber: string;
  busRegistrationNumber: string;
  status: string;
  scheduledDate: string;
  scheduledStartTime: string;
  actualStartTime?: string | null;
  actualEndTime?: string | null;
  currentStopSequence: number;
  delayMinutes: number;
  totalBoarded?: number;
  totalExpected?: number;
}

export interface DriverIncidentHistoryItem {
  id: string;
  schoolId: string;
  tripId?: string | null;
  category: 'INCIDENT' | 'SOS';
  type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: string;
  description: string;
  busNumber?: string | null;
  busRegistrationNumber?: string | null;
  routeName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  reportedBy?: string | null;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  resolutionNotes?: string | null;
  createdAt: string;
}

export interface DriverAttendanceSummaryItem {
  tripId: string;
  scheduledDate: string;
  routeName: string;
  routeCode: string;
  shiftType: string;
  busNumber: string;
  busRegistrationNumber: string;
  totalBoarded: number;
  totalAbsent: number;
  totalDeboarded: number;
  totalEvents: number;
}

export interface DriverAttendanceRecordItem {
  id: string;
  tripId: string;
  scheduledDate: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  classGrade: string;
  section: string;
  stopName: string;
  busNumber: string;
  eventType: 'BOARDING' | 'DROP';
  status: string;
  markedBy: string;
  recordedAt: string;
}

export interface DriverAttendanceHistoryResponse {
  summaries: DriverAttendanceSummaryItem[];
  recentRecords: DriverAttendanceRecordItem[];
}

export interface DriverFullHistoryResponse {
  driver: DriverWithBus;
  trips: DriverTripHistoryItem[];
  incidents: DriverIncidentHistoryItem[];
  attendance: DriverAttendanceHistoryResponse;
}


// 5. Student
export const StudentSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  fullName: z.string().min(2, 'Student full name required'),
  admissionNumber: z.string().min(1, 'Admission number required'),
  classGrade: z.string().min(1, 'Class/Grade required'),
  section: z.string().min(1, 'Section required'),
  rollNumber: z.string().optional().nullable(),
  emergencyContactPhone: z.string().optional().nullable(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type Student = z.infer<typeof StudentSchema>;

export const CreateStudentRequestSchema = z.object({
  fullName: z.string().min(2, 'Student full name must be at least 2 characters').max(100),
  admissionNumber: z.string().min(1, 'Admission number / Student ID is required').max(50),
  classGrade: z.string().min(1, 'Class/Grade is required (e.g. Class 5, Grade 10)').max(50),
  section: z.string().min(1, 'Section is required (e.g. A, B)').max(10),
  rollNumber: z.string().max(50).optional().nullable().or(z.literal('')),
  emergencyContactPhone: z.string().optional().nullable().or(z.literal('')),
  guardianName: z.string().max(100).optional().nullable().or(z.literal('')),
  guardianPhone: z.string().optional().nullable().or(z.literal('')),
  guardianRelationship: z.enum(['MOTHER', 'FATHER', 'GUARDIAN', 'PARENT']).optional().nullable(),
  guardianEmail: z.string().email('Invalid guardian email').optional().nullable().or(z.literal('')),
});
export type CreateStudentRequest = z.infer<typeof CreateStudentRequestSchema>;

export const UpdateStudentRequestSchema = CreateStudentRequestSchema.partial();
export type UpdateStudentRequest = z.infer<typeof UpdateStudentRequestSchema>;

export interface ParentGuardianRecord {
  id: string;
  schoolId: string;
  studentId: string;
  fullName: string;
  relationship: 'MOTHER' | 'FATHER' | 'GUARDIAN' | 'PARENT';
  phone: string;
  email?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export const UpsertParentGuardianRequestSchema = z.object({
  fullName: z.string().min(2, 'Guardian full name must be at least 2 characters').max(100),
  relationship: z.enum(['MOTHER', 'FATHER', 'GUARDIAN', 'PARENT']).default('PARENT'),
  phone: z.string().min(10, 'Valid 10-digit WhatsApp mobile phone number required'),
  email: z.string().email('Please enter a valid email address').optional().nullable().or(z.literal('')),
  emergencyContactPhone: z.string().optional().nullable().or(z.literal('')),
});
export type UpsertParentGuardianRequest = z.infer<typeof UpsertParentGuardianRequestSchema>;

export const AssignStudentTransportPayloadSchema = z.object({
  pickupStopId: z.string().uuid('Valid pickup stop UUID required').nullable().optional().or(z.literal('')),
  dropStopId: z.string().uuid('Valid drop stop UUID required').nullable().optional().or(z.literal('')),
});
export type AssignStudentTransportPayload = z.infer<typeof AssignStudentTransportPayloadSchema>;

export interface StopOptionItem {
  id: string;
  stopName: string;
  sequenceOrder: number;
  scheduledTime: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters?: number;
}

export interface RouteWithStopsOption {
  id: string;
  name: string;
  code: string;
  routeType: string;
  busId?: string | null;
  busNumber?: string | null;
  busRegistrationNumber?: string | null;
  stops: StopOptionItem[];
}

export interface StudentWithDetails extends Student {
  pickupStopId?: string | null;
  pickupStopName?: string | null;
  pickupScheduledTime?: string | null;
  dropStopId?: string | null;
  dropStopName?: string | null;
  dropScheduledTime?: string | null;
  assignedRouteId?: string | null;
  assignedRouteName?: string | null;
  assignedRouteCode?: string | null;
  assignedBusId?: string | null;
  assignedBusNumber?: string | null;
  assignedBusRegistrationNumber?: string | null;
  transportStatus?: 'ASSIGNED' | 'UNASSIGNED';
  parentName?: string | null;
  parentPhone?: string | null;
  parentRelationship?: string | null;
  parentEmail?: string | null;
  parentCount?: number;
  parents?: ParentGuardianRecord[];
}

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
 * -----------------------------------------------------------------------------
 * Transport Entity Schemas & Types
 * -----------------------------------------------------------------------------
 */

// 7. Route
export const RouteSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  name: z.string().min(2, 'Route name required'),
  code: z.string().min(2, 'Route code required'),
  routeType: z.nativeEnum(RouteType).default(RouteType.MORNING_PICKUP),
  defaultBusId: z.string().uuid().nullable().optional(),
  defaultDriverId: z.string().uuid().nullable().optional(),
  pathPolyline: z.string().optional(),
  estimatedDurationMinutes: z.number().int().positive().default(45),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type Route = z.infer<typeof RouteSchema>;

// 8. Pickup Location / Stop
export const PickupLocationSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  routeId: z.string().uuid(),
  stopName: z.string().min(2, 'Stop name required'),
  sequenceOrder: z.number().int().min(1, 'Sequence order must start at 1'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  scheduledTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/, 'Format HH:MM or HH:MM:SS'),
  geofenceRadiusMeters: z.number().int().min(50).max(2000).default(300),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type PickupLocation = z.infer<typeof PickupLocationSchema>;

// 9. Student Stop Assignment
export const StudentStopAssignmentSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  studentId: z.string().uuid(),
  pickupStopId: z.string().uuid(),
  dropStopId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type StudentStopAssignment = z.infer<typeof StudentStopAssignmentSchema>;

// 10. Trip
export const TripSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  routeId: z.string().uuid(),
  busId: z.string().uuid(),
  driverId: z.string().uuid(),
  status: z.nativeEnum(TripStatus).default(TripStatus.SCHEDULED),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD'),
  scheduledStartTime: z.string().datetime(),
  actualStartTime: z.string().datetime().nullable().optional(),
  actualEndTime: z.string().datetime().nullable().optional(),
  currentStopSequence: z.number().int().default(0),
  delayMinutes: z.number().int().default(0),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type Trip = z.infer<typeof TripSchema>;

// 11. GPS Telemetry Payload
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

export const GpsLocationRecordSchema = TelemetryIngestSchema.extend({
  id: z.number().optional(),
  createdAt: z.string().datetime().optional(),
});
export type GpsLocationRecord = z.infer<typeof GpsLocationRecordSchema>;

// 12. Boarding & Drop Attendance Events
export const BoardingEventSchema = z.object({
  id: z.string().uuid().optional(),
  tripId: z.string().uuid(),
  studentId: z.string().uuid(),
  stopId: z.string().uuid(),
  status: z.enum(['BOARDED', 'ABSENT', 'SKIPPED']).default('BOARDED'),
  markedBy: z.enum(['DRIVER', 'WHATSAPP', 'COORDINATOR', 'AUTO_GEOFENCE']).default('DRIVER'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  recordedAt: z.string().datetime().optional(),
});
export type BoardingEvent = z.infer<typeof BoardingEventSchema>;

export const DropEventSchema = z.object({
  id: z.string().uuid().optional(),
  tripId: z.string().uuid(),
  studentId: z.string().uuid(),
  stopId: z.string().uuid(),
  status: z.enum(['DEBOARDED', 'HANDOVER_CONFIRMED', 'RETURNED_TO_SCHOOL']).default('DEBOARDED'),
  markedBy: z.enum(['DRIVER', 'WHATSAPP', 'COORDINATOR', 'AUTO_GEOFENCE']).default('DRIVER'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  recordedAt: z.string().datetime().optional(),
});
export type DropEvent = z.infer<typeof DropEventSchema>;

/**
 * -----------------------------------------------------------------------------
 * Operations & Safety Entity Schemas & Types
 * -----------------------------------------------------------------------------
 */

// 13. Notification
export const NotificationSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  tripId: z.string().uuid().nullable().optional(),
  recipientPhone: z.string().regex(/^\+?[1-9]\d{9,14}$/),
  recipientRole: z.enum(['PARENT', 'DRIVER', 'ADMIN']).default('PARENT'),
  channel: z.enum(['WHATSAPP', 'SMS', 'PUSH', 'WEBHOOK']).default('WHATSAPP'),
  templateName: z.string().optional(),
  messageBody: z.string().min(1),
  status: z.enum(['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED']).default('SENT'),
  providerMessageId: z.string().optional(),
  failureReason: z.string().optional(),
  createdAt: z.string().datetime().optional(),
});
export type NotificationRecord = z.infer<typeof NotificationSchema>;

// 14. Delay Record
export const DelayRecordSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  tripId: z.string().uuid(),
  stopId: z.string().uuid().nullable().optional(),
  expectedArrival: z.string().datetime(),
  predictedArrival: z.string().datetime(),
  delayMinutes: z.number().int().min(1),
  reason: z.string().optional(),
  notifiedParentsCount: z.number().int().default(0),
  createdAt: z.string().datetime().optional(),
  resolvedAt: z.string().datetime().nullable().optional(),
});
export type DelayRecord = z.infer<typeof DelayRecordSchema>;

// 15. Incident
export const IncidentSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  tripId: z.string().uuid().nullable().optional(),
  busId: z.string().uuid().nullable().optional(),
  driverId: z.string().uuid().nullable().optional(),
  incidentType: z.string().min(2),
  severity: z.nativeEnum(IncidentSeverity).default(IncidentSeverity.MEDIUM),
  status: z.nativeEnum(IncidentStatus).default(IncidentStatus.OPEN),
  description: z.string().min(5),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  reportedBy: z.enum(['DRIVER', 'ADMIN', 'PARENT']).default('DRIVER'),
  acknowledgedBy: z.string().uuid().nullable().optional(),
  resolvedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type Incident = z.infer<typeof IncidentSchema>;

// 16. SOS Event
export const SosEventSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  tripId: z.string().uuid(),
  busId: z.string().uuid(),
  driverId: z.string().uuid(),
  triggerSource: z.enum(['APP_SOS_BUTTON', 'WHATSAPP_SOS', 'ADMIN_OVERRIDE']).default('APP_SOS_BUTTON'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speedKmh: z.number().min(0).default(0),
  status: z.nativeEnum(SosStatus).default(SosStatus.TRIGGERED),
  acknowledgedBy: z.string().uuid().nullable().optional(),
  acknowledgedAt: z.string().datetime().nullable().optional(),
  resolvedAt: z.string().datetime().nullable().optional(),
  resolutionNotes: z.string().optional(),
  createdAt: z.string().datetime().optional(),
});
export type SosEvent = z.infer<typeof SosEventSchema>;

// 17. Temporary Pickup Request
export const TemporaryPickupRequestSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  studentId: z.string().uuid(),
  requestedByPhone: z.string().regex(/^\+?[1-9]\d{9,14}$/),
  originalStopId: z.string().uuid(),
  requestedStopId: z.string().uuid(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tripType: z.enum(['MORNING_PICKUP', 'AFTERNOON_DROP', 'BOTH']).default('MORNING_PICKUP'),
  verifiedByCoordinator: z.boolean().default(true),
  coordinatorId: z.string().uuid().nullable().optional(),
  notes: z.string().optional(),
  createdAt: z.string().datetime().optional(),
});
export type TemporaryPickupRequest = z.infer<typeof TemporaryPickupRequestSchema>;

// 18. Absence Record
export const AbsenceRecordSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  studentId: z.string().uuid(),
  absenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tripType: z.enum(['MORNING', 'AFTERNOON', 'FULL_DAY']).default('FULL_DAY'),
  reportedVia: z.enum(['WHATSAPP', 'PARENT_WEB', 'ADMIN_PHONE']).default('WHATSAPP'),
  reportedByPhone: z.string().regex(/^\+?[1-9]\d{9,14}$/),
  reason: z.string().optional(),
  driverNotified: z.boolean().default(false),
  createdAt: z.string().datetime().optional(),
});
export type AbsenceRecord = z.infer<typeof AbsenceRecordSchema>;

// 19. Operational Report
export const OperationalReportSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  reportType: z.enum(['DAILY_PUNCTUALITY', 'ROUTE_EFFICIENCY', 'ATTENDANCE_LEDGER', 'INCIDENT_SAFETY_SUMMARY']),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  metricsJson: z.record(z.any()).default({}),
  createdAt: z.string().datetime().optional(),
});
export type OperationalReport = z.infer<typeof OperationalReportSchema>;

// 20. Audit Log
export const AuditLogSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  userId: z.string().uuid().nullable().optional(),
  userRole: z.string().default('SCHOOL_ADMIN'),
  action: z.string().min(2),
  entityType: z.string().min(2),
  entityId: z.string().uuid(),
  diffJson: z.record(z.any()).optional(),
  ipAddress: z.string().optional(),
  createdAt: z.string().datetime().optional(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

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

/**
 * -----------------------------------------------------------------------------
 * Standard API Response Envelopes & Pagination
 * -----------------------------------------------------------------------------
 */

export interface ApiFieldError {
  path: string;
  message: string;
}

export interface ApiErrorResponse {
  code: string;
  message: string;
  details?: ApiFieldError[] | Record<string, any>;
  requestId?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: ApiErrorResponse;
  requestId?: string;
  timestamp: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/**
 * -----------------------------------------------------------------------------
 * Input Sanitization & Normalization Helpers
 * -----------------------------------------------------------------------------
 */

/**
 * Normalizes Indian mobile phone numbers to E.164 international format (+91XXXXXXXXXX)
 */
export function normalizeIndianPhoneNumber(phone: string): string {
  if (!phone) return phone;
  // Strip spaces, dashes, parentheses, dots
  let cleaned = phone.replace(/[\s\-\(\)\.]/g, '');

  // Handle leading 0 (e.g. 09876543210 -> 9876543210)
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.substring(1);
  }

  // If 10 digits, prepend +91
  if (/^[6-9]\d{9}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }

  // If 12 digits starting with 91, prepend +
  if (/^91[6-9]\d{9}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  // If already in +91 format
  if (/^\+91[6-9]\d{9}$/.test(cleaned)) {
    return cleaned;
  }

  return cleaned;
}

/**
 * Basic XSS and string sanitization (trims whitespace, removes null bytes & HTML tags)
 */
export function sanitizeString(val: string): string {
  if (typeof val !== 'string') return val;
  return val
    .trim()
    .replace(/\0/g, '') // remove null bytes
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ''); // remove script tags
}

/**
 * -----------------------------------------------------------------------------
 * Authentication & Security DTOs
 * -----------------------------------------------------------------------------
 */

export const LoginRequestSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const ForgotPasswordRequestSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  token: z.string().min(10, 'Valid reset token required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const UpdateAdminProfileRequestSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters').max(255),
  phone: z.string().min(10, 'Valid 10-digit mobile phone required').optional().or(z.literal('')),
});
export type UpdateAdminProfileRequest = z.infer<typeof UpdateAdminProfileRequestSchema>;

export interface AuthUserPayload {
  id: string;
  schoolId: string | null;
  email: string;
  fullName: string;
  role: UserRole;
  phone?: string;
}

export interface LoginResponseData {
  token: string;
  user: AuthUserPayload;
  expiresIn: string;
}

export const DriverLoginRequestSchema = z.object({
  phone: z.string().min(10, 'Valid phone number required'),
  pin: z.string().min(4).max(6).optional(), // 4-6 digit PIN
  licenseNumber: z.string().optional(),
});
export type DriverLoginRequest = z.infer<typeof DriverLoginRequestSchema>;

export interface DriverAuthPayload {
  id: string;
  schoolId: string;
  phone: string;
  fullName: string;
  role: UserRole.DRIVER;
  assignedBusId?: string | null;
}

export interface DriverAssignedBusInfo {
  id: string;
  registrationNumber: string;
  busNumber: string;
  makeModel?: string;
}

export interface DriverProfileResponseData {
  driver: DriverAuthPayload;
  assignedBus?: DriverAssignedBusInfo | null;
  activeTrip?: Trip | null;
  todayTrips: Trip[];
}

export interface DriverAuthResponseData {
  token: string;
  driver: DriverAuthPayload;
  assignedBus?: DriverAssignedBusInfo | null;
  expiresIn: string;
}

/**
 * -----------------------------------------------------------------------------
 * Parent Identity & Secure Tracking Link Schemas & DTOs
 * -----------------------------------------------------------------------------
 */

export interface ParentIdentityStudentInfo {
  id: string;
  schoolId: string;
  fullName: string;
  admissionNumber: string;
  classGrade: string;
  section: string;
  rollNumber?: string | null;
  emergencyContactPhone?: string | null;
}

export interface ParentIdentityRecord {
  id: string;
  schoolId: string;
  studentId: string;
  fullName: string;
  relationship: string;
  phone: string;
  email?: string | null;
  student: ParentIdentityStudentInfo;
  school: {
    id: string;
    name: string;
    code: string;
    city: string;
    timezone: string;
  };
  pickupStop?: {
    id: string;
    stopName: string;
    sequenceOrder: number;
    scheduledTime: string;
    latitude: number;
    longitude: number;
    geofenceRadiusMeters: number;
  } | null;
}

export const ParentIdentityLookupRequestSchema = z.object({
  phone: z.string().min(10, 'Valid WhatsApp phone number is required'),
  schoolId: z.string().uuid().optional(),
});
export type ParentIdentityLookupRequest = z.infer<typeof ParentIdentityLookupRequestSchema>;

export const GenerateParentTokenRequestSchema = z.object({
  parentId: z.string().uuid('Valid parent ID required'),
  studentId: z.string().uuid('Valid student ID required'),
  schoolId: z.string().uuid('Valid school ID required'),
  tripId: z.string().uuid().optional().nullable(),
  ttlHours: z.number().int().min(1).max(168).default(12),
  purpose: z.enum(['LIVE_TRACKING', 'PICKUP_NOTIFICATION', 'MANUAL_REQUEST']).default('LIVE_TRACKING'),
});
export type GenerateParentTokenRequest = z.infer<typeof GenerateParentTokenRequestSchema>;

export const RevokeParentTokenRequestSchema = z
  .object({
    token: z.string().optional(),
    tokenId: z.string().uuid().optional(),
    reason: z.string().optional(),
  })
  .refine((data) => Boolean(data.token || data.tokenId), {
    message: 'Either token or tokenId must be provided for revocation',
  });
export type RevokeParentTokenRequest = z.infer<typeof RevokeParentTokenRequestSchema>;

export const RevokeStudentTokensRequestSchema = z.object({
  studentId: z.string().uuid('Valid student ID required'),
  schoolId: z.string().uuid('Valid school ID required'),
  reason: z.string().optional(),
});
export type RevokeStudentTokensRequest = z.infer<typeof RevokeStudentTokensRequestSchema>;

export interface ParentTrackingTokenData {
  id: string;
  token: string;
  trackingUrl: string;
  expiresAt: string;
  purpose: string;
  parentId: string;
  studentId: string;
  schoolId: string;
  tripId?: string | null;
}

export interface ParentLiveTrackingSession {
  isValid: boolean;
  expiresAt: string;
  parent: {
    id: string;
    fullName: string;
    relationship: string;
    phone: string;
  };
  student: ParentIdentityStudentInfo;
  school: {
    id: string;
    name: string;
    code: string;
    timezone: string;
  };
  pickupStop?: {
    id: string;
    stopName: string;
    sequenceOrder: number;
    scheduledTime: string;
    latitude: number;
    longitude: number;
    geofenceRadiusMeters: number;
  } | null;
  activeTrip?: {
    id: string;
    routeId: string;
    routeName: string;
    routeType: RouteType;
    status: TripStatus;
    busNumber: string;
    registrationNumber: string;
    driverName: string;
    driverPhone?: string;
    delayMinutes: number;
    currentStopSequence: number;
    lastGpsLocation?: {
      latitude: number;
      longitude: number;
      speedKmh: number;
      bearingDegrees?: number;
      recordedAt: string;
    } | null;
  } | null;
}

/**
 * -----------------------------------------------------------------------------
 * Role-Based Access Control & Multi-Tenant Isolation Definitions
 * -----------------------------------------------------------------------------
 */

export enum PermissionAction {
  CREATE = 'CREATE',
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  EXECUTE = 'EXECUTE',
  DISPATCH = 'DISPATCH',
  RESOLVE = 'RESOLVE',
}

export enum ResourceDomain {
  SCHOOL = 'SCHOOL',
  FLEET_BUS = 'FLEET_BUS',
  DRIVER = 'DRIVER',
  STUDENT = 'STUDENT',
  PARENT = 'PARENT',
  ROUTE = 'ROUTE',
  TRIP = 'TRIP',
  TELEMETRY = 'TELEMETRY',
  ATTENDANCE = 'ATTENDANCE',
  INCIDENT = 'INCIDENT',
  SOS = 'SOS',
  REPORT = 'REPORT',
  AUDIT_LOG = 'AUDIT_LOG',
}

export interface TenantContext {
  schoolId: string;
  isSuperAdmin: boolean;
  userId: string;
  role: UserRole;
}

/**
 * Checks whether a given user role possesses permission to execute an action on a domain
 */
export function hasRolePermission(
  role: UserRole,
  domain: ResourceDomain,
  action: PermissionAction
): boolean {
  if (role === UserRole.SUPER_ADMIN) {
    return true; // Super admin has global unrestricted permissions
  }

  if (role === UserRole.SCHOOL_ADMIN) {
    // School Admin has full access within their school tenant
    return true;
  }

  if (role === UserRole.TRANSPORT_COORDINATOR) {
    // Coordinator cannot delete school or audit logs
    if (
      domain === ResourceDomain.SCHOOL &&
      (action === PermissionAction.DELETE || action === PermissionAction.CREATE)
    ) {
      return false;
    }
    if (domain === ResourceDomain.AUDIT_LOG && action === PermissionAction.DELETE) {
      return false;
    }
    return true;
  }

  if (role === UserRole.DRIVER) {
    if (
      domain === ResourceDomain.TELEMETRY &&
      (action === PermissionAction.CREATE || action === PermissionAction.READ)
    ) return true;
    if (
      domain === ResourceDomain.ATTENDANCE &&
      (action === PermissionAction.CREATE || action === PermissionAction.UPDATE || action === PermissionAction.READ)
    ) return true;
    if (
      domain === ResourceDomain.TRIP &&
      (action === PermissionAction.READ || action === PermissionAction.EXECUTE || action === PermissionAction.UPDATE)
    ) return true;
    if (domain === ResourceDomain.ROUTE && action === PermissionAction.READ) return true;
    if (domain === ResourceDomain.FLEET_BUS && action === PermissionAction.READ) return true;
    if (domain === ResourceDomain.STUDENT && action === PermissionAction.READ) return true;
    if (domain === ResourceDomain.SOS && action === PermissionAction.CREATE) return true;
    if (
      domain === ResourceDomain.INCIDENT &&
      (action === PermissionAction.CREATE || action === PermissionAction.READ)
    ) return true;
    return false;
  }

  if (role === UserRole.PARENT) {
    if (domain === ResourceDomain.TELEMETRY && action === PermissionAction.READ) return true;
    if (domain === ResourceDomain.TRIP && action === PermissionAction.READ) return true;
    if (domain === ResourceDomain.STUDENT && action === PermissionAction.READ) return true;
    return false;
  }

  return false;
}





