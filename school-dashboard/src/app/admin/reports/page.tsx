'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Download,
  Calendar,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  Clock,
  Bus,
  CheckCircle2,
  XCircle,
  Activity,
  Filter,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { TripApiService, type TripQueryFilters } from '../../../services/tripApi';
import { fetchDashboardSummary, type RecentActivityItem } from '../../../services/dashboardApi';
import { TripStatus } from '@school-bus/shared';

// ─── Types ────────────────────────────────────────────────────

type ReportTab = 'trips' | 'audit';

type LoadState<T> =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'success'; data: T };

// ─── Helpers ──────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

function fmtRelative(iso: string): string {
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return fmtDate(iso);
}

const STATUS_CHIP: Record<string, string> = {
  SCHEDULED: 'bg-slate-100 text-slate-600',
  IN_TRANSIT: 'bg-sky-100 text-sky-700',
  DELAYED: 'bg-amber-100 text-amber-700',
  ARRIVED_SCHOOL: 'bg-emerald-100 text-emerald-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
  EMERGENCY: 'bg-red-100 text-red-700',
};

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  SCHEDULED: Clock,
  IN_TRANSIT: Bus,
  DELAYED: AlertTriangle,
  ARRIVED_SCHOOL: CheckCircle2,
  COMPLETED: CheckCircle2,
  CANCELLED: XCircle,
  EMERGENCY: AlertTriangle,
};

function exportToCsv(rows: object[], filename: string): void {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]!);
  const header = keys.join(',');
  const body = rows
    .map((r) =>
      keys.map((k) => JSON.stringify((r as Record<string, unknown>)[k] ?? '')).join(',')
    )
    .join('\n');
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// ─── Component ────────────────────────────────────────────────

export default function ReportsLogsPage() {
  const { user } = useAuth();
  const [schoolId, setSchoolId] = useState<string>(user?.schoolId || '');
  const [activeTab, setActiveTab] = useState<ReportTab>('trips');

  // Date range filter
  const today = new Date().toISOString().split('T')[0]!;
  const [dateFrom, setDateFrom] = useState<string>(today);
  const [dateTo, setDateTo] = useState<string>(today);

  // Data
  const [tripsState, setTripsState] = useState<LoadState<import('@school-bus/shared').TripDetailResponse[]>>({ phase: 'loading' });
  const [auditState, setAuditState] = useState<LoadState<RecentActivityItem[]>>({ phase: 'loading' });

  // Sync schoolId
  useEffect(() => {
    if (user?.schoolId) {
      setSchoolId(user.schoolId);
    } else if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('sb_school_id');
      if (stored) setSchoolId(stored);
    }
  }, [user]);

  // ── Load Trips ─────────────────────────────────────────────

  const loadTrips = useCallback(async () => {
    if (!schoolId) return;
    setTripsState({ phase: 'loading' });
    try {
      const filters: TripQueryFilters = { date: dateFrom };
      const trips = await TripApiService.listTrips(schoolId, filters);
      setTripsState({ phase: 'success', data: trips });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load trips';
      setTripsState({ phase: 'error', message: msg });
    }
  }, [schoolId, dateFrom]);

  // ── Load Audit / Recent Activity ───────────────────────────

  const loadAudit = useCallback(async () => {
    if (!schoolId) return;
    setAuditState({ phase: 'loading' });
    try {
      const summary = await fetchDashboardSummary(schoolId);
      setAuditState({ phase: 'success', data: summary.recentActivity });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load audit log';
      setAuditState({ phase: 'error', message: msg });
    }
  }, [schoolId]);

  useEffect(() => { loadTrips(); }, [loadTrips]);
  useEffect(() => { loadAudit(); }, [loadAudit]);

  // ── Derived ────────────────────────────────────────────────

  const trips = tripsState.phase === 'success' ? tripsState.data : [];
  const auditItems = auditState.phase === 'success' ? auditState.data : [];

  const completedTrips = trips.filter((t) => t.status === TripStatus.COMPLETED || t.status === TripStatus.ARRIVED_SCHOOL);
  const cancelledTrips = trips.filter((t) => t.status === TripStatus.CANCELLED);
  const activeTrips = trips.filter((t) =>
    t.status === TripStatus.IN_TRANSIT || t.status === TripStatus.DELAYED
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Reports &amp; Audit Logs
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Trip history, attendance records, and immutable security audit trail.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Date filter */}
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-md px-2.5 py-1.5 shadow-2xs">
            <Calendar className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <input
              type="date"
              value={dateFrom}
              max={today}
              onChange={(e) => setDateFrom(e.target.value)}
              className="text-xs text-slate-700 bg-transparent outline-none w-28"
            />
          </div>

          {/* Export */}
          <button
            type="button"
            onClick={() => {
              if (activeTab === 'trips' && tripsState.phase === 'success') {
                exportToCsv(
                  tripsState.data.map((t) => ({
                    id: t.id,
                    status: t.status,
                    route: t.routeName ?? '',
                    bus: t.busNumber ?? '',
                    driver: t.driverName ?? '',
                    date: t.scheduledDate ?? '',
                    startTime: t.scheduledStartTime ?? '',
                  })),
                  `trips-${dateFrom}.csv`
                );
              } else if (activeTab === 'audit' && auditState.phase === 'success') {
                exportToCsv(
                  auditState.data.map((a) => ({
                    id: a.id,
                    action: a.action,
                    entityType: a.entityType,
                    description: a.description,
                    role: a.userRole ?? '',
                    createdAt: a.createdAt,
                  })),
                  `audit-log-${dateFrom}.csv`
                );
              }
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-md shadow-xs transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Summary stat row */}
      {tripsState.phase === 'success' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MiniStat label="Total Trips" value={trips.length} Icon={Bus} />
          <MiniStat label="Active" value={activeTrips.length} Icon={Activity} accent="sky" />
          <MiniStat label="Completed" value={completedTrips.length} Icon={CheckCircle2} accent="emerald" />
          <MiniStat label="Cancelled" value={cancelledTrips.length} Icon={XCircle} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-lg w-fit">
        {([['trips', 'Trip Logs', Bus], ['audit', 'Audit Trail', ShieldCheck]] as const).map(
          ([tab, label, Icon]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                activeTab === tab
                  ? 'bg-white text-slate-800 shadow-xs'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          )
        )}
      </div>

      {/* ── Trip Logs tab ──────────────────────────────────── */}
      {activeTab === 'trips' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span>
                Trips — {fmtDate(dateFrom)}
              </span>
            </div>
            <button
              type="button"
              onClick={loadTrips}
              disabled={tripsState.phase === 'loading'}
              className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${tripsState.phase === 'loading' ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {/* Loading */}
          {tripsState.phase === 'loading' && (
            <div className="py-12 flex items-center justify-center gap-2 text-slate-400">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading trip records…</span>
            </div>
          )}

          {/* Error */}
          {tripsState.phase === 'error' && (
            <ErrorBody message={tripsState.message} onRetry={loadTrips} />
          )}

          {/* Empty */}
          {tripsState.phase === 'success' && trips.length === 0 && (
            <div className="py-14 px-4 text-center space-y-2">
              <FileText className="w-10 h-10 text-slate-200 mx-auto" />
              <p className="text-sm font-semibold text-slate-600">No trips on {fmtDate(dateFrom)}</p>
              <p className="text-xs text-slate-400">
                Completed trip summaries, driver arrival timestamps, and attendance records
                will appear here once trips are scheduled and run.
              </p>
            </div>
          )}

          {/* Table */}
          {tripsState.phase === 'success' && trips.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Route', 'Bus', 'Driver', 'Date', 'Start Time', 'Status'].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2.5 text-left font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {trips.map((trip) => {
                    const chip = STATUS_CHIP[trip.status] ?? 'bg-slate-100 text-slate-600';
                    const Icon = STATUS_ICON[trip.status] ?? Bus;
                    return (
                      <tr key={trip.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">
                          {trip.routeName ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                          {trip.busNumber ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                          {trip.driverName ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                          {fmtDate(trip.scheduledDate)}
                        </td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap font-mono">
                          {trip.scheduledStartTime
                            ? fmtTime(`${trip.scheduledDate}T${trip.scheduledStartTime}`)
                            : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${chip}`}
                          >
                            <Icon className="w-3 h-3" />
                            {trip.status.replace('_', ' ')}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer */}
          {tripsState.phase === 'success' && trips.length > 0 && (
            <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/40">
              <span className="text-[10px] text-slate-400">
                {trips.length} trip{trips.length !== 1 ? 's' : ''} on {fmtDate(dateFrom)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Audit Trail tab ────────────────────────────────── */}
      {activeTab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
              <span>Immutable Audit Trail — Recent Activity</span>
            </div>
            <button
              type="button"
              onClick={loadAudit}
              disabled={auditState.phase === 'loading'}
              className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${auditState.phase === 'loading' ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {auditState.phase === 'loading' && (
            <div className="py-12 flex items-center justify-center gap-2 text-slate-400">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading audit records…</span>
            </div>
          )}

          {auditState.phase === 'error' && (
            <ErrorBody message={auditState.message} onRetry={loadAudit} />
          )}

          {auditState.phase === 'success' && auditItems.length === 0 && (
            <div className="py-14 px-4 text-center space-y-2">
              <ShieldCheck className="w-10 h-10 text-slate-200 mx-auto" />
              <p className="text-sm font-semibold text-slate-600">No audit records today</p>
              <p className="text-xs text-slate-400">
                All operational actions — trip state changes, student reassignments,
                driver assignments — are logged here automatically.
              </p>
            </div>
          )}

          {auditState.phase === 'success' && auditItems.length > 0 && (
            <div className="divide-y divide-slate-100">
              {auditItems.map((item) => (
                <div key={item.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50/50 transition-colors">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-2 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                        {item.entityType}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-500">
                        {item.action}
                      </span>
                      {item.userRole && (
                        <span className="text-[10px] text-slate-400">
                          by {item.userRole}
                        </span>
                      )}
                      <span className="text-[10px] text-slate-400 font-mono ml-auto">
                        {fmtRelative(item.createdAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {auditState.phase === 'success' && auditItems.length > 0 && (
            <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/40">
              <span className="text-[10px] text-slate-400">
                {auditItems.length} recent action{auditItems.length !== 1 ? 's' : ''} · Full audit log stored in database
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function MiniStat({
  label,
  value,
  Icon,
  accent,
}: {
  label: string;
  value: number;
  Icon: typeof Bus;
  accent?: 'sky' | 'emerald';
}) {
  const color = accent === 'sky'
    ? 'text-sky-600'
    : accent === 'emerald'
    ? 'text-emerald-600'
    : 'text-slate-700';
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-xs space-y-1">
      <div className="flex items-center gap-1.5">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className={`text-2xl font-black tabular-nums leading-none ${color}`}>{value}</p>
    </div>
  );
}

function ErrorBody({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="py-10 px-4 text-center space-y-2">
      <AlertTriangle className="w-6 h-6 text-red-400 mx-auto" />
      <p className="text-sm text-slate-600 font-medium">Failed to load data</p>
      <p className="text-xs text-slate-400">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 text-xs text-sky-600 hover:text-sky-700 font-semibold"
      >
        Try again
      </button>
    </div>
  );
}
