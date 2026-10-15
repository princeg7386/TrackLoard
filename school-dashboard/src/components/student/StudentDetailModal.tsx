'use client';

import React from 'react';
import {
  X,
  GraduationCap,
  Hash,
  School,
  Phone,
  Bus,
  MapPin,
  Clock,
  Users,
  Edit2,
  Trash2,
  History,
  ShieldCheck,
  AlertCircle,
  Plus,
} from 'lucide-react';
import { StudentWithDetails } from '@school-bus/shared';

interface StudentDetailModalProps {
  student: StudentWithDetails | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (student: StudentWithDetails) => void;
  onAssignTransport: (student: StudentWithDetails) => void;
  onManageParent: (student: StudentWithDetails) => void;
  onViewHistory: (student: StudentWithDetails) => void;
  onDelete: (student: StudentWithDetails) => void;
}

export function StudentDetailModal({
  student,
  isOpen,
  onClose,
  onEdit,
  onAssignTransport,
  onManageParent,
  onViewHistory,
  onDelete,
}: StudentDetailModalProps) {
  if (!isOpen || !student) return null;

  const initials = student.fullName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-2xs animate-fadeIn">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-sky-100 text-sky-800 font-bold flex items-center justify-center text-sm shrink-0 border border-sky-200">
              {initials}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 leading-tight">{student.fullName}</h2>
                <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                  <Hash className="w-3 h-3 text-slate-400" />
                  {student.admissionNumber}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {student.classGrade} - Section {student.section}
                {student.rollNumber ? ` • Roll No: #${student.rollNumber}` : ''}
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
        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          {/* Quick Action Pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                onClose();
                onEdit(student);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-md border border-slate-300 transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5 text-slate-600" />
              Edit Profile
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onAssignTransport(student);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 font-semibold rounded-md border border-sky-300 transition-colors"
            >
              <Bus className="w-3.5 h-3.5 text-sky-600" />
              Transport Allocation
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onManageParent(student);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-md border border-indigo-300 transition-colors"
            >
              <Users className="w-3.5 h-3.5 text-indigo-600" />
              Parent WhatsApp
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onViewHistory(student);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold rounded-md border border-emerald-300 transition-colors"
            >
              <History className="w-3.5 h-3.5 text-emerald-600" />
              Attendance History
            </button>
          </div>

          {/* Transport Allocation Section */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Bus className="w-3.5 h-3.5 text-sky-600" />
                Bus Transport Details
              </span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                  student.transportStatus === 'ASSIGNED'
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {student.transportStatus === 'ASSIGNED' ? 'Assigned' : 'Unassigned / Self Commute'}
              </span>
            </div>

            {student.pickupStopName ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="p-2.5 bg-white rounded border border-slate-200 space-y-1">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase">Morning Pickup</span>
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                    <MapPin className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span>{student.pickupStopName}</span>
                  </div>
                  {student.pickupScheduledTime && (
                    <div className="flex items-center gap-1 font-mono text-[11px] text-slate-500">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>{student.pickupScheduledTime} AM</span>
                    </div>
                  )}
                </div>

                <div className="p-2.5 bg-white rounded border border-slate-200 space-y-1">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase">Assigned Fleet Bus</span>
                  {student.assignedBusNumber ? (
                    <>
                      <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                        <Bus className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                        <span>Bus {student.assignedBusNumber}</span>
                      </div>
                      {student.assignedBusRegistrationNumber && (
                        <span className="text-[11px] font-mono text-slate-500 block">
                          Reg: {student.assignedBusRegistrationNumber}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-slate-400 italic text-[11px]">No bus assigned to route</span>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-slate-500 text-[11px] italic">
                Student is currently marked as Self Commute. You can allocate them to a bus route and stop using the Transport Allocation action.
              </p>
            )}
          </div>

          {/* Parent / Guardian WhatsApp Contact */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-indigo-600" />
                Parent & Emergency Contacts
              </span>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onManageParent(student);
                }}
                className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold hover:underline"
              >
                {student.parentPhone ? 'Manage Parent' : 'Link Parent'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* WhatsApp Contact */}
              <div className="p-2.5 bg-white rounded border border-slate-200 space-y-1">
                <span className="text-[10px] text-slate-400 font-semibold uppercase">Parent WhatsApp</span>
                {student.parentPhone ? (
                  <>
                    <p className="font-semibold text-slate-800">
                      {student.parentName || 'Parent'}
                      {student.parentRelationship ? ` (${student.parentRelationship.toLowerCase()})` : ''}
                    </p>
                    <div className="flex items-center gap-1 font-mono text-[11px] text-emerald-700">
                      <Phone className="w-3 h-3 text-emerald-600" />
                      <span>{student.parentPhone}</span>
                    </div>
                  </>
                ) : (
                  <span className="text-amber-600 text-[11px] italic">Not linked yet</span>
                )}
              </div>

              {/* Emergency Contact */}
              <div className="p-2.5 bg-white rounded border border-slate-200 space-y-1">
                <span className="text-[10px] text-slate-400 font-semibold uppercase">Emergency Contact</span>
                {student.emergencyContactPhone ? (
                  <>
                    <p className="font-semibold text-slate-800">School Dispatch Fallback</p>
                    <div className="flex items-center gap-1 font-mono text-[11px] text-slate-600">
                      <Phone className="w-3 h-3 text-slate-500" />
                      <span>{student.emergencyContactPhone}</span>
                    </div>
                  </>
                ) : (
                  <span className="text-slate-400 text-[11px] italic">Not provided</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              onClose();
              onDelete(student);
            }}
            className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-800 hover:underline"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove Student
          </button>

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

