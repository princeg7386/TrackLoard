import { EventEmitter } from 'events';
import { Response } from 'express';
import { TelemetryFeedEvent, GpsHealthStatus } from '@school-bus/shared';
import { logger } from './logger.service.js';

export interface SseClientSession {
  id: string;
  res: Response;
  channel: string;
  heartbeatInterval: NodeJS.Timeout;
}

export interface ParentSseClient {
  connectionId: string;
  tokenId?: string;
  tokenHash?: string;
  studentId?: string;
  parentId?: string;
  tripId: string;
  res: Response;
  cleanup: () => void;
}

export class RealtimeFeedService {
  private static emitter = new EventEmitter();
  private static parentClients = new Map<string, ParentSseClient>();

  static {
    // Allow large number of concurrent SSE connections without memory leak warning
    this.emitter.setMaxListeners(2000);
  }

  /**
   * Broadcast a telemetry update event across all relevant subscriber channels:
   * 1. School Fleet Channel: school:{schoolId}
   * 2. Trip Channel: trip:{tripId}
   * 3. Bus Channel: bus:{busId}
   */
  static publish(event: TelemetryFeedEvent): void {
    if (event.schoolId) {
      this.emitter.emit(`school:${event.schoolId}`, event);
    }
    if (event.tripId) {
      this.emitter.emit(`trip:${event.tripId}`, event);
    }
    if (event.busId) {
      this.emitter.emit(`bus:${event.busId}`, event);
    }

    logger.debug('Telemetry real-time feed event published', {
      type: event.type,
      schoolId: event.schoolId,
      busId: event.busId,
      tripId: event.tripId,
      speed: event.speedKmh,
      healthStatus: event.healthStatus,
    });
  }

  /**
   * Subscribe a listener callback to a specific school's fleet channel
   */
  static subscribeSchool(
    schoolId: string,
    listener: (event: TelemetryFeedEvent) => void
  ): () => void {
    const channel = `school:${schoolId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }

  /**
   * Subscribe a listener callback to a specific trip's channel (e.g. for Parent Web Live Tracking)
   */
  static subscribeTrip(
    tripId: string,
    listener: (event: TelemetryFeedEvent) => void
  ): () => void {
    const channel = `trip:${tripId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }

  /**
   * Subscribe a listener callback to a specific bus channel
   */
  static subscribeBus(
    busId: string,
    listener: (event: TelemetryFeedEvent) => void
  ): () => void {
    const channel = `bus:${busId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }

  /**
   * Configure standard Server-Sent Events headers on an Express response
   */
  static initSseStream(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Essential for Nginx/AWS ALB streaming
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }
  }

  /**
   * Format and send an SSE event message to a client response
   */
  static sendSseMessage(res: Response, eventName: string, data: any): void {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  /**
   * Format and send a keep-alive comment heartbeat
   */
  static sendSseHeartbeat(res: Response): void {
    res.write(`: keep-alive\n\n`);
  }

  /**
   * Returns current listener count for a channel
   */
  static getChannelSubscriberCount(channel: string): number {
    return this.emitter.listenerCount(channel);
  }

  /**
   * Register an active parent SSE connection
   */
  static registerParentStream(client: Omit<ParentSseClient, 'connectionId'>): { connectionId: string; close: () => void } {
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const fullClient: ParentSseClient = {
      ...client,
      connectionId,
    };
    this.parentClients.set(connectionId, fullClient);

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      this.parentClients.delete(connectionId);
      try {
        client.cleanup();
      } catch (err) {
        logger.error('Error during parent SSE client cleanup:', err);
      }
      try {
        if (!client.res.writableEnded) {
          client.res.end();
        }
      } catch (err) {
        logger.error('Error closing parent SSE response:', err);
      }
    };

    return { connectionId, close };
  }

  /**
   * Remove a parent client from the active registry (idempotent)
   */
  static unregisterParentStream(connectionId: string): void {
    this.parentClients.delete(connectionId);
  }

  /**
   * Terminate active parent streams matching a revoked token ID or token hash
   */
  static terminateParentStreamsByToken(tokenIdOrHash: string, reason?: string): number {
    let count = 0;
    for (const [connId, client] of Array.from(this.parentClients.entries())) {
      if (client.tokenId === tokenIdOrHash || client.tokenHash === tokenIdOrHash) {
        this.terminateClient(connId, client, 'TOKEN_REVOKED', reason || 'This live tracking link has been revoked for security');
        count++;
      }
    }
    return count;
  }

  /**
   * Terminate active parent streams for a student whose tokens were revoked
   */
  static terminateParentStreamsByStudentId(studentId: string, reason?: string): number {
    let count = 0;
    for (const [connId, client] of Array.from(this.parentClients.entries())) {
      if (client.studentId === studentId) {
        this.terminateClient(connId, client, 'TOKEN_REVOKED', reason || 'All live tracking links for this student have been revoked');
        count++;
      }
    }
    return count;
  }

  /**
   * Terminate active parent streams for a parent whose tokens were revoked
   */
  static terminateParentStreamsByParentId(parentId: string, reason?: string): number {
    let count = 0;
    for (const [connId, client] of Array.from(this.parentClients.entries())) {
      if (client.parentId === parentId) {
        this.terminateClient(connId, client, 'TOKEN_REVOKED', reason || 'All live tracking links for this parent have been revoked');
        count++;
      }
    }
    return count;
  }

  /**
   * Helper to safely send termination event, trigger cleanup and end response
   */
  private static terminateClient(
    connId: string,
    client: ParentSseClient,
    code: string,
    message: string
  ): void {
    this.parentClients.delete(connId);

    try {
      client.cleanup();
    } catch (err) {
      logger.error('Error during client cleanup on termination:', err);
    }

    try {
      if (!client.res.writableEnded) {
        this.sendSseMessage(client.res, 'token_revoked', {
          code,
          message,
          timestamp: new Date().toISOString(),
        });
        client.res.end();
      }
    } catch (err) {
      logger.error('Error sending termination SSE event:', err);
    }

    logger.info('Terminated parent live tracking SSE stream', {
      connectionId: connId,
      tokenId: client.tokenId,
      studentId: client.studentId,
      code,
    });
  }

  /**
   * Returns count of currently active registered parent SSE streams
   */
  static getActiveParentClientCount(): number {
    return this.parentClients.size;
  }

  /**
   * Terminate all active parent streams (e.g. for testing teardown or graceful server shutdown)
   */
  static closeAllParentStreams(): void {
    for (const [connId, client] of Array.from(this.parentClients.entries())) {
      this.terminateClient(connId, client, 'SERVER_SHUTDOWN', 'Connection closed by server');
    }
    this.parentClients.clear();
  }
}

