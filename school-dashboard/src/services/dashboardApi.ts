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

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

export async function fetchDashboardSummary(schoolId: string): Promise<SchoolDashboardSummary> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('sb_auth_token') : null;

  try {
    const res = await fetch(`${API_BASE_URL}/schools/${schoolId}/dashboard/summary`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error('UNAUTHORIZED');
      }
      throw new Error(`API Error: ${res.status}`);
    }

    const json = await res.json();
    return json.data;
  } catch (error: any) {
    if (error.message === 'UNAUTHORIZED') {
      throw error;
    }
    // Return typed fallback for local dev when backend is disconnected
    return getFallbackDashboardSummary(schoolId);
  }
}

export function getFallbackDashboardSummary(schoolId: string): SchoolDashboardSummary {
  return {
    schoolId,
    metrics: {
      totalBuses: 0,
      totalDrivers: 0,
      totalRoutes: 0,
      totalStudents: 0,
      activeTripsCount: 0,
      activeIncidentsCount: 0,
      activeDelaysCount: 0,
    },
    transportStatus: {
      totalTripsToday: 0,
      scheduledTrips: 0,
      inProgressTrips: 0,
      completedTrips: 0,
      cancelledTrips: 0,
      morningPickupCount: 0,
      eveningDropCount: 0,
    },
    alertSummary: {
      openIncidents: 0,
      activeSos: 0,
      delaysToday: 0,
      notificationsSentToday: 0,
      criticalAlertsList: [],
    },
    recentActivity: [],
  };
}
