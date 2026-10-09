import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  NotificationSchema,
  DelayRecordSchema,
  IncidentSchema,
  IncidentSeverity,
  IncidentStatus,
  SosEventSchema,
  SosStatus,
  TemporaryPickupRequestSchema,
  AbsenceRecordSchema,
  OperationalReportSchema,
  AuditLogSchema,
} from '@school-bus/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Operations & Safety Entities Schemas', () => {
  it('validates Notification schema with WhatsApp details', () => {
    const validNotification = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      recipientPhone: '+919876543210',
      recipientRole: 'PARENT' as const,
      channel: 'WHATSAPP' as const,
      templateName: 'bus_proximity_alert',
      messageBody: 'Your childs bus is 5 minutes away from Green Park stop.',
      status: 'SENT' as const,
    };
    const parsed = NotificationSchema.parse(validNotification);
    expect(parsed.recipientPhone).toBe('+919876543210');
    expect(parsed.channel).toBe('WHATSAPP');
  });

  it('validates DelayRecord schema with timestamps and delay duration', () => {
    const validDelay = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      tripId: '223e4567-e89b-12d3-a456-426614174001',
      expectedArrival: '2026-10-10T07:15:00.000Z',
      predictedArrival: '2026-10-10T07:27:00.000Z',
      delayMinutes: 12,
      reason: 'Ring Road heavy traffic congestion',
    };
    const parsed = DelayRecordSchema.parse(validDelay);
    expect(parsed.delayMinutes).toBe(12);
    expect(parsed.reason).toContain('traffic');
  });

  it('validates Incident and SOS emergency events', () => {
    const validIncident = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      incidentType: 'FLAT_TYRE',
      severity: IncidentSeverity.HIGH,
      status: IncidentStatus.OPEN,
      description: 'Rear right tyre punctured near AIIMS Flyover. Replacement underway.',
    };
    const parsedIncident = IncidentSchema.parse(validIncident);
    expect(parsedIncident.severity).toBe(IncidentSeverity.HIGH);
    expect(parsedIncident.status).toBe(IncidentStatus.OPEN);

    const validSos = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      tripId: '223e4567-e89b-12d3-a456-426614174001',
      busId: '323e4567-e89b-12d3-a456-426614174002',
      driverId: '423e4567-e89b-12d3-a456-426614174003',
      triggerSource: 'WHATSAPP_SOS' as const,
      latitude: 28.5672,
      longitude: 77.2100,
      speedKmh: 0,
      status: SosStatus.TRIGGERED,
    };
    const parsedSos = SosEventSchema.parse(validSos);
    expect(parsedSos.triggerSource).toBe('WHATSAPP_SOS');
    expect(parsedSos.status).toBe(SosStatus.TRIGGERED);
  });

  it('validates TemporaryPickupRequest and AbsenceRecord schemas', () => {
    const validTempPickup = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      studentId: '223e4567-e89b-12d3-a456-426614174001',
      requestedByPhone: '+919811223344',
      originalStopId: '323e4567-e89b-12d3-a456-426614174002',
      requestedStopId: '423e4567-e89b-12d3-a456-426614174003',
      effectiveDate: '2026-10-10',
      tripType: 'MORNING_PICKUP' as const,
      verifiedByCoordinator: true,
    };
    const parsedTempPickup = TemporaryPickupRequestSchema.parse(validTempPickup);
    expect(parsedTempPickup.verifiedByCoordinator).toBe(true);

    const validAbsence = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      studentId: '223e4567-e89b-12d3-a456-426614174001',
      absenceDate: '2026-10-10',
      tripType: 'FULL_DAY' as const,
      reportedVia: 'WHATSAPP' as const,
      reportedByPhone: '+919811223344',
      reason: 'Fever and doctor appointment',
    };
    const parsedAbsence = AbsenceRecordSchema.parse(validAbsence);
    expect(parsedAbsence.reportedVia).toBe('WHATSAPP');
  });

  it('validates AuditLog schema and tenant isolation tracking', () => {
    const validAudit = {
      schoolId: '123e4567-e89b-12d3-a456-426614174000',
      userRole: 'TRANSPORT_COORDINATOR',
      action: 'TEMPORARY_STOP_APPROVED',
      entityType: 'TemporaryPickupRequest',
      entityId: '523e4567-e89b-12d3-a456-426614174004',
      diffJson: { status: 'APPROVED', effectiveDate: '2026-10-10' },
      ipAddress: '103.21.124.5',
    };
    const parsedAudit = AuditLogSchema.parse(validAudit);
    expect(parsedAudit.action).toBe('TEMPORARY_STOP_APPROVED');
  });

  it('verifies migration 003_operations_entities.sql exists and contains required tables and indexes', () => {
    const migrationPath = path.join(
      __dirname,
      '../src/db/migrations/003_operations_entities.sql'
    );
    expect(fs.existsSync(migrationPath)).toBe(true);

    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS notifications');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS delays');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS incidents');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS sos_events');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS temporary_pickup_requests');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS absence_records');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS reports');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS audit_logs');
  });
});
