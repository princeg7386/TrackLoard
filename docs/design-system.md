# BUSLOARD Design System

> This document defines the visual language, tokens, and component patterns for the BUSLOARD school bus tracking platform. All UI work MUST use these tokens — never hardcode colours, spacing, or type scales directly in components.

---

## 1. Design Philosophy

- **Calm & Trustworthy** — Neutral surfaces, single confident accent; no playful gradients or decorative animations.
- **High Information Density** — 8px grid, compact tables, meaningful whitespace only.
- **Functional Maps** — Maps are operational canvases, not decorative backgrounds.
- **7-State Completeness** — Every data surface must handle: Loading, Empty, Success, Validation Error, Failure/Retry, Unauthorized, and Offline/Reconnecting.
- **Safety Colour Semantics** — Colour communicates transport status, not decoration.

---

## 2. Colour Tokens

All tokens are defined in `school-dashboard/src/app/globals.css` via CSS custom properties.

### Status / Semantic Colours

| Token | Usage | Value (light) |
|---|---|---|
| `--color-status-ok` | On-time, active, connected | `#16a34a` (green-600) |
| `--color-status-warn` | Delay, warning, degraded | `#d97706` (amber-600) |
| `--color-status-danger` | SOS, incident, critical | `#dc2626` (red-600) |
| `--color-status-inactive` | Offline, inactive, ended | `#64748b` (slate-500) |

### Surface & Brand Colours

| Token | Usage |
|---|---|
| `--color-surface-base` | Page background |
| `--color-surface-card` | Card / panel background |
| `--color-surface-raised` | Elevated sheet / modal |
| `--color-accent` | Primary brand accent (buttons, links, active indicators) |
| `--color-text-primary` | Primary body text |
| `--color-text-secondary` | Labels, captions, metadata |
| `--color-border` | Dividers, input borders |

---

## 3. Spacing Scale (8px Grid)

| Token | Value | Usage |
|---|---|---|
| `--space-1` | 4px | Tight inline gaps |
| `--space-2` | 8px | Base unit, icon gaps |
| `--space-3` | 12px | Input padding |
| `--space-4` | 16px | Card padding (mobile) |
| `--space-6` | 24px | Section gaps |
| `--space-8` | 32px | Card padding (desktop) |
| `--space-12` | 48px | Section headers |
| `--space-16` | 64px | Page-level spacing |

---

## 4. Typography Scale

| Role | Size | Weight | Line-height |
|---|---|---|---|
| Page title | 20px | 600 | 1.3 |
| Section heading | 16px | 600 | 1.4 |
| Body / table cell | 14px | 400 | 1.5 |
| Caption / metadata | 12px | 400 | 1.4 |
| Badge / chip label | 11px | 500 | 1 |

Font family: System stack — `ui-sans-serif, system-ui, -apple-system, sans-serif`

---

## 5. Radius & Shadow

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | 4px | Badges, chips, tags |
| `--radius-md` | 8px | Buttons, inputs, cards |
| `--radius-lg` | 12px | Modals, sheets |
| `--shadow-card` | `0 1px 3px rgba(0,0,0,0.08)` | Card elevation |
| `--shadow-modal` | `0 8px 24px rgba(0,0,0,0.14)` | Modal elevation |

---

## 6. Status Badge Component

Used consistently across buses, trips, drivers, and students. Never use raw colour classes.

```tsx
// school-dashboard/src/components/ui/StatusBadge.tsx
// Props: status: 'ok' | 'warn' | 'danger' | 'inactive' | 'info'
<StatusBadge status="ok">On Time</StatusBadge>
<StatusBadge status="warn">Delayed</StatusBadge>
<StatusBadge status="danger">SOS</StatusBadge>
<StatusBadge status="inactive">Offline</StatusBadge>
```

---

## 7. 7-State UI Pattern

Every page/component that fetches data must implement all 7 states:

| State | Trigger | UI |
|---|---|---|
| `loading` | Initial fetch pending | Skeleton rows / spinner |
| `empty` | Fetch succeeded, zero results | Contextual empty message + CTA |
| `success` | Data fetched | Normal data display |
| `validationError` | Form submit with invalid data | Inline field errors (Zod messages) |
| `failure` | API returned error | Error banner + Retry button |
| `unauthorized` | 401/403 response | Redirect to login or permission message |
| `offline` | Network unreachable | Offline banner, last known data |

---

## 8. Map Guidelines

- Use **Leaflet.js** with **OpenStreetMap tiles** (FOSS-first; no Google Maps billing).
- Bus marker: Custom SVG with status colour ring (green/amber/red) — no stock emoji pins.
- Route polyline: `2px` solid accent colour with 60% opacity.
- Geofence radius: Dashed circle, `status-warn` colour.
- Maps are embedded in operational cards — not full-page decorative backgrounds.
- Always show a loading state while tiles are fetching.

---

## 9. Motion Principles

Motion is **functional only** — reserved for:
- Status badge colour transitions (e.g. `on-time → delayed`)
- Bus marker position updates on map
- Modal open/close (`opacity` + `translateY`, ≤ 200ms)
- Toast/notification entrance (`translateX`, ≤ 150ms)

**Do not use:** Looping animations, particle effects, hero section parallax, or decorative page transitions.

---

## 10. Component Library Location

| Component | Path |
|---|---|
| `StatusBadge` | `school-dashboard/src/components/ui/` |
| `LoadingSkeleton` | `school-dashboard/src/components/ui/` |
| `EmptyState` | `school-dashboard/src/components/ui/` |
| `ErrorBanner` | `school-dashboard/src/components/ui/` |
| `Modal` | `school-dashboard/src/components/ui/` |
| Bus-specific components | `school-dashboard/src/components/bus/` |
| Driver components | `school-dashboard/src/components/driver/` |
| Student components | `school-dashboard/src/components/student/` |

---

> **Scope note:** The Parent Web (`parent-web/`) shares these design tokens but is a separate Next.js app optimised for mobile-first, low-bandwidth rendering. It does not include the admin sidebar or data-dense table layouts.
