import { Router } from 'express';
import {
  CreateStudentRequestSchema,
  UpsertParentGuardianRequestSchema,
  AssignStudentTransportPayloadSchema,
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

// 2. Transport Options for Assignment (routes & stops)
// Note: Placed before /:schoolId/students/:studentId to avoid param collision
studentRouter.get(
  '/:schoolId/students/transport-options',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  StudentController.getTransportOptions
);

// 3. List Students
studentRouter.get(
  '/:schoolId/students',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  StudentController.listStudents
);

// 4. Get Single Student Details
studentRouter.get(
  '/:schoolId/students/:studentId',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  StudentController.getStudent
);

// 5. Assign / Unassign Transport (Bus & Stops)
studentRouter.put(
  '/:schoolId/students/:studentId/transport',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(AssignStudentTransportPayloadSchema),
  StudentController.assignTransport
);

// 6. Get Parents / Guardians for a Student
studentRouter.get(
  '/:schoolId/students/:studentId/parents',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  StudentController.getParents
);

// 7. Add or Update Parent / Guardian (and Emergency Contact)
studentRouter.post(
  '/:schoolId/students/:studentId/parents',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(UpsertParentGuardianRequestSchema),
  StudentController.upsertParent
);

// 8. Remove Parent / Guardian Link
studentRouter.delete(
  '/:schoolId/students/:studentId/parents/:parentId',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  StudentController.deleteParent
);

export default studentRouter;

