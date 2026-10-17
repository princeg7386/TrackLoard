'use client';

import React, { useMemo, useState, useEffect } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Layers,
  MapPin,
  Clock,
  Users,
  Compass,
  Radio,
  Eye,
} from 'lucide-react';
import {
  type RouteStopDetail,
  type MapTileLayerOption,
  FREE_MAP_TILE_PROVIDERS,
  latLngToTile,
  getOsmTileUrl,
  decodePolyline,
} from '@school-bus/shared';

interface RouteMapCanvasProps {
  stops: RouteStopDetail[];
  pathPolyline?: string | null;
  selectedStopId?: string | null;
  onSelectStop?: (stop: RouteStopDetail) => void;
  isLoading?: boolean;
}

const SVG_WIDTH = 900;
const SVG_HEIGHT = 580;

export function RouteMapCanvas({
  stops,
  pathPolyline,
  selectedStopId,
  onSelectStop,
  isLoading = false,
}: RouteMapCanvasProps) {
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hoveredStop, setHoveredStop] = useState<RouteStopDetail | null>(null);
  const [mapLayer, setMapLayer] = useState<MapTileLayerOption>('osm_standard');
  const [showGeofences, setShowGeofences] = useState<boolean>(true);

  // Decode route path polyline if provided
  const polylineCoords = useMemo<[number, number][]>(() => {
    if (!pathPolyline || pathPolyline === '[]') return [];
    try {
      return decodePolyline(pathPolyline);
    } catch {
      return [];
    }
  }, [pathPolyline]);

  // Compute bounding box covering stops and decoded polyline points
  const bounds = useMemo(() => {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;

    for (const s of stops) {
      if (s.latitude < minLat) minLat = s.latitude;
      if (s.latitude > maxLat) maxLat = s.latitude;
      if (s.longitude < minLng) minLng = s.longitude;
      if (s.longitude > maxLng) maxLng = s.longitude;
    }

    for (const [lat, lng] of polylineCoords) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }

    if (minLat === Infinity || minLng === Infinity) {
      // Default fallback (Delhi NCR)
      return {
        minLat: 28.52,
        maxLat: 28.62,
        minLng: 77.2,
        maxLng: 77.3,
      };
    }

    // Add 20% padding
    const latSpan = Math.max(maxLat - minLat, 0.015);
    const lngSpan = Math.max(maxLng - minLng, 0.015);

    return {
      minLat: minLat - latSpan * 0.2,
      maxLat: maxLat + latSpan * 0.2,
      minLng: minLng - lngSpan * 0.2,
      maxLng: maxLng + lngSpan * 0.2,
    };
  }, [stops, polylineCoords]);

  // Geographic projection helper
  const project = (lat: number, lng: number) => {
    const latRange = bounds.maxLat - bounds.minLat || 0.001;
    const lngRange = bounds.maxLng - bounds.minLng || 0.001;

    const x = ((lng - bounds.minLng) / lngRange) * SVG_WIDTH;
    const y = ((bounds.maxLat - lat) / latRange) * SVG_HEIGHT;

    // Apply zoom and pan
    const centerX = SVG_WIDTH / 2;
    const centerY = SVG_HEIGHT / 2;
    const zoomedX = centerX + (x - centerX) * zoomLevel + panOffset.x;
    const zoomedY = centerY + (y - centerY) * zoomLevel + panOffset.y;

    return { x: zoomedX, y: zoomedY };
  };

  // Convert meters to approximate SVG pixel radius
  const getPixelRadius = (radiusMeters: number) => {
    const latRange = bounds.maxLat - bounds.minLat || 0.001;
    // 1 deg latitude is roughly 111,000 meters
    const metersPerPixel = (latRange * 111000) / SVG_HEIGHT;
    const rawPixels = radiusMeters / (metersPerPixel || 1);
    return Math.max(8, rawPixels * zoomLevel);
  };

  // Reset to initial bounds
  const handleResetBounds = () => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  };

  // Cycle map layers
  const cycleMapLayer = () => {
    setMapLayer((prev) => {
      if (prev === 'osm_standard') return 'carto_light';
      if (prev === 'carto_light') return 'canvas';
      return 'osm_standard';
    });
  };

  // Construct path SVG string
  const pathD = useMemo(() => {
    if (polylineCoords.length > 1) {
      return polylineCoords.reduce((acc, [lat, lng], idx) => {
        const pt = project(lat, lng);
        return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
      }, '');
    }

    // Fallback: connect stops sequentially
    if (stops.length > 1) {
      return stops.reduce((acc, stop, idx) => {
        const pt = project(stop.latitude, stop.longitude);
        return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
      }, '');
    }

    return '';
  }, [polylineCoords, stops, bounds, zoomLevel, panOffset]);

  // Center on selected stop when it changes
  useEffect(() => {
    if (selectedStopId) {
      const match = stops.find((s) => s.id === selectedStopId);
      if (match) {
        // center coordinate
        const pt = project(match.latitude, match.longitude);
        const dx = SVG_WIDTH / 2 - pt.x;
        const dy = SVG_HEIGHT / 2 - pt.y;
        setPanOffset((prev) => ({ x: prev.x + dx * 0.4, y: prev.y + dy * 0.4 }));
      }
    }
  }, [selectedStopId]);

  return (
    <div className="relative w-full h-full min-h-[520px] bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-inner flex flex-col select-none">
      {/* Top Map Controls Overlay */}
      <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto bg-slate-900/90 backdrop-blur-md border border-slate-700/80 px-3 py-1.5 rounded-lg shadow-md text-xs text-slate-300">
          <Compass className="w-3.5 h-3.5 text-sky-400 animate-spin-slow" />
          <span className="font-semibold text-white tracking-wide">
            {FREE_MAP_TILE_PROVIDERS[mapLayer].name}
          </span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400 font-mono text-[11px]">{stops.length} Stops</span>
          {polylineCoords.length > 0 && (
            <>
              <span className="text-slate-500">|</span>
              <span className="text-emerald-400 text-[11px] font-mono">Road Snapped</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 pointer-events-auto bg-slate-900/90 backdrop-blur-md border border-slate-700/80 p-1 rounded-lg shadow-md">
          <button
            type="button"
            onClick={() => setShowGeofences(!showGeofences)}
            title="Toggle Geofence Boundaries"
            className={`p-1.5 rounded-md text-xs transition-colors ${
              showGeofences
                ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Radio className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={cycleMapLayer}
            title="Switch Map Tiles"
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
          >
            <Layers className="w-4 h-4" />
          </button>
          <div className="h-4 w-px bg-slate-700 mx-0.5" />
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.min(z * 1.25, 4))}
            title="Zoom In"
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.max(z / 1.25, 0.5))}
            title="Zoom Out"
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleResetBounds}
            title="Reset View"
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md transition-colors"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Interactive SVG Canvas */}
      <div className="relative flex-1 w-full h-full overflow-hidden bg-slate-950">
        {/* Subtle Canvas Grid Background */}
        <div
          className="absolute inset-0 opacity-15"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.15) 1px, transparent 0)',
            backgroundSize: '24px 24px',
          }}
        />

        <svg
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            {/* Linear gradient for route driving path */}
            <linearGradient id="routeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="50%" stopColor="#60a5fa" />
              <stop offset="100%" stopColor="#818cf8" />
            </linearGradient>

            {/* Glowing filter for selected pin */}
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* 1. DRAW ROUTE PATH POLYLINE */}
          {pathD && (
            <>
              {/* Route shadow / glow */}
              <path
                d={pathD}
                fill="none"
                stroke="#0284c7"
                strokeWidth="8"
                strokeOpacity="0.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Core driving path */}
              <path
                d={pathD}
                fill="none"
                stroke="url(#routeGradient)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={polylineCoords.length === 0 ? '6 6' : undefined}
              />
            </>
          )}

          {/* 2. SHOW GEOFENCE RADIUS RINGS */}
          {showGeofences &&
            stops.map((stop) => {
              const pt = project(stop.latitude, stop.longitude);
              const r = getPixelRadius(stop.geofenceRadiusMeters);
              const isSelected = stop.id === selectedStopId;

              return (
                <g key={`geofence-${stop.id}`}>
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={r}
                    fill={isSelected ? 'rgba(56, 189, 248, 0.15)' : 'rgba(99, 102, 241, 0.08)'}
                    stroke={isSelected ? '#38bdf8' : '#818cf8'}
                    strokeWidth="1.2"
                    strokeDasharray="4 3"
                    strokeOpacity={isSelected ? 0.8 : 0.4}
                  />
                </g>
              );
            })}

          {/* 3. SHOW SEQUENCED PICKUP STOPS */}
          {stops.map((stop) => {
            const pt = project(stop.latitude, stop.longitude);
            const isSelected = stop.id === selectedStopId;
            const isHovered = hoveredStop?.id === stop.id;

            return (
              <g
                key={`stop-${stop.id}`}
                className="cursor-pointer transition-transform duration-150"
                onClick={() => onSelectStop?.(stop)}
                onMouseEnter={() => setHoveredStop(stop)}
                onMouseLeave={() => setHoveredStop(null)}
              >
                {/* Active pulse ring if selected */}
                {isSelected && (
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r="18"
                    fill="rgba(56, 189, 248, 0.25)"
                    className="animate-ping"
                  />
                )}

                {/* Pin Base Circle */}
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isSelected || isHovered ? '14' : '11'}
                  fill={isSelected ? '#0284c7' : '#1e293b'}
                  stroke={isSelected ? '#38bdf8' : '#94a3b8'}
                  strokeWidth={isSelected ? '2.5' : '1.8'}
                  filter={isSelected ? 'url(#glow)' : undefined}
                />

                {/* Sequence Number Label */}
                <text
                  x={pt.x}
                  y={pt.y + 3.5}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize={isSelected || isHovered ? '11' : '9.5'}
                  fontWeight="bold"
                  fontFamily="monospace"
                  className="pointer-events-none select-none"
                >
                  {stop.sequenceOrder}
                </text>

                {/* Stop Name Label Badge beneath pin */}
                <g transform={`translate(${pt.x}, ${pt.y + (isSelected ? 22 : 18)})`}>
                  <rect
                    x={-((stop.stopName.length * 6.5) / 2 + 8)}
                    y="-9"
                    width={stop.stopName.length * 6.5 + 16}
                    height="18"
                    rx="4"
                    fill="rgba(15, 23, 42, 0.85)"
                    stroke={isSelected ? '#38bdf8' : 'rgba(51, 65, 85, 0.7)'}
                    strokeWidth="1"
                  />
                  <text
                    x="0"
                    y="3"
                    textAnchor="middle"
                    fill={isSelected ? '#38bdf8' : '#e2e8f0'}
                    fontSize="9.5"
                    fontWeight={isSelected ? '600' : '400'}
                    className="pointer-events-none select-none"
                  >
                    {stop.stopName}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>

        {/* Hover / Selected Stop Inspection Card (Bottom Left Overlay) */}
        {(hoveredStop || (selectedStopId && stops.find((s) => s.id === selectedStopId))) && (
          <div className="absolute bottom-4 left-4 z-20 bg-slate-900/95 backdrop-blur-md border border-slate-700/80 p-3.5 rounded-xl shadow-xl max-w-xs text-xs space-y-2 pointer-events-none animate-in fade-in zoom-in-95 duration-150">
            {(() => {
              const active = hoveredStop || stops.find((s) => s.id === selectedStopId)!;
              return (
                <>
                  <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-400 font-mono font-bold flex items-center justify-center text-[10px]">
                        #{active.sequenceOrder}
                      </span>
                      <span className="font-semibold text-white truncate max-w-[170px]">
                        {active.stopName}
                      </span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 font-mono">
                      Stop {active.sequenceOrder} of {stops.length}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-slate-300">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      <span className="font-mono text-slate-200">{active.scheduledTime}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 text-indigo-400" />
                      <span className="text-slate-300">{active.geofenceRadiusMeters}m geofence</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-slate-300">
                        {active.assignedStudentsCount} student{active.assignedStudentsCount === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-rose-400" />
                      <span className="font-mono text-[10px] text-slate-400">
                        {active.latitude.toFixed(4)}, {active.longitude.toFixed(4)}
                      </span>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center z-30">
            <div className="flex items-center gap-2.5 px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg shadow-lg text-xs text-sky-400">
              <Compass className="w-4 h-4 animate-spin text-sky-400" />
              <span>Updating route geometry & stops...</span>
            </div>
          </div>
        )}

        {/* Empty stops overlay */}
        {!isLoading && stops.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 text-center p-6">
            <MapPin className="w-10 h-10 text-slate-600 mb-2" />
            <h4 className="text-sm font-semibold text-slate-300">No Pickup Stops Configured</h4>
            <p className="text-xs text-slate-500 max-w-xs mt-1">
              Add pickup and drop stops to calculate road directions and render the route path.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
