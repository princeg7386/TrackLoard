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
