'use client';

import React, { useState, useEffect } from 'react';
import { SchoolProfileForm } from '../../../components/school/SchoolProfileForm';
import { useAuth } from '../../../contexts/AuthContext';

export default function SchoolProfilePage() {
  const { user } = useAuth();
  const [schoolId, setSchoolId] = useState<string>(
    user?.schoolId || '111e4567-e89b-12d3-a456-426614174001'
  );

  useEffect(() => {
    if (user?.schoolId) {
      setSchoolId(user.schoolId);
    } else if (typeof window !== 'undefined') {
      const storedSchoolId = localStorage.getItem('sb_school_id');
      if (storedSchoolId) setSchoolId(storedSchoolId);
    }
  }, [user]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">School Profile & Settings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage official institutional identity, physical campus address, and emergency contact points.
        </p>
      </div>

      <SchoolProfileForm schoolId={schoolId} canEdit={true} />
    </div>
  );
}
