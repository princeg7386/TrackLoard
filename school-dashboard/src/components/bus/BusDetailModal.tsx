'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Bus,
  MapPin,
  Cpu,
  Smartphone,
  Navigation,
  Clock,
  Gauge,
  Compass,
  AlertCircle,
  RefreshCw,
  Edit2,
  Trash2,
  Settings2,
  Activity,
  History,
} from 'lucide-react';
import { BusDetailView } from '@school-bus/shared';
import { fetchBusDetail } from '../../services/busApi';

interface BusDetailModalProps {
  schoolId: string;
  busId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (bus: BusDetailView) => void;
  onManageAssignments: (bus: BusDetailView) => void;
  onDelete: (bus: BusDetailView) => void;
  onViewHistory: (bus: BusDetailView) => void;
}

export function BusDetailModal({
  schoolId,
  busId,
  isOpen,
  onClose,
  onEdit,
  onManageAssignments,
  onDelete,
  onViewHistory,
}: BusDetailModalProps) {
  const [busDetail, setBusDetail] = useState<BusDetailView | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadDetails = useCallback(async () => {
    if (!busId) return;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await fetchBusDetail(schoolId, busId);
      setBusDetail(data);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load vehicle telemetry and details.');
    } finally {
      setIsLoading(false);
    }
  }, [schoolId, busId]);

  useEffect(() => {
    if (isOpen && busId) {
      loadDetails();
    } else {
      setBusDetail(null);
      setErrorMessage(null);
    }
  }, [isOpen, busId, loadDetails]);

  if (!isOpen || !busId) return null;

  const formatIST = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center text-white shrink-0">
              <Bus className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-tight">
                  {busDetail ? busDetail.busNumber : 'Vehicle Telemetry & Details'}
                </h3>
                {busDetail && (
                  <span className="px-2 py-0.5 rounded font-mono text-[11px] bg-slate-800 text-sky-300 border border-slate-700">
                    {busDetail.registrationNumber}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-300">
                Live PostGIS coordinates, dispatch state, and driver pairings
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadDetails}
              disabled={isLoading}
              title="Refresh Telemetry"
              className="p-1.5 text-slate-400 hover:text-white rounded transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-white rounded transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Loading State */}
          {isLoading && !busDetail && (
            <div className="py-12 space-y-4 text-center">
              <div className="inline-flex p-3 rounded-full bg-sky-50 text-sky-600 animate-pulse">
                <Bus className="w-6 h-6 animate-bounce" />
              </div>
              <p className="text-xs text-slate-500 font-medium">
                Fetching vehicle telemetry & trip status...
              </p>
            </div>
          )}

          {/* Error State */}
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start justify-between gap-2 text-rose-900 text-xs">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-semibold block">Failed to load vehicle</strong>
                  <span>{errorMessage}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={loadDetails}
                className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded font-medium text-[11px] shadow-2xs shrink-0"
              >
                Retry
              </button>
            </div>
          )}

          {busDetail && (
            <>
              {/* Section 1: Live Telemetry & GPS State */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                    <Navigation className="w-4 h-4 text-sky-600" />
                    <span>Real-Time GPS Telemetry</span>
                  </div>
                  {busDetail.currentLocation ? (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live Signal
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-500 font-medium">No Recent Signal</span>
                  )}
                </div>

                <div className="p-4 bg-white">
                  {busDetail.currentLocation ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      {/* Coordinates */}
                      <div className="p-2.5 bg-slate-50 rounded-md border border-slate-100">
                        <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                          Coordinates
                        </span>
                        <span className="font-mono font-medium text-slate-800 text-[11px] truncate block mt-0.5">
                          {busDetail.currentLocation.latitude.toFixed(5)},{' '}
                          {busDetail.currentLocation.longitude.toFixed(5)}
                        </span>
                      </div>

                      {/* Speed */}
                      <div className="p-2.5 bg-slate-50 rounded-md border border-slate-100">
                        <span className="text-[10px] text-slate-400 uppercase font-semibold flex items-center gap-1">
                          <Gauge className="w-3 h-3 text-sky-500" />
                          Speed
                        </span>
                        <span className="font-bold text-slate-800 text-sm block mt-0.5">
                          {busDetail.currentLocation.speedKmh != null
                            ? `${Math.round(busDetail.currentLocation.speedKmh)} km/h`
                            : '0 km/h (Idle)'}
                        </span>
                      </div>

                      {/* Heading / Bearing */}
                      <div className="p-2.5 bg-slate-50 rounded-md border border-slate-100">
                        <span className="text-[10px] text-slate-400 uppercase font-semibold flex items-center gap-1">
                          <Compass className="w-3 h-3 text-sky-500" />
                          Heading
                        </span>
                        <span className="font-medium text-slate-800 text-xs block mt-0.5">
                          {busDetail.currentLocation.bearingDegrees != null
                            ? `${Math.round(busDetail.currentLocation.bearingDegrees)}°`
                            : 'N/A'}
                        </span>
                      </div>

                      {/* Last Packet IST */}
                      <div className="p-2.5 bg-slate-50 rounded-md border border-slate-100">
                        <span className="text-[10px] text-slate-400 uppercase font-semibold flex items-center gap-1">
                          <Clock className="w-3 h-3 text-sky-500" />
                          Last Recorded
                        </span>
                        <span className="font-medium text-slate-800 text-[11px] block mt-0.5">
                          {formatIST(busDetail.currentLocation.recordedAt)} IST
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="py-4 text-center text-xs text-slate-500">
                      <p className="font-medium text-slate-700">No telemetry packets received yet</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Telemetry will appear once the assigned driver starts tracking via the Android app or hardware GPS.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Section 2: Active Trip Dispatch State */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                    <Activity className="w-4 h-4 text-sky-600" />
                    <span>Current / Today's Trip</span>
                  </div>
                  {busDetail.currentTrip && (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${
                        busDetail.currentTrip.status === 'IN_PROGRESS'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : busDetail.currentTrip.status === 'SCHEDULED'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-slate-100 text-slate-700 border-slate-200'
                      }`}
                    >
                      {busDetail.currentTrip.status === 'IN_PROGRESS' && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      )}
                      {busDetail.currentTrip.status.replace('_', ' ')}
                    </span>
                  )}
                </div>

                <div className="p-4 bg-white">
                  {busDetail.currentTrip ? (
                    <div className="space-y-3 text-xs">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                        <div>
                          <span className="text-[10px] text-slate-400 font-semibold uppercase">Route</span>
                          <p className="font-bold text-slate-900 text-sm flex items-center gap-1.5 mt-0.5">
                            <MapPin className="w-3.5 h-3.5 text-sky-600" />
                            {busDetail.currentTrip.routeName}
                            <span className="text-xs font-mono text-slate-400 font-normal">
                              ({busDetail.currentTrip.routeCode})
                            </span>
                          </p>
                        </div>
                        <div className="sm:text-right">
                          <span className="text-[10px] text-slate-400 font-semibold uppercase">Route Type</span>
                          <p className="font-semibold text-slate-700 mt-0.5">
                            {busDetail.currentTrip.routeType.replace('_', ' ')}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div>
                          <span className="text-[10px] text-slate-400 font-semibold uppercase">Scheduled Start</span>
                          <p className="font-mono text-slate-800 mt-0.5">
                            {formatIST(busDetail.currentTrip.scheduledStartTime)}
                          </p>
                        </div>

                        <div>
                          <span className="text-[10px] text-slate-400 font-semibold uppercase">Stop Progress</span>
                          <p className="font-semibold text-slate-800 mt-0.5">
                            {busDetail.currentTrip.currentStopSequence != null
                              ? `Stop #${busDetail.currentTrip.currentStopSequence}`
                              : 'Not started'}
                          </p>
                        </div>

                        <div>
                          <span className="text-[10px] text-slate-400 font-semibold uppercase">Punctuality</span>
                          <p className="mt-0.5">
                            {busDetail.currentTrip.delayMinutes > 0 ? (
                              <span className="text-amber-600 font-semibold">
                                +{busDetail.currentTrip.delayMinutes} min delay
                              </span>
                            ) : (
                              <span className="text-emerald-600 font-semibold">On Schedule</span>
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="py-4 text-center text-xs text-slate-500">
                      <p className="font-medium text-slate-700">No active or scheduled trip right now</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Trips are scheduled based on the default route or manual coordinator dispatch.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Section 3: Identity & Operational Assignments */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Specifications */}
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-xs">
                  <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
                    Vehicle Specifications
                  </span>
                  <div className="space-y-1.5 text-slate-700">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Make & Model:</span>
                      <span className="font-medium">{busDetail.makeModel || 'Standard School Bus'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Telemetry Feed:</span>
                      <span className="font-mono text-[11px] flex items-center gap-1">
                        {busDetail.deviceIdentifier ? (
                          <>
                            <Cpu className="w-3 h-3 text-indigo-600" />
                            {busDetail.deviceIdentifier}
                          </>
                        ) : (
                          <>
                            <Smartphone className="w-3 h-3 text-sky-600" />
                            Driver App GPS
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Primary Pairings */}
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                      Primary Pairings
                    </span>
                    <button
                      type="button"
                      onClick={() => onManageAssignments(busDetail)}
                      className="text-[11px] text-sky-600 hover:text-sky-700 font-semibold flex items-center gap-1"
                    >
                      <Settings2 className="w-3 h-3" />
                      Manage
                    </button>
                  </div>
                  <div className="space-y-1.5 text-slate-700">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Driver:</span>
                      <span className="font-medium">
                        {busDetail.driverName ? (
                          <span className="text-emerald-700 font-semibold">{busDetail.driverName}</span>
                        ) : (
                          <span className="text-slate-400 italic">Unassigned</span>
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Default Route:</span>
                      <span className="font-medium truncate max-w-[150px]">
                        {busDetail.assignedRouteName ? (
                          <span className="text-sky-700 font-semibold">{busDetail.assignedRouteName}</span>
                        ) : (
                          <span className="text-slate-400 italic">Unassigned</span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer with Operational Action Triggers */}
        {busDetail && (
          <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
            <button
              type="button"
              onClick={() => onDelete(busDetail)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:text-rose-800 hover:bg-rose-50 border border-rose-200 rounded-md transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-500" />
              Remove Vehicle
            </button>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => onViewHistory(busDetail)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-sky-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-md shadow-2xs transition-colors"
              >
                <History className="w-3.5 h-3.5 text-slate-500" />
                History & Audits
              </button>
              <button
                type="button"
                onClick={() => onEdit(busDetail)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-300 rounded-md shadow-2xs transition-colors"
              >
                <Edit2 className="w-3.5 h-3.5 text-slate-500" />
                Edit Vehicle
              </button>
              <button
                type="button"
                onClick={() => onManageAssignments(busDetail)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-md shadow-xs transition-colors"
              >
                <Settings2 className="w-3.5 h-3.5" />
                Pair Driver & Route
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
