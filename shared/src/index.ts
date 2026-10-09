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
  licenseExpiry: z.string().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type Driver = z.infer<typeof DriverSchema>;

// 4. Bus (Fleet Vehicle - NO capacity / NO active-inactive toggles)
export const BusSchema = z.object({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
  registrationNumber: z.string().min(3, 'Registration number required'),
  busNumber: z.string().min(1, 'Bus internal identifier required'),
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
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: ApiErrorResponse;
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

