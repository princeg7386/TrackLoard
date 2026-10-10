'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  X,
  Loader2,
  Trash2,
  CheckCircle2,
} from 'lucide-react';
import { StudentWithDetails } from '@school-bus/shared';
import { deleteStudent } from '../../services/studentApi';

interface DeleteStudentDialogProps {
  schoolId: string;
  student: StudentWithDetails | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (deletedStudentId: string) => void;
}

export function DeleteStudentDialog({
  schoolId,
  student,
  isOpen,
  onClose,
  onSuccess,
}: DeleteStudentDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [confirmName, setConfirmName] = useState('');

  if (!isOpen || !student) return null;

  const isConfirmed = confirmName.trim().toLowerCase() === student.fullName.trim().toLowerCase();

  const handleDelete = async () => {
    if (!student?.id || !isConfirmed) return;

    setIsDeleting(true);
    setErrorMessage(null);

    try {
      await deleteStudent(schoolId, student.id);
      setIsSuccess(true);
      setTimeout(() => {
        onSuccess(student.id!);
        onClose();
      }, 700);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to remove student from roster.');
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs overflow-y-auto animate-fadeIn">
      <div className="relative w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-rose-950 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-rose-600 flex items-center justify-center text-white shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold leading-tight">Remove Student Record</h2>
              <p className="text-[11px] text-rose-300">Permanent archival & transport unlinking</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-rose-400 hover:text-white hover:bg-rose-900 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs">
              {errorMessage}
            </div>
          )}

          {isSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-800 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Student record removed successfully!</span>
            </div>
          )}

          <div className="text-xs text-slate-600 space-y-2">
            <p>
              Are you sure you want to remove <strong>{student.fullName}</strong> ({student.admissionNumber})?
            </p>
            <ul className="list-disc pl-4 space-y-1 text-slate-500 text-[11px]">
              <li>Student will be unassigned from all bus routes and pickup stops.</li>
              <li>Linked parent WhatsApp notifications and live tracking links will be revoked.</li>
              <li>Attendance records will be archived in compliance with school transport audit rules.</li>
            </ul>
          </div>

          <div className="pt-2">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Type <span className="font-mono text-rose-600">{student.fullName}</span> to confirm:
            </label>
            <input
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={student.fullName}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-rose-500 font-medium"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/70 rounded-md transition-colors"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleDelete}
            disabled={!isConfirmed || isDeleting}
            className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-md shadow-xs transition-colors"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Removing...
              </>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                Confirm Removal
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
