'use client';

import React from 'react';
import {
  Users,
  Phone,
  MessageSquare,
  GraduationCap,
  Bus,
  MapPin,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Clock,
  KeyRound,
} from 'lucide-react';
import { ParentRecordWithStudent } from '@school-bus/shared';
import { EmptyState } from '../ui/EmptyState';

interface ParentListTableProps {
  parents: ParentRecordWithStudent[];
  isLoading: boolean;
  onRefresh?: () => void;
  onManageParent?: (parent: ParentRecordWithStudent) => void;
  onViewStudent?: (studentId: string) => void;
}

export function ParentListTable({
  parents,
  isLoading,
  onRefresh,
  onManageParent,
  onViewStudent,
}: ParentListTableProps) {
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

  if (parents.length === 0) {
    return (
      <div className="p-12">
        <EmptyState
          icon={Users}
          title="No Parent & WhatsApp Records Found"
          description="Parents registered with students will appear here with real-time WhatsApp token status, direct chat shortcuts, and linked transport details."
          actionLabel="Refresh Directory"
          onAction={onRefresh}
        />
      </div>
    );
  }

  const getRelationshipBadge = (relationship: string) => {
    const relUpper = relationship.toUpperCase();
    switch (relUpper) {
      case 'MOTHER':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-200">
            Mother
          </span>
        );
      case 'FATHER':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-50 text-sky-700 border border-sky-200">
            Father
          </span>
        );
      case 'GUARDIAN':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            Guardian
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
            {relationship}
          </span>
        );
    }
  };

  const getWhatsAppStatusBadge = (status: 'ACTIVE_TOKEN' | 'LINKED' | 'NOT_LINKED', activeCount: number) => {
    switch (status) {
      case 'ACTIVE_TOKEN':
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200 w-fit">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
              Live Tracking Active
            </span>
            <span className="text-[10px] text-emerald-700 font-mono">
              {activeCount} active token link{activeCount > 1 ? 's' : ''}
            </span>
          </div>
        );
      case 'LINKED':
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-100 text-sky-800 border border-sky-200 w-fit">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
              WhatsApp Linked
            </span>
            <span className="text-[10px] text-slate-400">Ready for trip dispatch</span>
          </div>
        );
      case 'NOT_LINKED':
      default:
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 w-fit">
              <AlertCircle className="w-3 h-3 text-amber-500" />
              No Phone Linked
            </span>
            <span className="text-[10px] text-amber-600">Update contact</span>
          </div>
        );
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
            <th className="py-3 px-4">Parent / Guardian</th>
            <th className="py-3 px-4">Mobile & WhatsApp</th>
            <th className="py-3 px-4">WhatsApp Status</th>
            <th className="py-3 px-4">Linked Student</th>
            <th className="py-3 px-4">Transport Allocation</th>
            <th className="py-3 px-4 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {parents.map((parent) => {
            const initials = parent.fullName
              .split(' ')
              .map((n) => n[0])
              .join('')
              .toUpperCase()
              .slice(0, 2);

            const cleanPhone = parent.phone ? parent.phone.replace(/[^0-9]/g, '') : '';
            const waUrl = cleanPhone ? `https://wa.me/${cleanPhone}` : null;

            return (
              <tr
                key={parent.id}
                className="hover:bg-slate-50/80 transition-colors group"
              >
                {/* 1. Parent Name & Relationship */}
                <td className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-slate-700 text-xs shrink-0">
                      {initials}
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900 flex items-center gap-2">
                        {parent.fullName}
                        {getRelationshipBadge(parent.relationship)}
                      </div>
                      {parent.email && (
                        <div className="text-[11px] text-slate-400 truncate max-w-[180px]">
                          {parent.email}
                        </div>
                      )}
                    </div>
                  </div>
                </td>

                {/* 2. Mobile & WhatsApp Direct Action */}
                <td className="py-3 px-4">
                  {parent.phone ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-800 text-xs">
                        {parent.phone}
                      </span>
                      {waUrl && (
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open WhatsApp Chat"
                          className="p-1 rounded text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  ) : (
                    <span className="text-slate-400 italic">No mobile registered</span>
                  )}
                </td>

                {/* 3. WhatsApp Tracking Status */}
                <td className="py-3 px-4">
                  {getWhatsAppStatusBadge(parent.whatsAppStatus, parent.activeTokenCount)}
                </td>

                {/* 4. Linked Student (1:1 Direct Context) */}
                <td className="py-3 px-4">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <GraduationCap className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <button
                        type="button"
                        onClick={() => onViewStudent && onViewStudent(parent.student.id)}
                        className="font-medium text-slate-800 hover:text-sky-600 text-left transition-colors"
                      >
                        {parent.student.fullName}
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono flex items-center gap-2">
                      <span>{parent.student.admissionNumber}</span>
                      <span>•</span>
                      <span>
                        {parent.student.classGrade} - {parent.student.section}
                      </span>
                    </div>
                  </div>
                </td>

                {/* 5. Transport Allocation */}
                <td className="py-3 px-4">
                  {parent.student.assignedBusNumber ? (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 font-medium text-slate-800">
                        <Bus className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                        <span>Bus {parent.student.assignedBusNumber}</span>
                        {parent.student.assignedRouteCode && (
                          <span className="text-[10px] text-slate-400 font-mono">
                            ({parent.student.assignedRouteCode})
                          </span>
                        )}
                      </div>
                      {parent.student.pickupStopName && (
                        <div className="flex items-center gap-1 text-[11px] text-slate-500">
                          <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="truncate max-w-[150px]">
                            {parent.student.pickupStopName}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-400 italic">
                      No transport assigned
                    </span>
                  )}
                </td>

                {/* 6. Quick Actions */}
                <td className="py-3 px-4 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {onManageParent && (
                      <button
                        type="button"
                        onClick={() => onManageParent(parent)}
                        className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded shadow-2xs transition-colors"
                      >
                        Edit Contact
                      </button>
                    )}
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
