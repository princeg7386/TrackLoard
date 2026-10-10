'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  History,
  Bus,
  MapPin,
  Clock,
  Calendar,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import {
  StudentWithDetails,
  StudentTransportHistoryResponse,
  StudentTransportHistoryItem,
} from '@school-bus/shared';
import { fetchStudentTransportHistory } from '../../services/studentApi';

interface StudentTransportHistoryModalProps {
  schoolId: string;
  student: StudentWithDetails | null;
  isOpen: boolean;
  onClose: () => void;
}

export function StudentTransportHistoryModal({
  schoolId,
  student,
  isOpen,
  onClose,
}: StudentTransportHistoryModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [historyData, setHistoryData] = useState<StudentTransportHistoryResponse | null>(null);

  const loadHistory = useCallback(async () => {
    if (!student?.id || !schoolId) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await fetchStudentTransportHistory(schoolId, student.id, 50);
      setHistoryData(data);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load transport history records.');
    } finally {
      setIsLoading(false);
    }
  }, [schoolId, student?.id]);

  useEffect(() => {
    if (isOpen && student?.id) {
      loadHistory();
    } else {
      setHistoryData(null);
      setErrorMessage(null);
    }
  }, [isOpen, student?.id, loadHistory]);

  if (!isOpen || !student) return null;

  const summary = historyData?.summary || { totalBoarded: 0, totalAbsent: 0, totalDeboarded: 0, lastRodeAt: null };
  const records = historyData?.history || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-2xs animate-fadeIn">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center font-bold">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 leading-tight">Transport & Attendance History</h2>
              <p className="text-xs text-slate-500">
                {student.fullName} ({student.admissionNumber}) • {student.classGrade}-{student.section}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadHistory}
              title="Refresh logs"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Summary Stat Chips */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg text-center">
              <span className="text-[10px] uppercase font-bold text-emerald-700 tracking-wider">Boarded</span>
              <p className="text-xl font-bold font-mono text-emerald-900 mt-0.5">{summary.totalBoarded}</p>
            </div>

            <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-lg text-center">
              <span className="text-[10px] uppercase font-bold text-indigo-700 tracking-wider">Deboarded</span>
              <p className="text-xl font-bold font-mono text-indigo-900 mt-0.5">{summary.totalDeboarded}</p>
            </div>

            <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-center">
              <span className="text-[10px] uppercase font-bold text-amber-700 tracking-wider">Marked Absent</span>
              <p className="text-xl font-bold font-mono text-amber-900 mt-0.5">{summary.totalAbsent}</p>
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center justify-between text-rose-800 text-xs">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={loadHistory}
                className="px-2 py-1 bg-rose-600 text-white rounded font-semibold text-[11px]"
              >
                Retry
              </button>
            </div>
          )}

          {/* Loading State */}
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-2 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-sky-600" />
              <p className="text-xs">Loading boarding and drop-off history...</p>
            </div>
          ) : records.length === 0 ? (
            /* Empty State */
            <div className="py-10 text-center border border-dashed border-slate-200 rounded-lg bg-slate-50/50">
              <History className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              <h4 className="text-xs font-bold text-slate-700">No Transport Records Found</h4>
              <p className="text-[11px] text-slate-500 mt-1 max-w-xs mx-auto">
                No boarding or drop-off attendance records have been registered for this student yet. Records appear when drivers mark pickup and drops on trips.
              </p>
            </div>
          ) : (
            /* Timeline List */
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                Recent Boarding & Drop Events ({records.length})
              </h4>

              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden bg-white">
                {records.map((rec) => {
                  const isBoarded = rec.eventType === 'BOARDED';
                  const isDeboarded = rec.eventType === 'DEBOARDED';
                  const isAbsent = rec.eventType === 'ABSENT';

                  const badgeClass = isBoarded
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : isDeboarded
                    ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200';

                  const formattedTime = rec.recordedAt
                    ? new Date(rec.recordedAt).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '--:--';

                  const formattedDate = rec.recordedAt
                    ? new Date(rec.recordedAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })
                    : rec.scheduledDate || 'Recent';

                  return (
                    <div key={rec.id} className="p-3.5 hover:bg-slate-50/80 transition-colors flex items-center justify-between gap-3 text-xs">
                      {/* Left: Event badge & location */}
                      <div className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 px-2 py-0.5 rounded text-[11px] font-bold border shrink-0 ${badgeClass}`}
                        >
                          {rec.eventType}
                        </div>

                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>{rec.stopName}</span>
                            {rec.stopSequence && (
                              <span className="text-[10px] text-slate-400 font-mono">
                                (Stop #{rec.stopSequence})
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 text-[11px] text-slate-500 flex-wrap">
                            {rec.busNumber && (
                              <span className="font-mono text-sky-700 font-semibold bg-sky-50 px-1 rounded border border-sky-200">
                                Bus {rec.busNumber}
                              </span>
                            )}
                            {rec.routeName && (
                              <span>Route: {rec.routeCode || rec.routeName}</span>
                            )}
                            <span className="text-slate-400">• Marked by {rec.markedBy.toLowerCase()}</span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Timestamp */}
                      <div className="text-right shrink-0">
                        <div className="flex items-center justify-end gap-1 font-mono font-semibold text-slate-700">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span>{formattedTime}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 block">{formattedDate}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-300 rounded-md shadow-2xs hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
