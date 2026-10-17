'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  History,
  Clock,
  User,
  ArrowRight,
  AlertCircle,
  RefreshCw,
  GitCommit,
  CheckCircle2,
  Calendar,
} from 'lucide-react';
import { type RouteHistoryItem, type RouteHistoryResponse } from '@school-bus/shared';
import { RouteApiService } from '../../services/routeApi';

interface RouteHistoryModalProps {
  schoolId: string;
  routeId: string;
  routeName: string;
  routeCode: string;
  isOpen: boolean;
  onClose: () => void;
}

export function RouteHistoryModal({
  schoolId,
  routeId,
  routeName,
  routeCode,
  isOpen,
  onClose,
}: RouteHistoryModalProps) {
  const [historyData, setHistoryData] = useState<RouteHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDiffId, setExpandedDiffId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!schoolId || !routeId) return;
    try {
      setIsLoading(true);
      setError(null);
      const res = await RouteApiService.getRouteHistory(schoolId, routeId);
      setHistoryData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load route history.');
    } finally {
      setIsLoading(false);
    }
  }, [schoolId, routeId]);

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
      setExpandedDiffId(null);
    }
  }, [isOpen, fetchHistory]);

  if (!isOpen) return null;

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'ROUTE_CREATED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            Route Created
          </span>
        );
      case 'ROUTE_UPDATED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200">
            Specifications Updated
          </span>
        );
      case 'ROUTE_STOP_ADDED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
            Stop Added
          </span>
        );
      case 'ROUTE_STOPS_REORDERED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            Stops Reordered
          </span>
        );
      case 'ROUTE_STOP_UPDATED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            Stop Updated
          </span>
        );
      case 'ROUTE_STOP_REMOVED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            Stop Removed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            {action}
          </span>
        );
    }
  };

  const formatTimestamp = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
      <div className="relative w-full max-w-2xl bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-sky-50 text-sky-600 border border-sky-100">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">Route Change History</h3>
                <span className="font-mono text-xs font-semibold px-2 py-0.5 bg-slate-100 text-slate-700 rounded border border-slate-200">
                  {routeCode}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{routeName}</p>
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

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {isLoading ? (
            <div className="py-16 text-center space-y-3">
              <RefreshCw className="w-6 h-6 animate-spin text-sky-600 mx-auto" />
              <p className="text-xs text-slate-500 font-medium">Loading audit history...</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start justify-between gap-3 text-xs text-rose-700">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={fetchHistory}
                className="font-semibold underline hover:text-rose-900"
              >
                Retry
              </button>
            </div>
          ) : !historyData || historyData.history.length === 0 ? (
            <div className="py-16 text-center space-y-2">
              <GitCommit className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs font-medium text-slate-700">No History Recorded Yet</p>
              <p className="text-xs text-slate-400 max-w-xs mx-auto">
                Modifications to this route specifications and pickup sequence will appear here.
              </p>
            </div>
          ) : (
            <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
              {historyData.history.map((item: RouteHistoryItem) => {
                const isExpanded = expandedDiffId === item.id;
                const hasDiff = item.previousState || item.newState;

                return (
                  <div key={item.id} className="relative group">
                    {/* Timeline bullet */}
                    <div className="absolute -left-6 top-1.5 w-5 h-5 rounded-full bg-white border-2 border-sky-500 flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                    </div>

                    {/* Change Card */}
                    <div className="bg-slate-50/80 hover:bg-slate-50 border border-slate-200 rounded-xl p-3.5 transition-colors space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          {getActionBadge(item.action)}
                          <span className="text-xs font-medium text-slate-900">
                            {item.changeSummary}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTimestamp(item.createdAt)}
                        </span>
                      </div>

                      {/* Actor details */}
                      <div className="flex items-center gap-2 text-[11px] text-slate-500">
                        <User className="w-3 h-3 text-slate-400" />
                        <span>
                          {item.userName || item.userRole.replace('_', ' ')}
                        </span>
                      </div>

                      {/* Previous State vs New State Inspector */}
                      {hasDiff && (
                        <div className="pt-2 border-t border-slate-200/70">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedDiffId(isExpanded ? null : item.id)
                            }
                            className="text-[11px] font-semibold text-sky-600 hover:text-sky-700 inline-flex items-center gap-1"
                          >
                            <span>{isExpanded ? 'Hide Details' : 'View Changes (State Diff)'}</span>
                            <ArrowRight
                              className={`w-3 h-3 transition-transform ${
                                isExpanded ? 'rotate-90' : ''
                              }`}
                            />
                          </button>

                          {isExpanded && (
                            <div className="mt-2.5 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                              {/* Previous State */}
                              <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                                  Previous State
                                </span>
                                {item.previousState ? (
                                  <pre className="text-[11px] text-slate-700 bg-slate-50 p-2 rounded border border-slate-100 overflow-x-auto whitespace-pre-wrap font-mono">
                                    {JSON.stringify(item.previousState, null, 2)}
                                  </pre>
                                ) : (
                                  <span className="text-slate-400 italic text-[11px]">
                                    None (Initial Creation)
                                  </span>
                                )}
                              </div>

                              {/* New State */}
                              <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                                <span className="text-[10px] font-bold text-sky-600 uppercase tracking-wider block mb-1">
                                  New State
                                </span>
                                {item.newState ? (
                                  <pre className="text-[11px] text-slate-800 bg-sky-50/50 p-2 rounded border border-sky-100 overflow-x-auto whitespace-pre-wrap font-mono">
                                    {JSON.stringify(item.newState, null, 2)}
                                  </pre>
                                ) : (
                                  <span className="text-slate-400 italic text-[11px]">
                                    Removed (Soft Deleted)
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between text-xs text-slate-500">
          <span>
            Total recorded changes: <strong>{historyData?.totalChanges ?? 0}</strong>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg shadow-2xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
