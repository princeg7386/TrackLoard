'use client';

import React from 'react';
import { MapPin, Plus, Search } from 'lucide-react';
import { EmptyState } from '../../../components/ui/EmptyState';

export default function RoutesStopsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Routes & Pickup Stops</h1>
          <p className="text-sm text-slate-500 mt-1">
            Design transport paths, sequence pickup and drop stops with geofences, and assign default schedules.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-md shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Route
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="relative w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by route name, code, area..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500"
              disabled
            />
          </div>
          <span className="text-xs text-slate-500 font-mono">0 routes</span>
        </div>

        <div className="p-12">
          <EmptyState
            icon={MapPin}
            title="No Bus Routes Configured"
            description="Configure your school morning and evening routes with sequenced pickup stops and geofence radiuses."
            actionLabel="Create First Route"
            onAction={() => alert('Route builder will be available in Phase 8.')}
          />
        </div>
      </div>
    </div>
  );
}

