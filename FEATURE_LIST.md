# Naavik Unified UX — Feature List

**Document version:** 1.0
**Project root:** `/Users/admin/nirmalc/Code/Naavik/naavik_unified_ux`
**Stack:** React 18 + TypeScript + Vite (frontend), Node + Express + tsx (backend), PostgreSQL (local), MSSQL (remote)

This is the canonical feature inventory of the Naavik Unified UX platform. Features are grouped into 11 domains. Each entry has an ID, a name, and a 3–4 line description. Use these IDs in the companion Excel workbook (`feature-roadmap.xlsx`) for tracking.

---

## 1. Platform & Authentication (PF)

**PF-001 · JWT Login + 4-hour Persistent Session**
Username/password login backed by Express + bcrypt + JWT. Token (24h) is stored in `localStorage` under `naavik_token`. The frontend's `AppBootstrap` verifies the token on every reload via `/api/auth/verify` and silently re-hydrates the user.

**PF-002 · Env-Driven Admin Credentials**
Admin user, password hash, and JWT secret are read from `backend/.env` at startup. The auth route uses lazy initialization to survive ESM hoisting timing issues with `dotenv.config()`. The server fails fast with a clear error if credentials are missing.

**PF-003 · Auth Context + Permission Gating**
React `AuthContext` exposes the logged-in user and per-app permission map. Components can gate features via `useAuth()`. Permissions are fetched from `/platform/users/:id/permissions` and refresh whenever the user changes.

**PF-004 · First-Time Market Selector Modal**
A non-dismissable `MarketSelector` modal blocks app rendering on first login until the user picks a market. Subsequent logins skip it. Selection is persisted in `localStorage` under `naavik_market` so it survives reloads.

**PF-005 · Multi-Market Configuration**
The `MARKETS` config in `frontend/src/config/markets.ts` is a single source of truth. Each market maps to a label and a list of raw `MARKET` values from the remote `site_table`. Northern California is the only available market today; future markets show as "Coming soon" pills.

**PF-006 · Theme Provider (Light/Dark)**
A `ThemeProvider` exposes `theme` and `setTheme`. All bespoke components consume it. Defaults to dark for the modernized look; the `<html>` `dark` class is forced on bootstrap.

**PF-007 · User Profile Dropdown**
The left sidebar's user avatar opens a consolidated menu — Market switcher, Settings, Feedback, Log out. Renders inline when sidebar is expanded; portals to a fixed popover when collapsed.

**PF-008 · Collapsible Left Sidebar**
Claude-style sidebar with collapse/expand toggle, navigation rail (Home / Observe / Provision / AppGen / Knowledge), per-stream session history, and the consolidated profile menu at the bottom.

**PF-009 · Platform Bus (Inter-App Navigation)**
A pub/sub `PlatformBus` lets any component publish navigation intents (e.g. `NAVIGATE_TO_APP`). The shell subscribes and routes accordingly. Used by chat to deep-link into Observe / Provision / AppGen.

**PF-010 · App Registry**
Dynamic registry of mountable apps with display name, icon, route, default chat stream, and permission key. Drives the sidebar nav and `AppSlot` mounting.

**PF-011 · Login UI with Fluid Background**
`LoginPage` with split-pane layout, animated fluid gradient background, and theme-aware Naavik branding. Username + password + show/hide eye toggle.

---

## 2. Chat & Intent (CI)

**CI-001 · Multi-Stream Chat Orchestrator**
Five chat streams (`universal`, `observability`, `appgen`, `provision`, `knowledge`) with stream-specific prompts and starter suggestions. The active stream is derived from the current view but can be overridden in the UI.

**CI-002 · Agent V3 Orchestrator**
True OpenAI function-calling loop. The agent picks tools, executes them in parallel batches via `Promise.allSettled`, and synthesises a final response. `MAX_ITERATIONS=8`, model defaults to `gpt-4o-mini`.

**CI-003 · 21-Tool Agent Registry**
Tools include `find_site`, `get_worst_offenders`, `get_site_rca`, `get_site_kpis`, `show_kpi_dashboard`, `query_data`, `generate_report`, `telecom_knowledge`, `resolve_kpi_param`, `set_map_layer`, `navigate_to`, plus 10 site-analysis tools.

**CI-004 · Site-Analysis Tool Suite**
`get_site_topology`, `get_config_changes`, `get_neighbor_relations`, `get_ret_changes`, `get_site_outages`, `get_neighbor_outages`, `get_hourly_trends`, `get_kpi_impact_breakdown`, `get_ticket_history`, `compare_with_cluster`. Each is bounded by USID + date and reads from the local mirror.

**CI-005 · Intent Classifier**
Semantic + explicit + context-aware intent classifier. Routes "show map", "explain RCA", "build app", etc. to the right stream and tool path. Used by V2 chat and the navigation orchestrator.

**CI-006 · Navigation Orchestrator**
Three-layer intent detection that turns chat queries into platform-bus navigation events. E.g. "open observe" navigates the user; "show me sites with alarms" navigates AND sets the map layer.

**CI-007 · Conversation Context Service**
Persists thread state, history, and metadata in PostgreSQL. The orchestrator reads context on every turn so multi-turn conversations work (e.g. clarifying a KPI then re-querying with the resolved name).

**CI-008 · Stop Button (Abort Controller)**
The Send button morphs into a Stop button (animated spinning ring around a square) while a request is in flight. Clicking aborts the in-flight `agentV3Chat` call via `AbortController` and silently posts a "Request stopped" system note.

**CI-009 · Structured Synthesis Format**
The orchestrator's system prompt requires a six-section markdown synthesis (Severity / Headline / What Changed / What Degraded / Likely Root Cause / Next Actions) for deep investigations. Powers the `DiagnosisCard` UI block.

**CI-010 · Auto-Emit Diagnosis Card**
When the orchestrator detects the structured-synthesis format, it auto-injects a `diagnosis_card` UI block AND replaces the chat-bubble text with just the headline so the same content isn't shown twice.

**CI-011 · KPI / Parameter Resolver**
The `resolve_kpi_param` tool fuzzy-matches user phrases against the 16k-entry DataDict catalog (Ericsson EIAP). When ambiguous, it surfaces a chip selector and waits for the user's pick before requerying.

**CI-012 · Suggestion Chips & Starter Prompts**
Each chat stream has a curated suggestion list shown on the empty state. Chips emit pre-filled prompts. The home stream rotates placeholders ("Observe and Analyze" / "Build an App" / "Ask the Telco Library" / "Trigger a change").

**CI-013 · Multi-Attachment Support**
Chat composer accepts up to 3 attachments per message — CSVs (≤750 KB), images (≤900 KB), or plain text (≤120 KB). Attachments are sent inline with the chat payload.

**CI-014 · Per-Stream Session History**
Sidebar shows recent user prompts grouped by stream (Observe / AppGen / Provision / Knowledge). Click any prompt to re-send it. History is local to the React state.

**CI-015 · V2 Chat Fallback**
The V2 orchestrator (legacy, no tool calling) is used as a fallback when the V3 path is disabled. Toggle via `localStorage.setItem('naavik:use-agent-v3', '0')` or the Settings page.

---

## 3. Naavik Observe (OB)

**OB-001 · Mapbox Site Map**
Interactive Mapbox-GL map showing 6,800+ telecom sites for the selected market. Zoom, pan, and click-to-open site detail. Sites colored by severity (red = degraded, orange = outage, blue = healthy).

**OB-002 · Site Layer Toggles**
Map can render any of three layers — `degraded` (top offenders), `outage` (active site outages), `overutilized` (PRB > threshold). Driven by `set_map_layer` from chat or by direct UI clicks.

**OB-003 · Site Detail Panel — 5 Tabs**
Click a site → tabbed panel opens. Tabs: Site KPI, RCA, Operational Info, Site Topology, AI Analyzer. Top toggle switches between Summary mode (RCA-focused) and Diagnostic mode (deep telemetry).

**OB-004 · Summary Mode (Animated RCA)**
For top-degraded sites, the Summary view animates the strongest causal factors with a step-by-step RCA evidence panel and an inline mini-map showing related neighbors.

**OB-005 · Diagnostic Mode**
Full telemetry view with KPI charts, hourly insights, anomaly callouts, and operational context. Uses `getSiteComprehensiveAnalysis` for the data; cut over to local mirror so it lands sub-second for offender sites.

**OB-006 · Cell Topology View**
Lists every cell on the site with band, technology, azimuth, height, and anomaly status. Replaced the legacy table with the new `TopologyGrid` (cells grouped by band, hover-lift tiles, anomaly glow).

**OB-007 · KPI Dashboard (Daily / Hourly Toggle)**
Multi-KPI line-chart dashboard with daily (7/14/30/60/90 days) and hourly (24/48/72 hr) granularities. KPI selector with 16 standard KPIs grouped by category, plus custom KPI search.

**OB-008 · Multi-KPI Comparison**
Render up to 8 KPIs simultaneously on the same dashboard. Each chart has unit-aware Y-axis, anomaly markers, and a color from the shared 20-color palette.

**OB-009 · Hourly Insights Panel**
Time-of-day pattern analysis — peak hours, busy-hour deviation, recurring anomaly hours, weekly comparison.

**OB-010 · Mobility Trends**
Handover success rate (HOSR), inter/intra-frequency HO trends, throughput-per-handover. Used by the analyzer to detect coverage issues.

**OB-011 · Outage Timeline**
Per-cell outage events plotted on a 24-hour or 7-day strip. Shows metric type (`4G_CELL_DOWN`, etc.) and the snapshot hour.

**OB-012 · Traffic Profile Dashboard**
DL/UL volume and PRB-utilisation profile for the site. Helps distinguish capacity issues from coverage issues.

**OB-013 · Cross-Correlator (KPI Relationships)**
Pairwise correlation analysis between KPIs (e.g. PRB util ↔ drop rate). Surfaces which KPI pairs move together or diverge.

**OB-014 · AI Analyzer Tab**
A dedicated tab inside the site detail panel that runs the deep investigation workflow (8–10 tools in parallel) and renders a hero severity card, four verdict sections (What Changed / Degraded / Root Cause / Next Actions), an investigation trail, and grouped evidence.

**OB-015 · Worst Offenders Ranking**
Daily ranked list of sites by total CQX impact. Each row links to the site detail panel with one click. The "Explain RCA" button on each row triggers an inline explanation.

**OB-016 · Cluster Comparison**
For any KPI, compare the source site against all peers in the same cluster. Returns rank, percentile, and outlier flag (>2σ below mean) plus a bar chart with the source site highlighted.

**OB-017 · Neighbor Map Overlay**
When viewing a site, top neighbors render as connected dashed lines on the map with handover-share labels. Clicking a neighbor pivots the panel to that site.

**OB-018 · Operational Info Workbench**
Aggregates alarms, tickets, configuration changes, outages, and EIM work orders for the site + neighbors over the last 7 days. Sub-tabs let the user drill into each type.

**OB-019 · Compass Dashboard (KPI Tiles)**
A market-level dashboard tile grid showing aggregated KPIs across all selected sites. Used as an at-a-glance Network Management home.

**OB-020 · Telemetry Dashboard with Gauges + Heatmaps**
Professional 5-tab telemetry dashboard with semicircular gauge charts (CQI, RSRP, etc.), hourly heatmaps, and KPI trend mini-charts.

**OB-021 · Map Chat Bar**
A persistent chat input docked to the map view's bottom edge. Pre-fills with the selected site's USID so users can ask "what's wrong here?" without typing the ID.

**OB-022 · Site Status Pills**
"TOP DEGRADED" and "OUTAGE" red pulse pills appear in the panel header for offender sites. Pulled from `cqx_offenders_truth_table` and `site_table.outage`.

---

## 4. Naavik AppGen (AG)

**AG-001 · 6-Stage AI App Pipeline**
Planning → Code Generation → Code Audit → Unit Testing → Integration Validation → App Assembly. Each stage is a specialized agent; the pipeline is a state machine with backward navigation.

**AG-002 · Planning Agent**
Takes a natural-language requirement and produces a structured plan: target KPI, trigger condition, action, scope, and failure modes. The user can approve / edit before code generation begins.

**AG-003 · Code Generation Agent**
Generates the rApp code, config YAML, K8s manifests, and tests. Live file panel updates in real time as files are written. Monaco editor lets the user inspect and edit any file inline.

**AG-004 · Code Audit Agent**
Static analysis — security checks (no embedded secrets, safe SQL), correctness checks (parameter ranges, KPI name validity), and style. Surfaces findings with severity tags and inline links.

**AG-005 · Unit Test Agent**
Generates unit tests for the rApp logic + runs them in a sandboxed runner. Fails surface inline with the failing assertion.

**AG-006 · Integration Validation Agent**
End-to-end smoke test against a simulated network — feeds the rApp synthetic KPI streams and validates the produced control actions against expected behavior.

**AG-007 · App Assembly Agent**
Packages everything (code + tests + manifests + metadata) into a deployable bundle. Produces a download zip and a "publish to catalog" action.

**AG-008 · Conversational App Builder**
Free-form chat interface for app creation. The builder asks clarifying questions when the requirement is ambiguous (e.g. "which KPI threshold?").

**AG-009 · Scaffold Confirmation**
Before any code is generated, the agent shows the file scaffold (which files will exist, what they contain). The user approves or rejects the scaffold.

**AG-010 · Real-Time File Generation Panel**
Streamed file writes appear in a side panel as they happen. Each file shows generation progress + a syntax-highlighted preview when done.

**AG-011 · Workflow State Machine + Backward Nav**
The 6-stage pipeline persists state per project. Users can rewind to any stage, edit, and re-run forward. Critical for iterating without restarting from scratch.

**AG-012 · Multi-Project Workspace**
Side-by-side project switcher. Each project keeps its own files, conversation, and pipeline state. Useful when prototyping multiple variants.

**AG-013 · rApp Packager**
Produces a Kubernetes-ready chart with values.yaml, deployment, and service manifests. Optionally targets the user's cluster context.

**AG-014 · AppGen Catalog with LangChain Reranker**
Search-and-clone existing apps from a catalog. Search uses embeddings + LangChain rerank to surface the most relevant prior art.

**AG-015 · YANG / DataDict Domain Tools**
Helper agents for parameter validation against YANG models and the DataDict KPI/parameter catalog. Surfaces "unknown parameter" warnings before code is generated.

**AG-016 · Interactive Q&A Clarification**
When the planning agent is uncertain (vague KPI, missing trigger), it asks the user inline. Answers are appended to the running plan.

**AG-017 · AppGen Memory System**
Per-project conversation memory + cross-project lessons (best practices learned from prior runs). Stored in PostgreSQL and surfaced as suggestions.

**AG-018 · Agent Activity Rail**
Live progress rail showing which agent is currently active, what tool it called, and how much remains. Useful for monitoring long pipelines.

---

## 5. Naavik Provision (PV)

**PV-001 · Provisioning Workflow Simulator**
Simulates the operator's change-management flow — change request, approval, OSS push, validation. No real network impact; safe for demos and training.

**PV-002 · OSS Adapter Framework**
Pluggable connector for ENM, Ericsson MOSES, etc. The simulator implements the same interface so generated apps can be tested against either real or simulated OSS.

**PV-003 · ENM Connector**
Direct integration with Ericsson Network Manager for parameter changes. Feature-flagged per market (off by default in dev).

**PV-004 · Provisioning Candidate Site UI**
Shows sites flagged for parameter changes with current vs proposed values, expected KPI delta, and a one-click "submit change" button.

**PV-005 · Change Request Flow**
Multi-step form for crafting a change: target sites, parameter, old/new values, justification, target window. Reuses the rApp builder for automation.

**PV-006 · Provisioning Status Tracking**
Status board showing in-flight, completed, and failed changes. Each row exposes the OSS audit log and rollback option.

---

## 6. Control Agent / Automation (CA)

**CA-001 · Automation Pipeline Service**
Backend service that orchestrates the full automation lifecycle — from chat-triggered intent → rApp build → OSS push → KPI validation. Persists state in PostgreSQL.

**CA-002 · Workflow Generator**
Takes a high-level goal (e.g. "balance traffic across cells") and produces an executable workflow JSON with steps, triggers, and rollback logic.

**CA-003 · OSS Adapter Simulator**
In-process simulator that mimics OSS responses (success/failure, latency, parameter validation errors). Used in dev and demos to avoid touching real networks.

**CA-004 · Execution Status Polling**
Polls automation execution status from the backend at 2s intervals and renders the live status in `WorkflowExecutionStatus` UI block.

**CA-005 · Agent Automation Report**
Final report card after a workflow completes — steps executed, OSS responses, KPI deltas measured, success/failure verdict.

**CA-006 · Multi-Step Workflow Display**
Stage-by-stage UI block showing each automation step with its status (pending / running / done / failed) and per-step duration.

**CA-007 · Change-Parameter Intent Execution**
Chat intent like "increase qRxLevMin by 2 dB on USID 9787" triggers the full pipeline: validate parameter, draft change, queue, push, monitor.

**CA-008 · Traffic Balancing Automation**
Pre-built automation template for HOSR-driven traffic balancing — picks neighbor relations, computes individual offsets, pushes through OSS.

---

## 7. Knowledge / Telecom Library (KN)

**KN-001 · Telecom Knowledge Service**
Q&A engine grounded in the DataDict catalog. Answers questions like "what is qRxLevMin?" with parameter description, valid range, default value, and usage notes.

**KN-002 · DataDict Resolver (16k Parameters)**
In-memory index of 16,038 Ericsson EIAP `telco_RAN` parameters. Supports exact, prefix, and fuzzy match; warm-loaded from disk on backend startup.

**KN-003 · Fuzzy Match KPI / Parameter Lookup**
Trigram-based fuzzy match for misspelled or informal names ("DL_TROUGHPUT" → `DL_TOTAL_DRB_THPUT`). Returns ranked candidates with confidence scores.

**KN-004 · Knowledge Stream Chat**
Dedicated chat stream that routes all queries through the knowledge tool. UI shows answer cards with definition, range, and related parameters.

**KN-005 · Parameter-to-KPI Mapper**
Reverse lookup: given a KPI, list the parameters that influence it. Useful for "which parameters affect drop rate?" queries.

**KN-006 · Schema Registry**
Backend cache of remote DB column types + KPI catalog. Refreshes hourly so the SQL generator has up-to-date metadata.

**KN-007 · CSV RAG Resolver**
Retrieval-augmented resolver for CSV-uploaded scenario data. Lets the agent answer questions about the user's own data file.

---

## 8. Generative UI Elements (UI)

**UI-001 · UiBlocksRenderer**
Central renderer that maps every uiBlock type to a React component. Currently handles 18+ block types and auto-pairs adjacent compact tables into a 2-column grid.

**UI-002 · data_table (AG-Grid)**
Heavy-weight interactive table for multi-site lists with filter, sort, virtualization, and an Explain-RCA button per row. Used by `get_worst_offenders` and `query_data`.

**UI-003 · compact_table**
Lightweight, dense table without AG-Grid. Auto-detects numeric / cell-name / anomaly columns and styles them accordingly. Used by all 8 site-analysis tools.

**UI-004 · kpi_dashboard**
Interactive multi-KPI chart panel with daily/hourly toggle, KPI selector, save-to-dashboard, and collapsible sections. Powered by `KpiDataAdapter`.

**UI-005 · insight_chart**
Single ECharts panel with a title, subtitle, and full ECharts option object. Most flexible chart type — used by query_data and any tool emitting ad-hoc visualizations.

**UI-006 · stat_row**
Horizontal row of label/value stat tiles. Compact way to surface a handful of metrics.

**UI-007 · callout (toned info box)**
Tone-colored box with icon and text. Tones: info, success, warning, error.

**UI-008 · chips (interactive prompts)**
Row of clickable pill buttons. Each chip emits a chat prompt when clicked. Used for KPI disambiguation and follow-up suggestions.

**UI-009 · ranked_list**
Vertical ranked list with severity dots, value, and trend sparkline. Used for offender lists in compact form.

**UI-010 · rca_story**
Narrative-style RCA card with chain-of-thought steps, evidence, and conclusion. Used in summary-mode RCA views.

**UI-011 · rca_summary / rca_report**
Condensed RCA cards with bucket category, confidence score, and short summary. Render as the first thing a user sees on a degraded site.

**UI-012 · ticket_escalation**
Card prompting the user to escalate a finding to the network operations team. Pre-filled with site context.

**UI-013 · execution_status**
Live workflow status card with stage list, current step, and progress bar. Polls the automation backend.

**UI-014 · tabs container**
Tabbed UI block with each tab carrying its own list of nested UI blocks. Used by `generate_report` for multi-panel reports.

**UI-015 · grid_layout**
Responsive 2/3/4-column grid container holding child UI blocks. Lets tools compose dashboards dynamically.

**UI-016 · map_inset**
Inline Mapbox preview rendered inside a chat message. Used by `set_map_layer` and neighbor RCA flows.

**UI-017 · code_view**
Syntax-highlighted code block with copy button. Used for SQL output, generated rApp code, etc.

**UI-018 · DiagnosisCard (NEW)**
Severity hero strip + animated orb + four verdict-section cards (What Changed / Degraded / Root Cause / Next Actions). Auto-extracted from structured-synthesis markdown.

**UI-019 · SeverityMeter (NEW)**
Horizontal bar gauges for KPI / impact subcomponents. Gradient red→orange→yellow→green by magnitude, anomaly halo + shimmer. Used by `get_kpi_impact_breakdown`.

**UI-020 · TopologyGrid (NEW)**
Cells grouped by band (Lowband / PCS / AWS / 5G NR / mmWave) with palette-tinted band chips and hover-lift cell tiles. Anomalous cells get a red ring + pulsing dot.

**UI-021 · Save-to-Dashboard Modal**
On any chart view, save the current configuration (siteId, KPIs, timeframe, daysBack) as a named dashboard. Persists to localStorage.

**UI-022 · Saved Dashboards Manager**
Sidebar list of saved dashboards with one-click reload, rename, delete.

---

## 9. Data Layer (DL)

**DL-001 · NaavikDBConnector**
TypeScript port of the Python remote DB connector. POSTs SQL to the remote query endpoint and returns parsed rows. Used as the read path for non-mirrored data.

**DL-002 · Local Postgres Mirror Schema**
Dedicated `mirror.*` schema in the local Postgres holding faithful copies of 14 remote tables. Same column names (lowercased), same row shape, same data types (mapped from MSSQL).

**DL-003 · Schema Discovery from MSSQL INFORMATION_SCHEMA**
Auto-generates the mirror DDL by reading remote `INFORMATION_SCHEMA.COLUMNS`. Maps MSSQL types (varchar/datetime2/bit/decimal) to PG equivalents. Re-runs on every backend boot to pick up new columns.

**DL-004 · Offender-Only Mirror Strategy**
Mirror only contains rows for "offender" USIDs (sites where `chain_of_thought IS NOT NULL` for that day). Roughly 50–100 USIDs per day × 30 days = manageable size, full RCA detail.

**DL-005 · 30-Day Backfill on First Boot**
First-time backend start triggers a non-blocking backfill of the last 30 days. Days run sequentially; tables within a day run in parallel batches of 4.

**DL-006 · Daily Incremental Sync (03:00 UTC)**
Cron-style scheduler runs `runForDate(yesterday)` every day. Configurable via `MIRROR_DAILY_HOUR_UTC` env var.

**DL-007 · 30-Day Retention Sweep**
After every daily sync, all mirror tables are pruned of rows older than 30 days. Keeps storage bounded and queries fast.

**DL-008 · USID Chunking for High-Cardinality Tables**
`hourly_intermediate_kpis_table` has 36k rows per offender per day. The mirror sync chunks the offender USID list (5 per chunk) and runs 3 concurrent chunks to avoid 10-min query timeouts.

**DL-009 · SARGable Date Predicates**
All mirror queries use `date_id::date BETWEEN $1::date AND $2::date` instead of `CAST(DATE_ID AS DATE) =` — keeps PG able to use the date_id index.

**DL-010 · Mirror Run Log**
`mirror.run_log` records every (date, table) sync result with row counts, durations, and errors. Surfaced via `/api/mirror/status` for ops debugging.

**DL-011 · Admin Endpoints**
`POST /api/mirror/backfill?days=30` and `GET /api/mirror/status` for manual ops control. JWT-protected.

**DL-012 · mirrorOrRemote Query Router**
Generic helper that runs a local query first; if 0 rows or error, transparently falls back to remote. All site-analysis tools and the KPI dashboard use this.

**DL-013 · Legacy Schema Shims**
`public.filtered_sites`, `public.cqx_offenders_truth_table`, `public.filtered_cell_table`, `public.filtered_sector_table`, `public.filtered_cell_sector_map_view` are auto-created VIEWS over the mirror with PascalCase column aliases, so legacy callers stop logging "relation does not exist".

**DL-014 · Topology Cache**
Separate `topology_cache_sites` and `topology_cache_sectors` tables synced from remote every 6 hours. Drives the map view's site list (faster than mirror because it's denormalized).

**DL-015 · KPI Data Adapter**
Service layer that aggregates daily/hourly KPI data for the dashboard. Mirror-first — falls back to remote for non-offender sites.

**DL-016 · SQL Generator (Text-to-SQL)**
LLM-driven SQL generator that turns chat queries into safe, read-only Postgres SQL against the public-schema views. Used by the `query_data` tool.

**DL-017 · Conversation Context Store**
PostgreSQL-backed store for per-thread chat state. Lets the V3 orchestrator have multi-turn context across reloads.

**DL-018 · DB Schema Reference Cache**
Hourly-refreshed cache of distinct KPI names, subcomponent names, and column lists. Used by the SQL generator and resolver for grounding.

---

## 10. Settings (ST)

**ST-001 · Settings Page (Tabbed)**
A dedicated `/settings` view with tabs for User Profile, AppGen Config, KPI Library, App Permissions, and System Preferences. Routed via the platform bus.

**ST-002 · AppGen Settings**
Per-user defaults for AppGen — preferred LLM model, Kubernetes context, OSS adapter, default scaffold options.

**ST-003 · KPI Library**
Edit the standard KPI groups + custom user-saved KPIs that show up in the KPI selector. Persisted in PostgreSQL.

**ST-004 · User-App Permission Matrix**
Admin-only UI for granting/revoking per-user access to apps in the registry. Backed by the `user_app_permissions` table.

**ST-005 · Theme Toggle**
Light / Dark / Auto switch. Auto follows the OS preference.

**ST-006 · Demo Mode Toggle**
Master switch that enables the dummifier across the entire app. Persisted in localStorage.

**ST-007 · Profile Management**
User can update their display name, email, and notification preferences.

---

## 11. Demo Mode (DM)

**DM-001 · Dummifier Provider**
React context that exposes `dId(usid)` to mask real USIDs as `UST######`. Wraps every visible USID rendering across the app.

**DM-002 · Reverse Mapping for Chat**
When the user types a `UST######` token in chat, `unmapText()` translates it back to the real USID before sending to the backend. Enables natural conversation about masked IDs.

**DM-003 · Persistent Demo Toggle**
Demo mode survives reloads via `localStorage.getItem('naavik_dummifier_enabled')`. Controlled from Settings.

**DM-004 · Auto-Register Real IDs**
Whenever the live sites list updates, `MapDataContext` registers all real USIDs with the dummifier so reverse-lookup stays warm.

**DM-005 · Settings Page Integration**
Toggle is surfaced as a single switch in Settings → System Preferences with an explanatory hint.

---

## Domain Summary

| Domain | Feature Count | Status |
|---|---|---|
| Platform & Authentication | 11 | Mostly built |
| Chat & Intent | 15 | Mostly built |
| Naavik Observe | 22 | Mostly built |
| Naavik AppGen | 18 | Mostly built |
| Naavik Provision | 6 | In progress |
| Control Agent / Automation | 8 | Mostly built |
| Knowledge / Telecom Library | 7 | Built |
| Generative UI Elements | 22 | Mostly built |
| Data Layer | 18 | Built |
| Settings | 7 | Mostly built |
| Demo Mode | 5 | Built |
| **Total** | **139** | |

---

## How to Use This Document

1. **Engineering scoping** — match each ID to a Jira/Linear ticket. The IDs are stable; new features should use the next free number per domain.
2. **Roadmap discussions** — open `feature-roadmap.xlsx` for the editable workbook with status, priority, approval, owner, target version, and timeline columns per feature.
3. **Demo prep** — search the doc for the domain you're demoing (Ctrl+F "OB-" for Observe, "AG-" for AppGen, etc.).
4. **New features** — append at the bottom of each domain section using the next free ID. Keep descriptions to 3–4 lines.
