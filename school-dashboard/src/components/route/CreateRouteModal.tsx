'use client';

import React, { useState } from 'react';
import {
  X,
  MapPin,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Clock,
  Compass,
} from 'lucide-react';
import {
  CreateRouteRequestSchema,
  RouteType,
  type RouteDetail,
} from '@school-bus/shared';
import { RouteApiService } from '../../services/routeApi';

interface CreateRouteModalProps {
  schoolId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newRoute: RouteDetail) => void;
}

export function CreateRouteModal({
  schoolId,
  isOpen,
  onClose,
  onSuccess,
}: CreateRouteModalProps) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [routeType, setRouteType] = useState<RouteType>(RouteType.MORNING_PICKUP);
  const [estimatedDurationMinutes, setEstimatedDurationMinutes] = useState(45);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setFieldErrors({});

    const payload = {
      name: name.trim(),
      code: code.trim().toUpperCase(),
      routeType,
      estimatedDurationMinutes: Number(estimatedDurationMinutes),
    };

    const parseResult = CreateRouteRequestSchema.safeParse(payload);
    if (!parseResult.success) {
      const errors: Record<string, string> = {};
      parseResult.error.errors.forEach((err) => {
        const field = err.path[0] as string;
        errors[field] = err.message;
      });
      setFieldErrors(errors);
      return;
    }

    try {
      setIsSubmitting(true);
      const created = await RouteApiService.createRoute(schoolId, parseResult.data);
      setIsSuccess(true);
      setTimeout(() => {
        onSuccess(created);
        onClose();
        setIsSuccess(false);
        setName('');
        setCode('');
      }, 700);
    } catch (err: any) {
      setServerError(err.message || 'Failed to create route. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-sky-100 text-sky-700 rounded-lg">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Create Transport Route</h3>
              <p className="text-xs text-slate-500">Configure new school bus route schedule</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {serverError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-xs text-rose-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{serverError}</span>
            </div>
          )}

          {isSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-xs text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
              <span>Route created successfully!</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Route Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. South Campus Morning Express"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-sky-500"
              required
            />
            {fieldErrors.name && (
              <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.name}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Route Code <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. RT-01"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-xs font-mono uppercase border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-sky-500"
                required
              />
              {fieldErrors.code && (
                <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.code}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Route Type <span className="text-rose-500">*</span>
              </label>
              <select
                value={routeType}
                onChange={(e) => setRouteType(e.target.value as RouteType)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-sky-500 bg-white"
              >
                <option value={RouteType.MORNING_PICKUP}>Morning Pickup</option>
                <option value={RouteType.AFTERNOON_DROP}>Afternoon Drop</option>
                <option value={RouteType.SPECIAL_TRIP}>Special Trip</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Estimated Duration (Minutes)
            </label>
            <div className="relative">
              <Clock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="number"
                min="5"
                max="240"
                value={estimatedDurationMinutes}
                onChange={(e) => setEstimatedDurationMinutes(Number(e.target.value))}
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-sky-500"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isSubmitting ? 'Creating...' : 'Create Route'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
