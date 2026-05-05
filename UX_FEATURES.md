# Naavik Unified UX — User-Facing Feature List

A concise rundown of the major features users actually see and use. Grouped by the journey through the app.

---

## Onboarding & Identity

- **Persistent Login** — Username/password with a 4-hour session token kept across reloads. Re-opening a tab returns you straight to where you left off, no re-authentication needed.

- **First-Time Market Selector** — On first login, users pick their target market (Northern California today; Southern California, Pacific Northwest, Texas, and Northeast queued for future). Choice persists across sessions and can be switched anytime from the user menu.

- **Default Landing Page Setting** — Configure where every login lands you: Naavik Chat, Naavik Observe, or Naavik AppGen. Saved per browser, so the next session opens directly into your preferred workspace.

- **User Profile Menu** — Single dropdown under the avatar with Market switcher, Settings, Feedback, and Log out. Replaces what used to be three separate sidebar buttons for a cleaner rail.

---

## Conversational Co-Pilot (Naavik Chat)

- **Multi-Stream Chat** — Five purpose-built modes: Universal (all-modules), Observability, AppGen, Provision, Knowledge. Switching streams reframes the AI's tools, prompts, and starter suggestions for that domain.

- **Agentic Tool Use** — The AI calls real tools (find site, fetch KPIs, run RCA, build dashboards, query data, navigate the app) in parallel batches and synthesizes a structured answer. Capped at 8 reasoning iterations to keep latency predictable.

- **Stop Button** — During processing, the Send button morphs into an animated Stop button. Clicking aborts the in-flight request and frees the input for a new query — no page reload needed.

- **Generative UI in Chat** — Responses come back as rich UI elements (diagnosis cards, severity meters, topology grids, KPI dashboards, ranked lists) instead of plain text. The agent picks the best visual shape per question.

- **Smart Suggestions & Starter Prompts** — Each chat stream shows curated suggestion chips on the empty state. Click a chip to send a pre-filled prompt; placeholder text rotates between common verbs (Observe, Build, Ask, Trigger).

- **Session History per Stream** — The sidebar shows your recent prompts grouped by stream so you can re-send any prior query with one click.

---

## Network Observability (Naavik Observe)

- **Live Network Map** — Mapbox-powered map of 6,800+ sites for the selected market with zoom, pan, click-to-open. Sites are color-coded by severity so degraded zones jump out at a glance.

- **Smart Map Layers** — Toggle between three intelligence layers: Top Degraded (worst offenders), Outage (cells currently down), and Over-utilized (PRB > threshold). Layer can be set by typing "show me sites with outages" in chat.

- **Site Detail Panel (5 Tabs)** — Click any site to open a sliding panel with Site KPI, RCA, Operational Info, Site Topology, and AI Analyzer tabs. Top-level toggle flips between Summary mode (RCA-focused) and Diagnostic mode (deep telemetry).

- **AI Site Analyzer** — A dedicated tab that runs an 8-tool deep investigation on the selected site in ~30s, then renders a hero severity card, four verdict sections (What Changed / What Degraded / Likely Root Cause / Next Actions), an investigation trail, and grouped supporting evidence.

- **KPI Dashboard with Daily / Hourly Toggle** — Multi-KPI line chart panel defaulting to 30 days daily or 48 hours hourly. Pick from 16 standard KPIs grouped by category (Throughput, Accessibility, Utilization, Quality, Availability) or add custom KPIs.

- **Worst Offenders List** — Ranked daily list of sites contributing most to network degradation. Each row links to its site detail panel and offers an inline "Explain RCA" button.

- **Cluster Comparison** — Compare any site's KPI against its cluster peers; surfaces the rank, percentile, and outlier flag (>2σ below mean) so users know if a problem is site-specific or cluster-wide.

- **Neighbor Map Overlay** — Top handover neighbors render as connected dashed lines on the map with handover-share labels. Clicking a neighbor pivots the panel to that site.

- **Operational Info Workbench** — Aggregates alarms, tickets, configuration changes, outages, and EIM work orders for the selected site and its top neighbors over the last 7 days. Sub-tabs let users drill into each type.

- **Telemetry Dashboard** — Professional 5-tab telemetry view with semicircular gauge charts, hourly heatmaps, and KPI trend mini-charts for at-a-glance health monitoring.

- **Compass Market Dashboard** — Market-level KPI tile grid showing aggregated metrics across selected sites. Designed as the at-a-glance home for network operations.

- **Map Chat Bar** — Persistent chat input docked to the bottom of the map. Pre-fills with the selected site's USID so users can ask "what's wrong here?" without typing the ID.

---

## AI App Builder (Naavik AppGen)

- **Conversational App Creation** — Describe an automation in natural language ("increase qRxLevMin when PRB exceeds 80%") and the builder asks clarifying questions, drafts a plan, and asks for approval before generating any code.

- **6-Stage AI Pipeline** — Planning → Code Generation → Code Audit → Unit Testing → Integration Validation → App Assembly. Each stage is a specialized agent; users can rewind to any stage, edit, and re-run forward.

- **Real-Time File Generation Panel** — As code is generated, files appear live in a side panel with progress indicators and syntax-highlighted previews. Users can inspect or hand-edit any file in a Monaco editor.

- **Scaffold Confirmation** — Before any code is written, the agent shows the planned file structure (which files will exist and what they'll contain). Users approve or reject the scaffold up front.

- **Code Audit & Testing** — Static analysis catches embedded secrets, unsafe SQL, invalid parameter ranges, and missing KPIs. Auto-generated unit tests run in a sandbox; failures surface inline with the failing assertion.

- **Integration Validation** — End-to-end smoke test against a simulated network feeds the rApp synthetic KPI streams and validates the produced control actions before packaging.

- **rApp Packager** — Packages code, tests, manifests, and metadata into a Kubernetes-ready chart with values.yaml, deployment, and service. One click to download or publish to the catalog.

- **App Catalog with AI Search** — Browse and clone existing apps from a searchable catalog. Search uses embeddings + LangChain rerank to surface the most relevant prior art for a given goal.

- **Multi-Project Workspace** — Side-by-side project switcher; each project keeps its own files, conversation, and pipeline state. Useful when prototyping multiple variants of the same idea.

- **Live Agent Activity Rail** — A live progress rail shows which agent is currently active, what tool it called, and how much remains for long-running pipelines.

---

## Network Provisioning & Automation

- **Provisioning Workflow** — Multi-step change-request flow: target sites, parameter, old/new values, justification, target window. Reuses the AppGen builder so any one-off change can be promoted into a reusable rApp.

- **Provisioning Status Board** — Tracks in-flight, completed, and failed changes with full OSS audit logs and a one-click rollback option per change.

- **OSS Adapter Framework** — Pluggable connectors for ENM, Ericsson MOSES, etc. The same interface backs a built-in simulator so demos and dev work never touch real networks.

- **Control Agent (Chat-Triggered Automation)** — Phrases like "increase qRxLevMin by 2 dB on USID 9787" trigger the full pipeline: validate parameter → draft change → queue → push → monitor KPI delta. Status streams into the chat as it progresses.

- **Live Workflow Status Display** — Each automation step renders as a stage card (pending / running / done / failed) with per-step duration. The full execution report appears at the end with a success/failure verdict.

- **Pre-Built Automation Templates** — Out-of-the-box templates for common operations like HOSR-driven traffic balancing — picks neighbor relations, computes individual offsets, and pushes changes through OSS automatically.

---

## Knowledge & Telecom Library

- **DataDict-Grounded Q&A** — Ask "what is qRxLevMin?" or "explain DATA_DROP_RATE" and the system returns the parameter description, valid range, default value, and usage notes from a 16,000-entry Ericsson EIAP catalog.

- **Fuzzy KPI / Parameter Lookup** — Misspelled or informal names ("DL_TROUGHPUT", "drop rate") are auto-corrected to their canonical form via trigram fuzzy match. When ambiguous, the system surfaces a chip selector so the user picks.

- **Parameter ↔ KPI Cross-Reference** — Reverse lookup answers "which parameters affect drop rate?" by mapping every KPI to the parameters that influence it.

- **Knowledge Stream Chat** — A dedicated chat mode that routes every question through the knowledge tool. Answers come back as cards with definition, range, and related parameters.

---

## Settings & Personalization

- **Theme Toggle** — Light, Dark, or System (auto-follow OS preference). Theme persists across sessions and is applied uniformly to every component.

- **Default Landing Page** — Pick which workspace opens after every login: Naavik Chat, Naavik Observe, or Naavik AppGen.

- **Demo Mode (Anonymized USIDs)** — Toggle to mask all real USIDs as `UST######` for screenshots, demos, or training. Reverse-mapping handles chat input — users can type a masked ID and the system translates it back transparently.

- **Saved Dashboards** — Save any KPI dashboard configuration (site, KPIs, timeframe, days) as a named dashboard accessible from the sidebar. One click to reload.

- **Saved Dashboards Manager** — List, rename, and delete saved dashboards from the sidebar. Selecting a dashboard restores its full state including selected USID and KPI list.

- **AppGen Defaults** — Per-user defaults for AppGen runs: preferred LLM model, Kubernetes context, default OSS adapter, scaffold preferences.

- **KPI Library Customization** — Edit the standard KPI groups and add custom user-saved KPIs that show up in the KPI selector across all dashboards.

- **App Permissions Matrix** — Admin-only UI for granting or revoking per-user access to apps in the platform registry.

---

## Speed & Reliability

- **Local Data Mirror** — Frequently-accessed network data (offender sites, KPIs, topology, neighbors, RCA, outages, parameter changes, etc.) is mirrored to a local Postgres updated daily. Site analysis loads in under 1 second instead of 10–30 seconds.

- **Mirror-First Reads with Remote Fallback** — The app reads from the local mirror first; if a USID isn't in the mirror, it transparently falls back to the remote source. Users never see a "missing data" gap.

- **Parallel Tool Execution** — Whenever the AI needs multiple data points, it batches independent calls in parallel rather than running them in sequence. A 60-second analysis becomes a 30-second one.

- **Automatic 30-Day Retention** — The mirror auto-prunes anything older than 30 days every night, keeping queries fast and storage bounded without operator intervention.

---

## Visual Design System

- **Modern Glassmorphism + Animated Accents** — Cards use frosted-glass surfaces, gradient strips, hover-lift transitions, and severity-colored glows. Animated spinners, pulse halos, and gradient bars give visual hierarchy without clutter.

- **Generative UI Block Library** — 22 reusable visual primitives the AI can mix and match: data tables, compact tables, severity meters, topology grids, diagnosis cards, KPI dashboards, severity callouts, ranked lists, RCA story cards, code views, charts, and more.

- **Auto-Pairing of Compact Tables** — When the agent emits multiple small tables in one response, the renderer automatically pairs them into a 2-column grid for denser, more scannable output.

- **Severity Visual Language** — Consistent color cues across the app: critical = red, major = orange, minor = amber, nominal = green. Used in maps, badges, bars, halos, and dashboards.

- **Responsive Sidebar** — Collapsible left rail (Claude-style) with workspace switcher, session history, and consolidated profile menu. Collapses to a 68 px icon strip; expands to 248 px with full labels.

---

## Document End

> 60 major user-facing features across 7 product areas. For the comprehensive 139-feature engineering inventory and the editable Excel roadmap, see `FEATURE_LIST.md` and `feature-roadmap.xlsx` in the project root.
