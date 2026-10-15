'use client';

import React from 'react';
import Link from 'next/link';
import { History, ArrowRight, Activity, ShieldCheck, User, Radio, FileText } from 'lucide-react';
import { RecentActivityItem } from '../../services/dashboardApi';

interface RecentActivityFeedProps {
  activities: RecentActivityItem[];
}

export function RecentActivityFeed({ activities }: RecentActivityFeedProps) {
  const getActivityIcon = (action: string) => {
    if (action.includes('TRIP')) return Radio;
    if (action.includes('PASSWORD') || action.includes('PROFILE')) return ShieldCheck;
    if (action.includes('DRIVER') || action.includes('PARENT')) return User;
    return Activity;
  };

  const formatIST = (isoString: string) => {
    try {
      return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: 'short',
        hour12: true,
      }).format(new Date(isoString));
    } catch {
      return isoString;
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-slate-500" />
          <h2 className="text-sm font-bold text-slate-800 tracking-tight">Recent Transport Activity</h2>
        </div>
        <span className="text-xs text-slate-500 font-mono">Real-Time Audit Stream</span>
      </div>

      {/* Activity Timeline List */}
      <div className="p-5">
        {activities.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 flex flex-col items-center justify-center">
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-2">
              <FileText className="w-4 h-4" />
            </div>
            <p className="font-semibold text-slate-700">No recent transport activity recorded</p>
            <p className="text-slate-400 mt-0.5">Events and audit trails will appear here in real time.</p>
          </div>
        ) : (
          <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
            {activities.map((item) => {
              const Icon = getActivityIcon(item.action);
              return (
                <div key={item.id} className="relative flex items-start justify-between gap-3">
                  <div className="absolute -left-6 top-1 w-4 h-4 rounded-full bg-white border-2 border-sky-500 flex items-center justify-center" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-800 truncate">
                        {item.description}
                      </span>
                      {item.userRole && (
                        <span className="text-[10px] px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded font-medium">
                          {item.userRole}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-mono text-slate-400 block mt-0.5">
                      Action: {item.action} â€¢ Entity: {item.entityType}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 shrink-0 select-none">
                    {formatIST(item.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 bg-slate-50/70 border-t border-slate-200 flex items-center justify-between">
        <span className="text-xs text-slate-500">Immutable multi-tenant audit logs</span>
        <Link
          href="/admin/reports"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 hover:text-sky-800 transition-colors"
        >
          View Full Audit Log
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}

