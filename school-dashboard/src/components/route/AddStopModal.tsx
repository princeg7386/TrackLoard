'use client';

import React, { useState } from 'react';
import {
  X,
  MapPin,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Clock,
  Radio,
} from 'lucide-react';
import {
  AddRouteStopRequestSchema,
  type RouteStopDetail,
} from '@school-bus/shared';
import { RouteApiService } from '../../services/routeApi';

interface AddStopModalProps {
  schoolId: string;
  routeId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newStop: RouteStopDetail) => void;
  defaultSequenceOrder?: number;
}

export function AddStopModal({
  schoolId,
  routeId,
  isOpen,
  onClose,
  onSuccess,
  defaultSequenceOrder,
}: AddStopModalProps) {
  const [stopName, setStopName] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [scheduledTime, setScheduledTime] = useState('07:30');
  const [geofenceRadiusMeters, setGeofenceRadiusMeters] = useState(300);
  const [sequenceOrder, setSequenceOrder] = useState<string>(
    defaultSequenceOrder ? String(defaultSequenceOrder) : ''
  );

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
      stopName: stopName.trim(),
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      scheduledTime: scheduledTime.trim(),
      geofenceRadiusMeters: Number(geofenceRadiusMeters),
      sequenceOrder: sequenceOrder ? parseInt(sequenceOrder, 10) : undefined,
    };

    const parseResult = AddRouteStopRequestSchema.safeParse(payload);
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
      const added = await RouteApiService.addRouteStop(schoolId, routeId, parseResult.data);
      setIsSuccess(true);
      setTimeout(() => {
        onSuccess(added);
        onClose();
        setIsSuccess(false);
        setStopName('');
        setLatitude('');
        setLongitude('');
      }, 700);
    } catch (err: any) {
      setServerError(err.message || 'Failed to add pickup stop. Please check coordinates and time.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-100 text-indigo-700 rounded-lg">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Add Pickup Stop</h3>
              <p className="text-xs text-slate-500">Insert sequenced stop with geofence</p>
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
              <span>Stop added successfully!</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Stop Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Sector 14 Metro Station Gate 2"
              value={stopName}
              onChange={(e) => setStopName(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-sky-500"
              required
            />
            {fieldErrors.stopName && (
              <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.stopName}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Latitude <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                step="any"
                placeholder="e.g. 28.5355"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-sky-500"
                required
              />
              {fieldErrors.latitude && (
                <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.latitude}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Longitude <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                step="any"
                placeholder="e.g. 77.2410"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-sky-500"
                required
              />
              {fieldErrors.longitude && (
                <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.longitude}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Scheduled Arrival Time <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Clock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="HH:MM (e.g. 07:30)"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-sky-500"
                  required
                />
              </div>
              {fieldErrors.scheduledTime && (
                <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.scheduledTime}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Geofence Radius (Meters)
              </label>
              <div className="relative">
                <Radio className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="number"
                  min="50"
                  max="2000"
                  step="50"
                  value={geofenceRadiusMeters}
                  onChange={(e) => setGeofenceRadiusMeters(Number(e.target.value))}
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Sequence Order Position (Optional)
            </label>
            <input
              type="number"
              min="1"
              placeholder="Leave blank to append at end of sequence"
              value={sequenceOrder}
              onChange={(e) => setSequenceOrder(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-sky-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              If omitted, stop will be placed at the end of the route sequence.
            </p>
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
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isSubmitting ? 'Adding...' : 'Add Stop'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
