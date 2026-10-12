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

export class RealtimeFeedService {
  private static emitter = new EventEmitter();

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
}
