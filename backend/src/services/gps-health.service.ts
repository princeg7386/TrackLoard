import { query } from '../config/database.js';
import {
  GpsHealthStatus,
  GPS_THRESHOLDS,
  BusGpsHealthSummary,
  FleetGpsHealthOverview,
} from '@school-bus/shared';
import { NotFoundError } from '../middlewares/error.middleware.js';
import { logger } from './logger.service.js';

export class GpsHealthService {
  /**
   * Pure evaluation function determining GPS health state based on accuracy, age, and network
   */
  static calculateHealthStatus(params: {
    accuracyMeters?: number | null;
    recordedAt?: string | Date | null;
    isOnline?: boolean;
    hasActiveTrip?: boolean;
  }): GpsHealthStatus {
    if (params.isOnline === false) {
      return 'OFFLINE';
    }

    if (!params.recordedAt) {
      return 'OFFLINE';
    }

    const recordedTime = new Date(params.recordedAt).getTime();
    if (isNaN(recordedTime)) {
      return 'OFFLINE';
    }

    const now = Date.now();
    const ageSeconds = Math.max(0, Math.floor((now - recordedTime) / 1000));

    if (ageSeconds >= GPS_THRESHOLDS.SIGNAL_LOST_SECONDS) {
      return 'SIGNAL_LOST';
    }

    if (ageSeconds >= GPS_THRESHOLDS.STALE_SIGNAL_SECONDS) {
      return 'STALE_SIGNAL';
    }

    if (
      params.accuracyMeters != null &&
      params.accuracyMeters > GPS_THRESHOLDS.ACCURACY_MAX_ACCEPTABLE_METERS
    ) {
      return 'DEGRADED_ACCURACY';
    }

    return 'HEALTHY';
  }

  /**
   * Get dynamic GPS health summary for a single bus
   */
  static async getBusGpsHealth(busId: string): Promise<BusGpsHealthSummary> {
    const rows = await query<{
      id: string;
      bus_number: string;
      registration_number: string;
      last_latitude: number | null;
      last_longitude: number | null;
      last_speed_kmh: number | null;
      last_accuracy_meters: number | null;
      last_battery_percentage: number | null;
      last_is_charging: boolean | null;
      last_network_type: string | null;
      last_gps_recorded_at: string | null;
      active_trip_id: string | null;
    }>(
      `SELECT 
        b.id,
        b.bus_number,
        b.registration_number,
        b.last_latitude,
        b.last_longitude,
        b.last_speed_kmh,
        b.last_accuracy_meters,
        b.last_battery_percentage,
        b.last_is_charging,
        b.last_network_type,
        b.last_gps_recorded_at,
        t.id as active_trip_id
       FROM buses b
       LEFT JOIN trips t ON t.bus_id = b.id AND t.status IN ('IN_TRANSIT', 'DELAYED')
       WHERE b.id = $1 AND b.deleted_at IS NULL
       LIMIT 1;`,
      [busId]
    );

    const bus = rows[0];
    if (!bus) {
      throw new NotFoundError('Bus not found');
    }

    const ageSeconds = bus.last_gps_recorded_at
      ? Math.max(0, Math.floor((Date.now() - new Date(bus.last_gps_recorded_at).getTime()) / 1000))
      : undefined;

    const healthStatus = this.calculateHealthStatus({
      accuracyMeters: bus.last_accuracy_meters ? Number(bus.last_accuracy_meters) : null,
      recordedAt: bus.last_gps_recorded_at,
      hasActiveTrip: Boolean(bus.active_trip_id),
    });

    return {
      busId: bus.id,
      busNumber: bus.bus_number,
      registrationNumber: bus.registration_number,
      healthStatus,
      lastLatitude: bus.last_latitude != null ? Number(bus.last_latitude) : null,
      lastLongitude: bus.last_longitude != null ? Number(bus.last_longitude) : null,
      lastSpeedKmh: bus.last_speed_kmh != null ? Number(bus.last_speed_kmh) : null,
      lastAccuracyMeters: bus.last_accuracy_meters != null ? Number(bus.last_accuracy_meters) : null,
      lastBatteryPercentage: bus.last_battery_percentage != null ? Number(bus.last_battery_percentage) : null,
      lastIsCharging: bus.last_is_charging != null ? Boolean(bus.last_is_charging) : null,
      lastNetworkType: bus.last_network_type ?? null,
      lastRecordedAt: bus.last_gps_recorded_at ? new Date(bus.last_gps_recorded_at).toISOString() : null,
      ageSeconds,
      activeTripId: bus.active_trip_id ?? null,
    };
  }

  /**
   * Get fleet-wide GPS health overview for a school (Operational Dashboard)
   */
  static async getSchoolFleetGpsHealth(schoolId: string): Promise<FleetGpsHealthOverview> {
    const rows = await query<{
      id: string;
      bus_number: string;
      registration_number: string;
      last_latitude: number | null;
      last_longitude: number | null;
      last_speed_kmh: number | null;
      last_accuracy_meters: number | null;
      last_battery_percentage: number | null;
      last_is_charging: boolean | null;
      last_network_type: string | null;
      last_gps_recorded_at: string | null;
      active_trip_id: string | null;
    }>(
      `SELECT 
        b.id,
        b.bus_number,
        b.registration_number,
        b.last_latitude,
        b.last_longitude,
        b.last_speed_kmh,
        b.last_accuracy_meters,
        b.last_battery_percentage,
        b.last_is_charging,
        b.last_network_type,
        b.last_gps_recorded_at,
        t.id as active_trip_id
       FROM buses b
       LEFT JOIN trips t ON t.bus_id = b.id AND t.status IN ('IN_TRANSIT', 'DELAYED')
       WHERE b.school_id = $1 AND b.deleted_at IS NULL
       ORDER BY b.bus_number ASC;`,
      [schoolId]
    );

    let healthyCount = 0;
    let degradedCount = 0;
    let staleCount = 0;
    let lostCount = 0;
    let offlineCount = 0;

    const buses: BusGpsHealthSummary[] = rows.map((bus) => {
      const ageSeconds = bus.last_gps_recorded_at
        ? Math.max(0, Math.floor((Date.now() - new Date(bus.last_gps_recorded_at).getTime()) / 1000))
        : undefined;

      const healthStatus = this.calculateHealthStatus({
        accuracyMeters: bus.last_accuracy_meters ? Number(bus.last_accuracy_meters) : null,
        recordedAt: bus.last_gps_recorded_at,
        hasActiveTrip: Boolean(bus.active_trip_id),
      });

      switch (healthStatus) {
        case 'HEALTHY':
          healthyCount++;
          break;
        case 'DEGRADED_ACCURACY':
          degradedCount++;
          break;
        case 'STALE_SIGNAL':
          staleCount++;
          break;
        case 'SIGNAL_LOST':
          lostCount++;
          break;
        case 'OFFLINE':
        default:
          offlineCount++;
          break;
      }

      return {
        busId: bus.id,
        busNumber: bus.bus_number,
        registrationNumber: bus.registration_number,
        healthStatus,
        lastLatitude: bus.last_latitude != null ? Number(bus.last_latitude) : null,
        lastLongitude: bus.last_longitude != null ? Number(bus.last_longitude) : null,
        lastSpeedKmh: bus.last_speed_kmh != null ? Number(bus.last_speed_kmh) : null,
        lastAccuracyMeters: bus.last_accuracy_meters != null ? Number(bus.last_accuracy_meters) : null,
        lastBatteryPercentage: bus.last_battery_percentage != null ? Number(bus.last_battery_percentage) : null,
        lastIsCharging: bus.last_is_charging != null ? Boolean(bus.last_is_charging) : null,
        lastNetworkType: bus.last_network_type ?? null,
        lastRecordedAt: bus.last_gps_recorded_at ? new Date(bus.last_gps_recorded_at).toISOString() : null,
        ageSeconds,
        activeTripId: bus.active_trip_id ?? null,
      };
    });

    return {
      schoolId,
      totalBuses: buses.length,
      healthyCount,
      degradedCount,
      staleCount,
      lostCount,
      offlineCount,
      buses,
    };
  }
}

