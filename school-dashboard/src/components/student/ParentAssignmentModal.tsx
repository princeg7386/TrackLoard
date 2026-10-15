'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Users,
  GraduationCap,
  Bus,
  MapPin,
  Clock,
  Phone,
  MessageSquare,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  Send,
  Link as LinkIcon,
  CheckCircle2,
  ExternalLink,
  ChevronRight,
  Info,
  KeyRound,
  FileText,
  Calendar,
  Copy,
  Check,
} from 'lucide-react';
import {
  ParentRecordWithStudent,
  ParentAssignmentDetails,
  ParentCommunicationItem,
  ParentOnboardInviteResponse,
  StudentWithDetails,
} from '@school-bus/shared';
import {
  fetchParentAssignmentDetails,
  relinkParentStudent,
  fetchParentCommunicationHistory,
  sendParentNotice,
  sendParentOnboardInvite,
  fetchStudents,
} from '../../services/studentApi';
import { EmptyState } from '../ui/EmptyState';

interface ParentAssignmentModalProps {
  schoolId: string;
  parent: ParentRecordWithStudent | null;
  isOpen: boolean;
  onClose: () => void;
  onAssignmentUpdated?: () => void;
  onViewStudentDetail?: (studentId: string) => void;
}

export function ParentAssignmentModal({
  schoolId,
  parent,
  isOpen,
  onClose,
  onAssignmentUpdated,
  onViewStudentDetail,
}: ParentAssignmentModalProps) {
  const [activeTab, setActiveTab] = useState<'assignment' | 'communications' | 'send_notice'>('assignment');

  // Assignment data state
  const [details, setDetails] = useState<ParentAssignmentDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Communications state
  const [communications, setCommunications] = useState<ParentCommunicationItem[]>([]);
  const [isCommLoading, setIsCommLoading] = useState(false);

  // Re-link student workflow
  const [isRelinking, setIsRelinking] = useState(false);
  const [availableStudents, setAvailableStudents] = useState<StudentWithDetails[]>([]);
  const [studentSearchTerm, setStudentSearchTerm] = useState('');
  const [selectedNewStudentId, setSelectedNewStudentId] = useState('');
  const [isRelinkSaving, setIsRelinkSaving] = useState(false);
  const [relinkSuccessMsg, setRelinkSuccessMsg] = useState<string | null>(null);

  // Send Notice workflow
  const [noticeTemplate, setNoticeTemplate] = useState('WELCOME_ONBOARDING');
  const [noticeMessage, setNoticeMessage] = useState('');
  const [isSendingNotice, setIsSendingNotice] = useState(false);
  const [sendNoticeSuccess, setSendNoticeSuccess] = useState<string | null>(null);

  // WhatsApp Onboarding Invite workflow
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [inviteResult, setInviteResult] = useState<ParentOnboardInviteResponse | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const handleSendOnboardingInvite = async () => {
    if (!parent) return;
    setIsSendingInvite(true);
    setErrorMessage(null);

    try {
      const res = await sendParentOnboardInvite(schoolId, parent.id, { ttlHours: 72 });
      setInviteResult(res);
      loadAssignmentAndHistory();
      loadCommunications();
      if (onAssignmentUpdated) onAssignmentUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to dispatch onboarding invitation.');
    } finally {
      setIsSendingInvite(false);
    }
  };

  const handleCopyInviteLink = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };


  const loadAssignmentAndHistory = useCallback(async () => {
    if (!parent) return;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await fetchParentAssignmentDetails(schoolId, parent.id);
      setDetails(data);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load parent assignment details');
    } finally {
      setIsLoading(false);
    }
  }, [schoolId, parent]);

  const loadCommunications = useCallback(async () => {
    if (!parent) return;
    setIsCommLoading(true);
    try {
      const comms = await fetchParentCommunicationHistory(schoolId, parent.id);
      setCommunications(comms);
    } catch {
      // Non-fatal fallback
    } finally {
      setIsCommLoading(false);
    }
  }, [schoolId, parent]);

  useEffect(() => {
    if (isOpen && parent) {
      loadAssignmentAndHistory();
      loadCommunications();
      setIsRelinking(false);
      setSelectedNewStudentId('');
      setRelinkSuccessMsg(null);
      setSendNoticeSuccess(null);
      setActiveTab('assignment');
    }
  }, [isOpen, parent, loadAssignmentAndHistory, loadCommunications]);

  // Load available students when opening re-link mode
  useEffect(() => {
    if (isRelinking && availableStudents.length === 0) {
      fetchStudents(schoolId).then((students) => {
        setAvailableStudents(students);
      });
    }
  }, [isRelinking, schoolId, availableStudents.length]);

  // Update default notice text when template changes
  useEffect(() => {
    if (!details) return;
    const studentName = details.student.fullName;
    const busInfo = details.transport.busNumber ? `Bus ${details.transport.busNumber}` : 'school bus';
    const stopInfo = details.transport.pickupStopName ? ` at ${details.transport.pickupStopName}` : '';

    if (noticeTemplate === 'WELCOME_ONBOARDING') {
      setNoticeMessage(
        `Dear ${details.parent.fullName}, welcome to the transport tracking service! Your child ${studentName} is assigned to ${busInfo}${stopInfo}. Live trip tracking will be shared during daily morning and afternoon runs.`
      );
    } else if (noticeTemplate === 'LIVE_TRACKING_INVITE') {
      setNoticeMessage(
        `Dear ${details.parent.fullName}, live tracking is active for ${studentName}'s route (${busInfo}). You can view the live bus location on your secure map portal during scheduled school transport hours.`
      );
    } else if (noticeTemplate === 'DELAY_ALERT') {
      setNoticeMessage(
        `Notice for ${studentName}'s route: ${busInfo} is experiencing a minor traffic delay on its scheduled stops. Driver and dispatch team are monitoring safety.`
      );
    } else {
      setNoticeMessage('');
    }
  }, [noticeTemplate, details]);

  if (!isOpen || !parent) return null;

  const handleConfirmRelink = async () => {
    if (!selectedNewStudentId) return;
    setIsRelinkSaving(true);
    setErrorMessage(null);
    setRelinkSuccessMsg(null);

    try {
      const updated = await relinkParentStudent(schoolId, parent.id, selectedNewStudentId);
      setDetails(updated);
      setRelinkSuccessMsg('Parent successfully linked to authorized student.');
      setIsRelinking(false);
      setSelectedNewStudentId('');
      loadCommunications();
      if (onAssignmentUpdated) onAssignmentUpdated();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to re-link student.');
    } finally {
      setIsRelinkSaving(false);
    }
  };

  const handleSendNoticeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noticeMessage.trim()) return;

    setIsSendingNotice(true);
    setSendNoticeSuccess(null);
    setErrorMessage(null);

    try {
      const newItem = await sendParentNotice(schoolId, parent.id, {
        templateName: noticeTemplate,
        messageBody: noticeMessage.trim(),
        channel: 'WHATSAPP',
      });

      setCommunications((prev) => [newItem, ...prev]);
      setSendNoticeSuccess('WhatsApp notice successfully dispatched.');
      setTimeout(() => {
        setSendNoticeSuccess(null);
        setActiveTab('communications');
      }, 1500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to dispatch notice.');
    } finally {
      setIsSendingNotice(false);
    }
  };

  const cleanPhone = details?.parent.phone ? details.parent.phone.replace(/[^0-9]/g, '') : '';
  const waUrl = cleanPhone ? `https://wa.me/${cleanPhone}` : null;

  const filteredStudentsForRelink = availableStudents.filter(
    (s) =>
      s.id !== details?.student.id &&
      (s.fullName.toLowerCase().includes(studentSearchTerm.toLowerCase()) ||
        s.admissionNumber.toLowerCase().includes(studentSearchTerm.toLowerCase()) ||
        s.classGrade.toLowerCase().includes(studentSearchTerm.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-2xs animate-fadeIn">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-sky-100 text-sky-800 font-bold flex items-center justify-center text-xs shrink-0 border border-sky-200">
              {parent.fullName.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 leading-tight">
                  {details?.parent.fullName || parent.fullName}
                </h2>
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200">
                  {details?.parent.relationship || parent.relationship}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 font-mono">
                {details?.parent.phone || parent.phone || 'No mobile linked'}
                {details?.parent.email ? ` â€¢ ${details.parent.email}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadAssignmentAndHistory}
              title="Refresh assignment"
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-4 px-6 border-b border-slate-200 bg-white">
          <button
            type="button"
            onClick={() => setActiveTab('assignment')}
            className={`flex items-center gap-2 py-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'assignment'
                ? 'border-sky-600 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <GraduationCap className="w-3.5 h-3.5" />
            <span>Authorized Assignment</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('communications')}
            className={`flex items-center gap-2 py-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'communications'
                ? 'border-sky-600 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Communication History</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-slate-100 text-slate-600">
              {communications.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('send_notice')}
            className={`flex items-center gap-2 py-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'send_notice'
                ? 'border-sky-600 text-sky-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>Dispatch Notice</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Status feedback alerts */}
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center justify-between text-rose-900 text-xs">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={loadAssignmentAndHistory}
                className="px-2 py-1 bg-rose-600 text-white rounded font-semibold text-[11px]"
              >
                Retry
              </button>
            </div>
          )}

          {relinkSuccessMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-900 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{relinkSuccessMsg}</span>
            </div>
          )}

          {/* TAB 1: Assignment Overview */}
          {activeTab === 'assignment' && (
            <>
              {isLoading && !details ? (
                <div className="p-8 space-y-4 animate-pulse">
                  <div className="h-6 bg-slate-200 rounded w-1/3" />
                  <div className="h-20 bg-slate-100 rounded" />
                  <div className="h-24 bg-slate-100 rounded" />
                </div>
              ) : details ? (
                <div className="space-y-4">
                  {/* Linked Authorized Student Card */}
                  <div className="p-4 bg-slate-50/80 border border-slate-200 rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <GraduationCap className="w-4 h-4 text-sky-600" />
                        <span className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                          Authorized Student Pairing (1:1 Direct Link)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsRelinking(!isRelinking)}
                        className="text-xs font-semibold text-sky-600 hover:text-sky-700 underline flex items-center gap-1"
                      >
                        <LinkIcon className="w-3 h-3" />
                        {isRelinking ? 'Cancel Re-link' : 'Re-link Student'}
                      </button>
                    </div>

                    {!isRelinking ? (
                      <div className="flex items-center justify-between bg-white p-3 rounded-md border border-slate-200">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900 text-sm">
                              {details.student.fullName}
                            </span>
                            <span className="font-mono text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                              {details.student.admissionNumber}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500">
                            Class {details.student.classGrade} â€¢ Section {details.student.section}
                            {details.student.rollNumber ? ` â€¢ Roll No: ${details.student.rollNumber}` : ''}
                          </div>
                        </div>

                        {onViewStudentDetail && (
                          <button
                            type="button"
                            onClick={() => onViewStudentDetail(details.student.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded"
                          >
                            <span>Student Profile</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ) : (
                      /* Re-link Student Selector */
                      <div className="p-3 bg-white border border-sky-200 rounded-md space-y-3">
                        <div className="text-xs text-slate-600 flex items-start gap-1.5">
                          <Info className="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
                          <span>
                            Select an authorized student from the school roster. Re-linking will update the 1:1 parent pairing and automatically revoke prior tracking tokens.
                          </span>
                        </div>

                        <input
                          type="text"
                          placeholder="Search students by name, admission no, or class..."
                          value={studentSearchTerm}
                          onChange={(e) => setStudentSearchTerm(e.target.value)}
                          className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500"
                        />

                        <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-md">
                          {filteredStudentsForRelink.length === 0 ? (
                            <div className="p-3 text-center text-xs text-slate-400">
                              No matching students found
                            </div>
                          ) : (
                            filteredStudentsForRelink.map((s) => (
                              <label
                                key={s.id}
                                className={`flex items-center justify-between p-2.5 text-xs cursor-pointer transition-colors ${
                                  selectedNewStudentId === s.id ? 'bg-sky-50 font-semibold' : 'hover:bg-slate-50'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <input
                                    type="radio"
                                    name="relink_student"
                                    checked={Boolean(s.id && selectedNewStudentId === s.id)}
                                    onChange={() => {
                                      if (s.id) setSelectedNewStudentId(s.id);
                                    }}
                                    className="text-sky-600"
                                  />
                                  <span>{s.fullName}</span>
                                  <span className="font-mono text-slate-400 text-[11px]">
                                    ({s.admissionNumber})
                                  </span>
                                </div>
                                <span className="text-slate-500 text-[11px]">
                                  {s.classGrade} - {s.section}
                                </span>
                              </label>
                            ))
                          )}
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setIsRelinking(false)}
                            className="px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleConfirmRelink}
                            disabled={!selectedNewStudentId || isRelinkSaving}
                            className="px-3 py-1 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded shadow-2xs"
                          >
                            {isRelinkSaving ? 'Linking...' : 'Confirm Re-link'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Transport Allocation Card */}
                  <div className="p-4 bg-slate-50/80 border border-slate-200 rounded-lg space-y-3">
                    <div className="flex items-center gap-2">
                      <Bus className="w-4 h-4 text-sky-600" />
                      <span className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                        Allocated Fleet & Commute Stops
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white p-3 rounded-md border border-slate-200 text-xs">
                      <div className="space-y-1">
                        <span className="text-slate-500 text-[11px] font-medium">Assigned Bus</span>
                        <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                          {details.transport.busNumber ? (
                            <>
                              <span>Bus {details.transport.busNumber}</span>
                              {details.transport.registrationNumber && (
                                <span className="font-mono text-[11px] text-slate-500">
                                  ({details.transport.registrationNumber})
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-slate-400 italic">No bus allocated</span>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <span className="text-slate-500 text-[11px] font-medium">Route Assignment</span>
                        <div className="font-semibold text-slate-900">
                          {details.transport.routeName ? (
                            <span>
                              {details.transport.routeName}{' '}
                              {details.transport.routeCode && (
                                <span className="font-mono text-[11px] text-slate-500">
                                  ({details.transport.routeCode})
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">No route assigned</span>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1 sm:col-span-2 pt-2 border-t border-slate-100">
                        <span className="text-slate-500 text-[11px] font-medium">Morning Pickup Stop</span>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>{details.transport.pickupStopName || 'Unassigned Stop'}</span>
                          </div>
                          {details.transport.pickupScheduledTime && (
                            <span className="font-mono text-slate-600 flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-400" />
                              {details.transport.pickupScheduledTime}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* WhatsApp Tracking Token Card */}
                  <div className="p-4 bg-slate-50/80 border border-slate-200 rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <KeyRound className="w-4 h-4 text-emerald-600" />
                        <span className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                          WhatsApp Live Tracking Link Status
                        </span>
                      </div>
                      {waUrl && (
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 underline"
                        >
                          <MessageSquare className="w-3 h-3" />
                          Chat on WhatsApp
                        </a>
                      )}
                    </div>

                    <div className="bg-white p-3 rounded-md border border-slate-200 text-xs space-y-3">
                      {details.activeTrackingToken && !details.activeTrackingToken.isRevoked ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                              Active Live Link Token
                            </span>
                            <span className="font-mono text-[11px] text-slate-500">
                              Token Prefix: {details.activeTrackingToken.tokenPrefix}...
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600 flex items-center justify-between">
                            <span>
                              Expires: {new Date(details.activeTrackingToken.expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                            </span>
                            <span className="font-mono">
                              Total Views: {details.activeTrackingToken.accessCount}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-slate-500 text-xs flex items-center justify-between">
                          <span>No live tracking token is currently active. Dispatch an invite to generate one.</span>
                        </div>
                      )}

                      {/* Onboarding invite dispatch button */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-[11px] text-slate-500">
                          {details.activeTrackingToken ? 'Link active (72h validity)' : 'Parent onboarding pending'}
                        </span>

                        <button
                          type="button"
                          onClick={handleSendOnboardingInvite}
                          disabled={isSendingInvite || !parent.phone}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold rounded text-xs shadow-2xs transition-colors"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>{isSendingInvite ? 'Sending...' : 'Send WhatsApp Onboarding Invite'}</span>
                        </button>
                      </div>

                      {/* Invite Result & Copy Link Banner */}
                      {inviteResult && (
                        <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-md space-y-2 text-xs">
                          <div className="flex items-center gap-1.5 text-emerald-900 font-semibold text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span>WhatsApp Invitation Dispatched Successfully</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              readOnly
                              value={inviteResult.inviteUrl}
                              className="flex-1 px-2.5 py-1 text-xs bg-white border border-emerald-300 rounded font-mono text-slate-700"
                            />
                            <button
                              type="button"
                              onClick={() => handleCopyInviteLink(inviteResult.inviteUrl)}
                              className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded text-xs font-semibold flex items-center gap-1 shrink-0"
                            >
                              {copiedLink ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 text-slate-500" />
                                  <span>Copy Link</span>
                                </>
                              )}
                            </button>
                            <a
                              href={inviteResult.inviteUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded"
                              title="Test Live Parent View"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}

          {/* TAB 2: Communication History */}
          {activeTab === 'communications' && (
            <div className="space-y-3">
              {isCommLoading ? (
                <div className="p-8 space-y-3 animate-pulse">
                  <div className="h-4 bg-slate-200 rounded w-1/4" />
                  <div className="h-12 bg-slate-100 rounded" />
                  <div className="h-12 bg-slate-100 rounded" />
                </div>
              ) : communications.length === 0 ? (
                <div className="p-8">
                  <EmptyState
                    icon={MessageSquare}
                    title="No Communication History"
                    description="No notifications or tracking links have been logged for this parent yet. You can dispatch an onboarding welcome notice."
                    actionLabel="Send Welcome Notice"
                    onAction={() => setActiveTab('send_notice')}
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-xs text-slate-500 font-mono flex items-center justify-between px-1">
                    <span>{communications.length} logged communication events</span>
                    <span>Recipient: {parent.phone}</span>
                  </div>

                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden bg-white">
                    {communications.map((item) => {
                      const dateFormatted = new Date(item.createdAt).toLocaleString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      });

                      const getStatusBadge = (status: string) => {
                        switch (status) {
                          case 'DELIVERED':
                          case 'ACTIVE':
                            return (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                                {status}
                              </span>
                            );
                          case 'SENT':
                            return (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-100 text-sky-800">
                                {status}
                              </span>
                            );
                          case 'REVOKED':
                            return (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">
                                {status}
                              </span>
                            );
                          case 'FAILED':
                            return (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-800">
                                {status}
                              </span>
                            );
                          default:
                            return (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                                {status}
                              </span>
                            );
                        }
                      };

                      return (
                        <div key={item.id} className="p-3.5 hover:bg-slate-50/60 transition-colors space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-900">{item.title}</span>
                              <span className="text-[10px] font-mono px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded">
                                {item.channel}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {getStatusBadge(item.status)}
                              <span className="text-[11px] text-slate-400 font-mono">{dateFormatted}</span>
                            </div>
                          </div>

                          <p className="text-xs text-slate-700 leading-relaxed font-sans bg-slate-50/70 p-2 rounded border border-slate-100">
                            {item.messageBody}
                          </p>

                          {item.failureReason && (
                            <div className="text-[11px] text-rose-600 font-medium">
                              Failure: {item.failureReason}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Dispatch Notice Form */}
          {activeTab === 'send_notice' && (
            <form onSubmit={handleSendNoticeSubmit} className="space-y-4">
              {sendNoticeSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-900 text-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{sendNoticeSuccess}</span>
                </div>
              )}

              <div className="p-4 bg-slate-50/80 border border-slate-200 rounded-lg space-y-3">
                <div className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Template Selection
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setNoticeTemplate('WELCOME_ONBOARDING')}
                    className={`p-2.5 text-left rounded-md border text-xs transition-colors ${
                      noticeTemplate === 'WELCOME_ONBOARDING'
                        ? 'border-sky-500 bg-sky-50/60 font-semibold text-sky-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Welcome & Onboarding
                  </button>

                  <button
                    type="button"
                    onClick={() => setNoticeTemplate('LIVE_TRACKING_INVITE')}
                    className={`p-2.5 text-left rounded-md border text-xs transition-colors ${
                      noticeTemplate === 'LIVE_TRACKING_INVITE'
                        ? 'border-sky-500 bg-sky-50/60 font-semibold text-sky-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Live Tracking Invite
                  </button>

                  <button
                    type="button"
                    onClick={() => setNoticeTemplate('DELAY_ALERT')}
                    className={`p-2.5 text-left rounded-md border text-xs transition-colors ${
                      noticeTemplate === 'DELAY_ALERT'
                        ? 'border-sky-500 bg-sky-50/60 font-semibold text-sky-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Route Delay Alert
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  WhatsApp Message Body (Recipient: {parent.phone || 'No phone'})
                </label>
                <textarea
                  rows={4}
                  value={noticeMessage}
                  onChange={(e) => setNoticeMessage(e.target.value)}
                  placeholder="Enter message text to dispatch to the parent..."
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500 font-sans"
                  required
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-[11px] text-slate-400">
                  Channel: WhatsApp Outbound Dispatch Adapter
                </span>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('assignment')}
                    className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded"
                  >
                    Back to Overview
                  </button>
                  <button
                    type="submit"
                    disabled={isSendingNotice || !noticeMessage.trim() || !parent.phone}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-md shadow-xs transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isSendingNotice ? 'Dispatching...' : 'Dispatch WhatsApp Notice'}</span>
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between text-xs">
          <span className="text-slate-400 font-mono">
            Parent ID: {parent.id.slice(0, 8)}...
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md shadow-2xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

