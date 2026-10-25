/**
 * Parent Live Tracking Page — parent-web (Phase 23)
 *
 * Micro-phase 23.1: Secure Entry (Token Validation, Expiry, Revocation)
 * Accessible via tokenized WhatsApp link:
 *   /track?token=<parent_token>   OR   /?token=<parent_token>
 *
 * Responsibilities for Secure Entry:
 *  1. Validate incoming token by calling /api/v1/parent/track/:token/verify-entry
 *     (with graceful fallback to /api/v1/parent/track/:token)
 *  2. Render appropriate state with full fidelity:
 *     - Loading → Verifying link security
 *     - No Token → Guidance to use link from WhatsApp
 *     - Invalid → Token not found in system with support contact
 *     - Expired → Security explanation, expiration timestamp, WhatsApp renewal action & helpline
 *     - Revoked → Distinct security deactivation notice, revocation timestamp & helpline
 *     - Error → Network failure with retry capability
 *     - Ready → Full live tracking dashboard with SSE streaming
 */

'use client';

import React, { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Bus,
  CheckCircle2,
  Clock,
  MapPin,
  MessageSquare,
  Navigation,
  Phone,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  User,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import {
  ParentLiveWebSecureEntryResponse,
  ParentTokenStatus,
  TripStatus,
  RouteType,
  ParentPickupEta,
} from '@school-bus/shared';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface PickupStop {
  id: string;
  stopName: string;
  sequenceOrder: number;
  scheduledTime: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
}

interface GpsLocation {
  latitude: number;
  longitude: number;
  speedKmh: number;
  bearingDegrees?: number | null;
  recordedAt: string;
}

interface ActiveTrip {
  id: string;
  routeName: string;
  routeType: RouteType;
  status: TripStatus;
  busNumber: string;
  registrationNumber: string;
  driverName: string;
  driverPhone?: string;
  delayMinutes: number;
  currentStopSequence: number;
  lastGpsLocation?: GpsLocation | null;
}

interface TrackingSession {
  isValid: boolean;
  expiresAt: string;
  parent: { id: string; fullName: string; relationship: string; phone: string };
  student: { id: string; fullName: string; admissionNumber?: string | null; classGrade?: string | null; section?: string | null };
  school: { id: string; name: string; code: string; timezone: string };
  pickupStop?: PickupStop | null;
  activeTrip?: ActiveTrip | null;
  parentEta?: ParentPickupEta | null;
}

interface SseFeedEvent {
  type: 'INITIAL_STATE' | 'LOCATION_UPDATE' | 'ETA_UPDATE' | 'HEARTBEAT';
  tripId?: string;
  latitude?: number;
  longitude?: number;
  speedKmh?: number;
  bearingDegrees?: number | null;
  tripStatus?: TripStatus;
  delayMinutes?: number;
  parentEta?: ParentPickupEta | null;
  etaSummary?: any | null;
  isStoppedBus?: boolean;
  recordedAt?: string;
  timestamp?: string;
}

export type PageState =
  | { phase: 'loading' }
  | { phase: 'no_token' }
  | { phase: 'invalid'; message?: string; supportPhone?: string }
  | { phase: 'expired'; expiresAt?: string; supportPhone?: string; emergencyPhone?: string; whatsappAction?: string }
  | { phase: 'revoked'; revokedAt?: string; message?: string; supportPhone?: string; emergencyPhone?: string }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; session: TrackingSession; supportPhone?: string; emergencyPhone?: string };

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const API_BASE =
  typeof process !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL ?? '')
    : '';

const STATUS_META: Record<
  TripStatus,
  { label: string; color: string; bg: string; Icon: typeof Bus }
> = {
  [TripStatus.SCHEDULED]: {
    label: 'Scheduled',
    color: 'text-slate-600',
    bg: 'bg-slate-100',
    Icon: Clock,
  },
  [TripStatus.IN_TRANSIT]: {
    label: 'In Transit',
    color: 'text-sky-700',
    bg: 'bg-sky-100',
    Icon: Bus,
  },
  [TripStatus.DELAYED]: {
    label: 'Delayed',
    color: 'text-amber-700',
    bg: 'bg-amber-100',
    Icon: AlertTriangle,
  },
  [TripStatus.ARRIVED_SCHOOL]: {
    label: 'Arrived at School',
    color: 'text-emerald-700',
    bg: 'bg-emerald-100',
    Icon: CheckCircle2,
  },
  [TripStatus.COMPLETED]: {
    label: 'Trip Completed',
    color: 'text-emerald-700',
    bg: 'bg-emerald-100',
    Icon: CheckCircle2,
  },
  [TripStatus.CANCELLED]: {
    label: 'Cancelled',
    color: 'text-slate-500',
    bg: 'bg-slate-100',
    Icon: XCircle,
  },
  [TripStatus.EMERGENCY]: {
    label: 'Emergency — SOS',
    color: 'text-red-700',
    bg: 'bg-red-100',
    Icon: ShieldAlert,
  },
};

function fmtTime(iso: string | null | undefined, tz: string = 'Asia/Kolkata'): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-IN', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function fmtDateTime(iso: string | null | undefined, tz: string = 'Asia/Kolkata'): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      timeZone: tz,
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function staticMapUrl(lat: number, lng: number, zoom = 14): string {
  const w = 600;
  const h = 280;
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=${zoom}&size=${w}x${h}&markers=${lat},${lng},red`;
}

function bearing2Arrow(deg: number | null | undefined): string {
  if (deg == null) return '●';
  const dirs = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  const idx = Math.round(((deg % 360) + 360) / 45) % 8;
  return dirs[idx] ?? '●';
}

// ─────────────────────────────────────────────────────────────
// Content Component
// ─────────────────────────────────────────────────────────────

function ParentTrackContent() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [pageState, setPageState] = useState<PageState>({ phase: 'loading' });

  // Live data layered on top of the session once SSE connects
  const [liveLocation, setLiveLocation] = useState<GpsLocation | null>(null);
  const [liveStatus, setLiveStatus] = useState<TripStatus | null>(null);
  const [liveDelay, setLiveDelay] = useState<number>(0);
  const [liveParentEta, setLiveParentEta] = useState<ParentPickupEta | null>(null);
  const [lastEtaUpdate, setLastEtaUpdate] = useState<string | null>(null);
  const [isRefreshingEta, setIsRefreshingEta] = useState<boolean>(false);
  const [sseConnected, setSseConnected] = useState<boolean>(false);
  const [lastHeard, setLastHeard] = useState<string | null>(null);

  // Reconnect state
  const sseRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);

  // ── 1. Secure Entry Token Validation ────────────────────────

  useEffect(() => {
    if (!token) {
      setPageState({ phase: 'no_token' });
      return;
    }

    const controller = new AbortController();

    // Call verify-entry endpoint
    fetch(`${API_BASE}/api/v1/parent/track/${encodeURIComponent(token)}/verify-entry`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) {
          // Fall back to direct session check if verify-entry route is unreachable
          const directRes = await fetch(
            `${API_BASE}/api/v1/parent/track/${encodeURIComponent(token)}`,
            {
              signal: controller.signal,
              headers: { Accept: 'application/json' },
            }
          );

          if (directRes.status === 401 || directRes.status === 403) {
            const errJson = (await directRes.json().catch(() => ({}))) as any;
            const reason = errJson?.error?.details?.reason;
            const msg = errJson?.error?.message || '';

            if (reason === 'TOKEN_REVOKED' || msg.toLowerCase().includes('revoked')) {
              setPageState({
                phase: 'revoked',
                message: msg,
              });
              return;
            }

            if (reason === 'TOKEN_EXPIRED' || msg.toLowerCase().includes('expired')) {
              setPageState({
                phase: 'expired',
                expiresAt: errJson?.error?.details?.expiresAt,
              });
              return;
            }

            setPageState({
              phase: 'invalid',
              message: msg || 'Invalid or unrecognizable tracking link.',
            });
            return;
          }

          if (!directRes.ok) {
            throw new Error(`Server returned error (${directRes.status})`);
          }

          const directJson = (await directRes.json()) as { data: TrackingSession };
          setPageState({ phase: 'ready', session: directJson.data });
          return;
        }

        const json = (await res.json()) as { data: ParentLiveWebSecureEntryResponse };
        const entry = json.data;

        if (entry.status === 'EXPIRED') {
          setPageState({
            phase: 'expired',
            expiresAt: entry.expiresAt ?? undefined,
            supportPhone: entry.schoolSupport?.supportPhone ?? undefined,
            emergencyPhone: entry.schoolSupport?.emergencyPhone ?? undefined,
            whatsappAction: entry.schoolSupport?.whatsappHelpAction ?? undefined,
          });
          return;
        }

        if (entry.status === 'REVOKED') {
          setPageState({
            phase: 'revoked',
            revokedAt: entry.revokedAt ?? undefined,
            message: entry.message,
            supportPhone: entry.schoolSupport?.supportPhone ?? undefined,
            emergencyPhone: entry.schoolSupport?.emergencyPhone ?? undefined,
          });
          return;
        }

        if (entry.status === 'INVALID' || entry.status === 'MISSING') {
          setPageState({
            phase: 'invalid',
            message: entry.message,
            supportPhone: entry.schoolSupport?.supportPhone ?? undefined,
          });
          return;
        }

        if (entry.status === 'VALID' && entry.session) {
          const session = entry.session as TrackingSession;
          setPageState({
            phase: 'ready',
            session,
            supportPhone: entry.schoolSupport?.supportPhone ?? undefined,
            emergencyPhone: entry.schoolSupport?.emergencyPhone ?? undefined,
          });

          // Seed live state from session snapshot
          if (session.parentEta) {
            setLiveParentEta(session.parentEta);
            if (session.parentEta.lastUpdatedAt) {
              setLastEtaUpdate(session.parentEta.lastUpdatedAt);
            }
          }

          if (session.activeTrip) {
            setLiveStatus(session.activeTrip.status);
            setLiveDelay(session.activeTrip.delayMinutes);
            if (session.activeTrip.lastGpsLocation) {
              setLiveLocation(session.activeTrip.lastGpsLocation);
              setLastHeard(session.activeTrip.lastGpsLocation.recordedAt);
            }
          }
        }
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') {
          setPageState({
            phase: 'error',
            message: err.message || 'Unable to connect to school bus tracking server',
            retryable: true,
          });
        }
      });

    return () => controller.abort();
  }, [token]);

  // ── 2. SSE live feed ─────────────────────────────────────

  const connectSse = useCallback(() => {
    if (!token) return;
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }

    const url = `${API_BASE}/api/v1/parent/feed/${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    sseRef.current = es;

    es.onopen = () => {
      setSseConnected(true);
      reconnectAttempts.current = 0;
    };

    es.onerror = () => {
      setSseConnected(false);
      es.close();
      sseRef.current = null;

      // Exponential back-off: 2s, 4s, 8s … capped at 30s
      const delay = Math.min(2000 * Math.pow(2, reconnectAttempts.current), 30000);
      reconnectAttempts.current += 1;
      reconnectTimer.current = setTimeout(() => connectSse(), delay);
    };

    es.onmessage = (raw: MessageEvent) => {
      try {
        const evt = JSON.parse(raw.data as string) as SseFeedEvent;
        setLastHeard(new Date().toISOString());

        if (evt.type === 'INITIAL_STATE' || evt.type === 'LOCATION_UPDATE') {
          if (evt.latitude != null && evt.longitude != null) {
            setLiveLocation({
              latitude: evt.latitude,
              longitude: evt.longitude,
              speedKmh: evt.speedKmh ?? 0,
              bearingDegrees: evt.bearingDegrees ?? null,
              recordedAt: evt.recordedAt ?? new Date().toISOString(),
            });
          }
          if (evt.tripStatus) setLiveStatus(evt.tripStatus);
          if (evt.delayMinutes != null) setLiveDelay(evt.delayMinutes);
          if (evt.parentEta) {
            setLiveParentEta(evt.parentEta);
            if (evt.parentEta.lastUpdatedAt) {
              setLastEtaUpdate(evt.parentEta.lastUpdatedAt);
            }
          }
        }

        if (evt.type === 'ETA_UPDATE') {
          if (evt.parentEta) {
            setLiveParentEta(evt.parentEta);
            setLastEtaUpdate(evt.parentEta.lastUpdatedAt ?? evt.recordedAt ?? new Date().toISOString());
          }
        }
      } catch {
        // Ignore unparseable frames
      }
    };
  }, [token]);

  // Manual ETA pull
  const refreshEta = async () => {
    if (!token) return;
    setIsRefreshingEta(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/parent/eta/${encodeURIComponent(token)}`, {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const json = (await res.json()) as { data: ParentPickupEta };
        if (json.data) {
          setLiveParentEta(json.data);
          if (json.data.lastUpdatedAt) setLastEtaUpdate(json.data.lastUpdatedAt);
        }
      }
    } catch {
      // Ignore transient network errors
    } finally {
      setIsRefreshingEta(false);
    }
  };

  useEffect(() => {
    if (pageState.phase !== 'ready') return;
    if (!pageState.session.activeTrip) return;

    connectSse();

    return () => {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [pageState.phase, connectSse]);

  // ── 3. Derived display values ─────────────────────────────

  const session = pageState.phase === 'ready' ? pageState.session : null;
  const effectiveStatus: TripStatus = liveStatus ?? session?.activeTrip?.status ?? TripStatus.SCHEDULED;
  const effectiveDelay = liveDelay ?? session?.activeTrip?.delayMinutes ?? 0;
  const tz = session?.school.timezone ?? 'Asia/Kolkata';
  const statusMeta = STATUS_META[effectiveStatus] ?? STATUS_META[TripStatus.SCHEDULED];
  const effectiveEta: ParentPickupEta | null = liveParentEta ?? session?.parentEta ?? null;

  // ── 4. Render states ──────────────────────────────────────

  // 4a. Loading State
  if (pageState.phase === 'loading') {
    return (
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 py-28 px-4 text-center">
          <div className="relative">
            <div className="w-12 h-12 border-3 border-sky-600/30 border-t-sky-600 rounded-full animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Bus className="w-5 h-5 text-sky-600 animate-pulse" />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-slate-800">Verifying secure tracking link…</p>
            <p className="text-xs text-slate-400">Authenticating student and school transport credentials</p>
          </div>
        </div>
      </Shell>
    );
  }

  // 4b. No Token State
  if (pageState.phase === 'no_token') {
    return (
      <Shell>
        <SecureCard
          badge={{ label: 'Link Required', color: 'bg-slate-100 text-slate-700' }}
          icon={<MessageSquare className="w-8 h-8 text-sky-600" />}
          title="No Tracking Link Found"
          body="Live bus tracking requires a secure student link sent directly to your WhatsApp mobile number."
          tips="To track your child's bus, open the link in your WhatsApp transport messages or reply TRACK on WhatsApp."
        />
      </Shell>
    );
  }

  // 4c. Expired Token State
  if (pageState.phase === 'expired') {
    return (
      <Shell>
        <SecureCard
          badge={{ label: 'Session Expired', color: 'bg-amber-100 text-amber-800' }}
          icon={<Clock className="w-8 h-8 text-amber-600" />}
          title="Tracking Link Has Expired"
          body="For student privacy and safety, live tracking links expire after each journey or scheduled duration."
          metaTime={pageState.expiresAt ? `Expired on ${fmtDateTime(pageState.expiresAt)}` : undefined}
          tips="You can instantly request a fresh live tracking link by replying TRACK or 1 to your school WhatsApp chat."
          actions={
            <div className="flex flex-col gap-2 pt-2 w-full">
              <a
                href="https://wa.me/"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-4 py-2.5 rounded-lg shadow-xs transition-colors"
              >
                <MessageSquare className="w-4 h-4" />
                Request Fresh Link via WhatsApp
              </a>
              {pageState.supportPhone && (
                <a
                  href={`tel:${pageState.supportPhone}`}
                  className="w-full inline-flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
                >
                  <Phone className="w-3.5 h-3.5" />
                  Call Transport Desk: {pageState.supportPhone}
                </a>
              )}
            </div>
          }
        />
      </Shell>
    );
  }

  // 4d. Revoked Token State
  if (pageState.phase === 'revoked') {
    return (
      <Shell>
        <SecureCard
          badge={{ label: 'Security Deactivation', color: 'bg-red-100 text-red-800' }}
          icon={<ShieldAlert className="w-8 h-8 text-red-600" />}
          title="Tracking Link Deactivated"
          body="This live tracking link was revoked by school transport administration for security reasons (e.g. stop update, student reassignment, or coordinator reset)."
          metaTime={pageState.revokedAt ? `Deactivated on ${fmtDateTime(pageState.revokedAt)}` : undefined}
          tips="To protect student safety, revoked links cannot be reused. Please contact your school coordinator for an updated link."
          actions={
            <div className="flex flex-col gap-2 pt-2 w-full">
              {pageState.emergencyPhone ? (
                <a
                  href={`tel:${pageState.emergencyPhone}`}
                  className="w-full inline-flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-4 py-2.5 rounded-lg shadow-xs transition-colors"
                >
                  <Phone className="w-4 h-4" />
                  Call Emergency Desk: {pageState.emergencyPhone}
                </a>
              ) : pageState.supportPhone ? (
                <a
                  href={`tel:${pageState.supportPhone}`}
                  className="w-full inline-flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-lg shadow-xs transition-colors"
                >
                  <Phone className="w-4 h-4" />
                  Call Transport Helpline: {pageState.supportPhone}
                </a>
              ) : null}
            </div>
          }
        />
      </Shell>
    );
  }

  // 4e. Invalid Token State
  if (pageState.phase === 'invalid') {
    return (
      <Shell>
        <SecureCard
          badge={{ label: 'Link Not Recognized', color: 'bg-slate-100 text-slate-700' }}
          icon={<XCircle className="w-8 h-8 text-red-500" />}
          title="Invalid Tracking Link"
          body={pageState.message || 'We could not recognize or verify this link in the school transport system.'}
          tips="Please verify that you tapped the full link from your WhatsApp message without truncation."
          actions={
            pageState.supportPhone ? (
              <a
                href={`tel:${pageState.supportPhone}`}
                className="mt-2 inline-flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                <Phone className="w-3.5 h-3.5" />
                Call Helpline: {pageState.supportPhone}
              </a>
            ) : undefined
          }
        />
      </Shell>
    );
  }

  // 4f. Error / Network State
  if (pageState.phase === 'error') {
    return (
      <Shell>
        <SecureCard
          badge={{ label: 'Network Error', color: 'bg-amber-100 text-amber-800' }}
          icon={<AlertTriangle className="w-8 h-8 text-amber-500" />}
          title="Unable to Load Live Tracking"
          body={pageState.message}
          actions={
            pageState.retryable ? (
              <button
                type="button"
                onClick={() => {
                  setPageState({ phase: 'loading' });
                  window.location.reload();
                }}
                className="mt-2 inline-flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold px-4 py-2.5 rounded-lg transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry Connection
              </button>
            ) : undefined
          }
        />
      </Shell>
    );
  }

  // ── 5. Ready State (Live Tracking View) ────────────────────

  const { student, school, pickupStop, activeTrip } = session!;
  const loc = liveLocation ?? activeTrip?.lastGpsLocation ?? null;

  return (
    <Shell sseConnected={sseConnected} hasActiveTrip={!!activeTrip}>
      <div className="flex-1 px-4 py-5 max-w-lg mx-auto w-full space-y-3">
        {/* Student & School Banner */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
              Live Student Transport
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              <ShieldCheck className="w-3 h-3" />
              Verified Link
            </span>
          </div>
          <p className="text-xl font-bold text-slate-900 leading-tight mt-1">
            {student.fullName}
          </p>
          {(student.classGrade || student.admissionNumber) && (
            <p className="text-xs text-slate-500 mt-0.5">
              {student.classGrade ? `Class ${student.classGrade}${student.section ? `-${student.section}` : ''}` : ''}
              {student.admissionNumber ? ` · ID: ${student.admissionNumber}` : ''}
            </p>
          )}
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
            <MapPin className="w-3 h-3 text-slate-400" />
            {school.name}
          </p>
        </div>

        {/* No active trip notice */}
        {!activeTrip && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6 text-center space-y-2">
            <Bus className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="text-sm font-semibold text-slate-700">No Trip Currently in Progress</p>
            <p className="text-xs text-slate-400 leading-relaxed max-w-xs mx-auto">
              Live bus telemetry activates automatically when the morning pickup or afternoon drop trip begins.
            </p>
            {pickupStop && (
              <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
                Assigned pickup stop:{' '}
                <span className="font-semibold text-slate-700">{pickupStop.stopName}</span>
                {pickupStop.scheduledTime && (
                  <span className="ml-1 text-slate-400">
                    · {pickupStop.scheduledTime}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Active Trip Panels */}
        {activeTrip && (
          <>
            {/* Status Banner */}
            <div
              className={`rounded-xl border shadow-xs p-4 flex items-start gap-3 ${statusMeta.bg} border-transparent`}
            >
              <statusMeta.Icon
                className={`w-5 h-5 mt-0.5 flex-shrink-0 ${statusMeta.color}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className={`text-sm font-bold ${statusMeta.color}`}>
                    {statusMeta.label}
                  </span>
                  {effectiveDelay > 0 && effectiveStatus === 'DELAYED' && (
                    <span className="text-xs bg-amber-200/70 text-amber-800 font-semibold px-2 py-0.5 rounded-full">
                      ~{effectiveDelay} min late
                    </span>
                  )}
                </div>
                <p className={`text-xs mt-0.5 ${statusMeta.color} opacity-80`}>
                  {activeTrip.routeName} · Bus {activeTrip.busNumber}
                </p>
              </div>
            </div>

            {/* ETA Card */}
            {pickupStop && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-sky-600" />
                    Pickup Stop ETA
                  </p>
                  <div className="flex items-center gap-2">
                    {lastEtaUpdate && (
                      <span className="text-[10px] text-slate-400 font-mono">
                        Updated {fmtRelative(lastEtaUpdate)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={refreshEta}
                      disabled={isRefreshingEta}
                      className="text-slate-400 hover:text-sky-600 p-0.5 rounded transition-colors disabled:opacity-50"
                      title="Refresh ETA"
                      aria-label="Refresh ETA"
                    >
                      <RefreshCw className={`w-3 h-3 ${isRefreshingEta ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-800 text-sm">
                      {pickupStop.stopName}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Scheduled: {pickupStop.scheduledTime}
                    </p>
                  </div>

                  <div className="text-right flex-shrink-0">
                    {effectiveEta?.isAvailable && effectiveEta.etaMinutes != null ? (
                      <div>
                        <div className="flex items-baseline justify-end gap-1">
                          <p className="text-3xl font-black text-sky-600 tabular-nums leading-none">
                            {effectiveEta.durationSeconds != null && effectiveEta.durationSeconds < 60
                              ? '< 1'
                              : effectiveEta.etaMinutes}
                          </p>
                          <span className="text-sm font-bold text-sky-500">min</span>
                        </div>
                        <p className="text-[11px] font-medium text-slate-500 mt-1">
                          Arriving ~{fmtTime(effectiveEta.estimatedArrivalAt, tz)}
                        </p>
                        {effectiveEta.distanceMeters != null && (
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {effectiveEta.distanceMeters >= 1000
                              ? `${(effectiveEta.distanceMeters / 1000).toFixed(1)} km away`
                              : `${Math.round(effectiveEta.distanceMeters)} m away`}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="text-right">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600">
                          {effectiveEta?.status === 'PASSED'
                            ? 'Passed'
                            : effectiveEta?.unavailableReason === 'TRIP_NOT_STARTED'
                            ? 'Scheduled'
                            : effectiveEta?.unavailableReason === 'GPS_UNAVAILABLE'
                            ? 'GPS Offline'
                            : 'Pending'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {effectiveEta?.isApproaching && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 flex items-center gap-2 text-xs text-emerald-800 animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                    <span className="font-medium">
                      The bus is approaching {pickupStop.stopName}! Please be at the stop.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Static Map */}
            {loc && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                    <Navigation className="w-3 h-3" />
                    Live Location
                  </p>
                  <span className="text-[10px] text-slate-400 font-mono tabular-nums">
                    {lastHeard ? fmtRelative(lastHeard) : ''}
                  </span>
                </div>

                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={staticMapUrl(loc.latitude, loc.longitude)}
                  alt={`Bus location map near ${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`}
                  className="w-full h-40 object-cover"
                  loading="lazy"
                />

                <div className="px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="text-base">{bearing2Arrow(loc.bearingDegrees)}</span>
                    <span className="font-medium">{Math.round(loc.speedKmh)} km/h</span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono">
                    {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
                  </p>
                </div>
              </div>
            )}

            {/* Driver Card */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Bus Crew
              </p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                    <User className="w-4 h-4 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{activeTrip.driverName}</p>
                    <p className="text-xs text-slate-400">{activeTrip.registrationNumber}</p>
                  </div>
                </div>
                {activeTrip.driverPhone && (
                  <a
                    href={`tel:${activeTrip.driverPhone}`}
                    className="flex items-center gap-1.5 text-xs font-semibold text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    Call
                  </a>
                )}
              </div>
            </div>
          </>
        )}

        {/* Safety Note */}
        <p className="text-[10px] text-slate-400 text-center px-4 pt-2">
          This is an encrypted, secure view linked directly to your child's bus trip.
        </p>
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function Shell({
  children,
  sseConnected,
  hasActiveTrip,
}: {
  children: React.ReactNode;
  sseConnected?: boolean;
  hasActiveTrip?: boolean;
}) {
  return (
    <main className="min-h-screen bg-slate-50 flex flex-col">
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-sky-600 flex items-center justify-center">
            <Bus className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800 leading-none">BUSLOARD</p>
            <p className="text-[10px] text-slate-400 leading-none mt-0.5">
              School Transport Safety Platform
            </p>
          </div>
        </div>

        {hasActiveTrip && (
          <div className="flex items-center gap-1.5">
            {sseConnected ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] text-emerald-600 font-medium">Live</span>
                <Wifi className="w-3.5 h-3.5 text-emerald-500" />
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                <WifiOff className="w-3.5 h-3.5 text-slate-400" />
              </>
            )}
          </div>
        )}
      </header>

      {children}
    </main>
  );
}

function SecureCard({
  badge,
  icon,
  title,
  body,
  metaTime,
  tips,
  actions,
}: {
  badge?: { label: string; color: string };
  icon: React.ReactNode;
  title: string;
  body: string;
  metaTime?: string;
  tips?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="max-w-sm w-full bg-white border border-slate-200 rounded-xl p-6 text-center shadow-xs space-y-3.5">
        {badge && (
          <div className="flex justify-center">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${badge.color}`}>
              {badge.label}
            </span>
          </div>
        )}
        <div className="flex justify-center">{icon}</div>
        <div className="space-y-1">
          <p className="text-base font-bold text-slate-900">{title}</p>
          <p className="text-xs text-slate-500 leading-relaxed">{body}</p>
          {metaTime && (
            <p className="text-[11px] font-medium text-slate-400 pt-1">{metaTime}</p>
          )}
        </div>
        {tips && (
          <div className="bg-slate-50 rounded-lg p-2.5 text-[11px] text-slate-500 leading-relaxed border border-slate-100">
            {tips}
          </div>
        )}
        {actions}
      </div>
    </div>
  );
}

export default function ParentTrackPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <div className="flex-1 flex items-center justify-center py-24">
            <div className="w-8 h-8 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
          </div>
        </Shell>
      }
    >
      <ParentTrackContent />
    </Suspense>
  );
}
