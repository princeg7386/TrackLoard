'use client';

import React from 'react';
import { FileText, Download, Calendar, ShieldCheck } from 'lucide-react';
import { EmptyState } from '../../../components/ui/EmptyState';

export default function ReportsLogsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Reports & Audit Logs</h1>
          <p className="text-sm text-slate-500 mt-1">
            Historical trip playback, student pickup attendance logs, driver punctuality, and immutable security audits.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-md border border-slate-300 shadow-2xs transition-colors"
          >
            <Calendar className="w-4 h-4 text-slate-500" />
            Select Date Range
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-md shadow-xs transition-colors"
          >
            <Download className="w-4 h-4" />
            Export Audit Log
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <ShieldCheck className="w-4 h-4 text-slate-400" />
            <span>Audit Trail & Attendance Logs</span>
          </div>
          <span className="text-xs text-slate-500 font-mono">0 recorded trips today</span>
        </div>

        <div className="p-12">
          <EmptyState
            icon={FileText}
            title="No Completed Trips or Logs Recorded Today"
            description="Trip completion summaries, driver arrival timestamps, and parent pickup scans will compile into audit records here."
          />
        </div>
      </div>
    </div>
  );
}
