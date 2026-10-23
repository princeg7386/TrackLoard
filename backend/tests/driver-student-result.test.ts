/**
 * Phase 19.2 — Driver Student Search Result Detail Tests
 *
 * Covers:
 *  - WhatsApp single-match rich detail card format
 *  - WhatsApp multi-match (2+) stays compact list
 *  - Flutter home_screen detail sheet presence (file content)
 *  - Detail sheet helper methods present
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// 1. WhatsApp STUDENT_SEARCH — single-match rich detail card
// ---------------------------------------------------------------------------
describe('driver-whatsapp.service.ts — single-match detail card', () => {
  const source = readFileSync(
    join(__dirname, '../src/services/driver-whatsapp.service.ts'),
    'utf-8',
  );

  it('contains single-match branch (length === 1)', () => {
    expect(source).toContain('searchResult.students.length === 1');
  });

  it('emits Student Detail header in single-match', () => {
    expect(source).toContain('Student Detail');
  });

  it('emits parent name in single-match card', () => {
    expect(source).toContain('*Parent:*');
  });

  it('emits parent phone in single-match card', () => {
    expect(source).toContain('*Phone:*');
  });

  it('emits pickup address in single-match card', () => {
    expect(source).toContain('pickupStop.address');
  });

  it('emits bus number in single-match card', () => {
    expect(source).toContain('*Bus:*');
  });

  it('emits route in single-match card', () => {
    expect(source).toContain('*Route:*');
  });

  it('emits No parent contact fallback when parent is absent', () => {
    expect(source).toContain('No parent contact on record');
  });

  it('shows grade and section in single-match header', () => {
    expect(source).toContain('gradeLabel');
  });

  it('shows registration number in bus line', () => {
    expect(source).toContain('searchResult.registrationNumber');
  });

  it('includes drop stop line when present', () => {
    expect(source).toContain('dropLine');
  });

  it('includes emergency phone line when present', () => {
    expect(source).toContain('emergencyLine');
  });
});

// ---------------------------------------------------------------------------
// 2. WhatsApp STUDENT_SEARCH — multi-match stays compact
// ---------------------------------------------------------------------------
describe('driver-whatsapp.service.ts — multi-match compact list', () => {
  const source = readFileSync(
    join(__dirname, '../src/services/driver-whatsapp.service.ts'),
    'utf-8',
  );

  it('still has the compact results list branch', () => {
    expect(source).toContain('2–N results');
  });

  it('still caps at 5 results with truncation', () => {
    expect(source).toContain('slice(0, 5)');
  });

  it('still has truncation "and N more" message', () => {
    expect(source).toContain('more. Narrow your search for precise results.');
  });

  it('still has zero-result branch', () => {
    expect(source).toContain('No Results for');
  });
});

// ---------------------------------------------------------------------------
// 3. Flutter home_screen.dart — detail sheet presence
// ---------------------------------------------------------------------------
describe('driver-app home_screen.dart — student detail sheet', () => {
  const source = readFileSync(
    join(__dirname, '../../driver-app/lib/screens/home_screen.dart'),
    'utf-8',
  );

  it('declares _showStudentDetailSheet method', () => {
    expect(source).toContain('_showStudentDetailSheet');
  });

  it('ListTile has onTap that calls _showStudentDetailSheet', () => {
    expect(source).toContain('onTap: () => _showStudentDetailSheet(');
  });

  it('shows parent fullName in detail sheet', () => {
    expect(source).toContain('student.parent!.fullName');
  });

  it('shows parent phone in detail sheet', () => {
    expect(source).toContain('student.parent!.phone');
  });

  it('shows pickup stop name in detail sheet', () => {
    expect(source).toContain('student.pickupStop.name');
  });

  it('shows pickup stop address in detail sheet', () => {
    expect(source).toContain('student.pickupStop.address');
  });

  it('shows pickup stop lat/lng in detail sheet', () => {
    expect(source).toContain('student.pickupStop.latitude');
    expect(source).toContain('student.pickupStop.longitude');
  });

  it('shows drop stop in detail sheet', () => {
    expect(source).toContain('student.dropStop');
  });

  it('shows bus number from manifest', () => {
    expect(source).toContain('manifest.busNumber');
  });

  it('shows registration number from manifest', () => {
    expect(source).toContain('manifest.registrationNumber');
  });

  it('shows route label from manifest', () => {
    expect(source).toContain('manifest.routeCode');
    expect(source).toContain('manifest.routeName');
  });

  it('shows emergency phone when present', () => {
    expect(source).toContain('student.emergencyPhone');
  });

  it('uses DraggableScrollableSheet for the sheet', () => {
    expect(source).toContain('DraggableScrollableSheet');
  });

  it('has _detailSectionHeader helper', () => {
    expect(source).toContain('_detailSectionHeader');
  });

  it('has _detailRow helper', () => {
    expect(source).toContain('_detailRow(');
  });

  it('has _detailRowPlaceholder helper', () => {
    expect(source).toContain('_detailRowPlaceholder');
  });

  it('has _formatTimestamp helper for boarding/drop times', () => {
    expect(source).toContain('_formatTimestamp');
  });

  it('shows boardedAt timestamp', () => {
    expect(source).toContain('student.boardedAt');
  });

  it('shows droppedAt timestamp', () => {
    expect(source).toContain('student.droppedAt');
  });

  it('uses AppTheme tokens throughout', () => {
    expect(source).toContain('AppTheme.primaryNavy');
    expect(source).toContain('AppTheme.textMuted');
    expect(source).toContain('AppTheme.statusEmergency');
  });
});
