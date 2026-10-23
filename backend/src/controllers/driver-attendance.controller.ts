import { Request, Response, NextFunction } from 'express';
import { DriverAttendanceService } from '../services/driver-attendance.service.js';
import { sendSuccess } from '../utils/response.util.js';
import { BadRequestError, ForbiddenError } from '../middlewares/error.middleware.js';

export class DriverAttendanceController {
  /**
   * GET /api/v1/driver/attendance/students
   * Retrieves registered students and pickup details for the driver's assigned bus or active trip
   */
  public static async getStudents(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        throw new ForbiddenError('Authentication required');
      }

      const isDriver = user.role === 'DRIVER';
      const targetSchoolId = (req.query.schoolId as string | undefined) || user.schoolId;

      if (!targetSchoolId) {
        throw new BadRequestError('School context is required');
      }

      if (user.schoolId && user.schoolId !== targetSchoolId) {
        throw new ForbiddenError('Cross-tenant attendance access is prohibited');
      }

      const busId = req.query.busId as string | undefined;
      const driverId = isDriver ? user.id : (req.query.driverId as string | undefined);
      const tripId = req.query.tripId as string | undefined;
      // Phase 19.1: optional search query — matches name or admission number
      const search = (req.query.q as string | undefined)?.trim() || undefined;

      const result = await DriverAttendanceService.getStudentsForAssignedBus(
        targetSchoolId,
        {
          busId,
          driverId,
          tripId,
          search,
        },
        {
          userId: user.id,
          isDriver,
          userRole: user.role,
          schoolId: user.schoolId || undefined,
        }
      );

      sendSuccess(res, result, 'Assigned student attendance list retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/driver/attendance/boarding
   * Records boarding attendance for a student (BOARDED or ABSENT)
   */
  public static async recordBoarding(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        throw new ForbiddenError('Authentication required');
      }

      const isDriver = user.role === 'DRIVER';
      const targetSchoolId = (req.body.schoolId as string | undefined) || user.schoolId;

      if (!targetSchoolId) {
        throw new BadRequestError('School context is required');
      }

      if (user.schoolId && user.schoolId !== targetSchoolId) {
        throw new ForbiddenError('Cross-tenant attendance access is prohibited');
      }

      const result = await DriverAttendanceService.recordBoarding(
        targetSchoolId,
        req.body,
        {
          userId: user.id,
          isDriver,
          userRole: user.role,
          schoolId: user.schoolId || undefined,
        }
      );

      sendSuccess(res, result, 'Student boarding attendance recorded successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/driver/attendance/boarding/batch
   * Records batch boarding attendance for multiple students at once
   */
  public static async recordBoardingBatch(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        throw new ForbiddenError('Authentication required');
      }

      const isDriver = user.role === 'DRIVER';
      const targetSchoolId = (req.body.schoolId as string | undefined) || user.schoolId;

      if (!targetSchoolId) {
        throw new BadRequestError('School context is required');
      }

      if (user.schoolId && user.schoolId !== targetSchoolId) {
        throw new ForbiddenError('Cross-tenant attendance access is prohibited');
      }

      const result = await DriverAttendanceService.recordBoardingBatch(
        targetSchoolId,
        req.body,
        {
          userId: user.id,
          isDriver,
          userRole: user.role,
          schoolId: user.schoolId || undefined,
        }
      );

      sendSuccess(res, result, 'Batch boarding attendance recorded successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/driver/attendance/drop
   * Records drop/deboarding attendance for a student (DEBOARDED, HANDOVER_CONFIRMED, etc.)
   */
  public static async recordDrop(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        throw new ForbiddenError('Authentication required');
      }

      const isDriver = user.role === 'DRIVER';
      const targetSchoolId = (req.body.schoolId as string | undefined) || user.schoolId;

      if (!targetSchoolId) {
        throw new BadRequestError('School context is required');
      }

      if (user.schoolId && user.schoolId !== targetSchoolId) {
        throw new ForbiddenError('Cross-tenant attendance access is prohibited');
      }

      const result = await DriverAttendanceService.recordDrop(
        targetSchoolId,
        req.body,
        {
          userId: user.id,
          isDriver,
          userRole: user.role,
          schoolId: user.schoolId || undefined,
        }
      );

      sendSuccess(res, result, 'Student drop attendance recorded successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/driver/attendance/drop/batch
   * Records batch drop attendance for multiple students at once
   */
  public static async recordDropBatch(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        throw new ForbiddenError('Authentication required');
      }

      const isDriver = user.role === 'DRIVER';
      const targetSchoolId = (req.body.schoolId as string | undefined) || user.schoolId;

      if (!targetSchoolId) {
        throw new BadRequestError('School context is required');
      }

      if (user.schoolId && user.schoolId !== targetSchoolId) {
        throw new ForbiddenError('Cross-tenant attendance access is prohibited');
      }

      const result = await DriverAttendanceService.recordDropBatch(
        targetSchoolId,
        req.body,
        {
          userId: user.id,
          isDriver,
          userRole: user.role,
          schoolId: user.schoolId || undefined,
        }
      );

      sendSuccess(res, result, 'Batch drop attendance recorded successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/driver/attendance/correct
   * Corrects attendance record with strict rules and audit logging
   */
  public static async correctAttendance(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        throw new ForbiddenError('Authentication required');
      }

      const isDriver = user.role === 'DRIVER';
      const targetSchoolId = (req.body.schoolId as string | undefined) || user.schoolId;

      if (!targetSchoolId) {
        throw new BadRequestError('School context is required');
      }

      if (user.schoolId && user.schoolId !== targetSchoolId) {
        throw new ForbiddenError('Cross-tenant attendance access is prohibited');
      }

      const result = await DriverAttendanceService.correctAttendance(
        targetSchoolId,
        req.body,
        {
          userId: user.id,
          isDriver,
          userRole: user.role,
          schoolId: user.schoolId || undefined,
        }
      );

      sendSuccess(res, result, 'Attendance correction recorded successfully', 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/driver/attendance/students/:studentId/journey
   * Retrieves chronological student journey timeline and corrections
   */
  public static async getStudentJourney(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        throw new ForbiddenError('Authentication required');
      }

      const isDriver = user.role === 'DRIVER';
      const targetSchoolId = (req.query.schoolId as string | undefined) || user.schoolId;

      if (!targetSchoolId) {
        throw new BadRequestError('School context is required');
      }

      if (user.schoolId && user.schoolId !== targetSchoolId) {
        throw new ForbiddenError('Cross-tenant attendance access is prohibited');
      }

      const studentId = req.params.studentId as string;
      const tripId = req.query.tripId as string | undefined;

      const result = await DriverAttendanceService.getStudentJourneyHistory(
        targetSchoolId,
        studentId,
        tripId,
        {
          userId: user.id,
          isDriver,
          userRole: user.role,
          schoolId: user.schoolId || undefined,
        }
      );

      sendSuccess(res, result, 'Student journey history retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/driver/attendance/trips/:tripId/history
   * Retrieves complete attendance history for a single trip
   */
  public static async getTripHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        throw new ForbiddenError('Authentication required');
      }

      const isDriver = user.role === 'DRIVER';
      const targetSchoolId = (req.query.schoolId as string | undefined) || user.schoolId;

      if (!targetSchoolId) {
        throw new BadRequestError('School context is required');
      }

      if (user.schoolId && user.schoolId !== targetSchoolId) {
        throw new ForbiddenError('Cross-tenant attendance access is prohibited');
      }

      const tripId = req.params.tripId as string;

      const result = await DriverAttendanceService.getTripAttendanceHistory(
        targetSchoolId,
        tripId,
        {
          userId: user.id,
          isDriver,
          userRole: user.role,
          schoolId: user.schoolId || undefined,
        }
      );

      sendSuccess(res, result, 'Trip attendance history retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/driver/attendance/history
   * Retrieves aggregate attendance history across trips on a specified date
   */
  public static async getDateHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const user = req.user;
      if (!user) {
        throw new ForbiddenError('Authentication required');
      }

      const isDriver = user.role === 'DRIVER';
      const targetSchoolId = (req.query.schoolId as string | undefined) || user.schoolId;

      if (!targetSchoolId) {
        throw new BadRequestError('School context is required');
      }

      if (user.schoolId && user.schoolId !== targetSchoolId) {
        throw new ForbiddenError('Cross-tenant attendance access is prohibited');
      }

      const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const busId = req.query.busId as string | undefined;
      const routeId = req.query.routeId as string | undefined;
      const driverId = isDriver ? user.id : (req.query.driverId as string | undefined);

      const result = await DriverAttendanceService.getDateAttendanceHistory(
        targetSchoolId,
        {
          date: dateStr,
          busId,
          routeId,
          driverId,
        },
        {
          userId: user.id,
          isDriver,
          userRole: user.role,
          schoolId: user.schoolId || undefined,
        }
      );

      sendSuccess(res, result, 'Date attendance history retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
}

