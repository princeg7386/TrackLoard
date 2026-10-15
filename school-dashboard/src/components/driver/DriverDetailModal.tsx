'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  User,
  Phone,
  FileBadge,
  Calendar,
  Bus,
  MapPin,
  KeyRound,
  LogOut,
  Edit2,
  Trash2,
  History,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Loader2,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { DriverWithBus } from '@school-bus/shared';
import { fetchDriverDetail, revokeDriverSessions, deleteDriver } from '../../services/driverApi';

interface DriverDetailModalProps {
  schoolId: string;
  driverId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (driver: DriverWithBus) => void;
  onManageAssignment: (driver: DriverWithBus) => void;
  onResetPin: (driver: DriverWithBus) => void;
  onViewHistory: (driver: DriverWithBus) => void;
  onDriverDeleted: (driverId: string) => void;
}

export function DriverDetailModal({
  schoolId,
  driverId,
  isOpen,
  onClose,
  onEdit,
  onManageAssignment,
  onResetPin,
  onViewHistory,
  onDriverDeleted,
}: DriverDetailModalProps) {
  const [driver, setDriver] = useState<DriverWithBus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const loadDriver = useCallback(async () => {
    if (!driverId) return;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await fetchDriverDetail(schoolId, driverId);
      setDriver(data);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load driver profile details.');
    } finally {
      setIsLoading(false);
    }
  }, [schoolId, driverId]);

  useEffect(() => {
    if (isOpen && driverId) {
      loadDriver();
      setActionFeedback(null);
      setShowDeleteConfirm(false);
    } else {
      setDriver(null);
      setErrorMessage(null);
      setActionFeedback(null);
      setShowDeleteConfirm(false);
    }
  }, [isOpen, driverId, loadDriver]);

  if (!isOpen || !driverId) return null;

  const handleRevokeSessions = async () => {
    if (!driver || !driver.id) return;
    setIsRevoking(true);
    setActionFeedback(null);
    setErrorMessage(null);

    try {
      await revokeDriverSessions(schoolId, driver.id);
      setActionFeedback('All active mobile app sessions for this driver have been revoked.');
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to revoke driver sessions.');
    } finally {
      setIsRevoking(false);
    }
  };

  const handleDelete = async () => {
    if (!driver || !driver.id) return;
    setIsDeleting(true);
    setErrorMessage(null);

    try {
      await deleteDriver(schoolId, driver.id);
      onDriverDeleted(driver.id);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to delete driver profile.');
      setIsDeleting(false);
    }
  };

  const formatDateIST = (dateStr?: string | null) => {
    if (!dateStr) return 'N/A';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      });
    } catch {
      return dateStr;
    }
  };

  const formatTimeIST = (dateStr?: string | null) => {
    if (!dateStr) return 'Never';
    try {
      const d = new Date(dateStr);
      return d.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center text-white shrink-0">
              <User className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">Driver Profile & Credentials</h3>
              <p className="text-[11px] text-slate-300">
                Authorized transport driver record, vehicle pairing & security controls
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadDriver}
              disabled={isLoading}
              title="Refresh Profile"
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
          {/* Feedback & Error Alerts */}
          {actionFeedback && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-900 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{actionFeedback}</span>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-rose-900 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold block">Error</strong>
                <span>{errorMessage}</span>
              </div>
            </div>
          )}

          {/* Loading Skeleton */}
          {isLoading && !driver && (
            <div className="space-y-4 py-4 animate-pulse">
              <div className="h-16 bg-slate-100 rounded-lg w-full" />
              <div className="h-24 bg-slate-100 rounded-lg w-full" />
              <div className="h-20 bg-slate-100 rounded-lg w-full" />
            </div>
          )}

          {driver && (
            <>
              {/* Profile Card */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col sm:flex-row items-center sm:items-start gap-4">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-slate-200 border-2 border-slate-300 flex items-center justify-center shrink-0 shadow-xs">
                  {driver.photoUrl ? (
                    <img
                      src={driver.photoUrl}
                      alt={driver.fullName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-8 h-8 text-slate-400" />
                  )}
                </div>

                <div className="flex-1 text-center sm:text-left space-y-1">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-slate-900">{driver.fullName}</h4>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 self-center sm:self-auto">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                      Active Driver
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs text-slate-600">
                    <div className="flex items-center gap-1.5 font-mono">
                      <Phone className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{driver.phone}</span>
                    </div>

                    <div className="flex items-center gap-1.5 font-mono">
                      <FileBadge className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>{driver.licenseNumber}</span>
                    </div>
                  </div>

                  {driver.licenseExpiry && (
                    <p className="text-[11px] text-slate-500 font-mono pt-0.5">
                      License Expiry: <span className="font-semibold text-slate-700">{driver.licenseExpiry}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Vehicle & Route Assignment Box */}
              <div className="p-4 bg-white border border-slate-200 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Fleet Vehicle & Default Route
                  </span>
                  <button
                    type="button"
                    onClick={() => onManageAssignment(driver)}
                    className="text-xs font-semibold text-sky-600 hover:text-sky-700 hover:underline"
                  >
                    Change Vehicle
                  </button>
                </div>

                {driver.assignedBusId ? (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-sky-50/70 border border-sky-200 rounded-md">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-300 text-xs font-bold font-mono">
                          <Bus className="w-3.5 h-3.5 text-sky-700" />
                          {driver.assignedBusNumber}
                        </span>
                        <span className="text-xs font-mono text-slate-600">
                          ({driver.assignedRegistrationNumber})
                        </span>
                      </div>
                      {driver.assignedRouteName ? (
                        <div className="flex items-center gap-1.5 text-xs text-slate-700">
                          <MapPin className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          <span className="font-semibold">{driver.assignedRouteName}</span>
                          <span className="font-mono text-[10px] text-slate-500 bg-white px-1.5 py-0.2 border border-slate-200 rounded">
                            {driver.assignedRouteCode}
                          </span>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500 italic">No default route linked to this bus.</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-500 flex items-center justify-between">
                    <span>No fleet vehicle currently paired (Standby / Spare driver).</span>
                    <button
                      type="button"
                      onClick={() => onManageAssignment(driver)}
                      className="px-2.5 py-1 text-xs font-semibold bg-sky-600 text-white rounded hover:bg-sky-700 transition-colors"
                    >
                      Pair Bus
                    </button>
                  </div>
                )}
              </div>

              {/* App Credentials & Security Section */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
                  Driver App & Security Controls
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-white border border-slate-200 rounded-md space-y-1">
                    <span className="text-[11px] text-slate-500 block">App Login PIN</span>
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-slate-800">â€¢â€¢â€¢â€¢â€¢â€¢ (Configured)</span>
                      <button
                        type="button"
                        onClick={() => onResetPin(driver)}
                        className="text-[11px] font-semibold text-sky-600 hover:text-sky-700 hover:underline"
                      >
                        Reset PIN
                      </button>
                    </div>
                  </div>

                  <div className="p-3 bg-white border border-slate-200 rounded-md space-y-1">
                    <span className="text-[11px] text-slate-500 block">Active App Sessions</span>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-700">Mobile Session</span>
                      <button
                        type="button"
                        onClick={handleRevokeSessions}
                        disabled={isRevoking}
                        className="text-[11px] font-semibold text-amber-700 hover:text-amber-800 hover:underline flex items-center gap-1"
                      >
                        {isRevoking && <Loader2 className="w-3 h-3 animate-spin" />}
                        Force Logout
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 font-mono">
                  <span>Registered: {formatDateIST(driver.createdAt)}</span>
                  <span>Last Active: {formatTimeIST(driver.lastActiveAt)}</span>
                </div>
              </div>

              {/* Delete Confirmation Warning */}
              {showDeleteConfirm ? (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg space-y-3 animate-in fade-in">
                  <div className="flex items-start gap-2 text-rose-900 text-xs">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-bold block">Are you sure you want to remove this driver?</strong>
                      <span>
                        This action will soft-delete the driver profile and unbind them from any paired fleet vehicle.
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={isDeleting}
                      className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={isDeleting}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded shadow-2xs"
                    >
                      {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      Confirm Remove
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}

          {/* Modal Footer Actions */}
          {driver && (
            <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onViewHistory(driver)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-md text-xs font-semibold transition-colors"
                >
                  <History className="w-3.5 h-3.5 text-slate-600" />
                  View History Logs
                </button>

                {!showDeleteConfirm && (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-md text-xs font-semibold transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove Driver
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-md text-xs font-semibold transition-colors"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(driver)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-md text-xs font-semibold shadow-xs transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  Edit Profile
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

