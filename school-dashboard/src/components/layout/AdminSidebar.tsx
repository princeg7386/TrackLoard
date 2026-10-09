'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
  Bus,
  Users,
  MapPin,
  GraduationCap,
  AlertTriangle,
  FileText,
  ShieldCheck,
  Settings,
  Radio,
} from 'lucide-react';

interface SidebarItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const navItems: SidebarItem[] = [
  { name: 'Live Operations', href: '/admin/live', icon: Radio, badge: 'Live' },
  { name: 'School Profile', href: '/admin/profile', icon: Building2 },
  { name: 'Fleet / Buses', href: '/admin/buses', icon: Bus },
  { name: 'Drivers Directory', href: '/admin/drivers', icon: Users },
  { name: 'Routes & Stops', href: '/admin/routes', icon: MapPin },
  { name: 'Students & Parents', href: '/admin/students', icon: GraduationCap },
  { name: 'Incidents & SOS', href: '/admin/safety', icon: AlertTriangle },
  { name: 'Reports & Logs', href: '/admin/reports', icon: FileText },
];

export function AdminSidebar({ schoolName = 'School Admin', schoolCode = 'DEMO' }: { schoolName?: string; schoolCode?: string }) {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-slate-900 text-slate-200 flex flex-col h-screen border-r border-slate-800 shrink-0 select-none">
      {/* Brand & Tenant Header */}
      <div className="p-4 border-b border-slate-800 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-sky-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
          <Bus className="w-5 h-5" />
        </div>
        <div className="overflow-hidden">
          <h1 className="text-sm font-semibold text-white truncate leading-tight">
            {schoolName}
          </h1>
          <span className="inline-block px-1.5 py-0.5 mt-0.5 text-[10px] font-mono tracking-wider font-semibold rounded bg-slate-800 text-sky-400 uppercase border border-slate-700">
            {schoolCode}
          </span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="px-3 pb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          Transport Control
        </div>
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/admin' && pathname?.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-sky-700 text-white font-semibold shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{item.name}</span>
              </div>
              {item.badge && (
                <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                  isActive ? 'bg-sky-900 text-sky-200' : 'bg-slate-800 text-slate-400'
                }`}>
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer / Tenant Security Status */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/40">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span className="truncate">Multi-Tenant Isolated</span>
        </div>
      </div>
    </aside>
  );
}
