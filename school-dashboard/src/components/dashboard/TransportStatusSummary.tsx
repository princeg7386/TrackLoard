'use client';

import React from 'react';
import Link from 'next/link';
import { Radio, Calendar, CheckCircle2, Clock, MapPin, ArrowRight } from 'lucide-react';
import { TransportStatusSummary as TransportStatusType } from '../../services/dashboardApi';
import { StatusBadge } from '../ui/StatusBadge';

interface TransportStatusSummaryProps {
  status: TransportStatusType;
}

export function TransportStatusSummary({ status }: TransportStatusSummaryProps) {
  const {
    totalTripsToday,
    scheduledTrips,
    inProgressTrips,
    completedTrips,
    cancelledTrips,
    morningPickupCount,
    eveningDropCount,
  } = status;

  const completedPct = totalTripsToday > 0 ? Math.round((completedTrips / totalTripsToday) * 100) : 0;

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden flex flex-col justify-between">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-500" />
          <h2 className="text-sm font-bold text-slate-800 tracking-tight">Today's Transport Status</h2>
        </div>
        {inProgressTrips > 0 ? (
          <StatusBadge status="normal" label={`${inProgressTrips} In Transit`} />
        ) : (
          <StatusBadge status="inactive" label="Standby Mode" />
        )}
      </div>

      {/* Progress Metric */}
      <div className="p-5 space-y-4">
        <div>
          <div className="flex items-center justify-between text-xs text-slate-600 mb-1.5 font-medium">
            <span>Trip Execution Progress</span>
            <span className="font-mono font-semibold text-slate-800">{completedPct}% Completed</span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden flex">
            <div
              style={{ width: `${completedPct}%` }}
              className="bg-emerald-500 h-full transition-all duration-500"
            />
            {inProgressTrips > 0 && totalTripsToday > 0 && (
              <div
                style={{ width: `${Math.round((inProgressTrips / totalTripsToday) * 100)}%` }}
                className="bg-sky-500 h-full animate-pulse"
              />
            )}
          </div>
        </div>

        {/* 4-Column Trip Lifecycle Grid */}
        <div className="grid grid-cols-4 gap-2 pt-2 text-center">
          <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-md">
            <span className="text-[11px] font-semibold text-slate-500 uppercase block">Scheduled</span>
            <span className="text-base font-bold font-mono text-slate-700 mt-0.5 block">{scheduledTrips}</span>
          </div>

          <div className="p-2.5 bg-sky-50 border border-sky-100 rounded-md">
            <span className="text-[11px] font-semibold text-sky-700 uppercase block">In-Transit</span>
            <span className="text-base font-bold font-mono text-sky-900 mt-0.5 block">{inProgressTrips}</span>
          </div>

          <div className="p-2.5 bg-emerald-50 border border-emerald-100 rounded-md">
            <span className="text-[11px] font-semibold text-emerald-700 uppercase block">Completed</span>
            <span className="text-base font-bold font-mono text-emerald-900 mt-0.5 block">{completedTrips}</span>
          </div>

          <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-md">
            <span className="text-[11px] font-semibold text-slate-500 uppercase block">Cancelled</span>
            <span className="text-base font-bold font-mono text-slate-700 mt-0.5 block">{cancelledTrips}</span>
          </div>
        </div>

        {/* Route Shift Distribution */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              Morning Pickup: <strong className="text-slate-800 font-mono">{morningPickupCount}</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-indigo-400" />
              Evening Drop: <strong className="text-slate-800 font-mono">{eveningDropCount}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Footer Quick Action */}
      <div className="px-5 py-3 bg-slate-50/70 border-t border-slate-200 flex items-center justify-between">
        <span className="text-xs text-slate-500">Live PostGIS spatial route adherence</span>
        <Link
          href="/admin/live"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 hover:text-sky-800 transition-colors"
        >
          Open Live Dispatch Map
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}

