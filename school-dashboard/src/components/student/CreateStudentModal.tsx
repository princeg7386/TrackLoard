'use client';

import React, { useState } from 'react';
import {
  X,
  User,
  GraduationCap,
  Layers,
  Hash,
  Phone,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  BookOpen,
} from 'lucide-react';
import {
  CreateStudentRequestSchema,
  StudentWithDetails,
  normalizeIndianPhoneNumber,
} from '@school-bus/shared';
import { createStudent } from '../../services/studentApi';

interface CreateStudentModalProps {
  schoolId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newStudent: StudentWithDetails) => void;
}

const CLASS_GRADE_OPTIONS = [
  'Nursery',
  'LKG',
  'UKG',
  'Class 1',
  'Class 2',
  'Class 3',
  'Class 4',
  'Class 5',
  'Class 6',
  'Class 7',
  'Class 8',
  'Class 9',
  'Class 10',
  'Class 11',
  'Class 12',
];

const SECTION_OPTIONS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function CreateStudentModal({
  schoolId,
  isOpen,
  onClose,
  onSuccess,
}: CreateStudentModalProps) {
  const [fullName, setFullName] = useState('');
  const [admissionNumber, setAdmissionNumber] = useState('');
  const [classGrade, setClassGrade] = useState('Class 1');
  const [customClassGrade, setCustomClassGrade] = useState('');
  const [isCustomClass, setIsCustomClass] = useState(false);
  const [section, setSection] = useState('A');
  const [customSection, setCustomSection] = useState('');
  const [isCustomSection, setIsCustomSection] = useState(false);
  const [rollNumber, setRollNumber] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  if (!isOpen) return null;

  const resetForm = () => {
    setFullName('');
    setAdmissionNumber('');
    setClassGrade('Class 1');
    setCustomClassGrade('');
    setIsCustomClass(false);
    setSection('A');
    setCustomSection('');
    setIsCustomSection(false);
    setRollNumber('');
    setEmergencyPhone('');
    setFieldErrors({});
    setServerError(null);
    setIsSuccess(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleAdmissionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.toUpperCase();
    setAdmissionNumber(raw);
    if (fieldErrors.admissionNumber) {
      setFieldErrors((prev) => ({ ...prev, admissionNumber: '' }));
    }
  };

  const handleEmergencyPhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d+]/g, '');
    setEmergencyPhone(raw);
    if (fieldErrors.emergencyContactPhone) {
      setFieldErrors((prev) => ({ ...prev, emergencyContactPhone: '' }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setFieldErrors({});

    const effectiveClass = isCustomClass ? customClassGrade.trim() : classGrade.trim();
    const effectiveSection = isCustomSection ? customSection.trim().toUpperCase() : section.trim().toUpperCase();
    const formattedPhone = emergencyPhone.trim() ? normalizeIndianPhoneNumber(emergencyPhone.trim()) : undefined;

    const payload = {
      fullName: fullName.trim(),
      admissionNumber: admissionNumber.trim().toUpperCase(),
      classGrade: effectiveClass,
      section: effectiveSection,
      rollNumber: rollNumber.trim() || undefined,
      emergencyContactPhone: formattedPhone,
    };

    // Client-side schema validation
    const validationResult = CreateStudentRequestSchema.safeParse(payload);
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
      const newStudent = await createStudent(schoolId, payload);
      setIsSuccess(true);
      setTimeout(() => {
        onSuccess(newStudent);
        handleClose();
      }, 700);
    } catch (err: any) {
      setServerError(err.message || 'Failed to register student. Please verify all details.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center text-white shrink-0">
              <GraduationCap className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">Register New Student</h3>
              <p className="text-[11px] text-slate-300">
                Add student to school roster for transport allocation and live parent tracking
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="p-1 text-slate-400 hover:text-white rounded transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Server Error Alert */}
          {serverError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-rose-900 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold block">Registration Error</strong>
                <span>{serverError}</span>
              </div>
            </div>
          )}

          {/* Success Banner */}
          {isSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-900 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Student registered successfully! Adding to roster...</span>
            </div>
          )}

          {/* Row 1: Student Full Name & Admission Number (Student ID) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Student Full Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Student Full Name <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Aarav Sharma"
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    if (fieldErrors.fullName) {
                      setFieldErrors((prev) => ({ ...prev, fullName: '' }));
                    }
                  }}
                  disabled={isSubmitting}
                  className={`w-full pl-9 pr-3 py-2 text-xs bg-white border rounded-md focus:outline-hidden focus:ring-1 ${
                    fieldErrors.fullName
                      ? 'border-rose-300 focus:ring-rose-500 bg-rose-50/20'
                      : 'border-slate-300 focus:ring-sky-500'
                  }`}
                />
              </div>
              {fieldErrors.fullName && (
                <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.fullName}</p>
              )}
            </div>

            {/* Admission Number / Student ID */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Student ID / Admission No. <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Hash className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="e.g. ADM-2026-0042"
                  value={admissionNumber}
                  onChange={handleAdmissionChange}
                  disabled={isSubmitting}
                  className={`w-full pl-9 pr-3 py-2 text-xs font-mono uppercase bg-white border rounded-md focus:outline-hidden focus:ring-1 ${
                    fieldErrors.admissionNumber
                      ? 'border-rose-300 focus:ring-rose-500 bg-rose-50/20'
                      : 'border-slate-300 focus:ring-sky-500'
                  }`}
                />
              </div>
              {fieldErrors.admissionNumber && (
                <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.admissionNumber}</p>
              )}
            </div>
          </div>

          {/* Row 2: Class / Grade & Section */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Class / Grade */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Class / Grade <span className="text-rose-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setIsCustomClass(!isCustomClass)}
                  className="text-[10px] text-sky-600 hover:underline font-medium"
                >
                  {isCustomClass ? 'Select from list' : '+ Custom Grade'}
                </button>
              </div>

              <div className="relative">
                <BookOpen className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                {isCustomClass ? (
                  <input
                    type="text"
                    required
                    placeholder="e.g. Grade 11 Science"
                    value={customClassGrade}
                    onChange={(e) => {
                      setCustomClassGrade(e.target.value);
                      if (fieldErrors.classGrade) setFieldErrors((prev) => ({ ...prev, classGrade: '' }));
                    }}
                    disabled={isSubmitting}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500"
                  />
                ) : (
                  <select
                    value={classGrade}
                    onChange={(e) => setClassGrade(e.target.value)}
                    disabled={isSubmitting}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500 text-slate-800"
                  >
                    {CLASS_GRADE_OPTIONS.map((cg) => (
                      <option key={cg} value={cg}>
                        {cg}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {fieldErrors.classGrade && (
                <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.classGrade}</p>
              )}
            </div>

            {/* Section */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Section <span className="text-rose-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setIsCustomSection(!isCustomSection)}
                  className="text-[10px] text-sky-600 hover:underline font-medium"
                >
                  {isCustomSection ? 'Select standard' : '+ Custom'}
                </button>
              </div>

              <div className="relative">
                <Layers className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                {isCustomSection ? (
                  <input
                    type="text"
                    required
                    placeholder="e.g. Alpha"
                    value={customSection}
                    onChange={(e) => {
                      setCustomSection(e.target.value);
                      if (fieldErrors.section) setFieldErrors((prev) => ({ ...prev, section: '' }));
                    }}
                    disabled={isSubmitting}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500 uppercase"
                  />
                ) : (
                  <select
                    value={section}
                    onChange={(e) => setSection(e.target.value)}
                    disabled={isSubmitting}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500 text-slate-800"
                  >
                    {SECTION_OPTIONS.map((sec) => (
                      <option key={sec} value={sec}>
                        Section {sec}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {fieldErrors.section && (
                <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.section}</p>
              )}
            </div>
          </div>

          {/* Row 3: Roll Number & Emergency Contact Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Roll Number */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Roll Number <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <div className="relative">
                <Hash className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="e.g. 14"
                  value={rollNumber}
                  onChange={(e) => setRollNumber(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full pl-9 pr-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>

            {/* Emergency Contact Phone */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Emergency Phone <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="tel"
                  placeholder="e.g. 9876543210"
                  value={emergencyPhone}
                  onChange={handleEmergencyPhoneChange}
                  disabled={isSubmitting}
                  className={`w-full pl-9 pr-3 py-2 text-xs font-mono bg-white border rounded-md focus:outline-hidden focus:ring-1 ${
                    fieldErrors.emergencyContactPhone
                      ? 'border-rose-300 focus:ring-rose-500 bg-rose-50/20'
                      : 'border-slate-300 focus:ring-sky-500'
                  }`}
                />
              </div>
              {fieldErrors.emergencyContactPhone && (
                <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.emergencyContactPhone}</p>
              )}
            </div>
          </div>

          <p className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded border border-slate-200">
            Note: After registration, you can allocate the student to a bus pickup/drop stop and link parent WhatsApp contacts.
          </p>

          {/* Modal Footer Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-md text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isSuccess}
              className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-md text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Registering Student...
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  Register Student
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
