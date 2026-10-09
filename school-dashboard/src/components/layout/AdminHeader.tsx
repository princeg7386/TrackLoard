'use client';

import React, { useState, useEffect } from 'react';
import { Bell, Clock, Shield, User, LogOut } from 'lucide-react';

interface AdminHeaderProps {
  title?: string;
  subtitle?: string;
  userFullName?: string;
  userRole?: string;
  onLogout?: () => void;
}

export function AdminHeader({
  title = 'Transport Overview',
  subtitle = 'Manage school transport logistics and live safety telemetry',
  userFullName = 'School Administrator',
  userRole = 'SCHOOL_ADMIN',
  onLogout,
}: AdminHeaderProps) {
  const [istTime, setIstTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }).format(now);
      setIstTime(formatted);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      {/* Title & Page Header */}
      <div>
        <h2 className="text-base font-bold text-slate-800 tracking-tight">{title}</h2>
        <p className="text-xs text-slate-500 hidden sm:block">{subtitle}</p>
      </div>

      {/* Operational Actions & User Profile */}
      <div className="flex items-center gap-4">
        {/* Live IST Operational Clock */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 rounded text-slate-700 text-xs font-mono border border-slate-200">
          <Clock className="w-3.5 h-3.5 text-slate-500" />
          <span>{istTime || '00:00:00 IST'}</span>
          <span className="text-[10px] text-slate-400 font-sans">IST</span>
        </div>

        {/* User Card */}
        <div className="flex items-center gap-3 pl-3 border-l border-slate-200">
          <div className="w-8 h-8 rounded-full bg-sky-100 border border-sky-200 flex items-center justify-center text-sky-800 font-bold text-xs">
            <User className="w-4 h-4" />
          </div>
          <div className="hidden md:block text-left leading-tight">
            <div className="text-xs font-semibold text-slate-800">{userFullName}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">{userRole}</div>
          </div>
          {onLogout && (
            <button
              onClick={onLogout}
              title="Sign Out"
              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
