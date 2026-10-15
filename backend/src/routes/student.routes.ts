import { Router } from 'express';
import {
  CreateStudentRequestSchema,
  UpdateStudentRequestSchema,
  UpsertParentGuardianRequestSchema,
  AssignStudentTransportPayloadSchema,
  RelinkParentStudentRequestSchema,
  SendParentNoticeRequestSchema,
  UpdateParentNotificationPreferencesSchema,
  UpdateNotificationStatusRequestSchema,
  UserRole,
} from '@school-bus/shared';
import { authenticateToken, requireRoles } from '../middlewares/auth.middleware.js';
import { requireTenantScope } from '../middlewares/tenant-isolation.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { StudentController } from '../controllers/student.controller.js';
import { ParentIdentityController } from '../controllers/parent-identity.controller.js';

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
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  StudentController.getTransportOptions
);

// 3. List Students
studentRouter.get(
  '/:schoolId/students',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  StudentController.listStudents
);

// 3b. List School Parents (with WhatsApp status & student context)
studentRouter.get(
  '/:schoolId/parents',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  ParentIdentityController.listSchoolParents
);

// 3c. Get Parent Assignment Details (Student, Transport, Active Live Tracking Link)
studentRouter.get(
  '/:schoolId/parents/:parentId/assignment',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  ParentIdentityController.getAssignmentDetails
);

// 3d. Re-link Parent to Authorized Student (1:1 direct link update)
studentRouter.put(
  '/:schoolId/parents/:parentId/relink',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(RelinkParentStudentRequestSchema),
  ParentIdentityController.relinkStudent
);

// 3e. Get Parent Communication History (Notifications & Token Lifecycle Events)
studentRouter.get(
  '/:schoolId/parents/:parentId/communications',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  ParentIdentityController.getCommunicationHistory
);

// 3f. Send Outbound WhatsApp / SMS Notice to Parent
studentRouter.post(
  '/:schoolId/parents/:parentId/communications',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(SendParentNoticeRequestSchema),
  ParentIdentityController.sendNotice
);

// 3g. Dispatch WhatsApp Onboarding Invitation to Parent
studentRouter.post(
  '/:schoolId/parents/:parentId/onboard',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  ParentIdentityController.sendOnboardInvite
);

// 3h. Get Parent Notification Delivery Health & Link Activity
studentRouter.get(
  '/:schoolId/parents/:parentId/notification-status',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  ParentIdentityController.getNotificationStatus
);

// 3i. Update Parent Notification Preferences (Opt-Out / Opt-In)
studentRouter.patch(
  '/:schoolId/parents/:parentId/notification-preferences',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(UpdateParentNotificationPreferencesSchema),
  ParentIdentityController.updateNotificationPreferences
);

// 3j. Update Outbound Notification Delivery Status (Delivery / Read Receipts / Webhooks)
studentRouter.post(
  '/:schoolId/notifications/:notificationId/status',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(UpdateNotificationStatusRequestSchema),
  ParentIdentityController.updateNotificationStatus
);

// 4. Get Student Transport Attendance History
studentRouter.get(
  '/:schoolId/students/:studentId/transport-history',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  StudentController.getTransportHistory
);

// 5. Get Single Student Details
studentRouter.get(
  '/:schoolId/students/:studentId',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  StudentController.getStudent
);

// 6. Update Student Profile
studentRouter.put(
  '/:schoolId/students/:studentId',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
  validateBody(UpdateStudentRequestSchema),
  StudentController.updateStudent
);

// 7. Remove / Soft Delete Student
studentRouter.delete(
  '/:schoolId/students/:studentId',
  authenticateToken,
  requireTenantScope('params', 'schoolId'),
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.SUPER_ADMIN
  ),
  StudentController.deleteStudent
);

// 8. Assign / Unassign Transport (Bus & Stops)
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
  requireRoles(
    UserRole.SCHOOL_ADMIN,
    UserRole.TRANSPORT_COORDINATOR,
    UserRole.SUPER_ADMIN
  ),
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

