import { Request, Response, NextFunction } from 'express';
import { DashboardService } from '../services/dashboard.service.js';

export class DashboardController {
  /**
   * Retrieves aggregated operational dashboard summary for school admin
   */
  public static async getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { schoolId } = req.params;
      if (!schoolId) {
        res.status(400).json({ success: false, error: { message: 'School ID is required' } });
        return;
      }
      const summary = await DashboardService.getSchoolDashboardSummary(schoolId);

      res.status(200).json({
        success: true,
        data: summary,
      });
    } catch (error) {
      next(error);
    }
  }
}
