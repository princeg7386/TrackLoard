'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  KeyRound,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Loader2,
  User,
  ShieldAlert,
} from 'lucide-react';
import { DriverWithBus, ResetDriverPinRequestSchema } from '@school-bus/shared';
import { resetDriverPin } from '../../services/driverApi';

interface ResetDriverPinModalProps {
  schoolId: string;
  driver: DriverWithBus | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ResetDriverPinModal({
  schoolId,
  driver,
  isOpen,
  onClose,
  onSuccess,
}: ResetDriverPinModalProps) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setConfirmPin('');
      setShowPin(false);
      setFieldErrors({});
      setServerError(null);
      setIsSuccess(false);
    }
  }, [isOpen]);

  if (!isOpen || !driver) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setFieldErrors({});

    const cleanPin = pin.trim();
    const cleanConfirm = confirmPin.trim();

    if (cleanPin !== cleanConfirm) {
      setFieldErrors({ confirmPin: 'PIN confirmation does not match.' });
      return;
    }

    const validation = ResetDriverPinRequestSchema.safeParse({ pin: cleanPin });
    if (!validation.success) {
      setFieldErrors({ pin: validation.error.errors[0]?.message || 'Invalid PIN' });
      return;
    }

    if (!driver.id) {
      setServerError('Driver ID is missing.');
      return;
    }

    setIsSubmitting(true);

    try {
      await resetDriverPin(schoolId, driver.id, cleanPin);
      setIsSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 800);
    } catch (err: any) {
      setServerError(err.message || 'Failed to reset driver login PIN.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center text-white shrink-0">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">
                Reset Driver App PIN
              </h3>
              <p className="text-[11px] text-slate-300">
                Update login credentials for Android Flutter mobile app
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

        {/* Modal Body / Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Driver Summary Banner */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-3">
            <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-200 border border-slate-300 flex items-center justify-center shrink-0">
              {driver.photoUrl ? (
                <img
                  src={driver.photoUrl}
                  alt={driver.fullName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-5 h-5 text-slate-400" />
              )}
            </div>
            <div className="flex-1 min-w-0 text-xs">
              <h4 className="font-bold text-slate-900 truncate">{driver.fullName}</h4>
              <p className="font-mono text-slate-500 text-[11px]">{driver.phone}</p>
            </div>
          </div>

          {/* Server Error Alert */}
          {serverError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-rose-900 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold block">Error</strong>
                <span>{serverError}</span>
              </div>
            </div>
          )}

          {/* Success Banner */}
          {isSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-900 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Driver PIN has been reset successfully!</span>
            </div>
          )}

          {/* New PIN Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              New Login PIN <span className="text-slate-400 font-normal">(4 to 6 digits)</span>
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type={showPin ? 'text' : 'password'}
                maxLength={6}
                required
                placeholder="Enter 4-6 digit numeric PIN"
                value={pin}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  setPin(val);
                  if (fieldErrors.pin) setFieldErrors((prev) => ({ ...prev, pin: '' }));
                }}
                disabled={isSubmitting}
                className={`w-full pl-9 pr-9 py-2 text-xs font-mono bg-white border rounded-md focus:outline-hidden focus:ring-1 ${
                  fieldErrors.pin
                    ? 'border-rose-300 focus:ring-rose-500 bg-rose-50/20'
                    : 'border-slate-300 focus:ring-sky-500'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                tabIndex={-1}
              >
                {showPin ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            {fieldErrors.pin && (
              <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.pin}</p>
            )}
          </div>

          {/* Confirm PIN Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Confirm New PIN
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type={showPin ? 'text' : 'password'}
                maxLength={6}
                required
                placeholder="Re-enter new numeric PIN"
                value={confirmPin}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  setConfirmPin(val);
                  if (fieldErrors.confirmPin) setFieldErrors((prev) => ({ ...prev, confirmPin: '' }));
                }}
                disabled={isSubmitting}
                className={`w-full pl-9 pr-9 py-2 text-xs font-mono bg-white border rounded-md focus:outline-hidden focus:ring-1 ${
                  fieldErrors.confirmPin
                    ? 'border-rose-300 focus:ring-rose-500 bg-rose-50/20'
                    : 'border-slate-300 focus:ring-sky-500'
                }`}
              />
            </div>
            {fieldErrors.confirmPin && (
              <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.confirmPin}</p>
            )}
          </div>

          <p className="text-[11px] text-slate-500 bg-sky-50/50 p-2.5 rounded border border-sky-100">
            Note: Updating the PIN will be recorded in the security audit log. The driver can immediately use the new PIN to sign in on their Android device.
          </p>

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
              type="submit"
              disabled={isSubmitting || isSuccess || !pin || pin.length < 4}
              className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-md text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Updating PIN...
                </>
              ) : (
                'Set New PIN'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
