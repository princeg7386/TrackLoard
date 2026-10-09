import React from 'react';
import Link from 'next/link';
import { LucideIcon, Inbox } from 'lucide-react';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  secondaryActionHref?: string;
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  actionLabel,
  onAction,
  actionHref,
  secondaryActionLabel,
  onSecondaryAction,
  secondaryActionHref,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`p-8 md:p-12 text-center bg-white rounded-xl border border-dashed border-slate-300 max-w-xl mx-auto my-6 flex flex-col items-center justify-center ${className}`}
    >
      <div className="w-12 h-12 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 mb-4 shadow-sm">
        <Icon className="w-6 h-6 stroke-1" />
      </div>

      <h3 className="text-sm font-bold text-slate-900 mb-1">{title}</h3>
      <p className="text-xs text-slate-500 max-w-sm mb-6 leading-relaxed">
        {description}
      </p>

      {(actionLabel || secondaryActionLabel) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {actionLabel && (
            actionHref ? (
              <Link
                href={actionHref}
                className="inline-flex items-center gap-2 px-4 py-2 bg-sky-700 hover:bg-sky-800 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
              >
                {actionLabel}
              </Link>
            ) : (
              <button
                type="button"
                onClick={onAction}
                className="inline-flex items-center gap-2 px-4 py-2 bg-sky-700 hover:bg-sky-800 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors"
              >
                {actionLabel}
              </button>
            )
          )}

          {secondaryActionLabel && (
            secondaryActionHref ? (
              <Link
                href={secondaryActionHref}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold shadow-sm transition-colors"
              >
                {secondaryActionLabel}
              </Link>
            ) : (
              <button
                type="button"
                onClick={onSecondaryAction}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold shadow-sm transition-colors"
              >
                {secondaryActionLabel}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
