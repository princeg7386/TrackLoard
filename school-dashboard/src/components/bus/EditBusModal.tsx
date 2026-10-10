'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Bus,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Cpu,
  Hash,
  FileText,
} from 'lucide-react';
import {
  UpdateBusRequestSchema,
  normalizeIndianRegistrationNumber,
  BusWithDriver,
} from '@school-bus/shared';
import { updateBus } from '../../services/busApi';

interface EditBusModalProps {
  schoolId: string;
  bus: BusWithDriver | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedBus: BusWithDriver) => void;
}

export function EditBusModal({
  schoolId,
  bus,
  isOpen,
  onClose,
  onSuccess,
}: EditBusModalProps) {
  const [busNumber, setBusNumber] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [makeModel, setMakeModel] = useState('');
  const [deviceIdentifier, setDeviceIdentifier] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (isOpen && bus) {
      setBusNumber(bus.busNumber || '');
      setRegistrationNumber(bus.registrationNumber || '');
      setMakeModel(bus.makeModel || '');
      setDeviceIdentifier(bus.deviceIdentifier || '');
      setFieldErrors({});
      setServerError(null);
      setIsSuccess(false);
    }
  }, [isOpen, bus]);

  if (!isOpen || !bus) return null;

  const handleRegistrationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.toUpperCase();
    setRegistrationNumber(raw);
    if (fieldErrors.registrationNumber) {
      setFieldErrors((prev) => ({ ...prev, registrationNumber: '' }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setFieldErrors({});

    const formattedReg = normalizeIndianRegistrationNumber(registrationNumber);

    const payload = {
      busNumber: busNumber.trim(),
      registrationNumber: formattedReg,
      makeModel: makeModel.trim() || undefined,
      deviceIdentifier: deviceIdentifier.trim() || undefined,
    };

    const validationResult = UpdateBusRequestSchema.safeParse(payload);
    if (!validationResult.success) {
      const errors: Record<string, string> = {};
      for (const err of validationResult.error.errors) {
        const path = err.path[0] as string;
        if (!errors[path]) {
          errors[path] = err.message;
        }
      }
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);

    try {
      const updated = await updateBus(schoolId, bus.id!, payload);
      setIsSuccess(true);
      setTimeout(() => {
        onSuccess(updated);
        onClose();
      }, 700);
    } catch (err: any) {
      setServerError(err.message || 'Failed to update vehicle details.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center text-white">
              <Bus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">Edit Vehicle Details</h3>
              <p className="text-[11px] text-slate-300">
                Update registration, model specifications, or hardware tracking IMEI
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

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Server Error Banner */}
          {serverError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-rose-900 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold block">Update Error</strong>
                <span>{serverError}</span>
              </div>
            </div>
          )}

          {/* Success Banner */}
          {isSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-900 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Vehicle specifications updated successfully!</span>
            </div>
          )}

          {/* Row 1: Bus Internal Identifier & Registration Number */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Bus Identifier */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Internal Bus Number <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Hash className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Bus-01"
                  value={busNumber}
                  onChange={(e) => {
                    setBusNumber(e.target.value);
                    if (fieldErrors.busNumber) setFieldErrors((prev) => ({ ...prev, busNumber: '' }));
                  }}
                  disabled={isSubmitting}
                  className={`w-full pl-9 pr-3 py-2 text-xs bg-white border rounded-md focus:outline-hidden focus:ring-1 ${
                    fieldErrors.busNumber
                      ? 'border-rose-300 focus:ring-rose-500 bg-rose-50/20'
                      : 'border-slate-300 focus:ring-sky-500'
                  }`}
                />
              </div>
              {fieldErrors.busNumber && (
                <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.busNumber}</p>
              )}
            </div>

            {/* Official Registration Number */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Vehicle Registration (RTO) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <FileText className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="e.g. DL-01-AB-1234"
                  value={registrationNumber}
                  onChange={handleRegistrationChange}
                  disabled={isSubmitting}
                  className={`w-full pl-9 pr-3 py-2 text-xs font-mono uppercase bg-white border rounded-md focus:outline-hidden focus:ring-1 ${
                    fieldErrors.registrationNumber
                      ? 'border-rose-300 focus:ring-rose-500 bg-rose-50/20'
                      : 'border-slate-300 focus:ring-sky-500'
                  }`}
                />
              </div>
              {fieldErrors.registrationNumber && (
                <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.registrationNumber}</p>
              )}
            </div>
          </div>

          {/* Row 2: Make / Model & GPS Device ID */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Make / Model */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Make & Model <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                list="edit-make-model-suggestions"
                placeholder="e.g. Tata Starbus 32"
                value={makeModel}
                onChange={(e) => setMakeModel(e.target.value)}
                disabled={isSubmitting}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500"
              />
              <datalist id="edit-make-model-suggestions">
                <option value="Tata Starbus 32" />
                <option value="Force Traveller 26" />
                <option value="Ashok Leyland Sunshine" />
                <option value="Eicher Starline" />
                <option value="SML Isuzu Executive" />
                <option value="Mahindra Cruzio" />
              </datalist>
            </div>

            {/* GPS Hardware IMEI */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                GPS Device Identifier <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <div className="relative">
                <Cpu className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="e.g. IMEI-9988776655"
                  value={deviceIdentifier}
                  onChange={(e) => setDeviceIdentifier(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full pl-9 pr-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>
          </div>

          {/* Modal Actions */}
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
              type="submit"
              disabled={isSubmitting || isSuccess}
              className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-md text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Saving Changes...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
