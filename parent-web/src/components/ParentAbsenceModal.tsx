/**
 * Parent Absence Modal Component — parent-web (Phase 33.1)
 *
 * Micro-phase 33.1: Student Not Going Today — Parent Flow
 *
 * Flow:
 * 1. Select / Verify Student: Direct context from parent token session (1:1 authorization, no multi-child switcher)
 * 2. Select Date & Scope: Today, Tomorrow, or custom date + Full Day / Morning / Afternoon
 * 3. Confirm Absence: Idempotent submission, review summary, loading, success, and retry states.
 */

'use client';

import React, { useState } from 'react';
import {
  Calendar,
  CalendarOff,
  Clock,
  UserCheck,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  Bus,
  ShieldAlert,
} from 'lucide-react';
import { ParentAbsenceDetails } from '@school-bus/shared';

export interface StudentContext {
  id: string;
  fullName: string;
  admissionNumber?: string | null;
  classGrade?: string | null;
  section?: string | null;
}

export interface ParentAbsenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  apiBase: string;
  student: StudentContext;
  pickupStopName?: string | null;
  schoolName: string;
  onAbsenceReported: (absence: ParentAbsenceDetails) => void;
}

export type TripTypeOption = 'FULL_DAY' | 'MORNING' | 'AFTERNOON';

export function ParentAbsenceModal({
  isOpen,
  onClose,
  token,
  apiBase,
  student,
  pickupStopName,
  schoolName,
  onAbsenceReported,
}: ParentAbsenceModalProps) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const tomorrowDate = new Date(Date.now() + 86400000);
  const tomorrowStr = tomorrowDate.toISOString().slice(0, 10);

  // Form states
  const [dateMode, setDateMode] = useState<'today' | 'tomorrow' | 'custom'>('today');
  const [customDate, setCustomDate] = useState<string>(todayStr);
  const [tripType, setTripType] = useState<TripTypeOption>('FULL_DAY');
  const [reasonCategory, setReasonCategory] = useState<string>('Sick / Unwell');
  const [customReason, setCustomReason] = useState<string>('');

  // Submission states
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successRecord, setSuccessRecord] = useState<ParentAbsenceDetails | null>(null);

  if (!isOpen) return null;

  const effectiveDate =
    dateMode === 'today' ? todayStr : dateMode === 'tomorrow' ? tomorrowStr : customDate;

  const finalReason =
    reasonCategory === 'Other'
      ? customReason.trim() || 'Other'
      : customReason.trim()
        ? `${reasonCategory}: ${customReason.trim()}`
        : reasonCategory;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const url = `${apiBase}/api/v1/parent/absence?token=${encodeURIComponent(token)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tracking-Token': token,
        },
        body: JSON.stringify({
          absenceDate: effectiveDate,
          tripType,
          reason: finalReason,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || 'Failed to submit absence report. Please try again.');
      }

      const record: ParentAbsenceDetails = json.data;
      setSuccessRecord(record);
      onAbsenceReported(record);
    } catch (err: any) {
      setErrorMessage(err.message || 'Network error occurred while submitting absence report.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setSuccessRecord(null);
    setErrorMessage(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
              <CalendarOff className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 leading-tight">Student Not Going Today</h2>
              <p className="text-[11px] text-slate-500 font-medium">Report Transport Absence</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {successRecord ? (
            /* Success State Screen */
            <div className="py-4 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-xs">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-black text-slate-900">Absence Confirmed</h3>
                <p className="text-slate-600">
                  <span className="font-bold text-slate-900">{student.fullName}</span> is marked not traveling on{' '}
                  <span className="font-bold text-slate-900 font-mono">{successRecord.absenceDate}</span>.
                </p>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-left space-y-1.5 font-sans">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-500">Scope:</span>
                  <span className="font-bold text-slate-800">
                    {successRecord.tripType === 'MORNING'
                      ? 'Morning Pickup Only'
                      : successRecord.tripType === 'AFTERNOON'
                        ? 'Afternoon Drop Only'
                        : 'Full Day (Pickup & Drop)'}
                  </span>
                </div>
                {pickupStopName && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Stop:</span>
                    <span className="font-bold text-slate-800">{pickupStopName}</span>
                  </div>
                )}
                {successRecord.reason && (
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500">Reason:</span>
                    <span className="font-bold text-slate-800">{successRecord.reason}</span>
                  </div>
                )}
              </div>

              <p className="text-[11px] text-slate-500 leading-relaxed">
                The driver and school transport desk have been updated. The bus will not wait at your pickup stop.
              </p>

              <button
                type="button"
                onClick={handleClose}
                className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-xl shadow-xs transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            /* Absence Entry Form */
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Task 1: Select / Verify Student (1:1 direct link context) */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center font-bold text-xs">
                    {student.fullName.charAt(0)}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-900 text-xs">{student.fullName}</span>
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded-full">
                        <UserCheck className="w-2.5 h-2.5" /> Verified
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500">
                      {student.classGrade ? `Class ${student.classGrade}${student.section ? `-${student.section}` : ''}` : ''}
                      {student.admissionNumber ? ` · Adm: ${student.admissionNumber}` : ''}
                    </p>
                  </div>
                </div>
              </div>

              {/* Task 2: Select Date */}
              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-slate-700">Select Absence Date</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setDateMode('today')}
                    className={`py-2 px-2 text-center rounded-xl border text-xs font-semibold transition-all ${
                      dateMode === 'today'
                        ? 'border-sky-500 bg-sky-50 text-sky-800 shadow-2xs font-bold'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Today
                    <span className="block text-[9px] font-mono font-normal opacity-70">
                      {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDateMode('tomorrow')}
                    className={`py-2 px-2 text-center rounded-xl border text-xs font-semibold transition-all ${
                      dateMode === 'tomorrow'
                        ? 'border-sky-500 bg-sky-50 text-sky-800 shadow-2xs font-bold'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Tomorrow
                    <span className="block text-[9px] font-mono font-normal opacity-70">
                      {tomorrowDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDateMode('custom')}
                    className={`py-2 px-2 text-center rounded-xl border text-xs font-semibold transition-all ${
                      dateMode === 'custom'
                        ? 'border-sky-500 bg-sky-50 text-sky-800 shadow-2xs font-bold'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Custom
                    <span className="block text-[9px] font-mono font-normal opacity-70">Pick date</span>
                  </button>
                </div>

                {dateMode === 'custom' && (
                  <div className="pt-1">
                    <input
                      type="date"
                      min={todayStr}
                      value={customDate}
                      onChange={(e) => setCustomDate(e.target.value)}
                      required
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                )}
              </div>

              {/* Trip Type Scope */}
              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-slate-700">Absence Scope</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setTripType('FULL_DAY')}
                    className={`py-2 px-2 text-center rounded-xl border text-[11px] font-medium transition-all ${
                      tripType === 'FULL_DAY'
                        ? 'border-sky-500 bg-sky-50 text-sky-800 font-bold'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Full Day
                  </button>
                  <button
                    type="button"
                    onClick={() => setTripType('MORNING')}
                    className={`py-2 px-2 text-center rounded-xl border text-[11px] font-medium transition-all ${
                      tripType === 'MORNING'
                        ? 'border-sky-500 bg-sky-50 text-sky-800 font-bold'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Morning Only
                  </button>
                  <button
                    type="button"
                    onClick={() => setTripType('AFTERNOON')}
                    className={`py-2 px-2 text-center rounded-xl border text-[11px] font-medium transition-all ${
                      tripType === 'AFTERNOON'
                        ? 'border-sky-500 bg-sky-50 text-sky-800 font-bold'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Afternoon Only
                  </button>
                </div>
              </div>

              {/* Reason (Optional) */}
              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-slate-700">Reason (Optional)</label>
                <select
                  value={reasonCategory}
                  onChange={(e) => setReasonCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="Sick / Unwell">Sick / Medical</option>
                  <option value="Family / Personal Reason">Family Function / Personal</option>
                  <option value="Parent Providing Transport">Self Drop / Pickup by Parent</option>
                  <option value="School Event / Holiday">School Function / Other</option>
                  <option value="Other">Other Reason</option>
                </select>

                <input
                  type="text"
                  placeholder="Additional note (e.g. fever, dental appointment)..."
                  maxLength={100}
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {/* Task 3: Confirm Absence Notice & Error Display */}
              {errorMessage && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-rose-800 text-[11px] flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-bold">Error submitting absence</p>
                    <p className="text-[10px] mt-0.5">{errorMessage}</p>
                  </div>
                </div>
              )}

              <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3 text-[10px] text-amber-900 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  By confirming, the bus driver will be alerted in real time so the bus will skip{' '}
                  <span className="font-bold">{pickupStopName || 'your stop'}</span>.
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 px-3 border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2.5 px-3 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Confirming...</span>
                    </>
                  ) : (
                    <span>Confirm Not Going</span>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
