'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  MapPin,
  Plus,
  RefreshCw,
  Compass,
  AlertCircle,
  Bus,
  Layers,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  type RouteDetail,
  type RouteStopDetail,
  type RouteStopCalculationResult,
} from '@school-bus/shared';
import { RouteApiService } from '../../../services/routeApi';
import { RouteMapCanvas } from '../../../components/route/RouteMapCanvas';
import { RouteDetailPanel } from '../../../components/route/RouteDetailPanel';
import { CreateRouteModal } from '../../../components/route/CreateRouteModal';
import { AddStopModal } from '../../../components/route/AddStopModal';
import { EmptyState } from '../../../components/ui/EmptyState';

export default function RoutesStopsPage() {
  const { user } = useAuth();
  const [schoolId, setSchoolId] = useState<string>(user?.schoolId || '');

  // Routes & selected route state
  const [routes, setRoutes] = useState<RouteDetail[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<RouteDetail | null>(null);

  // Stops & directions state
  const [stops, setStops] = useState<RouteStopDetail[]>([]);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [directions, setDirections] = useState<RouteStopCalculationResult | null>(null);

  // Loading & error states
  const [isLoadingRoutes, setIsLoadingRoutes] = useState<boolean>(true);
  const [isLoadingStops, setIsLoadingStops] = useState<boolean>(false);
  const [isDirectionsLoading, setIsDirectionsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [isCreateRouteOpen, setIsCreateRouteOpen] = useState<boolean>(false);
  const [isAddStopOpen, setIsAddStopOpen] = useState<boolean>(false);

  // Sync school ID
  useEffect(() => {
    if (user?.schoolId) {
      setSchoolId(user.schoolId);
    } else if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('sb_school_id');
      if (stored) setSchoolId(stored);
    }
  }, [user]);

  // Load routes for the school
  const loadRoutes = useCallback(
    async (keepSelectedId?: string) => {
      if (!schoolId) return;
      try {
        setIsLoadingRoutes(true);
        setError(null);
        const data = await RouteApiService.listRoutes(schoolId);
        setRoutes(data);

        if (data.length > 0) {
          const targetId = keepSelectedId && data.some((r) => r.id === keepSelectedId)
            ? keepSelectedId
            : selectedRouteId && data.some((r) => r.id === selectedRouteId)
            ? selectedRouteId
            : data[0]!.id;

          setSelectedRouteId(targetId);
          setSelectedRoute(data.find((r) => r.id === targetId) || data[0]!);
        } else {
          setSelectedRouteId(null);
          setSelectedRoute(null);
          setStops([]);
          setDirections(null);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load transport routes.');
      } finally {
        setIsLoadingRoutes(false);
      }
    },
    [schoolId, selectedRouteId]
  );

  // Load stops and directions for selected route
  const loadRouteStopsAndDirections = useCallback(
    async (routeId: string) => {
      if (!schoolId || !routeId) return;
      try {
        setIsLoadingStops(true);
        const stopsData = await RouteApiService.listRouteStops(schoolId, routeId);
        setStops(stopsData);

        // Fetch directions if stops >= 2
        if (stopsData.length >= 2) {
          try {
            setIsDirectionsLoading(true);
            const dir = await RouteApiService.getRouteDirections(schoolId, routeId);
            setDirections(dir);
          } catch {
            // Non-blocking fallback to straight lines if directions service is unreachable
            setDirections(null);
          } finally {
            setIsDirectionsLoading(false);
          }
        } else {
          setDirections(null);
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load stops for this route.');
      } finally {
        setIsLoadingStops(false);
      }
    },
    [schoolId]
  );

  // Initial load
  useEffect(() => {
    if (schoolId) {
      loadRoutes();
    }
  }, [schoolId]);

  // Trigger stops load when selected route changes
  useEffect(() => {
    if (selectedRouteId) {
      const match = routes.find((r) => r.id === selectedRouteId);
      if (match) setSelectedRoute(match);
      loadRouteStopsAndDirections(selectedRouteId);
    }
  }, [selectedRouteId, routes]);

  // Recalculate directions on demand
  const handleRefreshDirections = async () => {
    if (!schoolId || !selectedRouteId) return;
    try {
      setIsDirectionsLoading(true);
      const dir = await RouteApiService.getRouteDirections(schoolId, selectedRouteId);
      setDirections(dir);
    } catch (err: any) {
      setError(err.message || 'Failed to recalculate route directions.');
    } finally {
      setIsDirectionsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span>Route Map & Pickup Points</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Visualize transit paths, sequenced pickup stops, geofences, and vehicle assignments.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Route Selector Dropdown */}
          {routes.length > 0 && (
            <div className="relative">
              <select
                value={selectedRouteId || ''}
                onChange={(e) => setSelectedRouteId(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 shadow-2xs focus:outline-hidden focus:ring-1 focus:ring-sky-500 cursor-pointer"
              >
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} — {r.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          )}

          <button
            type="button"
            onClick={() => loadRoutes(selectedRouteId || undefined)}
            disabled={isLoadingRoutes}
            title="Refresh routes"
            className="p-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 rounded-lg shadow-2xs transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingRoutes ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => setIsCreateRouteOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Route
          </button>
        </div>
      </div>

      {/* 2. Inline Error Banner */}
      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between gap-2 text-xs text-rose-700 animate-in fade-in duration-150">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setError(null);
              loadRoutes(selectedRouteId || undefined);
            }}
            className="font-semibold underline hover:text-rose-900"
          >
            Retry
          </button>
        </div>
      )}

      {/* 3. Main Operational View */}
      {isLoadingRoutes ? (
        // Loading Skeleton
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[600px]">
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-4 animate-pulse space-y-4">
            <div className="h-6 bg-slate-200 rounded w-1/2" />
            <div className="h-4 bg-slate-100 rounded w-3/4" />
            <div className="grid grid-cols-2 gap-2 pt-2">
              <div className="h-16 bg-slate-100 rounded-lg" />
              <div className="h-16 bg-slate-100 rounded-lg" />
            </div>
            <div className="h-px bg-slate-200 my-4" />
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-12 bg-slate-100 rounded-lg" />
              ))}
            </div>
          </div>
          <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-center animate-pulse">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Compass className="w-4 h-4 animate-spin text-sky-400" />
              <span>Loading route map canvas...</span>
            </div>
          </div>
        </div>
      ) : routes.length === 0 ? (
        // Empty State: No routes created yet
        <div className="bg-white border border-slate-200 rounded-xl p-12 shadow-2xs">
          <EmptyState
            icon={MapPin}
            title="No Transit Routes Configured"
            description="Configure your school morning and evening routes with sequenced pickup stops and geofence radiuses."
            actionLabel="Create First Route"
            onAction={() => setIsCreateRouteOpen(true)}
          />
        </div>
      ) : (
        // Active Route Map & Details Split View
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[620px]">
          {/* Left Panel: Route Details & Sequenced Timeline (Task 3) */}
          <div className="lg:col-span-4 h-full min-h-[580px]">
            {selectedRoute && (
              <RouteDetailPanel
                route={selectedRoute}
                stops={stops}
                totalDistanceMeters={directions?.totalDistanceMeters}
                selectedStopId={selectedStopId}
                onSelectStop={(stop) => setSelectedStopId(stop.id)}
                onAddStop={() => setIsAddStopOpen(true)}
                onRefreshDirections={handleRefreshDirections}
                isDirectionsLoading={isDirectionsLoading}
              />
            )}
          </div>

          {/* Right Panel: Interactive Route Map Canvas (Tasks 1 & 2) */}
          <div className="lg:col-span-8 h-full min-h-[580px]">
            <RouteMapCanvas
              stops={stops}
              pathPolyline={directions?.pathPolyline || selectedRoute?.pathPolyline}
              selectedStopId={selectedStopId}
              onSelectStop={(stop) => setSelectedStopId(stop.id)}
              isLoading={isLoadingStops}
            />
          </div>
        </div>
      )}

      {/* 4. Modals */}
      {schoolId && (
        <>
          <CreateRouteModal
            schoolId={schoolId}
            isOpen={isCreateRouteOpen}
            onClose={() => setIsCreateRouteOpen(false)}
            onSuccess={(newRoute) => {
              loadRoutes(newRoute.id);
            }}
          />

          {selectedRouteId && (
            <AddStopModal
              schoolId={schoolId}
              routeId={selectedRouteId}
              isOpen={isAddStopOpen}
              onClose={() => setIsAddStopOpen(false)}
              onSuccess={() => {
                loadRouteStopsAndDirections(selectedRouteId);
                // Also refresh routes list to update stop counts
                loadRoutes(selectedRouteId);
              }}
              defaultSequenceOrder={stops.length + 1}
            />
          )}
        </>
      )}
    </div>
  );
}
