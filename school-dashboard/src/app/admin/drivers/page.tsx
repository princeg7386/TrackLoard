'use client';

import React from 'react';
import { Users, Plus, Search } from 'lucide-react';
import { EmptyState } from '../../../components/ui/EmptyState';

export default function DriversDirectoryPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Drivers Directory</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage authorized school bus drivers, mobile credentials, license records, and WhatsApp access.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-md shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Driver
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="relative w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by driver name, phone, license..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500"
              disabled
            />
          </div>
          <span className="text-xs text-slate-500 font-mono">0 drivers</span>
        </div>

        <div className="p-12">
          <EmptyState
            icon={Users}
            title="No Drivers Registered Yet"
            description="Create driver profiles with phone numbers to issue secure mobile login PINs and WhatsApp operational triggers."
            actionLabel="Add First Driver"
            onAction={() => alert('Driver onboarding form will be available in Phase 7.')}
          />
        </div>
      </div>
    </div>
  );
}
