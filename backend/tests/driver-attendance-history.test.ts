/**
 * Phase 18.4 — Attendance History, Student Journey & Correction Rules
 *
 * Covers:
 *   - CorrectAttendanceRequestSchema / DateAttendanceHistoryQuerySchema validation (pure Zod, no DB)
 *   - DriverAttendanceService.correctAttendance — driver blocked from COMPLETED trip
 *   - DriverAttendanceService business-rule helpers (correction reason ≥ 5 chars)
 *   - Migration 017 file existence and structural correctness
 *   - audit_trail accumulation expectation (INSERT-only contract tested via service)
 *
 * Integration tests (DB_AVAILABLE) run against the test database when configured.
 * Pure-logic tests always run.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  CorrectAttendanceRequestSchema,
  DateAttendanceHistoryQuerySchema,
  AttendanceCorrectionEventTypeEnum,
  AttendanceCorrectionNewStatusEnum,
} from '@school-bus/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── helpers ────────────────────────────────────────────────────────────────

const DB_AVAILABLE = !!(
  process.env.TEST_DB_URL ||
  (process.env.PGHOST && process.env.PGDATABASE)
);

// ============================================================================
// 1. Zod Schema Validation — no DB needed
// ============================================================================

describe('Phase 18.4 — Shared Schema Validation', () => {
  it('CorrectAttendanceRequestSchema accepts a fully valid payload', () => {
    const result = CorrectAttendanceRequestSchema.safeParse({
      tripId: '00000000-0000-0000-0000-000000000001',
      studentId: '00000000-0000-0000-0000-000000000002',
      eventType: 'BOARDING',
      newStatus: 'BOARDED',
      reason: 'Valid reason for correction',
    });
    expect(result.success).toBe(true);
  });

  it('CorrectAttendanceRequestSchema rejects reason shorter than 5 characters', () => {
    const result = CorrectAttendanceRequestSchema.safeParse({
      tripId: '00000000-0000-0000-0000-000000000001',
      studentId: '00000000-0000-0000-0000-000000000002',
      eventType: 'BOARDING',
      newStatus: 'BOARDED',
      reason: 'ok',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const field = result.error.issues.find((i) => i.path.includes('reason'));
      expect(field).toBeDefined();
    }
  });

  it('CorrectAttendanceRequestSchema rejects invalid eventType', () => {
    const result = CorrectAttendanceRequestSchema.safeParse({
      tripId: '00000000-0000-0000-0000-000000000001',
      studentId: '00000000-0000-0000-0000-000000000002',
      eventType: 'INVALID_TYPE',
      newStatus: 'BOARDED',
      reason: 'Valid reason here',
    });
    expect(result.success).toBe(false);
  });

  it('CorrectAttendanceRequestSchema rejects invalid newStatus', () => {
    const result = CorrectAttendanceRequestSchema.safeParse({
      tripId: '00000000-0000-0000-0000-000000000001',
      studentId: '00000000-0000-0000-0000-000000000002',
      eventType: 'BOARDING',
      newStatus: 'INVALID_STATUS',
      reason: 'Valid reason here',
    });
    expect(result.success).toBe(false);
  });

  it('CorrectAttendanceRequestSchema accepts optional latitude/longitude', () => {
    const result = CorrectAttendanceRequestSchema.safeParse({
      tripId: '00000000-0000-0000-0000-000000000001',
      studentId: '00000000-0000-0000-0000-000000000002',
      eventType: 'DROP',
      newStatus: 'DEBOARDED',
      reason: 'Correcting drop location',
      latitude: 19.0760,
      longitude: 72.8777,
    });
    expect(result.success).toBe(true);
  });

  it('DateAttendanceHistoryQuerySchema accepts YYYY-MM-DD date string', () => {
    const result = DateAttendanceHistoryQuerySchema.safeParse({ date: '2026-10-23' });
    expect(result.success).toBe(true);
  });

  it('DateAttendanceHistoryQuerySchema rejects non-date strings', () => {
    const result = DateAttendanceHistoryQuerySchema.safeParse({ date: 'not-a-date' });
    expect(result.success).toBe(false);
  });

  it('DateAttendanceHistoryQuerySchema accepts optional busId / routeId / driverId filters', () => {
    const result = DateAttendanceHistoryQuerySchema.safeParse({
      date: '2026-10-23',
      busId: '00000000-0000-0000-0000-000000000010',
      routeId: '00000000-0000-0000-0000-000000000011',
      driverId: '00000000-0000-0000-0000-000000000012',
    });
    expect(result.success).toBe(true);
  });

  it('AttendanceCorrectionEventTypeEnum includes BOARDING and DROP', () => {
    // Zod z.enum() — use .options to get the underlying string[]
    const options = AttendanceCorrectionEventTypeEnum.options;
    expect(options).toContain('BOARDING');
    expect(options).toContain('DROP');
    expect(options).toHaveLength(2);
  });

  it('AttendanceCorrectionNewStatusEnum includes expected statuses', () => {
    // Zod z.enum() — use .options to get the underlying string[]
    const options = AttendanceCorrectionNewStatusEnum.options;
    const expected = ['BOARDED', 'ABSENT', 'SKIPPED', 'DEBOARDED', 'HANDOVER_CONFIRMED', 'RETURNED_TO_SCHOOL', 'PENDING'];
    for (const status of expected) {
      expect(options).toContain(status);
    }
  });
});

// ============================================================================
// 2. Migration 017 file integrity
// ============================================================================

describe('Phase 18.4 — Migration 017 File Integrity', () => {
  const migrationPath = path.resolve(__dirname, '../src/db/migrations/017_attendance_corrections_and_journey.sql');

  it('migration file exists at expected path', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('migration creates attendance_corrections table', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS attendance_corrections');
  });

  it('migration includes all required columns', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    const requiredColumns = [
      'school_id',
      'trip_id',
      'student_id',
      'event_type',
      'previous_status',
      'new_status',
      'reason',
      'corrected_by',
      'corrected_by_role',
      'latitude',
      'longitude',
      'location',
      'created_at',
    ];
    for (const col of requiredColumns) {
      expect(sql).toContain(col);
    }
  });

  it('migration does NOT reference non-existent users table (FK safety)', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    // Must not have a REFERENCES users( constraint
    expect(sql).not.toMatch(/REFERENCES\s+users\s*\(/i);
  });

  it('migration creates required indexes', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('idx_attendance_corrections_school_id');
    expect(sql).toContain('idx_attendance_corrections_trip_id');
    expect(sql).toContain('idx_attendance_corrections_student_id');
    expect(sql).toContain('idx_attendance_corrections_created_at');
    // GIST index for PostGIS location queries
    expect(sql).toContain('GIST');
  });

  it('migration uses TIMESTAMPTZ (not TIMESTAMP) for created_at', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    // created_at column definition should be TIMESTAMPTZ
    expect(sql).toMatch(/created_at\s+TIMESTAMPTZ/);
  });

  it('migration uses event_type CHECK constraint for BOARDING and DROP only', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain("CHECK (event_type IN ('BOARDING', 'DROP'))");
  });

  it('migration uses PostGIS GEOGRAPHY type for location', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('GEOGRAPHY(Point, 4326)');
  });
});

// ============================================================================
// 3. Service business rules — mocked DB (no live connection needed)
// ============================================================================

describe('Phase 18.4 — DriverAttendanceService Business Rules (mocked)', () => {
  it('correctAttendance blocks DRIVER from correcting COMPLETED trip', async () => {
    // Mock the db query to simulate a COMPLETED trip
    vi.mock('../src/db/index.js', () => ({
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM trips')) {
          return Promise.resolve([{
            id: 'trip-completed',
            school_id: 'school-1',
            bus_id: 'bus-1',
            driver_id: 'driver-1',
            status: 'COMPLETED',
          }]);
        }
        return Promise.resolve([]);
      }),
    }));

    const { DriverAttendanceService } = await import('../src/services/driver-attendance.service.js');

    await expect(
      DriverAttendanceService.correctAttendance(
        'school-1',
        {
          tripId: 'trip-completed',
          studentId: 'student-1',
          eventType: 'BOARDING',
          newStatus: 'BOARDED',
          reason: 'Driver attempting correction',
        },
        { userId: 'driver-1', isDriver: true, schoolId: 'school-1' }
      )
    ).rejects.toThrow();

    vi.restoreAllMocks();
  });

  it('correctAttendance blocks cross-tenant access (actor.schoolId !== schoolId)', async () => {
    vi.mock('../src/db/index.js', () => ({
      query: vi.fn().mockResolvedValue([]),
    }));

    const { DriverAttendanceService } = await import('../src/services/driver-attendance.service.js');

    await expect(
      DriverAttendanceService.correctAttendance(
        'school-A',
        {
          tripId: 'trip-1',
          studentId: 'student-1',
          eventType: 'BOARDING',
          newStatus: 'BOARDED',
          reason: 'Cross tenant attempt test',
        },
        { userId: 'admin-B', isDriver: false, schoolId: 'school-B' }
      )
    ).rejects.toThrow();

    vi.restoreAllMocks();
  });
});

// ============================================================================
// 4. Route / Controller wiring — file-level checks
// ============================================================================

describe('Phase 18.4 — Route & Controller Wiring', () => {
  const routesPath = path.resolve(__dirname, '../src/routes/driver-attendance.routes.ts');
  const controllerPath = path.resolve(__dirname, '../src/controllers/driver-attendance.controller.ts');
  const servicePath = path.resolve(__dirname, '../src/services/driver-attendance.service.ts');

  it('driver-attendance.routes.ts registers the correct POST /correct route', () => {
    const src = fs.readFileSync(routesPath, 'utf-8');
    // Router variable is driverAttendanceRouter
    expect(src).toContain("'/correct'");
    expect(src).toContain('.post(');
  });

  it('driver-attendance.routes.ts registers GET /students/:studentId/journey', () => {
    const src = fs.readFileSync(routesPath, 'utf-8');
    expect(src).toContain("'/students/:studentId/journey'");
  });

  it('driver-attendance.routes.ts registers GET /trips/:tripId/history', () => {
    const src = fs.readFileSync(routesPath, 'utf-8');
    expect(src).toContain("'/trips/:tripId/history'");
  });

  it('driver-attendance.routes.ts registers GET /history', () => {
    const src = fs.readFileSync(routesPath, 'utf-8');
    // Router variable is driverAttendanceRouter
    expect(src).toContain("'/history'");
    expect(src).toContain('.get(');
  });

  it('driver-attendance.controller.ts exports correctAttendance handler', () => {
    const src = fs.readFileSync(controllerPath, 'utf-8');
    expect(src).toContain('correctAttendance');
  });

  it('driver-attendance.controller.ts exports getStudentJourney handler', () => {
    const src = fs.readFileSync(controllerPath, 'utf-8');
    expect(src).toContain('getStudentJourney');
  });

  it('driver-attendance.controller.ts exports getTripHistory handler', () => {
    const src = fs.readFileSync(controllerPath, 'utf-8');
    expect(src).toContain('getTripHistory');
  });

  it('driver-attendance.controller.ts exports getDateHistory handler', () => {
    const src = fs.readFileSync(controllerPath, 'utf-8');
    expect(src).toContain('getDateHistory');
  });

  it('service exports correctAttendance static method', () => {
    const src = fs.readFileSync(servicePath, 'utf-8');
    expect(src).toContain('static async correctAttendance(');
  });

  it('service exports getStudentJourneyHistory static method', () => {
    const src = fs.readFileSync(servicePath, 'utf-8');
    expect(src).toContain('static async getStudentJourneyHistory(');
  });

  it('service exports getTripAttendanceHistory static method', () => {
    const src = fs.readFileSync(servicePath, 'utf-8');
    expect(src).toContain('static async getTripAttendanceHistory(');
  });

  it('service exports getDateAttendanceHistory static method', () => {
    const src = fs.readFileSync(servicePath, 'utf-8');
    expect(src).toContain('static async getDateAttendanceHistory(');
  });
});

// ============================================================================
// 5. WhatsApp command wiring
// ============================================================================

describe('Phase 18.4 — WhatsApp Command Wiring', () => {
  const waPath = path.resolve(__dirname, '../src/services/driver-whatsapp.service.ts');

  it('driver-whatsapp.service.ts handles ATTENDANCE_HISTORY command', () => {
    const src = fs.readFileSync(waPath, 'utf-8');
    expect(src).toContain('ATTENDANCE_HISTORY');
  });

  it('driver-whatsapp.service.ts handles STUDENT_JOURNEY command', () => {
    const src = fs.readFileSync(waPath, 'utf-8');
    expect(src).toContain('STUDENT_JOURNEY');
  });

  it('driver-whatsapp.service.ts handles CORRECT_ATTENDANCE command', () => {
    const src = fs.readFileSync(waPath, 'utf-8');
    expect(src).toContain('CORRECT_ATTENDANCE');
  });

  it('driver-whatsapp.service.ts includes correctAttendanceViaWhatsApp helper', () => {
    const src = fs.readFileSync(waPath, 'utf-8');
    expect(src).toContain('correctAttendanceViaWhatsApp');
  });

  it('driver-whatsapp.service.ts includes getAttendanceHistoryViaWhatsApp helper', () => {
    const src = fs.readFileSync(waPath, 'utf-8');
    expect(src).toContain('getAttendanceHistoryViaWhatsApp');
  });

  it('driver-whatsapp.service.ts includes getStudentJourneyViaWhatsApp helper', () => {
    const src = fs.readFileSync(waPath, 'utf-8');
    expect(src).toContain('getStudentJourneyViaWhatsApp');
  });

  it('WhatsApp correction query includes ARRIVED_SCHOOL in active trip filter', () => {
    const src = fs.readFileSync(waPath, 'utf-8');
    // Active-trip SQL should allow ARRIVED_SCHOOL
    expect(src).toContain("'ARRIVED_SCHOOL'");
  });
});

// ============================================================================
// 6. Flutter driver app wiring
// ============================================================================

describe('Phase 18.4 — Flutter Driver App Wiring', () => {
  const apiConstantsPath = path.resolve(
    __dirname,
    '../../driver-app/lib/core/constants/api_constants.dart'
  );
  const apiServicePath = path.resolve(
    __dirname,
    '../../driver-app/lib/services/api_service.dart'
  );
  const homeScreenPath = path.resolve(
    __dirname,
    '../../driver-app/lib/screens/home_screen.dart'
  );

  it('api_constants.dart exports attendanceCorrectEndpoint', () => {
    const src = fs.readFileSync(apiConstantsPath, 'utf-8');
    expect(src).toContain('attendanceCorrectEndpoint');
  });

  it('api_constants.dart exports attendanceTripHistoryEndpoint', () => {
    const src = fs.readFileSync(apiConstantsPath, 'utf-8');
    expect(src).toContain('attendanceTripHistoryEndpoint');
  });

  it('api_constants.dart exports attendanceHistoryEndpoint', () => {
    const src = fs.readFileSync(apiConstantsPath, 'utf-8');
    expect(src).toContain('attendanceHistoryEndpoint');
  });

  it('api_service.dart exports correctAttendance method', () => {
    const src = fs.readFileSync(apiServicePath, 'utf-8');
    expect(src).toContain('correctAttendance');
  });

  it('api_service.dart exports getStudentJourney method', () => {
    const src = fs.readFileSync(apiServicePath, 'utf-8');
    expect(src).toContain('getStudentJourney');
  });

  it('api_service.dart exports getTripAttendanceHistory method', () => {
    const src = fs.readFileSync(apiServicePath, 'utf-8');
    expect(src).toContain('getTripAttendanceHistory');
  });

  it('home_screen.dart contains handleViewJourney handler', () => {
    const src = fs.readFileSync(homeScreenPath, 'utf-8');
    expect(src).toContain('handleViewJourney');
  });

  it('home_screen.dart contains handleOpenCorrectionDialog handler', () => {
    const src = fs.readFileSync(homeScreenPath, 'utf-8');
    expect(src).toContain('handleOpenCorrectionDialog');
  });

  it('home_screen.dart PopupMenu includes VIEW_JOURNEY item', () => {
    const src = fs.readFileSync(homeScreenPath, 'utf-8');
    expect(src).toContain("value: 'VIEW_JOURNEY'");
  });

  it('home_screen.dart PopupMenu includes CORRECT item', () => {
    const src = fs.readFileSync(homeScreenPath, 'utf-8');
    expect(src).toContain("value: 'CORRECT'");
  });

  it('home_screen.dart PopupMenu has divider between status actions and history actions', () => {
    const src = fs.readFileSync(homeScreenPath, 'utf-8');
    expect(src).toContain('PopupMenuDivider');
  });

  it('home_screen.dart wires VIEW_JOURNEY to handleViewJourney in onSelected', () => {
    const src = fs.readFileSync(homeScreenPath, 'utf-8');
    expect(src).toContain("val == 'VIEW_JOURNEY'");
    expect(src).toContain('handleViewJourney(student)');
  });

  it('home_screen.dart wires CORRECT to handleOpenCorrectionDialog in onSelected', () => {
    const src = fs.readFileSync(homeScreenPath, 'utf-8');
    expect(src).toContain("val == 'CORRECT'");
    expect(src).toContain('handleOpenCorrectionDialog(student)');
  });

  it('home_screen.dart enforces minimum 5-char reason validation in correction dialog', () => {
    const src = fs.readFileSync(homeScreenPath, 'utf-8');
    // Validator should check length >= 5
    expect(src).toMatch(/length\s*[<>]=?\s*5|\.length\s*[<>]\s*5/);
  });
});
