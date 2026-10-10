'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  User,
  Hash,
  School,
  Phone,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Edit2,
  ShieldCheck,
} from 'lucide-react';
import {
  UpdateStudentRequestSchema,
  StudentWithDetails,
  normalizeIndianPhoneNumber,
} from '@school-bus/shared';
import { updateStudent } from '../../services/studentApi';

interface EditStudentModalProps {
  schoolId: string;
  student: StudentWithDetails | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedStudent: StudentWithDetails) => void;
}

export function EditStudentModal({
  schoolId,
  student,
  isOpen,
  onClose,
  onSuccess,
}: EditStudentModalProps) {
  const [fullName, setFullName] = useState('');
  const [admissionNumber, setAdmissionNumber] = useState('');
  const [classGrade, setClassGrade] = useState('');
  const [section, setSection] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (isOpen && student) {
      setFullName(student.fullName || '');
      setAdmissionNumber(student.admissionNumber || '');
      setClassGrade(student.classGrade || '');
      setSection(student.section || '');
      setRollNumber(student.rollNumber || '');
      setEmergencyPhone(student.emergencyContactPhone || '');
      setFieldErrors({});
      setServerError(null);
      setIsSuccess(false);
    }
  }, [isOpen, student]);

  if (!isOpen || !student) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!student?.id || !schoolId) return;

    setServerError(null);
    setFieldErrors({});

    const formattedEmergency = emergencyPhone.trim()
      ? normalizeIndianPhoneNumber(emergencyPhone.trim())
      : '';

    const payload = {
      fullName: fullName.trim(),
      admissionNumber: admissionNumber.trim().toUpperCase(),
      classGrade: classGrade.trim(),
      section: section.trim().toUpperCase(),
      rollNumber: rollNumber.trim() || undefined,
      emergencyContactPhone: formattedEmergency || undefined,
    };

    // Client-side validation
    const validationResult = UpdateStudentRequestSchema.safeParse(payload);
    if (!validationResult.success) {
      const errors: Record<string, string> = {};
      for (const err of validationResult.error.errors) {
        const path = err.path[0] as string;
        if (!errors[path]) {
          errors[path] = err.message;
        }
      }
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);

    try {
      const updated = await updateStudent(schoolId, student.id, payload);
      setIsSuccess(true);
      setTimeout(() => {
        onSuccess(updated);
        onClose();
      }, 700);
    } catch (err: any) {
      setServerError(err.message || 'Failed to update student profile.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-2xs animate-fadeIn">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center font-bold">
              <Edit2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 leading-tight">Edit Student Record</h2>
              <p className="text-xs text-slate-500">Update academic registration and emergency contacts</p>
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

        {/* Form Body */}
        <form id="editStudentForm" onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {serverError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-rose-800 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          {isSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-800 text-xs">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Student record updated successfully!</span>
            </div>
          )}

          {/* Full Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Full Legal Name <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (fieldErrors.fullName) setFieldErrors((prev) => ({ ...prev, fullName: '' }));
                }}
                placeholder="e.g. Aarav Sharma"
                className={`w-full pl-9 pr-3 py-2 text-xs bg-white border rounded-lg focus:outline-hidden focus:ring-1 font-medium ${
                  fieldErrors.fullName ? 'border-rose-400 focus:ring-rose-500' : 'border-slate-300 focus:ring-sky-500'
                }`}
              />
            </div>
            {fieldErrors.fullName && <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.fullName}</p>}
          </div>

          {/* Admission ID & Roll No */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Student ID / Adm. No <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Hash className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={admissionNumber}
                  onChange={(e) => {
                    setAdmissionNumber(e.target.value);
                    if (fieldErrors.admissionNumber) setFieldErrors((prev) => ({ ...prev, admissionNumber: '' }));
                  }}
                  placeholder="e.g. ADM-2026-0042"
                  className={`w-full pl-9 pr-3 py-2 text-xs bg-white border rounded-lg focus:outline-hidden focus:ring-1 font-mono uppercase ${
                    fieldErrors.admissionNumber ? 'border-rose-400 focus:ring-rose-500' : 'border-slate-300 focus:ring-sky-500'
                  }`}
                />
              </div>
              {fieldErrors.admissionNumber && <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.admissionNumber}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Class Roll Number <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                value={rollNumber}
                onChange={(e) => setRollNumber(e.target.value)}
                placeholder="e.g. 14"
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-sky-500 font-mono"
              />
            </div>
          </div>

          {/* Class Grade & Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Class / Grade <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <School className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={classGrade}
                  onChange={(e) => {
                    setClassGrade(e.target.value);
                    if (fieldErrors.classGrade) setFieldErrors((prev) => ({ ...prev, classGrade: '' }));
                  }}
                  placeholder="e.g. Class 5"
                  className={`w-full pl-9 pr-3 py-2 text-xs bg-white border rounded-lg focus:outline-hidden focus:ring-1 font-medium ${
                    fieldErrors.classGrade ? 'border-rose-400 focus:ring-rose-500' : 'border-slate-300 focus:ring-sky-500'
                  }`}
                />
              </div>
              {fieldErrors.classGrade && <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.classGrade}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Section <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={section}
                onChange={(e) => {
                  setSection(e.target.value);
                  if (fieldErrors.section) setFieldErrors((prev) => ({ ...prev, section: '' }));
                }}
                placeholder="e.g. A"
                className={`w-full px-3 py-2 text-xs bg-white border rounded-lg focus:outline-hidden focus:ring-1 uppercase font-semibold ${
                  fieldErrors.section ? 'border-rose-400 focus:ring-rose-500' : 'border-slate-300 focus:ring-sky-500'
                }`}
              />
              {fieldErrors.section && <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.section}</p>}
            </div>
          </div>

          {/* Emergency Contact */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Emergency Contact Mobile Phone
            </label>
            <div className="relative">
              <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="tel"
                value={emergencyPhone}
                onChange={(e) => {
                  setEmergencyPhone(e.target.value);
                  if (fieldErrors.emergencyContactPhone) {
                    setFieldErrors((prev) => ({ ...prev, emergencyContactPhone: '' }));
                  }
                }}
                placeholder="e.g. 9876543299"
                className={`w-full pl-9 pr-3 py-2 text-xs bg-white border rounded-lg focus:outline-hidden focus:ring-1 font-mono ${
                  fieldErrors.emergencyContactPhone
                    ? 'border-rose-400 focus:ring-rose-500'
                    : 'border-slate-300 focus:ring-sky-500'
                }`}
              />
            </div>
            {fieldErrors.emergencyContactPhone && (
              <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.emergencyContactPhone}</p>
            )}
            <p className="text-[11px] text-slate-400 mt-1">
              Primary fallback contact for transport emergencies and school coordinator alerts.
            </p>
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/70 rounded-md transition-colors"
          >
            Cancel
          </button>

          <button
            type="submit"
            form="editStudentForm"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white text-xs font-semibold rounded-md shadow-xs transition-colors"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Saving Changes...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
