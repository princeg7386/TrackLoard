import React from 'react';

export type StatusType = 'normal' | 'warning' | 'incident' | 'inactive' | 'info';

interface StatusBadgeProps {
  status: StatusType;
  label: string;
  dot?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  label,
  dot = true,
  className = '',
}: StatusBadgeProps) {
  const styles: Record<StatusType, { bg: string; text: string; dotColor: string; border: string }> = {
    normal: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      dotColor: 'bg-emerald-500',
      border: 'border-emerald-200',
    },
    warning: {
      bg: 'bg-amber-50',
      text: 'text-amber-700',
      dotColor: 'bg-amber-500',
      border: 'border-amber-200',
    },
    incident: {
      bg: 'bg-rose-50',
      text: 'text-rose-700',
      dotColor: 'bg-rose-500',
      border: 'border-rose-200',
    },
    inactive: {
      bg: 'bg-slate-100',
      text: 'text-slate-600',
      dotColor: 'bg-slate-400',
      border: 'border-slate-200',
    },
    info: {
      bg: 'bg-sky-50',
      text: 'text-sky-700',
      dotColor: 'bg-sky-500',
      border: 'border-sky-200',
    },
  };

  const current = styles[status] || styles.inactive;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${current.bg} ${current.text} ${current.border} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${current.dotColor}`} />}
      <span>{label}</span>
    </span>
  );
}
