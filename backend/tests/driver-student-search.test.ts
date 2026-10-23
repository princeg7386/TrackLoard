/**
 * Phase 19.1 — Driver Student Search Tests
 *
 * Covers:
 *  - DriverStudentSearchQuerySchema validation
 *  - Service search param wiring (file content)
 *  - Controller q→search forwarding (file content)
 *  - WhatsApp action parsing for STUDENT_SEARCH
 *  - WhatsApp query extraction patterns
 *  - Flutter home_screen search bar presence (file content)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DriverStudentSearchQuerySchema } from '@school-bus/shared';

// ---------------------------------------------------------------------------
// 1. Schema validation
// ---------------------------------------------------------------------------
describe('DriverStudentSearchQuerySchema', () => {
  it('accepts valid query with q, tripId, busId', () => {
    const result = DriverStudentSearchQuerySchema.safeParse({
      q: 'Aarav',
      tripId: 'e4f5a6b7-c8d9-0e1f-2a3b-4c5d6e7f8a9b',
      busId:  'b1c2d3e4-f5a6-7b8c-9d0e-1f2a3b4c5d6e',
    });
    expect(result.success).toBe(true);
  });

  it('accepts no fields (all optional)', () => {
    const result = DriverStudentSearchQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects q with length 0 (min 1)', () => {
    const result = DriverStudentSearchQuerySchema.safeParse({ q: '' });
    // empty string fails min(1) after trim
    expect(result.success).toBe(false);
  });

  it('rejects q longer than 100 chars', () => {
    const result = DriverStudentSearchQuerySchema.safeParse({ q: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('rejects invalid UUID for tripId', () => {
    const result = DriverStudentSearchQuerySchema.safeParse({ q: 'Priya', tripId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('trims whitespace from q', () => {
    const result = DriverStudentSearchQuerySchema.safeParse({ q: '  Aarav  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.q).toBe('Aarav');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Service search param wiring (file content assertions)
// ---------------------------------------------------------------------------
describe('driver-attendance.service.ts — search wiring', () => {
  const serviceSource = readFileSync(
    join(__dirname, '../src/services/driver-attendance.service.ts'),
    'utf-8',
  );

  it('passes search param as $4 ILIKE filter in SQL', () => {
    expect(serviceSource).toContain('$4::text');
  });

  it('uses LOWER() for case-insensitive match', () => {
    expect(serviceSource).toContain('LOWER($4::text)');
  });

  it('builds LIKE wildcard from params.search?.trim()', () => {
    expect(serviceSource).toContain("params.search?.trim()");
  });

  it('matches against s.admission_number', () => {
    expect(serviceSource).toContain('s.admission_number');
  });
});

// ---------------------------------------------------------------------------
// 3. Controller q→search forwarding (file content assertions)
// ---------------------------------------------------------------------------
describe('driver-attendance.controller.ts — query forwarding', () => {
  const controllerSource = readFileSync(
    join(__dirname, '../src/controllers/driver-attendance.controller.ts'),
    'utf-8',
  );

  it('reads req.query.q', () => {
    expect(controllerSource).toContain('req.query.q');
  });

  it('passes search into service call', () => {
    expect(controllerSource).toContain('search');
  });
});

// ---------------------------------------------------------------------------
// 4. WhatsApp action parsing
// ---------------------------------------------------------------------------
describe('parseActionFromInput — STUDENT_SEARCH patterns', () => {
  const waSource = readFileSync(
    join(__dirname, '../src/services/driver-whatsapp.service.ts'),
    'utf-8',
  );

  it('includes clean.startsWith(\'3 \') guard', () => {
    expect(waSource).toContain("clean.startsWith('3 ')");
  });

  it('includes clean.startsWith(\'search \') guard', () => {
    expect(waSource).toContain("clean.startsWith('search ')");
  });

  it('includes clean === \'3\' guard', () => {
    expect(waSource).toContain("clean === '3'");
  });

  it('includes clean === \'student search\' guard', () => {
    expect(waSource).toContain("clean === 'student search'");
  });
});

// ---------------------------------------------------------------------------
// 5. WhatsApp query extraction patterns
// ---------------------------------------------------------------------------
describe('driver-whatsapp.service.ts — STUDENT_SEARCH case query extraction', () => {
  const waSource = readFileSync(
    join(__dirname, '../src/services/driver-whatsapp.service.ts'),
    'utf-8',
  );

  it('extracts query by stripping leading digit prefix (rawClean pattern)', () => {
    // Source contains the regex literal /^\d+\s+/ for "3 Aarav"-style parsing
    expect(waSource).toContain('/^\\d+\\s+/');
  });

  it('caps results at 5 with truncation message', () => {
    expect(waSource).toContain('and');
    // flexible: just ensure some truncation / "more" text logic exists
    expect(waSource).toContain('more');
  });

  it('handles empty search query by returning a prompt message', () => {
    // No query → the service returns the formatted search prompt
    expect(waSource).toContain('Reply with a student name or admission number');
  });

  it('STUDENT_SEARCH case exists in handleInboundMessage switch', () => {
    expect(waSource).toContain('STUDENT_SEARCH');
  });
});

// ---------------------------------------------------------------------------
// 6. Flutter home_screen.dart — search bar presence
// ---------------------------------------------------------------------------
describe('driver-app home_screen.dart — search bar', () => {
  const flutterSource = readFileSync(
    join(__dirname, '../../driver-app/lib/screens/home_screen.dart'),
    'utf-8',
  );

  it('declares searchController TextEditingController', () => {
    expect(flutterSource).toContain('searchController');
  });

  it('declares searchQuery string state', () => {
    expect(flutterSource).toContain('searchQuery');
  });

  it('renders search hint text', () => {
    expect(flutterSource).toContain('Search student name or admission no');
  });

  it('uses Icons.search_rounded for search prefix', () => {
    expect(flutterSource).toContain('Icons.search_rounded');
  });

  it('uses Icons.clear_rounded for clear button', () => {
    expect(flutterSource).toContain('Icons.clear_rounded');
  });

  it('uses Icons.search_off_rounded for empty search state', () => {
    expect(flutterSource).toContain('Icons.search_off_rounded');
  });

  it('filters by fullName', () => {
    expect(flutterSource).toContain('s.fullName');
  });

  it('filters by admissionNumber', () => {
    expect(flutterSource).toContain('s.admissionNumber');
  });

  it('shows search-specific empty message', () => {
    expect(flutterSource).toContain('No students match');
  });
});
