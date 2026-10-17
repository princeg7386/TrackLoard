import { query } from '../config/database.js';
import { logger } from './logger.service.js';

export interface DashboardMetricSummary {
  totalBuses: number;
  totalDrivers: number;
  totalRoutes: number;
  totalStudents: number;
  activeTripsCount: number;
  activeIncidentsCount: number;
  activeDelaysCount: number;
}

export interface TransportStatusSummary {
  totalTripsToday: number;
  scheduledTrips: number;
  inProgressTrips: number;
  completedTrips: number;
  cancelledTrips: number;
  morningPickupCount: number;
  eveningDropCount: number;
}

export interface AlertSummaryItem {
  id: string;
  type: 'SOS' | 'INCIDENT' | 'DELAY';
  severity: string;
  title: string;
  description: string;
  createdAt: string;
}

export interface AlertSummary {
  openIncidents: number;
  activeSos: number;
  delaysToday: number;
  notificationsSentToday: number;
  criticalAlertsList: AlertSummaryItem[];
}

export interface RecentActivityItem {
  id: string;
  action: string;
  entityType: string;
  description: string;
  userRole?: string;
  createdAt: string;
}

export interface SchoolDashboardSummary {
  schoolId: string;
  metrics: DashboardMetricSummary;
  transportStatus: TransportStatusSummary;
  alertSummary: AlertSummary;
  recentActivity: RecentActivityItem[];
}

export class DashboardService {
  /**
   * Retrieves aggregated operational dashboard summary for a school
   */
  public static async getSchoolDashboardSummary(
    schoolId: string
  ): Promise<SchoolDashboardSummary> {
    try {
      // 1. Entity Counts (Fleet, Drivers, Routes, Students)
      const countsSql = `
        SELECT
          (SELECT COUNT(*)::int FROM buses WHERE school_id = $1 AND deleted_at IS NULL) AS "totalBuses",
          (SELECT COUNT(*)::int FROM drivers WHERE school_id = $1 AND deleted_at IS NULL) AS "totalDrivers",
          (SELECT COUNT(*)::int FROM routes WHERE school_id = $1 AND deleted_at IS NULL) AS "totalRoutes",
          (SELECT COUNT(*)::int FROM students WHERE school_id = $1 AND deleted_at IS NULL) AS "totalStudents",
          (SELECT COUNT(*)::int FROM trips WHERE school_id = $1 AND status IN ('IN_TRANSIT', 'DELAYED', 'ARRIVED_SCHOOL') AND deleted_at IS NULL) AS "activeTripsCount",
          (SELECT COUNT(*)::int FROM incidents WHERE school_id = $1 AND status = 'OPEN' AND deleted_at IS NULL) AS "activeIncidentsCount",
          (SELECT COUNT(*)::int FROM delays WHERE school_id = $1 AND resolved_at IS NULL AND deleted_at IS NULL) AS "activeDelaysCount",
          (SELECT COUNT(*)::int FROM sos_events WHERE school_id = $1 AND status = 'TRIGGERED' AND deleted_at IS NULL) AS "activeSosCount",
          (SELECT COUNT(*)::int FROM notifications WHERE school_id = $1 AND DATE(created_at) = CURRENT_DATE) AS "notificationsTodayCount"
      `;

      const countsRes = await query<{
        totalBuses: number;
        totalDrivers: number;
        totalRoutes: number;
        totalStudents: number;
        activeTripsCount: number;
        activeIncidentsCount: number;
        activeDelaysCount: number;
        activeSosCount: number;
        notificationsTodayCount: number;
      }>(countsSql, [schoolId]);

      const counts = countsRes[0] || {
        totalBuses: 0,
        totalDrivers: 0,
        totalRoutes: 0,
        totalStudents: 0,
        activeTripsCount: 0,
        activeIncidentsCount: 0,
        activeDelaysCount: 0,
        activeSosCount: 0,
        notificationsTodayCount: 0,
      };

      // 2. Transport Trips Breakdown for Today
      const tripsBreakdownSql = `
        SELECT
          status,
          COUNT(*)::int AS count
        FROM trips
        WHERE school_id = $1 
          AND scheduled_date = CURRENT_DATE 
          AND deleted_at IS NULL
        GROUP BY status
      `;
      const tripsRes = await query<{ status: string; count: number }>(tripsBreakdownSql, [schoolId]);

      let scheduled = 0;
      let inProgress = 0;
      let completed = 0;
      let cancelled = 0;

      for (const row of tripsRes) {
        if (row.status === 'SCHEDULED') scheduled += Number(row.count);
        else if (row.status === 'IN_TRANSIT' || row.status === 'DELAYED' || row.status === 'ARRIVED_SCHOOL') inProgress += Number(row.count);
        else if (row.status === 'COMPLETED') completed += Number(row.count);
        else if (row.status === 'CANCELLED' || row.status === 'ABORTED') cancelled += Number(row.count);
      }

      const totalTripsToday = scheduled + inProgress + completed + cancelled;

      // Routes breakdown by morning/evening
      const routesTypeSql = `
        SELECT
          route_type AS "routeType",
          COUNT(*)::int AS count
        FROM routes
        WHERE school_id = $1 AND deleted_at IS NULL
        GROUP BY route_type
      `;
      const routesRes = await query<{ routeType: string; count: number }>(routesTypeSql, [schoolId]);

      let morningPickupCount = 0;
      let eveningDropCount = 0;

      for (const row of routesRes) {
        if (row.routeType === 'MORNING_PICKUP') morningPickupCount = Number(row.count);
        else if (row.routeType === 'EVENING_DROP') eveningDropCount = Number(row.count);
      }

      // 3. Open Incidents & SOS list
      const criticalAlertsSql = `
        SELECT
          id,
          'SOS' AS type,
          'HIGH' AS severity,
          'SOS Emergency Triggered' AS title,
          'Trigger source: ' || trigger_source AS description,
          created_at AS "createdAt"
        FROM sos_events
        WHERE school_id = $1 AND status = 'TRIGGERED' AND deleted_at IS NULL
        UNION ALL
        SELECT
          id,
          'INCIDENT' AS type,
          severity,
          'Incident: ' || incident_type AS title,
          description,
          created_at AS "createdAt"
        FROM incidents
        WHERE school_id = $1 AND status = 'OPEN' AND deleted_at IS NULL
        ORDER BY "createdAt" DESC
        LIMIT 5
      `;
      const criticalAlerts = await query<AlertSummaryItem>(criticalAlertsSql, [schoolId]);

      // 4. Recent Activity Stream from audit_logs
      const activitySql = `
        SELECT
          id,
          action,
          entity_type AS "entityType",
          user_role AS "userRole",
          created_at AS "createdAt"
        FROM audit_logs
        WHERE school_id = $1
        ORDER BY created_at DESC
        LIMIT 10
      `;
      const activityRows = await query<{
        id: string;
        action: string;
        entityType: string;
        userRole?: string;
        createdAt: string;
      }>(activitySql, [schoolId]);

      const recentActivity: RecentActivityItem[] = activityRows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        userRole: row.userRole || 'SYSTEM',
        description: DashboardService.formatActivityDescription(row.action, row.entityType),
        createdAt: new Date(row.createdAt).toISOString(),
      }));

      return {
        schoolId,
        metrics: {
          totalBuses: Number(counts.totalBuses) || 0,
          totalDrivers: Number(counts.totalDrivers) || 0,
          totalRoutes: Number(counts.totalRoutes) || 0,
          totalStudents: Number(counts.totalStudents) || 0,
          activeTripsCount: Number(counts.activeTripsCount) || 0,
          activeIncidentsCount: Number(counts.activeIncidentsCount) || 0,
          activeDelaysCount: Number(counts.activeDelaysCount) || 0,
        },
        transportStatus: {
          totalTripsToday,
          scheduledTrips: scheduled,
          inProgressTrips: inProgress,
          completedTrips: completed,
          cancelledTrips: cancelled,
          morningPickupCount,
          eveningDropCount,
        },
        alertSummary: {
          openIncidents: Number(counts.activeIncidentsCount) || 0,
          activeSos: Number(counts.activeSosCount) || 0,
          delaysToday: Number(counts.activeDelaysCount) || 0,
          notificationsSentToday: Number(counts.notificationsTodayCount) || 0,
          criticalAlertsList: criticalAlerts,
        },
        recentActivity,
      };
    } catch (error) {
      logger.error('Error computing dashboard summary for school', { schoolId, error });
      throw error;
    }
  }

  /**
   * Helper to format human-readable descriptions for activity items
   */
  private static formatActivityDescription(action: string, entityType: string): string {
    switch (action) {
      case 'SCHOOL_PROFILE_UPDATE':
        return 'School profile and contact details updated.';
      case 'ADMIN_PROFILE_UPDATE':
        return 'Administrator credentials or contact updated.';
      case 'ADMIN_PASSWORD_CHANGE':
        return 'Administrator security password was changed.';
      case 'ADMIN_PASSWORD_RESET':
        return 'Password reset requested for administrator.';
      case 'DRIVER_LOGIN':
        return 'Driver signed into mobile application.';
      case 'PARENT_TRACKING_ACCESSED':
        return 'Parent accessed secure live tracking web link.';
      case 'TRIP_STARTED':
        return 'Bus trip started by driver.';
      case 'TRIP_COMPLETED':
        return 'Bus trip reached final stop and completed.';
      case 'INCIDENT_REPORTED':
        return 'Transport incident reported from route.';
      case 'SOS_TRIGGERED':
        return 'SOS emergency button triggered by driver.';
      default:
        return `${action.replace(/_/g, ' ').toLowerCase()} on ${entityType.toLowerCase()}`;
    }
  }
}

