/**
 * Parent Live Tracking Page (parent-web)
 *
 * Entry point for the parent-facing web tracking experience.
 * Parents access this page via their unique tokenized link sent via WhatsApp.
 * The token is validated server-side before live bus location is revealed.
 *
 * This is a Next.js 14 App Router page.
 * Route: /track?token=<parent_token>
 */

'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface TrackingSession {
  studentName: string;
  busNumber: string;
  routeName: string;
  status: 'SCHEDULED' | 'IN_TRANSIT' | 'DELAYED' | 'COMPLETED' | 'CANCELLED' | 'EMERGENCY';
  eta: string | null;
  lastUpdated: string | null;
  driverName: string | null;
  currentStop: string | null;
}

type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'success'; session: TrackingSession };

export default function ParentTrackPage() {
  const params = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<PageState>({ kind: 'loading' });

  useEffect(() => {
    if (!token) {
      setState({ kind: 'error', message: 'No tracking token found. Please use the link sent via WhatsApp.' });
      return;
    }

    const controller = new AbortController();
    const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? '';

    fetch(`${baseUrl}/api/v1/parent/track?token=${encodeURIComponent(token)}`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.message ?? `Server error (${res.status})`);
        }
        return res.json() as Promise<{ data: TrackingSession }>;
      })
      .then((json) => setState({ kind: 'success', session: json.data }))
      .catch((err: Error) => {
        if (err.name !== 'AbortError') {
          setState({ kind: 'error', message: err.message });
        }
      });

    return () => controller.abort();
  }, [token]);

  if (state.kind === 'loading') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-500">Loading tracking session…</p>
        </div>
      </main>
    );
  }

  if (state.kind === 'error') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-sm w-full bg-white border border-red-200 rounded-lg p-6 text-center shadow-sm">
          <p className="text-sm font-medium text-red-600">Unable to load tracking session</p>
          <p className="mt-1 text-sm text-slate-500">{state.message}</p>
          <p className="mt-4 text-xs text-slate-400">
            If this link expired, contact your school transport office for a new link.
          </p>
        </div>
      </main>
    );
  }

  const { session } = state;
  const statusColor: Record<string, string> = {
    SCHEDULED: 'bg-slate-100 text-slate-600',
    IN_TRANSIT: 'bg-sky-100 text-sky-700',
    DELAYED: 'bg-amber-100 text-amber-700',
    COMPLETED: 'bg-green-100 text-green-700',
    CANCELLED: 'bg-slate-100 text-slate-500',
    EMERGENCY: 'bg-red-100 text-red-700',
  };

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
        <div className="w-7 h-7 rounded-full bg-sky-600 flex items-center justify-center">
          <span className="text-white text-xs font-bold">B</span>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-800">BUSLOARD</p>
          <p className="text-xs text-slate-400">Safe School Transport</p>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-4">
        {/* Student card */}
        <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Tracking</p>
          <p className="text-lg font-semibold text-slate-800">{session.studentName}</p>
          <p className="text-sm text-slate-500 mt-0.5">{session.routeName} · Bus {session.busNumber}</p>
        </div>

        {/* Status card */}
        <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">Trip Status</p>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor[session.status] ?? 'bg-slate-100 text-slate-600'}`}>
              {session.status.replace('_', ' ')}
            </span>
          </div>
          {session.eta && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Estimated Arrival</span>
              <span className="font-medium text-slate-800">{session.eta}</span>
            </div>
          )}
          {session.currentStop && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Current Stop</span>
              <span className="font-medium text-slate-800">{session.currentStop}</span>
            </div>
          )}
          {session.driverName && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">Driver</span>
              <span className="font-medium text-slate-800">{session.driverName}</span>
            </div>
          )}
          {session.lastUpdated && (
            <p className="text-xs text-slate-400">Last updated: {session.lastUpdated}</p>
          )}
        </div>

        {/* Safety note */}
        <p className="text-xs text-slate-400 text-center px-4">
          This is a secure, read-only tracking view. Location is live when bus is IN TRANSIT.
        </p>
      </div>
    </main>
  );
}
