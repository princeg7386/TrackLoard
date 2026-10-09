# School & College Bus Tracking and Safety Platform (India)

A production-grade, multi-tenant school bus tracking, attendance, and student transport safety system tailored specifically for Indian schools, colleges, drivers, and parents.

---

## 🌟 Key Architecture Pillars

- **WhatsApp-First Experience:** Zero app store installation barrier for parents. Automated WhatsApp milestone updates (trip start, proximity alert, boarding/deboarding confirmation, emergency alerts) and simple driver bot commands.
- **Secure Parent Web View:** Responsive, real-time live map tracking via signed token links (`/track/:tripToken`) with dynamic ETA and driver contact.
- **Minimal Driver Telemetry App:** Rock-solid Flutter Android background location service with local SQLite buffering for cellular dead zones.
- **High-Density Admin Dashboard:** Next.js / React operational console for fleet monitoring, stop geofences, delay detection, and SOS incident response.
- **Free & Open-Source First (FOSS):** PostgreSQL + PostGIS spatial indexing, OpenStreetMap tiles, and OSRM routing engine with enterprise adapter fallbacks.

---

## 📂 Repository Layout

```
BUSLOARD/
├── AGENTS.md                 # Master Agent Rules & Quality Boundaries
├── docs/                     # Documentation & Architecture Specifications
│   ├── adr/                  # Architecture Decision Records (0001, 0002, 0003)
│   ├── architecture.md       # Technical Architecture & Adapter Interfaces
│   ├── developer-workstation-setup.md # Environment setup guide
│   ├── feature-registry.md   # Master Scope Register & Status Tracking
│   ├── product-spec.md       # Product Specification & Role Matrix
│   └── test-plan.md          # Acceptance & Regression Test Matrix
├── .env.example              # Environment Variable Template
├── .gitignore                # Git Ignore Rules
└── .github/                  # GitHub Issue & Pull Request Templates
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js:** v20+ or v22 LTS
- **npm:** v10+
- **Git**
- *(Optional for DB & Mobile):* Docker Desktop (PostgreSQL + PostGIS), Flutter SDK, Android Studio

### 2. Setup
```bash
# Clone the repository
git clone <repo-url>
cd BUSLOARD

# Copy environment variables
cp .env.example .env
```

---

## 🛡️ Scope Guardrails & Anti-Patterns
To ensure maximum stability and zero feature bloat:
- ❌ No bus capacity constraints or seat allotment counting.
- ❌ No bus active/inactive status toggles.
- ❌ No parent child-selection switchers (direct tokenized 1:1 sessions).
- ❌ No payments / billing / subscriptions until the final commercial phase.
- ❌ No RFID / CCTV / Face recognition hardware dependencies.

---

## 📖 Documentation
- [Master Agent Rules](file:///c:/Users/princ/OneDrive/Desktop/BUSLOARD/AGENTS.md)
- [Feature Registry](file:///c:/Users/princ/OneDrive/Desktop/BUSLOARD/docs/feature-registry.md)
- [Product Specification](file:///c:/Users/princ/OneDrive/Desktop/BUSLOARD/docs/product-spec.md)
- [Architecture & Adapters](file:///c:/Users/princ/OneDrive/Desktop/BUSLOARD/docs/architecture.md)
- [Test Plan](file:///c:/Users/princ/OneDrive/Desktop/BUSLOARD/docs/test-plan.md)
