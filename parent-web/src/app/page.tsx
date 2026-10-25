/**
 * Parent Live Tracking Page — parent-web (Phase 23)
 *
 * Micro-phase 23.1: Secure Entry (Token Validation, Expiry, Revocation)
 * Micro-phase 23.2: Live View (Bus Marker, Route, Pickup, ETA, Bus Number, Trip Status, Last Update)
 * Micro-phase 23.3: Failure States (Bus Offline, Trip Ended, Invalid Link, Stale Location)
 *
 * Accessible via tokenized WhatsApp link:
 *   /track?token=<parent_token>   OR   /?token=<parent_token>
 */

'use client';

import React, { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Bus,
  CheckCircle2,
  Clock,
  Compass,
  Info,
  MapPin,
  MessageSquare,
  Navigation,
  Phone,
  RefreshCw,
  Route as RouteIcon,
  ShieldAlert,
  ShieldCheck,
  User,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import {
  TripStatus,
  RouteType,
  ParentPickupEta,
} from '@school-bus/shared';
import {
  ParentLiveMapCanvas,
  FeedConnectionStatus,
} from '../components/ParentLiveMapCanvas';

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
  routeId: string;
  routeName: string;
  routeCode?: string | null;
  totalStops?: number | null;
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
  student: {
    id: string;
    fullName: string;
    admissionNumber?: string | null;
    classGrade?: string | null;
    section?: string | null;
  };
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
  | {
      phase: 'expired';
      expiresAt?: string;
      supportPhone?: string;
      emergencyPhone?: string;
      whatsappAction?: string;
    }
  | {
      phase: 'revoked';
      revokedAt?: string;
      message?: string;
      supportPhone?: string;
      emergencyPhone?: string;
    }
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
  {
    label: string;
    headline: string;
    color: string;
    bg: string;
    border: string;
    Icon: typeof Bus;
  }
> = {
  [TripStatus.SCHEDULED]: {
    label: 'Scheduled',
    headline: 'Trip Scheduled · Awaiting Departure',
    color: 'text-slate-700',
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    Icon: Clock,
  },
  [TripStatus.IN_TRANSIT]: {
    label: 'In Transit',
    headline: 'Bus En Route · Live Telemetry Active',
    color: 'text-sky-800',
    bg: 'bg-sky-50',
    border: 'border-sky-200',
    Icon: Bus,
  },
  [TripStatus.DELAYED]: {
    label: 'Delayed',
    headline: 'Route Delay Reported',
    color: 'text-amber-800',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    Icon: AlertTriangle,
  },
  [TripStatus.ARRIVED_SCHOOL]: {
    label: 'Arrived at School',
    headline: 'Bus Safely Arrived at Campus',
    color: 'text-emerald-800',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    Icon: CheckCircle2,
  },
  [TripStatus.COMPLETED]: {
    label: 'Trip Completed',
    headline: 'Journey Completed Successfully',
    color: 'text-emerald-800',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    Icon: CheckCircle2,
  },
  [TripStatus.CANCELLED]: {
    label: 'Cancelled',
    headline: 'Trip Cancelled by Transport Desk',
    color: 'text-rose-800',
    bg: 'bg-rose-50',
    border: 'border-rose-200',
    Icon: XCircle,
  },
  [TripStatus.EMERGENCY]: {
    label: 'Emergency / SOS',
    headline: 'EMERGENCY / SOS ALERT ACTIVE',
    color: 'text-red-900',
    bg: 'bg-red-50',
    border: 'border-red-300',
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
  const diff = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function fmtRouteType(type?: RouteType): string {
  if (type === RouteType.MORNING_PICKUP) return 'Morning Pickup';
  if (type === RouteType.AFTERNOON_DROP) return 'Afternoon Drop';
  if (type === RouteType.SPECIAL_TRIP) return 'Special Trip';
  return 'School Route';
}

// ─────────────────────────────────────────────────────────────
// Content Component
// ─────────────────────────────────────────────────────────────

function ParentTrackContent() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [pageState, setPageState] = useState<PageState>({ phase: 'loading' });

  // Live state received from SSE or ETA polls
  const [liveLocation, setLiveLocation] = useState<GpsLocation | null>(null);
  const [liveStatus, setLiveStatus] = useState<TripStatus | null>(null);
  const [liveDelay, setLiveDelay] = useState<number>(0);
  const [liveParentEta, setLiveParentEta] = useState<ParentPickupEta | null>(null);
  const [lastEtaUpdate, setLastEtaUpdate] = useState<string | null>(null);
  const [isRefreshingEta, setIsRefreshingEta] = useState<boolean>(false);
  const [feedStatus, setFeedStatus] = useState<FeedConnectionStatus>('CONNECTING');
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  const [, setClockTick] = useState<number>(Date.now());

  // Connection management refs
  const sseRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);

  // Periodic clock ticker so relative timestamps update smoothly
  useEffect(() => {
    const timer = setInterval(() => {
      setClockTick(Date.now());
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // ── 1. Secure Entry Token Validation ────────────────────────

  useEffect(() => {
    if (!token) {
      setPageState({ phase: 'no_token' });
      return;
    }

    const controller = new AbortController();

    const verifyUrl = `${API_BASE}/api/v1/parent/track/${encodeURIComponent(token)}/verify-entry`;
    const fallbackUrl = `${API_BASE}/api/v1/parent/track/${encodeURIComponent(token)}`;

    fetch(verifyUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then(async (res) => {
        if (res.status === 404) {
          return fetch(fallbackUrl, {
            signal: controller.signal,
            headers: { Accept: 'application/json' },
          });
        }
        return res;
      })
      .then(async (res) => {
        const json = await res.json();

        if (!res.ok) {
          const errorCode = json?.error?.details?.reason ?? json?.error?.code ?? '';
          const msg = json?.error?.message ?? 'Tracking link verification failed';

          if (errorCode === 'TOKEN_EXPIRED') {
            setPageState({
              phase: 'expired',
              expiresAt: json.error.details?.expiresAt,
              supportPhone: json.error.details?.supportPhone,
            });
            return;
          }
          if (errorCode === 'TOKEN_REVOKED') {
            setPageState({
              phase: 'revoked',
              revokedAt: json.error.details?.revokedAt,
              message: msg,
              supportPhone: json.error.details?.supportPhone,
            });
            return;
          }
          if (errorCode === 'TOKEN_INVALID' || errorCode === 'TOKEN_MISSING') {
            setPageState({ phase: 'invalid', message: msg });
            return;
          }

          setPageState({ phase: 'error', message: msg, retryable: true });
          return;
        }

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

    setFeedStatus('CONNECTING');
    const url = `${API_BASE}/api/v1/parent/feed/${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    sseRef.current = es;

    es.onopen = () => {
      setFeedStatus('LIVE');
      reconnectAttempts.current = 0;
    };

    es.onerror = () => {
      setFeedStatus(reconnectAttempts.current > 3 ? 'OFFLINE' : 'RECONNECTING');
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

  // ── 3. Derived display values & Failure State Calculations ──

  const session = pageState.phase === 'ready' ? pageState.session : null;
  const effectiveStatus: TripStatus = liveStatus ?? session?.activeTrip?.status ?? TripStatus.SCHEDULED;
  const effectiveDelay = liveDelay ?? session?.activeTrip?.delayMinutes ?? 0;
  const tz = session?.school.timezone ?? 'Asia/Kolkata';
  const statusMeta = STATUS_META[effectiveStatus] ?? STATUS_META[TripStatus.SCHEDULED];
  const effectiveEta: ParentPickupEta | null = liveParentEta ?? session?.parentEta ?? null;

  // Telemetry recency & health calculation
  const loc = liveLocation ?? session?.activeTrip?.lastGpsLocation ?? null;
  const locAgeSec = loc
    ? Math.max(0, (Date.now() - new Date(loc.recordedAt).getTime()) / 1000)
    : Infinity;

  const isLocStale = loc != null && locAgeSec >= 120 && locAgeSec < 300; // 2 to 5 minutes old
  const isLocLost = loc == null || locAgeSec >= 300; // > 5 minutes old or null fix
  const isTripActive =
    effectiveStatus === TripStatus.IN_TRANSIT ||
    effectiveStatus === TripStatus.DELAYED ||
    effectiveStatus === TripStatus.EMERGENCY;
  const isTripEnded =
    effectiveStatus === TripStatus.ARRIVED_SCHOOL ||
    effectiveStatus === TripStatus.COMPLETED;
  const isTripCancelled = effectiveStatus === TripStatus.CANCELLED;

  // ── 4. Render states ──────────────────────────────────────

  // 4a. Loading State
  if (pageState.phase === 'loading') {
    return (
      <Shell feedStatus="CONNECTING">
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
          tips="Tracking links are tied directly to your child's student admission record. Please ensure you tapped the full link from your WhatsApp message without truncation."
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

  // Calculate route sequence progression percentage
  const currentSeq = activeTrip?.currentStopSequence ?? 0;
  const totalStops = activeTrip?.totalStops ?? (pickupStop ? Math.max(pickupStop.sequenceOrder, 1) : 1);
  const routePercent = Math.min(Math.round((currentSeq / Math.max(totalStops, 1)) * 100), 100);

  return (
    <Shell feedStatus={feedStatus} hasActiveTrip={!!activeTrip}>
      <div className="flex-1 px-4 py-5 max-w-lg mx-auto w-full space-y-3.5">
        {/* Student & School Banner */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
              Live Student Transport
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Verified Link
            </span>
          </div>
          <p className="text-xl font-black text-slate-900 leading-tight mt-1">
            {student.fullName}
          </p>
          {(student.classGrade || student.admissionNumber) && (
            <p className="text-xs text-slate-500 mt-0.5">
              {student.classGrade
                ? `Class ${student.classGrade}${student.section ? `-${student.section}` : ''}`
                : ''}
              {student.admissionNumber ? ` · ID: ${student.admissionNumber}` : ''}
            </p>
          )}
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
            <span className="truncate">{school.name}</span>
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
                  <span className="ml-1 text-slate-400">· {pickupStop.scheduledTime}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Active Trip Panels */}
        {activeTrip && (
          <>
            {/* 1. Trip Status Banner */}
            <div
              className={`rounded-xl border shadow-xs p-4 flex items-start gap-3 ${statusMeta.bg} ${statusMeta.border}`}
            >
              <statusMeta.Icon
                className={`w-5 h-5 mt-0.5 flex-shrink-0 ${statusMeta.color}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className={`text-sm font-bold ${statusMeta.color}`}>
                    {statusMeta.headline}
                  </span>
                  {effectiveDelay > 0 && effectiveStatus === TripStatus.DELAYED && (
                    <span className="text-xs bg-amber-200/80 text-amber-900 font-bold px-2 py-0.5 rounded-full border border-amber-300">
                      ~{effectiveDelay} min late
                    </span>
                  )}
                </div>

                {effectiveStatus === TripStatus.EMERGENCY ? (
                  <div className="mt-2 text-xs text-red-800 space-y-1">
                    <p className="font-semibold">
                      An emergency has been flagged for this trip. The transport operations desk has been notified.
                    </p>
                    {pageState.phase === 'ready' && pageState.emergencyPhone && (
                      <a
                        href={`tel:${pageState.emergencyPhone}`}
                        className="inline-flex items-center gap-1.5 mt-1 bg-red-600 hover:bg-red-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        Call Emergency Desk: {pageState.emergencyPhone}
                      </a>
                    )}
                  </div>
                ) : (
                  <p className={`text-xs mt-0.5 ${statusMeta.color} opacity-85`}>
                    {activeTrip.routeName} · Bus {activeTrip.busNumber}
                  </p>
                )}
              </div>
            </div>

            {/* FAILURE STATE 1: Bus Offline Alert Banner */}
            {isTripActive && isLocLost && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 space-y-2.5 shadow-2xs">
                <div className="flex items-center gap-2 text-rose-800">
                  <div className="w-6 h-6 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0">
                    <WifiOff className="w-3.5 h-3.5 text-rose-600" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-rose-950 uppercase tracking-wide">
                      Bus GPS Offline · Signal Disrupted
                    </p>
                  </div>
                </div>

                <p className="text-xs text-rose-900 leading-relaxed">
                  Live coordinates from Bus #{activeTrip.busNumber} have not been received for over 5 minutes. The vehicle is still in transit on its assigned route. GPS fixes may temporarily drop due to underpasses, flyovers, or cellular dead zones.
                </p>

                {loc ? (
                  <p className="text-[11px] text-rose-700 font-mono">
                    Last recorded fix: {fmtTime(loc.recordedAt, tz)} ({fmtRelative(loc.recordedAt)})
                  </p>
                ) : (
                  <p className="text-[11px] text-rose-700 font-mono">
                    Awaiting initial satellite telemetry lock from vehicle device.
                  </p>
                )}

                {activeTrip.driverPhone && (
                  <div className="pt-0.5">
                    <a
                      href={`tel:${activeTrip.driverPhone}`}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-900 bg-rose-100 hover:bg-rose-200 border border-rose-300 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <Phone className="w-3.5 h-3.5 text-rose-700" />
                      Contact Driver: {activeTrip.driverName}
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* FAILURE STATE 2: Stale Location Alert Banner */}
            {isTripActive && isLocStale && loc && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-start gap-3 shadow-2xs">
                <Clock className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-amber-950">
                    Telemetry Delayed · Fix from {fmtRelative(loc.recordedAt)}
                  </p>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    Location updates are slightly delayed due to cellular reception conditions in this area. Position will refresh automatically as connection stabilizes.
                  </p>
                </div>
              </div>
            )}

            {/* FAILURE STATE 3: Trip Ended Dedicated View */}
            {isTripEnded && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 space-y-3.5 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="w-6 h-6 text-emerald-700" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-emerald-950">
                      {effectiveStatus === TripStatus.ARRIVED_SCHOOL
                        ? 'Bus Safely Arrived at Campus'
                        : 'Journey Completed'}
                    </p>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      {effectiveStatus === TripStatus.ARRIVED_SCHOOL
                        ? 'Student transport for this morning shift is complete.'
                        : 'Today’s bus transport journey has completed safely.'}
                    </p>
                  </div>
                </div>

                <div className="bg-white/90 rounded-xl p-3.5 text-xs text-slate-700 space-y-2 border border-emerald-100">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Student</span>
                    <span className="font-bold text-slate-900">{student.fullName}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Pickup/Drop Stop</span>
                    <span className="font-bold text-slate-900">
                      {pickupStop?.stopName ?? 'Assigned Stop'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Next Scheduled Journey</span>
                    <span className="font-semibold text-sky-800 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
                      {activeTrip.routeType === RouteType.MORNING_PICKUP
                        ? 'Afternoon Drop'
                        : 'Next School Day'}
                    </span>
                  </div>
                </div>

                <p className="text-[11px] text-emerald-800 text-center font-medium">
                  Live telemetry has paused. It will automatically reactivate for the next trip.
                </p>
              </div>
            )}

            {/* FAILURE STATE 4: Trip Cancelled View */}
            {isTripCancelled && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-5 space-y-3 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-rose-100 border border-rose-300 flex items-center justify-center flex-shrink-0">
                    <XCircle className="w-6 h-6 text-rose-600" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-rose-950">Trip Cancelled</p>
                    <p className="text-xs text-rose-700 mt-0.5">
                      This trip was cancelled by school transport dispatch.
                    </p>
                  </div>
                </div>
                <p className="text-xs text-rose-900 leading-relaxed">
                  Please consult your school announcements or WhatsApp notifications for alternate vehicle assignments or parent pickup instructions.
                </p>
                {pageState.phase === 'ready' && pageState.supportPhone && (
                  <a
                    href={`tel:${pageState.supportPhone}`}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-900 bg-rose-100 hover:bg-rose-200 border border-rose-300 px-3 py-2 rounded-lg transition-colors"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    Call Transport Desk: {pageState.supportPhone}
                  </a>
                )}
              </div>
            )}

            {/* Interactive Map Canvas (shown for active and ended trips) */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="px-4 pt-3 pb-2 flex items-center justify-between border-b border-slate-100 bg-slate-50/50">
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                  <Navigation className="w-3.5 h-3.5 text-sky-600" />
                  Live Bus Tracking
                </p>
                <span className="text-[10px] text-slate-400 font-mono tabular-nums">
                  {lastHeard ? `Fix: ${fmtRelative(lastHeard)}` : ''}
                </span>
              </div>

              <div className="p-2 bg-slate-900">
                <ParentLiveMapCanvas
                  busLocation={
                    loc
                      ? {
                          latitude: loc.latitude,
                          longitude: loc.longitude,
                          speedKmh: loc.speedKmh,
                          bearingDegrees: loc.bearingDegrees,
                          recordedAt: loc.recordedAt,
                        }
                      : null
                  }
                  pickupStop={
                    pickupStop
                      ? {
                          latitude: pickupStop.latitude,
                          longitude: pickupStop.longitude,
                          stopName: pickupStop.stopName,
                          geofenceRadiusMeters: pickupStop.geofenceRadiusMeters,
                          sequenceOrder: pickupStop.sequenceOrder,
                          scheduledTime: pickupStop.scheduledTime,
                        }
                      : null
                  }
                  feedStatus={feedStatus}
                  tripStatus={statusMeta.label}
                  isApproaching={!isTripEnded && (effectiveEta?.isApproaching ?? false)}
                />
              </div>

              {loc && (
                <div className="px-4 py-2.5 flex items-center justify-between text-xs text-slate-600 bg-white">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 font-semibold text-slate-800">
                      <Compass className="w-3.5 h-3.5 text-sky-600" />
                      {loc.bearingDegrees != null ? `${Math.round(loc.bearingDegrees)}°` : '—'}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="font-semibold text-slate-800">
                      {Math.round(loc.speedKmh)} km/h
                    </span>
                    <span className="text-slate-400">·</span>
                    <span
                      className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${
                        isLocLost
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : isLocStale
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : loc.speedKmh < 2
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {isLocLost
                        ? 'GPS Offline'
                        : isLocStale
                        ? 'Stale Location'
                        : loc.speedKmh < 2
                        ? 'Stationary'
                        : 'Moving'}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono">
                    {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                  </p>
                </div>
              )}
            </div>

            {/* Route Details & Sequence Progression (only when trip is active or scheduled) */}
            {!isTripEnded && !isTripCancelled && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
                    <RouteIcon className="w-3.5 h-3.5 text-sky-600" />
                    Assigned Route
                  </p>
                  <span className="text-[11px] font-semibold text-sky-700 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
                    {fmtRouteType(activeTrip.routeType)}
                  </span>
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-900 text-sm">
                      {activeTrip.routeName}
                    </p>
                    {activeTrip.routeCode && (
                      <p className="text-xs text-slate-400 font-mono mt-0.5">
                        Code: {activeTrip.routeCode}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-1 rounded">
                      Stop {currentSeq} of {totalStops}
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="space-y-1 pt-1">
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200">
                    <div
                      className="bg-sky-600 h-2 rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${Math.max(routePercent, 5)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                    <span>Start (Depot)</span>
                    <span>{routePercent}% completed</span>
                    <span>Destination</span>
                  </div>
                </div>
              </div>
            )}

            {/* Pickup Stop & Real-Time ETA Card (only when trip is active or scheduled) */}
            {!isTripEnded && !isTripCancelled && pickupStop && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wide flex items-center gap-1.5">
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
                      className="text-slate-400 hover:text-sky-600 p-1 rounded-md hover:bg-slate-100 transition-colors disabled:opacity-50"
                      title="Refresh ETA"
                      aria-label="Refresh ETA"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${isRefreshingEta ? 'animate-spin text-sky-600' : ''}`}
                      />
                    </button>
                  </div>
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-900 text-sm">
                      {pickupStop.stopName}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Scheduled: <span className="font-semibold">{pickupStop.scheduledTime}</span>
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Stop sequence order #{pickupStop.sequenceOrder} · Geofence: {pickupStop.geofenceRadiusMeters || 500}m
                    </p>
                  </div>

                  <div className="text-right flex-shrink-0">
                    {effectiveEta?.isAvailable && effectiveEta.etaMinutes != null && !isLocLost ? (
                      <div>
                        <div className="flex items-baseline justify-end gap-1">
                          <p className="text-3xl font-black text-sky-600 tabular-nums leading-none">
                            {effectiveEta.durationSeconds != null && effectiveEta.durationSeconds < 60
                              ? '< 1'
                              : effectiveEta.etaMinutes}
                          </p>
                          <span className="text-sm font-bold text-sky-500">min</span>
                        </div>
                        <p className="text-[11px] font-semibold text-slate-700 mt-1">
                          Arriving ~{fmtTime(effectiveEta.estimatedArrivalAt, tz)}
                        </p>
                        {effectiveEta.distanceMeters != null && (
                          <p className="text-[10px] text-slate-400 mt-0.5 font-mono">
                            {effectiveEta.distanceMeters >= 1000
                              ? `${(effectiveEta.distanceMeters / 1000).toFixed(1)} km away`
                              : `${Math.round(effectiveEta.distanceMeters)} m away`}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="text-right">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded text-[11px] font-bold border ${
                            isLocLost
                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {isLocLost
                            ? 'GPS Offline'
                            : effectiveEta?.status === 'PASSED'
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

                {effectiveEta?.isApproaching && !isLocLost && (
                  <div className="bg-emerald-50 border border-emerald-300 rounded-lg p-3 flex items-center gap-2.5 text-xs text-emerald-900 animate-pulse">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
                    <span className="font-bold">
                      The bus is approaching {pickupStop.stopName}! Please ensure the student is waiting at the stop.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Bus & Crew Card */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                  Vehicle & Crew Details
                </p>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-black bg-sky-100 text-sky-800 border border-sky-300">
                  Bus #{activeTrip.busNumber}
                </span>
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center">
                    <User className="w-5 h-5 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">{activeTrip.driverName}</p>
                    <p className="text-xs text-slate-500 font-mono">{activeTrip.registrationNumber}</p>
                  </div>
                </div>

                {activeTrip.driverPhone && (
                  <a
                    href={`tel:${activeTrip.driverPhone}`}
                    className="flex items-center gap-1.5 text-xs font-bold text-sky-700 hover:text-sky-800 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-3 py-2 rounded-lg transition-colors shadow-2xs"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    Call Driver
                  </a>
                )}
              </div>
            </div>
          </>
        )}

        {/* Safety Note & Recency Footer */}
        <div className="pt-2 text-center space-y-1">
          <p className="text-[10px] text-slate-400">
            Encrypted secure link · 1:1 verified student transport access
          </p>
          {lastHeard && (
            <p className="text-[10px] text-slate-400 font-mono">
              Telemetry stream last updated: {fmtTime(lastHeard, tz)}
            </p>
          )}
        </div>
      </div>
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function Shell({
  children,
  feedStatus,
  hasActiveTrip,
}: {
  children: React.ReactNode;
  feedStatus?: FeedConnectionStatus;
  hasActiveTrip?: boolean;
}) {
  return (
    <main className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center shadow-xs">
            <Bus className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-black text-slate-900 tracking-tight leading-none">BUSLOARD</p>
            <p className="text-[10px] text-slate-400 leading-none mt-1 font-medium">
              School Transport Safety Platform
            </p>
          </div>
        </div>

        {hasActiveTrip && (
          <div className="flex items-center gap-1.5">
            {feedStatus === 'LIVE' ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
                <Wifi className="w-3 h-3 text-emerald-600" />
              </span>
            ) : feedStatus === 'RECONNECTING' ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                <RefreshCw className="w-3 h-3 animate-spin text-amber-600" />
                Reconnecting
              </span>
            ) : feedStatus === 'CONNECTING' ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                Connecting
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                <WifiOff className="w-3 h-3 text-slate-400" />
                Offline
              </span>
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
  tips,
  metaTime,
  actions,
}: {
  badge: { label: string; color: string };
  icon: React.ReactNode;
  title: string;
  body: string;
  tips?: string;
  metaTime?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4 text-center">
        <div className="flex justify-center">
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${badge.color}`}>
            {badge.label}
          </span>
        </div>

        <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center mx-auto shadow-inner">
          {icon}
        </div>

        <div className="space-y-1.5">
          <h1 className="text-lg font-black text-slate-900">{title}</h1>
          <p className="text-xs text-slate-500 leading-relaxed">{body}</p>
          {metaTime && (
            <p className="text-[11px] font-mono text-slate-400 pt-1">{metaTime}</p>
          )}
        </div>

        {tips && (
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-left">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Next Step</p>
            <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{tips}</p>
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
            <Bus className="w-6 h-6 text-sky-600 animate-pulse" />
          </div>
        </Shell>
      }
    >
      <ParentTrackContent />
    </Suspense>
  );
}
