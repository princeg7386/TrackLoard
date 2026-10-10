'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Bus,
  MapPin,
  Clock,
  Route as RouteIcon,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Trash2,
  ShieldCheck,
  Check,
} from 'lucide-react';
import {
  AssignStudentTransportPayloadSchema,
  StudentWithDetails,
  RouteWithStopsOption,
} from '@school-bus/shared';
import {
  fetchTransportOptions,
  assignStudentTransport,
} from '../../services/studentApi';

interface AssignTransportModalProps {
  schoolId: string;
  student: StudentWithDetails | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedStudent: StudentWithDetails) => void;
}

export function AssignTransportModal({
  schoolId,
  student,
  isOpen,
  onClose,
  onSuccess,
}: AssignTransportModalProps) {
  const [routes, setRoutes] = useState<RouteWithStopsOption[]>([]);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);

  // Form selections
  const [selectedRouteId, setSelectedRouteId] = useState<string>('');
  const [selectedPickupStopId, setSelectedPickupStopId] = useState<string>('');
  const [selectedDropStopId, setSelectedDropStopId] = useState<string>('');
  const [sameAsPickupForDrop, setSameAsPickupForDrop] = useState<boolean>(true);

  // UI state
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUnassigning, setIsUnassigning] = useState(false);
  const [showUnassignConfirm, setShowUnassignConfirm] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Load transport options (routes and their stops)
  useEffect(() => {
    if (!isOpen || !schoolId) return;

    let isMounted = true;
    setIsLoadingRoutes(true);
    setServerError(null);

    fetchTransportOptions(schoolId)
      .then((data) => {
        if (!isMounted) return;
        setRoutes(data);

        // Pre-fill student's existing transport details
        if (student && student.pickupStopId) {
          // Find route containing this stop
          const matchingRoute = data.find((r) =>
            r.stops.some((s) => s.id === student.pickupStopId)
          );

          if (matchingRoute) {
            setSelectedRouteId(matchingRoute.id);
            setSelectedPickupStopId(student.pickupStopId);
            if (student.dropStopId && student.dropStopId !== student.pickupStopId) {
              setSelectedDropStopId(student.dropStopId);
              setSameAsPickupForDrop(false);
            } else {
              setSelectedDropStopId(student.pickupStopId);
              setSameAsPickupForDrop(true);
            }
          }
        } else {
          // Unassigned defaults
          setSelectedRouteId(data.length > 0 ? data[0].id : '');
          setSelectedPickupStopId('');
          setSelectedDropStopId('');
          setSameAsPickupForDrop(true);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setServerError('Unable to load route and stop options. Please retry.');
      })
      .finally(() => {
        if (isMounted) setIsLoadingRoutes(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, schoolId, student]);

  // Handle route change
  const handleRouteChange = (routeId: string) => {
    setSelectedRouteId(routeId);
    setSelectedPickupStopId('');
    setSelectedDropStopId('');
    setFieldErrors({});
    setServerError(null);
  };

  // Find currently selected route
  const currentRoute = routes.find((r) => r.id === selectedRouteId);
  const stops = currentRoute?.stops || [];

  // Handle Submit (Assign / Update)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!student?.id || !schoolId) return;

    setServerError(null);
    setFieldErrors({});

    if (!selectedPickupStopId) {
      setFieldErrors({ pickupStopId: 'Please select a pickup stop along the route.' });
      return;
    }

    const effectiveDropStopId = sameAsPickupForDrop
      ? selectedPickupStopId
      : selectedDropStopId || null;

    const payload = {
      pickupStopId: selectedPickupStopId,
      dropStopId: effectiveDropStopId,
    };

    const parseResult = AssignStudentTransportPayloadSchema.safeParse(payload);
    if (!parseResult.success) {
      const errMap: Record<string, string> = {};
      parseResult.error.errors.forEach((err) => {
        const path = err.path.join('.');
        errMap[path] = err.message;
      });
      setFieldErrors(errMap);
      return;
    }

    setIsSubmitting(true);
    try {
      const updated = await assignStudentTransport(schoolId, student.id, payload);
      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        onSuccess(updated);
        onClose();
      }, 700);
    } catch (err: any) {
      setServerError(err.message || 'Failed to update transport assignment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Unassign / Opt-out
  const handleUnassign = async () => {
    if (!student?.id || !schoolId) return;

    setServerError(null);
    setIsUnassigning(true);

    try {
      const updated = await assignStudentTransport(schoolId, student.id, {
        pickupStopId: null,
        dropStopId: null,
      });
      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        setShowUnassignConfirm(false);
        onSuccess(updated);
        onClose();
      }, 700);
    } catch (err: any) {
      setServerError(err.message || 'Failed to unassign transport.');
    } finally {
      setIsUnassigning(false);
    }
  };


  if (!isOpen || !student) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-2xs animate-fadeIn">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center font-bold">
              <Bus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 leading-tight">
                Transport & Stop Allocation
              </h2>
              <p className="text-xs text-slate-500">
                {student.fullName} ({student.admissionNumber}) • {student.classGrade}-{student.section}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Server Error Message */}
          {serverError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2.5 text-rose-800 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Assignment Failed</p>
                <p>{serverError}</p>
              </div>
            </div>
          )}

          {/* Success Message */}
          {isSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-800 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Transport allocation updated successfully!</span>
            </div>
          )}

          {/* Current Status Badge Card */}
          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 block">
                Current Transport Status
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold ${
                    student.transportStatus === 'ASSIGNED'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      student.transportStatus === 'ASSIGNED' ? 'bg-emerald-600' : 'bg-slate-500'
                    }`}
                  />
                  {student.transportStatus === 'ASSIGNED' ? 'Assigned' : 'Unassigned / Self Commute'}
                </span>

                {student.assignedBusNumber && (
                  <span className="text-xs font-mono font-semibold text-slate-700 flex items-center gap-1 bg-white px-2 py-0.5 rounded border border-slate-200">
                    <Bus className="w-3 h-3 text-sky-600" />
                    {student.assignedBusNumber}
                  </span>
                )}
              </div>
            </div>

            {student.transportStatus === 'ASSIGNED' && !showUnassignConfirm && (
              <button
                type="button"
                onClick={() => setShowUnassignConfirm(true)}
                className="text-xs text-rose-600 hover:text-rose-700 font-semibold hover:underline"
              >
                Opt-out / Unassign
              </button>
            )}
          </div>

          {/* Unassign Confirmation Alert */}
          {showUnassignConfirm && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-lg space-y-2">
              <div className="flex items-start gap-2 text-rose-800 text-xs">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <p>
                  Are you sure you want to unassign <strong>{student.fullName}</strong> from bus transport?
                  The student will be marked as self-commute and removed from bus attendance manifests.
                </p>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={isUnassigning}
                  onClick={() => setShowUnassignConfirm(false)}
                  className="px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200 rounded"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isUnassigning}
                  onClick={handleUnassign}
                  className="px-2.5 py-1 text-xs bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded flex items-center gap-1 shadow-2xs"
                >
                  {isUnassigning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Confirm Unassign
                </button>
              </div>
            </div>
          )}

          {/* Loading routes state */}
          {isLoadingRoutes ? (
            <div className="py-8 flex flex-col items-center justify-center space-y-2 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-sky-600" />
              <p className="text-xs">Loading available routes and stops...</p>
            </div>
          ) : routes.length === 0 ? (
            /* Empty routes state */
            <div className="p-6 text-center border border-dashed border-slate-200 rounded-lg bg-slate-50/50">
              <RouteIcon className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              <h4 className="text-xs font-bold text-slate-700">No Active Routes Found</h4>
              <p className="text-[11px] text-slate-500 mt-1 max-w-xs mx-auto">
                No routes with linked pickup stops have been created in Route Management. Please configure routes and stops first.
              </p>
            </div>
          ) : (
            /* Form */
            <form id="assignTransportForm" onSubmit={handleSubmit} className="space-y-4">
              {/* Route Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  1. Select Bus Route
                </label>
                <select
                  value={selectedRouteId}
                  onChange={(e) => handleRouteChange(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-sky-500 font-medium text-slate-800"
                >
                  <option value="" disabled>-- Select Route --</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code ? `[${r.code}] ` : ''}{r.name}
                      {r.busNumber ? ` (Bus: ${r.busNumber})` : ' (No bus linked)'}
                    </option>
                  ))}
                </select>
                {currentRoute && (
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-500">
                    <span className="font-semibold text-slate-700">Linked Bus:</span>
                    {currentRoute.busNumber ? (
                      <span className="font-mono text-sky-700 font-semibold bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200">
                        {currentRoute.busNumber} • {currentRoute.busRegistrationNumber}
                      </span>
                    ) : (
                      <span className="text-amber-600 italic">No bus assigned to route</span>
                    )}
                  </div>
                )}
              </div>

              {/* Pickup Stop Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  2. Morning Pickup Stop <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedPickupStopId}
                  onChange={(e) => {
                    setSelectedPickupStopId(e.target.value);
                    if (sameAsPickupForDrop) {
                      setSelectedDropStopId(e.target.value);
                    }
                    if (fieldErrors.pickupStopId) {
                      setFieldErrors((prev) => ({ ...prev, pickupStopId: '' }));
                    }
                  }}
                  disabled={!selectedRouteId || stops.length === 0}
                  className={`w-full text-xs px-3 py-2 bg-white border rounded-lg focus:outline-hidden focus:ring-1 font-medium text-slate-800 ${
                    fieldErrors.pickupStopId
                      ? 'border-rose-400 focus:ring-rose-500'
                      : 'border-slate-300 focus:ring-sky-500'
                  }`}
                >
                  <option value="">-- Choose Pickup Stop --</option>
                  {stops.map((stop) => (
                    <option key={stop.id} value={stop.id}>
                      #{stop.sequenceOrder}: {stop.stopName}
                      {stop.scheduledTime ? ` (${stop.scheduledTime})` : ''}
                    </option>
                  ))}
                </select>
                {fieldErrors.pickupStopId && (
                  <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.pickupStopId}</p>
                )}
              </div>

              {/* Same Stop for Evening Drop Checkbox */}
              <div className="pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sameAsPickupForDrop}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSameAsPickupForDrop(checked);
                      if (checked) {
                        setSelectedDropStopId(selectedPickupStopId);
                      }
                    }}
                    className="rounded border-slate-300 text-sky-600 focus:ring-sky-500 w-4 h-4"
                  />
                  <span>Evening drop-off is at the same stop</span>
                </label>
              </div>

              {/* Drop Stop Selection (if different) */}
              {!sameAsPickupForDrop && (
                <div className="pt-1 animate-fadeIn">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    3. Evening Drop Stop (Optional)
                  </label>
                  <select
                    value={selectedDropStopId}
                    onChange={(e) => setSelectedDropStopId(e.target.value)}
                    disabled={!selectedRouteId || stops.length === 0}
                    className="w-full text-xs px-3 py-2 bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-sky-500 font-medium text-slate-800"
                  >
                    <option value="">-- Same as Pickup Stop / None --</option>
                    {stops.map((stop) => (
                      <option key={stop.id} value={stop.id}>
                        #{stop.sequenceOrder}: {stop.stopName}
                        {stop.scheduledTime ? ` (${stop.scheduledTime})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Stop Timeline / Schedule Preview */}
              {selectedPickupStopId && (
                <div className="p-3 bg-indigo-50/60 rounded-lg border border-indigo-100 flex items-center justify-between text-xs text-indigo-900">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-indigo-600 shrink-0" />
                    <div>
                      <span className="font-semibold block">
                        {stops.find((s) => s.id === selectedPickupStopId)?.stopName}
                      </span>
                      <span className="text-[11px] text-indigo-700/80">
                        Stop #{stops.find((s) => s.id === selectedPickupStopId)?.sequenceOrder} on route
                      </span>
                    </div>
                  </div>
                  {stops.find((s) => s.id === selectedPickupStopId)?.scheduledTime && (
                    <div className="flex items-center gap-1 font-mono font-semibold bg-white px-2 py-1 rounded border border-indigo-200">
                      <Clock className="w-3 h-3 text-indigo-600" />
                      <span>{stops.find((s) => s.id === selectedPickupStopId)?.scheduledTime}</span>
                    </div>
                  )}
                </div>
              )}
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/70 rounded-md transition-colors"
          >
            Cancel
          </button>

          <button
            type="submit"
            form="assignTransportForm"
            disabled={isSubmitting || isLoadingRoutes || routes.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-md shadow-xs transition-colors"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Saving Allocation...
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                Save Transport Allocation
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
