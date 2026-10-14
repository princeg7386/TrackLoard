'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Radio,
  Bus,
  Users,
  MapPin,
  GraduationCap,
  AlertCircle,
  RefreshCw,
  Plus,
  WifiOff,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import {
  fetchDashboardSummary,
  SchoolDashboardSummary,
  getFallbackDashboardSummary,
} from '../../services/dashboardApi';
import { DashboardMetricsCards } from '../../components/dashboard/DashboardMetricsCards';
import { TransportStatusSummary } from '../../components/dashboard/TransportStatusSummary';
import { AlertSummaryCard } from '../../components/dashboard/AlertSummaryCard';
import { RecentActivityFeed } from '../../components/dashboard/RecentActivityFeed';
import { EmptyState } from '../../components/ui/EmptyState';

type ViewState =
  | 'loading'
  | 'success'
  | 'empty'
  | 'error'
  | 'unauthorized'
  | 'offline';

export default function AdminOverviewPage() {
  const { user } = useAuth();
  const [schoolId, setSchoolId] = useState<string>(user?.schoolId || '');
  const [data, setData] = useState<SchoolDashboardSummary | null>(null);
  const [viewState, setViewState] = useState<ViewState>(user?.schoolId ? 'loading' : 'unauthorized');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isOffline, setIsOffline] = useState<boolean>(false);

  useEffect(() => {
    if (user?.schoolId) {
      setSchoolId(user.schoolId);
    } else if (typeof window !== 'undefined') {
      const storedId = localStorage.getItem('sb_school_id');
      if (storedId) setSchoolId(storedId);
    }
  }, [user]);

  // Online / Offline monitor
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOffline(true);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!schoolId) {
      setViewState('unauthorized');
      return;
    }
    setViewState('loading');
    setErrorMessage('');

    try {
      const summary = await fetchDashboardSummary(schoolId);
      setData(summary);

      const isEntirelyEmpty =
        summary.metrics.totalBuses === 0 &&
        summary.metrics.totalRoutes === 0 &&
        summary.metrics.totalDrivers === 0 &&
        summary.metrics.totalStudents === 0;

      if (isEntirelyEmpty) {
        setViewState('empty');
      } else {
        setViewState('success');
      }
    } catch (err: any) {
      if (err.message === 'UNAUTHORIZED') {
        setViewState('unauthorized');
      } else {
        setErrorMessage(err.message || 'Failed to load transport dashboard summary.');
        setViewState('error');
        // Load fallback data for resilient view
        setData(getFallbackDashboardSummary(schoolId));
      }
    }
  }, [schoolId]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  return (
    <div className="space-y-6">
      {/* Offline Banner */}
      {isOffline && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between text-amber-900 text-xs">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
            <span>You are currently offline. Showing cached transport data.</span>
          </div>
          <button
            type="button"
            onClick={loadDashboard}
            className="px-2 py-1 bg-amber-200 hover:bg-amber-300 font-semibold rounded text-amber-900"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Overview Header & Quick Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Transport Command Center
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time fleet operations, trip progress, safety alerts, and parent tracking telemetry.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={loadDashboard}
            title="Refresh Metrics"
            className="p-2 bg-white hover:bg-slate-50 text-slate-600 rounded-md border border-slate-300 shadow-2xs transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${viewState === 'loading' ? 'animate-spin' : ''}`} />
          </button>

          <Link
            href="/admin/live"
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-md shadow-xs transition-colors"
          >
            <Radio className="w-4 h-4 animate-pulse" />
            Live Dispatch Map
          </Link>
        </div>
      </div>

      {/* 1. Loading State */}
      {viewState === 'loading' && (
        <div className="space-y-6 animate-pulse">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-28 bg-white border border-slate-200 rounded-lg p-4" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-64 bg-white border border-slate-200 rounded-lg" />
            <div className="h-64 bg-white border border-slate-200 rounded-lg" />
          </div>
        </div>
      )}

      {/* 2. Unauthorized State */}
      {viewState === 'unauthorized' && (
        <div className="p-8 bg-white border border-rose-200 rounded-lg text-center">
          <AlertCircle className="w-8 h-8 text-rose-600 mx-auto mb-2" />
          <h2 className="text-base font-bold text-slate-900">Session Expired or Unauthorized</h2>
          <p className="text-xs text-slate-500 mt-1 mb-4">
            Please sign in again to access the transport dashboard.
          </p>
          <Link
            href="/login"
            className="px-4 py-2 bg-sky-600 text-white text-xs font-semibold rounded-md shadow-xs inline-block"
          >
            Return to Login
          </Link>
        </div>
      )}

      {/* 3. Failure / Error State */}
      {viewState === 'error' && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex items-center justify-between text-rose-900 text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage || 'Failed to load telemetry summary.'}</span>
          </div>
          <button
            type="button"
            onClick={loadDashboard}
            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-md shadow-2xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* 4. Empty State (No transport setup yet) */}
      {viewState === 'empty' && data && (
        <div className="space-y-6">
          <DashboardMetricsCards metrics={data.metrics} />
          <div className="bg-white border border-slate-200 rounded-lg p-8">
            <EmptyState
              icon={Bus}
              title="Welcome to Transport Management"
              description="Get started by onboarding your fleet vehicles, registering drivers, and setting up morning and evening pickup routes."
              actionLabel="Add Fleet Vehicle"
              actionHref="/admin/buses"
              secondaryActionLabel="Configure Routes"
              secondaryActionHref="/admin/routes"
            />
          </div>
        </div>
      )}

      {/* 5. Success / Data State */}
      {viewState === 'success' && data && (
        <div className="space-y-6">
          {/* Top KPI Metric Cards */}
          <DashboardMetricsCards metrics={data.metrics} />

          {/* 2-Column Operational Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TransportStatusSummary status={data.transportStatus} />
            <AlertSummaryCard alerts={data.alertSummary} />
          </div>

          {/* Bottom Recent Activity Feed */}
          <RecentActivityFeed activities={data.recentActivity} />
        </div>
      )}
    </div>
  );
}
