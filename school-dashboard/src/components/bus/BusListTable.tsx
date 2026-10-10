'use client';

import React from 'react';
import { Bus, User, Cpu, MapPin, Smartphone } from 'lucide-react';
import { BusWithDriver } from '@school-bus/shared';
import { EmptyState } from '../ui/EmptyState';
import { StatusBadge } from '../ui/StatusBadge';

interface BusListTableProps {
  buses: BusWithDriver[];
  isLoading: boolean;
  onAddBus: () => void;
}

export function BusListTable({ buses, isLoading, onAddBus }: BusListTableProps) {
  if (isLoading) {
    return (
      <div className="p-6 space-y-3 animate-pulse">
        <div className="h-10 bg-slate-100 rounded-md w-full" />
        <div className="h-12 bg-slate-100 rounded-md w-full" />
        <div className="h-12 bg-slate-100 rounded-md w-full" />
      </div>
    );
  }

  if (buses.length === 0) {
    return (
      <div className="p-8">
        <EmptyState
          icon={Bus}
          title="No Fleet Vehicles Added Yet"
          description="Register your school buses with official registration numbers to assign routes, pair drivers, and monitor real-time PostGIS GPS tracking."
          actionLabel="Add First Bus"
          onAction={onAddBus}
        />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            <th className="py-3 px-4">Bus Identifier</th>
            <th className="py-3 px-4">Registration No. (RTO)</th>
            <th className="py-3 px-4">Make & Model</th>
            <th className="py-3 px-4">Primary Driver</th>
            <th className="py-3 px-4">Route Assignment</th>
            <th className="py-3 px-4">Telemetry Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
          {buses.map((bus) => (
            <tr key={bus.id} className="hover:bg-slate-50/60 transition-colors">
              {/* Bus Internal Name */}
              <td className="py-3.5 px-4 font-semibold text-slate-900">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-md bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-700 shrink-0 font-bold text-xs">
                    <Bus className="w-3.5 h-3.5" />
                  </div>
                  <span>{bus.busNumber}</span>
                </div>
              </td>

              {/* Registration Number */}
              <td className="py-3.5 px-4 font-mono font-medium text-slate-800">
                <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-800">
                  {bus.registrationNumber}
                </span>
              </td>

              {/* Make & Model */}
              <td className="py-3.5 px-4 text-slate-600">
                {bus.makeModel || <span className="text-slate-400 italic">Not specified</span>}
              </td>

              {/* Primary Driver */}
              <td className="py-3.5 px-4">
                {bus.driverName ? (
                  <div className="flex items-center gap-1.5 text-slate-800">
                    <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-medium truncate">{bus.driverName}</span>
                    {bus.driverPhone && (
                      <span className="text-[10px] text-slate-400 font-mono">({bus.driverPhone})</span>
                    )}
                  </div>
                ) : (
                  <span className="text-slate-400 italic">Unassigned</span>
                )}
              </td>

              {/* Route Assignment */}
              <td className="py-3.5 px-4">
                {bus.assignedRouteName ? (
                  <span className="inline-flex items-center gap-1 text-sky-700 font-medium">
                    <MapPin className="w-3 h-3 text-sky-500 shrink-0" />
                    {bus.assignedRouteName}
                  </span>
                ) : (
                  <span className="text-slate-400 italic">Unassigned</span>
                )}
              </td>

              {/* Telemetry Source */}
              <td className="py-3.5 px-4">
                {bus.deviceIdentifier ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono">
                    <Cpu className="w-3 h-3" />
                    {bus.deviceIdentifier}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-600 border border-slate-200">
                    <Smartphone className="w-3 h-3 text-slate-400" />
                    Driver App GPS
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
