'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Bus, Plus, Search, RefreshCw, AlertCircle, WifiOff } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { BusWithDriver } from '@school-bus/shared';
import { fetchBuses } from '../../../services/busApi';
import { BusListTable } from '../../../components/bus/BusListTable';
import { CreateBusModal } from '../../../components/bus/CreateBusModal';
import { AssignBusModal } from '../../../components/bus/AssignBusModal';

export default function FleetBusesPage() {
  const { user } = useAuth();
  const [schoolId, setSchoolId] = useState<string>(
    user?.schoolId || '111e4567-e89b-12d3-a456-426614174001'
  );

  const [buses, setBuses] = useState<BusWithDriver[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedBusForAssign, setSelectedBusForAssign] = useState<BusWithDriver | null>(null);
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

  const loadBuses = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await fetchBuses(schoolId);
      setBuses(data);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load school fleet.');
    } finally {
      setIsLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    loadBuses();
  }, [loadBuses]);

  const handleBusCreated = (newBus: BusWithDriver) => {
    setBuses((prev) => [newBus, ...prev]);
  };

  const handleBusUpdated = (updatedBus: BusWithDriver) => {
    setBuses((prev) => prev.map((b) => (b.id === updatedBus.id ? updatedBus : b)));
  };

  const filteredBuses = buses.filter(
    (b) =>
      b.busNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      b.registrationNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (b.driverName && b.driverName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (b.assignedRouteName && b.assignedRouteName.toLowerCase().includes(searchTerm.toLowerCase()))
  );

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
            onClick={loadBuses}
            className="px-2 py-1 bg-amber-200 hover:bg-amber-300 font-semibold rounded text-amber-900"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Header with Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Fleet & Buses</h1>
          <p className="text-sm text-slate-500 mt-1">
            Register and manage school transport vehicles, registration numbers, and assigned primary drivers.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={loadBuses}
            title="Refresh Fleet"
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
            Add Vehicle
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
            onClick={loadBuses}
            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-md shadow-2xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* Fleet Table Card */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        {/* Search and Counts Filter Bar */}
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by bus number, registration, driver, route..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500"
            />
          </div>
          <div className="text-xs text-slate-500 font-mono">
            {filteredBuses.length} of {buses.length} vehicles
          </div>
        </div>

        {/* Bus Table View */}
        <BusListTable
          buses={filteredBuses}
          isLoading={isLoading}
          onAddBus={() => setIsCreateModalOpen(true)}
          onManageAssignments={(bus) => setSelectedBusForAssign(bus)}
        />
      </div>

      {/* Create Bus Modal */}
      <CreateBusModal
        schoolId={schoolId}
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={handleBusCreated}
      />

      {/* Assign Driver & Route Modal */}
      <AssignBusModal
        schoolId={schoolId}
        bus={selectedBusForAssign}
        isOpen={!!selectedBusForAssign}
        onClose={() => setSelectedBusForAssign(null)}
        onSuccess={handleBusUpdated}
      />
    </div>
  );
}
