'use client';

import React, { useState, useEffect } from 'react';
import { AdminSidebar } from '../../../components/layout/AdminSidebar';
import { AdminHeader } from '../../../components/layout/AdminHeader';
import { SchoolProfileForm } from '../../../components/school/SchoolProfileForm';

export default function SchoolProfilePage() {
  // Demo / active session state (populated from JWT or auth session)
  const [schoolId, setSchoolId] = useState<string>('111e4567-e89b-12d3-a456-426614174001');
  const [schoolName, setSchoolName] = useState<string>('Delhi Public Academy');
  const [schoolCode, setSchoolCode] = useState<string>('DPA-ND');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedSchoolId = localStorage.getItem('sb_school_id');
      const storedSchoolName = localStorage.getItem('sb_school_name');
      const storedSchoolCode = localStorage.getItem('sb_school_code');

      if (storedSchoolId) setSchoolId(storedSchoolId);
      if (storedSchoolName) setSchoolName(storedSchoolName);
      if (storedSchoolCode) setSchoolCode(storedSchoolCode);
    }
  }, []);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar Navigation */}
      <AdminSidebar schoolName={schoolName} schoolCode={schoolCode} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <AdminHeader
          title="School Profile & Settings"
          subtitle="Manage official institutional identity, physical campus address, and contact points"
        />

        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          <SchoolProfileForm schoolId={schoolId} canEdit={true} />
        </main>
      </div>
    </div>
  );
}
