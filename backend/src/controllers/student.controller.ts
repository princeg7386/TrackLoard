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
}
