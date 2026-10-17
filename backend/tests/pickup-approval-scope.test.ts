import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as db from '../src/config/database.js';
import { DynamicPickupService } from '../src/services/dynamic-pickup/dynamic-pickup.service.js';

describe('Pickup Scope Lock: No Mandatory School Approval for Normal Pickup (Task 2)', () => {
  const schoolId = '111e4567-e89b-12d3-a456-426614174001';
  const studentId = '444e4567-e89b-12d3-a456-426614174441';
  const pickupStopId = '888e4567-e89b-12d3-a456-426614174881';
  const routeId = '555e4567-e89b-12d3-a456-426614174555';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normal nearest-stop pickup assignment activates immediately without approval gate', async () => {
    const querySpy = vi.spyOn(db, 'query');

    // 1. Verify student exists
    querySpy.mockResolvedValueOnce([{ id: studentId, full_name: 'Aarav Sharma' }] as any);

    // 2. Verify pickup stop exists
    querySpy.mockResolvedValueOnce([
      {
        id: pickupStopId,
        stop_name: 'Main Gate Stop',
        scheduled_time: '07:30:00',
        route_id: routeId,
      },
    ] as any);

    // 3. Upsert into student_stop_assignments (directly activates immediately)
    let upsertSql = '';
    querySpy.mockImplementationOnce(async (sql: string, params?: any[]) => {
      upsertSql = sql;
      return [] as any;
    });

    // 4. Parent lookup for optional notification
    querySpy.mockResolvedValueOnce([
      { id: 'parent-1', full_name: 'Ramesh Sharma', phone: '+919876543210' },
    ] as any);

    const result = await DynamicPickupService.assignPickupToStudent({
      schoolId,
      studentId,
      pickupStopId,
      notifyParent: false,
    }, schoolId);

    expect(result.success).toBe(true);
    expect(result.studentId).toBe(studentId);
    expect(result.pickupStopId).toBe(pickupStopId);
    expect(result.pickupStopName).toBe('Main Gate Stop');

    // Verify SQL directly upserts without any approval status requirement
    expect(upsertSql).toContain('INSERT INTO student_stop_assignments');
    expect(upsertSql).not.toContain('PENDING_APPROVAL');
  });

  it('updating student pickup stop directly applies and does not block trip flow', async () => {
    const querySpy = vi.spyOn(db, 'query');

    // 1. Student lookup in updateStudentPickup
    querySpy.mockResolvedValueOnce([{ id: studentId, full_name: 'Aarav Sharma', school_id: schoolId }] as any);

    // 2. Student lookup in delegated assignPickupToStudent
    querySpy.mockResolvedValueOnce([{ id: studentId, full_name: 'Aarav Sharma' }] as any);

    // 3. Stop lookup in delegated assignPickupToStudent
    querySpy.mockResolvedValueOnce([
      {
        id: pickupStopId,
        stop_name: 'Main Gate Stop',
        scheduled_time: '07:30:00',
        route_id: routeId,
      },
    ] as any);

    // 4. Upsert in delegated assignPickupToStudent
    querySpy.mockResolvedValueOnce([] as any);

    // 5. Parent query in updateStudentPickup
    querySpy.mockResolvedValueOnce([
      { id: 'parent-1', full_name: 'Ramesh Sharma', phone: '+919876543210' },
    ] as any);

    const updateResult = await DynamicPickupService.updateStudentPickup({
      schoolId,
      studentId,
      pickupStopId,
      notifyParent: false,
    }, schoolId);

    expect(updateResult.success).toBe(true);
    expect(updateResult.pickupStopId).toBe(pickupStopId);
    expect(updateResult.pickupStopName).toBe('Main Gate Stop');
  });
});
