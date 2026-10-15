'use client';

import React from 'react';
import {
  GraduationCap,
  Plus,
  Phone,
  MapPin,
  Users,
  Bus,
  Hash,
  ChevronRight,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { StudentWithDetails } from '@school-bus/shared';
import { EmptyState } from '../ui/EmptyState';

interface StudentListTableProps {
  students: StudentWithDetails[];
  isLoading: boolean;
  onAddStudent: () => void;
  onViewDetail?: (student: StudentWithDetails) => void;
  onManageParent?: (student: StudentWithDetails) => void;
  onAssignTransport?: (student: StudentWithDetails) => void;
}

export function StudentListTable({
  students,
  isLoading,
  onAddStudent,
  onViewDetail,
  onManageParent,
  onAssignTransport,
}: StudentListTableProps) {

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 animate-pulse">
            <div className="w-10 h-10 rounded-full bg-slate-200 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-slate-200 rounded w-1/4" />
              <div className="h-3 bg-slate-200 rounded w-1/3" />
            </div>
            <div className="h-6 bg-slate-200 rounded w-20" />
            <div className="h-6 bg-slate-200 rounded w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <div className="p-12">
        <EmptyState
          icon={GraduationCap}
          title="No Students Registered"
          description="Register students into your school roster. You can allocate them to bus pickup stops and connect parent WhatsApp numbers for live tracking."
          actionLabel="Add First Student"
          onAction={onAddStudent}
        />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
            <th className="py-3 px-4">Student & Roll No</th>
            <th className="py-3 px-4">Student ID / Adm. No</th>
            <th className="py-3 px-4">Class & Section</th>
            <th className="py-3 px-4">Emergency Contact</th>
            <th className="py-3 px-4">Transport Allocation</th>
            <th className="py-3 px-4">Parent WhatsApp</th>
            <th className="py-3 px-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {students.map((student) => {
            const initials = student.fullName
              .split(' ')
              .map((n) => n[0])
              .join('')
              .toUpperCase()
              .slice(0, 2);

            return (
              <tr
                key={student.id}
                className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                onClick={() => onViewDetail && onViewDetail(student)}
              >
                {/* 1. Student Name & Roll No */}
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-800 font-bold flex items-center justify-center text-xs shrink-0 border border-sky-200">
                      {initials}
                    </div>
                    <div>
                      <span className="font-bold text-slate-900 group-hover:text-sky-600 transition-colors block">
                        {student.fullName}
                      </span>
                      {student.rollNumber ? (
                        <span className="text-[11px] text-slate-500 font-mono">
                          Roll No: #{student.rollNumber}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400 italic">No roll no</span>
                      )}
                    </div>
                  </div>
                </td>

                {/* 2. Admission Number / Student ID */}
                <td className="py-3 px-4">
                  <span className="inline-flex items-center gap-1 font-mono font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                    <Hash className="w-3 h-3 text-slate-400" />
                    {student.admissionNumber}
                  </span>
                </td>

                {/* 3. Class & Section */}
                <td className="py-3 px-4">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    {student.classGrade} - Sec {student.section}
                  </span>
                </td>

                {/* 4. Emergency Contact */}
                <td className="py-3 px-4 font-mono text-slate-600">
                  {student.emergencyContactPhone ? (
                    <div className="flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{student.emergencyContactPhone}</span>
                    </div>
                  ) : (
                    <span className="text-slate-400 italic text-[11px]">Not provided</span>
                  )}
                </td>

                {/* 5. Transport Allocation */}
                <td className="py-3 px-4" onClick={(e) => {
                  if (onAssignTransport) {
                    e.stopPropagation();
                    onAssignTransport(student);
                  }
                }}>
                  {student.pickupStopName ? (
                    <div className="space-y-0.5 hover:opacity-85 transition-opacity">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                        <MapPin className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span className="truncate max-w-[140px]">{student.pickupStopName}</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {student.assignedBusNumber ? (
                          <span className="text-[10px] font-mono font-bold text-sky-700 bg-sky-50 px-1.5 py-0.2 rounded border border-sky-200">
                            {student.assignedBusNumber}
                          </span>
                        ) : null}
                        {student.pickupScheduledTime && (
                          <span className="text-[10px] text-slate-500 font-mono">
                            {student.pickupScheduledTime} AM
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onAssignTransport) onAssignTransport(student);
                      }}
                      className="inline-flex items-center gap-1 text-[11px] text-slate-600 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded border border-slate-300 transition-colors font-medium"
                    >
                      <Plus className="w-3 h-3" />
                      Assign Bus
                    </button>
                  )}
                </td>

                {/* 6. Parent WhatsApp */}
                <td className="py-3 px-4" onClick={(e) => {
                  if (onManageParent) {
                    e.stopPropagation();
                    onManageParent(student);
                  }
                }}>
                  {student.parentPhone ? (
                    <div className="space-y-0.5 hover:opacity-80 transition-opacity">
                      <div className="flex items-center gap-1">
                        <span className="font-semibold text-slate-800">
                          {student.parentName || 'Parent'}
                        </span>
                        {student.parentRelationship && (
                          <span className="text-[10px] text-slate-500 font-normal">
                            ({student.parentRelationship.toLowerCase()})
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] font-mono text-emerald-700 flex items-center gap-1">
                        <Phone className="w-3 h-3 text-emerald-600" />
                        {student.parentPhone}
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onManageParent) onManageParent(student);
                      }}
                      className="inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 hover:bg-amber-100 px-2 py-0.5 rounded border border-amber-200 transition-colors font-medium"
                    >
                      <Plus className="w-3 h-3" />
                      Link Parent
                    </button>
                  )}
                </td>

                {/* 7. Actions */}
                <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => onAssignTransport && onAssignTransport(student)}
                      title="Assign or Update Bus and Pickup Stop"
                      className="inline-flex items-center gap-1 px-2 py-1 text-slate-600 hover:text-sky-600 hover:bg-sky-50 rounded border border-slate-200 hover:border-sky-300 text-xs font-semibold transition-colors"
                    >
                      <Bus className="w-3.5 h-3.5" />
                      Transport
                    </button>

                    <button
                      type="button"
                      onClick={() => onManageParent && onManageParent(student)}
                      title="Manage Parent WhatsApp & Emergency Contacts"
                      className="inline-flex items-center gap-1 px-2 py-1 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded border border-slate-200 hover:border-indigo-300 text-xs font-semibold transition-colors"
                    >
                      <Users className="w-3.5 h-3.5" />
                      Parent
                    </button>

                    <button
                      type="button"
                      onClick={() => onViewDetail && onViewDetail(student)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-slate-600 hover:text-sky-600 hover:bg-sky-50 rounded border border-slate-200 hover:border-sky-300 text-xs font-semibold transition-colors"
                    >
                      Details
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

