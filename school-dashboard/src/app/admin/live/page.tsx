'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Radio,
  Bus,
  Users,
  ShieldCheck,
  RefreshCw,
  WifiOff,
  AlertCircle,
  Navigation,
  Clock,
  Gauge,
  Phone,
  UserCheck,
  X,
} from 'lucide-react';
import { EmptyState } from '../../../components/ui/EmptyState';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { fetchDashboardSummary, DashboardMetricSummary } from '../../../services/dashboardApi';
import {
  getFleetHealth,
  getBusState,
  getTripTrail,
  openSchoolFeed,
  openBusFeed,
  FeedConnectionStatus,
  ResilientFeedSubscription,
} from '../../../services/telemetryApi';
import { BusStatePanel } from '../../../components/live/BusStatePanel';
import { SchoolMapFeedCanvas } from '../../../components/live/SchoolMapFeedCanvas';
import { useAuth } from '../../../contexts/AuthContext';
import type {
  BusGpsHealthSummary,
  ActiveTripStateResponse,
  TelemetryFeedEvent,
} from '@school-bus/shared';

type ViewState = 'loading' | 'success' | 'error' | 'unauthorized' | 'offline';

export default function LiveOperationsPage() {
  const { user } = useAuth();
  const schoolId =
    user?.schoolId ||
    (typeof window !== 'undefined' ? localStorage.getItem('sb_school_id') || '' : '');

  const [metrics, setMetrics] = useState<DashboardMetricSummary | null>(null);
  const [activeTripsCount, setActiveTripsCount] = useState<number>(0);
  const [buses, setBuses] = useState<BusGpsHealthSummary[]>([]);
  const [selectedBusState, setSelectedBusState] = useState<ActiveTripStateResponse | null>(null);
  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const [tripTrail, setTripTrail] = useState<Array<{ latitude: number; longitude: number; speedKmh: number; recordedAt: string }>>([]);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [feedStatus, setFeedStatus] = useState<FeedConnectionStatus>('CONNECTING');
  const [lastFeedPing, setLastFeedPing] = useState<string>('Connecting...');

  const feedSubRef = useRef<ResilientFeedSubscription | null>(null);

  // Online / offline listener
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if (typeof navigator !== 'undefined' && !navigator.onLine) setIsOffline(true);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loadData = useCallback(async () => {
    if (!schoolId) {
      setViewState('unauthorized');
      return;
    }
    setViewState('loading');
    setErrorMessage('');
    try {
      const [summary, healthOverview] = await Promise.all([
        fetchDashboardSummary(schoolId),
        getFleetHealth(schoolId),
      ]);

      setMetrics(summary.metrics);
      setActiveTripsCount(summary.transportStatus.inProgressTrips);
      setBuses(healthOverview.buses);
      setViewState('success');
    } catch (err: any) {
      if (err.message === 'UNAUTHORIZED') {
        setViewState('unauthorized');
      } else {
        setErrorMessage(err.message || 'Failed to load live operations data.');
        setViewState('error');
      }
    }
  }, [schoolId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Real-time SSE Live Telemetry Feed (Subscription by School with auto-reconnect)
  useEffect(() => {
    if (!schoolId || typeof window === 'undefined') return;

    const sub = openSchoolFeed(
      schoolId,
      (msgEvent: MessageEvent) => {
        try {
          const data = JSON.parse(msgEvent.data);
          if (msgEvent.type === 'initial_state') {
            if (data?.buses) {
              setBuses(data.buses);
            }
          } else if (msgEvent.type === 'location_update') {
            const event = data as TelemetryFeedEvent;
            setLastFeedPing(new Date().toLocaleTimeString());

            setBuses((prev) =>
              prev.map((b) => {
                if (b.busId === event.busId) {
                  return {
                    ...b,
                    lastLatitude: event.latitude !== undefined ? event.latitude : b.lastLatitude,
                    lastLongitude: event.longitude !== undefined ? event.longitude : b.lastLongitude,
                    lastSpeedKmh: event.speedKmh !== undefined ? event.speedKmh : b.lastSpeedKmh,
                    lastAccuracyMeters: event.accuracyMeters !== undefined ? event.accuracyMeters : b.lastAccuracyMeters,
                    lastBatteryPercentage: event.batteryPercentage !== undefined ? event.batteryPercentage : b.lastBatteryPercentage,
                    lastIsCharging: event.isCharging !== undefined ? event.isCharging : b.lastIsCharging,
                    lastNetworkType: event.networkType !== undefined ? event.networkType : b.lastNetworkType,
                    lastRecordedAt: event.recordedAt ?? b.lastRecordedAt,
                    healthStatus: event.healthStatus ?? b.healthStatus,
                    activeTripId: event.tripId || b.activeTripId,
                  };
                }
                return b;
              })
            );

            // Update selected detail in real-time if selected
            setSelectedBusState((current) => {
              if (current && current.busId === event.busId) {
                return {
                  ...current,
                  lastLatitude: event.latitude !== undefined ? event.latitude : current.lastLatitude,
                  lastLongitude: event.longitude !== undefined ? event.longitude : current.lastLongitude,
                  lastSpeedKmh: event.speedKmh !== undefined ? event.speedKmh : current.lastSpeedKmh,
                  lastBearingDegrees: event.bearingDegrees !== undefined ? event.bearingDegrees : current.lastBearingDegrees,
                  lastAccuracyMeters: event.accuracyMeters !== undefined ? event.accuracyMeters : current.lastAccuracyMeters,
                  lastBatteryPercentage: event.batteryPercentage !== undefined ? event.batteryPercentage : current.lastBatteryPercentage,
                  lastIsCharging: event.isCharging !== undefined ? event.isCharging : current.lastIsCharging,
                  lastNetworkType: event.networkType !== undefined ? event.networkType : current.lastNetworkType,
                  lastGpsRecordedAt: event.recordedAt ?? current.lastGpsRecordedAt,
                  gpsHealthStatus: event.healthStatus ?? current.gpsHealthStatus,
                  gpsAgeSeconds: 0,
                };
              }
              return current;
            });
          }
        } catch {
          // Ignore parse errors on heartbeat comments
        }
      },
      (status) => {
        setFeedStatus(status);
        if (status === 'CONNECTED') {
          setLastFeedPing(new Date().toLocaleTimeString());
        }
      }
    );

    feedSubRef.current = sub;

    return () => {
      sub.close();
    };
  }, [schoolId]);

  const handleSelectBus = async (bus: BusGpsHealthSummary) => {
    setSelectedBusId(bus.busId);
    setIsLoadingDetail(true);
    setTripTrail([]);
    try {
      const state = await getBusState(schoolId, bus.busId);
      setSelectedBusState(state);

      if (state.tripId) {
        try {
          const trailRes = await getTripTrail(state.tripId, 100);
          if (trailRes?.trail) {
            setTripTrail(trailRes.trail);
          }
        } catch {
          // Trail optional
        }
      }
    } catch {
      // Fallback: minimal view
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const fleetOnline = metrics ? `${activeTripsCount} / ${metrics.totalBuses}` : '— / —';

  return (
    <div className="space-y-6">
      {/* Offline Banner */}
      {isOffline && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between text-amber-900 text-xs">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
            <span>You are currently offline. Live fleet data may be stale.</span>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="px-2 py-1 bg-amber-200 hover:bg-amber-300 font-semibold rounded text-amber-900"
          >
            Retry
          </button>
        </div>
      )}

      {/* Error Banner */}
      {viewState === 'error' && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center justify-between text-rose-900 text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-md"
          >
            Retry
          </button>
        </div>
      )}

      {/* Top Telemetry Metric Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active Trips */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Trips</div>
            <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
              {viewState === 'loading' ? (
                <span className="inline-block w-8 h-7 bg-slate-100 rounded animate-pulse" />
              ) : (
                activeTripsCount
              )}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">Morning &amp; Evening routes</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-700">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
        </div>

        {/* Fleet Online */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Fleet Online</div>
            <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
              {viewState === 'loading' ? (
                <span className="inline-block w-14 h-7 bg-slate-100 rounded animate-pulse" />
              ) : (
                fleetOnline
              )}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">GPS telemetry connected</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
            <Bus className="w-5 h-5" />
          </div>
        </div>

        {/* Students */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Students In-Transit</div>
            <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
              {viewState === 'loading' ? (
                <span className="inline-block w-8 h-7 bg-slate-100 rounded animate-pulse" />
              ) : (
                metrics?.totalStudents ?? 0
              )}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">Enrolled in active routes</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
            <Users className="w-5 h-5" />
          </div>
        </div>

        {/* Alerts */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Alerts</div>
            <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
              {viewState === 'loading' ? (
                <span className="inline-block w-8 h-7 bg-slate-100 rounded animate-pulse" />
              ) : (
                (metrics?.activeIncidentsCount ?? 0) + (metrics?.activeDelaysCount ?? 0)
              )}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">SOS or route deviations</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-600">
            <ShieldCheck
              className={`w-5 h-5 ${
                ((metrics?.activeIncidentsCount ?? 0) + (metrics?.activeDelaysCount ?? 0)) > 0
                  ? 'text-rose-600'
                  : 'text-emerald-600'
              }`}
            />
          </div>
        </div>
      </div>

      {/* Header + Refresh & Live indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold text-slate-800 tracking-tight">Live Fleet State &amp; Tracking</h1>
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-2xs font-mono font-medium border ${
              feedStatus === 'CONNECTED'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : feedStatus === 'RECONNECTING'
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-slate-100 text-slate-600 border-slate-200'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                feedStatus === 'CONNECTED'
                  ? 'bg-emerald-500 animate-pulse'
                  : feedStatus === 'RECONNECTING'
                  ? 'bg-amber-500 animate-ping'
                  : 'bg-slate-400'
              }`}
            />
            {feedStatus === 'CONNECTED'
              ? `Live SSE (${lastFeedPing})`
              : feedStatus === 'RECONNECTING'
              ? 'Reconnecting...'
              : 'Feed Offline'}
          </span>
        </div>
        <button
          type="button"
          onClick={loadData}
          title="Refresh live data"
          className="p-1.5 bg-white hover:bg-slate-50 text-slate-500 rounded border border-slate-200 shadow-2xs cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${viewState === 'loading' ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Main Operational Canvas & Active Bus State Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: School Map Canvas & Fleet Bus States */}
        <div className="lg:col-span-2 space-y-4">
          {/* Live School Map Feed Canvas */}
          <SchoolMapFeedCanvas
            buses={buses}
            selectedBusId={selectedBusId}
            selectedBusDetail={selectedBusState}
            onSelectBus={handleSelectBus}
            tripTrail={tripTrail}
            isLoading={viewState === 'loading'}
          />

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-800 tracking-tight">Active Fleet Units</h2>
                <StatusBadge
                  status={buses.length > 0 ? 'normal' : 'inactive'}
                  label={`${buses.length} Vehicles`}
                />
              </div>
              <div className="text-xs text-slate-500">Live PostGIS Ingestion Cache</div>
            </div>

            <div className="p-4 space-y-3">
              {viewState === 'loading' ? (
                <div className="p-8 text-center text-slate-400 text-xs animate-pulse">
                  Loading fleet state...
                </div>
              ) : buses.length === 0 ? (
                <EmptyState
                  icon={Radio}
                  title="No Registered Buses Found"
                  description="Add fleet buses to your directory to begin monitoring live GPS telemetry and active route trips."
                  actionLabel="Add Bus"
                  actionHref="/admin/buses"
                />
              ) : (
                buses.map((bus) => (
                  <BusStatePanel
                    key={bus.busId}
                    bus={bus}
                    isSelected={selectedBusId === bus.busId}
                    onSelect={handleSelectBus}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Selected Bus & Active Trip State Detail */}
        <div className="lg:col-span-1">
          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs sticky top-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Navigation className="w-4 h-4 text-indigo-600" />
                Current Vehicle State
              </h3>
              {selectedBusState && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedBusId(null);
                    setSelectedBusState(null);
                  }}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {isLoadingDetail ? (
              <div className="py-12 text-center text-slate-400 text-xs animate-pulse">
                Fetching bus telemetry state...
              </div>
            ) : selectedBusState ? (
              <div className="space-y-4 text-xs">
                {/* Vehicle Header */}
                <div>
                  <div className="text-sm font-bold text-slate-900">{selectedBusState.busNumber}</div>
                  <div className="text-slate-500 font-mono mt-0.5">{selectedBusState.registrationNumber}</div>
                  {selectedBusState.makeModel && (
                    <div className="text-slate-400 mt-0.5">{selectedBusState.makeModel}</div>
                  )}
                </div>

                {/* Trip State Card */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700">Trip State</span>
                    <span
                      className={`px-2 py-0.5 rounded text-2xs font-semibold ${
                        selectedBusState.tripStatus === 'IN_TRANSIT'
                          ? 'bg-emerald-100 text-emerald-800'
                          : selectedBusState.tripStatus === 'ARRIVED_SCHOOL'
                          ? 'bg-sky-100 text-sky-800'
                          : selectedBusState.tripStatus === 'DELAYED'
                          ? 'bg-amber-100 text-amber-800'
                          : selectedBusState.tripStatus === 'EMERGENCY'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {selectedBusState.tripStatus || 'NO ACTIVE TRIP'}
                    </span>
                  </div>

                  {selectedBusState.routeName && (
                    <div>
                      <span className="text-slate-400 block text-2xs">Assigned Route</span>
                      <span className="font-medium text-slate-800">
                        {selectedBusState.routeName} ({selectedBusState.routeCode})
                      </span>
                    </div>
                  )}

                  {selectedBusState.currentStopSequence != null && (
                    <div className="flex justify-between text-slate-600 pt-1 border-t border-slate-200">
                      <span>Stop Progress:</span>
                      <span className="font-medium">Stop #{selectedBusState.currentStopSequence}</span>
                    </div>
                  )}

                  {selectedBusState.delayMinutes != null && selectedBusState.delayMinutes > 0 && (
                    <div className="flex justify-between text-amber-700 font-medium">
                      <span>Delay:</span>
                      <span>+{selectedBusState.delayMinutes} mins</span>
                    </div>
                  )}
                </div>

                {/* Driver Info */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
                  <div className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-slate-500" /> Driver
                  </div>
                  {selectedBusState.driverName ? (
                    <>
                      <div className="font-medium text-slate-900">{selectedBusState.driverName}</div>
                      {selectedBusState.driverPhone && (
                        <div className="text-slate-500 flex items-center gap-1">
                          <Phone className="w-3 h-3" /> {selectedBusState.driverPhone}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-slate-400 italic">No driver assigned</div>
                  )}
                </div>

                {/* Live GPS Telemetry */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                  <div className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <Gauge className="w-3.5 h-3.5 text-slate-500" /> Live Kinematics
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-2xs">
                    <div>
                      <span className="text-slate-400 block">Speed</span>
                      <span className="font-bold text-slate-800 text-xs">
                        {selectedBusState.lastSpeedKmh != null
                          ? `${Math.round(selectedBusState.lastSpeedKmh)} km/h`
                          : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Health</span>
                      <span className="font-semibold text-slate-800">{selectedBusState.gpsHealthStatus}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-400 block">Coordinates</span>
                      <span className="font-mono text-slate-700 truncate block">
                        {selectedBusState.lastLatitude != null && selectedBusState.lastLongitude != null
                          ? `${selectedBusState.lastLatitude.toFixed(6)}, ${selectedBusState.lastLongitude.toFixed(6)}`
                          : 'No fix recorded'}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-400 block">Last Recorded Ping</span>
                      <span className="text-slate-600 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-400" />
                        {selectedBusState.lastGpsRecordedAt
                          ? new Date(selectedBusState.lastGpsRecordedAt).toLocaleString()
                          : 'Never'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
                <Bus className="w-8 h-8 text-slate-300" />
                <span>Select a vehicle from the list to view its real-time telemetry and active trip details.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
