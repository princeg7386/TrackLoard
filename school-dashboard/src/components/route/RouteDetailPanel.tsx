'use client';

import React from 'react';
import {
  Bus,
  User,
  Clock,
  Compass,
  MapPin,
  Users,
  Navigation,
  ArrowRight,
  Shield,
  Plus,
  Radio,
  FileText,
} from 'lucide-react';
import {
  type RouteDetail,
  type RouteStopDetail,
  RouteType,
} from '@school-bus/shared';

interface RouteDetailPanelProps {
  route: RouteDetail;
  stops: RouteStopDetail[];
  totalDistanceMeters?: number | null;
  selectedStopId?: string | null;
  onSelectStop?: (stop: RouteStopDetail) => void;
  onAddStop?: () => void;
  onRefreshDirections?: () => void;
  isDirectionsLoading?: boolean;
}

export function RouteDetailPanel({
  route,
  stops,
  totalDistanceMeters,
  selectedStopId,
  onSelectStop,
  onAddStop,
  onRefreshDirections,
  isDirectionsLoading = false,
}: RouteDetailPanelProps) {
  const getRouteTypeBadge = (type: RouteType) => {
    switch (type) {
      case RouteType.MORNING_PICKUP:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20">
            Morning Pickup
          </span>
        );
      case RouteType.AFTERNOON_DROP:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20">
            Afternoon Drop
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">
            Special Trip
          </span>
        );
    }
  };

  const distanceKm =
    totalDistanceMeters != null
      ? (totalDistanceMeters / 1000).toFixed(1)
      : null;

  return (
    <div className="flex flex-col h-full bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
      {/* 1. Route Summary Header */}
      <div className="p-4 border-b border-slate-200 bg-slate-50/70 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-sky-600 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded">
                {route.code}
              </span>
              {getRouteTypeBadge(route.routeType)}
            </div>
            <h2 className="text-base font-bold text-slate-900 mt-1.5 leading-snug">
              {route.name}
            </h2>
          </div>
        </div>

        {/* 2. Operational Metrics Cards */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2.5 rounded-lg bg-white border border-slate-200 shadow-2xs">
            <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              Est. Duration
            </span>
            <span className="font-semibold text-slate-800 text-sm mt-0.5 block">
              {route.estimatedDurationMinutes} mins
            </span>
          </div>

          <div className="p-2.5 rounded-lg bg-white border border-slate-200 shadow-2xs">
            <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5 text-slate-400" />
              Total Distance
            </span>
            <span className="font-semibold text-slate-800 text-sm mt-0.5 block">
              {distanceKm ? `${distanceKm} km` : '—'}
            </span>
          </div>
        </div>

        {/* 3. Assigned Bus and Driver Details */}
        <div className="space-y-2 pt-1 border-t border-slate-200/80">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 flex items-center gap-1.5">
              <Bus className="w-3.5 h-3.5 text-sky-600" />
              Assigned Bus:
            </span>
            {route.busNumber ? (
              <span className="font-medium text-slate-800 font-mono">
                {route.busNumber}{' '}
                <span className="text-slate-400">({route.busRegistrationNumber})</span>
              </span>
            ) : (
              <span className="text-slate-400 italic">Unassigned</span>
            )}
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-indigo-600" />
              Assigned Driver:
            </span>
            {route.driverName ? (
              <span className="font-medium text-slate-800">
                {route.driverName}{' '}
                {route.driverPhone && (
                  <span className="text-slate-400 font-mono text-[11px]">
                    ({route.driverPhone})
                  </span>
                )}
              </span>
            ) : (
              <span className="text-slate-400 italic">Unassigned</span>
            )}
          </div>
        </div>
      </div>

      {/* 4. Sequenced Stops Timeline Header */}
      <div className="p-3 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-slate-600" />
          <span className="text-xs font-semibold text-slate-800 uppercase tracking-wide">
            Stops Sequence ({stops.length})
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onAddStop && (
            <button
              type="button"
              onClick={onAddStop}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-md transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Stop
            </button>
          )}
        </div>
      </div>

      {/* 5. Sequenced Stops List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-2">
        {stops.length === 0 ? (
          <div className="p-8 text-center text-slate-500 space-y-2">
            <MapPin className="w-8 h-8 mx-auto text-slate-300" />
            <p className="text-xs">No pickup stops defined for this route yet.</p>
            {onAddStop && (
              <button
                type="button"
                onClick={onAddStop}
                className="inline-flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 font-semibold"
              >
                <Plus className="w-3.5 h-3.5" />
                Add First Pickup Stop
              </button>
            )}
          </div>
        ) : (
          stops.map((stop, idx) => {
            const isSelected = stop.id === selectedStopId;

            return (
              <div
                key={stop.id}
                onClick={() => onSelectStop?.(stop)}
                className={`p-3 rounded-lg cursor-pointer transition-colors flex items-start gap-3 ${
                  isSelected
                    ? 'bg-sky-50 border border-sky-200 shadow-2xs'
                    : 'hover:bg-slate-50 border border-transparent'
                }`}
              >
                {/* Sequence Badge */}
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center font-mono font-bold text-xs shrink-0 mt-0.5 ${
                    isSelected
                      ? 'bg-sky-600 text-white shadow-2xs'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {stop.sequenceOrder}
                </div>

                {/* Stop Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <h4 className="text-xs font-semibold text-slate-900 truncate">
                      {stop.stopName}
                    </h4>
                    <span className="text-[11px] font-mono text-slate-500 shrink-0">
                      {stop.scheduledTime}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <Radio className="w-3 h-3 text-indigo-500" />
                      {stop.geofenceRadiusMeters}m geofence
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3 text-emerald-600" />
                      {stop.assignedStudentsCount} student{stop.assignedStudentsCount === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 6. Footer / Re-calculate Path action */}
      {stops.length >= 2 && onRefreshDirections && (
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            Recalculate route driving path & ETA
          </span>
          <button
            type="button"
            disabled={isDirectionsLoading}
            onClick={onRefreshDirections}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-md shadow-2xs transition-colors disabled:opacity-50"
          >
            <Compass className={`w-3.5 h-3.5 ${isDirectionsLoading ? 'animate-spin' : ''}`} />
            {isDirectionsLoading ? 'Calculating...' : 'Recalculate Path'}
          </button>
        </div>
      )}
    </div>
  );
}
