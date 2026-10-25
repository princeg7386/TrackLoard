import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import * as db from '../src/config/database.js';
import { RealtimeFeedService } from '../src/services/realtime-feed.service.js';
import { ParentIdentityService } from '../src/services/parent-identity.service.js';
import { UnauthorizedError } from '../src/middlewares/error.middleware.js';
import { parentTokenRateLimiterStore } from '../src/middlewares/rate-limiter.middleware.js';
import {
  ParentLiveTrackingSession,
  TelemetryFeedEvent,
  TripStatus,
  RouteType,
  GpsHealthStatus,
} from '@school-bus/shared';

describe('SEC-002: Parent SSE Stream Revocation & Lifecycle Management', () => {
  const app = createApp();

  const VALID_TOKEN = 'trk_active_live_token_sec002';
  const VALID_TOKEN_ID = '44444444-4444-4444-4444-444444444444';
  const STUDENT_ID = '33333333-3333-3333-3333-333333333333';
  const PARENT_ID = '22222222-2222-2222-2222-222222222222';
  const SCHOOL_ID = '11111111-1111-1111-1111-111111111111';
  const TRIP_ID = '66666666-6666-6666-6666-666666666666';

  const mockActiveSession: ParentLiveTrackingSession = {
    tokenId: VALID_TOKEN_ID,
    isValid: true,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    parent: {
      id: PARENT_ID,
      fullName: 'Pooja Verma',
      relationship: 'MOTHER',
      phone: '+919876543210',
    },
    student: {
      id: STUDENT_ID,
      schoolId: SCHOOL_ID,
      fullName: 'Aarav Sharma',
      admissionNumber: 'SCH-2026-089',
      classGrade: '5',
      section: 'B',
    },
    school: {
      id: SCHOOL_ID,
      name: 'Delhi Public School',
      code: 'DPS-DELHI',
      timezone: 'Asia/Kolkata',
    },
    pickupStop: {
      id: '55555555-5555-5555-5555-555555555555',
      stopName: 'Sector 4 Market',
      sequenceOrder: 2,
      scheduledTime: '07:30:00',
      latitude: 28.5678,
      longitude: 77.189,
      geofenceRadiusMeters: 150,
    },
    activeTrip: {
      id: TRIP_ID,
      routeId: '77777777-7777-7777-7777-777777777777',
      routeName: 'Route 4 - South Delhi',
      routeType: RouteType.MORNING_PICKUP,
      status: TripStatus.IN_TRANSIT,
      busNumber: 'Bus 04',
      registrationNumber: 'DL-01-AB-1234',
      driverName: 'Ramesh Kumar',
      driverPhone: '+919811122233',
      delayMinutes: 0,
      currentStopSequence: 1,
      lastGpsLocation: {
        latitude: 28.5601,
        longitude: 77.1802,
        speedKmh: 35,
        recordedAt: new Date().toISOString(),
      },
    },
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    await parentTokenRateLimiterStore.clear?.();
    RealtimeFeedService.closeAllParentStreams();
  });

  afterEach(() => {
    RealtimeFeedService.closeAllParentStreams();
  });

  describe('1. SSE Connection Establishment & Initial State', () => {
    it('establishes an SSE stream with proper headers and sends initial_state', async () => {
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockResolvedValueOnce(
        mockActiveSession
      );

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
      expect(res.headers['connection']).toContain('keep-alive');
      expect(res.headers['x-accel-buffering']).toBe('no');
      expect(res.body).toContain('event: initial_state');
      expect(res.body).toContain(TRIP_ID);
      expect(res.body).toContain('Aarav Sharma');
    });
  });

  describe('2. Delivery of Protected Telemetry Updates Before Revocation', () => {
    it('receives normal location updates on the active trip channel before revocation', async () => {
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockResolvedValueOnce(
        mockActiveSession
      );

      let capturedChunks = '';
      const reqPromise = request(app)
        .get(`/api/v1/parent/feed/${VALID_TOKEN}`)
        .buffer(true)
        .parse((res, callback) => {
          res.on('data', (chunk: Buffer) => {
            capturedChunks += chunk.toString();
            // Once initial_state is received, publish a live telemetry update
            if (capturedChunks.includes('event: initial_state') && !capturedChunks.includes('event: location_update')) {
              RealtimeFeedService.publish({
                type: 'LOCATION_UPDATE',
                tripId: TRIP_ID,
                busId: 'bus-01',
                latitude: 28.562,
                longitude: 77.182,
                speedKmh: 42,
                healthStatus: 'HEALTHY' as any,
                timestamp: new Date().toISOString(),
              });
            }
            if (capturedChunks.includes('event: location_update')) {
              res.destroy();
              callback(null, capturedChunks);
            }
          });
        });

      const res = await reqPromise;
      expect(res.body).toContain('event: location_update');
      expect(res.body).toContain('"speedKmh":42');
    });
  });

  describe('3. Connection Termination on Token Revocation', () => {
    it('terminates the active SSE connection immediately upon token revocation and sends token_revoked event', async () => {
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockResolvedValueOnce(
        mockActiveSession
      );

      let capturedData = '';
      let streamEnded = false;

      const reqPromise = request(app)
        .get(`/api/v1/parent/feed/${VALID_TOKEN}`)
        .buffer(true)
        .parse((res, callback) => {
          res.on('data', (chunk: Buffer) => {
            capturedData += chunk.toString();
            if (capturedData.includes('event: initial_state') && !capturedData.includes('event: token_revoked')) {
              // Trigger revocation via RealtimeFeedService
              RealtimeFeedService.terminateParentStreamsByToken(VALID_TOKEN_ID, 'Revoked by school admin');
            }
          });
          res.on('end', () => {
            streamEnded = true;
            callback(null, capturedData);
          });
          res.on('close', () => {
            streamEnded = true;
            callback(null, capturedData);
          });
        });

      const res = await reqPromise;

      // Must have received the token_revoked event
      expect(res.body).toContain('event: token_revoked');
      expect(res.body).toContain('TOKEN_REVOKED');
      expect(res.body).toContain('Revoked by school admin');
      expect(streamEnded).toBe(true);

      // Must have been removed from active clients registry
      expect(RealtimeFeedService.getActiveParentClientCount()).toBe(0);

      // Trip channel subscriber count must have dropped back to 0
      expect(RealtimeFeedService.getChannelSubscriberCount(`trip:${TRIP_ID}`)).toBe(0);
    });

    it('prevents subsequent telemetry events from reaching client after revocation', async () => {
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockResolvedValueOnce(
        mockActiveSession
      );

      let streamClosed = false;
      let chunksAfterRevocation = '';

      const reqPromise = request(app)
        .get(`/api/v1/parent/feed/${VALID_TOKEN}`)
        .buffer(true)
        .parse((res, callback) => {
          res.on('data', (chunk: Buffer) => {
            const str = chunk.toString();
            if (streamClosed) {
              chunksAfterRevocation += str;
            }
            if (str.includes('event: initial_state')) {
              // Revoke the connection
              RealtimeFeedService.terminateParentStreamsByToken(VALID_TOKEN_ID);
              streamClosed = true;

              // Publish protected telemetry update after revocation
              RealtimeFeedService.publish({
                type: 'LOCATION_UPDATE',
                tripId: TRIP_ID,
                busId: 'bus-01',
                latitude: 28.5699,
                longitude: 77.1899,
                speedKmh: 55,
                healthStatus: 'HEALTHY' as any,
                timestamp: new Date().toISOString(),
              });
            }
          });
          res.on('end', () => callback(null, 'ended'));
          res.on('close', () => callback(null, 'closed'));
        });

      await reqPromise;

      // No location updates published after revocation should ever be delivered
      expect(chunksAfterRevocation).not.toContain('event: location_update');
      expect(chunksAfterRevocation).not.toContain('"speedKmh":55');
    });

    it('terminates stream via ParentIdentityService.revokeToken service integration', async () => {
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockResolvedValueOnce(
        mockActiveSession
      );

      // Mock DB query for revokeToken returning the revoked token ID
      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([
        { id: VALID_TOKEN_ID, student_id: STUDENT_ID, parent_id: PARENT_ID },
      ]);

      let receivedRevocationEvent = false;

      const reqPromise = request(app)
        .get(`/api/v1/parent/feed/${VALID_TOKEN}`)
        .buffer(true)
        .parse((res, callback) => {
          res.on('data', (chunk: Buffer) => {
            const str = chunk.toString();
            if (str.includes('event: initial_state')) {
              // Call ParentIdentityService.revokeToken with raw token
              ParentIdentityService.revokeToken(VALID_TOKEN, SCHOOL_ID, 'Security incident').then(() => {});
            }
            if (str.includes('event: token_revoked')) {
              receivedRevocationEvent = true;
              res.destroy();
              callback(null, str);
            }
          });
        });

      await reqPromise;
      expect(receivedRevocationEvent).toBe(true);
      expect(RealtimeFeedService.getActiveParentClientCount()).toBe(0);
    });

    it('terminates stream via ParentIdentityService.revokeAllTokensForStudent', async () => {
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockResolvedValueOnce(
        mockActiveSession
      );

      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([{ id: VALID_TOKEN_ID }]);

      let receivedRevocation = false;

      const reqPromise = request(app)
        .get(`/api/v1/parent/feed/${VALID_TOKEN}`)
        .buffer(true)
        .parse((res, callback) => {
          res.on('data', (chunk: Buffer) => {
            const str = chunk.toString();
            if (str.includes('event: initial_state')) {
              ParentIdentityService.revokeAllTokensForStudent(STUDENT_ID, SCHOOL_ID).then(() => {});
            }
            if (str.includes('event: token_revoked')) {
              receivedRevocation = true;
              res.destroy();
              callback(null, str);
            }
          });
        });

      await reqPromise;
      expect(receivedRevocation).toBe(true);
      expect(RealtimeFeedService.getActiveParentClientCount()).toBe(0);
    });

    it('terminates stream via ParentIdentityService.revokeAllTokensForParent', async () => {
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockResolvedValueOnce(
        mockActiveSession
      );

      const querySpy = vi.spyOn(db, 'query');
      querySpy.mockResolvedValueOnce([{ id: VALID_TOKEN_ID }]);

      let receivedRevocation = false;

      const reqPromise = request(app)
        .get(`/api/v1/parent/feed/${VALID_TOKEN}`)
        .buffer(true)
        .parse((res, callback) => {
          res.on('data', (chunk: Buffer) => {
            const str = chunk.toString();
            if (str.includes('event: initial_state')) {
              ParentIdentityService.revokeAllTokensForParent(PARENT_ID, SCHOOL_ID).then(() => {});
            }
            if (str.includes('event: token_revoked')) {
              receivedRevocation = true;
              res.destroy();
              callback(null, str);
            }
          });
        });

      await reqPromise;
      expect(receivedRevocation).toBe(true);
      expect(RealtimeFeedService.getActiveParentClientCount()).toBe(0);
    });
  });

  describe('4. Rejection of Expired and Invalid Tokens', () => {
    it('rejects an expired token at connection initialization with 401', async () => {
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockRejectedValueOnce(
        new UnauthorizedError('This live tracking link has expired', { reason: 'TOKEN_EXPIRED' })
      );

      const res = await request(app).get('/api/v1/parent/feed/trk_expired_link_123');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('expired');
      expect(RealtimeFeedService.getActiveParentClientCount()).toBe(0);
    });

    it('rejects an already-revoked token at connection initialization with 401', async () => {
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockRejectedValueOnce(
        new UnauthorizedError('This live tracking link has been revoked for security', {
          reason: 'TOKEN_REVOKED',
        })
      );

      const res = await request(app).get('/api/v1/parent/feed/trk_revoked_link_123');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('revoked');
      expect(RealtimeFeedService.getActiveParentClientCount()).toBe(0);
    });

    it('rejects when token is omitted', async () => {
      const res = await request(app).get('/api/v1/parent/feed');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('5. Client Disconnect Cleanup & Idempotence', () => {
    it('cleans up timers and unregisters listener when client disconnects naturally', async () => {
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockResolvedValueOnce(
        mockActiveSession
      );

      await request(app)
        .get(`/api/v1/parent/feed/${VALID_TOKEN}`)
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
            if (data.includes('event: initial_state')) {
              // Verify active subscriber before disconnect
              expect(RealtimeFeedService.getChannelSubscriberCount(`trip:${TRIP_ID}`)).toBe(1);
              expect(RealtimeFeedService.getActiveParentClientCount()).toBe(1);

              // Client disconnects
              res.destroy();
              callback(null, data);
            }
          });
        });

      // Small delay for event loop to process close event
      await new Promise((r) => setTimeout(r, 20));

      expect(RealtimeFeedService.getChannelSubscriberCount(`trip:${TRIP_ID}`)).toBe(0);
      expect(RealtimeFeedService.getActiveParentClientCount()).toBe(0);
    });

    it('handles repeated disconnect, revocation, and cleanup calls idempotently without errors', async () => {
      vi.spyOn(ParentIdentityService, 'verifyTrackingToken').mockResolvedValueOnce(
        mockActiveSession
      );

      await request(app)
        .get(`/api/v1/parent/feed/${VALID_TOKEN}`)
        .buffer(true)
        .parse((res, callback) => {
          res.on('data', (chunk: Buffer) => {
            if (chunk.toString().includes('event: initial_state')) {
              // First termination
              RealtimeFeedService.terminateParentStreamsByToken(VALID_TOKEN_ID);
              // Second termination (must be safe no-op)
              RealtimeFeedService.terminateParentStreamsByToken(VALID_TOKEN_ID);
              // Non-existent token termination
              RealtimeFeedService.terminateParentStreamsByToken('non-existent-uuid');
              res.destroy();
              callback(null, 'ok');
            }
          });
        });

      expect(RealtimeFeedService.getActiveParentClientCount()).toBe(0);
      expect(RealtimeFeedService.getChannelSubscriberCount(`trip:${TRIP_ID}`)).toBe(0);
    });
  });
});
