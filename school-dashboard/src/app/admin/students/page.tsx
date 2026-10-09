'use client';

import React from 'react';
import { GraduationCap, Plus, Search, UploadCloud } from 'lucide-react';
import { EmptyState } from '../../../components/ui/EmptyState';

export default function StudentsDirectoryPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Students & Parents</h1>
          <p className="text-sm text-slate-500 mt-1">
            Student roster, assigned pickup/drop stops, parent WhatsApp contacts, and secure live tracking links.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-md border border-slate-300 shadow-2xs transition-colors"
          >
            <UploadCloud className="w-4 h-4 text-slate-500" />
            Bulk Import CSV
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-md shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Student
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div className="relative w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by student name, roll number, parent phone..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500"
              disabled
            />
          </div>
          <span className="text-xs text-slate-500 font-mono">0 students</span>
        </div>

        <div className="p-12">
          <EmptyState
            icon={GraduationCap}
            title="No Students Registered"
            description="Add students and link them to their assigned pickup stops. Parents automatically receive WhatsApp notifications and 1:1 live tracking links."
            actionLabel="Add First Student"
            onAction={() => alert('Student enrollment form will be available in Phase 9.')}
          />
        </div>
      </div>
    </div>
  );
}
