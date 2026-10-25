'use client';

import React, { useMemo, useState } from 'react';
import { WifiOff, RefreshCw, Layers } from 'lucide-react';
import {
  type MapTileLayerOption,
  FREE_MAP_TILE_PROVIDERS,
  latLngToTile,
  tileToLatLng,
  getOsmTileUrl,
} from '@school-bus/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface BusLocationSnapshot {
  latitude: number;
  longitude: number;
  speedKmh: number;
  bearingDegrees?: number | null;
  recordedAt: string;
}

export interface PickupStopSnapshot {
  latitude: number;
  longitude: number;
  stopName: string;
  geofenceRadiusMeters?: number;
  sequenceOrder?: number;
  scheduledTime?: string;
}

export type FeedConnectionStatus = 'CONNECTING' | 'LIVE' | 'RECONNECTING' | 'OFFLINE';

export interface ParentLiveMapCanvasProps {
  /** Current bus GPS snapshot (null = no fix yet or trip hasn't started) */
  busLocation: BusLocationSnapshot | null;
  /** Parent's assigned pickup stop coordinates & details */
  pickupStop: PickupStopSnapshot | null;
  /** SSE or polling connection lifecycle status */
  feedStatus: FeedConnectionStatus;
  /** Show loading shimmer overlay */
  isLoading?: boolean;
  /** Trip status label shown in badge */
  tripStatus?: string;
  /** Is bus currently approaching stop (< 500m / inside geofence) */
  isApproaching?: boolean;
}

// ---------------------------------------------------------------------------
// Constants & Styling Tokens
// ---------------------------------------------------------------------------
const SVG_W = 340;
const SVG_H = 240;
const PAD_FACTOR = 0.35;
// Default Delhi NCR bounding box when no coordinates available
const DEFAULT_BOUNDS = { minLat: 28.58, maxLat: 28.65, minLng: 77.17, maxLng: 77.26 };

// Age thresholds (seconds)
const STALE_AFTER_S = 120; // > 2 min → amber
const LOST_AFTER_S = 300;  // > 5 min → rose

const COLORS = {
  bg: '#0f172a',            // slate-900
  grid: '#1e293b',          // slate-800
  gridLine: '#334155',      // slate-700
  busHealthy: '#38bdf8',    // sky-400
  busStale: '#f59e0b',      // amber-500
  busLost: '#f43f5e',       // rose-500
  busPulse: 'rgba(56,189,248,0.28)',
  stopPin: '#818cf8',       // indigo-400
  stopPinFill: 'rgba(129,140,248,0.18)',
  geofenceStroke: '#6366f1',// indigo-500
  geofenceFill: 'rgba(99,102,241,0.12)',
  approachingGlow: '#10b981',// emerald-500
  approachingFill: 'rgba(16,185,129,0.18)',
  speed: '#94a3b8',         // slate-400
  overlayBg: 'rgba(15,23,42,0.85)',
  overlayText: '#e2e8f0',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ageSeconds(recordedAt: string): number {
  return Math.max(0, (Date.now() - new Date(recordedAt).getTime()) / 1000);
}

function busColor(recordedAt: string): string {
  const age = ageSeconds(recordedAt);
  if (age > LOST_AFTER_S) return COLORS.busLost;
  if (age > STALE_AFTER_S) return COLORS.busStale;
  return COLORS.busHealthy;
}

function isFresh(recordedAt: string): boolean {
  return ageSeconds(recordedAt) < 30;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ParentLiveMapCanvas({
  busLocation,
  pickupStop,
  feedStatus,
  isLoading = false,
  tripStatus,
  isApproaching = false,
}: ParentLiveMapCanvasProps) {
  // Compute bounding box containing bus location and pickup stop
  const bounds = useMemo(() => {
    const points: Array<{ lat: number; lng: number }> = [];
    if (busLocation && !isNaN(busLocation.latitude) && !isNaN(busLocation.longitude)) {
      points.push({ lat: busLocation.latitude, lng: busLocation.longitude });
    }
    if (pickupStop && !isNaN(pickupStop.latitude) && !isNaN(pickupStop.longitude)) {
      points.push({ lat: pickupStop.latitude, lng: pickupStop.longitude });
    }

    if (points.length === 0) return DEFAULT_BOUNDS;

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;

    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }

    const latSpan = maxLat - minLat;
    const lngSpan = maxLng - minLng;
    const latPad = Math.max(latSpan * PAD_FACTOR, 0.008);
    const lngPad = Math.max(lngSpan * PAD_FACTOR, 0.012);

    return {
      minLat: minLat - latPad,
      maxLat: maxLat + latPad,
      minLng: minLng - lngPad,
      maxLng: maxLng + lngPad,
    };
  }, [busLocation, pickupStop]);

  // Project GPS (lat, lng) → Canvas SVG coordinates
  const project = (lat: number, lng: number): { x: number; y: number } => {
    const latSpan = bounds.maxLat - bounds.minLat || 0.001;
    const lngSpan = bounds.maxLng - bounds.minLng || 0.001;
    return {
      x: ((lng - bounds.minLng) / lngSpan) * SVG_W,
      y: (1 - (lat - bounds.minLat) / latSpan) * SVG_H,
    };
  };

  const busPos =
    busLocation && !isNaN(busLocation.latitude) && !isNaN(busLocation.longitude)
      ? project(busLocation.latitude, busLocation.longitude)
      : null;

  const stopPos =
    pickupStop && !isNaN(pickupStop.latitude) && !isNaN(pickupStop.longitude)
      ? project(pickupStop.latitude, pickupStop.longitude)
      : null;

  // Approximate pixel radius for geofence circle (e.g. 500m)
  const geofencePixelRadius = useMemo(() => {
    if (!pickupStop) return 16;
    const meters = pickupStop.geofenceRadiusMeters || 500;
    // 1 deg latitude ≈ 111,000 meters
    const latSpan = bounds.maxLat - bounds.minLat || 0.001;
    const metersPerPixelY = (latSpan * 111000) / SVG_H;
    const px = meters / (metersPerPixelY || 1);
    // Clamp between 12px and 60px for clean legibility
    return Math.min(Math.max(px, 14), 50);
  }, [bounds, pickupStop]);

  const busCol = busLocation ? busColor(busLocation.recordedAt) : COLORS.busHealthy;
  const fresh = busLocation ? isFresh(busLocation.recordedAt) : false;
  const bearing = busLocation?.bearingDegrees != null ? Number(busLocation.bearingDegrees) : 0;
  const speed = busLocation?.speedKmh != null ? Math.round(busLocation.speedKmh) : 0;
  const isStationary = speed < 2;

  const isOffline = feedStatus === 'OFFLINE';
  const isReconnecting = feedStatus === 'RECONNECTING';
  const showOverlay = isLoading || isOffline || isReconnecting;

  const [mapLayer, setMapLayer] = useState<MapTileLayerOption>('osm_standard');

  const cycleMapLayer = () => {
    setMapLayer((prev) => (prev === 'osm_standard' ? 'canvas' : 'osm_standard'));
  };

  // Compute OpenStreetMap raster tiles intersecting bounding box
  const tiles = useMemo(() => {
    if (mapLayer === 'canvas') return [];
    const latSpan = bounds.maxLat - bounds.minLat;
    const lngSpan = bounds.maxLng - bounds.minLng;
    const maxSpan = Math.max(latSpan, lngSpan);

    let z = 14;
    if (maxSpan > 0.1) z = 12;
    else if (maxSpan > 0.04) z = 13;
    else if (maxSpan > 0.015) z = 14;
    else z = 15;

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
    const xEnd = Math.min(Math.max(minTile.x, maxTile.x), xStart + 4);
    const yStart = Math.min(minTile.y, maxTile.y);
    const yEnd = Math.min(Math.max(minTile.y, maxTile.y), yStart + 4);

    for (let tx = xStart; tx <= xEnd; tx++) {
      for (let ty = yStart; ty <= yEnd; ty++) {
        const nw = tileToLatLng(tx, ty, z);
        const se = tileToLatLng(tx + 1, ty + 1, z);

        const pNw = project(nw.lat, nw.lng);
        const pSe = project(se.lat, se.lng);

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
  }, [mapLayer, bounds]);

  // Subtle grid lines for canvas mode
  const gridLines = useMemo(() => {
    const lines: React.ReactNode[] = [];
    const hStep = SVG_H / 4;
    const wStep = SVG_W / 4;
    for (let i = 1; i < 4; i++) {
      lines.push(
        <line
          key={`h${i}`}
          x1={0}
          y1={i * hStep}
          x2={SVG_W}
          y2={i * hStep}
          stroke={COLORS.gridLine}
          strokeWidth={0.5}
          strokeDasharray="4 4"
        />
      );
      lines.push(
        <line
          key={`v${i}`}
          x1={i * wStep}
          y1={0}
          x2={i * wStep}
          y2={SVG_H}
          stroke={COLORS.gridLine}
          strokeWidth={0.5}
          strokeDasharray="4 4"
        />
      );
    }
    return lines;
  }, []);

  return (
    <div
      className="relative w-full rounded-xl overflow-hidden border border-slate-700 select-none shadow-inner"
      style={{ background: COLORS.bg, aspectRatio: `${SVG_W}/${SVG_H}` }}
      aria-label="Interactive live bus tracking map canvas"
      role="img"
    >
      {/* Top right map layer toggle button */}
      <div className="absolute top-2 right-2 z-10 pointer-events-auto">
        <button
          type="button"
          onClick={cycleMapLayer}
          title={`Switch map view (Current: ${mapLayer === 'osm_standard' ? 'OpenStreetMap' : 'Vector Grid'})`}
          className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900/85 hover:bg-slate-800 text-[10px] font-mono text-slate-300 border border-slate-700 transition-colors shadow-xs"
        >
          <Layers className="w-3 h-3 text-sky-400" />
          <span>{mapLayer === 'osm_standard' ? 'OSM' : 'Grid'}</span>
        </button>
      </div>

      {/* Top left telemetry speed & movement badge */}
      {busLocation && (
        <div className="absolute top-2 left-2 z-10 pointer-events-none flex items-center gap-1.5 bg-slate-900/85 backdrop-blur-xs px-2 py-0.5 rounded border border-slate-700 text-[10px] font-mono">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isStationary ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'
            }`}
          />
          <span className="text-slate-200 font-bold">{speed} km/h</span>
          <span className="text-slate-400 font-normal">
            {isStationary ? 'Stationary' : 'Moving'}
          </span>
        </div>
      )}

      {/* Legal OSM Attribution */}
      <div className="absolute bottom-1 right-2 z-10 text-[8px] text-slate-400 bg-slate-900/85 px-1.5 py-0.5 rounded border border-slate-800 pointer-events-auto">
        {mapLayer === 'osm_standard' ? (
          <span>
            ©{' '}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-sky-300"
            >
              OpenStreetMap
            </a>
          </span>
        ) : (
          <span>BUSLOARD Vector</span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full h-full"
        style={{ display: 'block' }}
      >
        <defs>
          {/* Subtle gradient for geofence circle */}
          <radialGradient id="geofenceGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={isApproaching ? COLORS.approachingGlow : COLORS.geofenceStroke} stopOpacity="0.25" />
            <stop offset="100%" stopColor={isApproaching ? COLORS.approachingGlow : COLORS.geofenceStroke} stopOpacity="0.05" />
          </radialGradient>
        </defs>

        {/* Background */}
        <rect x={0} y={0} width={SVG_W} height={SVG_H} fill={COLORS.bg} />

        {/* OpenStreetMap Tile Layer (if active) */}
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

        {/* Grid lines */}
        {mapLayer === 'canvas' && gridLines}

        {/* Trajectory connector line between bus and stop */}
        {busPos && stopPos && (
          <line
            x1={busPos.x}
            y1={busPos.y}
            x2={stopPos.x}
            y2={stopPos.y}
            stroke={isApproaching ? COLORS.approachingGlow : COLORS.busHealthy}
            strokeWidth={1.5}
            strokeDasharray="6 4"
            opacity={0.75}
          />
        )}

        {/* Pickup Stop Marker & Geofence Circle */}
        {stopPos && (
          <g>
            {/* Geofence circular radius boundary */}
            <circle
              cx={stopPos.x}
              cy={stopPos.y}
              r={geofencePixelRadius}
              fill="url(#geofenceGradient)"
              stroke={isApproaching ? COLORS.approachingGlow : COLORS.geofenceStroke}
              strokeWidth={1}
              strokeDasharray={isApproaching ? '4 2' : 'none'}
              opacity={0.8}
            />

            {/* Approaching animated pulse when vehicle is nearby */}
            {isApproaching && (
              <circle
                cx={stopPos.x}
                cy={stopPos.y}
                r={geofencePixelRadius + 6}
                fill="none"
                stroke={COLORS.approachingGlow}
                strokeWidth={1}
                opacity={0.6}
              >
                <animate attributeName="r" from={geofencePixelRadius} to={geofencePixelRadius + 10} dur="1.8s" repeatCount="indefinite" />
                <animate attributeName="opacity" from="0.7" to="0" dur="1.8s" repeatCount="indefinite" />
              </circle>
            )}

            {/* Stop Core Dot and Ring */}
            <circle cx={stopPos.x} cy={stopPos.y} r={7} fill={COLORS.stopPin} opacity={0.95} />
            <circle cx={stopPos.x} cy={stopPos.y} r={10} fill="none" stroke={COLORS.stopPin} strokeWidth={1.5} opacity={0.7} />

            {/* White center dot */}
            <circle cx={stopPos.x} cy={stopPos.y} r={2.5} fill="#ffffff" />

            {/* Stop label */}
            {pickupStop && (
              <g>
                <rect
                  x={stopPos.x - 45}
                  y={stopPos.y + 13}
                  width={90}
                  height={13}
                  rx={3}
                  fill={COLORS.bg}
                  opacity={0.85}
                  stroke={COLORS.gridLine}
                  strokeWidth={0.5}
                />
                <text
                  x={stopPos.x}
                  y={stopPos.y + 22}
                  textAnchor="middle"
                  fontSize={7.5}
                  fill={isApproaching ? COLORS.approachingGlow : '#c7d2fe'}
                  fontFamily="sans-serif"
                  fontWeight="600"
                >
                  {pickupStop.stopName.length > 18 ? `${pickupStop.stopName.slice(0, 16)}…` : pickupStop.stopName}
                </text>
              </g>
            )}
          </g>
        )}

        {/* Bus Marker */}
        {busPos && (
          <g transform={`translate(${busPos.x}, ${busPos.y})`}>
            {/* Pulse ring for fresh updates (< 30s) */}
            {fresh && (
              <circle cx={0} cy={0} r={18} fill={COLORS.busPulse}>
                <animate attributeName="r" from="10" to="24" dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" from="0.6" to="0" dur="2s" repeatCount="indefinite" />
              </circle>
            )}

            {/* Bus vehicle representation with bearing orientation */}
            <g transform={`rotate(${bearing})`}>
              {/* Direction pointer triangle pointing toward heading */}
              <polygon points="0,-13 6,5 0,2 -6,5" fill={busCol} opacity={0.95} />

              {/* Bus body rectangle */}
              <rect
                x={-8}
                y={-8}
                width={16}
                height={12}
                rx={3}
                fill={busCol}
                stroke="#0f172a"
                strokeWidth={1}
              />
              {/* Bus windshield window */}
              <rect x={-6} y={-6} width={12} height={4} rx={1} fill={COLORS.bg} opacity={0.65} />
            </g>

            {/* Bearing & heading degree indicator if moving */}
            {bearing > 0 && (
              <g transform="translate(10, -18)">
                <rect x={0} y={0} width={26} height={10} rx={2} fill={COLORS.bg} opacity={0.85} />
                <text
                  x={13}
                  y={7.5}
                  textAnchor="middle"
                  fontSize={6.5}
                  fill={busCol}
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  {Math.round(bearing)}°
                </text>
              </g>
            )}
          </g>
        )}

        {/* Empty state when no bus location yet */}
        {!busPos && !showOverlay && (
          <text
            x={SVG_W / 2}
            y={SVG_H / 2}
            textAnchor="middle"
            fontSize={9.5}
            fill={COLORS.speed}
            fontFamily="monospace"
          >
            Awaiting initial GPS telemetry fix…
          </text>
        )}
      </svg>

      {/* Legend & status footer strip */}
      <div
        className="absolute bottom-1.5 left-2 flex items-center gap-2 text-[9px] font-mono pointer-events-none"
        style={{ color: COLORS.speed }}
      >
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLORS.busHealthy }} />
          Bus
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLORS.stopPin }} />
          Your Stop
        </span>
        {isApproaching && (
          <span className="flex items-center gap-1 font-bold text-emerald-400">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            Approaching
          </span>
        )}
        {tripStatus && (
          <span
            className="ml-1 px-1.5 py-0.5 rounded font-semibold"
            style={{ background: COLORS.grid, color: COLORS.overlayText }}
          >
            {tripStatus}
          </span>
        )}
      </div>

      {/* Overlay: Loading / Offline / Reconnecting */}
      {showOverlay && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none"
          style={{ background: COLORS.overlayBg }}
        >
          {isLoading && (
            <>
              <RefreshCw className="w-6 h-6 animate-spin text-sky-400" />
              <span className="text-[11px] font-mono font-medium text-slate-200">
                Establishing live tracking stream…
              </span>
            </>
          )}
          {!isLoading && isReconnecting && (
            <>
              <RefreshCw className="w-5 h-5 animate-spin text-amber-400" />
              <span className="text-[11px] font-mono font-medium text-amber-200">
                Reconnecting telemetry feed…
              </span>
            </>
          )}
          {!isLoading && isOffline && (
            <>
              <WifiOff className="w-5 h-5 text-rose-400" />
              <span className="text-[11px] font-mono font-medium text-rose-200">
                Connection paused · Retrying automatically
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
