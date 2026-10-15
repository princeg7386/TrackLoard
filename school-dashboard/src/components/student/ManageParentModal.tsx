'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  User,
  Users,
  Phone,
  Mail,
  HeartHandshake,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Trash2,
  MessageCircle,
  ExternalLink,
} from 'lucide-react';
import {
  UpsertParentGuardianRequestSchema,
  StudentWithDetails,
  ParentGuardianRecord,
  normalizeIndianPhoneNumber,
} from '@school-bus/shared';
import {
  upsertStudentParent,
  deleteStudentParent,
  fetchStudentParents,
} from '../../services/studentApi';

interface ManageParentModalProps {
  schoolId: string;
  student: StudentWithDetails | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedStudent: StudentWithDetails) => void;
}

export function ManageParentModal({
  schoolId,
  student,
  isOpen,
  onClose,
  onSuccess,
}: ManageParentModalProps) {
  const [fullName, setFullName] = useState('');
  const [relationship, setRelationship] = useState<'MOTHER' | 'FATHER' | 'GUARDIAN' | 'PARENT'>('FATHER');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');

  const [existingParents, setExistingParents] = useState<ParentGuardianRecord[]>([]);
  const [isLoadingParents, setIsLoadingParents] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (isOpen && student) {
      setFullName(student.parentName || '');
      setRelationship((student.parentRelationship as any) || 'FATHER');
      setPhone(student.parentPhone || '');
      setEmail(student.parentEmail || '');
      setEmergencyPhone(student.emergencyContactPhone || '');
      setFieldErrors({});
      setServerError(null);
      setShowDeleteConfirm(false);
      setIsSuccess(false);

      if (student.id) {
        setIsLoadingParents(true);
        fetchStudentParents(schoolId, student.id)
          .then((parents) => {
            setExistingParents(parents);
            if (parents.length > 0) {
              const primary = parents[0];
              setFullName(primary.fullName);
              setRelationship(primary.relationship);
              setPhone(primary.phone);
              setEmail(primary.email || '');
            }
          })
          .catch((err) => {
            console.error('Failed to load parent data:', err);
          })
          .finally(() => {
            setIsLoadingParents(false);
          });
      }
    }
  }, [isOpen, student, schoolId]);

  if (!isOpen || !student) return null;

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d+]/g, '');
    setPhone(raw);
    if (fieldErrors.phone) {
      setFieldErrors((prev) => ({ ...prev, phone: '' }));
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
    if (!student.id) return;

    setServerError(null);
    setFieldErrors({});

    const formattedPhone = normalizeIndianPhoneNumber(phone.trim());
    const formattedEmergencyPhone = emergencyPhone.trim()
      ? normalizeIndianPhoneNumber(emergencyPhone.trim())
      : undefined;

    const payload = {
      fullName: fullName.trim(),
      relationship,
      phone: formattedPhone,
      email: email.trim() || undefined,
      emergencyContactPhone: formattedEmergencyPhone,
    };

    // Client validation
    const validationResult = UpsertParentGuardianRequestSchema.safeParse(payload);
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
      const updated = await upsertStudentParent(schoolId, student.id, payload);
      setIsSuccess(true);
      setTimeout(() => {
        onSuccess(updated);
        onClose();
      }, 700);
    } catch (err: any) {
      setServerError(err.message || 'Failed to save guardian information.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteParent = async () => {
    if (!student.id || existingParents.length === 0) return;
    const parentToDelete = existingParents[0];

    setIsDeleting(true);
    setServerError(null);

    try {
      await deleteStudentParent(schoolId, student.id, parentToDelete.id);
      const updatedStudent: StudentWithDetails = {
        ...student,
        parentName: null,
        parentPhone: null,
        parentRelationship: null,
        parentEmail: null,
        parentCount: 0,
        parents: [],
      };
      setIsSuccess(true);
      setTimeout(() => {
        onSuccess(updatedStudent);
        onClose();
      }, 600);
    } catch (err: any) {
      setServerError(err.message || 'Failed to remove parent record.');
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">
                Parent & Guardian WhatsApp Link
              </h3>
              <p className="text-[11px] text-slate-300">
                Direct 1:1 parent contact for live tracking links & automated trip alerts
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting || isDeleting}
            className="p-1 text-slate-400 hover:text-white rounded transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Student Banner */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-800 font-bold flex items-center justify-center text-xs shrink-0 border border-sky-200">
                {student.fullName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <span className="font-bold text-slate-900 text-xs truncate block">
                  {student.fullName}
                </span>
                <span className="text-[11px] text-slate-500 font-mono">
                  {student.admissionNumber} â€¢ {student.classGrade} (Sec {student.section})
                </span>
              </div>
            </div>

            {student.pickupStopName ? (
              <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 shrink-0">
                {student.pickupStopName}
              </span>
            ) : (
              <span className="text-[11px] text-slate-400 italic shrink-0">
                No stop assigned
              </span>
            )}
          </div>

          {/* Server Error Alert */}
          {serverError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-rose-900 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold block">Error</strong>
                <span>{serverError}</span>
              </div>
            </div>
          )}

          {/* Success Banner */}
          {isSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-900 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Parent/Guardian contact updated successfully!</span>
            </div>
          )}

          {/* WhatsApp Direct Tracking Info Banner */}
          <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg flex items-start gap-2 text-emerald-950 text-xs">
            <MessageCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-bold block">WhatsApp-First Direct Child Tracking</span>
              <p className="text-[11px] text-emerald-800">
                When trips start, this WhatsApp number receives instant boarding notifications with a secure 1:1 live bus tracking web link. No app download needed for parents.
              </p>
            </div>
          </div>

          {/* Row 1: Guardian Name & Relationship */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Guardian Full Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Guardian Full Name <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Vikram Sharma"
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    if (fieldErrors.fullName) setFieldErrors((prev) => ({ ...prev, fullName: '' }));
                  }}
                  disabled={isSubmitting || isDeleting}
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

            {/* Relationship */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Relationship <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <HeartHandshake className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <select
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value as any)}
                  disabled={isSubmitting || isDeleting}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500 text-slate-800"
                >
                  <option value="FATHER">Father</option>
                  <option value="MOTHER">Mother</option>
                  <option value="GUARDIAN">Guardian</option>
                  <option value="PARENT">Other / Parent</option>
                </select>
              </div>
            </div>
          </div>

          {/* Row 2: WhatsApp Phone & Email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* WhatsApp Mobile Phone */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                WhatsApp Mobile No. <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="tel"
                  required
                  placeholder="e.g. 9876543210"
                  value={phone}
                  onChange={handlePhoneChange}
                  disabled={isSubmitting || isDeleting}
                  className={`w-full pl-9 pr-3 py-2 text-xs font-mono bg-white border rounded-md focus:outline-hidden focus:ring-1 ${
                    fieldErrors.phone
                      ? 'border-rose-300 focus:ring-rose-500 bg-rose-50/20'
                      : 'border-slate-300 focus:ring-sky-500'
                  }`}
                />
              </div>
              {fieldErrors.phone && (
                <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.phone}</p>
              )}
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Guardian Email <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  placeholder="e.g. parent@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: '' }));
                  }}
                  disabled={isSubmitting || isDeleting}
                  className={`w-full pl-9 pr-3 py-2 text-xs bg-white border rounded-md focus:outline-hidden focus:ring-1 ${
                    fieldErrors.email
                      ? 'border-rose-300 focus:ring-rose-500 bg-rose-50/20'
                      : 'border-slate-300 focus:ring-sky-500'
                  }`}
                />
              </div>
              {fieldErrors.email && (
                <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.email}</p>
              )}
            </div>
          </div>

          {/* Row 3: Emergency / Secondary Contact */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Secondary Emergency Contact Phone <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <div className="relative">
              <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="tel"
                placeholder="e.g. 9876543299 (Alternate family/emergency contact)"
                value={emergencyPhone}
                onChange={handleEmergencyPhoneChange}
                disabled={isSubmitting || isDeleting}
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
            <p className="text-[11px] text-slate-400 mt-1">
              This secondary phone will be stored directly on the student record for incident & SOS emergency dispatch.
            </p>
          </div>

          {/* Delete Parent Confirmation Warning */}
          {showDeleteConfirm && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg space-y-2 animate-in fade-in">
              <div className="flex items-start gap-2 text-rose-900 text-xs">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-bold block">Unlink this Guardian?</strong>
                  <span>
                    This student will no longer have automated WhatsApp trip alerts or live tracking access until a new contact is added.
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                  className="px-2.5 py-1 text-xs font-semibold bg-white border border-slate-300 rounded text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteParent}
                  disabled={isDeleting}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded shadow-2xs"
                >
                  {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Confirm Unlink
                </button>
              </div>
            </div>
          )}

          {/* Modal Footer Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
            <div>
              {existingParents.length > 0 && !showDeleteConfirm && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isSubmitting || isDeleting}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded text-xs font-semibold transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Unlink Guardian
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting || isDeleting}
                className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-md text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || isDeleting || isSuccess}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Saving Contact...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Save Guardian
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

