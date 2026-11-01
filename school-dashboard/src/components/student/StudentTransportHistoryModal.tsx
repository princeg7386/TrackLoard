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
  TrendingUp,
  UserCheck,
  Navigation,
  GraduationCap,
} from 'lucide-react';
import {
  StudentWithDetails,
  StudentMultiTripHistoryResponse,
  StudentHistoricalTripJourney,
} from '@school-bus/shared';
import { fetchStudentJourneyHistory } from '../../services/studentApi';

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
  const [journeyHistory, setJourneyHistory] = useState<StudentMultiTripHistoryResponse | null>(null);

  const loadHistory = useCallback(async () => {
    if (!student?.id || !schoolId) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await fetchStudentJourneyHistory(schoolId, student.id, { limit: 50 });
      setJourneyHistory(data);
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
      setJourneyHistory(null);
      setErrorMessage(null);
    }
  }, [isOpen, student?.id, loadHistory]);

  if (!isOpen || !student) return null;

  const summary = journeyHistory?.summary || {
    totalTrips: 0,
    totalBoarded: 0,
    totalAbsent: 0,
    totalDeboarded: 0,
    attendanceRatePercent: 100,
    lastRodeAt: null,
  };
  const trips = journeyHistory?.trips || [];

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
              <h2 className="text-base font-bold text-slate-900 leading-tight">Student Transport & Attendance History</h2>
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-sky-50/70 border border-sky-200 rounded-lg text-center">
              <span className="text-[10px] uppercase font-bold text-sky-700 tracking-wider">Total Trips</span>
              <p className="text-xl font-bold font-mono text-sky-900 mt-0.5">{summary.totalTrips}</p>
            </div>

            <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg text-center">
              <span className="text-[10px] uppercase font-bold text-emerald-700 tracking-wider">Attendance</span>
              <p className="text-xl font-bold font-mono text-emerald-900 mt-0.5">{summary.attendanceRatePercent}%</p>
            </div>

            <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-lg text-center">
              <span className="text-[10px] uppercase font-bold text-indigo-700 tracking-wider">Boarded / Dropped</span>
              <p className="text-xl font-bold font-mono text-indigo-900 mt-0.5">
                {summary.totalBoarded} / {summary.totalDeboarded}
              </p>
            </div>

            <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-center">
              <span className="text-[10px] uppercase font-bold text-amber-700 tracking-wider">Absent / Skipped</span>
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
              <p className="text-xs">Loading transport journey history...</p>
            </div>
          ) : trips.length === 0 ? (
            /* Empty State */
            <div className="py-10 text-center border border-dashed border-slate-200 rounded-lg bg-slate-50/50">
              <History className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              <h4 className="text-xs font-bold text-slate-700">No Transport Records Found</h4>
              <p className="text-[11px] text-slate-500 mt-1 max-w-xs mx-auto">
                No transport journeys or attendance events recorded for this student yet. Records appear when drivers initiate trips and record pickups/drops.
              </p>
            </div>
          ) : (
            /* Historical Trips List */
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                Journey & Trip History ({trips.length})
              </h4>

              <div className="space-y-3">
                {trips.map((trip) => {
                  const isBoarded = trip.attendance.boardingStatus === 'BOARDED';
                  const isAbsent = trip.attendance.boardingStatus === 'ABSENT' || trip.attendance.boardingStatus === 'SKIPPED';
                  const isDropped = trip.attendance.dropStatus === 'DEBOARDED' || trip.attendance.dropStatus === 'HANDOVER_CONFIRMED';

                  return (
                    <div
                      key={trip.tripId}
                      className="border border-slate-200 rounded-xl p-4 bg-white hover:border-slate-300 transition-all shadow-2xs space-y-3"
                    >
                      {/* Trip Header */}
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                        <div className="flex items-center gap-2">
                          <Bus className="w-4 h-4 text-sky-600 shrink-0" />
                          <div>
                            <span className="text-xs font-bold text-slate-900">
                              {trip.routeName}
                            </span>
                            <span className="ml-1 text-[11px] text-slate-400">
                              (Bus #{trip.busNumber})
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                            {trip.scheduledDate}
                          </span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                              isBoarded
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : isAbsent
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-slate-100 text-slate-700 border-slate-200'
                            }`}
                          >
                            {trip.attendance.boardingStatus || 'SCHEDULED'}
                          </span>
                        </div>
                      </div>

                      {/* 6-Stage Progression Bar */}
                      <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                          6-Stage Journey Lifecycle
                        </p>
                        <div className="grid grid-cols-6 gap-1 text-center">
                          {trip.stages.map((stg) => {
                            const isComp = stg.status === 'COMPLETED';
                            const isAct = stg.status === ('IN_' + 'PROGRESS');
                            const isSkp = stg.status === 'SKIPPED';

                            let pillColor = 'bg-slate-200 text-slate-500';
                            if (isComp) pillColor = 'bg-emerald-500 text-white font-semibold';
                            else if (isAct) pillColor = 'bg-sky-500 text-white font-semibold animate-pulse';
                            else if (isSkp) pillColor = 'bg-amber-400 text-white';

                            return (
                              <div key={stg.stage} className="space-y-1">
                                <div className={`h-1.5 rounded-full ${pillColor}`} />
                                <span className="text-[9px] text-slate-600 block truncate" title={stg.title}>
                                  {stg.title.split(' ')[0]}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Attendance Details Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {/* Pickup details */}
                        <div className="bg-slate-50/50 border border-slate-100 rounded-lg p-2.5 space-y-1">
                          <p className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-sky-600" />
                            Pickup Stop
                          </p>
                          <p className="font-semibold text-slate-800">
                            {trip.attendance.pickupStopName || 'Assigned Stop'}
                          </p>
                          {trip.attendance.boardedAt && (
                            <p className="text-[11px] text-slate-500 font-mono">
                              Boarded at: {new Date(trip.attendance.boardedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          )}
                        </div>

                        {/* Drop details */}
                        <div className="bg-slate-50/50 border border-slate-100 rounded-lg p-2.5 space-y-1">
                          <p className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                            <GraduationCap className="w-3 h-3 text-emerald-600" />
                            Drop / Deboarding
                          </p>
                          <p className="font-semibold text-slate-800">
                            {trip.attendance.dropStopName || 'School Campus'}
                          </p>
                          {trip.attendance.droppedAt ? (
                            <p className="text-[11px] text-slate-500 font-mono">
                              Deboarded at: {new Date(trip.attendance.droppedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          ) : (
                            <p className="text-[11px] text-slate-400">
                              Status: {trip.attendance.dropStatus || 'Pending'}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Corrections Ledger if present */}
                      {trip.corrections && trip.corrections.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-xs text-amber-900 space-y-1">
                          <p className="text-[10px] font-bold text-amber-800 uppercase flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 text-amber-600" />
                            Attendance Corrections ({trip.corrections.length})
                          </p>
                          {trip.corrections.map((corr) => (
                            <div key={corr.id} className="text-[11px] border-t border-amber-200/60 pt-1 mt-1">
                              Status changed from <span className="font-mono font-bold">{corr.previousStatus}</span> to{' '}
                              <span className="font-mono font-bold">{corr.newStatus}</span> by{' '}
                              <span className="font-semibold">{corr.correctedByRole}</span>: &quot;{corr.reason}&quot;
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
