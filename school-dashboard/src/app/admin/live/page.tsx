'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Radio, Bus, Users, ShieldCheck, RefreshCw, WifiOff, AlertCircle } from 'lucide-react';
import { EmptyState } from '../../../components/ui/EmptyState';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { fetchDashboardSummary, DashboardMetricSummary } from '../../../services/dashboardApi';
import { useAuth } from '../../../contexts/AuthContext';

type ViewState = 'loading' | 'success' | 'error' | 'unauthorized' | 'offline';

export default function LiveOperationsPage() {
  const { user } = useAuth();
  const schoolId =
    user?.schoolId ||
    (typeof window !== 'undefined' ? localStorage.getItem('sb_school_id') || '' : '');

  const [metrics, setMetrics] = useState<DashboardMetricSummary | null>(null);
  const [activeTripsCount, setActiveTripsCount] = useState<number>(0);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isOffline, setIsOffline] = useState<boolean>(false);

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

  const loadSummary = useCallback(async () => {
    if (!schoolId) {
      setViewState('unauthorized');
      return;
    }
    setViewState('loading');
    setErrorMessage('');
    try {
      const summary = await fetchDashboardSummary(schoolId);
      setMetrics(summary.metrics);
      setActiveTripsCount(summary.transportStatus.inProgressTrips);
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
    loadSummary();
  }, [loadSummary]);

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
            onClick={loadSummary}
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
            onClick={loadSummary}
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

      {/* Header + Refresh */}
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-bold text-slate-800 tracking-tight">Live Fleet Map &amp; Dispatch</h1>
        <button
          type="button"
          onClick={loadSummary}
          title="Refresh live data"
          className="p-1.5 bg-white hover:bg-slate-50 text-slate-500 rounded border border-slate-200 shadow-2xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${viewState === 'loading' ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Main Operational Canvas */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-800 tracking-tight">Live Dispatch Canvas</h2>
            <StatusBadge
              status={activeTripsCount > 0 ? 'normal' : 'inactive'}
              label={activeTripsCount > 0 ? `${activeTripsCount} Live` : 'Standby'}
            />
          </div>
          <div className="text-xs text-slate-500">Live PostGIS Spatial Stream</div>
        </div>

        <div className="p-12 flex flex-col items-center justify-center min-h-[420px] bg-slate-50/30">
          <EmptyState
            icon={Radio}
            title="No Active Bus Trips Running"
            description="When drivers start trips from their mobile app, real-time GPS locations, route adherence, and pickup status will stream live here."
            actionLabel="View Fleet Directory"
            actionHref="/admin/buses"
            secondaryActionLabel="Manage Routes"
            secondaryActionHref="/admin/routes"
          />
        </div>
      </div>
    </div>
  );
}
