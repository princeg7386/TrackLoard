'use client';

import React from 'react';
import { AdminAccountForm } from '../../../components/admin/AdminAccountForm';

export default function AdminAccountPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Operator Account & Security</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage your personal administrator credentials, WhatsApp phone number, and password.
        </p>
      </div>

      <AdminAccountForm />
    </div>
  );
}
