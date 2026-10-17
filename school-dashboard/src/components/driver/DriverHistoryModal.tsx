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
  Phone,
  FileBadge,
} from 'lucide-react';
import {
  DriverTripHistoryItem,
  DriverIncidentHistoryItem,
  DriverAttendanceSummaryItem,
  DriverAttendanceRecordItem,
  DriverWithBus,
} from '@school-bus/shared';
import { fetchDriverFullHistory } from '../../services/driverApi';

interface DriverHistoryModalProps {
  schoolId: string;
  driver: DriverWithBus | null;
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'trips' | 'attendance' | 'incidents';

export function DriverHistoryModal({
  schoolId,
  driver,
  isOpen,
  onClose,
}: DriverHistoryModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('trips');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [trips, setTrips] = useState<DriverTripHistoryItem[]>([]);
  const [incidents, setIncidents] = useState<DriverIncidentHistoryItem[]>([]);
  const [attendanceSummaries, setAttendanceSummaries] = useState<DriverAttendanceSummaryItem[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<DriverAttendanceRecordItem[]>([]);

  const loadHistory = useCallback(async () => {
    if (!driver?.id) return;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await fetchDriverFullHistory(schoolId, driver.id);
      setTrips(data.trips || []);
      setIncidents(data.incidents || []);
      setAttendanceSummaries(data.attendance?.summaries || []);
      setAttendanceRecords(data.attendance?.recentRecords || []);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load driver operational history logs.');
    } finally {
      setIsLoading(false);
    }
  }, [schoolId, driver?.id]);

  useEffect(() => {
    if (isOpen && driver?.id) {
      loadHistory();
    } else {
      setTrips([]);
      setIncidents([]);
      setAttendanceSummaries([]);
      setAttendanceRecords([]);
      setErrorMessage(null);
    }
  }, [isOpen, driver?.id, loadHistory]);

  if (!isOpen || !driver) return null;

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
            <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-800 border-2 border-slate-700 flex items-center justify-center shrink-0">
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
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-tight">
                  {driver.fullName}
                </h3>
                <span className="px-2 py-0.5 rounded font-mono text-[11px] bg-slate-800 text-emerald-400 border border-slate-700">
                  {driver.phone}
                </span>
                <span className="px-2 py-0.5 rounded font-mono text-[11px] bg-slate-800 text-slate-300 border border-slate-700">
                  {driver.licenseNumber}
                </span>
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5">
                Driver trip log, student boarding attendance ledger, and safety incident audit
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
            onClick={() => setActiveTab('attendance')}
            className={`pb-2.5 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-colors ${
              activeTab === 'attendance'
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Boarding Activity</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-700 font-mono font-normal">
              {attendanceSummaries.length} trips
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
                    <div className="p-12 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200">
                      <Clock className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                      <h4 className="text-xs font-bold text-slate-800">No Trip History Found</h4>
                      <p className="text-[11px] text-slate-500 max-w-sm mx-auto mt-1">
                        This driver has not been assigned to or completed any scheduled trips yet.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                            <th className="py-2.5 px-3">Date & Shift</th>
                            <th className="py-2.5 px-3">Route</th>
                            <th className="py-2.5 px-3">Vehicle</th>
                            <th className="py-2.5 px-3">Timings (IST)</th>
                            <th className="py-2.5 px-3">Boarded</th>
                            <th className="py-2.5 px-3">Delay</th>
                            <th className="py-2.5 px-3 text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-700">
                          {trips.map((trip) => (
                            <tr key={trip.id} className="hover:bg-slate-50/70 transition-colors">
                              {/* Date & Shift */}
                              <td className="py-2.5 px-3 font-medium">
                                <div>
                                  <span className="font-semibold text-slate-900 block font-mono">
                                    {formatDateIST(trip.scheduledDate)}
                                  </span>
                                  <span className="text-[10px] text-slate-500 uppercase tracking-tight">
                                    {trip.routeType?.replace('_', ' ')}
                                  </span>
                                </div>
                              </td>

                              {/* Route */}
                              <td className="py-2.5 px-3">
                                <div className="space-y-0.5">
                                  <div className="font-semibold text-slate-900 flex items-center gap-1">
                                    <MapPin className="w-3 h-3 text-sky-600 shrink-0" />
                                    <span>{trip.routeName}</span>
                                  </div>
                                  <span className="font-mono text-[10px] text-slate-400 bg-slate-100 px-1 py-0.2 rounded inline-block">
                                    {trip.routeCode}
                                  </span>
                                </div>
                              </td>

                              {/* Vehicle */}
                              <td className="py-2.5 px-3">
                                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200 font-semibold text-[11px]">
                                  <Bus className="w-3 h-3 text-sky-600 shrink-0" />
                                  <span>{trip.busNumber}</span>
                                  {trip.busRegistrationNumber && (
                                    <span className="text-[9px] font-mono text-sky-600 font-normal">
                                      ({trip.busRegistrationNumber})
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* Timings */}
                              <td className="py-2.5 px-3 font-mono text-[11px]">
                                <div className="space-y-0.5">
                                  <div className="text-slate-500">
                                    Sched: {formatIST(trip.scheduledStartTime)}
                                  </div>
                                  {trip.actualStartTime && (
                                    <div className="text-slate-800 font-medium">
                                      Actual: {formatIST(trip.actualStartTime)}
                                      {trip.actualEndTime ? ` â†’ ${formatIST(trip.actualEndTime)}` : ''}
                                    </div>
                                  )}
                                </div>
                              </td>

                              {/* Boarded Students */}
                              <td className="py-2.5 px-3 font-mono text-center font-semibold text-slate-800">
                                {trip.totalBoarded || 0}
                              </td>

                              {/* Delay */}
                              <td className="py-2.5 px-3">
                                {trip.delayMinutes > 0 ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 font-mono">
                                    +{trip.delayMinutes}m delay
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                    On Time
                                  </span>
                                )}
                              </td>

                              {/* Status */}
                              <td className="py-2.5 px-3 text-right">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                                    trip.status === 'COMPLETED'
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                      : trip.status === 'ARRIVED_SCHOOL'
                                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                      : trip.status === 'IN_TRANSIT'
                                      ? 'bg-sky-50 text-sky-700 border border-sky-200 animate-pulse'
                                      : trip.status === 'CANCELLED'
                                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                      : 'bg-slate-100 text-slate-600 border border-slate-200'
                                  }`}
                                >
                                  {trip.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: BOARDING ACTIVITY */}
              {activeTab === 'attendance' && (
                <div className="space-y-5">
                  {/* Aggregated Per-Trip Summaries */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Recent Trip Attendance Summaries
                    </h4>
                    {attendanceSummaries.length === 0 ? (
                      <div className="p-8 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200 text-slate-500 text-xs">
                        No trip attendance summaries recorded for this driver yet.
                      </div>
                    ) : (
                      <div className="overflow-x-auto border border-slate-200 rounded-lg">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                              <th className="py-2.5 px-3">Date</th>
                              <th className="py-2.5 px-3">Route</th>
                              <th className="py-2.5 px-3">Vehicle</th>
                              <th className="py-2.5 px-3 text-center">Boarded</th>
                              <th className="py-2.5 px-3 text-center">Absent</th>
                              <th className="py-2.5 px-3 text-center">Deboarded</th>
                              <th className="py-2.5 px-3 text-right">Total Events</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-slate-700 font-mono">
                            {attendanceSummaries.map((sum) => (
                              <tr key={sum.tripId} className="hover:bg-slate-50/70">
                                <td className="py-2 px-3 font-semibold text-slate-900">
                                  {formatDateIST(sum.scheduledDate)}
                                </td>
                                <td className="py-2 px-3 font-sans">
                                  <span className="font-semibold text-slate-900">{sum.routeName}</span>
                                  <span className="text-[10px] font-mono text-slate-400 ml-1.5">
                                    ({sum.routeCode})
                                  </span>
                                </td>
                                <td className="py-2 px-3 font-sans">
                                  <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200 text-[11px] font-semibold">
                                    {sum.busNumber}
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-center text-emerald-700 font-bold">
                                  {sum.totalBoarded}
                                </td>
                                <td className="py-2 px-3 text-center text-rose-600 font-bold">
                                  {sum.totalAbsent}
                                </td>
                                <td className="py-2 px-3 text-center text-indigo-600 font-bold">
                                  {sum.totalDeboarded}
                                </td>
                                <td className="py-2 px-3 text-right text-slate-800 font-bold">
                                  {sum.totalEvents}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Chronological Recent Student Events */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Individual Student Boarding / Drop Events (Recent 50)
                    </h4>
                    {attendanceRecords.length === 0 ? (
                      <div className="p-8 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200 text-slate-500 text-xs">
                        No individual student boarding events recorded yet.
                      </div>
                    ) : (
                      <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-72 overflow-y-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead className="sticky top-0 bg-slate-100 shadow-2xs">
                            <tr className="border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                              <th className="py-2 px-3">Timestamp</th>
                              <th className="py-2 px-3">Student</th>
                              <th className="py-2 px-3">Class</th>
                              <th className="py-2 px-3">Stop</th>
                              <th className="py-2 px-3">Vehicle</th>
                              <th className="py-2 px-3">Event Type</th>
                              <th className="py-2 px-3 text-right">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-slate-700">
                            {attendanceRecords.map((rec) => (
                              <tr key={rec.id} className="hover:bg-slate-50/70">
                                <td className="py-2 px-3 font-mono text-[11px] text-slate-500">
                                  {formatIST(rec.recordedAt)}
                                </td>
                                <td className="py-2 px-3 font-semibold text-slate-900">
                                  <div>
                                    <span>{rec.studentName}</span>
                                    <span className="text-[10px] font-mono text-slate-400 block font-normal">
                                      Adm: {rec.admissionNumber}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-2 px-3 font-mono text-[11px]">
                                  {rec.classGrade}-{rec.section}
                                </td>
                                <td className="py-2 px-3 text-slate-700 truncate max-w-[140px]">
                                  {rec.stopName}
                                </td>
                                <td className="py-2 px-3 font-mono text-[11px] text-sky-800">
                                  {rec.busNumber}
                                </td>
                                <td className="py-2 px-3">
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                      rec.eventType === 'BOARDING'
                                        ? 'bg-sky-50 text-sky-700 border border-sky-200'
                                        : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                    }`}
                                  >
                                    {rec.eventType}
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-right">
                                  <span
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                      rec.status === 'BOARDED' || rec.status === 'DEBOARDED'
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                                    }`}
                                  >
                                    {rec.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: INCIDENT & SOS HISTORY */}
              {activeTab === 'incidents' && (
                <div className="space-y-3">
                  {incidents.length === 0 ? (
                    <div className="p-12 text-center bg-emerald-50/40 rounded-lg border border-emerald-200">
                      <ShieldCheck className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                      <h4 className="text-xs font-bold text-emerald-900">
                        Zero Safety Incidents or SOS Alerts
                      </h4>
                      <p className="text-[11px] text-emerald-700 max-w-sm mx-auto mt-1">
                        Clean safety record. No vehicle breakdowns, delays, accidents, or driver SOS events logged for this driver.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {incidents.map((inc) => (
                        <div
                          key={inc.id}
                          className={`p-4 rounded-lg border flex flex-col sm:flex-row items-start justify-between gap-4 ${
                            inc.category === 'SOS'
                              ? 'bg-rose-50/60 border-rose-200 text-rose-900'
                              : 'bg-amber-50/60 border-amber-200 text-amber-900'
                          }`}
                        >
                          <div className="space-y-1.5 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                  inc.category === 'SOS'
                                    ? 'bg-rose-600 text-white'
                                    : 'bg-amber-600 text-white'
                                }`}
                              >
                                {inc.category}
                              </span>
                              <span className="font-semibold text-xs text-slate-900">
                                {inc.type?.replace(/_/g, ' ')}
                              </span>
                              <span
                                className={`px-2 py-0.2 rounded text-[10px] font-bold uppercase font-mono ${
                                  inc.severity === 'CRITICAL'
                                    ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                    : inc.severity === 'HIGH'
                                    ? 'bg-orange-100 text-orange-800 border border-orange-300'
                                    : 'bg-amber-100 text-amber-800 border border-amber-300'
                                }`}
                              >
                                {inc.severity} Severity
                              </span>
                              {inc.busNumber && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.2 rounded text-[10px] bg-white border border-slate-300 text-slate-700 font-mono font-semibold">
                                  <Bus className="w-3 h-3 text-slate-500" />
                                  {inc.busNumber}
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-slate-800 font-medium">{inc.description}</p>

                            <div className="flex items-center gap-4 text-[11px] text-slate-600 pt-1">
                              <span className="flex items-center gap-1 font-mono">
                                <Clock className="w-3 h-3 text-slate-400" />
                                {formatDateIST(inc.createdAt)} at {formatIST(inc.createdAt)}
                              </span>
                              {inc.latitude && inc.longitude && (
                                <span className="flex items-center gap-1 font-mono text-slate-500">
                                  <Navigation className="w-3 h-3 text-sky-600" />
                                  {inc.latitude.toFixed(4)}, {inc.longitude.toFixed(4)}
                                </span>
                              )}
                            </div>

                            {inc.resolutionNotes && (
                              <div className="mt-2 p-2.5 bg-white/80 border border-slate-200 rounded text-xs text-slate-700">
                                <strong className="font-semibold text-slate-900 block text-[11px]">
                                  Resolution Notes:
                                </strong>
                                <span>{inc.resolutionNotes}</span>
                              </div>
                            )}
                          </div>

                          <div className="shrink-0 flex sm:flex-col items-end gap-1.5">
                            <span
                              className={`px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider ${
                                inc.status === 'RESOLVED' || inc.status === 'CLOSED'
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                  : inc.status === 'ACKNOWLEDGED'
                                  ? 'bg-sky-100 text-sky-800 border border-sky-300'
                                  : 'bg-rose-100 text-rose-800 border border-rose-300 animate-pulse'
                              }`}
                            >
                              {inc.status}
                            </span>
                            {inc.resolvedAt && (
                              <span className="text-[10px] text-slate-500 font-mono">
                                Res: {formatIST(inc.resolvedAt)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="text-[11px] text-slate-500">
            Records archived and isolated under School ID: <span className="font-mono">{schoolId.slice(0, 8)}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded text-xs font-semibold shadow-2xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

