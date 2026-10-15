'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Bell,
  BellOff,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ExternalLink,
  ShieldCheck,
  Send,
  Eye,
  RefreshCw,
  WifiOff,
  User,
  GraduationCap,
  Globe,
  Radio,
  Info,
} from 'lucide-react';
import {
  ParentRecordWithStudent,
  ParentNotificationStatusResponse,
  ParentNotificationHistoryItem,
} from '@school-bus/shared';
import {
  fetchParentNotificationStatus,
  updateParentNotificationPreferences,
  updateNotificationDeliveryStatus,
} from '../../services/studentApi';
import { EmptyState } from '../ui/EmptyState';

interface ParentNotificationStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  parent: ParentRecordWithStudent | null;
  onPreferencesUpdated?: () => void;
}

export function ParentNotificationStatusModal({
  isOpen,
  onClose,
  parent,
  onPreferencesUpdated,
}: ParentNotificationStatusModalProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusData, setStatusData] = useState<ParentNotificationStatusResponse | null>(null);

  // Opt-out management state
  const [isUpdatingPrefs, setIsUpdatingPrefs] = useState(false);
  const [prefError, setPrefError] = useState<string | null>(null);
  const [optOutReasonInput, setOptOutReasonInput] = useState('');
  const [showReasonInput, setShowReasonInput] = useState(false);

  // Delivery status testing
  const [updatingNotifId, setUpdatingNotifId] = useState<string | null>(null);

  // Offline detection
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOffline(true);
    }
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loadNotificationStatus = useCallback(async () => {
    if (!parent) return;
    setIsLoading(true);
    setError(null);

    try {
      const data = await fetchParentNotificationStatus(parent.schoolId, parent.id);
      setStatusData(data);
      setShowReasonInput(!data.parent.notificationsEnabled);
      setOptOutReasonInput(data.parent.optOutReason || '');
    } catch (err: any) {
      if (err.message === 'UNAUTHORIZED') {
        setError('UNAUTHORIZED');
      } else {
        setError(err.message || 'Failed to load parent notification status');
      }
    } finally {
      setIsLoading(false);
    }
  }, [parent]);

  useEffect(() => {
    if (isOpen && parent) {
      loadNotificationStatus();
    }
  }, [isOpen, parent, loadNotificationStatus]);

  if (!isOpen || !parent) return null;

  const handleTogglePreferences = async (newEnabled: boolean) => {
    if (!statusData) return;
    setIsUpdatingPrefs(true);
    setPrefError(null);

    try {
      const res = await updateParentNotificationPreferences(
        parent.schoolId,
        parent.id,
        {
          notificationsEnabled: newEnabled,
          optOutReason: newEnabled ? undefined : (optOutReasonInput.trim() || 'Parent requested pause on transport alerts'),
        }
      );

      setStatusData((prev) =>
        prev
          ? {
              ...prev,
              parent: {
                ...prev.parent,
                notificationsEnabled: res.notificationsEnabled,
                optedOutAt: res.optedOutAt,
                optOutReason: res.optOutReason,
              },
            }
          : null
      );

      setShowReasonInput(!newEnabled);
      if (onPreferencesUpdated) {
        onPreferencesUpdated();
      }
    } catch (err: any) {
      setPrefError(err.message || 'Failed to update notification preferences');
    } finally {
      setIsUpdatingPrefs(false);
    }
  };

  const handleSimulateStatus = async (
    notificationId: string,
    targetStatus: 'DELIVERED' | 'READ' | 'FAILED'
  ) => {
    setUpdatingNotifId(notificationId);
    try {
      const updated = await updateNotificationDeliveryStatus(
        parent.schoolId,
        notificationId,
        {
          status: targetStatus,
          failureReason: targetStatus === 'FAILED' ? 'Simulated delivery failure (mock)' : undefined,
        }
      );

      setStatusData((prev) => {
        if (!prev) return null;
        const newNotifications = prev.recentNotifications.map((n) =>
          n.id === notificationId ? updated : n
        );
        return {
          ...prev,
          recentNotifications: newNotifications,
        };
      });
    } catch (err: any) {
      setPrefError(err.message || 'Failed to update delivery status');
    } finally {
      setUpdatingNotifId(null);
    }
  };

  const getStatusPill = (status: string) => {
    switch (status) {
      case 'READ':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <Eye className="w-3 h-3 text-emerald-600" />
            Read
          </span>
        );
      case 'DELIVERED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-100 text-sky-800 border border-sky-200">
            <CheckCircle2 className="w-3 h-3 text-sky-600" />
            Delivered
          </span>
        );
      case 'SENT':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <Send className="w-3 h-3 text-slate-500" />
            Sent
          </span>
        );
      case 'FAILED':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-800 border border-rose-200">
            <AlertTriangle className="w-3 h-3 text-rose-600" />
            Failed
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sky-50 text-sky-700 border border-sky-200 flex items-center justify-center shrink-0">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                Parent Notification Health & Link Activity
              </h2>
              <p className="text-xs text-slate-500">
                {parent.fullName} ({parent.phone || 'No phone'}) â€¢ Linked to {parent.student.fullName} ({parent.student.admissionNumber})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          {/* 1. Offline Alert */}
          {isOffline && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-amber-900">
              <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
              <span>You are currently offline. Changes will not be saved until reconnection.</span>
            </div>
          )}

          {/* 2. Loading State */}
          {isLoading && (
            <div className="space-y-4 py-8">
              <div className="grid grid-cols-4 gap-3 animate-pulse">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-16 bg-slate-100 rounded-lg" />
                ))}
              </div>
              <div className="h-28 bg-slate-100 rounded-lg animate-pulse" />
              <div className="h-40 bg-slate-100 rounded-lg animate-pulse" />
            </div>
          )}

          {/* 3. Error / Failure State */}
          {!isLoading && error && (
            <div className="p-6 bg-rose-50 border border-rose-200 rounded-xl text-center space-y-3">
              <AlertTriangle className="w-8 h-8 text-rose-600 mx-auto" />
              <div className="font-semibold text-rose-900 text-sm">
                {error === 'UNAUTHORIZED'
                  ? 'Access Denied: You do not have permission to view notification logs for this school.'
                  : error}
              </div>
              <button
                type="button"
                onClick={loadNotificationStatus}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold transition-colors shadow-2xs"
              >
                Retry Loading
              </button>
            </div>
          )}

          {/* 4. Success / Data Loaded State */}
          {!isLoading && !error && statusData && (
            <>
              {/* Delivery Stats KPI Banner */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
                    Total Dispatches
                  </div>
                  <div className="text-base font-bold text-slate-900 mt-1 font-mono">
                    {statusData.deliverySummary.totalDispatches}
                  </div>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
                    Sent
                  </div>
                  <div className="text-base font-bold text-slate-700 mt-1 font-mono">
                    {statusData.deliverySummary.sentCount}
                  </div>
                </div>

                <div className="p-3 bg-sky-50 border border-sky-200 rounded-lg">
                  <div className="text-[10px] text-sky-700 font-medium uppercase tracking-wider">
                    Delivered
                  </div>
                  <div className="text-base font-bold text-sky-900 mt-1 font-mono">
                    {statusData.deliverySummary.deliveredCount}
                  </div>
                </div>

                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <div className="text-[10px] text-emerald-700 font-medium uppercase tracking-wider">
                    Read Receipts
                  </div>
                  <div className="text-base font-bold text-emerald-900 mt-1 font-mono">
                    {statusData.deliverySummary.readCount}
                  </div>
                </div>

                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg col-span-2 sm:col-span-1">
                  <div className="text-[10px] text-emerald-700 font-medium uppercase tracking-wider">
                    Delivery Health
                  </div>
                  <div className="text-base font-bold text-emerald-900 mt-1 font-mono">
                    {statusData.deliverySummary.deliverySuccessRatePercent}%
                  </div>
                </div>
              </div>

              {/* Notification Preferences & Opt-out Card */}
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="font-semibold text-slate-900 flex items-center gap-2">
                      {statusData.parent.notificationsEnabled ? (
                        <Bell className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <BellOff className="w-4 h-4 text-amber-600" />
                      )}
                      <span>WhatsApp Transport Notifications</span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {statusData.parent.notificationsEnabled
                        ? 'Parent is subscribed to trip start alerts, live location tokens, and delays.'
                        : `Notifications paused on ${statusData.parent.optedOutAt ? new Date(statusData.parent.optedOutAt).toLocaleDateString() : 'recent date'}.`}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={isUpdatingPrefs || isOffline}
                    onClick={() => handleTogglePreferences(!statusData.parent.notificationsEnabled)}
                    className={`px-3 py-1.5 rounded-lg font-semibold text-xs transition-colors shadow-2xs ${
                      statusData.parent.notificationsEnabled
                        ? 'bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    } disabled:opacity-50`}
                  >
                    {isUpdatingPrefs
                      ? 'Saving...'
                      : statusData.parent.notificationsEnabled
                        ? 'Pause Notifications'
                        : 'Resume Notifications'}
                  </button>
                </div>

                {/* Opt-out reason display / input */}
                {!statusData.parent.notificationsEnabled && (
                  <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg space-y-2 text-xs">
                    <div className="font-semibold text-amber-900 flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5 text-amber-600" />
                      <span>Opt-out Reason / Note</span>
                    </div>
                    <div className="text-[11px] text-amber-800 font-mono">
                      {statusData.parent.optOutReason || 'Parent opted out of transport notices'}
                    </div>
                  </div>
                )}

                {prefError && (
                  <div className="p-2 bg-rose-50 border border-rose-200 rounded text-rose-700 text-[11px]">
                    {prefError}
                  </div>
                )}
              </div>

              {/* Live Link Access Activity Card */}
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <Globe className="w-4 h-4 text-sky-600" />
                    <span>Live Tracking Web Activity</span>
                  </div>
                  <span className="text-[11px] text-slate-500 font-mono">
                    Total Visits: <strong className="text-slate-800">{statusData.linkActivity.totalAccessCount}</strong>
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="text-slate-400 text-[10px]">Tokens Issued</div>
                    <div className="font-mono font-semibold text-slate-800 mt-0.5">
                      {statusData.linkActivity.totalTokensIssued} total ({statusData.linkActivity.activeTokenCount} active)
                    </div>
                  </div>
                  <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="text-slate-400 text-[10px]">Total Hits</div>
                    <div className="font-mono font-semibold text-slate-800 mt-0.5">
                      {statusData.linkActivity.totalAccessCount} web sessions
                    </div>
                  </div>
                  <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="text-slate-400 text-[10px]">Last Accessed</div>
                    <div className="font-mono font-semibold text-slate-800 mt-0.5">
                      {statusData.linkActivity.lastAccessedAt
                        ? new Date(statusData.linkActivity.lastAccessedAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            month: 'short',
                            day: 'numeric',
                          })
                        : 'Never'}
                    </div>
                  </div>
                </div>

                {/* Recent Access Logs */}
                {statusData.linkActivity.recentAccesses.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Recent Visits Log
                    </div>
                    <div className="space-y-1">
                      {statusData.linkActivity.recentAccesses.map((acc) => (
                        <div
                          key={acc.id}
                          className="flex items-center justify-between p-2 bg-slate-50 rounded border border-slate-200 text-[11px] font-mono text-slate-600"
                        >
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-3 h-3 text-slate-400" />
                            {new Date(acc.accessedAt).toLocaleString()}
                          </span>
                          <span className="text-slate-400">
                            {acc.ipAddress || 'Direct Web Session'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Notification Dispatch History Table */}
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-slate-900">
                    Recent WhatsApp Dispatches ({statusData.recentNotifications.length})
                  </div>
                  <button
                    type="button"
                    onClick={loadNotificationStatus}
                    className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
                    title="Refresh logs"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>

                {statusData.recentNotifications.length === 0 ? (
                  <div className="py-6 text-center text-slate-400 italic">
                    No outbound notifications dispatched to this parent yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 uppercase tracking-wider text-[10px]">
                          <th className="py-2 px-2.5 font-semibold">Timestamp</th>
                          <th className="py-2 px-2.5 font-semibold">Template</th>
                          <th className="py-2 px-2.5 font-semibold">Message Preview</th>
                          <th className="py-2 px-2.5 font-semibold">Status</th>
                          <th className="py-2 px-2.5 font-semibold text-right">Receipt Tester</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                        {statusData.recentNotifications.map((n) => (
                          <tr key={n.id} className="hover:bg-slate-50 transition-colors">
                            <td className="py-2.5 px-2.5 text-slate-500 whitespace-nowrap">
                              {new Date(n.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}{' '}
                              {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="py-2.5 px-2.5 font-sans font-medium text-slate-800">
                              {n.templateName || 'MANUAL'}
                            </td>
                            <td className="py-2.5 px-2.5 font-sans text-slate-600 max-w-[220px] truncate" title={n.messageBody}>
                              {n.messageBody}
                            </td>
                            <td className="py-2.5 px-2.5 whitespace-nowrap">
                              {getStatusPill(n.status)}
                            </td>
                            <td className="py-2.5 px-2.5 text-right whitespace-nowrap font-sans">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={updatingNotifId === n.id}
                                  onClick={() => handleSimulateStatus(n.id, 'DELIVERED')}
                                  className="px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 rounded border border-sky-200 transition-colors disabled:opacity-50"
                                >
                                  Delivered
                                </button>
                                <button
                                  type="button"
                                  disabled={updatingNotifId === n.id}
                                  onClick={() => handleSimulateStatus(n.id, 'READ')}
                                  className="px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200 transition-colors disabled:opacity-50"
                                >
                                  Read
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg shadow-2xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

