import { Request, Response, NextFunction } from 'express';
import { StudentService } from '../services/student.service.js';

export class StudentController {
  /**
   * Registers a new student in school directory
   * POST /api/v1/schools/:schoolId/students
   */
  public static async createStudent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      const userId = req.user?.id;
      const ipAddress = req.ip;

      const student = await StudentService.createStudent(schoolId, req.body, userId, ipAddress);

      res.status(201).json({
        success: true,
        data: student,
        message: 'Student registered successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Lists all students for a school
   * GET /api/v1/schools/:schoolId/students
   */
  public static async listStudents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      const { search, classGrade, section } = req.query;

      const students = await StudentService.getStudents(schoolId, {
        search: typeof search === 'string' ? search : undefined,
        classGrade: typeof classGrade === 'string' ? classGrade : undefined,
        section: typeof section === 'string' ? section : undefined,
      });

      res.status(200).json({
        success: true,
        data: students,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieves single student details
   * GET /api/v1/schools/:schoolId/students/:studentId
   */
  public static async getStudent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, studentId } = req.params;
      const student = await StudentService.getStudentById(schoolId, studentId);

      res.status(200).json({
        success: true,
        data: student,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieves all parents/guardians linked to a student
   * GET /api/v1/schools/:schoolId/students/:studentId/parents
   */
  public static async getParents(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, studentId } = req.params;
      const parents = await StudentService.getParentsByStudentId(schoolId, studentId);

      res.status(200).json({
        success: true,
        data: parents,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Adds or updates parent/guardian details and emergency contact
   * POST /api/v1/schools/:schoolId/students/:studentId/parents
   */
  public static async upsertParent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, studentId } = req.params;
      const userId = req.user?.id;
      const ipAddress = req.ip;

      const student = await StudentService.upsertParentGuardian(
        schoolId,
        studentId,
        req.body,
        userId,
        ipAddress
      );

      res.status(200).json({
        success: true,
        data: student,
        message: 'Parent/guardian details updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Removes parent/guardian link from a student
   * DELETE /api/v1/schools/:schoolId/students/:studentId/parents/:parentId
   */
  public static async deleteParent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, studentId, parentId } = req.params;
      const userId = req.user?.id;
      const ipAddress = req.ip;

      await StudentService.deleteParent(schoolId, studentId, parentId, userId, ipAddress);

      res.status(200).json({
        success: true,
        message: 'Parent/guardian removed successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieves transport options (routes and their stops) for transport assignment
   * GET /api/v1/schools/:schoolId/students/transport-options
   */
  public static async getTransportOptions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      const options = await StudentService.getTransportOptions(schoolId);

      res.status(200).json({
        success: true,
        data: options,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Assigns or updates transport/bus/stop for a student (or unassigns if stops are null)
   * PUT /api/v1/schools/:schoolId/students/:studentId/transport
   */
  public static async assignTransport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, studentId } = req.params;
      const userId = req.user?.id;
      const ipAddress = req.ip;

      const student = await StudentService.assignTransport(
        schoolId,
        studentId,
        req.body,
        userId,
        ipAddress
      );

      res.status(200).json({
        success: true,
        data: student,
        message: 'Student transport assignment updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Updates student demographic and academic profile
   * PUT /api/v1/schools/:schoolId/students/:studentId
   */
  public static async updateStudent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, studentId } = req.params;
      const userId = req.user?.id;
      const ipAddress = req.ip;

      const student = await StudentService.updateStudent(
        schoolId,
        studentId,
        req.body,
        userId,
        ipAddress
      );

      res.status(200).json({
        success: true,
        data: student,
        message: 'Student details updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Soft-deletes a student from the directory
   * DELETE /api/v1/schools/:schoolId/students/:studentId
   */
  public static async deleteStudent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, studentId } = req.params;
      const userId = req.user?.id;
      const ipAddress = req.ip;

      await StudentService.deleteStudent(schoolId, studentId, userId, ipAddress);

      res.status(200).json({
        success: true,
        message: 'Student removed successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Retrieves transport attendance history (boarding/drop-off events) for a student
   * GET /api/v1/schools/:schoolId/students/:studentId/transport-history
   */
  public static async getTransportHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId, studentId } = req.params;
      const limit = req.query.limit ? Number(req.query.limit) : 50;

      const history = await StudentService.getStudentTransportHistory(schoolId, studentId, limit);

      res.status(200).json({
        success: true,
        data: history,
      });
    } catch (error) {
      next(error);
    }
  }
}


