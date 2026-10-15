'use client';

import React, { useState, useEffect } from 'react';
import {
  AuthUserPayload,
  UpdateAdminProfileRequest,
  UpdateAdminProfileRequestSchema,
  ChangePasswordRequest,
  ChangePasswordRequestSchema,
} from '@school-bus/shared';
import {
  User,
  Mail,
  Phone,
  Shield,
  KeyRound,
  LogOut,
  Save,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  WifiOff,
  Eye,
  EyeOff,
  Building,
} from 'lucide-react';
import { AuthService } from '../../services/auth.service';

interface AdminAccountFormProps {
  initialUser?: AuthUserPayload | null;
}

export function AdminAccountForm({ initialUser = null }: AdminAccountFormProps) {
  // State Machine
  const [user, setUser] = useState<AuthUserPayload | null>(initialUser);
  const [loading, setLoading] = useState<boolean>(!initialUser);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState<boolean>(false);

  // Profile Form State
  const [profileData, setProfileData] = useState<UpdateAdminProfileRequest>({
    fullName: initialUser?.fullName || '',
    phone: initialUser?.phone || '',
  });
  const [savingProfile, setSavingProfile] = useState<boolean>(false);
  const [profileSuccessMsg, setProfileSuccessMsg] = useState<string | null>(null);
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});

  // Password Change Form State
  const [passwordData, setPasswordData] = useState<{
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [savingPassword, setSavingPassword] = useState<boolean>(false);
  const [passwordSuccessMsg, setPasswordSuccessMsg] = useState<string | null>(null);
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});

  // Offline detection
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

  // Fetch Current User
  const loadUser = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const data = await AuthService.getMe();
      setUser(data);
      setProfileData({
        fullName: data.fullName || '',
        phone: data.phone || '',
      });
    } catch (err: any) {
      setFetchError(err.message || 'Failed to load administrator account profile.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialUser) {
      loadUser();
    }
  }, []);

  // Handle Profile Submit
  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileErrors({});
    setProfileSuccessMsg(null);

    const validation = UpdateAdminProfileRequestSchema.safeParse(profileData);
    if (!validation.success) {
      const errs: Record<string, string> = {};
      validation.error.errors.forEach((err) => {
        const key = err.path.join('.');
        if (!errs[key]) errs[key] = err.message;
      });
      setProfileErrors(errs);
      return;
    }

    setSavingProfile(true);
    try {
      const updated = await AuthService.updateProfile(validation.data);
      setUser(updated);
      setProfileSuccessMsg('Profile updated and recorded in audit log.');
      setTimeout(() => setProfileSuccessMsg(null), 5000);
    } catch (err: any) {
      setProfileErrors({ form: err.message || 'Failed to update profile.' });
    } finally {
      setSavingProfile(false);
    }
  };

  // Handle Password Change Submit
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordErrors({});
    setPasswordSuccessMsg(null);

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordErrors({ confirmPassword: 'New passwords do not match' });
      return;
    }

    const validation = ChangePasswordRequestSchema.safeParse({
      currentPassword: passwordData.currentPassword,
      newPassword: passwordData.newPassword,
    });

    if (!validation.success) {
      const errs: Record<string, string> = {};
      validation.error.errors.forEach((err) => {
        const key = err.path.join('.');
        if (!errs[key]) errs[key] = err.message;
      });
      setPasswordErrors(errs);
      return;
    }

    setSavingPassword(true);
    try {
      await AuthService.changePassword(validation.data);
      setPasswordSuccessMsg('Password changed successfully. Please remember your new credentials.');
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setTimeout(() => setPasswordSuccessMsg(null), 5000);
    } catch (err: any) {
      setPasswordErrors({ form: err.message || 'Failed to change password.' });
    } finally {
      setSavingPassword(false);
    }
  };

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to sign out of the School Transport Dashboard?')) {
      AuthService.logout();
    }
  };

  // 1. LOADING STATE (Calm Skeleton)
  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6 animate-pulse">
        <div className="h-6 bg-slate-200 rounded w-1/4"></div>
        <div className="bg-white p-6 rounded-lg border border-slate-200 space-y-4">
          <div className="h-10 bg-slate-100 rounded"></div>
          <div className="h-10 bg-slate-100 rounded"></div>
        </div>
      </div>
    );
  }

  // 2. ERROR / RETRY STATE
  if (fetchError && !user) {
    return (
      <div className="max-w-xl mx-auto p-8 bg-white border border-rose-200 rounded-lg text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-slate-800">Unable to Load Account Profile</h3>
          <p className="text-xs text-slate-500 mt-1">{fetchError}</p>
        </div>
        <button
          onClick={loadUser}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-md text-xs font-semibold hover:bg-slate-800"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Offline Alert */}
      {isOffline && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2.5 text-amber-800 text-xs font-medium">
          <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
          <span>You are currently offline. Changes will not be synchronized until connection is restored.</span>
        </div>
      )}

      {/* 1. Administrator Profile Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-sky-100 border border-sky-200 flex items-center justify-center text-sky-800 font-bold">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Administrator Profile</h3>
              <p className="text-xs text-slate-500">Personal details and communication mobile number</p>
            </div>
          </div>
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded bg-sky-50 text-sky-700 border border-sky-200 uppercase tracking-wide">
            {user?.role}
          </span>
        </div>

        {profileSuccessMsg && (
          <div className="mx-6 mt-6 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2.5 text-emerald-800 text-xs font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{profileSuccessMsg}</span>
          </div>
        )}

        {profileErrors.form && (
          <div className="mx-6 mt-6 p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2.5 text-rose-800 text-xs font-medium">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{profileErrors.form}</span>
          </div>
        )}

        <form onSubmit={handleProfileSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Full Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                name="fullName"
                value={profileData.fullName}
                onChange={(e) => setProfileData((p) => ({ ...p, fullName: e.target.value }))}
                placeholder="e.g. Ramesh Chandra Sharma"
                className={`w-full px-3 py-2 text-xs rounded-md border ${
                  profileErrors.fullName ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                }`}
              />
              {profileErrors.fullName && (
                <p className="text-[11px] text-rose-600 mt-1">{profileErrors.fullName}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Official Email (Login Identifier)
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="email"
                  disabled
                  value={user?.email || ''}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-md border border-slate-200 bg-slate-100 text-slate-600 cursor-not-allowed font-mono"
                />
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block">Email is locked to your tenant account</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Mobile Phone (WhatsApp Notifications)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-xs text-slate-400 font-mono">+91</span>
                <input
                  type="tel"
                  maxLength={10}
                  value={profileData.phone ? profileData.phone.replace(/^\+91/, '') : ''}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    setProfileData((p) => ({ ...p, phone: val }));
                  }}
                  placeholder="9876543210"
                  className={`w-full pl-11 pr-3 py-2 text-xs rounded-md border font-mono ${
                    profileErrors.phone ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                  }`}
                />
              </div>
              {profileErrors.phone && (
                <p className="text-[11px] text-rose-600 mt-1">{profileErrors.phone}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Assigned School Tenant ID
              </label>
              <div className="relative">
                <Building className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  disabled
                  value={user?.schoolId || 'Global Super Admin'}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-md border border-slate-200 bg-slate-100 text-slate-500 font-mono"
                />
              </div>
            </div>
          </div>

          <div className="pt-3 flex justify-end">
            <button
              type="submit"
              disabled={savingProfile || isOffline}
              className="inline-flex items-center gap-2 px-4 py-2 bg-sky-700 text-white rounded-lg text-xs font-semibold hover:bg-sky-800 disabled:opacity-50 transition-colors shadow-sm"
            >
              {savingProfile ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving Profile...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Profile</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* 2. Security & Password Change Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-800 font-bold">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Security Credentials</h3>
              <p className="text-xs text-slate-500">Update administrative dashboard password</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1.5"
          >
            {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{showPassword ? 'Hide Passwords' : 'Show Passwords'}</span>
          </button>
        </div>

        {passwordSuccessMsg && (
          <div className="mx-6 mt-6 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2.5 text-emerald-800 text-xs font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{passwordSuccessMsg}</span>
          </div>
        )}

        {passwordErrors.form && (
          <div className="mx-6 mt-6 p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2.5 text-rose-800 text-xs font-medium">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{passwordErrors.form}</span>
          </div>
        )}

        <form onSubmit={handlePasswordSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Current Password <span className="text-rose-500">*</span>
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={passwordData.currentPassword}
                onChange={(e) => setPasswordData((p) => ({ ...p, currentPassword: e.target.value }))}
                placeholder="••••••••"
                className={`w-full px-3 py-2 text-xs rounded-md border ${
                  passwordErrors.currentPassword ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                }`}
              />
              {passwordErrors.currentPassword && (
                <p className="text-[11px] text-rose-600 mt-1">{passwordErrors.currentPassword}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                New Password <span className="text-rose-500">*</span>
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={passwordData.newPassword}
                onChange={(e) => setPasswordData((p) => ({ ...p, newPassword: e.target.value }))}
                placeholder="Min. 8 characters"
                className={`w-full px-3 py-2 text-xs rounded-md border ${
                  passwordErrors.newPassword ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                }`}
              />
              {passwordErrors.newPassword && (
                <p className="text-[11px] text-rose-600 mt-1">{passwordErrors.newPassword}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Confirm New Password <span className="text-rose-500">*</span>
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={passwordData.confirmPassword}
                onChange={(e) => setPasswordData((p) => ({ ...p, confirmPassword: e.target.value }))}
                placeholder="Re-type new password"
                className={`w-full px-3 py-2 text-xs rounded-md border ${
                  passwordErrors.confirmPassword ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                }`}
              />
              {passwordErrors.confirmPassword && (
                <p className="text-[11px] text-rose-600 mt-1">{passwordErrors.confirmPassword}</p>
              )}
            </div>
          </div>

          <div className="pt-3 flex justify-end">
            <button
              type="submit"
              disabled={savingPassword || isOffline}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 transition-colors shadow-sm"
            >
              {savingPassword ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Updating Password...</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Update Password</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* 3. Session & Sign Out Block */}
      <div className="p-6 bg-slate-100 border border-slate-200 rounded-xl flex items-center justify-between">
        <div>
          <h4 className="text-xs font-bold text-slate-800">Active Operator Session</h4>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Sign out of this workstation to terminate your session and protect school data.
          </p>
        </div>
        <button
          onClick={handleLogout}
          className="inline-flex items-center gap-2 px-4 py-2 bg-rose-600 text-white rounded-lg text-xs font-semibold hover:bg-rose-700 transition-colors shadow-sm"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
}

