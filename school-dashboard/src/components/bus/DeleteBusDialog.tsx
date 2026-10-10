'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  X,
  Loader2,
  Trash2,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';
import { BusWithDriver } from '@school-bus/shared';
import { deleteBus } from '../../services/busApi';

interface DeleteBusDialogProps {
  schoolId: string;
  bus: BusWithDriver | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (deletedBusId: string) => void;
}

export function DeleteBusDialog({
  schoolId,
  bus,
  isOpen,
  onClose,
  onSuccess,
}: DeleteBusDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  if (!isOpen || !bus) return null;

  const handleDelete = async () => {
    setIsDeleting(true);
    setErrorMessage(null);

    try {
      await deleteBus(schoolId, bus.id!);
      setIsSuccess(true);
      setTimeout(() => {
        onSuccess(bus.id!);
        onClose();
      }, 700);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to remove vehicle from fleet.');
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 bg-rose-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-rose-600 flex items-center justify-center text-white shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">Remove Fleet Vehicle</h3>
              <p className="text-[11px] text-rose-200">Decommission vehicle from active fleet operations</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="p-1 text-rose-300 hover:text-white rounded transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-xs">
          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-rose-900 text-xs">
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold block">Cannot Remove Vehicle</strong>
                <span>{errorMessage}</span>
              </div>
            </div>
          )}

          {/* Success Banner */}
          {isSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-900 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Vehicle removed successfully from active fleet.</span>
            </div>
          )}

          <p className="text-slate-700 leading-relaxed">
            Are you sure you want to remove <strong className="text-slate-900 font-semibold">{bus.busNumber}</strong> (
            <span className="font-mono text-slate-800">{bus.registrationNumber}</span>) from the school fleet?
          </p>

          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-1.5 text-amber-900 text-[11px]">
            <p className="font-bold flex items-center gap-1.5 text-amber-950">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              Operational Safety Invariants:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-amber-800">
              <li>Vehicles with trips currently in progress cannot be deleted.</li>
              <li>Any route with this bus set as default will be automatically unbound.</li>
              <li>Historical telemetry logs and audit trails remain preserved for safety compliance.</li>
            </ul>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-md text-xs font-semibold transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting || isSuccess}
            className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-md text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Removing Vehicle...
              </>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                Confirm Remove Vehicle
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
