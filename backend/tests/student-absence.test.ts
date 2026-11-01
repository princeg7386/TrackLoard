/**
 * student-absence.test.ts — Phase 33.1: Student Not Going Today (Parent Flow)
 *
 * Tests:
 * 1. Date validation (YYYY-MM-DD format & past date rejection)
 * 2. Student & tenant verification (School tenant isolation)
 * 3. Idempotent absence recording (Full Day, Morning, Afternoon)
 * 4. WhatsApp confirmation dispatch
 * 5. Retrieval of active/upcoming absences for student
 * 6. Absence cancellation / withdrawal
 * 7. Parent WhatsApp inbound action handling for absence
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────
vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
vi.mock('../src/services/logger.service.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/services/messaging/messaging.service.js', () => ({
  MessagingService: {
    sendMessage: vi.fn().mockResolvedValue({ status: 'sent', messageId: 'msg-mock-123' }),
  },
}));

import { query } from '../src/config/database.js';
import { MessagingService } from '../src/services/messaging/messaging.service.js';
import { StudentAbsenceService } from '../src/services/student-absence.service.js';
import { ParentWhatsappService } from '../src/services/parent-whatsapp.service.js';
import { ParentWhatsAppAction } from '@school-bus/shared';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockSendMessage = MessagingService.sendMessage as unknown as ReturnType<typeof vi.fn>;

const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';
const STUDENT_ID = '22222222-2222-2222-2222-222222222222';
const PARENT_PHONE = '+919876543210';

describe('Phase 33.1 — Student Absence Service (Unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordAbsence', () => {
    it('rejects invalid date format', async () => {
      await expect(
        StudentAbsenceService.recordAbsence({
          schoolId: SCHOOL_ID,
          studentId: STUDENT_ID,
          absenceDate: '01-11-2026',
          reportedByPhone: PARENT_PHONE,
        })
      ).rejects.toThrow('Invalid date format. Expected YYYY-MM-DD');
    });

    it('rejects past dates', async () => {
      await expect(
        StudentAbsenceService.recordAbsence({
          schoolId: SCHOOL_ID,
          studentId: STUDENT_ID,
          absenceDate: '2020-01-01',
          reportedByPhone: PARENT_PHONE,
        })
      ).rejects.toThrow('Absence date cannot be in the past');
    });

    it('rejects if student does not exist or belongs to another school tenant', async () => {
      const today = new Date().toISOString().slice(0, 10);
      mockQuery.mockResolvedValueOnce([]); // No student found

      await expect(
        StudentAbsenceService.recordAbsence({
          schoolId: SCHOOL_ID,
          studentId: STUDENT_ID,
          absenceDate: today,
          reportedByPhone: PARENT_PHONE,
        })
      ).rejects.toThrow(/not found in this school/);
    });

    it('records absence for today with default FULL_DAY and dispatches WhatsApp alert', async () => {
      const today = new Date().toISOString().slice(0, 10);

      // 1. Mock student lookup
      mockQuery.mockResolvedValueOnce([
        {
          id: STUDENT_ID,
          full_name: 'Ananya Sharma',
          admission_number: 'ADM-2026-44',
          class_grade: '4',
          section: 'B',
        },
      ]);

      // 2. Mock insert/upsert
      mockQuery.mockResolvedValueOnce([
        {
          id: 'abs-1234-uuid',
          school_id: SCHOOL_ID,
          student_id: STUDENT_ID,
          absence_date: today,
          trip_type: 'FULL_DAY',
          reported_via: 'PARENT_WEB',
          reported_by_phone: PARENT_PHONE,
          reason: 'Fever and cold',
          driver_notified: false,
          created_at: new Date().toISOString(),
        },
      ]);

      const result = await StudentAbsenceService.recordAbsence({
        schoolId: SCHOOL_ID,
        studentId: STUDENT_ID,
        absenceDate: today,
        tripType: 'FULL_DAY',
        reportedVia: 'PARENT_WEB',
        reportedByPhone: PARENT_PHONE,
        reason: 'Fever and cold',
      });

      expect(result.id).toBe('abs-1234-uuid');
      expect(result.studentName).toBe('Ananya Sharma');
      expect(result.tripType).toBe('FULL_DAY');
      expect(result.absenceDate).toBe(today);
      expect(result.reportedVia).toBe('PARENT_WEB');

      // Verify WhatsApp confirmation dispatch was called
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientPhone: PARENT_PHONE,
          schoolId: SCHOOL_ID,
          directText: expect.stringContaining('Ananya Sharma'),
        })
      );
    });

    it('records morning pickup absence for tomorrow', async () => {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

      mockQuery.mockResolvedValueOnce([
        {
          id: STUDENT_ID,
          full_name: 'Ananya Sharma',
          admission_number: 'ADM-2026-44',
          class_grade: '4',
          section: 'B',
        },
      ]);

      mockQuery.mockResolvedValueOnce([
        {
          id: 'abs-5678-uuid',
          school_id: SCHOOL_ID,
          student_id: STUDENT_ID,
          absence_date: tomorrow,
          trip_type: 'MORNING',
          reported_via: 'PARENT_WEB',
          reported_by_phone: PARENT_PHONE,
          reason: 'Doctor appointment morning',
          driver_notified: false,
          created_at: new Date().toISOString(),
        },
      ]);

      const result = await StudentAbsenceService.recordAbsence({
        schoolId: SCHOOL_ID,
        studentId: STUDENT_ID,
        absenceDate: tomorrow,
        tripType: 'MORNING',
        reportedByPhone: PARENT_PHONE,
        reason: 'Doctor appointment morning',
      });

      expect(result.tripType).toBe('MORNING');
      expect(result.absenceDate).toBe(tomorrow);
    });
  });

  describe('getStudentAbsences', () => {
    it('retrieves active and upcoming absences for student', async () => {
      const today = new Date().toISOString().slice(0, 10);

      mockQuery.mockResolvedValueOnce([
        {
          id: 'abs-1',
          school_id: SCHOOL_ID,
          student_id: STUDENT_ID,
          student_name: 'Ananya Sharma',
          admission_number: 'ADM-2026-44',
          class_grade: '4',
          section: 'B',
          absence_date: today,
          trip_type: 'FULL_DAY',
          reported_via: 'PARENT_WEB',
          reported_by_phone: PARENT_PHONE,
          reason: 'Viral fever',
          driver_notified: false,
          created_at: new Date().toISOString(),
        },
      ]);

      const absences = await StudentAbsenceService.getStudentAbsences(SCHOOL_ID, STUDENT_ID);

      expect(absences).toHaveLength(1);
      expect(absences[0].studentName).toBe('Ananya Sharma');
      expect(absences[0].absenceDate).toBe(today);
    });
  });

  describe('cancelAbsence', () => {
    it('successfully withdraws an existing absence', async () => {
      const today = new Date().toISOString().slice(0, 10);

      mockQuery.mockResolvedValueOnce([
        {
          id: 'abs-1',
          absence_date: today,
          trip_type: 'FULL_DAY',
        },
      ]);

      const result = await StudentAbsenceService.cancelAbsence(SCHOOL_ID, STUDENT_ID, 'abs-1');

      expect(result.cancelled).toBe(true);
      expect(result.message).toContain('withdrawn');
    });

    it('throws NotFoundError if record does not exist or unauthorized', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await expect(
        StudentAbsenceService.cancelAbsence(SCHOOL_ID, STUDENT_ID, 'abs-non-existent')
      ).rejects.toThrow(/not found or unauthorized/);
    });
  });

  describe('Parent WhatsApp Action Parser & Inbound Intent', () => {
    it('recognizes "not going today", "absent", and "7" as NOT_GOING_TODAY action', () => {
      expect(ParentWhatsappService.parseParentAction('not going today')).toBe(
        ParentWhatsAppAction.NOT_GOING_TODAY
      );
      expect(ParentWhatsappService.parseParentAction('absent')).toBe(
        ParentWhatsAppAction.NOT_GOING_TODAY
      );
      expect(ParentWhatsappService.parseParentAction('7')).toBe(
        ParentWhatsAppAction.NOT_GOING_TODAY
      );
      expect(ParentWhatsappService.parseParentAction('leave today')).toBe(
        ParentWhatsAppAction.NOT_GOING_TODAY
      );
    });

    it('standard menu items include option 7 for NOT_GOING_TODAY', () => {
      const items = ParentWhatsappService.getStandardMenuItems();
      const option7 = items.find((i) => i.commandCode === '7');
      expect(option7).toBeDefined();
      expect(option7?.action).toBe(ParentWhatsAppAction.NOT_GOING_TODAY);
      expect(option7?.title).toBe('Not Going Today');
    });
  });
});
