import React from 'react';
import { TripLifecycleStage, TripStatus } from '@school-bus/shared';
import { StatusBadge, StatusType } from '../ui/StatusBadge';

interface TripLifecycleBadgeProps {
  stage?: TripLifecycleStage | string;
  status?: TripStatus | string;
  className?: string;
}

export function TripLifecycleBadge({ stage, status, className }: TripLifecycleBadgeProps) {
  if (status === TripStatus.CANCELLED || status === 'CANCELLED') {
    return <StatusBadge status="incident" label="Cancelled" className={className} />;
  }
  if (status === TripStatus.ARRIVED_SCHOOL || status === 'ARRIVED_SCHOOL') {
    return <StatusBadge status="info" label="Arrived at School" className={className} />;
  }
  if (status === TripStatus.DELAYED || status === 'DELAYED') {
    return <StatusBadge status="warning" label="Delayed" className={className} />;
  }

  switch (stage) {
    case TripLifecycleStage.NOT_STARTED:
      return <StatusBadge status="inactive" label="Not Started" className={className} />;
    case TripLifecycleStage.STARTED:
      return <StatusBadge status="info" label="Trip Started" className={className} />;
    case TripLifecycleStage.IN_TRANSIT:
      return <StatusBadge status="normal" label="In Transit" className={className} />;
    case TripLifecycleStage.ARRIVED_SCHOOL:
      return <StatusBadge status="info" label="Arrived at School" className={className} />;
    case TripLifecycleStage.COMPLETED:
      return <StatusBadge status="normal" label="Completed" className={className} />;
    default:
      return <StatusBadge status="inactive" label={String(stage || status || 'Scheduled')} className={className} />;
  }
}
