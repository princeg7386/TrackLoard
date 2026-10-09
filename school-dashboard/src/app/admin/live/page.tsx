'use client';

import React from 'react';
import { Radio, Bus, Users, ShieldCheck } from 'lucide-react';
import { EmptyState } from '../../../components/ui/EmptyState';
import { StatusBadge } from '../../../components/ui/StatusBadge';

export default function LiveOperationsPage() {
  return (
    <div className="space-y-6">
      {/* Top Telemetry Metric Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Trips</div>
            <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">0</div>
            <div className="text-xs text-slate-400 mt-0.5">Morning & Evening routes</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-700">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Fleet Online</div>
            <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">0 / 0</div>
            <div className="text-xs text-slate-400 mt-0.5">GPS telemetry connected</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
            <Bus className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Students In-Transit</div>
            <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">0</div>
            <div className="text-xs text-slate-400 mt-0.5">Boarded active trips</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700">
            <Users className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-xs">
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Alerts</div>
            <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">0</div>
            <div className="text-xs text-slate-400 mt-0.5">SOS or route deviations</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-600">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
          </div>
        </div>
      </div>

      {/* Main Operational Canvas */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-800 tracking-tight">Live Fleet Map & Dispatch</h2>
            <StatusBadge status="inactive" label="Standby" />
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
