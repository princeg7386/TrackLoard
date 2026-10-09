'use client';

import React from 'react';
import Link from 'next/link';
import { Bus, Radio, Users, MapPin, ArrowUpRight } from 'lucide-react';
import { DashboardMetricSummary } from '../../services/dashboardApi';

interface DashboardMetricsCardsProps {
  metrics: DashboardMetricSummary;
}

export function DashboardMetricsCards({ metrics }: DashboardMetricsCardsProps) {
  const cards = [
    {
      title: 'Active Trips In-Transit',
      value: metrics.activeTripsCount,
      subtext: metrics.activeTripsCount > 0 ? 'Live telemetry streaming' : 'Standby / Scheduled',
      icon: Radio,
      href: '/admin/live',
      accentColor: 'text-sky-700 bg-sky-50 border-sky-200',
      badge: metrics.activeTripsCount > 0 ? 'Live' : 'Off-peak',
      badgeColor: metrics.activeTripsCount > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600',
    },
    {
      title: 'Fleet Vehicles',
      value: metrics.totalBuses,
      subtext: `${metrics.totalDrivers} registered drivers`,
      icon: Bus,
      href: '/admin/buses',
      accentColor: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    },
    {
      title: 'Enrolled Students',
      value: metrics.totalStudents,
      subtext: 'Assigned to pickup stops',
      icon: Users,
      href: '/admin/students',
      accentColor: 'text-indigo-700 bg-indigo-50 border-indigo-200',
    },
    {
      title: 'Transport Routes',
      value: metrics.totalRoutes,
      subtext: 'Morning & evening coverage',
      icon: MapPin,
      href: '/admin/routes',
      accentColor: 'text-amber-700 bg-amber-50 border-amber-200',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Link
            key={card.title}
            href={card.href}
            className="group bg-white border border-slate-200 rounded-lg p-4 hover:border-slate-300 hover:shadow-sm transition-all flex flex-col justify-between"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                  {card.title}
                </span>
                <div className="text-2xl font-bold text-slate-900 mt-1 font-mono tracking-tight">
                  {card.value}
                </div>
              </div>
              <div
                className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${card.accentColor}`}
              >
                <Icon className={`w-4 h-4 ${card.badge === 'Live' ? 'animate-pulse' : ''}`} />
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span className="truncate">{card.subtext}</span>
              <div className="flex items-center gap-1 group-hover:text-sky-600 transition-colors">
                {card.badge && (
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-semibold ${card.badgeColor}`}
                  >
                    {card.badge}
                  </span>
                )}
                <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-600 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
