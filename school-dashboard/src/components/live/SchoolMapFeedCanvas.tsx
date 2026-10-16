'use client';

import React, { useMemo, useState } from 'react';
import {
  Bus,
  Navigation,
  Compass,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Clock,
  Gauge,
  Phone,
  Radio,
  AlertTriangle,
  User,
  Layers,
  Map as MapIcon,
} from 'lucide-react';
import {
  type BusGpsHealthSummary,
  type ActiveTripStateResponse,
  type MapTileLayerOption,
  FREE_MAP_TILE_PROVIDERS,
  latLngToTile,
  tileToLatLng,
  getOsmTileUrl,
} from '@school-bus/shared';

interface SchoolMapFeedProps {
  buses: BusGpsHealthSummary[];
  selectedBusId?: string | null;
  selectedBusDetail?: ActiveTripStateResponse | null;
  onSelectBus?: (bus: BusGpsHealthSummary) => void;
  tripTrail?: Array<{ latitude: number; longitude: number; speedKmh: number; recordedAt: string }>;
  isLoading?: boolean;
}

export function SchoolMapFeedCanvas({
  buses,
  selectedBusId,
  selectedBusDetail,
  onSelectBus,
  tripTrail,
  isLoading,
}: SchoolMapFeedProps) {
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hoveredBus, setHoveredBus] = useState<BusGpsHealthSummary | null>(null);
  const [showTrail, setShowTrail] = useState<boolean>(true);
  const [mapLayer, setMapLayer] = useState<MapTileLayerOption>('osm_standard');

  const cycleMapLayer = () => {
    setMapLayer((prev) => {
      if (prev === 'osm_standard') return 'carto_light';
      if (prev === 'carto_light') return 'canvas';
      return 'osm_standard';
    });
  };

  // Filter vehicles that have actual coordinates
  const locatedBuses = useMemo(() => {
    return buses.filter(
      (b) =>
        b.lastLatitude != null &&
        b.lastLongitude != null &&
        !isNaN(b.lastLatitude) &&
        !isNaN(b.lastLongitude)
    );
  }, [buses]);

  // Compute bounding box
  const bounds = useMemo(() => {
    if (locatedBuses.length === 0) {
      // Default to Delhi NCR coordinates if empty
      return {
        minLat: 28.5,
        maxLat: 28.7,
        minLng: 77.1,
        maxLng: 77.3,
      };
    }

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;

    for (const b of locatedBuses) {
      if (b.lastLatitude! < minLat) minLat = b.lastLatitude!;
      if (b.lastLatitude! > maxLat) maxLat = b.lastLatitude!;
      if (b.lastLongitude! < minLng) minLng = b.lastLongitude!;
      if (b.lastLongitude! > maxLng) maxLng = b.lastLongitude!;
    }

    // Add padding if single point or tight cluster
    const latPadding = Math.max((maxLat - minLat) * 0.25, 0.02);
    const lngPadding = Math.max((maxLng - minLng) * 0.25, 0.02);

    return {
      minLat: minLat - latPadding,
      maxLat: maxLat + latPadding,
      minLng: minLng - lngPadding,
      maxLng: maxLng + lngPadding,
    };
  }, [locatedBuses]);

  // Convert GPS (lat, lng) to canvas coordinate (SVG 800 x 500 viewport)
  const projectPoint = (lat: number, lng: number) => {
    const latSpan = bounds.maxLat - bounds.minLat || 0.01;
    const lngSpan = bounds.maxLng - bounds.minLng || 0.01;

    // Invert lat because SVG y=0 is top
    const normalizedX = (lng - bounds.minLng) / lngSpan;
    const normalizedY = 1 - (lat - bounds.minLat) / latSpan;

    // Base viewport 800 x 500
    const centerX = 400;
    const centerY = 250;

    const baseWidth = 700;
    const baseHeight = 400;

    const rawX = 50 + normalizedX * baseWidth;
    const rawY = 50 + normalizedY * baseHeight;

    const zoomedX = centerX + (rawX - centerX) * zoomLevel + panOffset.x;
    const zoomedY = centerY + (rawY - centerY) * zoomLevel + panOffset.y;

    return { x: zoomedX, y: zoomedY };
  };

  const resetView = () => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  };

  const handleZoom = (delta: number) => {
    setZoomLevel((prev) => Math.min(Math.max(prev + delta, 0.7), 3));
  };

  // Compute OpenStreetMap tiles for the active viewport
  const tiles = useMemo(() => {
    if (mapLayer === 'canvas') return [];

    const latSpan = bounds.maxLat - bounds.minLat;
    const lngSpan = bounds.maxLng - bounds.minLng;
    const maxSpan = Math.max(latSpan, lngSpan);

    let baseZoom = 13;
    if (maxSpan > 0.5) baseZoom = 11;
    else if (maxSpan > 0.2) baseZoom = 12;
    else if (maxSpan > 0.08) baseZoom = 13;
    else if (maxSpan > 0.03) baseZoom = 14;
    else baseZoom = 15;

    const z = Math.min(Math.max(baseZoom + Math.round((zoomLevel - 1) * 2), 1), 18);

    const minTile = latLngToTile(bounds.maxLat, bounds.minLng, z);
    const maxTile = latLngToTile(bounds.minLat, bounds.maxLng, z);

    const result: Array<{
      key: string;
      url: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];

    const providerConfig = FREE_MAP_TILE_PROVIDERS[mapLayer];
    if (!providerConfig || !providerConfig.urlTemplate) return [];

    const xStart = Math.min(minTile.x, maxTile.x);
    const xEnd = Math.max(minTile.x, maxTile.x);
    const yStart = Math.min(minTile.y, maxTile.y);
    const yEnd = Math.max(minTile.y, maxTile.y);

    const clampedXEnd = Math.min(xEnd, xStart + 6);
    const clampedYEnd = Math.min(yEnd, yStart + 6);

    for (let tx = xStart; tx <= clampedXEnd; tx++) {
      for (let ty = yStart; ty <= clampedYEnd; ty++) {
        const nw = tileToLatLng(tx, ty, z);
        const se = tileToLatLng(tx + 1, ty + 1, z);

        const pNw = projectPoint(nw.lat, nw.lng);
        const pSe = projectPoint(se.lat, se.lng);

        const width = Math.abs(pSe.x - pNw.x);
        const height = Math.abs(pSe.y - pNw.y);
        const url = getOsmTileUrl(providerConfig.urlTemplate, tx, ty, z, providerConfig.subdomains);

        result.push({
          key: `${z}-${tx}-${ty}`,
          url,
          x: Math.min(pNw.x, pSe.x),
          y: Math.min(pNw.y, pSe.y),
          width,
          height,
        });
      }
    }

    return result;
  }, [mapLayer, bounds, zoomLevel, panOffset]);

  return (
    <div className="relative bg-slate-900 border border-slate-800 rounded-lg overflow-hidden shadow-inner flex flex-col h-[460px] select-none">
      {/* Map Header Overlay */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 bg-slate-900/85 backdrop-blur-xs px-3 py-1.5 rounded-md border border-slate-800 pointer-events-auto shadow-md">
          <Compass className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-semibold text-slate-200">Live PostGIS Feed</span>
          <span className="text-3xs px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800/80 font-mono">
            {locatedBuses.length} / {buses.length} online
          </span>
        </div>

        {/* Layer Switcher & Zoom Controls */}
        <div className="flex items-center gap-1.5 bg-slate-900/85 backdrop-blur-xs p-1 rounded-md border border-slate-800 pointer-events-auto shadow-md">
          <button
            type="button"
            onClick={cycleMapLayer}
            title={`Active Map: ${FREE_MAP_TILE_PROVIDERS[mapLayer].name} (Click to switch)`}
            className="flex items-center gap-1 px-2 py-1 text-2xs font-medium text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 rounded transition-colors"
          >
            <MapIcon className="w-3.5 h-3.5 text-sky-400" />
            <span>{mapLayer === 'osm_standard' ? 'OSM Free' : mapLayer === 'carto_light' ? 'Carto' : 'Canvas'}</span>
          </button>
          <div className="w-[1px] h-4 bg-slate-700 mx-0.5" />
          <button
            type="button"
            onClick={() => handleZoom(0.25)}
            title="Zoom In"
            className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleZoom(-0.25)}
            title="Zoom Out"
            className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={resetView}
            title="Fit Fleet Extents"
            className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded transition-colors"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          {tripTrail && tripTrail.length > 0 && (
            <button
              type="button"
              onClick={() => setShowTrail((prev) => !prev)}
              title="Toggle Trail Line"
              className={`p-1.5 rounded transition-colors ${
                showTrail ? 'text-sky-400 bg-sky-950/60' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* SVG Vector Canvas with OpenStreetMap Tiles */}
      <div className="w-full h-full relative cursor-grab active:cursor-grabbing overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-2xs flex items-center justify-center z-20">
            <span className="text-xs text-sky-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
              Calibrating Fleet Stream...
            </span>
          </div>
        )}

        {/* Legal Attribution Pill */}
        <div className="absolute bottom-1.5 right-2 z-10 text-[9px] text-slate-400 bg-slate-900/85 backdrop-blur-xs px-2 py-0.5 rounded border border-slate-800 pointer-events-auto">
          {mapLayer === 'osm_standard' ? (
            <span>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline hover:text-sky-300">OpenStreetMap</a> contributors</span>
          ) : mapLayer === 'carto_light' ? (
            <span>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline hover:text-sky-300">OpenStreetMap</a>, © <a href="https://carto.com/attributions" target="_blank" rel="noreferrer" className="underline hover:text-sky-300">CARTO</a></span>
          ) : (
            <span>BUSLOARD Vector Canvas</span>
          )}
        </div>

        <svg
          viewBox="0 0 800 500"
          className="w-full h-full"
          preserveAspectRatio="xMidYMid slice"
        >
          {/* Subtle Gridlines (Calm enterprise theme) */}
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth="0.75" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="#0f172a" />
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* OpenStreetMap Tile Layer Rendering */}
          {mapLayer !== 'canvas' && tiles.length > 0 && (
            <g className="osm-tiles" opacity="0.65">
              {tiles.map((t) => (
                <image
                  key={t.key}
                  href={t.url}
                  x={t.x}
                  y={t.y}
                  width={t.width}
                  height={t.height}
                  preserveAspectRatio="none"
                />
              ))}
            </g>
          )}

          {/* Historical GPS Trail (if active trip selected) */}
          {showTrail && tripTrail && tripTrail.length > 1 && (
            <g className="trip-trail">
              {tripTrail.map((pt, idx) => {
                if (idx === 0) return null;
                const prev = tripTrail[idx - 1];
                const p1 = projectPoint(prev.latitude, prev.longitude);
                const p2 = projectPoint(pt.latitude, pt.longitude);
                return (
                  <line
                    key={idx}
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke="#38bdf8"
                    strokeWidth="2.5"
                    strokeOpacity="0.75"
                    strokeDasharray="4 2"
                    strokeLinecap="round"
                  />
                );
              })}
            </g>
          )}

          {/* Bus Markers */}
          {locatedBuses.map((bus) => {
            const { x, y } = projectPoint(bus.lastLatitude!, bus.lastLongitude!);
            const isSelected = selectedBusId === bus.busId;
            const isHovered = hoveredBus?.busId === bus.busId;

            // Health color
            let markerColor = '#10b981'; // Healthy green
            if (bus.healthStatus === 'DEGRADED_ACCURACY' || bus.healthStatus === 'STALE_SIGNAL') {
              markerColor = '#f59e0b'; // Amber
            } else if (bus.healthStatus === 'SIGNAL_LOST') {
              markerColor = '#f43f5e'; // Red
            } else if (bus.healthStatus === 'OFFLINE') {
              markerColor = '#64748b'; // Slate
            }

            return (
              <g
                key={bus.busId}
                transform={`translate(${x}, ${y})`}
                onClick={() => onSelectBus?.(bus)}
                onMouseEnter={() => setHoveredBus(bus)}
                onMouseLeave={() => setHoveredBus(null)}
                className="cursor-pointer transition-transform duration-300"
              >
                {/* Active Trip Pulse Halo */}
                {bus.activeTripId && (
                  <circle
                    r="20"
                    fill={markerColor}
                    fillOpacity="0.18"
                    className="animate-pulse"
                  />
                )}

                {/* Selection Ring */}
                {isSelected && (
                  <circle
                    r="16"
                    fill="none"
                    stroke="#6366f1"
                    strokeWidth="2.5"
                    strokeDasharray="3 2"
                    className="animate-spin"
                    style={{ animationDuration: '8s' }}
                  />
                )}

                {/* Main Marker Circle */}
                <circle
                  r="12"
                  fill="#1e293b"
                  stroke={markerColor}
                  strokeWidth="2.5"
                  className="shadow-lg"
                />

                {/* Bus Icon */}
                <g transform="translate(-6, -6)">
                  <Bus className="w-3 h-3 text-white pointer-events-none" />
                </g>

                {/* Speed & Bus Label Badge */}
                <g transform="translate(0, 22)">
                  <rect
                    x="-42"
                    y="-8"
                    width="84"
                    height="16"
                    rx="4"
                    fill="#0f172a"
                    stroke={isSelected ? '#818cf8' : '#334155'}
                    strokeWidth="1"
                    className="shadow-sm"
                  />
                  <text
                    textAnchor="middle"
                    y="3"
                    fill="#f1f5f9"
                    fontSize="9"
                    fontFamily="monospace"
                    fontWeight="bold"
                    className="pointer-events-none"
                  >
                    {bus.busNumber.split(' ')[0]} • {Math.round(bus.lastSpeedKmh ?? 0)}k
                  </text>
                </g>
              </g>
            );
          })}
        </svg>

        {/* Hover / Selection Detail Tooltip */}
        {(hoveredBus || (selectedBusDetail && selectedBusDetail.lastLatitude != null)) && (
          <div className="absolute bottom-3 left-3 z-20 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-lg p-3 text-xs text-slate-200 shadow-xl max-w-sm pointer-events-none animate-fadeIn">
            {hoveredBus ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white">{hoveredBus.busNumber}</span>
                  <span className="text-3xs font-mono text-slate-400">
                    {hoveredBus.registrationNumber}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-2xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <Gauge className="w-3 h-3 text-sky-400" />
                    {hoveredBus.lastSpeedKmh != null ? `${Math.round(hoveredBus.lastSpeedKmh)} km/h` : '0 km/h'}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-400" />
                    {hoveredBus.ageSeconds != null ? `${hoveredBus.ageSeconds}s ago` : 'just now'}
                  </span>
                </div>
              </div>
            ) : selectedBusDetail ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-bold text-white flex items-center gap-1.5">
                    <Bus className="w-3.5 h-3.5 text-sky-400" />
                    {selectedBusDetail.busNumber}
                  </div>
                  <span
                    className={`px-1.5 py-0.2 rounded text-3xs font-semibold ${
                      selectedBusDetail.tripStatus === 'IN_TRANSIT'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {selectedBusDetail.tripStatus || 'STANDBY'}
                  </span>
                </div>

                {selectedBusDetail.routeName && (
                  <div className="text-2xs text-slate-300">
                    Route: <span className="font-semibold text-white">{selectedBusDetail.routeName}</span> ({selectedBusDetail.routeCode})
                  </div>
                )}

                {selectedBusDetail.driverName && (
                  <div className="text-2xs text-slate-400 flex items-center gap-1">
                    <User className="w-3 h-3" />
                    {selectedBusDetail.driverName}
                    {selectedBusDetail.driverPhone && (
                      <span className="font-mono text-slate-400">({selectedBusDetail.driverPhone})</span>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-3 pt-1 border-t border-slate-800 text-3xs text-slate-400">
                  <span>Speed: <strong className="text-sky-300">{selectedBusDetail.lastSpeedKmh != null ? `${Math.round(selectedBusDetail.lastSpeedKmh)} km/h` : '0 km/h'}</strong></span>
                  <span>Health: <strong className="text-emerald-300">{selectedBusDetail.gpsHealthStatus}</strong></span>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* Empty Canvas Message if no coordinates recorded yet */}
        {locatedBuses.length === 0 && !isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10">
            <Radio className="w-8 h-8 text-slate-600 mb-2 animate-pulse" />
            <div className="text-xs font-semibold text-slate-300">No Active GPS Fixes on Map</div>
            <p className="text-2xs text-slate-500 max-w-xs mt-1">
              Vehicles will automatically plot onto this canvas once drivers start trips and transmit GPS telemetry.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
