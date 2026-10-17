'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Navigation,
  Plus,
  RefreshCw,
  AlertCircle,
  Bus,
  User,
  Clock,
  CheckCircle2,
  XCircle,
  MapPin,
  Play,
  School,
  Flag,
  Layers,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  type TripDetailResponse,
  type CreateTripRequest,
  type RouteDetail,
  TripStatus,
  TripLifecycleStage,
} from '@school-bus/shared';
import { TripApiService } from '../../../services/tripApi';
import { RouteApiService } from '../../../services/routeApi';
import { fetchBuses } from '../../../services/busApi';
import { fetchDrivers } from '../../../services/driverApi';
import { TripLifecycleBadge } from '../../../components/trip/TripLifecycleBadge';
import { EmptyState } from '../../../components/ui/EmptyState';

export default function TripsManagementPage() {
  const { user } = useAuth();
  const [schoolId, setSchoolId] = useState<string>(user?.schoolId || '');

  // Trips data state
  const [trips, setTrips] = useState<TripDetailResponse[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isGeneratingDaily, setIsGeneratingDaily] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Filters
  const [dateFilter, setDateFilter] = useState<string>(() => new Date().toISOString().split('T')[0]!);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Schedule Trip Modal State
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState<boolean>(false);
  const [routes, setRoutes] = useState<RouteDetail[]>([]);
  const [buses, setBuses] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string>('');
  const [selectedBusId, setSelectedBusId] = useState<string>('');
  const [selectedDriverId, setSelectedDriverId] = useState<string>('');
  const [scheduledStartTime, setScheduledStartTime] = useState<string>('07:30');
  const [isScheduling, setIsScheduling] = useState<boolean>(false);

  // Cancellation Modal State
  const [cancelTripId, setCancelTripId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<string>('');
  const [isCancelling, setIsCancelling] = useState<boolean>(false);

  // Active operating trip ID (spinner state)
  const [operatingTripId, setOperatingTripId] = useState<string | null>(null);

  // Sync schoolId
  useEffect(() => {
    if (user?.schoolId) {
      setSchoolId(user.schoolId);
    } else if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('sb_school_id');
      if (stored) setSchoolId(stored);
    }
  }, [user]);

  // Load Trips
  const loadTrips = useCallback(async () => {
    if (!schoolId) return;
    try {
      setIsLoading(true);
      setError(null);
      const data = await TripApiService.listTrips(schoolId, {
        date: dateFilter || undefined,
        status: statusFilter !== 'ALL' ? (statusFilter as TripStatus) : undefined,
      });
      setTrips(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load transit trips');
    } finally {
      setIsLoading(false);
    }
  }, [schoolId, dateFilter, statusFilter]);

  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  // Load options for Scheduling modal
  const openScheduleModal = async () => {
    if (!schoolId) return;
    setIsScheduleModalOpen(true);
    try {
      const [routesData, busesData, driversData] = await Promise.all([
        RouteApiService.listRoutes(schoolId),
        fetchBuses(schoolId),
        fetchDrivers(schoolId),
      ]);
      setRoutes(routesData);
      setBuses(busesData);
      setDrivers(driversData);

      if (routesData.length > 0) {
        const firstRoute = routesData[0]!;
        setSelectedRouteId(firstRoute.id);
        if (firstRoute.defaultBusId) setSelectedBusId(firstRoute.defaultBusId);
        if (firstRoute.defaultDriverId) setSelectedDriverId(firstRoute.defaultDriverId);
      }
    } catch (err: any) {
      setActionMessage({ text: 'Failed to load scheduling options', type: 'error' });
    }
  };

  // Route selection change updates default bus and driver
  const handleRouteChange = (routeId: string) => {
    setSelectedRouteId(routeId);
    const found = routes.find((r) => r.id === routeId);
    if (found?.defaultBusId) setSelectedBusId(found.defaultBusId);
    if (found?.defaultDriverId) setSelectedDriverId(found.defaultDriverId);
  };

  // Schedule trip submit
  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schoolId || !selectedRouteId || !selectedBusId || !selectedDriverId) {
      setActionMessage({ text: 'Please fill in all required scheduling fields', type: 'error' });
      return;
    }
    try {
      setIsScheduling(true);
      const payload: CreateTripRequest = {
        routeId: selectedRouteId,
        busId: selectedBusId,
        driverId: selectedDriverId,
        scheduledDate: dateFilter,
        scheduledStartTime,
      };
      await TripApiService.createTrip(schoolId, payload);
      setIsScheduleModalOpen(false);
      setActionMessage({ text: 'Trip scheduled successfully', type: 'success' });
      await loadTrips();
    } catch (err: any) {
      setActionMessage({ text: err?.message || 'Failed to schedule trip', type: 'error' });
    } finally {
      setIsScheduling(false);
    }
  };

  // Generate Daily Trips for Active Routes
  const handleGenerateDailyTrips = async () => {
    if (!schoolId) return;
    try {
      setIsGeneratingDaily(true);
      const res = await TripApiService.generateDailyTrips(schoolId, { scheduledDate: dateFilter });
      setActionMessage({
        text: `Daily trips generation completed: ${res.scheduledCount} scheduled, ${res.skippedCount} skipped (already scheduled).`,
        type: 'success',
      });
      await loadTrips();
    } catch (err: any) {
      setActionMessage({ text: err?.message || 'Failed to generate daily trips', type: 'error' });
    } finally {
      setIsGeneratingDaily(false);
    }
  };

  // Lifecycle Action Handlers
  const handleStartTrip = async (tripId: string) => {
    try {
      setOperatingTripId(tripId);
      const res = await TripApiService.startTrip(schoolId, tripId);
      const tokenNote =
        res.activatedTrackingTokens != null && res.activatedTrackingTokens > 0
          ? ` (${res.activatedTrackingTokens} parent tracking tokens activated)`
          : '';
      setActionMessage({ text: `Trip started successfully${tokenNote}`, type: 'success' });
      await loadTrips();
    } catch (err: any) {
      setActionMessage({ text: err?.message || 'Failed to start trip', type: 'error' });
    } finally {
      setOperatingTripId(null);
    }
  };

  const handleArriveSchool = async (tripId: string) => {
    try {
      setOperatingTripId(tripId);
      await TripApiService.arriveAtSchool(schoolId, tripId);
      setActionMessage({ text: 'School arrival recorded', type: 'success' });
      await loadTrips();
    } catch (err: any) {
      setActionMessage({ text: err?.message || 'Failed to record arrival', type: 'error' });
    } finally {
      setOperatingTripId(null);
    }
  };

  const handleCompleteTrip = async (tripId: string) => {
    try {
      setOperatingTripId(tripId);
      await TripApiService.completeTrip(schoolId, tripId);
      setActionMessage({ text: 'Trip completed successfully', type: 'success' });
      await loadTrips();
    } catch (err: any) {
      setActionMessage({ text: err?.message || 'Failed to complete trip', type: 'error' });
    } finally {
      setOperatingTripId(null);
    }
  };

  const handleCancelTripSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelTripId || !cancelReason.trim()) return;
    try {
      setIsCancelling(true);
      await TripApiService.cancelTrip(schoolId, cancelTripId, { reason: cancelReason.trim() });
      setCancelTripId(null);
      setCancelReason('');
      setActionMessage({ text: 'Trip cancelled', type: 'success' });
      await loadTrips();
    } catch (err: any) {
      setActionMessage({ text: err?.message || 'Failed to cancel trip', type: 'error' });
    } finally {
      setIsCancelling(false);
    }
  };

  // Metric counts
  const totalTrips = trips.length;
  const notStartedCount = trips.filter((t) => t.lifecycleStage === TripLifecycleStage.NOT_STARTED).length;
  const inTransitCount = trips.filter(
    (t) => t.lifecycleStage === TripLifecycleStage.STARTED || t.lifecycleStage === TripLifecycleStage.IN_TRANSIT
  ).length;
  const arrivedCount = trips.filter((t) => t.lifecycleStage === TripLifecycleStage.ARRIVED_SCHOOL).length;
  const completedCount = trips.filter((t) => t.status === TripStatus.COMPLETED).length;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Navigation className="w-5 h-5 text-indigo-600" />
            Trip Lifecycle & Operations
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Phase 16.2: Create today&apos;s trip, attach route, bus, driver & daily route generation
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => loadTrips()}
            disabled={isLoading}
            className="p-2 text-slate-600 hover:text-slate-900 border border-slate-200 rounded-md bg-white hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-50"
            title="Refresh trips"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handleGenerateDailyTrips}
            disabled={isLoading || isGeneratingDaily}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-md transition-colors shadow-sm disabled:opacity-50"
            title="Automatically generate today's trips for all active routes"
          >
            <Layers className={`w-3.5 h-3.5 text-indigo-600 ${isGeneratingDaily ? 'animate-spin' : ''}`} />
            {isGeneratingDaily ? 'Generating...' : "Generate Today's Trips"}
          </button>

          <button
            onClick={openScheduleModal}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            Schedule Trip
          </button>
        </div>
      </div>

      {/* Action Banner / Notification */}
      {actionMessage && (
        <div
          className={`p-3 rounded-lg text-xs font-medium flex items-center justify-between border ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          <span>{actionMessage.text}</span>
          <button onClick={() => setActionMessage(null)} className="ml-2 font-bold hover:opacity-75">
            ✕
          </button>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Total Scheduled</p>
          <p className="text-xl font-bold text-slate-900 mt-1">{totalTrips}</p>
        </div>
        <div className="p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Not Started</p>
          <p className="text-xl font-bold text-slate-600 mt-1">{notStartedCount}</p>
        </div>
        <div className="p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
          <p className="text-[11px] font-medium text-emerald-600 uppercase tracking-wider">In Transit</p>
          <p className="text-xl font-bold text-emerald-700 mt-1">{inTransitCount}</p>
        </div>
        <div className="p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
          <p className="text-[11px] font-medium text-sky-600 uppercase tracking-wider">Arrived Campus</p>
          <p className="text-xl font-bold text-sky-700 mt-1">{arrivedCount}</p>
        </div>
        <div className="p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Completed</p>
          <p className="text-xl font-bold text-slate-800 mt-1">{completedCount}</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 bg-white p-3 border border-slate-200 rounded-lg shadow-sm">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-600">Date:</label>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-slate-600">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
          >
            <option value="ALL">All Statuses</option>
            <option value={TripStatus.SCHEDULED}>Scheduled</option>
            <option value={TripStatus.IN_TRANSIT}>In Transit</option>
            <option value={TripStatus.COMPLETED}>Completed</option>
            <option value={TripStatus.CANCELLED}>Cancelled</option>
          </select>
        </div>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="p-12 text-center bg-white border border-slate-200 rounded-lg shadow-sm">
          <RefreshCw className="w-6 h-6 text-indigo-600 animate-spin mx-auto mb-2" />
          <p className="text-xs text-slate-500">Loading trips and operational states...</p>
        </div>
      ) : error ? (
        <div className="p-6 text-center bg-rose-50 border border-rose-200 rounded-lg">
          <AlertCircle className="w-6 h-6 text-rose-600 mx-auto mb-2" />
          <p className="text-xs font-medium text-rose-800">{error}</p>
          <button
            onClick={() => loadTrips()}
            className="mt-3 px-3 py-1.5 text-xs font-semibold text-rose-700 bg-white border border-rose-300 rounded hover:bg-rose-50"
          >
            Retry
          </button>
        </div>
      ) : trips.length === 0 ? (
        <EmptyState
          title="No Trips Scheduled for Selected Filters"
          description="Schedule a new morning or afternoon trip for your fleet and routes to begin tracking live operations."
          actionLabel="Schedule Trip"
          onAction={openScheduleModal}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-4 py-3">Route & ID</th>
                  <th className="px-4 py-3">Bus</th>
                  <th className="px-4 py-3">Driver</th>
                  <th className="px-4 py-3">Schedule</th>
                  <th className="px-4 py-3">Milestones & Progress</th>
                  <th className="px-4 py-3">Lifecycle Stage</th>
                  <th className="px-4 py-3 text-right">Operational Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {trips.map((trip) => {
                  const isOperating = operatingTripId === trip.id;
                  const isScheduled = trip.lifecycleStage === TripLifecycleStage.NOT_STARTED;
                  const isInTransit =
                    trip.lifecycleStage === TripLifecycleStage.STARTED ||
                    trip.lifecycleStage === TripLifecycleStage.IN_TRANSIT ||
                    trip.lifecycleStage === TripLifecycleStage.ARRIVED_SCHOOL;
                  const isArrived = trip.lifecycleStage === TripLifecycleStage.ARRIVED_SCHOOL;
                  const isCompleted = trip.status === TripStatus.COMPLETED;
                  const isCancelled = trip.status === TripStatus.CANCELLED;

                  return (
                    <tr key={trip.id} className="hover:bg-slate-50/75 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{trip.routeName || 'Transit Route'}</div>
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                          {trip.routeCode || trip.id.substring(0, 8)}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 font-medium text-slate-800">
                          <Bus className="w-3.5 h-3.5 text-slate-400" />
                          <span>{trip.busNumber || 'Bus'}</span>
                        </div>
                        {trip.busRegistrationNumber && (
                          <div className="text-[11px] text-slate-500 font-mono ml-5">
                            {trip.busRegistrationNumber}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 font-medium text-slate-800">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <span>{trip.driverName || 'Driver'}</span>
                        </div>
                        {trip.driverPhone && (
                          <div className="text-[11px] text-slate-500 font-mono ml-5">
                            {trip.driverPhone}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 text-slate-700">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span className="font-semibold">{trip.scheduledStartTime}</span>
                        </div>
                        <div className="text-[11px] text-slate-500">{trip.scheduledDate}</div>
                        {trip.actualStartTime && (
                          <div className="text-[10px] text-emerald-700 font-medium mt-0.5">
                            Started: {new Date(trip.actualStartTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-[11px] text-slate-600">
                            <MapPin className="w-3 h-3 text-slate-400" />
                            <span>
                              Stop {trip.currentStopSequence} of {trip.totalStops ?? '—'}
                            </span>
                          </div>
                          {trip.delayMinutes > 0 && (
                            <span className="inline-block text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                              +{trip.delayMinutes} min delay
                            </span>
                          )}
                          {trip.arrivedSchoolTime && (
                            <div className="text-[10px] text-sky-700 font-medium">
                              Campus arrival: {new Date(trip.arrivedSchoolTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <TripLifecycleBadge stage={trip.lifecycleStage} status={trip.status} />
                          {trip.trackingSessionActive && (
                            <div className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              Tracking Active
                            </div>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {/* Start Trip Action */}
                          {isScheduled && !isCancelled && (
                            <button
                              onClick={() => handleStartTrip(trip.id)}
                              disabled={isOperating}
                              className="px-2.5 py-1 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded transition-colors shadow-xs disabled:opacity-50 inline-flex items-center gap-1"
                            >
                              <Play className="w-3 h-3" />
                              Start
                            </button>
                          )}

                          {/* Record Arrival Action */}
                          {isInTransit && !isArrived && (
                            <button
                              onClick={() => handleArriveSchool(trip.id)}
                              disabled={isOperating}
                              className="px-2.5 py-1 text-[11px] font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded transition-colors shadow-xs disabled:opacity-50 inline-flex items-center gap-1"
                              title="Mark bus arrival at school destination"
                            >
                              <School className="w-3 h-3" />
                              Arrived School
                            </button>
                          )}

                          {/* Complete Trip Action */}
                          {isInTransit && (
                            <button
                              onClick={() => handleCompleteTrip(trip.id)}
                              disabled={isOperating}
                              className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded transition-colors disabled:opacity-50 inline-flex items-center gap-1"
                            >
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Complete
                            </button>
                          )}

                          {/* Cancel Trip Action */}
                          {!isCompleted && !isCancelled && (
                            <button
                              onClick={() => setCancelTripId(trip.id)}
                              disabled={isOperating}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                              title="Cancel trip"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Schedule Trip Modal */}
      {isScheduleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Flag className="w-4 h-4 text-indigo-600" />
                Schedule New Transit Trip
              </h3>
              <button
                onClick={() => setIsScheduleModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleScheduleSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Transit Route *</label>
                <select
                  value={selectedRouteId}
                  onChange={(e) => handleRouteChange(e.target.value)}
                  required
                  className="w-full px-2.5 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
                >
                  <option value="">Select Route</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.code})
                    </option>
                  ))}
                </select>
              </div>

              {selectedRouteId && (
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-md text-[11px] space-y-1 text-slate-600">
                  <div className="font-semibold text-slate-800">Route Attached Defaults:</div>
                  <div className="flex items-center justify-between">
                    <span>Default Vehicle:</span>
                    <span className="font-mono text-slate-900 font-medium">
                      {buses.find((b) => b.id === routes.find((r) => r.id === selectedRouteId)?.defaultBusId)?.busNumber || 'None (Custom attach below)'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Default Operator:</span>
                    <span className="text-slate-900 font-medium">
                      {drivers.find((d) => d.id === routes.find((r) => r.id === selectedRouteId)?.defaultDriverId)?.fullName || 'None (Custom attach below)'}
                    </span>
                  </div>
                </div>
              )}

              <div>
                <label className="block font-medium text-slate-700 mb-1">Assigned Bus *</label>
                <select
                  value={selectedBusId}
                  onChange={(e) => setSelectedBusId(e.target.value)}
                  required
                  className="w-full px-2.5 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
                >
                  <option value="">Select Bus</option>
                  {buses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.busNumber} ({b.registrationNumber})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Assigned Driver *</label>
                <select
                  value={selectedDriverId}
                  onChange={(e) => setSelectedDriverId(e.target.value)}
                  required
                  className="w-full px-2.5 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
                >
                  <option value="">Select Driver</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fullName} ({d.phone})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Scheduled Date *</label>
                  <input
                    type="date"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    required
                    className="w-full px-2.5 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Start Time *</label>
                  <input
                    type="time"
                    value={scheduledStartTime}
                    onChange={(e) => setScheduledStartTime(e.target.value)}
                    required
                    className="w-full px-2.5 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsScheduleModalOpen(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 border border-slate-200 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isScheduling}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors disabled:opacity-50"
                >
                  {isScheduling ? 'Scheduling...' : 'Schedule Trip'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Trip Confirmation Modal */}
      {cancelTripId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-sm w-full p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600" />
              Cancel Trip
            </h3>
            <p className="text-xs text-slate-600">
              Are you sure you want to cancel this trip? Please record a cancellation reason for operational audit logs.
            </p>

            <form onSubmit={handleCancelTripSubmit} className="space-y-3 text-xs">
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Reason for cancellation (e.g., Road blockage, heavy weather, breakdown)..."
                required
                rows={3}
                className="w-full p-2.5 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-rose-500"
              />

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setCancelTripId(null);
                    setCancelReason('');
                  }}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 border border-slate-200 rounded-md"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={isCancelling || !cancelReason.trim()}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-md transition-colors disabled:opacity-50"
                >
                  {isCancelling ? 'Cancelling...' : 'Confirm Cancel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
