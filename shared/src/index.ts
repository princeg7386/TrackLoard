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
  ARRIVED_SCHOOL = 'ARRIVED_SCHOOL',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  EMERGENCY = 'EMERGENCY',
}

/**
 * Trip Operational Lifecycle Stages (Micro-phase 16.1)
 */
export enum TripLifecycleStage {
  NOT_STARTED = 'NOT_STARTED',
  STARTED = 'STARTED',
  IN_TRANSIT = 'IN_TRANSIT',
  ARRIVED_SCHOOL = 'ARRIVED_SCHOOL',
  COMPLETED = 'COMPLETED',
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
  name: z.string().min(2, 'School name must be at least 2 characters').max(255).optional(),
  address: z.string().min(5, 'Full street address is required').max(500).optional().or(z.literal('')),
  city: z.string().min(2, 'City is required').max(100).optional(),
  state: z.string().min(2, 'State is required').max(100).optional(),
  postalCode: z.string().regex(/^\d{6}$/, 'Valid 6-digit Indian PIN code required').optional().nullable().or(z.literal('')),
  phone: z.string().min(10, 'Valid contact phone required').optional().or(z.literal('')),
  email: z.string().email('Please enter a valid official email address').optional(),
  logoUrl: z.string().url('Please provide a valid logo image URL').optional().nullable().or(z.literal('')),
  affiliationNumber: z.string().max(100).optional().nullable().or(z.literal('')),
  website: z.string().url('Please provide a valid website URL').optional().nullable().or(z.literal('')),
  timezone: z.string().default('Asia/Kolkata').optional(),
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
  return reg.trim().toUpperCase().replace(/[\s-]+/g, '');
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

export interface StudentTransportHistoryItem {
  id: string;
  tripId: string;
  eventType: 'BOARDED' | 'ABSENT' | 'DEBOARDED';
  status: string;
  markedBy: string;
  recordedAt: string;
  stopName: string;
  stopSequence?: number | null;
  busNumber?: string | null;
  busRegistrationNumber?: string | null;
  routeName?: string | null;
  routeCode?: string | null;
  scheduledDate?: string | null;
}

export interface StudentTransportHistoryResponse {
  studentId: string;
  summary: {
    totalBoarded: number;
    totalAbsent: number;
    totalDeboarded: number;
    lastRodeAt?: string | null;
  };
  history: StudentTransportHistoryItem[];
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

export interface ParentRecordWithStudent {
  id: string;
  schoolId: string;
  studentId: string;
  fullName: string;
  relationship: 'MOTHER' | 'FATHER' | 'GUARDIAN' | 'PARENT' | string;
  phone: string;
  email?: string | null;
  createdAt?: string;
  updatedAt?: string;
  whatsAppStatus: 'ACTIVE_TOKEN' | 'LINKED' | 'NOT_LINKED';
  activeTokenCount: number;
  lastTokenCreatedAt?: string | null;
  lastTokenExpiresAt?: string | null;
  notificationsEnabled?: boolean;
  optedOutAt?: string | null;
  optOutReason?: string | null;
  student: {
    id: string;
    fullName: string;
    admissionNumber: string;
    classGrade: string;
    section: string;
    rollNumber?: string | null;
    emergencyContactPhone?: string | null;
    pickupStopName?: string | null;
    pickupScheduledTime?: string | null;
    assignedBusNumber?: string | null;
    assignedRouteCode?: string | null;
  };
}

export interface ParentAssignmentDetails {
  parent: {
    id: string;
    schoolId: string;
    studentId: string;
    fullName: string;
    relationship: 'MOTHER' | 'FATHER' | 'GUARDIAN' | 'PARENT' | string;
    phone: string;
    email?: string | null;
    createdAt?: string;
    updatedAt?: string;
    whatsAppStatus: 'ACTIVE_TOKEN' | 'LINKED' | 'NOT_LINKED';
  };
  student: {
    id: string;
    fullName: string;
    admissionNumber: string;
    classGrade: string;
    section: string;
    rollNumber?: string | null;
    emergencyContactPhone?: string | null;
  };
  transport: {
    busId?: string | null;
    busNumber?: string | null;
    registrationNumber?: string | null;
    routeId?: string | null;
    routeName?: string | null;
    routeCode?: string | null;
    pickupStopId?: string | null;
    pickupStopName?: string | null;
    pickupScheduledTime?: string | null;
    pickupLatitude?: number | null;
    pickupLongitude?: number | null;
    dropStopId?: string | null;
    dropStopName?: string | null;
    dropScheduledTime?: string | null;
  };
  activeTrackingToken?: {
    id: string;
    tokenPrefix: string;
    expiresAt: string;
    accessCount: number;
    lastAccessedAt?: string | null;
    isRevoked: boolean;
  } | null;
}

export interface ParentCommunicationItem {
  id: string;
  type: 'NOTIFICATION' | 'TOKEN_EVENT';
  channel: 'WHATSAPP' | 'SMS' | 'SYSTEM';
  title: string;
  templateName?: string | null;
  messageBody: string;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'REVOKED' | 'ACTIVE';
  recipientPhone: string;
  createdAt: string;
  failureReason?: string | null;
}

export const RelinkParentStudentRequestSchema = z.object({
  studentId: z.string().uuid('Valid student ID required'),
});
export type RelinkParentStudentRequest = z.infer<typeof RelinkParentStudentRequestSchema>;

export const SendParentNoticeRequestSchema = z.object({
  templateName: z.string().min(1).default('MANUAL_NOTICE'),
  messageBody: z.string().min(1, 'Message body is required'),
  channel: z.enum(['WHATSAPP', 'SMS']).default('WHATSAPP'),
});
export type SendParentNoticeRequest = z.infer<typeof SendParentNoticeRequestSchema>;

export interface ParentOnboardInviteResponse {
  token: string;
  tokenPrefix: string;
  expiresAt: string;
  inviteUrl: string;
  messageBody: string;
  notificationId: string;
  parent: {
    id: string;
    fullName: string;
    phone: string;
  };
  student: {
    id: string;
    fullName: string;
    admissionNumber: string;
  };
}

export interface ParentOnboardVerificationResponse {
  status: 'VALID' | 'EXPIRED' | 'REVOKED' | 'INVALID';
  errorCode?: 'TOKEN_EXPIRED' | 'TOKEN_REVOKED' | 'TOKEN_INVALID' | 'STUDENT_UNASSIGNED';
  errorMessage?: string;
  session?: ParentLiveTrackingSession | null;
  phoneLast4?: string;
  supportPhone?: string;
}

export const ParentOnboardConfirmRequestSchema = z.object({
  token: z.string().min(1, 'Tracking token is required'),
  phoneLast4: z.string().length(4, 'Last 4 digits of phone number required').optional(),
});
export type ParentOnboardConfirmRequest = z.infer<typeof ParentOnboardConfirmRequestSchema>;

export interface ParentOnboardConfirmResponse {
  confirmed: boolean;
  activatedAt: string;
  session: ParentLiveTrackingSession;
}

export interface TokenAccessLogItem {
  id: string;
  tokenId: string;
  accessedAt: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface ParentNotificationHistoryItem {
  id: string;
  channel: string;
  templateName?: string | null;
  messageBody: string;
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  deliveredAt?: string | null;
  readAt?: string | null;
  failureReason?: string | null;
  createdAt: string;
}

export interface ParentDeliverySummary {
  totalDispatches: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  deliverySuccessRatePercent: number;
}

export interface ParentNotificationStatusResponse {
  parent: {
    id: string;
    fullName: string;
    phone: string;
    relationship: string;
    notificationsEnabled: boolean;
    optedOutAt?: string | null;
    optOutReason?: string | null;
  };
  student: {
    id: string;
    fullName: string;
    admissionNumber: string;
    classGrade: string;
    section: string;
  };
  deliverySummary: ParentDeliverySummary;
  linkActivity: {
    totalTokensIssued: number;
    activeTokenCount: number;
    totalAccessCount: number;
    lastAccessedAt?: string | null;
    recentAccesses: TokenAccessLogItem[];
  };
  recentNotifications: ParentNotificationHistoryItem[];
}

export const UpdateParentNotificationPreferencesSchema = z.object({
  notificationsEnabled: z.boolean(),
  optOutReason: z.string().max(255).optional().nullable(),
});
export type UpdateParentNotificationPreferences = z.infer<typeof UpdateParentNotificationPreferencesSchema>;

export const UpdateNotificationStatusRequestSchema = z.object({
  status: z.enum(['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED']),
  failureReason: z.string().max(255).optional().nullable(),
});
export type UpdateNotificationStatusRequest = z.infer<typeof UpdateNotificationStatusRequestSchema>;




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

// Micro-phase 15.1: Route Management (Create route, Assign bus, Assign driver)
export const CreateRouteRequestSchema = z.object({
  name: z.string().trim().min(2, 'Route name must be at least 2 characters').max(255),
  code: z.string().trim().min(2, 'Route code must be at least 2 characters').max(50),
  routeType: z.nativeEnum(RouteType).optional().default(RouteType.MORNING_PICKUP),
  defaultBusId: z.string().uuid('Valid bus UUID required').nullable().optional(),
  defaultDriverId: z.string().uuid('Valid driver UUID required').nullable().optional(),
  estimatedDurationMinutes: z.number().int().min(5).max(300).optional().default(45),
});
export type CreateRouteRequest = z.infer<typeof CreateRouteRequestSchema>;

export const RouteDetailSchema = z.object({
  id: z.string().uuid(),
  schoolId: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  routeType: z.nativeEnum(RouteType),
  defaultBusId: z.string().uuid().nullable().optional(),
  defaultDriverId: z.string().uuid().nullable().optional(),
  busNumber: z.string().nullable().optional(),
  busRegistrationNumber: z.string().nullable().optional(),
  driverName: z.string().nullable().optional(),
  driverPhone: z.string().nullable().optional(),
  pathPolyline: z.string().nullable().optional(),
  estimatedDurationMinutes: z.number().int(),
  stopsCount: z.number().int().optional().default(0),
  studentsCount: z.number().int().optional().default(0),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type RouteDetail = z.infer<typeof RouteDetailSchema>;

export const UpdateRouteRequestSchema = z.object({
  name: z.string().trim().min(2, 'Route name must be at least 2 characters').max(255).optional(),
  code: z.string().trim().min(2, 'Route code must be at least 2 characters').max(50).optional(),
  routeType: z.nativeEnum(RouteType).optional(),
  defaultBusId: z.string().uuid('Valid bus UUID required').nullable().optional(),
  defaultDriverId: z.string().uuid('Valid driver UUID required').nullable().optional(),
  estimatedDurationMinutes: z.number().int().min(5).max(300).optional(),
});
export type UpdateRouteRequest = z.infer<typeof UpdateRouteRequestSchema>;

// Route History Schemas (Micro-phase 15.4)
export const RouteHistoryItemSchema = z.object({
  id: z.string().uuid(),
  routeId: z.string().uuid(),
  schoolId: z.string().uuid(),
  action: z.string(),
  userId: z.string().uuid().nullable().optional(),
  userName: z.string().optional(),
  userRole: z.string().default('SCHOOL_ADMIN'),
  changeSummary: z.string(),
  previousState: z.record(z.any()).nullable().optional(),
  newState: z.record(z.any()).nullable().optional(),
  createdAt: z.string(),
});
export type RouteHistoryItem = z.infer<typeof RouteHistoryItemSchema>;

export const RouteHistoryResponseSchema = z.object({
  route: RouteDetailSchema,
  history: z.array(RouteHistoryItemSchema),
  totalChanges: z.number().int(),
});
export type RouteHistoryResponse = z.infer<typeof RouteHistoryResponseSchema>;

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

// 8a. Route Stop Detail & Management (Micro-phase 15.2, 21.1)
export const GeofenceTypeSchema = z.enum(['RADIUS', 'POLYGON']);
export type GeofenceType = z.infer<typeof GeofenceTypeSchema>;

export const PolygonCoordinateSchema = z.object({
  latitude: z.number().min(-90, 'Latitude must be between -90 and 90').max(90, 'Latitude must be between -90 and 90'),
  longitude: z.number().min(-180, 'Longitude must be between -180 and 180').max(180, 'Longitude must be between -180 and 180'),
});
export type PolygonCoordinate = z.infer<typeof PolygonCoordinateSchema>;

export const RouteStopDetailSchema = z.object({
  id: z.string().uuid(),
  schoolId: z.string().uuid(),
  routeId: z.string().uuid(),
  stopName: z.string().min(2),
  sequenceOrder: z.number().int().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  scheduledTime: z.string(),
  geofenceRadiusMeters: z.number().int(),
  geofenceType: GeofenceTypeSchema.default('RADIUS'),
  geofencePolygon: z.array(PolygonCoordinateSchema).nullable().optional(),
  assignedStudentsCount: z.number().int().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RouteStopDetail = z.infer<typeof RouteStopDetailSchema>;

export const AddRouteStopRequestSchema = z.object({
  stopName: z.string().min(2, 'Stop name must be at least 2 characters').max(255),
  latitude: z.number().min(-90, 'Latitude must be between -90 and 90').max(90, 'Latitude must be between -90 and 90'),
  longitude: z.number().min(-180, 'Longitude must be between -180 and 180').max(180, 'Longitude must be between -180 and 180'),
  scheduledTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/, 'Scheduled time must be HH:MM or HH:MM:SS format'),
  geofenceRadiusMeters: z.number().int().min(50).max(2000).optional().default(300),
  geofenceType: GeofenceTypeSchema.optional().default('RADIUS'),
  geofencePolygon: z.array(PolygonCoordinateSchema).min(3, 'Polygon geofence must have at least 3 vertices').optional().nullable(),
  sequenceOrder: z.number().int().min(1, 'Sequence order must be at least 1').optional(),
});
export type AddRouteStopRequest = z.infer<typeof AddRouteStopRequestSchema>;

export const ReorderRouteStopsRequestSchema = z.object({
  stopIds: z.array(z.string().uuid('Invalid stop ID format')).min(1, 'At least one stop ID is required to reorder'),
});
export type ReorderRouteStopsRequest = z.infer<typeof ReorderRouteStopsRequestSchema>;

export const UpdateRouteStopRequestSchema = z.object({
  stopName: z.string().min(2, 'Stop name must be at least 2 characters').max(255).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  scheduledTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/, 'Scheduled time must be HH:MM or HH:MM:SS format').optional(),
  geofenceRadiusMeters: z.number().int().min(50).max(2000).optional(),
  geofenceType: GeofenceTypeSchema.optional(),
  geofencePolygon: z.array(PolygonCoordinateSchema).min(3, 'Polygon geofence must have at least 3 vertices').optional().nullable(),
  sequenceOrder: z.number().int().min(1).optional(),
});
export type UpdateRouteStopRequest = z.infer<typeof UpdateRouteStopRequestSchema>;

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

// Trip Engine (Micro-phase 16.1 & 16.2)
export const CreateTripRequestSchema = z.object({
  routeId: z.string().uuid('Valid route ID required'),
  busId: z.string().uuid('Valid bus ID required').optional(),
  driverId: z.string().uuid('Valid driver ID required').optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD').optional(),
  scheduledStartTime: z.string().min(1, 'Scheduled start time required').optional(),
});
export type CreateTripRequest = z.infer<typeof CreateTripRequestSchema>;

export const CreateTodayTripRequestSchema = z.object({
  routeId: z.string().uuid('Valid route ID required'),
  busId: z.string().uuid('Valid bus ID required').optional(),
  driverId: z.string().uuid('Valid driver ID required').optional(),
  scheduledStartTime: z.string().min(1, 'Scheduled start time required').optional(),
});
export type CreateTodayTripRequest = z.infer<typeof CreateTodayTripRequestSchema>;

export const GenerateDailyTripsRequestSchema = z.object({
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format YYYY-MM-DD').optional(),
  shift: z.enum(['MORNING', 'AFTERNOON', 'CUSTOM']).optional(),
});
export type GenerateDailyTripsRequest = z.infer<typeof GenerateDailyTripsRequestSchema>;

export const GenerateDailyTripsResponseSchema = z.object({
  scheduledCount: z.number().int(),
  skippedCount: z.number().int(),
  createdTrips: z.array(z.lazy(() => TripDetailResponseSchema)),
});
export type GenerateDailyTripsResponse = z.infer<typeof GenerateDailyTripsResponseSchema>;

export const StartTripRequestSchema = z.object({
  startedAt: z.string().datetime().optional(),
  idempotencyKey: z.string().optional(),
  clientRequestId: z.string().optional(),
});
export type StartTripRequest = z.infer<typeof StartTripRequestSchema>;

export const EndTripRequestSchema = z.object({
  endedAt: z.string().datetime().optional(),
  summaryNotes: z.string().max(500).optional(),
  idempotencyKey: z.string().optional(),
  clientRequestId: z.string().optional(),
});
export type EndTripRequest = z.infer<typeof EndTripRequestSchema>;

export const TripSummaryAttendanceSchema = z.object({
  totalExpected: z.number().int().min(0),
  totalBoarded: z.number().int().min(0),
  totalDeboarded: z.number().int().min(0),
  totalAbsent: z.number().int().min(0),
});
export type TripSummaryAttendance = z.infer<typeof TripSummaryAttendanceSchema>;

export const TripSummaryResponseSchema = z.object({
  tripId: z.string().uuid(),
  schoolId: z.string().uuid(),
  routeId: z.string().uuid(),
  routeName: z.string().optional(),
  routeCode: z.string().optional(),
  busId: z.string().uuid(),
  busNumber: z.string().optional(),
  busRegistrationNumber: z.string().optional(),
  driverId: z.string().uuid(),
  driverName: z.string().optional(),
  driverPhone: z.string().optional(),
  status: z.nativeEnum(TripStatus),
  lifecycleStage: z.nativeEnum(TripLifecycleStage),
  scheduledDate: z.string(),
  scheduledStartTime: z.string(),
  actualStartTime: z.string().nullable().optional(),
  actualEndTime: z.string().nullable().optional(),
  durationMinutes: z.number().min(0),
  totalStops: z.number().int(),
  stopsCompleted: z.number().int(),
  delayMinutes: z.number().int(),
  attendanceLocked: z.boolean(),
  attendance: TripSummaryAttendanceSchema,
  summaryNotes: z.string().nullable().optional(),
  completedAt: z.string().optional(),
});
export type TripSummaryResponse = z.infer<typeof TripSummaryResponseSchema>;

export const UpdateTripProgressRequestSchema = z.object({
  currentStopSequence: z.number().int().min(0),
  delayMinutes: z.number().int().min(0).optional(),
});
export type UpdateTripProgressRequest = z.infer<typeof UpdateTripProgressRequestSchema>;

export const CancelTripRequestSchema = z.object({
  reason: z.string().min(2, 'Cancellation reason required').max(255),
});
export type CancelTripRequest = z.infer<typeof CancelTripRequestSchema>;

export const TripDetailResponseSchema = z.object({
  id: z.string().uuid(),
  schoolId: z.string().uuid(),
  routeId: z.string().uuid(),
  routeName: z.string().optional(),
  routeCode: z.string().optional(),
  busId: z.string().uuid(),
  busNumber: z.string().optional(),
  busRegistrationNumber: z.string().optional(),
  driverId: z.string().uuid(),
  driverName: z.string().optional(),
  driverPhone: z.string().optional(),
  status: z.nativeEnum(TripStatus),
  lifecycleStage: z.nativeEnum(TripLifecycleStage),
  scheduledDate: z.string(),
  scheduledStartTime: z.string(),
  actualStartTime: z.string().nullable().optional(),
  actualEndTime: z.string().nullable().optional(),
  arrivedSchoolTime: z.string().nullable().optional(),
  currentStopSequence: z.number().int(),
  delayMinutes: z.number().int(),
  totalStops: z.number().int().optional(),
  trackingSessionActive: z.boolean().optional(),
  activatedTrackingTokens: z.number().int().optional(),
  attendanceLocked: z.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type TripDetailResponse = z.infer<typeof TripDetailResponseSchema>;

// 11. GPS Telemetry Payload
export const TelemetryIngestSchema = z.object({
  tripId: z.string().uuid(),
  busId: z.string().uuid(),
  driverId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speedKmh: z.number().min(0).max(160).default(0),
  bearingDegrees: z.number().min(0).max(360).optional(),
  accuracyMeters: z.number().min(0).optional(),
  batteryPercentage: z.number().min(0).max(100).optional(),
  isCharging: z.boolean().optional(),
  networkType: z.enum(['CELLULAR', 'WIFI', 'OFFLINE', 'UNKNOWN']).optional(),
  recordedAt: z.string().datetime(),
});
export type TelemetryIngestPayload = z.infer<typeof TelemetryIngestSchema>;
export const TelemetryBatchItemSchema = TelemetryIngestSchema.extend({
  speedKmh: z.number().min(0).max(250).default(0),
});
export type TelemetryBatchItemPayload = z.infer<typeof TelemetryBatchItemSchema>;

export const TelemetryBatchIngestSchema = z.object({
  locations: z.array(TelemetryBatchItemSchema).min(1).max(500),
});
export type TelemetryBatchIngestPayload = z.infer<typeof TelemetryBatchIngestSchema>;

export const GpsLocationRecordSchema = TelemetryIngestSchema.extend({
  id: z.number().optional(),
  createdAt: z.string().datetime().optional(),
});
export type GpsLocationRecord = z.infer<typeof GpsLocationRecordSchema>;

// GPS Health Threshold Constants & Status
export const GPS_THRESHOLDS = {
  ACCURACY_OPTIMAL_METERS: 15,
  ACCURACY_MAX_ACCEPTABLE_METERS: 30,
  STALE_SIGNAL_SECONDS: 60,
  SIGNAL_LOST_SECONDS: 300,
} as const;

export const GpsHealthStatusSchema = z.enum([
  'HEALTHY',
  'DEGRADED_ACCURACY',
  'STALE_SIGNAL',
  'SIGNAL_LOST',
  'OFFLINE',
]);
export type GpsHealthStatus = z.infer<typeof GpsHealthStatusSchema>;

export const BusGpsHealthSummarySchema = z.object({
  busId: z.string().uuid(),
  busNumber: z.string(),
  registrationNumber: z.string(),
  healthStatus: GpsHealthStatusSchema,
  lastLatitude: z.number().nullable().optional(),
  lastLongitude: z.number().nullable().optional(),
  lastSpeedKmh: z.number().nullable().optional(),
  lastAccuracyMeters: z.number().nullable().optional(),
  lastBatteryPercentage: z.number().nullable().optional(),
  lastIsCharging: z.boolean().nullable().optional(),
  lastNetworkType: z.string().nullable().optional(),
  lastRecordedAt: z.string().nullable().optional(),
  ageSeconds: z.number().optional(),
  activeTripId: z.string().uuid().nullable().optional(),
});
export type BusGpsHealthSummary = z.infer<typeof BusGpsHealthSummarySchema>;

export const FleetGpsHealthOverviewSchema = z.object({
  schoolId: z.string().uuid(),
  totalBuses: z.number(),
  healthyCount: z.number(),
  degradedCount: z.number(),
  staleCount: z.number(),
  lostCount: z.number(),
  offlineCount: z.number(),
  buses: z.array(BusGpsHealthSummarySchema),
});
export type FleetGpsHealthOverview = z.infer<typeof FleetGpsHealthOverviewSchema>;

// Real-Time Telemetry Feed Event Definition (SSE / Pub-Sub)
export type TelemetryFeedEventType =
  | 'INITIAL_STATE'
  | 'LOCATION_UPDATE'
  | 'HEALTH_UPDATE'
  | 'HEARTBEAT'
  /** Phase 20.3: Emitted after every GPS ping with a freshly computed RouteEtaSummary */
  | 'ETA_UPDATE'
  /** Phase 21.1: Emitted when a bus enters or exits a pickup stop geofence */
  | 'GEOFENCE_EVENT';

export interface TelemetryFeedEvent {
  type: TelemetryFeedEventType;
  schoolId: string;
  busId: string;
  tripId: string;
  latitude?: number;
  longitude?: number;
  speedKmh?: number;
  bearingDegrees?: number | null;
  accuracyMeters?: number | null;
  batteryPercentage?: number | null;
  isCharging?: boolean | null;
  networkType?: string | null;
  healthStatus?: GpsHealthStatus;
  recordedAt?: string;
  timestamp: string;
  // Phase 20.2: Optional ETA fields — populated on LOCATION_UPDATE when available
  nextStopEtaSeconds?: number | null;
  nextStopName?: string | null;
  estimatedNextArrivalAt?: string | null;
  // Phase 20.3: Full smoothed ETA summary — populated on ETA_UPDATE events
  etaSummary?: RouteEtaSummary | null;
  /** True when the bus is detected as stationary (speed ≤ 2 km/h) */
  isStoppedBus?: boolean | null;
  // Phase 21.1: Geofence event details
  eventType?: 'ENTRY' | 'EXIT' | 'DWELL';
  stopId?: string;
  stopName?: string;
  sequenceOrder?: number;
  status?: 'INSIDE' | 'OUTSIDE';
  distanceMeters?: number;
  dwellTimeSeconds?: number;
}

export const TelemetryFeedQuerySchema = z.object({
  token: z.string().optional(),
});
export type TelemetryFeedQuery = z.infer<typeof TelemetryFeedQuerySchema>;

/**
 * Phase 12.1 — Current Bus State
 * Full snapshot joining bus + driver + route + active trip + live GPS cache.
 * Returned by GET /api/v1/telemetry/buses/:busId/state
 */
export interface ActiveTripStateResponse {
  busId: string;
  busNumber: string;
  registrationNumber: string;
  makeModel: string | null;

  driverId: string | null;
  driverName: string | null;
  driverPhone: string | null;

  tripId: string | null;
  tripStatus: string | null; // TripStatus vocab: SCHEDULED | IN_TRANSIT | DELAYED | COMPLETED | CANCELLED | EMERGENCY
  routeId: string | null;
  routeName: string | null;
  routeCode: string | null;
  routeType: string | null;
  scheduledStartTime: string | null;
  actualStartTime: string | null;
  currentStopSequence: number | null;
  delayMinutes: number | null;

  // Live GPS (from buses.last_* cache — O(1), always fresh)
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastSpeedKmh: number | null;
  lastBearingDegrees: number | null;
  lastAccuracyMeters: number | null;
  lastBatteryPercentage: number | null;
  lastIsCharging: boolean | null;
  lastNetworkType: string | null;
  lastGpsRecordedAt: string | null;
  gpsHealthStatus: GpsHealthStatus;
  gpsAgeSeconds: number | null;
}


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
  tokenVersion?: number;
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
  parentEta?: ParentPickupEta | null;
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

/**
 * -----------------------------------------------------------------------------
 * Phase 13.1 — Map & Routing Layer Abstractions & Schemas
 * -----------------------------------------------------------------------------
 */

export const GeocodeQuerySchema = z.object({
  query: z.string().min(2).max(500),
  limit: z.number().int().min(1).max(20).optional().default(5),
  countryCode: z.string().optional().default('in'),
});
export type GeocodeQuery = z.infer<typeof GeocodeQuerySchema>;

export const GeocodeResultSchema = z.object({
  formattedAddress: z.string(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  placeId: z.string().optional(),
  displayName: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  boundingBox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});
export type GeocodeResult = z.infer<typeof GeocodeResultSchema>;

export const ReverseGeocodeQuerySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type ReverseGeocodeQuery = z.infer<typeof ReverseGeocodeQuerySchema>;

export const ReverseGeocodeResultSchema = z.object({
  formattedAddress: z.string(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  displayName: z.string().optional(),
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
});
export type ReverseGeocodeResult = z.infer<typeof ReverseGeocodeResultSchema>;

export const RouteWaypointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().optional(),
  stopId: z.string().optional(),
});
export type RouteWaypoint = z.infer<typeof RouteWaypointSchema>;

export const RouteOptionsSchema = z.object({
  mode: z.enum(['driving', 'bus']).optional().default('bus'),
  avoidTolls: z.boolean().optional().default(false),
  overview: z.enum(['full', 'simplified', 'none']).optional().default('full'),
});
export type RouteOptions = z.input<typeof RouteOptionsSchema>;
export type RouteOptionsOutput = z.output<typeof RouteOptionsSchema>;


export const CalculateRouteRequestSchema = z.object({
  waypoints: z.array(RouteWaypointSchema).min(2),
  options: RouteOptionsSchema.optional(),
});
export type CalculateRouteRequest = z.infer<typeof CalculateRouteRequestSchema>;

export const RouteStepSchema = z.object({
  instruction: z.string(),
  distanceMeters: z.number(),
  durationSeconds: z.number(),
  startLocation: GeoCoordinatesSchema,
  endLocation: GeoCoordinatesSchema,
});
export type RouteStep = z.infer<typeof RouteStepSchema>;

export const RouteLegSchema = z.object({
  distanceMeters: z.number(),
  durationSeconds: z.number(),
  startLocation: GeoCoordinatesSchema,
  endLocation: GeoCoordinatesSchema,
  startAddress: z.string().optional(),
  endAddress: z.string().optional(),
  steps: z.array(RouteStepSchema).optional(),
});
export type RouteLeg = z.infer<typeof RouteLegSchema>;

export const RouteCalculationResultSchema = z.object({
  distanceMeters: z.number(),
  durationSeconds: z.number(),
  geometryPolyline: z.string(),
  coordinates: z.array(z.tuple([z.number(), z.number()])),
  legs: z.array(RouteLegSchema),
  provider: z.string(),
});
export type RouteCalculationResult = z.infer<typeof RouteCalculationResultSchema>;

export const DistanceMatrixQuerySchema = z.object({
  origins: z.array(GeoCoordinatesSchema).min(1),
  destinations: z.array(GeoCoordinatesSchema).min(1),
});
export type DistanceMatrixQuery = z.infer<typeof DistanceMatrixQuerySchema>;

export const DistanceMatrixElementSchema = z.object({
  distanceMeters: z.number(),
  durationSeconds: z.number(),
  status: z.enum(['OK', 'ZERO_RESULTS', 'NOT_FOUND', 'FAIL']),
});
export type DistanceMatrixElement = z.infer<typeof DistanceMatrixElementSchema>;

export const DistanceMatrixResultSchema = z.object({
  rows: z.array(
    z.object({
      elements: z.array(DistanceMatrixElementSchema),
    })
  ),
  provider: z.string(),
});
export type DistanceMatrixResult = z.infer<typeof DistanceMatrixResultSchema>;

export const EtaCalculationQuerySchema = z.object({
  origin: GeoCoordinatesSchema,
  destination: GeoCoordinatesSchema,
  averageSpeedKmh: z.number().min(5).max(120).optional(),
});
export type EtaCalculationQuery = z.infer<typeof EtaCalculationQuerySchema>;

export const EtaCalculationResultSchema = z.object({
  distanceMeters: z.number(),
  durationSeconds: z.number(),
  estimatedArrival: z.string(),
  provider: z.string(),
});
export type EtaCalculationResult = z.infer<typeof EtaCalculationResultSchema>;

/**
 * Phase 20.1 — ETA Engine Input Context
 * Assembled by EtaService before computing per-stop arrival estimates.
 * Contains everything needed: bus position, ordered remaining stops,
 * effective speed (live or fallback), and trip metadata.
 */

/** One remaining pickup stop in route order */
export const EtaRemainingStopSchema = z.object({
  stopId: z.string().uuid(),
  stopName: z.string(),
  sequenceOrder: z.number().int().min(0),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  geofenceRadiusMeters: z.number().int().min(50),
  scheduledTime: z.string(),
});
export type EtaRemainingStop = z.infer<typeof EtaRemainingStopSchema>;

/** How the effective speed was derived */
export const SpeedSourceSchema = z.enum(['rolling_avg', 'last_ping', 'fallback']);
export type SpeedSource = z.infer<typeof SpeedSourceSchema>;

/** Full assembled context object passed to the ETA calculator */
export const EtaTripContextSchema = z.object({
  tripId: z.string().uuid(),
  schoolId: z.string().uuid(),
  busId: z.string().uuid(),
  /** null when bus has no GPS fix yet (pre-trip or GPS offline) */
  currentPosition: GeoCoordinatesSchema.nullable(),
  /** Effective bus speed clamped to [5, 160] km/h */
  effectiveSpeedKmh: z.number().min(5).max(160),
  speedSource: SpeedSourceSchema,
  /** sequence_order of the last stop the bus visited / passed */
  currentStopSequence: z.number().int().min(0),
  /** Stops ahead of the bus in route order */
  remainingStops: z.array(EtaRemainingStopSchema),
  tripStatus: z.string(),
  actualStartTime: z.string().nullable(),
  /** ISO 8601 timestamp when this context was assembled */
  assembledAt: z.string().datetime(),
});
export type EtaTripContext = z.infer<typeof EtaTripContextSchema>;

/**
 * Phase 20.2 — ETA Calculation Results
 * Computed ephemeral values — not persisted to DB.
 * Returned by GET /api/v1/telemetry/trips/:tripId/eta
 */

/** ETA result for a single remaining pickup stop */
export const StopEtaResultSchema = z.object({
  stopId: z.string().uuid(),
  stopName: z.string(),
  sequenceOrder: z.number().int().min(0),
  /** Road distance from bus position cumulated to this stop */
  distanceMeters: z.number().min(0),
  /** Time in seconds from now until bus reaches this stop */
  durationSeconds: z.number().min(0),
  /** ISO 8601 wall-clock arrival estimate */
  estimatedArrivalAt: z.string().datetime(),
  /** Routing provider that produced this estimate */
  provider: z.string(),
});
export type StopEtaResult = z.infer<typeof StopEtaResultSchema>;

/** Aggregated ETA summary for the full remaining route of a trip */
export const RouteEtaSummarySchema = z.object({
  tripId: z.string().uuid(),
  totalRemainingDistanceMeters: z.number().min(0),
  totalRemainingDurationSeconds: z.number().min(0),
  /** Estimated wall-clock time the bus reaches the last stop */
  estimatedRouteCompletionAt: z.string().datetime().nullable(),
  /** ETA to the very next stop (null when no stops remain) */
  nextStopEta: StopEtaResultSchema.nullable(),
  /** ETA to every remaining stop in route order */
  stopEtas: z.array(StopEtaResultSchema),
  effectiveSpeedKmh: z.number().min(5).max(160),
  speedSource: SpeedSourceSchema,
  calculatedAt: z.string().datetime(),
});
export type RouteEtaSummary = z.infer<typeof RouteEtaSummarySchema>;

// =============================================================================
// Phase 20.4 — Parent ETA Schemas
// =============================================================================

export const ParentEtaStatusSchema = z.enum([
  'AVAILABLE',
  'APPROACHING',
  'PASSED',
  'ARRIVED',
  'UNAVAILABLE',
]);
export type ParentEtaStatus = z.infer<typeof ParentEtaStatusSchema>;

export const ParentEtaUnavailableReasonSchema = z.enum([
  'NO_ACTIVE_TRIP',
  'TRIP_NOT_STARTED',
  'TRIP_COMPLETED',
  'TRIP_CANCELLED',
  'GPS_UNAVAILABLE',
  'NO_STOP_ASSIGNED',
  'STOP_NOT_ON_ROUTE',
  'STOP_ALREADY_PASSED',
  'CALCULATION_PENDING',
]);
export type ParentEtaUnavailableReason = z.infer<typeof ParentEtaUnavailableReasonSchema>;

export const ParentPickupEtaSchema = z.object({
  tripId: z.string().uuid().nullable().optional(),
  stopId: z.string().uuid().nullable().optional(),
  stopName: z.string().nullable().optional(),
  sequenceOrder: z.number().int().nullable().optional(),

  // ETA metrics (when status is AVAILABLE or APPROACHING)
  durationSeconds: z.number().int().min(0).nullable().optional(),
  distanceMeters: z.number().min(0).nullable().optional(),
  etaMinutes: z.number().int().min(0).nullable().optional(),
  estimatedArrivalAt: z.string().datetime().nullable().optional(),

  // Status & availability
  status: ParentEtaStatusSchema,
  isAvailable: z.boolean(),
  unavailableReason: ParentEtaUnavailableReasonSchema.nullable().optional(),
  unavailableMessage: z.string().nullable().optional(),

  // Freshness & metadata
  isApproaching: z.boolean(),
  isPassed: z.boolean(),
  isStoppedBus: z.boolean().optional(),
  effectiveSpeedKmh: z.number().optional(),
  lastUpdatedAt: z.string().datetime().nullable().optional(),
  calculatedAt: z.string().datetime().nullable().optional(),
});
export type ParentPickupEta = z.infer<typeof ParentPickupEtaSchema>;

export const SnapToRoadQuerySchema = z.object({
  points: z.array(GeoCoordinatesSchema).min(1),
});


export type SnapToRoadQuery = z.infer<typeof SnapToRoadQuerySchema>;

export const SnappedPointSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  originalIndex: z.number(),
  confidence: z.number().optional(),
});
export type SnappedPoint = z.infer<typeof SnappedPointSchema>;

export const SnapToRoadResultSchema = z.object({
  snappedPoints: z.array(SnappedPointSchema),
  provider: z.string(),
});
export type SnapToRoadResult = z.infer<typeof SnapToRoadResultSchema>;

/**
 * Map Service Provider Contract (Geocoding & Map Utilities)
 */
export interface IMapProvider {
  readonly providerName: string;
  geocode(query: GeocodeQuery): Promise<GeocodeResult[]>;
  reverseGeocode(query: ReverseGeocodeQuery): Promise<ReverseGeocodeResult>;
  isHealthy(): Promise<boolean>;
}

/**
 * Routing Service Provider Contract (Routing, Matrix, ETA, Road Snapping)
 */
export interface IRoutingProvider {
  readonly providerName: string;
  calculateRoute(
    waypoints: GeoCoordinates[],
    options?: RouteOptions
  ): Promise<RouteCalculationResult>;
  calculateDistanceMatrix(
    query: DistanceMatrixQuery
  ): Promise<DistanceMatrixResult>;
  calculateEta(
    query: EtaCalculationQuery
  ): Promise<EtaCalculationResult>;
  snapToRoad(
    points: GeoCoordinates[]
  ): Promise<SnapToRoadResult>;
  isHealthy(): Promise<boolean>;
}

/**
 * -----------------------------------------------------------------------------
 * Phase 13.2 — Free-First Maps (OpenStreetMap, Tile Layers, Routing & Geocoding Options)
 * -----------------------------------------------------------------------------
 */

export const MapTileLayerOptionSchema = z.enum(['osm_standard', 'carto_light', 'google_streets', 'canvas']);
export type MapTileLayerOption = z.infer<typeof MapTileLayerOptionSchema>;

export const GeocodingOptionSchema = z.enum(['osm_nominatim', 'google_maps', 'mock']);
export type GeocodingOption = z.infer<typeof GeocodingOptionSchema>;

export const RoutingOptionSchema = z.enum(['osrm', 'valhalla', 'google_maps', 'mock']);
export type RoutingOption = z.infer<typeof RoutingOptionSchema>;


export const MapTileLayerConfigSchema = z.object({
  id: MapTileLayerOptionSchema,
  name: z.string(),
  urlTemplate: z.string(),
  subdomains: z.array(z.string()).default([]),
  attribution: z.string(),
  maxZoom: z.number().int().default(19),
  minZoom: z.number().int().default(1),
  isVectorCanvas: z.boolean().default(false),
});
export type MapTileLayerConfig = z.infer<typeof MapTileLayerConfigSchema>;

export const FREE_MAP_TILE_PROVIDERS: Record<MapTileLayerOption, MapTileLayerConfig> = {
  osm_standard: {
    id: 'osm_standard',
    name: 'OpenStreetMap Standard',
    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: [],
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    maxZoom: 19,
    minZoom: 1,
    isVectorCanvas: false,
  },
  carto_light: {
    id: 'carto_light',
    name: 'CartoDB Positron (Open)',
    urlTemplate: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c', 'd'],
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    minZoom: 1,
    isVectorCanvas: false,
  },
  google_streets: {
    id: 'google_streets',
    name: 'Google Streets (Commercial / Fallback Enabled)',
    urlTemplate: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    subdomains: [],
    attribution: '&copy; Google Maps',
    maxZoom: 21,
    minZoom: 1,
    isVectorCanvas: false,
  },
  canvas: {
    id: 'canvas',
    name: 'Operational Vector Canvas (Offline/Low-Bandwidth)',
    urlTemplate: '',
    subdomains: [],
    attribution: 'BUSLOARD Operational Vector Canvas',
    maxZoom: 22,
    minZoom: 1,
    isVectorCanvas: true,
  },
};

export const FreeMapOptionsResponseSchema = z.object({
  activeTileLayer: MapTileLayerOptionSchema,
  activeGeocodingProvider: GeocodingOptionSchema,
  activeRoutingProvider: RoutingOptionSchema,
  availableTileLayers: z.array(MapTileLayerConfigSchema),
  availableGeocodingProviders: z.array(z.string()),
  availableRoutingProviders: z.array(z.string()),
  defaultCenter: GeoCoordinatesSchema,
  defaultZoom: z.number().int(),
  isFreeFirst: z.literal(true),
});
export type FreeMapOptionsResponse = z.infer<typeof FreeMapOptionsResponseSchema>;

export const SelectMapOptionRequestSchema = z.object({
  tileLayer: MapTileLayerOptionSchema.optional(),
  geocodingProvider: GeocodingOptionSchema.optional(),
  routingProvider: RoutingOptionSchema.optional(),
});
export type SelectMapOptionRequest = z.infer<typeof SelectMapOptionRequestSchema>;

/**
 * OpenStreetMap Spherical Mercator tile projection helpers
 */
export function latLngToTile(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const rad = (lat * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
  );
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

export function tileToLatLng(x: number, y: number, zoom: number): { lat: number; lng: number } {
  const n = Math.pow(2, zoom);
  const lng = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat = (latRad * 180) / Math.PI;
  return { lat, lng };
}

export function getOsmTileUrl(
  template: string,
  x: number,
  y: number,
  z: number,
  subdomains: string[] = []
): string {
  let sub = '';
  if (subdomains.length > 0) {
    const idx = Math.abs((x + y) % subdomains.length);
    sub = subdomains[idx] ?? '';
  }
  return template
    .replace('{s}', sub)
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

/**
 * -----------------------------------------------------------------------------
 * Phase 13.3 — Routing (OSRM/Valhalla Evaluation, Route Distance, Road Paths, Fallbacks)
 * -----------------------------------------------------------------------------
 */

export const RoutingEvaluationFeaturesSchema = z.object({
  turnByTurn: z.boolean(),
  matrix: z.boolean(),
  roadSnapping: z.boolean(),
  customCosting: z.boolean(),
});
export type RoutingEvaluationFeatures = z.infer<typeof RoutingEvaluationFeaturesSchema>;

export const RoutingEvaluationItemSchema = z.object({
  engine: RoutingOptionSchema,
  engineName: z.string(),
  isAvailable: z.boolean(),
  latencyMs: z.number(),
  distanceMeters: z.number().optional(),
  durationSeconds: z.number().optional(),
  pointsCount: z.number().optional(),
  features: RoutingEvaluationFeaturesSchema,
  error: z.string().optional(),
});
export type RoutingEvaluationItem = z.infer<typeof RoutingEvaluationItemSchema>;

export const RoutingEvaluationResponseSchema = z.object({
  evaluations: z.array(RoutingEvaluationItemSchema),
  recommendedEngine: RoutingOptionSchema,
  activeEngine: RoutingOptionSchema,
  evaluatedAt: z.string(),
});
export type RoutingEvaluationResponse = z.infer<typeof RoutingEvaluationResponseSchema>;

export const RouteDistanceSummarySchema = z.object({
  totalDistanceMeters: z.number().min(0),
  totalDistanceKm: z.number().min(0),
  estimatedDurationMinutes: z.number().min(0),
  legsCount: z.number().int().min(1),
  isSnappy: z.boolean().default(true),
});
export type RouteDistanceSummary = z.infer<typeof RouteDistanceSummarySchema>;

export const RouteStopCalculationResultSchema = z.object({
  routeId: z.string().uuid(),
  routeName: z.string(),
  schoolId: z.string().uuid(),
  stopsCount: z.number().int(),
  totalDistanceMeters: z.number(),
  estimatedDurationMinutes: z.number(),
  pathPolyline: z.string(),
  legs: z.array(z.any()),
  provider: z.string(),
});
export type RouteStopCalculationResult = z.infer<typeof RouteStopCalculationResultSchema>;


/**
 * Decodes standard encoded polyline (Google/OSRM algorithm) into [latitude, longitude] pairs
 */
export function decodePolyline(encoded: string, precision: number = 5): [number, number][] {
  const factor = Math.pow(10, precision);
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const deltaLat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const deltaLng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    coordinates.push([
      Number((lat / factor).toFixed(6)),
      Number((lng / factor).toFixed(6)),
    ]);
  }

  return coordinates;
}

/**
 * -----------------------------------------------------------------------------
 * Phase 13.4 — Provider Fallback & Map API Usage Tracking
 * -----------------------------------------------------------------------------
 */

export const MapUsageOperationSchema = z.enum([
  'geocode',
  'reverse_geocode',
  'route_calculate',
  'eta',
  'distance_matrix',
  'snap_to_road',
  'tile_request',
]);
export type MapUsageOperation = z.infer<typeof MapUsageOperationSchema>;

export const MapUsageStatusSchema = z.enum(['success', 'failed', 'fallback']);
export type MapUsageStatus = z.infer<typeof MapUsageStatusSchema>;

export const MapUsageRecordSchema = z.object({
  id: z.string(),
  schoolId: z.string(),
  provider: z.string(),
  operation: MapUsageOperationSchema,
  status: MapUsageStatusSchema,
  fallbackProvider: z.string().optional(),
  latencyMs: z.number().min(0),
  estimatedCostUsd: z.number().min(0),
  estimatedCostInr: z.number().min(0),
  savedCostInr: z.number().min(0),
  timestamp: z.string(),
});
export type MapUsageRecord = z.infer<typeof MapUsageRecordSchema>;

export const MapUsageSummarySchema = z.object({
  schoolId: z.string(),
  totalRequests: z.number().int().min(0),
  successfulRequests: z.number().int().min(0),
  failedRequests: z.number().int().min(0),
  fallbackCount: z.number().int().min(0),
  averageLatencyMs: z.number().min(0),
  totalCostInr: z.number().min(0),
  totalCostUsd: z.number().min(0),
  totalSavedInr: z.number().min(0),
  requestsByProvider: z.record(z.string(), z.number()),
  requestsByOperation: z.record(z.string(), z.number()),
  activeProviders: z.object({
    routing: RoutingOptionSchema,
    geocoding: GeocodingOptionSchema,
    tileLayer: MapTileLayerOptionSchema,
  }),
  lastUpdated: z.string(),
});
export type MapUsageSummary = z.infer<typeof MapUsageSummarySchema>;

export const PaidMapTriggerConditionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  triggerCategory: z.enum(['address_ambiguity', 'traffic_congestion', 'rate_limit', 'safety_audit']),
  isActive: z.boolean(),
  thresholdDetail: z.string(),
  actionSummary: z.string(),
});
export type PaidMapTriggerCondition = z.infer<typeof PaidMapTriggerConditionSchema>;

export const PaidMapPolicyResponseSchema = z.object({
  policyName: z.string(),
  version: z.string(),
  isFreeFirstDefault: z.literal(true),
  triggers: z.array(PaidMapTriggerConditionSchema),
  supportedCommercialProviders: z.array(z.string()),
  activeRoutingOption: RoutingOptionSchema,
  activeGeocodingOption: GeocodingOptionSchema,
  hasCommercialKeyConfigured: z.boolean(),
  fallbackHierarchy: z.array(z.string()),
  dailyQuotaBudget: z.number().int(),
});
export type PaidMapPolicyResponse = z.infer<typeof PaidMapPolicyResponseSchema>;

/**
 * -----------------------------------------------------------------------------
 * Phase 14.1 — Dynamic Pickup Engine: Parent Location Sharing & Verification
 * -----------------------------------------------------------------------------
 */

export const SendMessageOptionsSchema = z.object({
  recipientPhone: z.string(),
  recipientRole: z.string().optional(),
  schoolId: z.string().optional(),
  studentId: z.string().optional(),
  templateId: z.string().optional(),
  variables: z.record(z.string(), z.string()).optional(),
  directText: z.string().optional(),
  interactiveType: z.enum(['location_request_message', 'button', 'list']).optional(),
  actionButtons: z.array(z.object({ title: z.string(), payload: z.string() })).optional(),
});
export type SendMessageOptions = z.infer<typeof SendMessageOptionsSchema>;

export const MessageSendResultSchema = z.object({
  messageId: z.string(),
  status: z.enum(['sent', 'queued', 'failed']),
  provider: z.string(),
  timestamp: z.string(),
});
export type MessageSendResult = z.infer<typeof MessageSendResultSchema>;

export interface IMessagingProvider {
  readonly providerName: string;
  sendMessage(options: SendMessageOptions): Promise<MessageSendResult>;
  sendLocationRequest(
    recipientPhone: string,
    promptText: string,
    context?: {
      schoolId?: string;
      studentId?: string;
      parentName?: string;
      studentName?: string;
      schoolName?: string;
    }
  ): Promise<MessageSendResult>;
  isHealthy(): Promise<boolean>;
}

export const RequestParentLocationSchema = z.object({
  schoolId: z.string().uuid(),
  studentId: z.string().uuid(),
  parentPhone: z.string().optional(),
  customPrompt: z.string().optional(),
});
export type RequestParentLocation = z.infer<typeof RequestParentLocationSchema>;

export const ParentLocationShareRequestSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  senderPhone: z.string().optional(),
  studentId: z.string().uuid().optional(),
  schoolId: z.string().uuid().optional(),
  locationName: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
});
export type ParentLocationShareRequest = z.infer<typeof ParentLocationShareRequestSchema>;

export const ValidateCoordinatesQuerySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  schoolId: z.string().uuid().optional(),
  maxCatchmentKm: z.number().min(1).max(100).default(35),
});
export type ValidateCoordinatesQuery = z.infer<typeof ValidateCoordinatesQuerySchema>;

export const ParentLocationValidationResultSchema = z.object({
  isValid: z.boolean(),
  coordinates: GeoCoordinatesSchema,
  formattedAddress: z.string(),
  distanceToSchoolKm: z.number().min(0),
  isWithinCatchment: z.boolean(),
  roadAccessible: z.boolean(),
  isWithinIndia: z.boolean(),
  validationErrors: z.array(z.string()).default([]),
  suggestedStopName: z.string().optional(),
  studentId: z.string().optional(),
  schoolId: z.string().optional(),
});
export type ParentLocationValidationResult = z.infer<typeof ParentLocationValidationResultSchema>;

export const WhatsAppInboundMessageSchema = z.object({
  from: z.string(),
  messageId: z.string().optional(),
  type: z.enum(['location', 'text', 'interactive', 'unknown']).default('unknown'),
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      name: z.string().optional(),
      address: z.string().optional(),
    })
    .optional(),
  text: z.object({ body: z.string() }).optional(),
  timestamp: z.string().optional(),
});
export type WhatsAppInboundMessage = z.infer<typeof WhatsAppInboundMessageSchema>;

// Phase 14.2: Pickup point creation schemas
export const FindNearestRoadQuerySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  schoolId: z.string().uuid().optional(),
  landmark: z.string().optional(),
});
export type FindNearestRoadQuery = z.infer<typeof FindNearestRoadQuerySchema>;

export const NearestRoadResultSchema = z.object({
  originalCoordinates: GeoCoordinatesSchema,
  snappedCoordinates: GeoCoordinatesSchema,
  distanceToRoadMeters: z.number().min(0),
  isAccessible: z.boolean(),
  formattedAddress: z.string(),
  suggestedStopName: z.string(),
  provider: z.string(),
});
export type NearestRoadResult = z.infer<typeof NearestRoadResultSchema>;

export const CreatePickupPointRequestSchema = z.object({
  schoolId: z.string().uuid(),
  routeId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  studentId: z.string().uuid().optional(),
  stopName: z.string().min(2).max(255).optional(),
  landmark: z.string().max(255).optional(),
  scheduledTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/)
    .optional()
    .default('07:30:00'),
  geofenceRadiusMeters: z.number().int().min(50).max(1000).optional().default(300),
  snapToRoad: z.boolean().optional().default(true),
  clusterThresholdMeters: z.number().int().min(10).max(200).optional().default(50),
});
export type CreatePickupPointRequest = z.infer<typeof CreatePickupPointRequestSchema>;

export const PickupPointCreationResultSchema = z.object({
  id: z.string().uuid(),
  schoolId: z.string().uuid(),
  routeId: z.string().uuid(),
  stopName: z.string(),
  sequenceOrder: z.number().int(),
  latitude: z.number(),
  longitude: z.number(),
  originalCoordinates: GeoCoordinatesSchema,
  snappedCoordinates: GeoCoordinatesSchema,
  distanceToRoadMeters: z.number(),
  formattedAddress: z.string(),
  scheduledTime: z.string(),
  geofenceRadiusMeters: z.number(),
  reusedExistingStop: z.boolean(),
  assignedStudentId: z.string().uuid().optional(),
  createdAt: z.string().optional(),
});
export type PickupPointCreationResult = z.infer<typeof PickupPointCreationResultSchema>;

/**
 * Formats a clean, human-readable Indian transport address and concise stop name.
 * Adheres to Indian postal/locality standards (Landmark, Street, Sublocality/Colony, City, State, PIN).
 */
export function formatIndianTransportAddress(components: {
  landmark?: string;
  street?: string;
  sublocality?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  fallbackAddress?: string;
}): { formattedAddress: string; suggestedStopName: string } {
  const parts: string[] = [];

  const landmark = components.landmark?.trim();
  if (landmark) {
    parts.push(landmark.startsWith('Near ') || landmark.startsWith('Opp ') || landmark.startsWith('Opposite ')
      ? landmark
      : `Near ${landmark}`);
  }

  const street = components.street?.trim();
  if (street && !parts.some((p) => p.toLowerCase().includes(street.toLowerCase()))) {
    parts.push(street);
  }

  const sublocality = components.sublocality?.trim();
  if (sublocality && !parts.some((p) => p.toLowerCase().includes(sublocality.toLowerCase()))) {
    parts.push(sublocality);
  }

  const city = components.city?.trim();
  if (city) {
    parts.push(city);
  }

  let stateAndPin = '';
  const state = components.state?.trim();
  const postalCode = components.postalCode?.trim();
  if (state && postalCode) {
    stateAndPin = `${state} ${postalCode}`;
  } else if (state) {
    stateAndPin = state;
  } else if (postalCode) {
    stateAndPin = postalCode;
  }
  if (stateAndPin) {
    parts.push(stateAndPin);
  }

  const formattedAddress = parts.length > 0 ? parts.join(', ') : (components.fallbackAddress || 'Pickup Point');

  // Generate short operational stop label for bus drivers and dispatchers
  let suggestedStopName = 'Pickup Point';
  if (landmark) {
    suggestedStopName = landmark;
  } else if (street && sublocality) {
    suggestedStopName = `${sublocality} - ${street}`;
  } else if (sublocality) {
    suggestedStopName = sublocality;
  } else if (street) {
    suggestedStopName = street;
  } else if (components.fallbackAddress) {
    suggestedStopName = components.fallbackAddress.split(',')[0]!.trim();
  }

  return {
    formattedAddress,
    suggestedStopName,
  };
}

// Phase 14.3: Student mapping schemas
export const AssignStudentPickupRequestSchema = z.object({
  schoolId: z.string().uuid(),
  studentId: z.string().uuid(),
  pickupStopId: z.string().uuid(),
  dropStopId: z.string().uuid().optional(),
  notifyParent: z.boolean().optional().default(true),
});
export type AssignStudentPickupRequest = z.infer<typeof AssignStudentPickupRequestSchema>;

export const UpdateStudentPickupRequestSchema = z.object({
  schoolId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  pickupStopId: z.string().uuid().optional(),
  dropStopId: z.string().uuid().optional(),
  routeId: z.string().uuid().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  stopName: z.string().max(255).optional(),
  landmark: z.string().max(255).optional(),
  notifyParent: z.boolean().optional().default(true),
});
export type UpdateStudentPickupRequest = z.infer<typeof UpdateStudentPickupRequestSchema>;

export const StudentPickupMapDataSchema = z.object({
  student: z.object({
    id: z.string().uuid(),
    fullName: z.string(),
    admissionNumber: z.string(),
    classGrade: z.string(),
    section: z.string(),
  }),
  pickupStop: z
    .object({
      id: z.string().uuid(),
      stopName: z.string(),
      sequenceOrder: z.number().int(),
      scheduledTime: z.string(),
      latitude: z.number(),
      longitude: z.number(),
      geofenceRadiusMeters: z.number(),
      formattedAddress: z.string().optional(),
    })
    .nullable(),
  dropStop: z
    .object({
      id: z.string().uuid(),
      stopName: z.string(),
      sequenceOrder: z.number().int(),
      scheduledTime: z.string(),
      latitude: z.number(),
      longitude: z.number(),
      geofenceRadiusMeters: z.number(),
      formattedAddress: z.string().optional(),
    })
    .nullable()
    .optional(),
  route: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      code: z.string(),
      routeType: z.string(),
      pathPolyline: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  activeTrip: z
    .object({
      id: z.string().uuid(),
      status: z.string(),
      busNumber: z.string(),
      registrationNumber: z.string(),
      driverName: z.string(),
      currentLatitude: z.number().nullable().optional(),
      currentLongitude: z.number().nullable().optional(),
      speedKmh: z.number().nullable().optional(),
      lastPingAt: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type StudentPickupMapData = z.infer<typeof StudentPickupMapDataSchema>;

// Phase 14.4: Safety/quality checks, duplicate detection, and stop management schemas
export const LocationSafetyCheckRequestSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  schoolId: z.string().uuid().optional(),
  maxCatchmentKm: z.number().min(1).max(200).optional(),
  maxRoadDistanceMeters: z.number().min(10).max(2000).optional(),
});
export type LocationSafetyCheckRequest = z.infer<typeof LocationSafetyCheckRequestSchema>;

export const LocationSafetyCheckResultSchema = z.object({
  isSafe: z.boolean(),
  safetyScore: z.number().min(0).max(100),
  reasons: z.array(z.string()),
  coordinates: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }),
  isWithinIndia: z.boolean(),
  isWithinCatchment: z.boolean(),
  distanceToSchoolKm: z.number(),
  isRoadAccessible: z.boolean(),
  distanceToRoadMeters: z.number(),
  snappedCoordinates: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
    })
    .optional(),
  formattedAddress: z.string().optional(),
});
export type LocationSafetyCheckResult = z.infer<typeof LocationSafetyCheckResultSchema>;

export const DetectDuplicatesRequestSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  schoolId: z.string().uuid().optional(),
  routeId: z.string().uuid().optional(),
  radiusMeters: z.number().min(10).max(5000).optional(),
  duplicateThresholdMeters: z.number().min(10).max(500).optional(),
});
export type DetectDuplicatesRequest = z.infer<typeof DetectDuplicatesRequestSchema>;

export const NearbyStopItemSchema = z.object({
  id: z.string().uuid(),
  stopName: z.string(),
  sequenceOrder: z.number().int(),
  latitude: z.number(),
  longitude: z.number(),
  scheduledTime: z.string(),
  geofenceRadiusMeters: z.number(),
  distanceMeters: z.number(),
  isDuplicate: z.boolean(),
  assignedStudentsCount: z.number().int(),
  route: z.object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string(),
  }),
});
export type NearbyStopItem = z.infer<typeof NearbyStopItemSchema>;

export const DetectDuplicatesResultSchema = z.object({
  hasNearbyDuplicates: z.boolean(),
  duplicateCount: z.number().int(),
  totalNearbyCount: z.number().int(),
  recommendation: z.enum(['REUSE_EXISTING', 'CREATE_NEW', 'MERGE_STOPS']),
  nearestStop: NearbyStopItemSchema.nullable().optional(),
  nearbyStops: z.array(NearbyStopItemSchema),
});
export type DetectDuplicatesResult = z.infer<typeof DetectDuplicatesResultSchema>;

export const AuditDuplicatesQuerySchema = z.object({
  schoolId: z.string().uuid().optional(),
  routeId: z.string().uuid().optional(),
  thresholdMeters: z.coerce.number().min(5).max(500).optional(),
});
export type AuditDuplicatesQuery = z.infer<typeof AuditDuplicatesQuerySchema>;

export const EditPickupStopRequestSchema = z.object({
  schoolId: z.string().uuid().optional(),
  stopName: z.string().min(1).max(255).optional(),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Invalid time format (HH:MM or HH:MM:SS)').optional(),
  geofenceRadiusMeters: z.number().int().min(50).max(2000).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  landmark: z.string().max(255).optional(),
  reassignStudentsToStopId: z.string().uuid().optional(),
  notifyParents: z.boolean().optional().default(true),
});
export type EditPickupStopRequest = z.infer<typeof EditPickupStopRequestSchema>;

export const DeletePickupStopRequestSchema = z.object({
  schoolId: z.string().uuid().optional(),
  forceReassignToStopId: z.string().uuid().optional(),
  notifyParents: z.boolean().optional().default(true),
});
export type DeletePickupStopRequest = z.infer<typeof DeletePickupStopRequestSchema>;

/**
 * -----------------------------------------------------------------------------
 * Phase 17.1 — Driver WhatsApp Core: Menu & Daily Operations
 * -----------------------------------------------------------------------------
 */

export enum DriverWhatsAppAction {
  START_TRIP = 'START_TRIP',
  END_TRIP = 'END_TRIP',
  STUDENT_SEARCH = 'STUDENT_SEARCH',
  REPORT_PROBLEM = 'REPORT_PROBLEM',
  EMERGENCY = 'EMERGENCY',
  HELP = 'HELP',
}

export const DriverWhatsAppMenuItemSchema = z.object({
  action: z.nativeEnum(DriverWhatsAppAction),
  title: z.string(),
  description: z.string(),
  commandCode: z.string(),
});
export type DriverWhatsAppMenuItem = z.infer<typeof DriverWhatsAppMenuItemSchema>;

export const DriverWhatsAppMenuResponseSchema = z.object({
  driver: z.object({
    id: z.string().uuid(),
    fullName: z.string(),
    phone: z.string(),
    schoolId: z.string().uuid(),
  }),
  bus: z
    .object({
      id: z.string().uuid(),
      busNumber: z.string(),
      registrationNumber: z.string(),
    })
    .optional(),
  activeTrip: z
    .object({
      id: z.string().uuid(),
      routeId: z.string().uuid(),
      routeName: z.string().optional(),
      routeCode: z.string().optional(),
      status: z.nativeEnum(TripStatus),
      currentStopSequence: z.number().int(),
      totalStops: z.number().int(),
    })
    .nullable()
    .optional(),
  scheduledTrip: z
    .object({
      id: z.string().uuid(),
      routeId: z.string().uuid(),
      routeName: z.string().optional(),
      routeCode: z.string().optional(),
      scheduledStartTime: z.string(),
    })
    .nullable()
    .optional(),
  menuItems: z.array(DriverWhatsAppMenuItemSchema),
  formattedText: z.string(),
});
export type DriverWhatsAppMenuResponse = z.infer<typeof DriverWhatsAppMenuResponseSchema>;

export const DriverWhatsAppInboundRequestSchema = z.object({
  from: z.string().min(6),
  text: z.string().optional(),
  action: z.nativeEnum(DriverWhatsAppAction).optional(),
  schoolId: z.string().uuid().optional(),
});
export type DriverWhatsAppInboundRequest = z.infer<typeof DriverWhatsAppInboundRequestSchema>;

export const DriverWhatsAppInboundResponseSchema = z.object({
  handled: z.boolean(),
  driverId: z.string().uuid().optional(),
  schoolId: z.string().uuid().optional(),
  actionTriggered: z.union([
    z.nativeEnum(DriverWhatsAppAction),
    z.literal('MENU'),
    z.literal('UNREGISTERED'),
    z.literal('UNKNOWN_COMMAND'),
    z.literal('DUPLICATE_COMMAND'),
  ]),
  replyText: z.string(),
  menu: DriverWhatsAppMenuResponseSchema.optional(),
  whatsappDelivered: z.boolean().optional(),
  errorCode: z.string().optional(),
});
export type DriverWhatsAppInboundResponse = z.infer<typeof DriverWhatsAppInboundResponseSchema>;

/**
 * Driver WhatsApp Start Trip Types (Micro-Phase 17.2)
 */
export const DriverWhatsAppStartTripRequestSchema = z.object({
  from: z.string().min(6),
  schoolId: z.string().uuid().optional(),
  tripId: z.string().uuid().optional(),
  routeId: z.string().uuid().optional(),
  busId: z.string().uuid().optional(),
});
export type DriverWhatsAppStartTripRequest = z.infer<typeof DriverWhatsAppStartTripRequestSchema>;

export const DriverWhatsAppStartTripResponseSchema = z.object({
  success: z.boolean(),
  alreadyInTransit: z.boolean().default(false),
  trip: TripDetailResponseSchema,
  driver: z.object({
    id: z.string().uuid(),
    fullName: z.string(),
    phone: z.string(),
  }),
  bus: z.object({
    id: z.string().uuid(),
    busNumber: z.string(),
    registrationNumber: z.string(),
  }),
  parentNotificationsSent: z.number().int().min(0),
  trackingSessionActive: z.boolean(),
  replyText: z.string(),
});
export type DriverWhatsAppStartTripResponse = z.infer<typeof DriverWhatsAppStartTripResponseSchema>;

/**
 * Driver WhatsApp End Trip Types (Micro-Phase 17.3)
 */
export const DriverWhatsAppEndTripRequestSchema = z.object({
  from: z.string().min(6),
  schoolId: z.string().uuid().optional(),
  tripId: z.string().uuid().optional(),
  summaryNotes: z.string().max(500).optional(),
  endedAt: z.string().datetime().optional(),
});
export type DriverWhatsAppEndTripRequest = z.infer<typeof DriverWhatsAppEndTripRequestSchema>;

export const DriverWhatsAppEndTripResponseSchema = z.object({
  success: z.boolean(),
  alreadyCompleted: z.boolean().default(false),
  trip: TripDetailResponseSchema,
  summary: TripSummaryResponseSchema,
  driver: z.object({
    id: z.string().uuid(),
    fullName: z.string(),
    phone: z.string(),
  }),
  bus: z.object({
    id: z.string().uuid(),
    busNumber: z.string(),
    registrationNumber: z.string(),
  }),
  attendanceLocked: z.boolean(),
  trackingSessionActive: z.boolean(),
  replyText: z.string(),
});
export type DriverWhatsAppEndTripResponse = z.infer<typeof DriverWhatsAppEndTripResponseSchema>;

/**
 * Driver Attendance Student List (Micro-Phase 18.1)
 */
export const DriverStudentStopInfoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  sequenceOrder: z.number().int().min(1),
  expectedTimeOffsetMinutes: z.number().int().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().optional(),
});
export type DriverStudentStopInfo = z.infer<typeof DriverStudentStopInfoSchema>;

export const DriverStudentAttendanceItemSchema = z.object({
  studentId: z.string().uuid(),
  admissionNumber: z.string(),
  fullName: z.string(),
  grade: z.string().optional(),
  section: z.string().optional(),
  emergencyPhone: z.string().optional(),
  pickupStop: DriverStudentStopInfoSchema,
  dropStop: DriverStudentStopInfoSchema.optional(),
  parent: z
    .object({
      fullName: z.string(),
      phone: z.string(),
      relationship: z.string().optional(),
    })
    .optional(),
  attendanceStatus: z.nativeEnum(AttendanceStatus).default(AttendanceStatus.PENDING),
  boardedAt: z.string().optional(),
  droppedAt: z.string().optional(),
  markedBy: z.string().optional(),
});
export type DriverStudentAttendanceItem = z.infer<typeof DriverStudentAttendanceItemSchema>;

export const DriverStudentListResponseSchema = z.object({
  tripId: z.string().uuid().optional(),
  busId: z.string().uuid(),
  busNumber: z.string(),
  registrationNumber: z.string(),
  routeId: z.string().uuid().optional(),
  routeName: z.string().optional(),
  routeCode: z.string().optional(),
  totalStudents: z.number().int().min(0),
  boardedCount: z.number().int().min(0),
  droppedCount: z.number().int().min(0),
  absentCount: z.number().int().min(0),
  pendingCount: z.number().int().min(0),
  students: z.array(DriverStudentAttendanceItemSchema),
});
export type DriverStudentListResponse = z.infer<typeof DriverStudentListResponseSchema>;

/**
 * Driver Student Search (Micro-Phase 19.1)
 * Tasks: Search by student name; Restrict results to assigned bus
 */
export const DriverStudentSearchQuerySchema = z.object({
  /** Partial name or admission number to search for (case-insensitive) */
  q: z
    .string()
    .min(1, 'Search query must be at least 1 character')
    .max(100, 'Search query must be at most 100 characters')
    .trim()
    .optional(),
  /** Scope results to a specific trip (overrides driver's active trip lookup) */
  tripId: z.string().uuid('Valid trip UUID is required').optional(),
  /** Scope results to a specific bus (requires admin; drivers are auto-scoped) */
  busId: z.string().uuid('Valid bus UUID is required').optional(),
});
export type DriverStudentSearchQuery = z.infer<typeof DriverStudentSearchQuerySchema>;

/**
 * Driver Boarding Attendance (Micro-Phase 18.2)
 * Tasks: Boarded, Not boarded, Timestamp, Location
 */
export const RecordBoardingStatusEnum = z.enum(['BOARDED', 'ABSENT']);
export type RecordBoardingStatus = z.infer<typeof RecordBoardingStatusEnum>;

export const RecordBoardingRequestSchema = z.object({
  tripId: z.string().uuid('Valid trip UUID is required'),
  studentId: z.string().uuid('Valid student UUID is required'),
  stopId: z.string().uuid('Valid pickup stop UUID is required').optional(),
  status: RecordBoardingStatusEnum.default('BOARDED'),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  recordedAt: z.string().datetime({ offset: true }).optional().nullable(),
});
export type RecordBoardingRequest = z.infer<typeof RecordBoardingRequestSchema>;

export const BoardingBatchItemSchema = z.object({
  studentId: z.string().uuid('Valid student UUID is required'),
  status: RecordBoardingStatusEnum.default('BOARDED'),
  stopId: z.string().uuid('Valid pickup stop UUID is required').optional(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  recordedAt: z.string().datetime({ offset: true }).optional().nullable(),
});
export type BoardingBatchItem = z.infer<typeof BoardingBatchItemSchema>;

export const RecordBoardingBatchRequestSchema = z.object({
  tripId: z.string().uuid('Valid trip UUID is required'),
  stopId: z.string().uuid('Valid pickup stop UUID is required').optional(),
  records: z.array(BoardingBatchItemSchema).min(1, 'At least one student boarding record is required'),
});
export type RecordBoardingBatchRequest = z.infer<typeof RecordBoardingBatchRequestSchema>;

export const BoardingEventRecordSchema = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  studentId: z.string().uuid(),
  stopId: z.string().uuid(),
  status: RecordBoardingStatusEnum,
  markedBy: z.string(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  recordedAt: z.string(),
});
export type BoardingEventRecord = z.infer<typeof BoardingEventRecordSchema>;

export const BoardingSummaryCountsSchema = z.object({
  totalStudents: z.number().int().min(0),
  boardedCount: z.number().int().min(0),
  absentCount: z.number().int().min(0),
  pendingCount: z.number().int().min(0),
});
export type BoardingSummaryCounts = z.infer<typeof BoardingSummaryCountsSchema>;

export const RecordBoardingResponseSchema = z.object({
  event: BoardingEventRecordSchema,
  student: z.object({
    id: z.string().uuid(),
    fullName: z.string(),
    admissionNumber: z.string(),
  }),
  summary: BoardingSummaryCountsSchema,
});
export type RecordBoardingResponse = z.infer<typeof RecordBoardingResponseSchema>;

export const RecordBoardingBatchResponseSchema = z.object({
  events: z.array(BoardingEventRecordSchema),
  updatedCount: z.number().int().min(0),
  summary: BoardingSummaryCountsSchema,
});
export type RecordBoardingBatchResponse = z.infer<typeof RecordBoardingBatchResponseSchema>;

/**
 * Driver Drop Attendance (Micro-Phase 18.3)
 * Tasks: Dropped, Timestamp, Location
 */
export const RecordDropStatusEnum = z.enum(['DEBOARDED', 'HANDOVER_CONFIRMED', 'RETURNED_TO_SCHOOL']);
export type RecordDropStatus = z.infer<typeof RecordDropStatusEnum>;

export const RecordDropRequestSchema = z.object({
  tripId: z.string().uuid('Valid trip UUID is required'),
  studentId: z.string().uuid('Valid student UUID is required'),
  stopId: z.string().uuid('Valid drop stop UUID is required').optional(),
  status: RecordDropStatusEnum.default('DEBOARDED'),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  recordedAt: z.string().datetime({ offset: true }).optional().nullable(),
});
export type RecordDropRequest = z.infer<typeof RecordDropRequestSchema>;

export const DropBatchItemSchema = z.object({
  studentId: z.string().uuid('Valid student UUID is required'),
  status: RecordDropStatusEnum.default('DEBOARDED'),
  stopId: z.string().uuid('Valid drop stop UUID is required').optional(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  recordedAt: z.string().datetime({ offset: true }).optional().nullable(),
});
export type DropBatchItem = z.infer<typeof DropBatchItemSchema>;

export const RecordDropBatchRequestSchema = z.object({
  tripId: z.string().uuid('Valid trip UUID is required'),
  stopId: z.string().uuid('Valid drop stop UUID is required').optional(),
  records: z.array(DropBatchItemSchema).min(1, 'At least one student drop record is required'),
});
export type RecordDropBatchRequest = z.infer<typeof RecordDropBatchRequestSchema>;

export const DropEventRecordSchema = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  studentId: z.string().uuid(),
  stopId: z.string().uuid(),
  status: RecordDropStatusEnum,
  markedBy: z.string(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  recordedAt: z.string(),
});
export type DropEventRecord = z.infer<typeof DropEventRecordSchema>;

export const DropSummaryCountsSchema = z.object({
  totalStudents: z.number().int().min(0),
  boardedCount: z.number().int().min(0),
  droppedCount: z.number().int().min(0),
  absentCount: z.number().int().min(0),
  pendingCount: z.number().int().min(0),
  inBusCount: z.number().int().min(0),
});
export type DropSummaryCounts = z.infer<typeof DropSummaryCountsSchema>;

export const RecordDropResponseSchema = z.object({
  event: DropEventRecordSchema,
  student: z.object({
    id: z.string().uuid(),
    fullName: z.string(),
    admissionNumber: z.string(),
  }),
  summary: DropSummaryCountsSchema,
});
export type RecordDropResponse = z.infer<typeof RecordDropResponseSchema>;

export const RecordDropBatchResponseSchema = z.object({
  events: z.array(DropEventRecordSchema),
  updatedCount: z.number().int().min(0),
  summary: DropSummaryCountsSchema,
});
export type RecordDropBatchResponse = z.infer<typeof RecordDropBatchResponseSchema>;

/**
 * -----------------------------------------------------------------------------
 * Driver Attendance History & Corrections (Micro-Phase 18.4)
 * Tasks: Trip/date history, Student journey history, Correction rules
 * -----------------------------------------------------------------------------
 */

// 1. Correction Event Type & Status Enums
export const AttendanceCorrectionEventTypeEnum = z.enum(['BOARDING', 'DROP']);
export type AttendanceCorrectionEventType = z.infer<typeof AttendanceCorrectionEventTypeEnum>;

export const AttendanceCorrectionNewStatusEnum = z.enum([
  'BOARDED',
  'ABSENT',
  'SKIPPED',
  'DEBOARDED',
  'HANDOVER_CONFIRMED',
  'RETURNED_TO_SCHOOL',
  'PENDING',
]);
export type AttendanceCorrectionNewStatus = z.infer<typeof AttendanceCorrectionNewStatusEnum>;

// 2. Correction Request & Audit Record Schemas
export const CorrectAttendanceRequestSchema = z.object({
  tripId: z.string().uuid('Valid trip UUID is required'),
  studentId: z.string().uuid('Valid student UUID is required'),
  eventType: AttendanceCorrectionEventTypeEnum,
  newStatus: AttendanceCorrectionNewStatusEnum,
  reason: z.string().min(5, 'Mandatory reason of at least 5 characters is required for audit').max(500),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});
export type CorrectAttendanceRequest = z.infer<typeof CorrectAttendanceRequestSchema>;

export const AttendanceCorrectionRecordSchema = z.object({
  id: z.string().uuid(),
  schoolId: z.string().uuid(),
  tripId: z.string().uuid(),
  studentId: z.string().uuid(),
  eventType: AttendanceCorrectionEventTypeEnum,
  previousStatus: z.string().nullable().optional(),
  newStatus: z.string(),
  reason: z.string(),
  correctedBy: z.string().uuid(),
  correctedByRole: z.string(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  createdAt: z.string(),
});
export type AttendanceCorrectionRecord = z.infer<typeof AttendanceCorrectionRecordSchema>;

export const CorrectAttendanceResponseSchema = z.object({
  success: z.boolean(),
  correction: AttendanceCorrectionRecordSchema,
  student: z.object({
    id: z.string().uuid(),
    fullName: z.string(),
    admissionNumber: z.string(),
  }),
  newJourneyStatus: z.string(),
  summary: DropSummaryCountsSchema,
});
export type CorrectAttendanceResponse = z.infer<typeof CorrectAttendanceResponseSchema>;

// 3. Student Journey History Schemas
export const JourneyTimelineEventSchema = z.object({
  id: z.string(),
  type: z.enum(['SCHEDULED', 'BOARDING', 'DROP', 'CORRECTION']),
  status: z.string(),
  timestamp: z.string(),
  stopName: z.string().optional().nullable(),
  stopSequence: z.number().optional().nullable(),
  markedBy: z.string().optional().nullable(),
  reason: z.string().optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
});
export type JourneyTimelineEvent = z.infer<typeof JourneyTimelineEventSchema>;

export const StudentJourneyHistoryResponseSchema = z.object({
  student: z.object({
    id: z.string().uuid(),
    fullName: z.string(),
    admissionNumber: z.string(),
    classGrade: z.string().optional().nullable(),
    section: z.string().optional().nullable(),
    emergencyPhone: z.string().optional().nullable(),
  }),
  trip: z.object({
    id: z.string().uuid(),
    busNumber: z.string(),
    registrationNumber: z.string(),
    routeName: z.string(),
    routeCode: z.string().optional().nullable(),
    scheduledDate: z.string(),
    status: z.string(),
    driverName: z.string().optional().nullable(),
  }),
  currentStatus: z.string(),
  timeline: z.array(JourneyTimelineEventSchema),
  corrections: z.array(AttendanceCorrectionRecordSchema),
});
export type StudentJourneyHistoryResponse = z.infer<typeof StudentJourneyHistoryResponseSchema>;

// 4. Trip / Date Attendance History Schemas
export const TripAttendanceStudentItemSchema = z.object({
  studentId: z.string().uuid(),
  fullName: z.string(),
  admissionNumber: z.string(),
  classGrade: z.string().optional().nullable(),
  section: z.string().optional().nullable(),
  emergencyPhone: z.string().optional().nullable(),
  pickupStop: z.object({
    id: z.string().uuid(),
    name: z.string(),
    sequenceOrder: z.number(),
  }),
  dropStop: z.object({
    id: z.string().uuid(),
    name: z.string(),
    sequenceOrder: z.number(),
  }).optional().nullable(),
  boarding: z.object({
    status: z.string(),
    recordedAt: z.string(),
    markedBy: z.string(),
    latitude: z.number().optional().nullable(),
    longitude: z.number().optional().nullable(),
  }).optional().nullable(),
  drop: z.object({
    status: z.string(),
    recordedAt: z.string(),
    markedBy: z.string(),
    latitude: z.number().optional().nullable(),
    longitude: z.number().optional().nullable(),
  }).optional().nullable(),
  journeyStatus: z.string(),
  correctionsCount: z.number().int().min(0),
});
export type TripAttendanceStudentItem = z.infer<typeof TripAttendanceStudentItemSchema>;

export const TripAttendanceHistoryResponseSchema = z.object({
  trip: z.object({
    id: z.string().uuid(),
    schoolId: z.string().uuid(),
    busId: z.string().uuid(),
    busNumber: z.string(),
    registrationNumber: z.string(),
    routeId: z.string().uuid(),
    routeName: z.string(),
    routeCode: z.string().optional().nullable(),
    driverId: z.string().uuid(),
    driverName: z.string().optional().nullable(),
    scheduledDate: z.string(),
    status: z.string(),
    startedAt: z.string().optional().nullable(),
    completedAt: z.string().optional().nullable(),
  }),
  summary: DropSummaryCountsSchema,
  students: z.array(TripAttendanceStudentItemSchema),
});
export type TripAttendanceHistoryResponse = z.infer<typeof TripAttendanceHistoryResponseSchema>;

export const DateAttendanceHistoryQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  busId: z.string().uuid().optional(),
  routeId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
});
export type DateAttendanceHistoryQuery = z.infer<typeof DateAttendanceHistoryQuerySchema>;

export const DateAttendanceHistoryResponseSchema = z.object({
  date: z.string(),
  tripsCount: z.number().int().min(0),
  overallSummary: DropSummaryCountsSchema,
  trips: z.array(TripAttendanceHistoryResponseSchema),
});
export type DateAttendanceHistoryResponse = z.infer<typeof DateAttendanceHistoryResponseSchema>;

// =============================================================================
// Phase 21 — Geofence Notifications
// =============================================================================

/**
 * Row shape for the geofence_notification_log table.
 * Used for dedup checking and insertion.
 */
export const GeofenceNotificationLogRowSchema = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  stopId: z.string().uuid(),
  studentId: z.string().uuid(),
  parentId: z.string().uuid(),
  schoolId: z.string().uuid(),
  triggerDistanceMeters: z.number().nullable().optional(),
  etaMinutes: z.number().int().nullable().optional(),
  messageSid: z.string().nullable().optional(),
  triggeredAt: z.string(),
});
export type GeofenceNotificationLogRow = z.infer<typeof GeofenceNotificationLogRowSchema>;

/**
 * Result returned by GeofenceNotificationService.checkAndNotify()
 */
export const GeofenceNotificationResultSchema = z.object({
  tripId: z.string().uuid(),
  notificationsSent: z.number().int().min(0),
  stopsChecked: z.number().int().min(0),
  /** Approach-radius matches that were already notified (deduped) */
  alreadyNotified: z.number().int().min(0),
  /** Parents that have opted out of notifications */
  optedOut: z.number().int().min(0),
});
export type GeofenceNotificationResult = z.infer<typeof GeofenceNotificationResultSchema>;

// =============================================================================
// Phase 21.1 — Pickup Geofence Radius/Shape & Entry/Exit Transition Schemas
// =============================================================================

export const GeofenceEventTypeSchema = z.enum(['ENTRY', 'EXIT', 'DWELL']);
export type GeofenceEventType = z.infer<typeof GeofenceEventTypeSchema>;

export const GeofenceStateStatusSchema = z.enum(['INSIDE', 'OUTSIDE']);
export type GeofenceStateStatus = z.infer<typeof GeofenceStateStatusSchema>;

export const GeofenceShapeSchema = z.object({
  geofenceType: GeofenceTypeSchema,
  geofenceRadiusMeters: z.number().int().min(50).max(2000).optional(),
  geofencePolygon: z.array(PolygonCoordinateSchema).min(3).optional().nullable(),
});
export type GeofenceShape = z.infer<typeof GeofenceShapeSchema>;

export const UpdateStopGeofenceRequestSchema = z.object({
  geofenceType: GeofenceTypeSchema,
  geofenceRadiusMeters: z.number().int().min(50).max(2000).optional(),
  geofencePolygon: z.array(PolygonCoordinateSchema).min(3, 'Polygon geofence must have at least 3 vertices').optional().nullable(),
});
export type UpdateStopGeofenceRequest = z.infer<typeof UpdateStopGeofenceRequestSchema>;

export const GeofenceEventRecordSchema = z.object({
  id: z.string().uuid(),
  schoolId: z.string().uuid(),
  tripId: z.string().uuid(),
  busId: z.string().uuid(),
  stopId: z.string().uuid(),
  stopName: z.string().optional().nullable(),
  sequenceOrder: z.number().int().optional().nullable(),
  eventType: GeofenceEventTypeSchema,
  latitude: z.number(),
  longitude: z.number(),
  distanceToCenterMeters: z.number().nullable().optional(),
  dwellTimeSeconds: z.number().int().nullable().optional(),
  recordedAt: z.string(),
  createdAt: z.string().optional(),
});
export type GeofenceEventRecord = z.infer<typeof GeofenceEventRecordSchema>;

export const TripStopGeofenceStateSchema = z.object({
  id: z.string().uuid().optional(),
  tripId: z.string().uuid(),
  stopId: z.string().uuid(),
  stopName: z.string().optional().nullable(),
  sequenceOrder: z.number().int().optional().nullable(),
  status: GeofenceStateStatusSchema,
  enteredAt: z.string().nullable().optional(),
  exitedAt: z.string().nullable().optional(),
  dwellTimeSeconds: z.number().int().default(0),
  lastEvaluatedAt: z.string().optional(),
});
export type TripStopGeofenceState = z.infer<typeof TripStopGeofenceStateSchema>;

export const GeofenceTransitionSchema = z.object({
  stopId: z.string().uuid(),
  stopName: z.string(),
  sequenceOrder: z.number().int(),
  eventType: GeofenceEventTypeSchema,
  previousStatus: GeofenceStateStatusSchema,
  currentStatus: GeofenceStateStatusSchema,
  distanceToCenterMeters: z.number(),
  enteredAt: z.string().optional(),
  exitedAt: z.string().optional(),
  dwellTimeSeconds: z.number().int().optional(),
  recordedAt: z.string(),
});
export type GeofenceTransition = z.infer<typeof GeofenceTransitionSchema>;

export const EvaluateTripGeofenceResultSchema = z.object({
  tripId: z.string().uuid(),
  busId: z.string().uuid(),
  evaluatedStopsCount: z.number().int().min(0),
  transitions: z.array(GeofenceTransitionSchema),
  recordedAt: z.string(),
});
export type EvaluateTripGeofenceResult = z.infer<typeof EvaluateTripGeofenceResultSchema>;

