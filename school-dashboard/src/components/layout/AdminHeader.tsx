'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Clock, User, LogOut, Menu } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface AdminHeaderProps {
  title?: string;
  subtitle?: string;
  onToggleMobileMenu?: () => void;
}

export function AdminHeader({
  title = 'Transport Operations',
  subtitle = 'School bus fleet tracking and student safety control',
  onToggleMobileMenu,
}: AdminHeaderProps) {
  const { user, logout } = useAuth();
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

  const fullName = user?.fullName || 'School Administrator';
  const role = user?.role ? user.role.replace('_', ' ') : 'OPERATOR';

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.03)] z-10">
      {/* Left: Mobile Menu Toggle & Title Header */}
      <div className="flex items-center gap-3 min-w-0">
        {onToggleMobileMenu && (
          <button
            type="button"
            onClick={onToggleMobileMenu}
            className="p-2 -ml-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg md:hidden focus:outline-hidden"
            aria-label="Toggle navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        <div className="truncate">
          <h2 className="text-sm sm:text-base font-bold text-slate-800 tracking-tight truncate">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-slate-500 hidden sm:block truncate">{subtitle}</p>
          )}
        </div>
      </div>

      {/* Right: Live IST Clock & Operator Profile */}
      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        {/* Live IST Operational Clock */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 rounded text-slate-700 text-xs font-mono border border-slate-200 select-none">
          <Clock className="w-3.5 h-3.5 text-slate-500" />
          <span>{istTime || '00:00:00 IST'}</span>
          <span className="text-[10px] text-slate-400 font-sans hidden sm:inline">IST</span>
        </div>

        {/* User Card */}
        <div className="flex items-center gap-2 sm:gap-3 pl-2 sm:pl-3 border-l border-slate-200">
          <Link
            href="/admin/account"
            className="flex items-center gap-2 group p-1 -m-1 rounded-md hover:bg-slate-50 transition-colors"
            title="Manage Operator Account"
          >
            <div className="w-8 h-8 rounded-full bg-sky-100 border border-sky-200 flex items-center justify-center text-sky-800 font-bold text-xs group-hover:bg-sky-200 transition-colors">
              <User className="w-4 h-4" />
            </div>
            <div className="hidden lg:block text-left leading-tight max-w-[130px]">
              <div className="text-xs font-semibold text-slate-800 truncate">{fullName}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium truncate">
                {role}
              </div>
            </div>
          </Link>

          {/* Sign Out Button */}
          <button
            type="button"
            onClick={logout}
            title="Sign Out"
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
            aria-label="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
