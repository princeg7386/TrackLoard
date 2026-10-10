'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Bus,
  User,
  MapPin,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  UserCheck,
  UserX,
  MapPinOff,
} from 'lucide-react';
import { BusWithDriver, Driver, Route } from '@school-bus/shared';
import {
  updateBusAssignments,
  fetchAvailableDrivers,
  fetchAvailableRoutes,
} from '../../services/busApi';

interface AssignBusModalProps {
  schoolId: string;
  bus: BusWithDriver | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedBus: BusWithDriver) => void;
}

export function AssignBusModal({
  schoolId,
  bus,
  isOpen,
  onClose,
  onSuccess,
}: AssignBusModalProps) {
  const [selectedDriverId, setSelectedDriverId] = useState<string>('');
  const [selectedRouteId, setSelectedRouteId] = useState<string>('');

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [isLoadingDropdowns, setIsLoadingDropdowns] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (isOpen && bus) {
      setSelectedDriverId(bus.defaultDriverId || '');
      setSelectedRouteId(bus.assignedRouteId || '');
      setServerError(null);
      setIsSuccess(false);

      setIsLoadingDropdowns(true);
      Promise.all([
        fetchAvailableDrivers(schoolId),
        fetchAvailableRoutes(schoolId),
      ])
        .then(([driverList, routeList]) => {
          setDrivers(driverList);
          setRoutes(routeList);
        })
        .catch(() => {})
        .finally(() => setIsLoadingDropdowns(false));
    }
  }, [isOpen, bus, schoolId]);

  if (!isOpen || !bus) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setIsSubmitting(true);

    try {
      const updated = await updateBusAssignments(schoolId, bus.id!, {
        driverId: selectedDriverId ? selectedDriverId : null,
        routeId: selectedRouteId ? selectedRouteId : null,
      });

      setIsSuccess(true);
      setTimeout(() => {
        onSuccess(updated);
        onClose();
      }, 700);
    } catch (err: any) {
      setServerError(err.message || 'Failed to update bus assignments.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center text-white">
              <Bus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">
                Pair Driver & Route
              </h3>
              <p className="text-[11px] text-slate-300">
                Manage operational assignments for {bus.busNumber}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1 text-slate-400 hover:text-white rounded transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Bus Summary Banner */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800">{bus.busNumber}</span>
            <span className="px-1.5 py-0.5 rounded font-mono bg-white border border-slate-300 text-slate-700 text-[11px]">
              {bus.registrationNumber}
            </span>
          </div>
          <span className="text-slate-500">{bus.makeModel || 'Standard Fleet Bus'}</span>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Server Error Banner */}
          {serverError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-rose-900 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold block">Assignment Error</strong>
                <span>{serverError}</span>
              </div>
            </div>
          )}

          {/* Success Banner */}
          {isSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-900 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Assignments updated successfully! Refreshing fleet...</span>
            </div>
          )}

          {/* 1. Driver Assignment Section */}
          <div className="space-y-2 p-3.5 bg-slate-50/70 border border-slate-200 rounded-lg">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-sky-600" />
                Primary Driver Assignment
              </label>
              {selectedDriverId && (
                <button
                  type="button"
                  onClick={() => setSelectedDriverId('')}
                  className="text-[11px] text-rose-600 hover:text-rose-700 flex items-center gap-1 font-semibold"
                >
                  <UserX className="w-3 h-3" />
                  Unassign
                </button>
              )}
            </div>

            <select
              value={selectedDriverId}
              onChange={(e) => setSelectedDriverId(e.target.value)}
              disabled={isSubmitting || isLoadingDropdowns}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500 text-slate-800"
            >
              <option value="">-- No driver assigned (Unassigned) --</option>
              {drivers.map((drv) => (
                <option key={drv.id} value={drv.id}>
                  {drv.fullName} • Phone: {drv.phone} • License: {drv.licenseNumber}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500">
              The assigned driver receives trip triggers, student rosters, and WhatsApp dispatch prompts.
            </p>
          </div>

          {/* 2. Route Assignment Section */}
          <div className="space-y-2 p-3.5 bg-slate-50/70 border border-slate-200 rounded-lg">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-sky-600" />
                Default Route Assignment
              </label>
              {selectedRouteId && (
                <button
                  type="button"
                  onClick={() => setSelectedRouteId('')}
                  className="text-[11px] text-rose-600 hover:text-rose-700 flex items-center gap-1 font-semibold"
                >
                  <MapPinOff className="w-3 h-3" />
                  Unassign
                </button>
              )}
            </div>

            <select
              value={selectedRouteId}
              onChange={(e) => setSelectedRouteId(e.target.value)}
              disabled={isSubmitting || isLoadingDropdowns}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500 text-slate-800"
            >
              <option value="">-- No route assigned (Unassigned) --</option>
              {routes.map((rte) => (
                <option key={rte.id} value={rte.id}>
                  {rte.name} ({rte.code}) • {rte.routeType.replace('_', ' ')}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500">
              Assigns this bus as the primary vehicle for scheduled morning/evening pickups.
            </p>
          </div>

          {/* Modal Actions */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-md text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isSuccess}
              className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-md text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving Assignments...
                </>
              ) : (
                'Save Assignments'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
