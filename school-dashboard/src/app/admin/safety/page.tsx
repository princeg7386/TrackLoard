'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Filter,
  RefreshCw,
  AlertTriangle,
  Clock,
  Bus,
  Siren,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  fetchDashboardSummary,
  type AlertSummaryItem,
  type AlertSummary,
} from '../../../services/dashboardApi';

// ─── Types ───────────────────────────────────────────────────

type FilterType = 'ALL' | 'SOS' | 'INCIDENT' | 'DELAY';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'success'; alertSummary: AlertSummary };

// ─── Helpers ──────────────────────────────────────────────────

const ALERT_META: Record<
  AlertSummaryItem['type'],
  { label: string; icon: typeof Siren; pill: string; row: string }
> = {
  SOS: {
    label: 'SOS / Emergency',
    icon: Siren,
    pill: 'bg-red-100 text-red-700',
    row: 'border-l-4 border-red-500',
  },
  INCIDENT: {
    label: 'Incident',
    icon: AlertTriangle,
    pill: 'bg-amber-100 text-amber-700',
    row: 'border-l-4 border-amber-400',
  },
  DELAY: {
    label: 'Delay',
    icon: Clock,
    pill: 'bg-sky-100 text-sky-700',
    row: 'border-l-4 border-sky-400',
  },
};

function fmtRelative(iso: string): string {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ─── Component ────────────────────────────────────────────────

export default function SafetyIncidentsPage() {
  const { user } = useAuth();
  const [schoolId, setSchoolId] = useState<string>(user?.schoolId || '');
  const [loadState, setLoadState] = useState<LoadState>({ phase: 'loading' });
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  // Sync schoolId
  useEffect(() => {
    if (user?.schoolId) {
      setSchoolId(user.schoolId);
    } else if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('sb_school_id');
      if (stored) setSchoolId(stored);
    }
  }, [user]);

  const loadData = useCallback(async () => {
    if (!schoolId) return;
    setLoadState({ phase: 'loading' });
    try {
      const summary = await fetchDashboardSummary(schoolId);
      setLoadState({ phase: 'success', alertSummary: summary.alertSummary });
      setLastRefreshed(new Date());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load safety data';
      setLoadState({ phase: 'error', message: msg });
    }
  }, [schoolId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh every 30 s — safety data should be near-real-time
  useEffect(() => {
    const id = setInterval(() => loadData(), 30_000);
    return () => clearInterval(id);
  }, [loadData]);

  // Derived
  const alertSummary = loadState.phase === 'success' ? loadState.alertSummary : null;
  const allAlerts = alertSummary?.criticalAlertsList ?? [];
  const filtered =
    filter === 'ALL' ? allAlerts : allAlerts.filter((a) => a.type === filter);

  const activeCount =
    (alertSummary?.activeSos ?? 0) + (alertSummary?.openIncidents ?? 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Safety &amp; Incidents
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            SOS alerts, driver-reported incidents, and active delay escalations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Status pill */}
          {loadState.phase === 'success' && (
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                activeCount > 0
                  ? 'bg-red-100 text-red-700'
                  : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              {activeCount > 0 ? (
                <Siren className="w-3.5 h-3.5" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5" />
              )}
              {activeCount > 0 ? `${activeCount} Active Alert${activeCount > 1 ? 's' : ''}` : 'All Clear'}
            </span>
          )}
          {/* Refresh */}
          <button
            type="button"
            onClick={loadData}
            disabled={loadState.phase === 'loading'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 border border-slate-300 rounded-md shadow-2xs transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loadState.phase === 'loading' ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Stat cards */}
      {loadState.phase === 'success' && alertSummary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="SOS Active"
            value={alertSummary.activeSos}
            danger={alertSummary.activeSos > 0}
            Icon={Siren}
          />
          <StatCard
            label="Open Incidents"
            value={alertSummary.openIncidents}
            warn={alertSummary.openIncidents > 0}
            Icon={AlertTriangle}
          />
          <StatCard
            label="Delays Today"
            value={alertSummary.delaysToday}
            Icon={Clock}
          />
          <StatCard
            label="Notifications Sent"
            value={alertSummary.notificationsSentToday}
            Icon={Bus}
          />
        </div>
      )}

      {/* Alert queue */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        {/* Toolbar */}
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span>Alert Queue</span>
          </div>
          <div className="flex items-center gap-1.5">
            {(['ALL', 'SOS', 'INCIDENT', 'DELAY'] as FilterType[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                  filter === f
                    ? 'bg-slate-800 text-white'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {f === 'ALL' ? 'All' : f}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="divide-y divide-slate-100">
          {/* Loading */}
          {loadState.phase === 'loading' && (
            <div className="py-12 flex items-center justify-center gap-2 text-slate-400">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading safety data…</span>
            </div>
          )}

          {/* Error */}
          {loadState.phase === 'error' && (
            <div className="py-10 px-4 text-center space-y-2">
              <AlertTriangle className="w-6 h-6 text-red-400 mx-auto" />
              <p className="text-sm text-slate-600 font-medium">
                Failed to load safety data
              </p>
              <p className="text-xs text-slate-400">{loadState.message}</p>
              <button
                type="button"
                onClick={loadData}
                className="mt-2 text-xs text-sky-600 hover:text-sky-700 font-semibold"
              >
                Try again
              </button>
            </div>
          )}

          {/* Empty */}
          {loadState.phase === 'success' && filtered.length === 0 && (
            <div className="py-14 px-4 text-center space-y-2">
              <ShieldCheck className="w-10 h-10 text-emerald-300 mx-auto" />
              <p className="text-sm font-semibold text-slate-700">
                {filter === 'ALL'
                  ? 'No Active Emergency Incidents'
                  : `No active ${filter.toLowerCase()} alerts`}
              </p>
              <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
                When drivers report emergencies, delays, or mechanical issues from the
                app or WhatsApp, priority dispatch alerts appear immediately here.
              </p>
            </div>
          )}

          {/* Alert rows */}
          {loadState.phase === 'success' &&
            filtered.map((alert) => {
              const meta = ALERT_META[alert.type];
              const Icon = meta.icon;
              return (
                <div
                  key={alert.id}
                  className={`flex items-start gap-3 px-4 py-3.5 hover:bg-slate-50/60 transition-colors ${meta.row}`}
                >
                  <div
                    className={`mt-0.5 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${meta.pill}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${meta.pill}`}
                      >
                        {meta.label}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {fmtRelative(alert.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-800 truncate">
                      {alert.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed line-clamp-2">
                      {alert.description}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0 mt-1" />
                </div>
              );
            })}
        </div>

        {/* Footer */}
        {loadState.phase === 'success' && (
          <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/40 flex items-center justify-between">
            <span className="text-[10px] text-slate-400">
              Auto-refreshes every 30 s
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              Last updated: {lastRefreshed.toLocaleTimeString('en-IN')}
            </span>
          </div>
        )}
      </div>

      {/* All-clear note when truly empty */}
      {loadState.phase === 'success' && allAlerts.length === 0 && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>
            No active safety alerts. The fleet is operating normally — all status checks
            passed.
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────

function StatCard({
  label,
  value,
  danger,
  warn,
  Icon,
}: {
  label: string;
  value: number;
  danger?: boolean;
  warn?: boolean;
  Icon: typeof Siren;
}) {
  return (
    <div
      className={`bg-white rounded-lg border p-3 shadow-xs space-y-1 ${
        danger
          ? 'border-red-300 bg-red-50'
          : warn
          ? 'border-amber-300 bg-amber-50'
          : 'border-slate-200'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <Icon
          className={`w-3.5 h-3.5 ${
            danger ? 'text-red-500' : warn ? 'text-amber-500' : 'text-slate-400'
          }`}
        />
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p
        className={`text-2xl font-black tabular-nums leading-none ${
          danger ? 'text-red-700' : warn ? 'text-amber-700' : 'text-slate-800'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
