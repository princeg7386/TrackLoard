import { Router } from 'express';
import {
  CreateStudentRequestSchema,
  UserRole,
} from '@school-bus/shared';
import { authenticateToken, requireRoles } from '../middlewares/auth.middleware.js';
import { requireTenantScope } from '../middlewares/tenant-isolation.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { StudentController } from '../controllers/student.controller.js';

const studentRouter = Router({ mergeParams: true });

// 1. Create / Register Student
studentRouter.post(
  '/:schoolId/students',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(CreateStudentRequestSchema),
  StudentController.createStudent
);

// 2. List Students
studentRouter.get(
  '/:schoolId/students',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  StudentController.listStudents
);

// 3. Get Single Student Details
studentRouter.get(
  '/:schoolId/students/:studentId',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  StudentController.getStudent
);

export default studentRouter;
