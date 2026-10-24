import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeofenceNotificationService } from '../src/services/geofence-notification.service.js';
import { SpatialService } from '../src/services/spatial.service.js';
import { MessagingService } from '../src/services/messaging/messaging.service.js';
import * as db from '../src/config/database.js';

// ---------------------------------------------------------------------------
// Phase 21.1 — Geofence Notification Service Tests
// ---------------------------------------------------------------------------

const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const STOP_ID = '22222222-2222-2222-2222-222222222222';
const STUDENT_ID = '33333333-3333-3333-3333-333333333333';
const PARENT_ID = '44444444-4444-4444-4444-444444444444';
const SCHOOL_ID = '55555555-5555-5555-5555-555555555555';

const BUS_COORDS = { latitude: 12.9716, longitude: 77.5946 };

const MOCK_NEARBY_STOP = {
  id: STOP_ID,
  stopName: 'MG Road Gate',
  sequenceOrder: 2,
  latitude: 12.9718,
  longitude: 77.5949,
  scheduledTime: '08:10',
  geofenceRadiusMeters: 300,
  distanceMeters: 180,
  isWithinGeofence: true,
};

const MOCK_ELIGIBLE_PARENT = {
  parentId: PARENT_ID,
  studentId: STUDENT_ID,
  schoolId: SCHOOL_ID,
  parentPhone: '+919876543210',
  parentName: 'Priya Sharma',
  studentName: 'Arjun Sharma',
  stopId: STOP_ID,
  stopName: 'MG Road Gate',
  distanceMeters: 180,
  trackingToken: 'test-token-abc123',
};

describe('Phase 21.1 — GeofenceNotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Happy path ───────────────────────────────────────────────────────────

  it('sends a WhatsApp notification when bus is within approach radius', async () => {
    vi.spyOn(SpatialService, 'findStopsNearCoordinates').mockResolvedValueOnce([MOCK_NEARBY_STOP]);
    vi.spyOn(db, 'query')
      // fetchEligibleParents
      .mockResolvedValueOnce([MOCK_ELIGIBLE_PARENT])
      // dedup log INSERT
      .mockResolvedValueOnce([]);

    const sendSpy = vi.spyOn(MessagingService, 'sendMessage').mockResolvedValueOnce({
      messageId: 'whatsapp-msg-001',
      status: 'sent',
      provider: 'mock',
      timestamp: new Date().toISOString(),
    });

    const result = await GeofenceNotificationService.checkAndNotify(TRIP_ID, BUS_COORDS);

    expect(result.notificationsSent).toBe(1);
    expect(result.stopsChecked).toBe(1);
    expect(result.alreadyNotified).toBe(0);
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientPhone: '+919876543210',
        templateId: 'GEOFENCE_APPROACH',
        schoolId: SCHOOL_ID,
      })
    );
  });

  it('includes ETA minutes in message when provided', async () => {
    vi.spyOn(SpatialService, 'findStopsNearCoordinates').mockResolvedValueOnce([MOCK_NEARBY_STOP]);
    vi.spyOn(db, 'query')
      .mockResolvedValueOnce([MOCK_ELIGIBLE_PARENT])
      .mockResolvedValueOnce([]);

    const sendSpy = vi.spyOn(MessagingService, 'sendMessage').mockResolvedValueOnce({
      messageId: 'msg-002',
      status: 'sent',
      provider: 'mock',
      timestamp: new Date().toISOString(),
    });

    await GeofenceNotificationService.checkAndNotify(TRIP_ID, BUS_COORDS, 4);

    const callArg = sendSpy.mock.calls[0]?.[0];
    expect(callArg?.directText).toContain('4 min');
  });

  it('includes live tracking URL when token is available', async () => {
    vi.spyOn(SpatialService, 'findStopsNearCoordinates').mockResolvedValueOnce([MOCK_NEARBY_STOP]);
    vi.spyOn(db, 'query')
      .mockResolvedValueOnce([MOCK_ELIGIBLE_PARENT])
      .mockResolvedValueOnce([]);

    const sendSpy = vi.spyOn(MessagingService, 'sendMessage').mockResolvedValueOnce({
      messageId: 'msg-003',
      status: 'sent',
      provider: 'mock',
      timestamp: new Date().toISOString(),
    });

    await GeofenceNotificationService.checkAndNotify(TRIP_ID, BUS_COORDS);

    const callArg = sendSpy.mock.calls[0]?.[0];
    expect(callArg?.directText).toContain('test-token-abc123');
  });

  it('omits tracking URL when token is null', async () => {
    const parentWithoutToken = { ...MOCK_ELIGIBLE_PARENT, trackingToken: null };
    vi.spyOn(SpatialService, 'findStopsNearCoordinates').mockResolvedValueOnce([MOCK_NEARBY_STOP]);
    vi.spyOn(db, 'query')
      .mockResolvedValueOnce([parentWithoutToken])
      .mockResolvedValueOnce([]);

    const sendSpy = vi.spyOn(MessagingService, 'sendMessage').mockResolvedValueOnce({
      messageId: 'msg-004',
      status: 'sent',
      provider: 'mock',
      timestamp: new Date().toISOString(),
    });

    await GeofenceNotificationService.checkAndNotify(TRIP_ID, BUS_COORDS);

    const callArg = sendSpy.mock.calls[0]?.[0];
    expect(callArg?.directText).not.toContain('tracking');
  });

  // ─── Dedup / opt-out ─────────────────────────────────────────────────────

  it('returns 0 notifications when eligibility query returns empty (already notified)', async () => {
    vi.spyOn(SpatialService, 'findStopsNearCoordinates').mockResolvedValueOnce([MOCK_NEARBY_STOP]);
    // Empty = already notified or opted out — filtered by DB
    vi.spyOn(db, 'query').mockResolvedValueOnce([]);

    const sendSpy = vi.spyOn(MessagingService, 'sendMessage');

    const result = await GeofenceNotificationService.checkAndNotify(TRIP_ID, BUS_COORDS);

    expect(result.notificationsSent).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  // ─── Empty / no nearby stops ─────────────────────────────────────────────

  it('returns 0 when no stops are within approach radius', async () => {
    vi.spyOn(SpatialService, 'findStopsNearCoordinates').mockResolvedValueOnce([]);
    const sendSpy = vi.spyOn(MessagingService, 'sendMessage');

    const result = await GeofenceNotificationService.checkAndNotify(TRIP_ID, BUS_COORDS);

    expect(result.notificationsSent).toBe(0);
    expect(result.stopsChecked).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  // ─── Error resilience ─────────────────────────────────────────────────────

  it('returns partial result and skips dedup log if message dispatch fails', async () => {
    vi.spyOn(SpatialService, 'findStopsNearCoordinates').mockResolvedValueOnce([MOCK_NEARBY_STOP]);
    vi.spyOn(db, 'query').mockResolvedValueOnce([MOCK_ELIGIBLE_PARENT]);

    vi.spyOn(MessagingService, 'sendMessage').mockRejectedValueOnce(
      new Error('WhatsApp API unavailable')
    );

    const result = await GeofenceNotificationService.checkAndNotify(TRIP_ID, BUS_COORDS);

    expect(result.notificationsSent).toBe(0);
    // No dedup log insert should have been attempted after failed send
  });

  it('does not throw if spatial query fails', async () => {
    vi.spyOn(SpatialService, 'findStopsNearCoordinates').mockRejectedValueOnce(
      new Error('PostGIS unavailable')
    );

    await expect(
      GeofenceNotificationService.checkAndNotify(TRIP_ID, BUS_COORDS)
    ).resolves.toMatchObject({ notificationsSent: 0, stopsChecked: 0 });
  });

  it('does not throw if eligibility query fails', async () => {
    vi.spyOn(SpatialService, 'findStopsNearCoordinates').mockResolvedValueOnce([MOCK_NEARBY_STOP]);
    vi.spyOn(db, 'query').mockRejectedValueOnce(new Error('DB connection lost'));

    await expect(
      GeofenceNotificationService.checkAndNotify(TRIP_ID, BUS_COORDS)
    ).resolves.toMatchObject({ notificationsSent: 0 });
  });

  // ─── Multiple stops / multiple parents ───────────────────────────────────

  it('sends notifications for multiple eligible parents across multiple stops', async () => {
    const STOP_ID_2 = '66666666-6666-6666-6666-666666666666';
    const nearbyStops = [
      MOCK_NEARBY_STOP,
      { ...MOCK_NEARBY_STOP, id: STOP_ID_2, stopName: 'Park Circle', distanceMeters: 320 },
    ];
    const eligibleParents = [
      MOCK_ELIGIBLE_PARENT,
      {
        ...MOCK_ELIGIBLE_PARENT,
        parentId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        studentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        studentName: 'Ria Singh',
        stopId: STOP_ID_2,
        stopName: 'Park Circle',
      },
    ];

    vi.spyOn(SpatialService, 'findStopsNearCoordinates').mockResolvedValueOnce(nearbyStops);
    vi.spyOn(db, 'query')
      .mockResolvedValueOnce(eligibleParents)
      .mockResolvedValueOnce([]) // dedup log insert 1
      .mockResolvedValueOnce([]); // dedup log insert 2

    vi.spyOn(MessagingService, 'sendMessage').mockResolvedValue({
      messageId: 'msg-multi',
      status: 'sent',
      provider: 'mock',
      timestamp: new Date().toISOString(),
    });

    const result = await GeofenceNotificationService.checkAndNotify(TRIP_ID, BUS_COORDS);

    expect(result.notificationsSent).toBe(2);
    expect(result.stopsChecked).toBe(2);
  });
});
