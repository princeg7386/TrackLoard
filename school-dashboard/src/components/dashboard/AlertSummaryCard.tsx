'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, ShieldCheck, Clock, MessageSquare, ArrowRight, Siren } from 'lucide-react';
import { AlertSummary } from '../../services/dashboardApi';
import { StatusBadge } from '../ui/StatusBadge';

interface AlertSummaryCardProps {
  alerts: AlertSummary;
}

export function AlertSummaryCard({ alerts }: AlertSummaryCardProps) {
  const { openIncidents, activeSos, delaysToday, notificationsSentToday, criticalAlertsList } =
    alerts;

  const hasHighPriority = activeSos > 0 || openIncidents > 0 || delaysToday > 0;

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden flex flex-col justify-between">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-slate-500" />
          <h2 className="text-sm font-bold text-slate-800 tracking-tight">Safety & Alert Center</h2>
        </div>
        {activeSos > 0 ? (
          <StatusBadge status="incident" label={`${activeSos} Active SOS`} />
        ) : openIncidents > 0 ? (
          <StatusBadge status="warning" label={`${openIncidents} Open Incidents`} />
        ) : (
          <StatusBadge status="normal" label="Normal" />
        )}
      </div>

      {/* Content */}
      <div className="p-5 space-y-4">
        {activeSos > 0 && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center justify-between text-rose-900">
            <div className="flex items-center gap-2.5">
              <Siren className="w-5 h-5 text-rose-600 animate-bounce" />
              <div>
                <strong className="text-xs font-bold block">Active Driver SOS Emergency!</strong>
                <span className="text-[11px] text-rose-700">Immediate coordinator intervention required</span>
              </div>
            </div>
            <Link
              href="/admin/safety"
              className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-semibold shadow-xs"
            >
              Respond
            </Link>
          </div>
        )}

        {/* 3 Metrics Cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 bg-slate-50 border border-slate-100 rounded-md">
            <span className="text-[11px] font-semibold text-slate-500 uppercase block">Incidents</span>
            <span
              className={`text-lg font-bold font-mono mt-0.5 block ${
                openIncidents > 0 ? 'text-amber-600' : 'text-slate-800'
              }`}
            >
              {openIncidents}
            </span>
            <span className="text-[10px] text-slate-400">Open issues</span>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-100 rounded-md">
            <span className="text-[11px] font-semibold text-slate-500 uppercase block">Delays</span>
            <span
              className={`text-lg font-bold font-mono mt-0.5 block ${
                delaysToday > 0 ? 'text-sky-600' : 'text-slate-800'
              }`}
            >
              {delaysToday}
            </span>
            <span className="text-[10px] text-slate-400">Route deviations</span>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-100 rounded-md">
            <span className="text-[11px] font-semibold text-slate-500 uppercase block">WhatsApp</span>
            <span className="text-lg font-bold font-mono text-slate-800 mt-0.5 block">
              {notificationsSentToday}
            </span>
            <span className="text-[10px] text-slate-400">Dispatches today</span>
          </div>
        </div>

        {/* Calm Status or Critical Alert List */}
        {!hasHighPriority ? (
          <div className="p-3 bg-emerald-50/50 border border-emerald-100 rounded-md flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="text-xs text-emerald-900">
              <span className="font-semibold block">All fleet operations are within safe parameters.</span>
              <span className="text-[11px] text-emerald-700">No active breakdown or emergency alerts reported.</span>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {criticalAlertsList.slice(0, 2).map((alert) => (
              <div
                key={alert.id}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded text-xs flex items-center justify-between"
              >
                <div className="truncate pr-2">
                  <span className="font-semibold text-slate-800">{alert.title}</span>
                  <p className="text-[11px] text-slate-500 truncate">{alert.description}</p>
                </div>
                <span className="text-[10px] text-slate-400 font-mono shrink-0">
                  {new Date(alert.createdAt).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 bg-slate-50/70 border-t border-slate-200 flex items-center justify-between">
        <span className="text-xs text-slate-500">Automated WhatsApp parent alerts enabled</span>
        <Link
          href="/admin/safety"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 hover:text-sky-800 transition-colors"
        >
          View Incident Queue
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
