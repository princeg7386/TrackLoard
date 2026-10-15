'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Bus,
  History,
  AlertTriangle,
  Users,
  Calendar,
  Clock,
  MapPin,
  User,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ShieldAlert,
  ArrowRight,
  ShieldCheck,
  Check,
  XCircle,
  Navigation,
} from 'lucide-react';
import {
  BusTripHistoryItem,
  BusIncidentHistoryItem,
  BusAttendanceSummaryItem,
  BusAttendanceRecordItem,
  BusWithDriver,
} from '@school-bus/shared';
import { fetchBusFullHistory } from '../../services/busApi';

interface BusHistoryModalProps {
  schoolId: string;
  bus: BusWithDriver | null;
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'trips' | 'incidents' | 'attendance';

export function BusHistoryModal({
  schoolId,
  bus,
  isOpen,
  onClose,
}: BusHistoryModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('trips');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [trips, setTrips] = useState<BusTripHistoryItem[]>([]);
  const [incidents, setIncidents] = useState<BusIncidentHistoryItem[]>([]);
  const [attendanceSummaries, setAttendanceSummaries] = useState<BusAttendanceSummaryItem[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<BusAttendanceRecordItem[]>([]);

  const loadHistory = useCallback(async () => {
    if (!bus?.id) return;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await fetchBusFullHistory(schoolId, bus.id);
      setTrips(data.trips || []);
      setIncidents(data.incidents || []);
      setAttendanceSummaries(data.attendance?.summaries || []);
      setAttendanceRecords(data.attendance?.recentRecords || []);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load vehicle history logs.');
    } finally {
      setIsLoading(false);
    }
  }, [schoolId, bus?.id]);

  useEffect(() => {
    if (isOpen && bus?.id) {
      loadHistory();
    } else {
      setTrips([]);
      setIncidents([]);
      setAttendanceSummaries([]);
      setAttendanceRecords([]);
      setErrorMessage(null);
    }
  }, [isOpen, bus?.id, loadHistory]);

  if (!isOpen || !bus) return null;

  const formatIST = (dateStr?: string | null) => {
    if (!dateStr) return 'N/A';
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden my-6 flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center text-white shrink-0">
              <History className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-tight">
                  Vehicle History & Audit Log
                </h3>
                <span className="font-semibold text-sky-300 text-xs">({bus.busNumber})</span>
                <span className="px-2 py-0.5 rounded font-mono text-[11px] bg-slate-800 text-slate-300 border border-slate-700">
                  {bus.registrationNumber}
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                Audit trail of completed trips, safety incidents, SOS alerts, and student attendance
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadHistory}
              disabled={isLoading}
              title="Refresh History"
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

        {/* Tab Switcher */}
        <div className="px-6 pt-3 bg-slate-50 border-b border-slate-200 flex items-center gap-4 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('trips')}
            className={`pb-2.5 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-colors ${
              activeTab === 'trips'
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Trip History</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-700 font-mono font-normal">
              {trips.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('incidents')}
            className={`pb-2.5 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-colors ${
              activeTab === 'incidents'
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Safety & Incident Log</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-normal ${
                incidents.length > 0 ? 'bg-rose-100 text-rose-700 font-bold' : 'bg-slate-200 text-slate-700'
              }`}
            >
              {incidents.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('attendance')}
            className={`pb-2.5 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-colors ${
              activeTab === 'attendance'
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Attendance Ledger</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-700 font-mono font-normal">
              {attendanceSummaries.length} trips
            </span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center justify-between text-rose-900 text-xs">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={loadHistory}
                className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded font-medium text-[11px]"
              >
                Retry
              </button>
            </div>
          )}

          {/* Loading Skeleton */}
          {isLoading && (
            <div className="space-y-3 py-6 animate-pulse">
              <div className="h-8 bg-slate-100 rounded w-full" />
              <div className="h-10 bg-slate-100 rounded w-full" />
              <div className="h-10 bg-slate-100 rounded w-full" />
              <div className="h-10 bg-slate-100 rounded w-full" />
            </div>
          )}

          {!isLoading && (
            <>
              {/* TAB 1: TRIP HISTORY */}
              {activeTab === 'trips' && (
                <div className="space-y-3">
                  {trips.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-500">
                      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2 text-slate-400">
                        <Clock className="w-5 h-5" />
                      </div>
                      <p className="font-semibold text-slate-700">No Past Trips Recorded</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Completed and scheduled trips dispatched for this bus will appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                            <th className="py-2.5 px-3">Date & Shift</th>
                            <th className="py-2.5 px-3">Route</th>
                            <th className="py-2.5 px-3">Driver</th>
                            <th className="py-2.5 px-3">Timings (IST)</th>
                            <th className="py-2.5 px-3">Status</th>
                            <th className="py-2.5 px-3">Punctuality</th>
                            <th className="py-2.5 px-3 text-right">Boarded</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-700">
                          {trips.map((tr) => (
                            <tr key={tr.id} className="hover:bg-slate-50/60">
                              <td className="py-2.5 px-3">
                                <span className="font-semibold text-slate-900 block font-mono">
                                  {tr.scheduledDate}
                                </span>
                                <span className="text-[10px] text-slate-400 font-medium">
                                  {tr.routeType.replace('_', ' ')}
                                </span>
                              </td>
                              <td className="py-2.5 px-3">
                                <span className="font-semibold text-slate-900 block">{tr.routeName}</span>
                                <span className="font-mono text-[10px] text-slate-400">
                                  {tr.routeCode}
                                </span>
                              </td>
                              <td className="py-2.5 px-3">
                                <span className="font-medium text-slate-800 block">{tr.driverName}</span>
                                {tr.driverPhone && (
                                  <span className="text-[10px] font-mono text-slate-400">
                                    {tr.driverPhone}
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">
                                <div>
                                  <span className="text-slate-400">Sch: </span>
                                  {formatIST(tr.scheduledStartTime)}
                                </div>
                                {tr.actualStartTime && (
                                  <div>
                                    <span className="text-slate-400">Act: </span>
                                    {formatIST(tr.actualStartTime)}
                                    {tr.actualEndTime && ` - ${formatIST(tr.actualEndTime)}`}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${
                                    tr.status === 'COMPLETED'
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                      : tr.status === 'IN_TRANSIT'
                                      ? 'bg-sky-50 text-sky-700 border-sky-200'
                                      : tr.status === 'SCHEDULED'
                                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                                      : 'bg-slate-100 text-slate-600 border-slate-200'
                                  }`}
                                >
                                  {tr.status}
                                </span>
                              </td>
                              <td className="py-2.5 px-3">
                                {tr.delayMinutes > 0 ? (
                                  <span className="text-amber-600 font-semibold text-[11px]">
                                    +{tr.delayMinutes} min delay
                                  </span>
                                ) : (
                                  <span className="text-emerald-600 font-semibold text-[11px]">
                                    On Time
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800">
                                {tr.totalBoarded != null ? `${tr.totalBoarded} students` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: SAFETY & INCIDENT LOG */}
              {activeTab === 'incidents' && (
                <div className="space-y-3">
                  {incidents.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-500">
                      <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-2 text-emerald-600">
                        <ShieldCheck className="w-5 h-5" />
                      </div>
                      <p className="font-semibold text-emerald-950 text-sm">Pristine Safety Record</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        No traffic breakdowns, delays, or emergency SOS alerts logged for this vehicle.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {incidents.map((inc) => (
                        <div
                          key={inc.id}
                          className={`p-4 rounded-lg border text-xs space-y-2.5 ${
                            inc.category === 'SOS'
                              ? 'bg-rose-50/70 border-rose-200'
                              : 'bg-white border-slate-200'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {inc.category === 'SOS' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-rose-600 text-white uppercase tracking-wider">
                                  <AlertTriangle className="w-3 h-3" />
                                  EMERGENCY SOS
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                                  <AlertCircle className="w-3 h-3" />
                                  {inc.type.replace('_', ' ')}
                                </span>
                              )}

                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                  inc.severity === 'CRITICAL'
                                    ? 'bg-rose-100 text-rose-800 font-bold'
                                    : inc.severity === 'HIGH'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                {inc.severity} Severity
                              </span>
                            </div>

                            <span className="text-[11px] text-slate-500 font-mono">
                              Logged: {formatDateIST(inc.createdAt)} at {formatIST(inc.createdAt)} IST
                            </span>
                          </div>

                          <p className="text-slate-800 font-medium text-xs leading-relaxed">
                            {inc.description}
                          </p>

                          {/* Context Tags */}
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600 pt-1 border-t border-slate-100">
                            {inc.driverName && (
                              <span className="flex items-center gap-1">
                                <User className="w-3 h-3 text-slate-400" />
                                Driver: <strong className="text-slate-700">{inc.driverName}</strong>
                              </span>
                            )}
                            {inc.routeName && (
                              <span className="flex items-center gap-1">
                                <MapPin className="w-3 h-3 text-slate-400" />
                                Route: <strong className="text-slate-700">{inc.routeName}</strong>
                              </span>
                            )}
                            {inc.latitude && inc.longitude && (
                              <span className="flex items-center gap-1 font-mono text-[10px]">
                                <Navigation className="w-3 h-3 text-sky-500" />
                                {inc.latitude.toFixed(4)}, {inc.longitude.toFixed(4)}
                              </span>
                            )}
                          </div>

                          {/* Resolution Status */}
                          <div className="pt-1.5 flex items-center justify-between text-[11px]">
                            <div className="flex items-center gap-1.5">
                              {inc.status === 'RESOLVED' ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                  Resolved {inc.resolvedAt ? `(${formatIST(inc.resolvedAt)} IST)` : ''}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-rose-700 font-semibold">
                                  <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                                  Active / {inc.status}
                                </span>
                              )}
                            </div>
                            {inc.resolutionNotes && (
                              <span className="text-slate-500 italic max-w-md truncate">
                                Note: {inc.resolutionNotes}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: ATTENDANCE LEDGER */}
              {activeTab === 'attendance' && (
                <div className="space-y-4">
                  {attendanceSummaries.length === 0 && attendanceRecords.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-500">
                      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2 text-slate-400">
                        <Users className="w-5 h-5" />
                      </div>
                      <p className="font-semibold text-slate-700">No Attendance Records Found</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Student boarding and drop events marked during active trips will be recorded here.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Trip Summaries */}
                      <div>
                        <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                          Recent Trip Attendance Summaries
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {attendanceSummaries.map((sum) => (
                            <div
                              key={sum.tripId}
                              className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-2"
                            >
                              <div className="flex justify-between items-start">
                                <div>
                                  <span className="font-bold text-slate-900 block">{sum.routeName}</span>
                                  <span className="text-[10px] text-slate-400 font-mono">
                                    {sum.scheduledDate} • {sum.shiftType.replace('_', ' ')}
                                  </span>
                                </div>
                                <span className="text-[11px] text-slate-600 font-medium">
                                  {sum.driverName}
                                </span>
                              </div>

                              <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-200 text-center font-mono text-[11px]">
                                <div className="p-1.5 bg-emerald-50 rounded border border-emerald-200">
                                  <span className="text-[10px] text-emerald-600 block uppercase font-semibold">
                                    Boarded
                                  </span>
                                  <span className="font-bold text-emerald-800">{sum.totalBoarded}</span>
                                </div>
                                <div className="p-1.5 bg-rose-50 rounded border border-rose-200">
                                  <span className="text-[10px] text-rose-600 block uppercase font-semibold">
                                    Absent
                                  </span>
                                  <span className="font-bold text-rose-800">{sum.totalAbsent}</span>
                                </div>
                                <div className="p-1.5 bg-sky-50 rounded border border-sky-200">
                                  <span className="text-[10px] text-sky-600 block uppercase font-semibold">
                                    Deboarded
                                  </span>
                                  <span className="font-bold text-sky-800">{sum.totalDeboarded}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Detailed Student Event Log */}
                      {attendanceRecords.length > 0 && (
                        <div className="space-y-2 pt-2">
                          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                            Recent Student Boarding / Drop Events
                          </h4>
                          <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-64 overflow-y-auto">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                                <tr>
                                  <th className="py-2 px-3">Student</th>
                                  <th className="py-2 px-3">Class / Section</th>
                                  <th className="py-2 px-3">Pickup / Drop Stop</th>
                                  <th className="py-2 px-3">Event Type</th>
                                  <th className="py-2 px-3">Status</th>
                                  <th className="py-2 px-3">Marked By</th>
                                  <th className="py-2 px-3 text-right">Time (IST)</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 text-slate-700">
                                {attendanceRecords.map((rec) => (
                                  <tr key={rec.id} className="hover:bg-slate-50/60">
                                    <td className="py-2 px-3 font-semibold text-slate-900">
                                      {rec.studentName}
                                      <span className="block text-[10px] font-mono text-slate-400 font-normal">
                                        {rec.admissionNumber}
                                      </span>
                                    </td>
                                    <td className="py-2 px-3">
                                      Grade {rec.classGrade}-{rec.section}
                                    </td>
                                    <td className="py-2 px-3 font-medium text-slate-700 truncate max-w-[140px]">
                                      {rec.stopName}
                                    </td>
                                    <td className="py-2 px-3">
                                      <span
                                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                          rec.eventType === 'BOARDING'
                                            ? 'bg-sky-50 text-sky-700'
                                            : 'bg-indigo-50 text-indigo-700'
                                        }`}
                                      >
                                        {rec.eventType}
                                      </span>
                                    </td>
                                    <td className="py-2 px-3">
                                      <span
                                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                          rec.status === 'BOARDED' || rec.status === 'DEBOARDED'
                                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                                        }`}
                                      >
                                        {rec.status === 'BOARDED' ? (
                                          <Check className="w-3 h-3 text-emerald-600" />
                                        ) : (
                                          <XCircle className="w-3 h-3 text-rose-600" />
                                        )}
                                        {rec.status}
                                      </span>
                                    </td>
                                    <td className="py-2 px-3 text-[11px] text-slate-500 font-mono">
                                      {rec.markedBy}
                                    </td>
                                    <td className="py-2 px-3 text-right font-mono text-[10px] text-slate-600">
                                      {formatIST(rec.recordedAt)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-md text-xs font-semibold shadow-2xs transition-colors"
          >
            Close History
          </button>
        </div>
      </div>
    </div>
  );
}

