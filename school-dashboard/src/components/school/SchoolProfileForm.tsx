'use client';

import React, { useState, useEffect } from 'react';
import {
  School,
  UpdateSchoolProfileRequest,
  UpdateSchoolProfileRequestSchema,
} from '@school-bus/shared';
import {
  Building2,
  MapPin,
  Phone,
  Mail,
  Globe,
  Award,
  Image as ImageIcon,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  WifiOff,
  ShieldAlert,
} from 'lucide-react';
import { SchoolService } from '../../services/school.service';

interface SchoolProfileFormProps {
  schoolId: string;
  initialData?: School | null;
  canEdit?: boolean;
}

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Chandigarh', 'Jammu & Kashmir', 'Ladakh', 'Puducherry'
];

export function SchoolProfileForm({
  schoolId,
  initialData = null,
  canEdit = true,
}: SchoolProfileFormProps) {
  // State Machine
  const [profile, setProfile] = useState<School | null>(initialData);
  const [loading, setLoading] = useState<boolean>(!initialData);
  const [saving, setSaving] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState<boolean>(false);

  // Form State
  const [formData, setFormData] = useState<UpdateSchoolProfileRequest>({
    name: initialData?.name || '',
    address: initialData?.address || '',
    city: initialData?.city || '',
    state: initialData?.state || 'Delhi',
    postalCode: initialData?.postalCode || '',
    phone: initialData?.phone || '',
    email: initialData?.email || '',
    logoUrl: initialData?.logoUrl || '',
    affiliationNumber: initialData?.affiliationNumber || '',
    website: initialData?.website || '',
    timezone: initialData?.timezone || 'Asia/Kolkata',
  });

  // Track online/offline browser state
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    if (typeof window !== 'undefined') {
      setIsOffline(!navigator.onLine);
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Fetch School Profile
  const loadProfile = async () => {
    if (!schoolId) {
      setFetchError('School tenant identifier is missing.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setFetchError(null);
    setSaveSuccessMessage(null);

    try {
      const data = await SchoolService.getProfile(schoolId);
      setProfile(data);
      setFormData({
        name: data.name || '',
        address: data.address || '',
        city: data.city || '',
        state: data.state || 'Delhi',
        postalCode: data.postalCode || '',
        phone: data.phone || '',
        email: data.email || '',
        logoUrl: data.logoUrl || '',
        affiliationNumber: data.affiliationNumber || '',
        website: data.website || '',
        timezone: data.timezone || 'Asia/Kolkata',
      });
    } catch (err: any) {
      setFetchError(err.message || 'Failed to load school profile metadata.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialData) {
      loadProfile();
    }
  }, [schoolId]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear inline error on edit
    if (fieldErrors[name]) {
      setFieldErrors((prev) => {
        const updated = { ...prev };
        delete updated[name];
        return updated;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;

    setFieldErrors({});
    setSaveSuccessMessage(null);

    // Client-side Zod validation
    const validation = UpdateSchoolProfileRequestSchema.safeParse(formData);
    if (!validation.success) {
      const errors: Record<string, string> = {};
      validation.error.errors.forEach((err) => {
        const key = err.path.join('.');
        if (!errors[key]) errors[key] = err.message;
      });
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    try {
      const updated = await SchoolService.updateProfile(schoolId, validation.data);
      setProfile(updated);
      setSaveSuccessMessage('School profile updated and saved to audit log successfully.');
      setTimeout(() => setSaveSuccessMessage(null), 5000);
    } catch (err: any) {
      if (err.details && Array.isArray(err.details)) {
        const errors: Record<string, string> = {};
        err.details.forEach((d: any) => {
          errors[d.path] = d.message;
        });
        setFieldErrors(errors);
      } else {
        setFetchError(err.message || 'Failed to update school profile.');
      }
    } finally {
      setSaving(false);
    }
  };

  // 1. OFFLINE STATE BANNER
  const renderOfflineBanner = () => {
    if (!isOffline) return null;
    return (
      <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-2.5 text-amber-800 text-xs font-medium">
        <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
        <span>You are currently offline. Changes will not be synchronized until connection is restored.</span>
      </div>
    );
  };

  // 2. LOADING STATE (Calm Skeleton)
  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
        <div className="h-8 bg-slate-200 rounded w-1/3"></div>
        <div className="bg-white p-6 rounded-lg border border-slate-200 space-y-4">
          <div className="h-4 bg-slate-200 rounded w-1/4"></div>
          <div className="h-10 bg-slate-100 rounded"></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-10 bg-slate-100 rounded"></div>
            <div className="h-10 bg-slate-100 rounded"></div>
          </div>
          <div className="h-20 bg-slate-100 rounded"></div>
        </div>
      </div>
    );
  }

  // 3. FAILURE / RETRY STATE
  if (fetchError && !profile) {
    return (
      <div className="max-w-2xl mx-auto p-8 bg-white border border-rose-200 rounded-lg text-center space-y-4">
        <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-slate-800">Unable to Load School Profile</h3>
          <p className="text-xs text-slate-500 mt-1">{fetchError}</p>
        </div>
        <button
          onClick={loadProfile}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-md text-xs font-semibold hover:bg-slate-800 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry Loading</span>
        </button>
      </div>
    );
  }

  // 4. FORBIDDEN / UNAUTHORIZED STATE
  if (!canEdit) {
    return (
      <div className="max-w-3xl mx-auto p-4 bg-slate-100 border border-slate-300 rounded-lg flex items-center gap-3 text-slate-700 text-xs">
        <ShieldAlert className="w-5 h-5 text-slate-500" />
        <span>You possess Read-Only access. School profile modifications require School Admin privileges.</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {renderOfflineBanner()}

      {/* Success Notification Alert */}
      {saveSuccessMessage && (
        <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-3 text-emerald-800 text-xs font-medium transition-all">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{saveSuccessMessage}</span>
        </div>
      )}

      {/* Main Profile Form Canvas */}
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Header Ribbon */}
        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-sky-100 border border-sky-200 flex items-center justify-center text-sky-800 font-bold">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Institution Identity & Coordinates</h3>
              <p className="text-xs text-slate-500">School registration, communication contacts, and branding</p>
            </div>
          </div>
          {profile?.code && (
            <div className="text-right">
              <span className="text-[10px] uppercase font-mono tracking-wider font-semibold px-2 py-1 rounded bg-slate-200/80 text-slate-700 border border-slate-300">
                Code: {profile.code}
              </span>
            </div>
          )}
        </div>

        <div className="p-6 space-y-6">
          {/* Logo & School Name Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Logo Preview Block */}
            <div className="flex flex-col items-center justify-center p-4 border border-dashed border-slate-300 rounded-lg bg-slate-50 text-center">
              {formData.logoUrl ? (
                <div className="relative group">
                  <img
                    src={formData.logoUrl}
                    alt="School Logo"
                    className="w-24 h-24 object-contain rounded border border-slate-200 bg-white p-1"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">Live Logo Preview</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1.5 py-4 text-slate-400">
                  <ImageIcon className="w-8 h-8 stroke-1" />
                  <span className="text-xs">No Logo Provided</span>
                </div>
              )}
            </div>

            {/* Basic Info Fields */}
            <div className="md:col-span-2 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Official School Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="e.g. Delhi Public Academy, Vasant Kunj"
                  className={`w-full px-3 py-2 text-xs rounded-md border ${
                    fieldErrors.name ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                  }`}
                />
                {fieldErrors.name && (
                  <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.name}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Logo URL (PNG / SVG / WebP)
                </label>
                <input
                  type="url"
                  name="logoUrl"
                  value={formData.logoUrl || ''}
                  onChange={handleChange}
                  placeholder="https://myschool.edu.in/logo.png"
                  className={`w-full px-3 py-2 text-xs rounded-md border ${
                    fieldErrors.logoUrl ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                  }`}
                />
                {fieldErrors.logoUrl && (
                  <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.logoUrl}</p>
                )}
              </div>
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Address & Geographical Coordinates */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-sky-600" />
              <span>Campus Address & Location</span>
            </h4>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Full Street / Campus Address <span className="text-rose-500">*</span>
              </label>
              <textarea
                name="address"
                rows={2}
                value={formData.address}
                onChange={handleChange}
                placeholder="Plot Number, Sector, Road, Landmark"
                className={`w-full px-3 py-2 text-xs rounded-md border ${
                  fieldErrors.address ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                }`}
              />
              {fieldErrors.address && (
                <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.address}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  City <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                  placeholder="e.g. New Delhi"
                  className={`w-full px-3 py-2 text-xs rounded-md border ${
                    fieldErrors.city ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                  }`}
                />
                {fieldErrors.city && (
                  <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.city}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  State / Union Territory <span className="text-rose-500">*</span>
                </label>
                <select
                  name="state"
                  value={formData.state}
                  onChange={handleChange}
                  className="w-full px-3 py-2 text-xs rounded-md border border-slate-300 bg-white"
                >
                  {INDIAN_STATES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Postal PIN Code
                </label>
                <input
                  type="text"
                  name="postalCode"
                  maxLength={6}
                  value={formData.postalCode || ''}
                  onChange={handleChange}
                  placeholder="e.g. 110070"
                  className={`w-full px-3 py-2 text-xs rounded-md border ${
                    fieldErrors.postalCode ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                  }`}
                />
                {fieldErrors.postalCode && (
                  <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.postalCode}</p>
                )}
              </div>
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Communication & Accreditation Details */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-sky-600" />
              <span>Official Contacts & Affiliation</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Primary Transport / Admin Phone <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs text-slate-400 font-mono">+91</span>
                  <input
                    type="tel"
                    name="phone"
                    value={(formData.phone || '').replace(/^\+91/, '')}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '');
                      setFormData((p) => ({ ...p, phone: val }));
                    }}
                    placeholder="9876543210"
                    maxLength={10}
                    className={`w-full pl-11 pr-3 py-2 text-xs rounded-md border font-mono ${
                      fieldErrors.phone ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                    }`}
                  />
                </div>
                {fieldErrors.phone && (
                  <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.phone}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Official Communication Email <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="transport@school.edu.in"
                    className={`w-full pl-9 pr-3 py-2 text-xs rounded-md border ${
                      fieldErrors.email ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                    }`}
                  />
                </div>
                {fieldErrors.email && (
                  <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.email}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Board Affiliation / Recognition No.
                </label>
                <div className="relative">
                  <Award className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    name="affiliationNumber"
                    value={formData.affiliationNumber || ''}
                    onChange={handleChange}
                    placeholder="e.g. CBSE/AFF/2026/8891"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-md border border-slate-300 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Official School Website
                </label>
                <div className="relative">
                  <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="url"
                    name="website"
                    value={formData.website || ''}
                    onChange={handleChange}
                    placeholder="https://myschool.edu.in"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-md border border-slate-300"
                  />
                </div>
                {fieldErrors.website && (
                  <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.website}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Action Button Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            Changes will be logged to the tenant audit trail.
          </span>
          <button
            type="submit"
            disabled={saving || isOffline}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-sky-700 text-white rounded-lg text-xs font-semibold hover:bg-sky-800 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-colors"
          >
            {saving ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Saving Profile...</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>Save Profile Changes</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

