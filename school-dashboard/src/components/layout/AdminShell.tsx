'use client';

import React, { useState } from 'react';
import { AdminSidebar } from './AdminSidebar';
import { AdminHeader } from './AdminHeader';
import { AuthGuard } from '../auth/AuthGuard';
import { useAuth } from '../../contexts/AuthContext';

interface AdminShellProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}

export function AdminShell({ children, title, subtitle }: AdminShellProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { user } = useAuth();

  return (
    <AuthGuard>
      <div className="flex h-screen bg-slate-50 overflow-hidden">
        {/* Responsive Sidebar Navigation */}
        <AdminSidebar
          schoolName={user?.schoolId ? 'School Transport' : 'Transport Admin'}
          schoolCode="FLEET"
          isOpen={isMobileMenuOpen}
          onClose={() => setIsMobileMenuOpen(false)}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
          <AdminHeader
            title={title}
            subtitle={subtitle}
            onToggleMobileMenu={() => setIsMobileMenuOpen((prev) => !prev)}
          />

          <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
            <div className="max-w-7xl mx-auto w-full">
              {children}
            </div>
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
