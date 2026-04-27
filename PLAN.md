# Compass Design Document Plan

## Summary
Create two deliverables from the current Compass implementation:

1. A repo versioned Markdown design document in `docs/` that captures the current Compass experience and backend/data contracts.
2. A condensed handoff summary in chat that points to the document structure and highlights the reusable implementation blueprint for another tool.

The document will follow a hybrid portability model:
- preserve exact current Compass behavior where it matters for parity
- add a normalized “portable architecture” layer so another tool can recreate the same views without copying Compass internals one-for-one

The backend/data section will include API contracts and query lineage, not just UI descriptions.

## Implementation Changes
### Document structure
Author one primary design spec organized into these sections:

- **Compass Overview**
  - product purpose, primary personas, major surfaces
  - high-level architecture: React dashboard, Flask API layer, DB connector, remote SQL/query service
  - runtime context assumptions: authenticated dashboard, date-scoped analysis, map-first workflow

- **Chat Interface Design**
  - chat goals: contextual analysis, guided navigation, guarded UI control, compact generative components
  - layout states: collapsed bottom dock, expanded bottom-anchored conversation, embedded-in-map behavior, split-view anchoring
  - state machine: idle, focused, expanded, loading, UI-command execution, forced collapse
  - interaction contracts:
    - input focus expands
    - map click collapses
    - site/panel actions collapse back to compact mode
    - explicit RCA/KPI requests may zoom and open the right panel
  - message model:
    - user message
    - assistant text
    - assistant component payload
    - assistant UI command payload
  - supported generative components from current implementation:
    - `site_action_card`
    - `offenders_table`
    - `anomalous_sectors_table`
  - supported guarded UI commands from current implementation:
    - `fly_to_site`
    - `fly_to_site_by_usid`
    - `open_site_panel`
    - `open_rca_panel`
    - `open_kpi_panel`
    - `set_date`
    - `open_chat_dashboard`
  - portable architecture subsection:
    - recommend a typed agent response envelope with `reply`, `components`, `ui_commands`
    - recommend keeping UI actions allowlisted and component-rendered, not freeform HTML
    - describe how another tool can map Compass commands/components into its own shell

- **Right Panel Design**
  - panel container behavior:
    - split vs maximized
    - panel open/close rules
    - relationship to map resizing and chat collapse
  - top-level tabs from current implementation:
    - Site KPI
    - RCA (conditional for offender/RCA-capable sites)
    - Operational Info
    - Site Topology
  - view mode behavior:
    - summary as default when RCA exists
    - diagnostic otherwise
    - summary/diagnostic meaning and when each is shown
  - Site KPI subsection:
    - sub-tabs and purpose:
      - CQX
      - Daily
      - Hourly
      - Timeline
      - Mobility
      - Outages
      - Traffic Profile
      - Insights
    - chart families used:
      - Recharts line/area charts
      - ECharts for richer interactive views and overlays
    - toolbar/controls:
      - date range picker
      - columns control only in maximized mode
      - KPI mode, add/remove KPIs, filter sets, site cache/site switcher
    - filters:
      - face
      - band
      - tech
      - filter behavior differences by tab
    - data-loading model:
      - eager vs lazy tabs
      - cached vs live fetches
      - split between site-level and cell-level series
  - RCA subsection:
    - Intuition Matrix / RCA tab
    - Analysis tab with chain-of-thought timeline
    - Raw Data tab
    - confidence, strongest factors, bucket summaries, recommendations
  - Operational Info subsection:
    - neighbors, alarms, tickets, config changes, outages, EIM
    - site vs neighbor partitioning and date windows
  - Site Topology subsection:
    - site metadata and cell topology
    - topology/filter use in KPI views

- **Schema Repository and Data Model**
  - describe `schema_repository.py` responsibilities:
    - known tables list
    - metadata collection from `INFORMATION_SCHEMA.COLUMNS`
    - row counts and sample values
    - cached `schema_repository.json`
    - compact schema prompt generation for chat
  - document how schema repository supports agentic chat and query grounding
  - include canonical production tables currently included in the repository
  - identify the main domain entities the document should normalize for portability:
    - Site
    - Cell
    - NeighborRelation
    - RCARecord
    - Intuition
    - KPIObservation
    - Alarm
    - Ticket
    - ConfigChange
    - Outage
    - TrafficProfile
    - MobilityTrend
    - SchemaTable / SchemaColumn

- **Backend API and Query Lineage**
  - include an endpoint matrix grouped by function:
    - chat/agent endpoints
    - site selection and metadata endpoints
    - comprehensive site analysis endpoints
    - KPI/time-series endpoints
    - operational endpoints
    - topology endpoints
    - schema endpoints
  - for each important frontend feature, map:
    - UI view/component
    - API endpoint
    - connector method
    - underlying table/query source
  - minimum feature mappings to include:
    - chat direct site navigation and RCA/KPI opens
    - site details
    - comprehensive site payload
    - CQX/subcomponent KPI data
    - daily/hourly/timeline cell KPI data
    - mobility trends
    - outages
    - traffic profile
    - topology/cell topology
    - schema repository refresh/load
  - explicitly capture date-window rules where implemented today:
    - operational data 7-day vs single-day windows
    - outages 48-hour or tab-specific windows
    - KPI day ranges and hourly/timeline conventions
  - query lineage section should reference `backend/database/sql_queries.py` as the source of SQL truth and `backend/database/naavik_db_connector.py` as the execution adapter

- **Portable Reimplementation Guidance**
  - define what another tool must preserve for parity:
    - date-scoped site context
    - map-to-panel-to-chat coordination
    - offender/RCA-aware tab visibility
    - guarded chat action model
    - API/query lineage fidelity
  - define what can be abstracted:
    - rendering library choices
    - charting library substitutions
    - hosting/runtime shell
    - storage/cache mechanisms
  - recommend a target adapter layer:
    - UI shell adapter
    - API client adapter
    - schema/query adapter
    - agent command interpreter

### Interfaces and public contracts to capture in the document
The document must explicitly include these contract categories:

- Chat response envelope:
  - `reply`
  - `components`
  - `ui_commands`

- Comprehensive site payload sections:
  - `topology`
  - `strongest_factors`
  - `rca`
  - `intuitions`
  - `summaries`
  - `outage`
  - `metadata`

- Schema repository payload:
  - `refreshed_at`
  - `tables`
  - per-table `row_count`
  - per-column metadata and samples

- Right-panel tab contract:
  - visibility rules
  - initial tab/default mode behavior
  - required inputs: `usid`, `date`, optional face/band/tech filters

### Files to treat as source-of-truth inputs
Use these as the primary references while drafting the document:
- `frontend/src/components/dashboard/ChatBar.js`, `SiteAnalysis.js`, `site/KPIData.js`, `site/RCAIntegration.js`
- `backend/api/routes.py`, `backend/analysis/chat_handler.py`
- `backend/database/naavik_db_connector.py`, `backend/database/sql_queries.py`, `backend/analysis/schema_repository.py`

## Test Plan
Validate the finished design document against these acceptance checks:

- A new engineer can identify every major Compass surface and its purpose without reading code first.
- A second tool team can reconstruct the chat interface state model and guarded command flow from the document alone.
- A second tool team can recreate the right panel information architecture, including top-level tabs, KPI sub-tabs, chart families, and conditional RCA behavior.
- For each documented major view, the document includes the API endpoint and query/data lineage back to connector/query source.
- The schema repository section explains both how it is built and how chat/agents use it.
- The document distinguishes current Compass behavior from portable recommendations rather than mixing them.
- No major current behavior is undocumented in these areas:
  - chat UI and agent actions
  - comprehensive site payload
  - KPI/RCA/operational/topology panel structure
  - schema repository
  - API/query lineage

## Assumptions
- Deliverable will be both:
  - a repo Markdown document in `docs/`
  - a shorter chat handoff summary
- The document should reflect the current Compass implementation as of April 1, 2026.
- The design should preserve current behavior first, but include a reusable abstraction layer for another tool.
- Backend/query coverage should stop at API contracts and query lineage; full SQL text does not need to be embedded unless a specific feature would be ambiguous without it.
- The document is primarily for implementation handoff, not for product marketing or end-user documentation.
