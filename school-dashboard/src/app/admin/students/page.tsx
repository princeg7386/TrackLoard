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
  MessageSquare,
  Phone,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { StudentWithDetails, ParentRecordWithStudent } from '@school-bus/shared';
import { fetchStudents, fetchSchoolParents } from '../../../services/studentApi';
import { StudentListTable } from '../../../components/student/StudentListTable';
import { ParentListTable } from '../../../components/student/ParentListTable';
import { ParentAssignmentModal } from '../../../components/student/ParentAssignmentModal';
import { ParentNotificationStatusModal } from '../../../components/student/ParentNotificationStatusModal';
import { CreateStudentModal } from '../../../components/student/CreateStudentModal';
import { ManageParentModal } from '../../../components/student/ManageParentModal';
import { AssignTransportModal } from '../../../components/student/AssignTransportModal';
import { StudentDetailModal } from '../../../components/student/StudentDetailModal';
import { EditStudentModal } from '../../../components/student/EditStudentModal';
import { DeleteStudentDialog } from '../../../components/student/DeleteStudentDialog';
import { StudentTransportHistoryModal } from '../../../components/student/StudentTransportHistoryModal';

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

  // Tab switcher state
  const [activeTab, setActiveTab] = useState<'students' | 'parents'>('students');

  // Parents Directory State
  const [parents, setParents] = useState<ParentRecordWithStudent[]>([]);
  const [isParentsLoading, setIsParentsLoading] = useState(false);
  const [parentSearchTerm, setParentSearchTerm] = useState('');
  const [parentRelationshipFilter, setParentRelationshipFilter] = useState('ALL');
  const [parentStatusFilter, setParentStatusFilter] = useState('ALL');

  // Modal active targets
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedStudentForParent, setSelectedStudentForParent] = useState<StudentWithDetails | null>(null);
  const [selectedStudentForTransport, setSelectedStudentForTransport] = useState<StudentWithDetails | null>(null);
  const [selectedStudentForDetail, setSelectedStudentForDetail] = useState<StudentWithDetails | null>(null);
  const [selectedStudentForEdit, setSelectedStudentForEdit] = useState<StudentWithDetails | null>(null);
  const [selectedStudentForDelete, setSelectedStudentForDelete] = useState<StudentWithDetails | null>(null);
  const [selectedStudentForHistory, setSelectedStudentForHistory] = useState<StudentWithDetails | null>(null);
  const [selectedParentForAssignment, setSelectedParentForAssignment] = useState<ParentRecordWithStudent | null>(null);
  const [selectedParentForStatus, setSelectedParentForStatus] = useState<ParentRecordWithStudent | null>(null);

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

  const loadParents = useCallback(async () => {
    setIsParentsLoading(true);
    try {
      const data = await fetchSchoolParents(schoolId);
      setParents(data);
    } catch (err: any) {
      // Non-blocking error for tab
    } finally {
      setIsParentsLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    loadStudents();
    loadParents();
  }, [loadStudents, loadParents]);

  const handleStudentCreated = (newStudent: StudentWithDetails) => {
    setStudents((prev) => [newStudent, ...prev]);
    loadParents();
  };

  const handleParentUpdated = (updatedStudent: StudentWithDetails) => {
    setStudents((prev) =>
      prev.map((s) => (s.id === updatedStudent.id ? updatedStudent : s))
    );
    setSelectedStudentForParent(null);
    loadParents();
  };

  const handleTransportUpdated = (updatedStudent: StudentWithDetails) => {
    setStudents((prev) =>
      prev.map((s) => (s.id === updatedStudent.id ? updatedStudent : s))
    );
    setSelectedStudentForTransport(null);
    loadParents();
  };

  const handleStudentEdited = (updatedStudent: StudentWithDetails) => {
    setStudents((prev) =>
      prev.map((s) => (s.id === updatedStudent.id ? updatedStudent : s))
    );
    setSelectedStudentForEdit(null);
    if (selectedStudentForDetail?.id === updatedStudent.id) {
      setSelectedStudentForDetail(updatedStudent);
    }
    loadParents();
  };

  const handleStudentDeleted = (deletedId: string) => {
    setStudents((prev) => prev.filter((s) => s.id !== deletedId));
    setSelectedStudentForDelete(null);
    if (selectedStudentForDetail?.id === deletedId) {
      setSelectedStudentForDetail(null);
    }
    loadParents();
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

  const filteredParents = useMemo(() => {
    return parents.filter((p) => {
      const matchesSearch =
        !parentSearchTerm.trim() ||
        p.fullName.toLowerCase().includes(parentSearchTerm.toLowerCase()) ||
        p.phone.toLowerCase().includes(parentSearchTerm.toLowerCase()) ||
        (p.email && p.email.toLowerCase().includes(parentSearchTerm.toLowerCase())) ||
        p.student.fullName.toLowerCase().includes(parentSearchTerm.toLowerCase()) ||
        p.student.admissionNumber.toLowerCase().includes(parentSearchTerm.toLowerCase()) ||
        (p.student.pickupStopName && p.student.pickupStopName.toLowerCase().includes(parentSearchTerm.toLowerCase())) ||
        (p.student.assignedBusNumber && p.student.assignedBusNumber.toLowerCase().includes(parentSearchTerm.toLowerCase()));

      const matchesRel =
        parentRelationshipFilter === 'ALL' ||
        p.relationship.toUpperCase() === parentRelationshipFilter.toUpperCase();

      const matchesStatus =
        parentStatusFilter === 'ALL' ||
        p.whatsAppStatus === parentStatusFilter;

      return matchesSearch && matchesRel && matchesStatus;
    });
  }, [parents, parentSearchTerm, parentRelationshipFilter, parentStatusFilter]);

  const handleParentRowManage = (parent: ParentRecordWithStudent) => {
    const studentMatch = students.find((s) => s.id === parent.studentId);
    if (studentMatch) {
      setSelectedStudentForParent(studentMatch);
    } else {
      // Fallback object with minimal properties
      setSelectedStudentForParent({
        id: parent.studentId,
        schoolId: parent.schoolId,
        fullName: parent.student.fullName,
        admissionNumber: parent.student.admissionNumber,
        classGrade: parent.student.classGrade,
        section: parent.student.section,
        rollNumber: parent.student.rollNumber || null,
        emergencyContactPhone: parent.student.emergencyContactPhone || null,
        parentName: parent.fullName,
        parentPhone: parent.phone,
        parentRelationship: parent.relationship,
        parentCount: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const handleStudentViewFromParent = (studentId: string) => {
    const studentMatch = students.find((s) => s.id === studentId);
    if (studentMatch) {
      setSelectedStudentForDetail(studentMatch);
    }
  };

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

      {/* Navigation Tabs */}
      <div className="flex items-center gap-6 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('students')}
          className={`flex items-center gap-2 pb-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'students'
              ? 'border-sky-600 text-sky-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <GraduationCap className="w-4 h-4" />
          <span>Students Roster</span>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-mono ${
              activeTab === 'students' ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {students.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('parents')}
          className={`flex items-center gap-2 pb-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'parents'
              ? 'border-sky-600 text-sky-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span>Parents & WhatsApp Directory</span>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-mono ${
              activeTab === 'parents' ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {parents.length}
          </span>
        </button>
      </div>

      {/* Directory Table Card */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        {activeTab === 'students' ? (
          <>
            {/* Students Search and Filter Bar */}
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
              onViewDetail={(student) => setSelectedStudentForDetail(student)}
            />
          </>
        ) : (
          <>
            {/* Parents Search and Filter Bar */}
            <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/50">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
                {/* Search input */}
                <div className="relative w-full sm:w-80">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search by parent name, mobile, student, stop..."
                    value={parentSearchTerm}
                    onChange={(e) => setParentSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500"
                  />
                </div>

                {/* Relationship filter */}
                <div className="flex items-center gap-2">
                  <select
                    value={parentRelationshipFilter}
                    onChange={(e) => setParentRelationshipFilter(e.target.value)}
                    className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500 text-slate-700"
                  >
                    <option value="ALL">All Relationships</option>
                    <option value="MOTHER">Mother</option>
                    <option value="FATHER">Father</option>
                    <option value="GUARDIAN">Guardian</option>
                    <option value="PARENT">Parent</option>
                  </select>
                </div>

                {/* WhatsApp Status filter */}
                <div className="flex items-center gap-2">
                  <select
                    value={parentStatusFilter}
                    onChange={(e) => setParentStatusFilter(e.target.value)}
                    className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500 text-slate-700"
                  >
                    <option value="ALL">All WhatsApp Statuses</option>
                    <option value="ACTIVE_TOKEN">Live Tracking Active</option>
                    <option value="LINKED">WhatsApp Linked</option>
                    <option value="NOT_LINKED">No Mobile Linked</option>
                  </select>
                </div>
              </div>

              <div className="text-xs text-slate-500 font-mono">
                {filteredParents.length} of {parents.length} parents
              </div>
            </div>

            {/* Parent Table View */}
            <ParentListTable
              parents={filteredParents}
              isLoading={isParentsLoading}
              onRefresh={loadParents}
              onManageParent={handleParentRowManage}
              onViewStudent={handleStudentViewFromParent}
              onViewAssignment={(parent) => setSelectedParentForAssignment(parent)}
              onViewNotificationStatus={(parent) => setSelectedParentForStatus(parent)}
            />
          </>
        )}
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

      {/* Student Comprehensive Detail Modal */}
      <StudentDetailModal
        student={selectedStudentForDetail}
        isOpen={Boolean(selectedStudentForDetail)}
        onClose={() => setSelectedStudentForDetail(null)}
        onEdit={(student) => setSelectedStudentForEdit(student)}
        onAssignTransport={(student) => setSelectedStudentForTransport(student)}
        onManageParent={(student) => setSelectedStudentForParent(student)}
        onViewHistory={(student) => setSelectedStudentForHistory(student)}
        onDelete={(student) => setSelectedStudentForDelete(student)}
      />

      {/* Edit Student Modal */}
      <EditStudentModal
        schoolId={schoolId}
        student={selectedStudentForEdit}
        isOpen={Boolean(selectedStudentForEdit)}
        onClose={() => setSelectedStudentForEdit(null)}
        onSuccess={handleStudentEdited}
      />

      {/* Delete Student Dialog */}
      <DeleteStudentDialog
        schoolId={schoolId}
        student={selectedStudentForDelete}
        isOpen={Boolean(selectedStudentForDelete)}
        onClose={() => setSelectedStudentForDelete(null)}
        onSuccess={handleStudentDeleted}
      />

      {/* Student Transport History Modal */}
      <StudentTransportHistoryModal
        schoolId={schoolId}
        student={selectedStudentForHistory}
        isOpen={Boolean(selectedStudentForHistory)}
        onClose={() => setSelectedStudentForHistory(null)}
      />

      {/* Parent Assignment & Communication History Modal */}
      <ParentAssignmentModal
        schoolId={schoolId}
        parent={selectedParentForAssignment}
        isOpen={Boolean(selectedParentForAssignment)}
        onClose={() => setSelectedParentForAssignment(null)}
        onAssignmentUpdated={() => {
          loadParents();
          loadStudents();
        }}
        onViewStudentDetail={(studentId) => {
          handleStudentViewFromParent(studentId);
        }}
      />

      {/* Parent Notification Health & Link Activity Modal */}
      <ParentNotificationStatusModal
        parent={selectedParentForStatus}
        isOpen={Boolean(selectedParentForStatus)}
        onClose={() => setSelectedParentForStatus(null)}
        onPreferencesUpdated={() => {
          loadParents();
        }}
      />
    </div>
  );
}


