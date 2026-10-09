'use client';

import React, { useState, useEffect } from 'react';
import { AdminSidebar } from '../../../components/layout/AdminSidebar';
import { AdminHeader } from '../../../components/layout/AdminHeader';
import { AdminAccountForm } from '../../../components/admin/AdminAccountForm';

export default function AdminAccountPage() {
  const [schoolName, setSchoolName] = useState<string>('Delhi Public Academy');
  const [schoolCode, setSchoolCode] = useState<string>('DPA-ND');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedSchoolName = localStorage.getItem('sb_school_name');
      const storedSchoolCode = localStorage.getItem('sb_school_code');
      if (storedSchoolName) setSchoolName(storedSchoolName);
      if (storedSchoolCode) setSchoolCode(storedSchoolCode);
    }
  }, []);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <AdminSidebar schoolName={schoolName} schoolCode={schoolCode} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <AdminHeader
          title="Operator Account & Security"
          subtitle="Manage your personal administrator credentials, WhatsApp phone number, and password"
        />

        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          <AdminAccountForm />
        </main>
      </div>
    </div>
  );
}
