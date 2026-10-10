'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  GraduationCap,
  Plus,
  Search,
  RefreshCw,
  AlertCircle,
  WifiOff,
  Filter,
  Users,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { StudentWithDetails } from '@school-bus/shared';
import { fetchStudents } from '../../../services/studentApi';
import { StudentListTable } from '../../../components/student/StudentListTable';
import { CreateStudentModal } from '../../../components/student/CreateStudentModal';
import { ManageParentModal } from '../../../components/student/ManageParentModal';
import { AssignTransportModal } from '../../../components/student/AssignTransportModal';

export default function StudentsDirectoryPage() {
  const { user } = useAuth();
  const [schoolId, setSchoolId] = useState<string>(
    user?.schoolId || '111e4567-e89b-12d3-a456-426614174001'
  );

  const [students, setStudents] = useState<StudentWithDetails[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClassFilter, setSelectedClassFilter] = useState('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedStudentForParent, setSelectedStudentForParent] = useState<StudentWithDetails | null>(null);
  const [selectedStudentForTransport, setSelectedStudentForTransport] = useState<StudentWithDetails | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    if (user?.schoolId) {
      setSchoolId(user.schoolId);
    } else if (typeof window !== 'undefined') {
      const storedId = localStorage.getItem('sb_school_id');
      if (storedId) setSchoolId(storedId);
    }
  }, [user]);

  // Online / Offline monitor
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOffline(true);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loadStudents = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await fetchStudents(schoolId);
      setStudents(data);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load student directory.');
    } finally {
      setIsLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    loadStudents();
  }, [loadStudents]);

  const handleStudentCreated = (newStudent: StudentWithDetails) => {
    setStudents((prev) => [newStudent, ...prev]);
  };

  const handleParentUpdated = (updatedStudent: StudentWithDetails) => {
    setStudents((prev) =>
      prev.map((s) => (s.id === updatedStudent.id ? updatedStudent : s))
    );
    setSelectedStudentForParent(null);
  };

  const handleTransportUpdated = (updatedStudent: StudentWithDetails) => {
    setStudents((prev) =>
      prev.map((s) => (s.id === updatedStudent.id ? updatedStudent : s))
    );
    setSelectedStudentForTransport(null);
  };

  // Distinct classes for quick filter
  const distinctClasses = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => {
      if (s.classGrade) set.add(s.classGrade);
    });
    return Array.from(set).sort();
  }, [students]);

  const filteredStudents = useMemo(() => {
    return students.filter((s) => {
      const matchesSearch =
        s.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.admissionNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (s.rollNumber && s.rollNumber.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (s.emergencyContactPhone && s.emergencyContactPhone.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (s.parentPhone && s.parentPhone.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (s.pickupStopName && s.pickupStopName.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (s.assignedBusNumber && s.assignedBusNumber.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesClass =
        selectedClassFilter === 'ALL' || s.classGrade.toLowerCase() === selectedClassFilter.toLowerCase();

      return matchesSearch && matchesClass;
    });
  }, [students, searchTerm, selectedClassFilter]);

  return (
    <div className="space-y-6">
      {/* Offline Alert */}
      {isOffline && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between text-amber-900 text-xs">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
            <span>You are currently offline. Changes will sync when connectivity is restored.</span>
          </div>
          <button
            type="button"
            onClick={loadStudents}
            className="px-2 py-1 bg-amber-200 hover:bg-amber-300 font-semibold rounded text-amber-900"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Header with Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Student Directory</h1>
          <p className="text-sm text-slate-500 mt-1">
            Student roster, academic grade/section records, transport stop allocations, and parent WhatsApp pairings.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={loadStudents}
            title="Refresh Directory"
            className="p-2 bg-white hover:bg-slate-50 text-slate-600 rounded-md border border-slate-300 shadow-2xs transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-md shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Student
          </button>
        </div>
      </div>

      {/* Error State */}
      {errorMessage && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex items-center justify-between text-rose-900 text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={loadStudents}
            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-md shadow-2xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Student Table Card */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        {/* Search and Filter Bar */}
        <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/50">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
            {/* Search input */}
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by student name, ID, roll no, stop, bus..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500"
              />
            </div>

            {/* Class filter dropdown */}
            {distinctClasses.length > 0 && (
              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <select
                  value={selectedClassFilter}
                  onChange={(e) => setSelectedClassFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500 text-slate-700"
                >
                  <option value="ALL">All Classes ({students.length})</option>
                  {distinctClasses.map((cls) => (
                    <option key={cls} value={cls}>
                      {cls}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="text-xs text-slate-500 font-mono">
            {filteredStudents.length} of {students.length} students
          </div>
        </div>

        {/* Student Table View */}
        <StudentListTable
          students={filteredStudents}
          isLoading={isLoading}
          onAddStudent={() => setIsCreateModalOpen(true)}
          onManageParent={(student) => setSelectedStudentForParent(student)}
          onAssignTransport={(student) => setSelectedStudentForTransport(student)}
          onViewDetail={(student) => {
            // Prepared for subsequent micro-phases
          }}
        />
      </div>

      {/* Create Student Modal */}
      <CreateStudentModal
        schoolId={schoolId}
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={handleStudentCreated}
      />

      {/* Manage Parent / Guardian Modal */}
      <ManageParentModal
        schoolId={schoolId}
        student={selectedStudentForParent}
        isOpen={Boolean(selectedStudentForParent)}
        onClose={() => setSelectedStudentForParent(null)}
        onSuccess={handleParentUpdated}
      />

      {/* Assign Transport Modal */}
      <AssignTransportModal
        schoolId={schoolId}
        student={selectedStudentForTransport}
        isOpen={Boolean(selectedStudentForTransport)}
        onClose={() => setSelectedStudentForTransport(null)}
        onSuccess={handleTransportUpdated}
      />
    </div>
  );
}

