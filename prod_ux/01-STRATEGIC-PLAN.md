# Production-Grade UI Design Plan: Naavik → Aira Platform

## Context

The current app was purpose-built for demonstration purposes. It works beautifully as a proof-of-concept. However, it is not usable as a daily tool for real operators, engineers, and managers. Chat does everything, navigation is state-switching (not real routing), components are one-offs, and there is no design system.

The goal: **Design and build a production SaaS platform for 5 user roles** (NOC Operators, RF/RAN Engineers, App Developers, Network Managers, Directors/VPs) where **AI (Aira) is a persistent contextual assistant** embedded in the product - not the product itself.

---

## Phase 1: Information Architecture (Do This First in Figma)

### Top-Level Navigation (Left Sidebar - Persistent)

```
┌─────────────────┐
│  Naavik Logo    │
│  [Org Switcher] │  ← Multi-tenant
├─────────────────┤
│  Overview       │  ← Executive/NOC: health scorecard, alerts feed
│  Observe        │  ← Network map + site drill-down (existing, productionize)
│  Analyze        │  ← RCA workspace, anomaly explorer (split from chat)
│  Automate       │  ← AppGen + App Library + Workflow editor
│  Provision      │  ← ZTP pipeline tracker (existing, productionize)
├─────────────────┤
│  Admin          │  ← Users, roles, OEM config, API keys
│  Settings       │
├─────────────────┤
│  [Aira Chat]    │  ← Persistent bottom icon → expands Aira panel
│  [User Avatar]  │
└─────────────────┘
```

### Aira Chat Role (Critical Design Decision)

**Chat is NOT a page.** It is a **persistent right-side drawer** (like Linear's Slack integration or Intercom) that can:
- Answer contextual questions about whatever page you're on
- Navigate: "Take me to site UST2938" → deep-links Observe view
- Summarize: "Summarize what's wrong with the network today"
- Execute inline: "Run provisioning on site X" → triggers workflow and shows status in chat

**Two modes:**
1. **Mini (default):** 360px wide panel slides in from right, coexists with page
2. **Focused (expand):** Full-screen chat for complex multi-turn flows (AppGen conversations)

---

## Phase 2: Design System Strategy

### Recommendation: shadcn/ui + Tremor

The current app uses pure custom Tailwind. For production, adopt:

| Library | Purpose | Why |
|---------|---------|-----|
| **shadcn/ui** | Core components (Button, Input, Dialog, Dropdown, Table, Badge, Sheet, Tabs) | Copy-paste, fully customizable, Radix primitives, no library lock-in |
| **Tremor** | Data components (AreaChart, BarChart, DonutChart, Metric, KPI cards, Sparkline) | Purpose-built for analytics dashboards, Tailwind-native |
| **Existing Tailwind config** | Keep `cream-*`, `pulse-*`, `naavik-primary` tokens | Already defined and working |
| **Lucide React** | Keep - already in use | Consistent icon set |

### Design Token Architecture (Define in Figma First)

```
Colors:
  brand/primary    → #ED1C24 (Naavik red)
  brand/secondary  → #4a7ccc (Aira blue)

  bg/base          → cream-50 / pulse-950
  bg/surface       → cream-100 / pulse-900
  bg/elevated      → white / pulse-800

  status/critical  → red-600
  status/warning   → amber-500
  status/normal    → green-500
  status/info      → blue-500

Typography:
  display   → Inter 32/40 semibold
  heading   → Inter 20/28 semibold
  subhead   → Inter 16/24 medium
  body      → Inter 14/20 regular
  caption   → Inter 12/16 regular
  mono      → JetBrains Mono 13 (code)

Spacing: 4px base grid (4/8/12/16/24/32/48/64)
Radius: sm=6 md=8 lg=12 xl=16
```

---

## Phase 3: Figma Workflow (Exact Steps)

### Step 1: Setup (Day 1)
1. Create a new Figma file: `Naavik Design System`
2. Page 1: `Tokens` - Define all color, type, spacing variables
3. Page 2: `Components` - Build base component library
4. Page 3: `Screens` - Compose screens from components
5. Use Figma Variables (not just styles) so light/dark tokens auto-switch

### Step 2: Build Component Library (Day 1-2)
Priority order for components:

```
Tier 1 (must have before any screen):
  Button (primary/secondary/ghost/destructive, 3 sizes)
  Badge (status: critical/warning/normal/info + custom)
  Input, Select, Textarea
  Card (with header/body/footer slots)
  Table (sortable, with pagination)

Tier 2 (key to telecom UX):
  KPI Card (metric + delta + sparkline)
  Site Status Pill (site ID + severity color)
  Alert Row (severity icon + message + timestamp + action)
  Network Health Bar (composite score with breakdown)

Tier 3 (Aira / AI components):
  Chat Message (user + AI variants)
  Aira Panel (drawer shell)
  Typing Indicator
  Action Card (AI-suggested action with Accept/Dismiss)
  Reasoning Block (expandable chain-of-thought)
```

### Step 3: Key Screens (Day 2-4, in priority order)

**Screen 1: Overview Dashboard** (highest ROI - all roles use it)
```
Layout:
┌─── Header: "Network Overview" + date range picker ───────────┐
│  [Network Health Score: 87/100]  [Active Alerts: 12]         │
│  [Sites Critical: 4]  [Sites Warning: 23]  [Normal: 13,797]  │
├───────────────────────────────┬──────────────────────────────┤
│  KPI Trend Charts (6-up grid) │  Alerts Feed (live list)     │
│  PDCP Throughput              │  ● CRITICAL: Site X degraded │
│  Data Drop Rate               │  ● WARNING: PRB util high    │
│  VoLTE Answer Rate            │  ● INFO: Provisioning done   │
│  Poor Quality Rate            │                              │
├───────────────────────────────┴──────────────────────────────┤
│  Top Offenders Table (site | KPI | delta | trend | action)   │
└──────────────────────────────────────────────────────────────┘
```

**Screen 2: Observe (Map + Site Panel)** (already exists, productionize)
- Keep Mapbox map as primary
- Site panel: proper tabs (Overview | KPI Trends | RCA | Parameters | History)
- RCA panel: redesign as structured card with confidence, reasoning steps, neighbors

**Screen 3: Analyze Workspace** (new - split out from chat)
- Left: site/KPI selector + filter bar
- Center: time-series chart (multi-KPI overlay)
- Right: AI RCA panel with chain-of-thought
- Bottom: Anomaly timeline

**Screen 4: Automate (AppGen)** (already exists, productionize)
- Redesign AppStore as a proper app catalog (cards not a list)
- ConversationalAppBuilder: keep split-screen, improve code panel UX
- Add: App version history, deployment status, test results

**Screen 5: Aira Chat Drawer** (cross-cutting)
- Design the persistent chat panel at all three states: closed/mini/expanded

---

## Phase 4: Navigation & Routing Architecture

### Current Problem
App uses React state switching (`currentView`). No URL routing, no history, no deep links.

### Solution: React Router v6
```
/                         → redirect to /overview
/overview                 → Overview dashboard
/observe                  → Map (no site selected)
/observe/:siteId          → Map with site panel open
/analyze                  → Analyze workspace
/analyze/:siteId          → Pre-loaded with site
/automate                 → AppGen landing
/automate/apps            → App library
/automate/builder         → Conversational builder
/automate/builder/:appId  → Builder with existing app
/automate/flowchart       → Visual builder
/provision                → Provisioning dashboard
/provision/:jobId         → Specific ZTP job
/admin                    → Admin panel
/settings                 → User settings
```

---

## Phase 5: Role-Based Views

Different users see different default layouts. Implement via user role in JWT:

| Role | Default Route | Sidebar Visible Items |
|------|-------------|----------------------|
| `noc_operator` | `/overview` | Overview, Observe, Provision |
| `rf_engineer` | `/analyze` | All items |
| `app_developer` | `/automate` | Automate, Analyze, Settings |
| `manager` | `/overview` | Overview, Analyze, Automate |
| `director` | `/overview` | Overview only (simplified) |

---

## Phase 6: Code Architecture Changes Needed

### Files to Create/Heavily Modify
- `frontend/src/router.tsx` - New: React Router setup
- `frontend/src/components/ui/` - New: shadcn/ui component installs
- `frontend/src/components/layout/AppShell.tsx` - Replace `AppSpaceLayout.tsx`
- `frontend/src/components/layout/AiraDrawer.tsx` - New: persistent chat drawer
- `frontend/src/views/OverviewView.tsx` - New: executive dashboard
- `frontend/src/views/AnalyzeView.tsx` - New: RCA workspace (extracted from chat)
- `frontend/src/components/kpi/KpiCard.tsx` - New: reusable KPI card
- `frontend/src/components/network/AlertsFeed.tsx` - New: live alerts

### Existing Files to Productionize (keep logic, redesign UI)
- `ObserveView.tsx` + `MapView.tsx` - Keep Mapbox, redesign panels
- `AppStore/ConversationalAppBuilder.tsx` - Keep split-screen, new design
- `ProvisioningView.tsx` - Keep pipeline logic, redesign step UI
- `ChatInterface.tsx` - Reduce scope to Aira drawer, not standalone page

---

## Recommended Execution Order

```
Week 1: Foundation
  □ Figma: Tokens + Component Library (Tier 1 + 2)
  □ Code: Install shadcn/ui, set up React Router, new AppShell

Week 2: Core Screens
  □ Figma: Overview + Observe screens hi-fi
  □ Code: Overview dashboard + productionize Observe

Week 3: AI Integration
  □ Figma: Aira Drawer + Analyze Workspace
  □ Code: Aira persistent drawer + Analyze view

Week 4: Automate + Provision
  □ Figma: AppGen redesign + Provision screens
  □ Code: Productionize AppStore + Provision views

Week 5: Polish + RBAC
  □ Role-based routing + default views
  □ Light/dark theme consistency audit
  □ Responsive breakpoints (1280px minimum target)
```

---

## Verification
- Load app as each role → correct default view and sidebar
- Aira chat drawer opens/closes on every page
- "Take me to site X" in chat → navigates to /observe/:siteId
- Overview KPI cards load data from existing `/api/kpis` + `/api/anomalies` endpoints
- React Router deep links work on refresh (configure Vite to serve index.html for all routes)
