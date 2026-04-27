# Naavik Unified UX — Backend Production Design + Re-Implementation Plan

Last updated: 2026-04-06

This document is a **design + migration plan** for turning the current `naavik_unified_ux` backend into a production-style service, with a focus on the **Observe** experience.

It intentionally **does not** document AppGen’s internal implementation details, but **does** document how AppGen integrates into the Naavik Frame.

---

## 1) Scope

### In scope
- Observe map + site analysis experience (APIs, data flow, queries).
- Backend architecture for production: modules, layers, validation, auth, caching, observability, jobs.
- Query catalog for Observe (where queries live, what they do, parameters).
- AppGen integration points into the Naavik Frame (token exchange, proxy, registry wiring).

### Out of scope
- AppGen internal logic/agents (beyond the integration surface).
- UI re-design details (frontend-only).

---

## 2) Current Codebase Snapshot (As-Is)

### Server entrypoint
- `backend/src/server.ts`
  - Express app, CORS, JSON parsing, request logging, error handling.
  - JWT auth middleware applied to most `/api/*` routes.
  - In-memory caching via `backend/src/utils/cache.ts` (NodeCache).

### Two data sources (important)

The backend currently uses two distinct DB access patterns:

1) **Local Postgres pool** (`backend/src/config/database.ts` → `pool`)
   - Used by demo-style models like `backend/src/models/site.model.ts`, `backend/src/models/kpi.model.ts`, etc.

2) **Remote “Compass” connector** (`backend/src/services/naavik-db-connector.service.ts`)
   - Used by “Compass-style” models:
     - `backend/src/models/compass.model.ts`
     - `backend/src/models/siteAnalysis.model.ts`
   - These queries look like SQL Server / Synapse style SQL:
     - `TOP N`, `WITH (NOLOCK)`, `DATEADD`, `GETDATE()`, `TRY_CAST`

**Observe currently leans heavily on the Compass-style remote connector.**

### Auth
- `backend/src/middleware/auth.ts` (JWT)
- Most Observe endpoints are under `/api/sites/*` and `/api/compass/*` and require auth.

### Caching
- `backend/src/utils/cache.ts` provides `cacheOrFetch(key, fn, ttlSeconds?)`.
- Used widely by `/api/compass/*` endpoints.

### ID mapping (“dummy” site IDs vs real USIDs)
- `backend/src/services/site-id-mapper.service.ts`
  - Maps between UI tokens and the real USID used by Compass tables.
  - Used by Compass models and some Observe routes.

---

## 3) Observe Product Flows (As-Is)

This is the “happy path” of Observe in the Unified UX frontend, and the APIs it calls.

### 3.1 Map load (market view)
- `frontend/src/components/MapView.tsx`
  - Loads sites via: `GET /api/compass/site-topology?date=YYYY-MM-DD`
  - Loads sectors via: `GET /api/compass/cell-sectors?date=YYYY-MM-DD`
  - Loads top offenders via: `GET /api/compass/offenders?date=YYYY-MM-DD`
  - Loads market summary: `GET /api/compass/market/dashboard`

### 3.2 Select a site (open analysis tile)
- `frontend/src/components/ObserveSiteAnalysisTile.tsx`
  - Comprehensive analysis: `GET /api/sites/:siteId/analysis/comprehensive?dateId=YYYY-MM-DD`
  - Cell topology: `GET /api/sites/:siteId/cell-topology?dateId=YYYY-MM-DD`
  - Nodes list: `GET /api/compass/site/:usid/nodes?date=YYYY-MM-DD` (via Compass routes)
  - Operational workbench: `GET /api/sites/:siteId/operational-info?dateId=YYYY-MM-DD&limit=...`

### 3.3 Site KPIs (charts)
- CQX totals/impact (Compass tables):
  - `GET /api/compass/site/:usid/subcomponent-data?date=...&days=...` (value series)
  - `GET /api/compass/site/:usid/subcomponent-impact?date=...&days=...` (impact series)
- Other KPI pulls:
  - `GET /api/sites/:siteId/cell-kpis?...`
  - `GET /api/sites/:siteId/traffic-profile?...`
  - `GET /api/sites/:siteId/mobility-trends?...`
  - `GET /api/sites/:siteId/outages?...`

### 3.4 Map overlays (site-level outage / overutilization sets)
- `GET /api/sites/layers/status?dateId=YYYY-MM-DD`

### 3.5 “Aira” map chat → UI actions
- Natural language → actions:
  - `POST /api/intent/ui-command`
  - Returns actions like `MAP_FOCUS_SITE`, `SHOW_SITE_STATS`, `EXPLAIN_RCA`

---

## 4) Production Backend Target Architecture (To-Be)

### 4.1 Goals
- Clear separation of layers (routing/validation → domain services → repositories).
- One “Observe” API surface with stable contracts (OpenAPI).
- Parameterized queries (avoid raw string interpolation).
- Strong typing (DTOs), consistent error envelopes, request IDs.
- Scalable caching (Redis) + precomputation jobs for heavy reads.
- Observability: structured logs, tracing, metrics.

### 4.2 Proposed module boundaries

**API layer**
- Controllers/routers only: parse input, validate, call service, format response.
- Joi/Zod validation (you already use `joi` in deps).

**Domain / service layer**
- Use-case services:
  - `ObserveMapService` (site topology, sectors, offenders, map overlay sets)
  - `SiteAnalysisService` (RCA payload normalization, evidence formatting)
  - `KpiService` (CQX, traffic profile, kpi time series)
  - `OperationalContextService` (alarms/tickets/config/outages/eim bundles)

**Repository layer**
- `TelemetryWarehouseRepository` interface with two implementations:
  - `CompassSqlServerRepository` (current remote connector)
  - `PostgresRepository` (local data)
- The rest of the system depends only on the interface.

**Infrastructure**
- DB pools, secrets/config, Redis, job runner, OpenAI client(s).

### 4.3 Data source strategy

Decide and standardize:

Option A (recommended): **Treat Compass warehouse as source of truth** for Observe.
- Keep Postgres for platform metadata, auth, registry, caching, user feedback, etc.

Option B: **Ingest Compass tables into Postgres** (materialized) and query locally.
- Higher work; better control and query performance; fewer vendor-specific SQL constructs.

### 4.4 Caching strategy (production)
- Replace NodeCache with Redis for:
  - Map site-topology per date
  - Sector geometry per date
  - Offenders per date
  - Site analysis payload per (usid, date)
- Keep short TTL + cache stampede protection.

### 4.5 Security & correctness improvements (production must-haves)
- Eliminate SQL string interpolation for any user-provided tokens:
  - Currently multiple Compass/analysis queries interpolate `siteId`, `dateId`.
  - Production plan: parameterized queries + strict input validation.
- Centralize “usid/site token resolution”:
  - `resolveRealUsid()` should validate token formats and return a canonical USID string.
- Add per-route input constraints:
  - `dateId` must be `YYYY-MM-DD`
  - `days` bounded
  - `kpiNames` allowlist or pattern check

### 4.6 API contracts (OpenAPI)
- Add `openapi.yaml` for Observe endpoints, generated types for frontend.
- Ensure consistent envelope:
  - `{ success: boolean, data?: T, error?: { code, message, details }, timestamp }`

---

## 5) AppGen Integration into the Naavik Frame (As-Is)

### 5.1 “App Registry” + Frame navigation
- Backend registry seed: `backend/src/services/platform-registry.service.ts`
  - Includes an `appgen` entry with `chatStream: 'appgen'`.
- Frontend registry: `frontend/src/platform/appRegistry.ts`
- Frame container: `frontend/src/platform/AppSlot.tsx`
  - Loads internal apps via `LAZY_COMPONENTS[internalKey]`
  - Supports federated modules and iframes (future).

### 5.2 AppGen API proxy + token exchange
- Token exchange endpoint (Naavik-authenticated → AppGen token):
  - `GET /api/appgen/session-token`
  - Implemented in `backend/src/routes/appgen-proxy.routes.ts`
  - Uses configured AppGen admin credentials to obtain an AppGen JWT.
- Proxy:
  - `app.use('/appgen-api', appgenProxy)` in `backend/src/server.ts`
  - Proxies `/appgen-api/*` → `${APPGEN_API_URL}/api/*`

### 5.3 Unified AppGen agent endpoints (inside this backend)
- `backend/src/routes/appgen-agent.routes.ts`
  - `POST /api/appgen/agent/v1/chat`
  - `GET  /api/appgen/agent/v1/state/:threadId`
  - `POST /api/appgen/agent/v1/generate`
  - `POST /api/appgen/agent/v1/package-rapp`
  - `POST /api/appgen/agent/v1/reset`

### 5.4 Chat integration
- Chat streams are handled in:
  - `frontend/src/context/ChatContext.tsx`
  - `frontend/src/components/ChatInterface.tsx`
- The orchestration layer can emit “choice buttons” like “Open Naavik AppGen” to switch the active app/stream.

---

## 6) Re-Implementation Plan (Backend)

### Phase 0 — Baseline & guardrails (1–2 weeks)
- Add OpenAPI skeleton for Observe endpoints.
- Add request validation for all Observe routes (date formats, bounds, allowlists).
- Centralize USID/token normalization & mapping into a single service.
- Add integration tests for critical endpoints with mocked DB adapters.

### Phase 1 — Repository abstraction (2–4 weeks)
- Introduce `TelemetryWarehouseRepository` and migrate:
  - `CompassModel` queries into repository methods (parameterized).
  - `SiteAnalysisModel` queries into repository methods (parameterized).
- Keep current endpoints stable, change internals only.

### Phase 2 — Caching and precomputation (2–4 weeks)
- Replace NodeCache with Redis.
- Add background jobs:
  - Daily precompute of `site-topology` and `cell-sectors` caches per date.
  - Offender list precompute per date.

### Phase 3 — Production hardening (ongoing)
- Observability (structured logs + trace IDs).
- Better error taxonomy and safe error responses.
- Auth integration with real IdP; scoped permissions.
- Replace admin-token AppGen exchange with user-scoped delegation (if required).

---

## 7) Where the Observe Queries Live

See `docs/OBSERVE_BACKEND_QUERY_CATALOG.md` for a complete catalog of the current Observe SQL queries, grouped by endpoint/function.

