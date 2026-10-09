'use client';

import React from 'react';
import { Bus, Plus, Search } from 'lucide-react';
import { EmptyState } from '../../../components/ui/EmptyState';

export default function FleetBusesPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Fleet & Buses</h1>
          <p className="text-sm text-slate-500 mt-1">
            Register and manage school transport vehicles, registration numbers, and assigned primary drivers.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-md shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Vehicle
          </button>
        </div>
      </div>

      {/* Fleet Table Card */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="relative w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by bus number, registration..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500"
              disabled
            />
          </div>
          <span className="text-xs text-slate-500 font-mono">0 vehicles</span>
        </div>

        <div className="p-12">
          <EmptyState
            icon={Bus}
            title="No Fleet Vehicles Added Yet"
            description="Add your school transport buses to assign routes, pair drivers, and enable live GPS tracking."
            actionLabel="Add First Bus"
            onAction={() => alert('Vehicle registration form will be available in Phase 6.')}
          />
        </div>
      </div>
    </div>
  );
}
