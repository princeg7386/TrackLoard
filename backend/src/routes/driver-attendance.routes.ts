import { Router } from 'express';
import { authenticateToken, requireRoles } from '../middlewares/auth.middleware.js';
import {
  UserRole,
  RecordBoardingRequestSchema,
  RecordBoardingBatchRequestSchema,
  RecordDropRequestSchema,
  RecordDropBatchRequestSchema,
} from '@school-bus/shared';
import { validateBody } from '../middlewares/validate.middleware.js';
import { DriverAttendanceController } from '../controllers/driver-attendance.controller.js';

const driverAttendanceRouter = Router();

// GET /api/v1/driver/attendance/students
// Allows authenticated drivers, school admins, and transport coordinators to view the assigned student list
driverAttendanceRouter.get(
  '/students',
  authenticateToken,
  requireRoles(UserRole.DRIVER, UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  DriverAttendanceController.getStudents
);

// POST /api/v1/driver/attendance/boarding
// Records student boarding attendance (BOARDED or ABSENT) with timestamp and GPS location
driverAttendanceRouter.post(
  '/boarding',
  authenticateToken,
  requireRoles(UserRole.DRIVER, UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  validateBody(RecordBoardingRequestSchema),
  DriverAttendanceController.recordBoarding
);

// POST /api/v1/driver/attendance/boarding/batch
// Records batch student boarding attendance for a pickup stop
driverAttendanceRouter.post(
  '/boarding/batch',
  authenticateToken,
  requireRoles(UserRole.DRIVER, UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  validateBody(RecordBoardingBatchRequestSchema),
  DriverAttendanceController.recordBoardingBatch
);

// POST /api/v1/driver/attendance/drop
// Records student drop/deboarding attendance (DEBOARDED) with timestamp and GPS location
driverAttendanceRouter.post(
  '/drop',
  authenticateToken,
  requireRoles(UserRole.DRIVER, UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  validateBody(RecordDropRequestSchema),
  DriverAttendanceController.recordDrop
);

// POST /api/v1/driver/attendance/drop/batch
// Records batch student drop attendance for a drop stop
driverAttendanceRouter.post(
  '/drop/batch',
  authenticateToken,
  requireRoles(UserRole.DRIVER, UserRole.SCHOOL_ADMIN, UserRole.TRANSPORT_COORDINATOR),
  validateBody(RecordDropBatchRequestSchema),
  DriverAttendanceController.recordDropBatch
);

export default driverAttendanceRouter;
