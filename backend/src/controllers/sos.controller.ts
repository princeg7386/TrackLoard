/**
 * SosController — Phase 30.1 / 30.4: Emergency / SOS Trigger & Resolution
 *
 * Thin HTTP layer. Business logic lives in SosService.
 * All handlers follow the existing pattern: extract, validate, call service, respond.
 */

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { SosService } from '../services/sos.service.js';
import { NotFoundError, ValidationError } from '../middlewares/error.middleware.js';

// ── Request Schemas ──────────────────────────────────────────────────────────

const TriggerSosBodySchema = z.object({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  speedKmh: z.number().min(0).optional(),
  notes: z.string().max(500).optional(),
});

const ResolveSosBodySchema = z.object({
  notes: z.string().max(500).optional(),
});

// ── Controller ───────────────────────────────────────────────────────────────

export class SosController {
  /**
   * POST /telemetry/trips/:tripId/sos
   * Driver JWT (req.driver) — triggers an SOS event for an active trip.
   * Body is optional (lat/lng/speed can come from telemetry pipeline).
   */
  static async triggerSos(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.driver) {
        res.status(401).json({ success: false, message: 'Driver authentication required' });
        return;
      }

      const { tripId } = req.params;
      if (!tripId) {
        throw new ValidationError('tripId param is required');
      }

      // schoolId comes from the driver JWT payload
      const schoolId: string = req.driver.schoolId;

      // Body is optional — parse if present
      let body: z.infer<typeof TriggerSosBodySchema> = {};
      if (req.body && Object.keys(req.body).length > 0) {
        const parsed = TriggerSosBodySchema.safeParse(req.body);
        if (!parsed.success) {
          throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
        }
        body = parsed.data;
      }

      const result = await SosService.triggerSos({
        schoolId,
        tripId,
        triggerSource: 'APP_SOS_BUTTON',
        latitude: body.latitude,
        longitude: body.longitude,
        speedKmh: body.speedKmh,
        notes: body.notes,
      });

      res.status(201).json({
        success: true,
        message: 'Emergency SOS triggered. School administration has been alerted.',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /schools/:schoolId/sos-events
   * Admin — list active (TRIGGERED + ACKNOWLEDGED) SOS events for the school.
   */
  static async getActiveSosEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      if (!schoolId) {
        throw new ValidationError('schoolId param is required');
      }

      const events = await SosService.getActiveSosEvents(schoolId);
      res.json({
        success: true,
        message: events.length === 0 ? 'No active SOS events' : `${events.length} active SOS event(s)`,
        data: events,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /schools/:schoolId/sos-events/:sosId/acknowledge
   * Admin — acknowledge an active SOS event.
   */
  static async acknowledgeSos(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { schoolId, sosId } = req.params;
      if (!schoolId || !sosId) {
        throw new ValidationError('schoolId and sosId params are required');
      }

      const adminId: string = req.user.id;
      const updated = await SosService.acknowledgeSos(sosId, schoolId, adminId);

      res.json({
        success: true,
        message: 'SOS event acknowledged.',
        data: updated,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        next(new NotFoundError(err.message));
      } else {
        next(err);
      }
    }
  }

  /**
   * POST /schools/:schoolId/sos-events/:sosId/resolve
   * Admin — resolve a SOS event with optional notes.
   */
  static async resolveSos(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, sosId } = req.params;
      if (!schoolId || !sosId) {
        throw new ValidationError('schoolId and sosId params are required');
      }

      let notes: string | undefined;
      if (req.body && typeof req.body.notes === 'string') {
        const parsed = ResolveSosBodySchema.safeParse(req.body);
        if (!parsed.success) {
          throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
        }
        notes = parsed.data.notes;
      }

      const updated = await SosService.resolveSos(sosId, schoolId, notes);

      res.json({
        success: true,
        message: 'SOS event resolved.',
        data: updated,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        next(new NotFoundError(err.message));
      } else {
        next(err);
      }
    }
  }

  /**
   * GET /schools/:schoolId/sos-events/history
   * Admin — paginated list of RESOLVED SOS events (incident history).
   * Query: ?limit=50&offset=0
   * Phase 30.4
   */
  static async getSosHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      if (!schoolId) {
        throw new ValidationError('schoolId param is required');
      }

      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      const events = await SosService.getSosHistory(schoolId, limit, offset);

      res.json({
        success: true,
        message: events.length === 0 ? 'No resolved SOS events' : `${events.length} resolved SOS event(s)`,
        data: events,
        pagination: { limit, offset, count: events.length },
      });
    } catch (err) {
      next(err);
    }
  }
}
