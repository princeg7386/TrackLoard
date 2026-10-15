'use client';

import React from 'react';
import { Bus, Navigation, Clock, Gauge, ShieldAlert, CheckCircle2, AlertTriangle, Radio } from 'lucide-react';
import type { BusGpsHealthSummary, GpsHealthStatus } from '@school-bus/shared';

interface BusStatePanelProps {
  bus: BusGpsHealthSummary;
  isSelected?: boolean;
  onSelect?: (bus: BusGpsHealthSummary) => void;
}

export function BusStatePanel({ bus, isSelected, onSelect }: BusStatePanelProps) {
  const getHealthBadge = (status: GpsHealthStatus) => {
    switch (status) {
      case 'HEALTHY':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live (Healthy)
          </span>
        );
      case 'DEGRADED_ACCURACY':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
            <AlertTriangle className="w-3 h-3 text-amber-500" />
            Degraded GPS
          </span>
        );
      case 'STALE_SIGNAL':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-300">
            <Clock className="w-3 h-3 text-amber-600" />
            Stale Signal
          </span>
        );
      case 'SIGNAL_LOST':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
            <ShieldAlert className="w-3 h-3 text-rose-500" />
            Signal Lost
          </span>
        );
      case 'OFFLINE':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            Offline / Standby
          </span>
        );
    }
  };

  const formatRecordedTime = (isoString?: string | null) => {
    if (!isoString) return 'No GPS fix yet';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return 'Invalid time';
    }
  };

  return (
    <div
      onClick={() => onSelect?.(bus)}
      className={`p-4 rounded-lg border transition-all cursor-pointer bg-white text-slate-900 ${
        isSelected
          ? 'border-indigo-600 ring-2 ring-indigo-50 shadow-sm'
          : 'border-slate-200 hover:border-slate-300 hover:shadow-xs'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
            <Bus className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-slate-900">{bus.busNumber}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                {bus.registrationNumber}
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
              {bus.activeTripId ? (
                <span className="text-emerald-700 font-medium inline-flex items-center gap-1">
                  <Radio className="w-3 h-3 animate-pulse" />
                  Trip Active
                </span>
              ) : (
                <span className="text-slate-400">Idle / No active trip</span>
              )}
            </div>
          </div>
        </div>

        <div>{getHealthBadge(bus.healthStatus)}</div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 pt-3 border-t border-slate-100 text-xs">
        <div>
          <span className="text-slate-400 flex items-center gap-1 mb-0.5">
            <Gauge className="w-3.5 h-3.5" /> Speed
          </span>
          <span className="font-semibold text-slate-800">
            {bus.lastSpeedKmh != null ? `${Math.round(bus.lastSpeedKmh)} km/h` : '—'}
          </span>
        </div>

        <div>
          <span className="text-slate-400 flex items-center gap-1 mb-0.5">
            <Navigation className="w-3.5 h-3.5" /> Coordinates
          </span>
          <span className="font-mono text-slate-800 truncate block">
            {bus.lastLatitude != null && bus.lastLongitude != null
              ? `${bus.lastLatitude.toFixed(4)}, ${bus.lastLongitude.toFixed(4)}`
              : '—'}
          </span>
        </div>

        <div>
          <span className="text-slate-400 flex items-center gap-1 mb-0.5">
            <Clock className="w-3.5 h-3.5" /> Last Update
          </span>
          <span className="text-slate-800 font-medium">
            {formatRecordedTime(bus.lastRecordedAt)}
          </span>
        </div>

        <div>
          <span className="text-slate-400 flex items-center gap-1 mb-0.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> Battery / Net
          </span>
          <span className="text-slate-800">
            {bus.lastBatteryPercentage != null ? `${bus.lastBatteryPercentage}%` : '—'}
            {bus.lastNetworkType ? ` (${bus.lastNetworkType})` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
