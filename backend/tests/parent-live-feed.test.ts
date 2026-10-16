import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { RealtimeFeedService } from '../src/services/realtime-feed.service.js';
import { ParentIdentityService } from '../src/services/parent-identity.service.js';
import { UnauthorizedError } from '../src/middlewares/error.middleware.js';
import { ParentLiveTrackingSession } from '@school-bus/shared';

/**
 * Phase 12.4 — Parent Live Bus Feed (SSE stream, token-scoped, offline handling)
 * Tests for GET /api/v1/parent/track/:token/feed
 *
 * Auth: authenticateParentTrackingToken (parent tracking token — no admin JWT)
 * Scope: strictly the single bus/trip linked to the parent's student session.
 */
describe('Phase 12.4 — Parent Live Bus Feed (SSE Stream)', () => {
  const app = createApp();

  const VALID_TOKEN = 'trk_valid_test_token_abc12345';
  const INVALID_TOKEN = 'trk_invalid_bad_token_xyz99999';
  const NO_TRIP_TOKEN = 'trk_no_trip_test_token_def67890';

  const schoolId = 'school-feed-0000-0000-0000-000000000001';
  const tripId = 'trip-feed-0000-0000-0000-000000000001';
  const busId = 'bus-feed-00000-0000-0000-000000000001';
  const studentId = 'stud-feed-0000-0000-0000-000000000001';
  const parentId = 'par-feed-00000-0000-0000-000000000001';

  const mockSessionWithTrip: ParentLiveTrackingSession = {
    isValid: true,
    expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
    tokenPrefix: 'trk_valid',
    parent: {
      id: parentId,
      fullName: 'Priya Sharma',
      relationship: 'MOTHER',
      phone: '+919876500001',
    },
    student: {
      id: studentId,
      fullName: 'Arjun Sharma',
      admissionNumber: 'ADM-2026-0099',
      classGrade: 'Class 7',
      section: 'B',
      rollNumber: '22',
      emergencyContactPhone: '+919876500001',
    },
    school: {
      id: schoolId,
      name: 'Test Public School',
      code: 'TPS-ND',
      timezone: 'Asia/Kolkata',
    },
    pickupStop: {
      id: 'stop-feed-01',
      stopName: 'Sector 12 Gate',
      sequenceOrder: 3,
      scheduledTime: '07:45:00',
      latitude: 28.6200,
      longitude: 77.2100,
      geofenceRadiusMeters: 250,
    },
    activeTrip: {
      id: tripId,
      busId,
      busNumber: 'Bus 04 (South)',
      routeName: 'Route South Morning',
      driverName: 'Ramesh Kumar',
      driverPhone: '+919811200042',
      status: 'IN_TRANSIT',
      delayMinutes: 0,
      lastGpsLocation: {
        latitude: 28.6180,
        longitude: 77.2090,
        speedKmh: 28.5,
        bearingDegrees: 190,
        recordedAt: new Date().toISOString(),
      },
    },
  };

  const mockSessionNoTrip: ParentLiveTrackingSession = {
    ...mockSessionWithTrip,
    tokenPrefix: 'trk_no_trip',
    activeTrip: null,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. Auth guard — invalid / missing token
  // ---------------------------------------------------------------------------
  describe('1. Token Authentication Guards', () => {
    it('rejects an invalid/unknown token with 401', async () => {
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockRejectedValueOnce(
        new UnauthorizedError('Invalid tracking link or link does not exist')
      );

      const res = await request(app).get(`/api/v1/parent/feed/${INVALID_TOKEN}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects an expired token with 401', async () => {
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockRejectedValueOnce(
        new UnauthorizedError('This live tracking link has expired')
      );

      const res = await request(app).get(`/api/v1/parent/feed/trk_expired_token`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects a revoked token with 401', async () => {
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockRejectedValueOnce(
        new UnauthorizedError('This live tracking link has been revoked for security')
      );

      const res = await request(app).get(`/api/v1/parent/feed/trk_revoked_token`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. No active trip
  // ---------------------------------------------------------------------------
  describe('2. No Active Trip State', () => {
    it('returns 404 with NO_ACTIVE_TRIP code when no trip is running', async () => {
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockResolvedValueOnce(
        mockSessionNoTrip
      );

      const res = await request(app).get(`/api/v1/parent/feed/${NO_TRIP_TOKEN}`);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.code).toBe('NO_ACTIVE_TRIP');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Successful SSE stream with active trip
  // ---------------------------------------------------------------------------
  describe('3. Successful Parent SSE Stream', () => {
    it('returns 200 text/event-stream with initial_state containing tripId and studentName', async () => {
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockResolvedValueOnce(
        mockSessionWithTrip
      );
      // subscribeTrip returns a no-op unsubscribe
      vi.spyOn(RealtimeFeedService, 'subscribeTrip').mockImplementation((_tripId, _cb) => {
        return () => {};
      });

      const res = await request(app)
        .get(`/api/v1/parent/feed/${VALID_TOKEN}`)
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (data.includes('event: initial_state')) {
              res.destroy();
              callback(null, data);
            }
          });
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.headers['cache-control']).toContain('no-cache');
      expect(res.body).toContain('event: initial_state');
      expect(res.body).toContain(tripId);
      expect(res.body).toContain('Arjun Sharma');
    });

    it('subscribes to the correct trip channel (not bus or school channel)', async () => {
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockResolvedValueOnce(
        mockSessionWithTrip
      );

      let subscribedTripId: string | null = null;
      vi.spyOn(RealtimeFeedService, 'subscribeTrip').mockImplementation((tid, _cb) => {
        subscribedTripId = tid;
        return () => {};
      });

      await request(app)
        .get(`/api/v1/parent/feed/${VALID_TOKEN}`)
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (data.includes('event: initial_state')) {
              res.destroy();
              callback(null, data);
            }
          });
        });

      expect(subscribedTripId).toBe(tripId);
    });

    it('includes last GPS location and pickup stop in initial_state', async () => {
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockResolvedValueOnce(
        mockSessionWithTrip
      );
      vi.spyOn(RealtimeFeedService, 'subscribeTrip').mockImplementation((_tid, _cb) => () => {});

      const res = await request(app)
        .get(`/api/v1/parent/feed/${VALID_TOKEN}`)
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (data.includes('event: initial_state')) {
              res.destroy();
              callback(null, data);
            }
          });
        });

      expect(res.body).toContain('lastGpsLocation');
      expect(res.body).toContain('pickupStop');
      expect(res.body).toContain('Sector 12 Gate');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Token isolation — token is scoped; cannot switch context
  // ---------------------------------------------------------------------------
  describe('4. Cross-Token Isolation', () => {
    it('token A session cannot read trip data from token B (inherently isolated by middleware)', async () => {
      // Token B's session belongs to a completely different student + trip
      const tokenBSession: ParentLiveTrackingSession = {
        ...mockSessionWithTrip,
        tokenPrefix: 'trk_other',
        student: {
          ...mockSessionWithTrip.student,
          id: 'stud-other-0000-0000-0000-000000000099',
          fullName: 'Other Child',
        },
        activeTrip: {
          ...mockSessionWithTrip.activeTrip!,
          id: 'trip-other-0000-0000-0000-000000000099',
          busNumber: 'Bus 99 (North)',
        },
      };

      // When we request token A, the middleware returns token A's session — always
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockImplementation(async (rawToken) => {
        if (rawToken === VALID_TOKEN) return mockSessionWithTrip;
        if (rawToken === 'trk_token_b') return tokenBSession;
        throw new UnauthorizedError('Unknown token');
      });
      vi.spyOn(RealtimeFeedService, 'subscribeTrip').mockImplementation((_tid, _cb) => () => {});

      const resA = await request(app)
        .get(`/api/v1/parent/feed/${VALID_TOKEN}`)
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (data.includes('event: initial_state')) {
              res.destroy();
              callback(null, data);
            }
          });
        });

      // Token A's response MUST contain token A's trip and student — not token B's
      expect(resA.status).toBe(200);
      expect(resA.body).toContain('Arjun Sharma');
      expect(resA.body).not.toContain('Other Child');
      expect(resA.body).toContain(tripId);
    });
  });
});
