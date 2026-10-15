'use client';

import React from 'react';
import { ShieldCheck, Filter } from 'lucide-react';
import { EmptyState } from '../../../components/ui/EmptyState';
import { StatusBadge } from '../../../components/ui/StatusBadge';

export default function SafetyIncidentsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Incidents & SOS Safety Control</h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time emergency triggers, breakdown alerts, delay broadcasts, and incident resolution tracking.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status="normal" label="All Systems Normal" />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <Filter className="w-4 h-4 text-slate-400" />
            <span>Incident Queue</span>
          </div>
          <span className="text-xs text-emerald-600 font-medium">0 active alerts</span>
        </div>

        <div className="p-12">
          <EmptyState
            icon={ShieldCheck}
            title="No Active Emergency Incidents"
            description="When drivers report emergencies, delays, or mechanical issues from the app or WhatsApp, priority dispatch alerts appear immediately here."
          />
        </div>
      </div>
    </div>
  );
}

