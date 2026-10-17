import { Router } from 'express';
import { authenticateToken, requireRoles } from '../middlewares/auth.middleware.js';
import { UserRole } from '@school-bus/shared';
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

export default driverAttendanceRouter;
