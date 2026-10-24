/**
 * Parent Live Tracking Page — parent-web
 *
 * Accessible via tokenised WhatsApp link:
 *   /track?token=<parent_token>   OR   /<token>
 *
 * Responsibilities:
 *  1. Validate token by fetching session from /api/v1/parent/track/:token
 *  2. Open SSE stream at /api/v1/parent/feed/:token for real-time location + ETA
 *  3. Render appropriate state: Loading → Error | Expired | No-Trip | Live | Completed
 *  4. Auto-reconnect SSE with exponential back-off on disconnect
 *
 * No dependencies beyond next/react/lucide-react/tailwind (already installed).
 * Map tile: OpenStreetMap static image (no API key required).
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Bus,
  CheckCircle2,
  Clock,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  ShieldAlert,
  User,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────
// Types (mirrors backend shared types — no extra import needed)
// ─────────────────────────────────────────────────────────────

type TripStatus =
  | 'SCHEDULED'
  | 'IN_TRANSIT'
  | 'DELAYED'
  | 'ARRIVED_SCHOOL'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EMERGENCY';

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
  routeType: string;
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
  student: { id: string; fullName: string; gradeSection?: string | null };
  school: { id: string; name: string; code: string; timezone: string };
  pickupStop?: PickupStop | null;
  activeTrip?: ActiveTrip | null;
}

// SSE event from /api/v1/parent/feed/:token
interface SseFeedEvent {
  type: 'INITIAL_STATE' | 'LOCATION_UPDATE' | 'ETA_UPDATE' | 'HEARTBEAT';
  tripId?: string;
  latitude?: number;
  longitude?: number;
  speedKmh?: number;
  bearingDegrees?: number | null;
  tripStatus?: TripStatus;
  delayMinutes?: number;
  eta?: EtaSummary | null;
  recordedAt?: string;
}

interface EtaStop {
  stopId: string;
  stopName: string;
  sequenceOrder: number;
  etaMinutes: number | null;
  etaTimestamp: string | null;
}

interface EtaSummary {
  stops: EtaStop[];
  computedAt: string;
}

// ─────────────────────────────────────────────────────────────
// Page state machine
// ─────────────────────────────────────────────────────────────

type PageState =
  | { phase: 'loading' }
  | { phase: 'no_token' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'expired' }
  | { phase: 'ready'; session: TrackingSession };

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
  SCHEDULED: {
    label: 'Scheduled',
    color: 'text-slate-600',
    bg: 'bg-slate-100',
    Icon: Clock,
  },
  IN_TRANSIT: {
    label: 'In Transit',
    color: 'text-sky-700',
    bg: 'bg-sky-100',
    Icon: Bus,
  },
  DELAYED: {
    label: 'Delayed',
    color: 'text-amber-700',
    bg: 'bg-amber-100',
    Icon: AlertTriangle,
  },
  ARRIVED_SCHOOL: {
    label: 'Arrived at School',
    color: 'text-emerald-700',
    bg: 'bg-emerald-100',
    Icon: CheckCircle2,
  },
  COMPLETED: {
    label: 'Trip Completed',
    color: 'text-emerald-700',
    bg: 'bg-emerald-100',
    Icon: CheckCircle2,
  },
  CANCELLED: {
    label: 'Cancelled',
    color: 'text-slate-500',
    bg: 'bg-slate-100',
    Icon: XCircle,
  },
  EMERGENCY: {
    label: 'Emergency — SOS',
    color: 'text-red-700',
    bg: 'bg-red-100',
    Icon: ShieldAlert,
  },
};

function fmtTime(iso: string | null | undefined, tz: string): string {
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

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function staticMapUrl(lat: number, lng: number, zoom = 14): string {
  // OpenStreetMap static map — no API key required
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
// Component
// ─────────────────────────────────────────────────────────────

export default function ParentTrackPage() {
  const params = useSearchParams();
  // Accept token from ?token= query param (WhatsApp link format)
  const token = params.get('token') ?? '';

  const [pageState, setPageState] = useState<PageState>({ phase: 'loading' });

  // Live data layered on top of the session once SSE connects
  const [liveLocation, setLiveLocation] = useState<GpsLocation | null>(null);
  const [liveStatus, setLiveStatus] = useState<TripStatus | null>(null);
  const [liveDelay, setLiveDelay] = useState<number>(0);
  const [liveEta, setLiveEta] = useState<EtaSummary | null>(null);
  const [sseConnected, setSseConnected] = useState<boolean>(false);
  const [lastHeard, setLastHeard] = useState<string | null>(null);

  // Reconnect state
  const sseRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);

  // ── 1. Fetch initial session ──────────────────────────────

  useEffect(() => {
    if (!token) {
      setPageState({ phase: 'no_token' });
      return;
    }

    const controller = new AbortController();

    fetch(`${API_BASE}/api/v1/parent/track/${encodeURIComponent(token)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          setPageState({ phase: 'expired' });
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { message?: string };
          throw new Error(body?.message ?? `Server error (${res.status})`);
        }
        const json = await res.json() as { data: TrackingSession };
        const session = json.data;

        if (!session.isValid) {
          setPageState({ phase: 'expired' });
          return;
        }

        setPageState({ phase: 'ready', session });

        // Seed live state from session snapshot
        if (session.activeTrip) {
          setLiveStatus(session.activeTrip.status);
          setLiveDelay(session.activeTrip.delayMinutes);
          if (session.activeTrip.lastGpsLocation) {
            setLiveLocation(session.activeTrip.lastGpsLocation);
            setLastHeard(session.activeTrip.lastGpsLocation.recordedAt);
          }
        }
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') {
          setPageState({
            phase: 'error',
            message: err.message,
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

    const handleEvent = (raw: MessageEvent) => {
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
        }

        if (evt.type === 'ETA_UPDATE' && evt.eta) {
          setLiveEta(evt.eta);
        }
      } catch {
        // malformed message — ignore
      }
    };

    es.addEventListener('initial_state', handleEvent);
    es.addEventListener('location_update', handleEvent);
    es.addEventListener('eta_update', handleEvent);
    es.addEventListener('message', handleEvent);

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
  }, [token]);

  useEffect(() => {
    if (pageState.phase !== 'ready') return;
    if (!pageState.session.activeTrip) return;

    connectSse();

    return () => {
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [pageState.phase, connectSse]);

  // Tick to keep "X ago" fresh
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(id);
  }, []);
  void tick; // consumed for re-render

  // ── 3. Derived display values ─────────────────────────────

  const session = pageState.phase === 'ready' ? pageState.session : null;
  const effectiveStatus: TripStatus = liveStatus ?? session?.activeTrip?.status ?? 'SCHEDULED';
  const effectiveDelay = liveDelay ?? session?.activeTrip?.delayMinutes ?? 0;
  const tz = session?.school.timezone ?? 'Asia/Kolkata';
  const statusMeta = STATUS_META[effectiveStatus];

  // Find ETA for this parent's pickup stop
  const pickupEta: EtaStop | null = liveEta && session?.pickupStop
    ? liveEta.stops.find((s) => s.stopName === session.pickupStop?.stopName) ?? null
    : null;

  // ── 4. Render states ──────────────────────────────────────

  if (pageState.phase === 'loading') {
    return (
      <Shell>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 py-24">
          <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Verifying your tracking link…</p>
        </div>
      </Shell>
    );
  }

  if (pageState.phase === 'no_token') {
    return (
      <Shell>
        <ErrorCard
          icon={<XCircle className="w-8 h-8 text-red-400" />}
          title="No tracking link found"
          body="Please use the secure link sent to your WhatsApp to track your child's bus."
          retryable={false}
        />
      </Shell>
    );
  }

  if (pageState.phase === 'expired') {
    return (
      <Shell>
        <ErrorCard
          icon={<Clock className="w-8 h-8 text-amber-400" />}
          title="Tracking link expired"
          body="This tracking link is no longer valid. Contact your school transport office for a new link."
          retryable={false}
        />
      </Shell>
    );
  }

  if (pageState.phase === 'error') {
    return (
      <Shell>
        <ErrorCard
          icon={<AlertTriangle className="w-8 h-8 text-red-400" />}
          title="Unable to load tracking"
          body={pageState.message}
          retryable={pageState.retryable}
          onRetry={() => {
            setPageState({ phase: 'loading' });
            // retrigger useEffect by forcing token re-read
            window.location.reload();
          }}
        />
      </Shell>
    );
  }

  // ── phase === 'ready' ──────────────────────────────────────

  const { student, school, pickupStop, activeTrip } = session!;
  const loc = liveLocation ?? activeTrip?.lastGpsLocation ?? null;

  return (
    <Shell sseConnected={sseConnected} hasActiveTrip={!!activeTrip}>
      <div className="flex-1 px-4 py-5 max-w-lg mx-auto w-full space-y-3">

        {/* ── Student & School Card ─────────────────── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">
            Tracking
          </p>
          <p className="text-xl font-bold text-slate-900 leading-tight">
            {student.fullName}
          </p>
          {student.gradeSection && (
            <p className="text-xs text-slate-500 mt-0.5">{student.gradeSection}</p>
          )}
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {school.name}
          </p>
        </div>

        {/* ── No active trip ───────────────────────── */}
        {!activeTrip && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6 text-center space-y-2">
            <Bus className="w-10 h-10 text-slate-300 mx-auto" />
            <p className="text-sm font-semibold text-slate-700">No trip in progress</p>
            <p className="text-xs text-slate-400 leading-relaxed">
              Live tracking activates automatically once a trip for your child begins.
              You will receive a WhatsApp message when the bus departs.
            </p>
            {pickupStop && (
              <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
                Your pickup stop:{' '}
                <span className="font-medium text-slate-700">{pickupStop.stopName}</span>
                {pickupStop.scheduledTime && (
                  <span className="ml-1 text-slate-400">
                    · {fmtTime(pickupStop.scheduledTime, tz)}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Active trip panels ───────────────────── */}
        {activeTrip && (
          <>
            {/* Status banner */}
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

            {/* ETA card */}
            {pickupStop && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Your pickup stop
                </p>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-800 text-sm">
                      {pickupStop.stopName}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Scheduled: {fmtTime(pickupStop.scheduledTime, tz)}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {pickupEta && pickupEta.etaMinutes != null ? (
                      <>
                        <p className="text-2xl font-black text-sky-600 tabular-nums leading-none">
                          {pickupEta.etaMinutes}
                          <span className="text-sm font-semibold text-sky-500 ml-0.5">min</span>
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {pickupEta.etaTimestamp
                            ? fmtTime(pickupEta.etaTimestamp, tz)
                            : 'ETA'}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-slate-400 font-medium pt-1">Calculating…</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Map */}
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

                {/* Static map tile */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={staticMapUrl(loc.latitude, loc.longitude)}
                  alt={`Bus location map near ${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`}
                  className="w-full h-40 object-cover"
                  loading="lazy"
                />

                {/* Speed / bearing pill */}
                <div className="px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="text-base">
                      {bearing2Arrow(loc.bearingDegrees)}
                    </span>
                    <span className="font-medium">
                      {Math.round(loc.speedKmh)} km/h
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono">
                    {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
                  </p>
                </div>
              </div>
            )}

            {/* Driver info */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Driver
              </p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                    <User className="w-4 h-4 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      {activeTrip.driverName}
                    </p>
                    <p className="text-xs text-slate-400">
                      {activeTrip.registrationNumber}
                    </p>
                  </div>
                </div>
                {activeTrip.driverPhone && (
                  <a
                    href={`tel:${activeTrip.driverPhone}`}
                    className="flex items-center gap-1.5 text-xs font-semibold text-sky-600 hover:text-sky-700 bg-sky-50 hover:bg-sky-100 px-3 py-1.5 rounded-lg transition-colors"
                    aria-label={`Call driver ${activeTrip.driverName}`}
                  >
                    <Phone className="w-3.5 h-3.5" />
                    Call
                  </a>
                )}
              </div>
            </div>

            {/* Emergency banner */}
            {effectiveStatus === 'EMERGENCY' && (
              <div className="bg-red-600 rounded-xl p-4 flex items-start gap-3 shadow-sm">
                <ShieldAlert className="w-5 h-5 text-white flex-shrink-0 mt-0.5 animate-pulse" />
                <div>
                  <p className="text-sm font-bold text-white">Emergency Alert Active</p>
                  <p className="text-xs text-red-100 mt-0.5 leading-relaxed">
                    The driver has triggered an emergency. School transport staff have been
                    notified. If you cannot reach the school, call emergency services.
                  </p>
                </div>
              </div>
            )}

            {/* Completed / cancelled message */}
            {(effectiveStatus === 'COMPLETED' ||
              effectiveStatus === 'ARRIVED_SCHOOL' ||
              effectiveStatus === 'CANCELLED') && (
              <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700">
                  {effectiveStatus === 'CANCELLED'
                    ? 'Trip was cancelled'
                    : 'Trip completed'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {effectiveStatus === 'CANCELLED'
                    ? 'Please contact your school for alternative transport arrangements.'
                    : 'Your child has reached school. Have a great day!'}
                </p>
              </div>
            )}
          </>
        )}

        {/* Safety note */}
        <p className="text-[10px] text-slate-400 text-center px-4 pb-2">
          This is a secure, read-only view linked to your child's trip.
          Location updates every 5 seconds when the bus is moving.
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
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shadow-[0_1px_0_rgba(0,0,0,0.04)]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-sky-600 flex items-center justify-center">
            <Bus className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800 leading-none">BUSLOARD</p>
            <p className="text-[10px] text-slate-400 leading-none mt-0.5">
              Safe School Transport
            </p>
          </div>
        </div>

        {/* SSE connection indicator — only shown when a trip is active */}
        {hasActiveTrip && (
          <div className="flex items-center gap-1.5">
            {sseConnected ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] text-emerald-600 font-medium hidden xs:inline">
                  Live
                </span>
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

function ErrorCard({
  icon,
  title,
  body,
  retryable,
  onRetry,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  retryable: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="max-w-xs w-full bg-white border border-slate-200 rounded-xl p-6 text-center shadow-xs space-y-3">
        <div className="flex justify-center">{icon}</div>
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-xs text-slate-500 leading-relaxed">{body}</p>
        {retryable && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-sky-600 hover:text-sky-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Try again
          </button>
        )}
        <p className="text-[10px] text-slate-400 pt-1">
          Need help? Contact your school transport office.
        </p>
      </div>
    </div>
  );
}
