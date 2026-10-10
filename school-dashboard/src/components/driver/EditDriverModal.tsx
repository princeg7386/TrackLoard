'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  User,
  Phone,
  FileBadge,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Camera,
  Edit2,
} from 'lucide-react';
import {
  UpdateDriverRequestSchema,
  normalizeIndianPhoneNumber,
  DriverWithBus,
} from '@school-bus/shared';
import { updateDriverProfile } from '../../services/driverApi';

interface EditDriverModalProps {
  schoolId: string;
  driver: DriverWithBus | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedDriver: DriverWithBus) => void;
}

const PRESET_AVATARS = [
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&auto=format&fit=crop&q=80',
];

export function EditDriverModal({
  schoolId,
  driver,
  isOpen,
  onClose,
  onSuccess,
}: EditDriverModalProps) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (isOpen && driver) {
      setFullName(driver.fullName || '');
      setPhone(driver.phone || '');
      setLicenseNumber(driver.licenseNumber || '');
      setLicenseExpiry(driver.licenseExpiry || '');
      setPhotoUrl(driver.photoUrl || '');
      setFieldErrors({});
      setServerError(null);
      setIsSuccess(false);
    }
  }, [isOpen, driver]);

  if (!isOpen || !driver) return null;

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d+]/g, '');
    setPhone(raw);
    if (fieldErrors.phone) setFieldErrors((prev) => ({ ...prev, phone: '' }));
  };

  const handleLicenseChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.toUpperCase();
    setLicenseNumber(raw);
    if (fieldErrors.licenseNumber) setFieldErrors((prev) => ({ ...prev, licenseNumber: '' }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setFieldErrors({});

    const formattedPhone = normalizeIndianPhoneNumber(phone);

    const payload = {
      fullName: fullName.trim(),
      phone: formattedPhone,
      licenseNumber: licenseNumber.trim().toUpperCase(),
      licenseExpiry: licenseExpiry.trim() || undefined,
      photoUrl: photoUrl.trim() || undefined,
    };

    // Client-side schema validation
    const validationResult = UpdateDriverRequestSchema.safeParse(payload);
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

    if (!driver.id) {
      setServerError('Driver ID is missing.');
      return;
    }

    setIsSubmitting(true);

    try {
      const updated = await updateDriverProfile(schoolId, driver.id, payload);
      setIsSuccess(true);
      setTimeout(() => {
        onSuccess(updated);
        onClose();
      }, 700);
    } catch (err: any) {
      setServerError(err.message || 'Failed to update driver profile.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center text-white shrink-0">
              <Edit2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight">
                Edit Driver Profile
              </h3>
              <p className="text-[11px] text-slate-300">
                Update name, mobile number, license credentials & photo
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1 text-slate-400 hover:text-white rounded transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body / Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Server Error Banner */}
          {serverError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-rose-900 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold block">Update Error</strong>
                <span>{serverError}</span>
              </div>
            </div>
          )}

          {/* Success Banner */}
          {isSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-900 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Driver profile updated successfully! Syncing directory...</span>
            </div>
          )}

          {/* Row 1: Full Name & Mobile Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Full Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Driver Full Name <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Kumar"
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    if (fieldErrors.fullName) setFieldErrors((prev) => ({ ...prev, fullName: '' }));
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

            {/* Mobile Phone */}
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
                  disabled={isSubmitting}
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
          </div>

          {/* Row 2: Driving License & Expiry */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* License Number */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Driving License Number <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <FileBadge className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="e.g. DL-1420110012345"
                  value={licenseNumber}
                  onChange={handleLicenseChange}
                  disabled={isSubmitting}
                  className={`w-full pl-9 pr-3 py-2 text-xs font-mono uppercase bg-white border rounded-md focus:outline-hidden focus:ring-1 ${
                    fieldErrors.licenseNumber
                      ? 'border-rose-300 focus:ring-rose-500 bg-rose-50/20'
                      : 'border-slate-300 focus:ring-sky-500'
                  }`}
                />
              </div>
              {fieldErrors.licenseNumber && (
                <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.licenseNumber}</p>
              )}
            </div>

            {/* License Expiry */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                License Expiry Date <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <div className="relative">
                <Calendar className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="date"
                  value={licenseExpiry}
                  onChange={(e) => setLicenseExpiry(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500 text-slate-800"
                />
              </div>
            </div>
          </div>

          {/* Row 3: Driver Profile Photo */}
          <div className="space-y-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <label className="block text-xs font-semibold text-slate-800 flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5 text-sky-600" />
              Driver Profile Photo <span className="text-slate-400 font-normal">(Optional)</span>
            </label>

            <div className="flex items-center gap-3">
              {/* Photo Avatar Preview */}
              <div className="w-12 h-12 rounded-full border-2 border-slate-300 overflow-hidden bg-slate-200 flex items-center justify-center shrink-0">
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt="Driver Preview"
                    className="w-full h-full object-cover"
                    onError={() => setPhotoUrl('')}
                  />
                ) : (
                  <User className="w-6 h-6 text-slate-400" />
                )}
              </div>

              <div className="flex-1 space-y-1.5">
                <input
                  type="url"
                  placeholder="https://example.com/driver-photo.jpg"
                  value={photoUrl}
                  onChange={(e) => setPhotoUrl(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500 font-mono"
                />

                {/* Presets */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400">Presets:</span>
                  {PRESET_AVATARS.map((url, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setPhotoUrl(url)}
                      className="w-5 h-5 rounded-full overflow-hidden border border-slate-300 hover:scale-110 transition-transform"
                      title={`Select Avatar ${idx + 1}`}
                    >
                      <img src={url} alt={`Preset ${idx + 1}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                  {photoUrl && (
                    <button
                      type="button"
                      onClick={() => setPhotoUrl('')}
                      className="text-[10px] text-rose-600 hover:underline ml-1"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Modal Footer Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
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
                  Saving Changes...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
