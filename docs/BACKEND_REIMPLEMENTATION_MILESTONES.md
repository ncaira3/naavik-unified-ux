# Unified UX Backend — Production Re-Implementation Milestones

Last updated: 2026-04-06

This is a practical checklist for building a production backend for the Unified UX, focusing on Observe.

---

## Milestone 1 — Contract-first Observe API

- [ ] Create `openapi/observe.yaml` covering all Observe endpoints used by `frontend/src/services/api.ts`
- [ ] Add request validation for every Observe route (date formats, bounds, allowlists)
- [ ] Standardize response envelope + error codes across `/api/sites` + `/api/compass`
- [ ] Add request IDs (propagate `x-request-id` if present, generate otherwise)

## Milestone 2 — Repository layer + parameterized queries

- [ ] Introduce `TelemetryWarehouseRepository` interface
- [ ] Move Compass SQL into repository methods (no string interpolation)
- [ ] Move SiteAnalysis SQL into repository methods (no string interpolation)
- [ ] Centralize `resolveRealUsid()` logic + token validation
- [ ] Add unit tests for token resolution + query parameter handling

## Milestone 3 — Caching & precompute

- [ ] Replace NodeCache with Redis
- [ ] Add cache keys + TTL policy per endpoint
- [ ] Prevent stampede (single-flight per key)
- [ ] Add daily precompute jobs:
  - [ ] `site-topology` per day
  - [ ] `cell-sectors` per day
  - [ ] `offenders` per day

## Milestone 4 — Observability & operations

- [ ] Structured JSON logs with correlation IDs
- [ ] Metrics: request latency, error rate, cache hit rate, DB timings
- [ ] Tracing (OpenTelemetry)
- [ ] Health endpoints:
  - [ ] `/health` (liveness)
  - [ ] `/ready` (readiness: DB, Redis, remote warehouse)

## Milestone 5 — Security hardening

- [ ] AuthN: integrate with production identity provider
- [ ] AuthZ: per-role/per-tenant access rules
- [ ] Rate limiting (per user / per IP) for expensive endpoints
- [ ] Audit logging for:
  - [ ] RCA explain requests
  - [ ] User feedback writes
  - [ ] Provisioning actions

## Milestone 6 — AppGen integration hardening

- [ ] Replace “admin user token exchange” with user-scoped auth or backend delegation
- [ ] Proxy policy: header allowlist, payload limits, timeout policy, retries
- [ ] Document AppGen SLO dependencies and fallback behavior

