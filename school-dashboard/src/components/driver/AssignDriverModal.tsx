'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Bus,
  Route,
  User,
  Phone,
  FileBadge,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Unlink,
  Link2,
} from 'lucide-react';
import { DriverWithBus, BusWithDriver } from '@school-bus/shared';
import { updateDriverBusAssignment, fetchAvailableBuses } from '../../services/driverApi';

interface AssignDriverModalProps {
  schoolId: string;
  isOpen: boolean;
  driver: DriverWithBus | null;
  onClose: () => void;
  onSuccess: (updatedDriver: DriverWithBus) => void;
}

export function AssignDriverModal({
  schoolId,
  isOpen,
  driver,
  onClose,
  onSuccess,
}: AssignDriverModalProps) {
  const [availableBuses, setAvailableBuses] = useState<BusWithDriver[]>([]);
  const [selectedBusId, setSelectedBusId] = useState<string>('');
  const [isLoadingBuses, setIsLoadingBuses] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (isOpen && driver) {
      setSelectedBusId(driver.assignedBusId || '');
      setServerError(null);
      setValidationError(null);
      setIsSuccess(false);
      setIsLoadingBuses(true);

      fetchAvailableBuses(schoolId)
        .then((buses) => {
          setAvailableBuses(buses);
        })
        .catch(() => {
          setAvailableBuses([]);
        })
        .finally(() => {
          setIsLoadingBuses(false);
        });
    }
  }, [isOpen, driver, schoolId]);

  if (!isOpen || !driver) return null;

  const handleAssign = async (busIdToAssign: string | null) => {
    setServerError(null);
    setValidationError(null);

    if (busIdToAssign === undefined) {
      if (!selectedBusId) {
        setValidationError('Please select a fleet vehicle from the list to assign.');
        return;
      }
      busIdToAssign = selectedBusId;
    }

    if (!driver?.id) return;

    setIsSubmitting(true);

    try {
      const updated = await updateDriverBusAssignment(schoolId, driver.id, {
        busId: busIdToAssign,
      });

      setIsSuccess(true);
      setTimeout(() => {
        onSuccess(updated);
        onClose();
      }, 700);
    } catch (err: any) {
      setServerError(err.message || 'Failed to update vehicle assignment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isCurrentAssigned = Boolean(driver.assignedBusId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center text-white shrink-0">
              <Bus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">
                Pair Vehicle & Route Assignment
              </h3>
              <p className="text-[11px] text-slate-300">
                Manage assigned bus and default transit route for driver
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

        {/* Modal Body */}
        <div className="p-6 space-y-5">
          {/* Driver Profile Summary Card */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-3">
            <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-200 border-2 border-slate-300 flex items-center justify-center shrink-0">
              {driver.photoUrl ? (
                <img
                  src={driver.photoUrl}
                  alt={driver.fullName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-6 h-6 text-slate-400" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-bold text-slate-900 truncate">{driver.fullName}</h4>
              <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-600">
                <span className="flex items-center gap-1 font-mono">
                  <Phone className="w-3 h-3 text-emerald-600" />
                  {driver.phone}
                </span>
                <span className="flex items-center gap-1 font-mono text-slate-500">
                  <FileBadge className="w-3 h-3 text-slate-400" />
                  {driver.licenseNumber}
                </span>
              </div>
            </div>
          </div>

          {/* Current Assignment Status Box */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">
              Current Assignment
            </label>
            {isCurrentAssigned ? (
              <div className="p-3 bg-sky-50/70 border border-sky-200 rounded-lg flex items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold bg-sky-100 text-sky-800 border border-sky-300 font-mono">
                      <Bus className="w-3.5 h-3.5 text-sky-700" />
                      {driver.assignedBusNumber}
                    </span>
                    <span className="text-xs font-mono text-slate-600">
                      ({driver.assignedRegistrationNumber})
                    </span>
                  </div>
                  {driver.assignedRouteName ? (
                    <div className="flex items-center gap-1.5 text-xs text-slate-700">
                      <Route className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                      <span className="font-semibold">{driver.assignedRouteName}</span>
                      <span className="font-mono text-[10px] text-slate-500 bg-white px-1.5 py-0.2 border border-slate-200 rounded">
                        {driver.assignedRouteCode}
                      </span>
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500 italic">No default route linked to this bus.</p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => handleAssign(null)}
                  disabled={isSubmitting || isSuccess}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded transition-colors disabled:opacity-50"
                  title="Unbind driver from this vehicle"
                >
                  <Unlink className="w-3 h-3" />
                  Unassign
                </button>
              </div>
            ) : (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-2 text-xs text-slate-500">
                <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                <span>Driver is currently unassigned (Standby / Spare driver).</span>
              </div>
            )}
          </div>

          {/* Validation & Server Error Messages */}
          {validationError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-rose-900 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {serverError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-rose-900 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold block">Error updating assignment</strong>
                <span>{serverError}</span>
              </div>
            </div>
          )}

          {/* Success Banner */}
          {isSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-900 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Vehicle assignment updated successfully!</span>
            </div>
          )}

          {/* Select Vehicle Dropdown */}
          <div className="space-y-1.5 pt-2 border-t border-slate-100">
            <label className="block text-xs font-bold text-slate-700">
              Select Fleet Vehicle to Assign
            </label>

            {isLoadingBuses ? (
              <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600" />
                <span>Loading fleet buses...</span>
              </div>
            ) : availableBuses.length === 0 ? (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800">
                No fleet buses found for this school. Please register buses in Bus Management first.
              </div>
            ) : (
              <div className="relative">
                <Bus className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <select
                  value={selectedBusId}
                  onChange={(e) => {
                    setSelectedBusId(e.target.value);
                    setValidationError(null);
                  }}
                  disabled={isSubmitting || isSuccess}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500 text-slate-800 font-medium"
                >
                  <option value="">-- Choose fleet vehicle --</option>
                  {availableBuses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.busNumber} â€¢ {b.registrationNumber}{' '}
                      {b.assignedRouteName ? `(Route: ${b.assignedRouteName})` : '(No route)'}{' '}
                      {b.defaultDriverId && b.defaultDriverId !== driver.id
                        ? `[Currently with ${b.driverName || 'Another Driver'}]`
                        : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <p className="text-[10px] text-slate-400">
              Pairing this driver will automatically link them with this bus&apos;s active morning & evening routes.
            </p>
          </div>


          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-md text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleAssign(selectedBusId)}
              disabled={isSubmitting || isSuccess || !selectedBusId || selectedBusId === driver.assignedBusId}
              className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-md text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving Assignment...
                </>
              ) : (
                <>
                  <Link2 className="w-3.5 h-3.5" />
                  {isCurrentAssigned ? 'Update Assignment' : 'Assign Bus'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

