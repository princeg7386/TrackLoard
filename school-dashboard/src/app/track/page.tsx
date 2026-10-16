'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Bus,
  MapPin,
  Clock,
  ShieldCheck,
  AlertCircle,
  Phone,
  MessageSquare,
  GraduationCap,
  KeyRound,
  CheckCircle2,
  RefreshCw,
  WifiOff,
  ChevronRight,
  ExternalLink,
  School,
  AlertTriangle,
  Signal,
} from 'lucide-react';
import {
  ParentLiveTrackingSession,
  ParentOnboardVerificationResponse,
} from '@school-bus/shared';
import {
  verifyOnboardToken,
  confirmOnboardActivation,
} from '../../services/studentApi';
import {
  openParentBusFeed,
  type FeedConnectionStatus,
  type ResilientFeedSubscription,
} from '../../services/telemetryApi';
import {
  ParentLiveMapCanvas,
  type BusLocationSnapshot,
} from '../../components/live/ParentLiveMapCanvas';

function ParentTrackContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [isLoading, setIsLoading] = useState(true);
  const [verification, setVerification] = useState<ParentOnboardVerificationResponse | null>(null);
  const [session, setSession] = useState<ParentLiveTrackingSession | null>(null);

  // Identity confirmation step
  const [phoneLast4Input, setPhoneLast4Input] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [isActivated, setIsActivated] = useState(false);

  const [isOffline, setIsOffline] = useState(false);

  // Phase 12.4 — Live bus feed state
  const [busLocation, setBusLocation] = useState<BusLocationSnapshot | null>(null);
  const [feedStatus, setFeedStatus] = useState<FeedConnectionStatus>('CONNECTING');
  const feedSubRef = useRef<ResilientFeedSubscription | null>(null);

  // Monitor connectivity
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

  const checkToken = async () => {
    if (!token) {
      setIsLoading(false);
      setVerification({
        status: 'INVALID',
        errorCode: 'TOKEN_INVALID',
        errorMessage: 'No tracking token provided in link. Please use the link sent via WhatsApp.',
      });
      return;
    }

    setIsLoading(true);
    setConfirmError(null);

    try {
      const res = await verifyOnboardToken(token);
      setVerification(res);
      if (res.status === 'VALID' && res.session) {
        setSession(res.session);
      }
    } catch {
      setVerification({
        status: 'INVALID',
        errorCode: 'TOKEN_INVALID',
        errorMessage: 'Network error communicating with the school tracking server.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkToken();
  }, [token]);

  // Phase 12.4 — Open live SSE feed when activated AND a trip is running
  useEffect(() => {
    if (!isActivated || !token || !session?.activeTrip) {
      // Close existing feed if trip ended or user deactivated
      if (feedSubRef.current) {
        feedSubRef.current.close();
        feedSubRef.current = null;
      }
      return;
    }

    // Open (or re-open) parent bus feed
    const sub = openParentBusFeed(
      token,
      (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          if (event.type === 'initial_state' && payload.lastGpsLocation) {
            setBusLocation(payload.lastGpsLocation as BusLocationSnapshot);
          } else if (event.type === 'location_update') {
            // location_update payload may be wrapped or flat depending on the service
            const loc = payload.latitude !== undefined ? payload : payload.location;
            if (loc?.latitude !== undefined) {
              setBusLocation({
                latitude: loc.latitude,
                longitude: loc.longitude,
                speedKmh: loc.speedKmh ?? 0,
                bearingDegrees: loc.bearingDegrees,
                recordedAt: loc.recordedAt ?? new Date().toISOString(),
              });
            }
          }
        } catch {
          // Malformed SSE data — ignore
        }
      },
      (status) => setFeedStatus(status)
    );

    feedSubRef.current = sub;

    // Poll for trip start if no active trip was initially present (auto-refresh)
    const refreshInterval = setInterval(() => {
      if (!session?.activeTrip) {
        checkToken();
      }
    }, 60_000);

    return () => {
      sub.close();
      feedSubRef.current = null;
      clearInterval(refreshInterval);
    };
  }, [isActivated, token, session?.activeTrip?.id]);

  const handleConfirmActivation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setIsConfirming(true);
    setConfirmError(null);

    try {
      const res = await confirmOnboardActivation({
        token,
        phoneLast4: phoneLast4Input.trim() || undefined,
      });

      if (res.confirmed) {
        setSession(res.session);
        setIsActivated(true);
      }
    } catch (err: any) {
      setConfirmError(err.message || 'Verification failed. Please check the last 4 digits.');
    } finally {
      setIsConfirming(false);
    }
  };

  // 1. Loading State
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-sm w-full text-center shadow-xs space-y-4 animate-fadeIn">
          <div className="w-14 h-14 bg-sky-50 text-sky-600 rounded-full flex items-center justify-center mx-auto border border-sky-100 animate-pulse">
            <Bus className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-900">Verifying Live Link</h1>
            <p className="text-xs text-slate-500 mt-1">Connecting to school transport safety portal...</p>
          </div>
          <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-sky-600 rounded-full w-2/3 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  // 2. Token Expired / Revoked / Invalid Error State
  if (verification?.status !== 'VALID' || !session) {
    const isExpired = verification?.errorCode === 'TOKEN_EXPIRED';
    const isRevoked = verification?.errorCode === 'TOKEN_REVOKED';

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 max-w-md w-full shadow-xs space-y-5 animate-fadeIn">
          {/* Error Banner */}
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto border ${
              isExpired
                ? 'bg-amber-50 text-amber-600 border-amber-200'
                : isRevoked
                  ? 'bg-rose-50 text-rose-600 border-rose-200'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
            }`}
          >
            {isExpired ? (
              <Clock className="w-6 h-6" />
            ) : isRevoked ? (
              <ShieldCheck className="w-6 h-6" />
            ) : (
              <AlertTriangle className="w-6 h-6" />
            )}
          </div>

          <div className="text-center space-y-1">
            <h1 className="text-base font-bold text-slate-900">
              {isExpired
                ? 'Tracking Link Has Expired'
                : isRevoked
                  ? 'Tracking Link Revoked'
                  : 'Invalid Access Link'}
            </h1>
            <p className="text-xs text-slate-500 leading-relaxed">
              {verification?.errorMessage ||
                'This tracking link is no longer valid. For student safety, links are time-bound.'}
            </p>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-600 space-y-1.5">
            <div className="font-semibold text-slate-800 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-slate-500" />
              <span>Safety & Security Notice</span>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500">
              {isExpired
                ? 'Time-limited tokens ensure that only authorized parents can monitor school buses in real time.'
                : 'School administration issues fresh links when student routes or security credentials are updated.'}
            </p>
          </div>

          <div className="space-y-2 pt-1">
            <a
              href="https://wa.me/?text=Hello%20School%20Transport,%20my%20bus%20tracking%20link%20has%20expired.%20Please%20send%20a%20new%20link."
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-lg shadow-xs transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
              <span>Request New Link via WhatsApp</span>
            </a>

            <button
              type="button"
              onClick={checkToken}
              className="w-full py-1.5 text-xs text-slate-600 hover:text-slate-800 font-medium transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. Activation / Identity Confirmation Screen (if not yet confirmed)
  if (!isActivated) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 max-w-md w-full shadow-xs space-y-5 animate-fadeIn">
          {/* Offline alert */}
          {isOffline && (
            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-md flex items-center gap-2 text-amber-900 text-xs">
              <WifiOff className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>You are currently offline. Connect to activate.</span>
            </div>
          )}

          {/* School & Student Identification */}
          <div className="text-center space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200">
              <School className="w-3 h-3" />
              <span>{session.school.name}</span>
            </div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight">
              Confirm Parent Identity
            </h1>
            <p className="text-xs text-slate-500">
              Welcome {session.parent.fullName}. Please confirm your registered mobile to activate live tracking for {session.student.fullName}.
            </p>
          </div>

          {/* Student & Transport Summary Card */}
          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Student</span>
              <span className="font-semibold text-slate-900">{session.student.fullName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Admission No</span>
              <span className="font-mono text-slate-700">{session.student.admissionNumber}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Grade & Section</span>
              <span className="text-slate-700">Class {session.student.classGrade} - {session.student.section}</span>
            </div>
            {session.pickupStop && (
              <div className="flex items-center justify-between pt-1.5 border-t border-slate-200">
                <span className="text-slate-500 font-medium">Pickup Stop</span>
                <span className="font-semibold text-slate-900 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-sky-600" />
                  {session.pickupStop.stopName}
                </span>
              </div>
            )}
          </div>

          {/* Confirmation Form */}
          <form onSubmit={handleConfirmActivation} className="space-y-4">
            {confirmError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-md flex items-center gap-2 text-rose-900 text-xs">
                <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span>{confirmError}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 flex items-center justify-between">
                <span>Confirm Registered Phone</span>
                <span className="text-[11px] font-mono text-slate-400">
                  ••••••{verification.phoneLast4 || '••••'}
                </span>
              </label>
              <input
                type="text"
                maxLength={4}
                placeholder="Enter last 4 digits (optional)"
                value={phoneLast4Input}
                onChange={(e) => setPhoneLast4Input(e.target.value)}
                className="w-full px-3 py-2 text-center text-sm font-mono tracking-widest bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-1 focus:ring-sky-500"
              />
              <span className="text-[10px] text-slate-400 block text-center">
                Enter the last 4 digits of your WhatsApp mobile number to verify.
              </span>
            </div>

            <button
              type="submit"
              disabled={isConfirming}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-semibold text-xs rounded-lg shadow-xs transition-colors"
            >
              {isConfirming ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Activating...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Activate Live Tracking</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 4. Activated Live Tracking Dashboard (Parent Mobile View)
  const expiresFormatted = new Date(session.expiresAt).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  });

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-30 shadow-2xs">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-sky-600 text-white flex items-center justify-center font-bold text-xs">
              <Bus className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-900 leading-tight">
                {session.school.name}
              </div>
              <div className="text-[10px] text-slate-500 font-mono">
                Student: {session.student.fullName} ({session.student.admissionNumber})
              </div>
            </div>
          </div>

          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
            Live Active
          </span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-2xl mx-auto w-full p-4 space-y-4 flex-1">
        {/* Offline Alert */}
        {isOffline && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-amber-900 text-xs">
            <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Connection interrupted. Reconnecting to live bus telemetry...</span>
          </div>
        )}
        {/* Feed Reconnecting Banner */}
        {!isOffline && feedStatus === 'RECONNECTING' && session?.activeTrip && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-amber-900 text-xs">
            <RefreshCw className="w-4 h-4 text-amber-600 shrink-0 animate-spin" />
            <span>Reconnecting to live bus feed…</span>
          </div>
        )}

        {/* Phase 12.4 — Live Map Canvas (shown only when trip is active) */}
        {session?.activeTrip && (
          <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-slate-500">
                Live Location
              </span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                  feedStatus === 'CONNECTED'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : feedStatus === 'RECONNECTING'
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : feedStatus === 'OFFLINE'
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                {feedStatus === 'CONNECTED' && (
                  <Signal className="w-2.5 h-2.5" />
                )}
                {feedStatus === 'RECONNECTING' && (
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                )}
                {feedStatus === 'OFFLINE' && (
                  <WifiOff className="w-2.5 h-2.5" />
                )}
                {feedStatus === 'CONNECTING' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" />
                )}
                {feedStatus.charAt(0) + feedStatus.slice(1).toLowerCase()}
              </span>
            </div>
            <ParentLiveMapCanvas
              busLocation={busLocation}
              pickupStop={
                session.pickupStop
                  ? {
                      latitude: session.pickupStop.latitude,
                      longitude: session.pickupStop.longitude,
                      stopName: session.pickupStop.stopName,
                    }
                  : null
              }
              feedStatus={feedStatus}
              isLoading={feedStatus === 'CONNECTING' && !busLocation}
              tripStatus={session.activeTrip.status}
            />
            {busLocation && (
              <div className="text-[10px] font-mono text-slate-400 text-right">
                Last fix: {new Date(busLocation.recordedAt).toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
                {busLocation.speedKmh > 0 && ` · ${Math.round(busLocation.speedKmh)} km/h`}
              </div>
            )}
          </div>
        )}

        {/* Live Commute Status Card */}

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Commute Status
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              Valid until: {expiresFormatted}
            </span>
          </div>

          {session.activeTrip ? (
            <div className="p-3 bg-sky-50 border border-sky-100 rounded-lg space-y-2 text-xs">
              <div className="flex items-center justify-between font-semibold text-sky-900">
                <span className="flex items-center gap-1.5">
                  <Bus className="w-4 h-4 text-sky-600" />
                  Bus {session.activeTrip.busNumber} • {session.activeTrip.routeName}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-sky-200 text-sky-800">
                  {session.activeTrip.status}
                </span>
              </div>
              <div className="text-[11px] text-sky-700 flex items-center justify-between">
                <span>Driver: {session.activeTrip.driverName}</span>
                {session.activeTrip.driverPhone && (
                  <a
                    href={`tel:${session.activeTrip.driverPhone}`}
                    className="font-mono underline text-sky-800 flex items-center gap-1"
                  >
                    <Phone className="w-3 h-3" />
                    Call Driver
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-800">No Trip Currently In Progress</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Live bus tracking activates automatically when morning/evening trips commence.
                </div>
              </div>
              <Clock className="w-5 h-5 text-slate-400 shrink-0" />
            </div>
          )}
        </div>

        {/* Assigned Pickup Stop Card */}
        {session.pickupStop && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-slate-500">
                Designated Pickup Location
              </span>
              <span className="font-mono text-slate-600 flex items-center gap-1 font-semibold">
                <Clock className="w-3 h-3 text-slate-400" />
                Scheduled: {session.pickupStop.scheduledTime}
              </span>
            </div>

            <div className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
              <MapPin className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5 flex-1">
                <div className="font-semibold text-slate-900">
                  {session.pickupStop.stopName}
                </div>
                <div className="text-[11px] text-slate-500 font-mono">
                  Stop #{session.pickupStop.sequenceOrder} • Geofence Radius: {session.pickupStop.geofenceRadiusMeters}m
                </div>
                <div className="text-[10px] text-slate-400 font-mono">
                  Coordinates: {session.pickupStop.latitude.toFixed(4)}, {session.pickupStop.longitude.toFixed(4)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Parent WhatsApp Quick Actions */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs space-y-3 text-xs">
          <div className="font-bold uppercase tracking-wider text-slate-500">
            Transport Safety & Support
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <a
              href={`https://wa.me/?text=Absent%20Notification%20for%20${encodeURIComponent(session.student.fullName)}%20(${encodeURIComponent(session.student.admissionNumber)})`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 p-2.5 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 text-slate-700 transition-colors"
            >
              <MessageSquare className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Report Absence via WhatsApp</span>
            </a>

            <a
              href={`https://wa.me/?text=Query%20regarding%20transport%20for%20${encodeURIComponent(session.student.fullName)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 p-2.5 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 text-slate-700 transition-colors"
            >
              <Phone className="w-4 h-4 text-sky-600 shrink-0" />
              <span>Transport Coordinator</span>
            </a>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center py-4 text-[10px] text-slate-400 font-mono">
        Protected by School Transport Security • Token: {token ? `${token.slice(0, 8)}...` : 'Active'} • Expires: {new Date(session.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </footer>
    </div>
  );
}

export default function ParentTrackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="text-xs text-slate-400 animate-pulse font-mono">
            Loading transport portal...
          </div>
        </div>
      }
    >
      <ParentTrackContent />
    </Suspense>
  );
}

