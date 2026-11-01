'use client';

import React from 'react';
import {
  MapPin,
  Clock,
  UserCheck,
  Navigation,
  GraduationCap,
  CheckCircle2,
  Circle,
  RefreshCw,
  LucideIcon,
} from 'lucide-react';
import {
  StudentJourneyStage,
  JourneyStageKey,
} from '@school-bus/shared';

export interface StudentJourneyTimelineProps {
  stages?: StudentJourneyStage[];
  currentStage?: JourneyStageKey;
  timezone?: string;
  isLoading?: boolean;
  onRefresh?: () => void;
}

const STAGE_ICONS: Record<JourneyStageKey, LucideIcon> = {
  PICKUP: MapPin,
  BUS_ARRIVAL: Clock,
  BOARDING: UserCheck,
  ON_ROUTE: Navigation,
  SCHOOL_ARRIVAL: GraduationCap,
  DROPPED: CheckCircle2,
};

function formatStageTime(isoString?: string | null, tz: string = 'Asia/Kolkata'): string {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleTimeString('en-IN', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

export function StudentJourneyTimeline({
  stages = [],
  currentStage,
  timezone = 'Asia/Kolkata',
  isLoading = false,
  onRefresh,
}: StudentJourneyTimelineProps) {
  if (!stages || stages.length === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Student Journey Timeline
          </h3>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="text-slate-400 hover:text-sky-600 p-1 rounded-md hover:bg-slate-50 transition-colors disabled:opacity-50"
            title="Refresh Timeline"
            aria-label="Refresh Timeline"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-sky-600' : ''}`} />
          </button>
        )}
      </div>

      {/* Timeline stages */}
      <div className="relative pl-2 pr-1 space-y-0">
        {stages.map((stageItem, idx) => {
          const isLast = idx === stages.length - 1;
          const StageIcon = STAGE_ICONS[stageItem.stage] || Circle;
          const isCompleted = stageItem.status === 'COMPLETED';
          const isInProgress = stageItem.status === 'IN_PROGRESS';
          const isSkipped = stageItem.status === 'SKIPPED';
          const formattedTime = formatStageTime(stageItem.timestamp, timezone);

          // Dot/Icon Styling
          let nodeBg = 'bg-slate-100 border-slate-300 text-slate-400';
          let lineBg = 'bg-slate-200';
          let textColor = 'text-slate-700';
          let badgeBg = 'bg-slate-100 text-slate-600 border-slate-200';
          let badgeText = 'Pending';

          if (isCompleted) {
            nodeBg = 'bg-emerald-500 border-emerald-600 text-white shadow-xs';
            lineBg = 'bg-emerald-400';
            textColor = 'text-slate-900 font-semibold';
            badgeBg = 'bg-emerald-50 text-emerald-800 border-emerald-200';
            badgeText = 'Completed';
          } else if (isInProgress) {
            nodeBg = 'bg-sky-600 border-sky-700 text-white shadow-xs animate-pulse';
            lineBg = 'bg-slate-200';
            textColor = 'text-sky-950 font-bold';
            badgeBg = 'bg-sky-50 text-sky-800 border-sky-300';
            badgeText = 'In Progress';
          } else if (isSkipped) {
            nodeBg = 'bg-amber-100 border-amber-300 text-amber-700';
            lineBg = 'bg-slate-200';
            textColor = 'text-amber-900';
            badgeBg = 'bg-amber-50 text-amber-800 border-amber-200';
            badgeText = 'Skipped';
          }

          return (
            <div key={stageItem.stage} className="relative flex items-start gap-3 pb-5 last:pb-1">
              {/* Vertical connector line */}
              {!isLast && (
                <div
                  className={`absolute left-[15px] top-[28px] bottom-0 w-[2px] ${lineBg} transition-colors`}
                  aria-hidden="true"
                />
              )}

              {/* Node Icon */}
              <div
                className={`relative z-10 w-8 h-8 rounded-full border flex items-center justify-center flex-shrink-0 transition-all ${nodeBg}`}
              >
                <StageIcon className="w-4 h-4" />
              </div>

              {/* Stage content */}
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className={`text-xs ${textColor}`}>
                    {stageItem.title}
                  </p>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {formattedTime && (
                      <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                        {formattedTime}
                      </span>
                    )}
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeBg}`}
                    >
                      {badgeText}
                    </span>
                  </div>
                </div>

                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  {stageItem.description}
                </p>

                {/* Additional contextual meta if available */}
                {(stageItem.stopName || stageItem.stopSequence != null || stageItem.markedBy) && (
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-500">
                    {stageItem.stopName && (
                      <span className="bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
                        Stop: {stageItem.stopName}
                      </span>
                    )}
                    {stageItem.stopSequence != null && (
                      <span className="bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
                        Seq #{stageItem.stopSequence}
                      </span>
                    )}
                    {stageItem.markedBy && (
                      <span className="bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
                        By: {stageItem.markedBy}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
