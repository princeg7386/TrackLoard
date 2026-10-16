'use client';

import React, { useMemo } from 'react';
import { WifiOff, RefreshCw, MapPin, Bus } from 'lucide-react';
import type { FeedConnectionStatus } from '../../services/telemetryApi';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface BusLocationSnapshot {
  latitude: number;
  longitude: number;
  speedKmh: number;
  bearingDegrees?: number;
  recordedAt: string;
}

export interface PickupStopSnapshot {
  latitude: number;
  longitude: number;
  stopName: string;
}

interface ParentLiveMapCanvasProps {
  /** Current bus GPS snapshot (null = no fix yet or trip hasn't started) */
  busLocation: BusLocationSnapshot | null;
  /** Parent's assigned pickup stop coordinates */
  pickupStop: PickupStopSnapshot | null;
  /** SSE connection lifecycle status */
  feedStatus: FeedConnectionStatus;
  /** Show loading shimmer overlay */
  isLoading?: boolean;
  /** Trip status label shown in badge */
  tripStatus?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SVG_W = 320;
const SVG_H = 220;
// Padding factor: how much empty space around the bounding box
const PAD_FACTOR = 0.30;
// Default Delhi NCR bounding box when no coordinates
const DEFAULT_BOUNDS = { minLat: 28.58, maxLat: 28.65, minLng: 77.17, maxLng: 77.26 };

// Age thresholds (seconds)
const STALE_AFTER_S = 120;     // > 2 min → amber
const LOST_AFTER_S = 300;      // > 5 min → rose

// Color palette (matches design system slate / sky tokens)
const COLORS = {
  bg: '#0f172a',
  grid: '#1e293b',
  gridLine: '#334155',
  busHealthy: '#38bdf8',   // sky-400
  busStale: '#f59e0b',     // amber-500
  busLost: '#f43f5e',      // rose-500
  busPulse: 'rgba(56,189,248,0.25)',
  stopPin: '#818cf8',      // indigo-400
  stopPinFill: 'rgba(129,140,248,0.15)',
  speed: '#94a3b8',        // slate-400
  overlayBg: 'rgba(15,23,42,0.80)',
  overlayText: '#e2e8f0',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ageSeconds(recordedAt: string): number {
  return (Date.now() - new Date(recordedAt).getTime()) / 1000;
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
}: ParentLiveMapCanvasProps) {
  // Compute bounding box from available points
  const bounds = useMemo(() => {
    const points: Array<{ lat: number; lng: number }> = [];
    if (busLocation) points.push({ lat: busLocation.latitude, lng: busLocation.longitude });
    if (pickupStop) points.push({ lat: pickupStop.latitude, lng: pickupStop.longitude });

    if (points.length === 0) return DEFAULT_BOUNDS;

    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }

    const latPad = Math.max((maxLat - minLat) * PAD_FACTOR, 0.008);
    const lngPad = Math.max((maxLng - minLng) * PAD_FACTOR, 0.012);

    return {
      minLat: minLat - latPad,
      maxLat: maxLat + latPad,
      minLng: minLng - lngPad,
      maxLng: maxLng + lngPad,
    };
  }, [busLocation, pickupStop]);

  // Project GPS → SVG canvas (invert Y — SVG y=0 is top)
  const project = (lat: number, lng: number): { x: number; y: number } => {
    const latSpan = bounds.maxLat - bounds.minLat || 0.001;
    const lngSpan = bounds.maxLng - bounds.minLng || 0.001;
    return {
      x: ((lng - bounds.minLng) / lngSpan) * SVG_W,
      y: (1 - (lat - bounds.minLat) / latSpan) * SVG_H,
    };
  };

  const busPos = busLocation ? project(busLocation.latitude, busLocation.longitude) : null;
  const stopPos = pickupStop ? project(pickupStop.latitude, pickupStop.longitude) : null;

  const busCol = busLocation ? busColor(busLocation.recordedAt) : COLORS.busHealthy;
  const fresh = busLocation ? isFresh(busLocation.recordedAt) : false;
  const bearing = busLocation?.bearingDegrees ?? 0;

  const isOffline = feedStatus === 'OFFLINE';
  const isReconnecting = feedStatus === 'RECONNECTING';
  const showOverlay = isLoading || isOffline || isReconnecting;

  // Grid lines (4 horizontal + 4 vertical)
  const gridLines = useMemo(() => {
    const lines: React.ReactNode[] = [];
    const hStep = SVG_H / 4;
    const wStep = SVG_W / 4;
    for (let i = 1; i < 4; i++) {
      lines.push(
        <line key={`h${i}`} x1={0} y1={i * hStep} x2={SVG_W} y2={i * hStep}
          stroke={COLORS.gridLine} strokeWidth={0.5} strokeDasharray="4 4" />
      );
      lines.push(
        <line key={`v${i}`} x1={i * wStep} y1={0} x2={i * wStep} y2={SVG_H}
          stroke={COLORS.gridLine} strokeWidth={0.5} strokeDasharray="4 4" />
      );
    }
    return lines;
  }, []);

  return (
    <div
      className="relative w-full rounded-xl overflow-hidden border border-slate-700 select-none"
      style={{ background: COLORS.bg, aspectRatio: `${SVG_W}/${SVG_H}` }}
      aria-label="Live bus location map"
      role="img"
    >
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full h-full"
        style={{ display: 'block' }}
      >
        {/* Background */}
        <rect x={0} y={0} width={SVG_W} height={SVG_H} fill={COLORS.bg} />

        {/* Grid */}
        {gridLines}

        {/* Connector line between bus and stop when both visible */}
        {busPos && stopPos && (
          <line
            x1={busPos.x} y1={busPos.y} x2={stopPos.x} y2={stopPos.y}
            stroke={COLORS.gridLine} strokeWidth={1} strokeDasharray="6 4"
            opacity={0.7}
          />
        )}

        {/* Pickup Stop Marker */}
        {stopPos && (
          <g>
            <circle cx={stopPos.x} cy={stopPos.y} r={14} fill={COLORS.stopPinFill} />
            <circle cx={stopPos.x} cy={stopPos.y} r={6} fill={COLORS.stopPin} opacity={0.9} />
            <circle cx={stopPos.x} cy={stopPos.y} r={6} fill="none"
              stroke={COLORS.stopPin} strokeWidth={1.5} opacity={0.6} />
            {/* Stop label */}
            {pickupStop && (
              <text
                x={stopPos.x} y={stopPos.y + 18}
                textAnchor="middle" fontSize={7} fill={COLORS.stopPin} opacity={0.85}
                fontFamily="monospace"
              >
                {pickupStop.stopName.slice(0, 22)}
              </text>
            )}
          </g>
        )}

        {/* Bus Marker */}
        {busPos && (
          <g transform={`translate(${busPos.x}, ${busPos.y})`}>
            {/* Pulse ring (shown only for fresh GPS fixes) */}
            {fresh && (
              <circle cx={0} cy={0} r={16} fill={COLORS.busPulse}>
                <animate attributeName="r" from="10" to="22" dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" from="0.5" to="0" dur="2s" repeatCount="indefinite" />
              </circle>
            )}

            {/* Bus body (rotated by bearing — pointing direction of travel) */}
            <g transform={`rotate(${bearing})`}>
              {/* Direction triangle */}
              <polygon points="0,-11 5,5 0,2 -5,5" fill={busCol} opacity={0.9} />
              {/* Bus rectangle */}
              <rect x={-7} y={-7} width={14} height={10} rx={2.5} fill={busCol} />
              <rect x={-5} y={-5} width={10} height={6} rx={1} fill={COLORS.bg} opacity={0.3} />
            </g>

            {/* Speed badge (always upright) */}
            {busLocation && (
              <g>
                <rect x={8} y={-18} width={28} height={11} rx={2} fill={COLORS.bg} opacity={0.85} />
                <text x={22} y={-10} textAnchor="middle" fontSize={7} fill={busCol}
                  fontFamily="monospace" fontWeight="bold">
                  {Math.round(busLocation.speedKmh)} km/h
                </text>
              </g>
            )}
          </g>
        )}

        {/* Empty state when no bus location */}
        {!busPos && !showOverlay && (
          <text x={SVG_W / 2} y={SVG_H / 2} textAnchor="middle" fontSize={9}
            fill={COLORS.speed} fontFamily="monospace">
            Waiting for first GPS fix…
          </text>
        )}
      </svg>

      {/* Legend strip */}
      <div className="absolute bottom-1.5 left-2 flex items-center gap-2 text-[9px] font-mono" style={{ color: COLORS.speed }}>
        <span className="flex items-center gap-0.5">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLORS.busHealthy }} />
          Live
        </span>
        <span className="flex items-center gap-0.5">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLORS.busStale }} />
          Stale
        </span>
        <span className="flex items-center gap-0.5">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLORS.stopPin }} />
          Stop
        </span>
        {tripStatus && (
          <span className="ml-1 px-1 py-0.5 rounded" style={{ background: COLORS.grid, color: COLORS.overlayText }}>
            {tripStatus}
          </span>
        )}
      </div>

      {/* Overlay: Loading / Offline / Reconnecting */}
      {showOverlay && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2"
          style={{ background: COLORS.overlayBg }}
        >
          {isLoading && (
            <>
              <Bus className="w-6 h-6 animate-pulse" style={{ color: COLORS.busHealthy }} />
              <span className="text-[10px] font-mono" style={{ color: COLORS.overlayText }}>
                Connecting to live bus feed…
              </span>
            </>
          )}
          {!isLoading && isReconnecting && (
            <>
              <RefreshCw className="w-5 h-5 animate-spin" style={{ color: COLORS.busStale }} />
              <span className="text-[10px] font-mono" style={{ color: COLORS.overlayText }}>
                Reconnecting…
              </span>
            </>
          )}
          {!isLoading && isOffline && (
            <>
              <WifiOff className="w-5 h-5" style={{ color: COLORS.busLost }} />
              <span className="text-[10px] font-mono" style={{ color: COLORS.overlayText }}>
                No internet connection
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
