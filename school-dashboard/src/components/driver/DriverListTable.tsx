'use client';

import React from 'react';
import {
  User,
  Phone,
  Bus,
  MapPin,
  FileBadge,
  CheckCircle2,
  Clock,
  Plus,
  History,
  Eye,
} from 'lucide-react';
import { DriverWithBus } from '@school-bus/shared';
import { EmptyState } from '../ui/EmptyState';

interface DriverListTableProps {
  drivers: DriverWithBus[];
  isLoading: boolean;
  onAddDriver: () => void;
  onManageAssignment?: (driver: DriverWithBus) => void;
  onViewHistory?: (driver: DriverWithBus) => void;
  onViewDetail?: (driver: DriverWithBus) => void;
}

export function DriverListTable({
  drivers,
  isLoading,
  onAddDriver,
  onManageAssignment,
  onViewHistory,
  onViewDetail,
}: DriverListTableProps) {
  if (isLoading) {
    return (
      <div className="p-6 space-y-3 animate-pulse">
        <div className="h-10 bg-slate-100 rounded-md w-full" />
        <div className="h-12 bg-slate-100 rounded-md w-full" />
        <div className="h-12 bg-slate-100 rounded-md w-full" />
      </div>
    );
  }

  if (drivers.length === 0) {
    return (
      <div className="p-8">
        <EmptyState
          icon={User}
          title="No Drivers Registered Yet"
          description="Register your transport drivers with mobile numbers to issue secure Android app PINs and enable daily WhatsApp dispatches."
          actionLabel="Add First Driver"
          onAction={onAddDriver}
        />
      </div>
    );
  }

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            <th className="py-3 px-4">Driver Profile</th>
            <th className="py-3 px-4">WhatsApp Contact</th>
            <th className="py-3 px-4">Driving License</th>
            <th className="py-3 px-4">Assigned Vehicle</th>
            <th className="py-3 px-4">Assigned Route</th>
            <th className="py-3 px-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
          {drivers.map((driver) => (
            <tr key={driver.id} className="hover:bg-slate-50/60 transition-colors">
              {/* Driver Identity */}
              <td className="py-3.5 px-4 font-semibold text-slate-900">
                <button
                  type="button"
                  onClick={() => onViewDetail?.(driver)}
                  className="flex items-center gap-3 text-left group focus:outline-hidden"
                  title="Click to view driver details and credentials"
                >
                  {driver.photoUrl ? (
                    <img
                      src={driver.photoUrl}
                      alt={driver.fullName}
                      className="w-8 h-8 rounded-full object-cover border border-slate-200 shrink-0 group-hover:ring-2 group-hover:ring-sky-500 transition-all"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-sky-100 border border-sky-200 text-sky-700 font-bold text-xs flex items-center justify-center shrink-0 group-hover:bg-sky-200 transition-colors">
                      {getInitials(driver.fullName)}
                    </div>
                  )}
                  <div>
                    <span className="font-semibold text-slate-900 block group-hover:text-sky-600 transition-colors">
                      {driver.fullName}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono font-normal">
                      ID: {driver.id?.slice(0, 8)}
                    </span>
                  </div>
                </button>
              </td>

              {/* Mobile Phone */}
              <td className="py-3.5 px-4 font-mono font-medium text-slate-800">
                <div className="flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>{driver.phone}</span>
                </div>
              </td>

              {/* License Number & Expiry */}
              <td className="py-3.5 px-4">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1 font-mono font-medium text-slate-800">
                    <FileBadge className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{driver.licenseNumber}</span>
                  </div>
                  {driver.licenseExpiry && (
                    <span className="text-[10px] text-slate-400 font-mono block">
                      Exp: {driver.licenseExpiry}
                    </span>
                  )}
                </div>
              </td>

              {/* Assigned Vehicle */}
              <td className="py-3.5 px-4">
                {driver.assignedBusNumber ? (
                  <button
                    type="button"
                    onClick={() => onManageAssignment?.(driver)}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200 font-semibold hover:bg-sky-100 transition-colors text-left"
                    title="Click to manage vehicle assignment"
                  >
                    <Bus className="w-3 h-3 text-sky-600 shrink-0" />
                    <span>{driver.assignedBusNumber}</span>
                    {driver.assignedRegistrationNumber && (
                      <span className="text-[10px] font-mono text-sky-600 font-normal">
                        ({driver.assignedRegistrationNumber})
                      </span>
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onManageAssignment?.(driver)}
                    className="inline-flex items-center gap-1 text-slate-400 hover:text-sky-600 italic text-[11px] hover:underline"
                  >
                    <span>Unassigned</span>
                    <span className="not-italic text-[10px] font-semibold text-sky-600 ml-1">
                      + Pair Bus
                    </span>
                  </button>
                )}
              </td>

              {/* Assigned Route */}
              <td className="py-3.5 px-4">
                {driver.assignedRouteName ? (
                  <div className="inline-flex items-center gap-1.5 text-slate-700 font-medium truncate max-w-[200px]">
                    <MapPin className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                    <span className="truncate">{driver.assignedRouteName}</span>
                    {driver.assignedRouteCode && (
                      <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1 py-0.2 rounded shrink-0">
                        {driver.assignedRouteCode}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-slate-400 italic text-[11px]">Unassigned</span>
                )}
              </td>

              {/* Actions */}
              <td className="py-3.5 px-4 text-right">
                <div className="inline-flex items-center gap-1.5 justify-end">
                  <button
                    type="button"
                    onClick={() => onViewDetail?.(driver)}
                    title="View Profile & Credentials"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-sky-700 bg-white hover:bg-slate-50 border border-slate-300 rounded shadow-2xs transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5 text-slate-500" />
                    <span>Details</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onViewHistory?.(driver)}
                    title="View Trips, Attendance & Incident Logs"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-sky-700 bg-white hover:bg-slate-50 border border-slate-300 rounded shadow-2xs transition-colors"
                  >
                    <History className="w-3.5 h-3.5 text-slate-500" />
                    <span>History</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onManageAssignment?.(driver)}
                    title="Pair or change vehicle"
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-sky-700 bg-white hover:bg-slate-50 border border-slate-300 rounded shadow-2xs transition-colors"
                  >
                    <Bus className="w-3.5 h-3.5 text-slate-500" />
                    <span>{driver.assignedBusId ? 'Reassign' : 'Pair'}</span>
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}




