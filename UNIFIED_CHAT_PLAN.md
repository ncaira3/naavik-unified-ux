# Unified Chat Plan — Schema-Constrained, Conversational, One Agent Everywhere

## What's broken today (the UL RSSI screenshot)

User typed: *"Do you have UL RSSI KPI?"*

What happened on the backend:
1. The V3 orchestrator picked the `query_data` tool with the user's phrase as the input.
2. `query_data` called the `SQLGeneratorService` which asks `gpt-4` to write SQL.
3. The LLM generated `SELECT TOP 1 kpi_name FROM intermediate_kpi_table WHERE kpi_name = 'UL_RSSI' AND CAST(DATE_ID AS DATE) = C` — a meaningless query that selects the *literal string* `'UL_RSSI'` if it exists. (Note the truncated date predicate `= C`, which is itself a bug.)
4. The result was a single text row.
5. The chart generator treated the row as a single numeric value `1` and plotted it.
6. The chat-bubble text claimed *"I've retrieved the UL RSSI KPI data"* — confident hallucination.

Three independent guards failed:
- **Pre-flight schema check** — the orchestrator never asked "is `UL_RSSI` a real KPI?" before invoking the SQL generator. We have `dbSchemaRef.getKpiNames()` and a 16k-entry DataDict, but they aren't gating the data path.
- **SQL sanity check** — the generator emitted a query that returns a string row but the validator (`SQLGeneratorService.validateSQL`) doesn't check that the SELECT list looks like numeric/time-series data appropriate for a chart.
- **Result sanity check** — `chart-generator.service.ts` rendered a single text row as a single bar. It should have flagged "this doesn't look chart-able."

The behavior we wanted: *"I don't have a KPI named `UL RSSI` exactly, but the closest match in the schema is `UL_RSSI` (Uplink RSSI). Want me to plot that?"* If yes → ask for a site → then execute a real query.

This isn't one bug; it's the **conversational layer being absent**. The agent treats every user message as an immediate execution intent.

---

## Goals

1. **Schema-constrained RAG** — no tool that reads from the DB executes until the KPI/parameter/site/date arguments are validated against the live schema + DataDict.
2. **Conversational disambiguation** — when a slot is fuzzy, the agent asks. When a slot is missing, the agent prompts for it. The user can answer with a chip click, not a re-typed sentence.
3. **One chat agent everywhere** — the AppGen chat's interaction model (slot-filling, clarification, scaffold confirmation, streaming progress) is brought to the universal chat, the Observe chat, and the MapChatBar.

---

## Part A — Stop the Hallucination (1–2 days)

This is the smaller, surgical change. It doesn't change the UI; it adds a pre-flight gate to the data path.

### A.1 — Pre-flight KPI/parameter validator

Insert a new orchestrator step that runs **before** any tool that reads from the schema is invoked.

**Where:** new helper `validateSchemaReferences()` invoked inside `agent-orchestrator-v3.service.ts` after the LLM emits a tool call but before the tool executes.

**What it checks:**
- For `query_data`, `show_kpi_dashboard`, `get_site_kpis`, `get_hourly_trends`: extract any KPI names from the args/SQL → check against `dbSchemaRef.getKpiNames()` (live) and `dataDictResolver` (16k catalog).
- For tools taking a `usid` arg: validate the USID is in `topology_cache_sites` or the mirror.
- For tools taking `date` / `startDate` / `endDate`: validate format and bound to the available date range.

**On mismatch:**
- Tool execution is suppressed.
- The orchestrator emits a `chips` UI block with the top-3 closest matches (via fuzzy match) plus a "neither — clarify" option.
- The orchestrator returns control to the user with an assistant message like: *"I don't recognize `UL RSSI` exactly. Did you mean one of these?"*
- A `pendingTool` is persisted in conversation context so the user's next reply (a chip click or a confirmation) resumes the tool call with the corrected args.

```ts
// New shape returned by the gate
interface GateOutcome {
  kind: 'ok'                                // proceed
       | 'clarify'                          // ambiguous — ask user
       | 'missing'                          // required slot missing — ask user
       | 'unknown';                         // hard reject — no match found
  ambiguousArg?: string;                    // e.g. "kpiName"
  candidates?: Array<{ value: string; label: string; confidence: number }>;
}
```

### A.2 — Stricter SQL generator output

Update `SQLGeneratorService.generateSQL`:

- After SQL is generated, parse it (with a real SQL parser like `node-sql-parser`) and enforce:
  - At least one column in the SELECT must be a `kpi_value`, `COUNT(*)`, `AVG(...)`, etc. — i.e. something a chart can plot.
  - Any literal `kpi_name = 'X'` in the WHERE clause is validated against the live KPI catalog. Reject if not found, return an `unknown_kpi` error to the orchestrator.
  - Reject queries that select only schema/metadata columns (`kpi_name`, `cell_name`, `USID`) without a numeric measure unless the user explicitly asked for a list.

### A.3 — Result sanity check before rendering

In `chart-generator.service.ts`, before producing an `insight_chart`:
- If rows = 0 → don't emit a chart, emit a `callout` saying "No data found for your query."
- If rows = 1 and value is non-numeric → don't emit a chart.
- If all rows have identical x-axis values → don't emit a chart.
- Always emit a `compact_table` alongside the chart so the user sees the raw rows.

### A.4 — Tooling

Add a `/api/admin/chat/validate?q=...` endpoint that runs the gate without executing anything — useful for debugging "would this query hallucinate?"

---

## Part B — Unify the Chat (5–7 days)

The AppGen chat's strength is its **interaction model**, not its visual chrome. We extract the interaction patterns, generalize them, and have all three chat surfaces use the same one.

### B.1 — Audit: what makes the AppGen chat better?

After reading `frontend/src/components/AppGen/components/` and `backend/src/services/conversational-builder.service.ts`, the AppGen chat does six things the others don't:

1. **Slot-based intent model.** The agent maintains a structured slot map (e.g. `{ targetKPI: null, threshold: null, action: null }`). It never "executes" until required slots are filled.
2. **Inline clarifying questions with chip answers.** The user can click a chip to fill a slot instead of typing a sentence. Slot value gets normalised, not parsed again.
3. **Streaming progress trail.** Each agent step ("Planning... → Drafting code... → Auditing...") streams as it happens. The user always knows what's in flight.
4. **Confirmation gates.** Before any destructive or expensive operation (scaffold creation, OSS push), the agent shows a confirm card with "Approve" / "Edit" / "Cancel" buttons.
5. **Memory of the running plan.** As slots fill, the chat shows the current plan card at the top — the user sees what's been captured.
6. **Resumability.** If the user reloads, the conversation state (slots, current stage, pending confirmations) survives because it's persisted server-side.

The universal chat, Observe chat, and MapChatBar have **none** of these patterns. They treat every user message as a fresh intent.

### B.2 — Define a generic interaction model

Extract a `ConversationalAgent` abstraction with these primitives:

| Primitive | Description |
|---|---|
| **Intent** | A typed goal (e.g. `KPIChartIntent`, `SiteAnalysisIntent`, `AppBuildIntent`). |
| **Slots** | Required + optional inputs declared per intent. Each slot has a type, validator, and resolver. |
| **Slot resolver** | Pure function `(userInput, candidates) → resolved | clarify | reject`. KPI resolvers use `dbSchemaRef + dataDictResolver`. Site resolvers use the topology cache. Date resolvers parse natural language. |
| **Confirmation step** | An optional pre-execute gate that renders a confirm card. |
| **Action** | The final tool call(s) that produce UI blocks. |
| **State** | Persisted server-side per (threadId, intent). |

Every chat — universal, Observe, Map, AppGen — gets the same lifecycle:

```
user message
   → intent classifier picks Intent
   → load State for (thread, intent)
   → resolve slots from user message
   → if any slot is ambiguous → emit chips, wait
   → if any slot is missing → emit prompt, wait
   → if all slots resolved & not yet confirmed → emit confirm card, wait
   → run Action → emit UI blocks
   → update State; clear pending if Intent complete
```

### B.3 — Backend changes

1. New file `backend/src/services/conversational-agent.service.ts`:
   - Generic `ConversationalAgent` class that takes an `Intent` registry.
   - Persists per-thread per-intent state in PG (extend `conversation_context` table).

2. New file `backend/src/services/intents/`:
   - `kpi-chart.intent.ts` — slots: site, kpi, timeframe, daysBack. Resolvers wire to `dbSchemaRef` + topology cache + DataDict.
   - `site-analysis.intent.ts` — slots: site, date. Resolvers same.
   - `kpi-knowledge.intent.ts` — slots: kpi (resolved via DataDict). Action: render `kpi_explainer` card.
   - `app-build.intent.ts` — slots: target_kpi, trigger, action. Wraps the existing AppGen pipeline.
   - `change-parameter.intent.ts` — slots: site, parameter, old, new. Wraps Control Agent.

3. Refactor `agent-orchestrator-v3.service.ts`:
   - The V3 tool-calling loop stays but gets wrapped: before invoking a tool, the orchestrator routes through the matching Intent's slot resolver.
   - If the intent classifier picks `kpi_chart` for "show me drop rate for 9787", the slot resolver runs first → if all slots resolved → V3 invokes `show_kpi_dashboard` with **validated, normalised** args.

4. New UI block types:
   - `slot_prompt` — renders "I need: [field]" with optional chips.
   - `clarify_chips` — top-3 candidates with confidence indicators.
   - `confirm_card` — preview of the pending action with Approve / Edit buttons.
   - `plan_card` — running plan summary (which slots are filled, which are pending).

### B.4 — Frontend changes

1. Extract `frontend/src/components/Chat/UnifiedChat.tsx`:
   - Composer (input + Send/Stop button)
   - Message thread renderer
   - Plan card pinned at the top showing current slot state
   - Streaming progress strip ("Resolving KPI..." → "Fetching data...")
   - Renderer for the new `slot_prompt`, `clarify_chips`, `confirm_card`, `plan_card` blocks

2. Replace three places:
   - `ChatInterface.tsx`'s composer → `<UnifiedChat stream="universal" />`
   - `MapChatBar.tsx` → `<UnifiedChat stream="observability" preFillSite={selectedSite} />`
   - `AppGen/components/Chat*.tsx` → `<UnifiedChat stream="appgen" projectId={projectId} />`

3. The AppGen chat keeps its current 6-stage pipeline as a sub-state inside the `app-build` Intent. Visually nothing regresses.

### B.5 — Schema-constrained slot resolvers

The single most important resolver is `resolveKpiSlot`:

```ts
async function resolveKpiSlot(input: string): Promise<SlotResolution> {
  const canonical = input.toUpperCase().replace(/\s+/g, '_');

  // 1. Exact match against live schema (KPI names actually in the DB right now)
  const liveKpis = dbSchemaRef.getKpiNames();
  if (liveKpis.includes(canonical)) {
    return { kind: 'resolved', value: canonical, source: 'db-schema' };
  }

  // 2. Fuzzy match against live schema (catches "UL RSSI" → "UL_RSSI")
  const closeFromDB = fuzzyMatchKpiNames(canonical, liveKpis, { minScore: 0.7 });
  if (closeFromDB.length === 1 && closeFromDB[0].score >= 0.95) {
    return { kind: 'resolved', value: closeFromDB[0].name, source: 'db-schema-fuzzy' };
  }
  if (closeFromDB.length >= 1) {
    return { kind: 'clarify', candidates: closeFromDB.slice(0, 3) };
  }

  // 3. Fall back to DataDict catalog (16k Ericsson params — may not be in the DB
  //    but is a valid name the user might mean)
  const catalog = dataDictResolver.fuzzyMatch(canonical, { limit: 3, minScore: 0.6 });
  if (catalog.length) {
    return {
      kind: 'clarify',
      candidates: catalog.map((c) => ({
        value: c.paramName,
        label: c.description || c.paramName,
        confidence: c.score,
        note: 'parameter, not a KPI — limited charting',
      })),
    };
  }

  // 4. No match
  return { kind: 'unknown', input };
}
```

Same pattern for `resolveSiteSlot` (against `topology_cache_sites`), `resolveDateSlot` (against the live date range), etc.

---

## Part C — Concrete walkthrough of the fixed behavior

**User**: "Do you have UL RSSI KPI?"

**System**:
1. Intent classifier → `kpi_knowledge`.
2. Slot `kpi` is mentioned but ambiguous (`UL RSSI` has no exact match).
3. `resolveKpiSlot('UL RSSI')` returns `clarify` with candidates `[UL_RSSI (0.96), UL_RSRP (0.62), UL_RSCP (0.55)]`.
4. Orchestrator emits a `clarify_chips` block:
   > **I don't have a KPI named `UL RSSI` exactly. Did you mean:**
   > • `UL_RSSI` — Uplink Received Signal Strength Indicator *(96% match)*
   > • `UL_RSRP` — Uplink Reference Signal Received Power *(62% match)*
   > • Neither, let me clarify

**User clicks `UL_RSSI`.**

5. Slot is filled. Intent `kpi_knowledge` has no other required slots → action runs: render a `kpi_explainer` card with definition, range, default, and a small inline chart of recent values.
6. Plan card at top updates: `✓ kpi: UL_RSSI`.

**Total round-trips:** 2 (one clarification, one resolution). No hallucination.

---

## Part F — Query Cost Gating (the 41-second problem)

A second hallucination-adjacent failure mode is the *expensive* successful query. Example from the chat:

> *"show me UL RSSI"* → ran `SELECT TOP 50 CAST(DATE_ID AS DATE) as date, cell_name, AVG(kpi_value) as avg_ul_rssi FROM intermediate_kpi_table WITH (NOLOCK)` — **41,159 ms**, 50 rows from 50 unrelated cells across the entire network. No `USID` filter. The user got a chart, but it's noise — 50 random cells averaged together.

Two things broke at once:
1. **Unbounded query** — no `USID` filter, so the engine scanned the full table.
2. **No cost feedback to the user** — they stared at a spinner for 41 seconds with no signal that this was expensive or that they could have constrained it.

The user shouldn't have to guess. The agent should refuse, warn, or constrain *before* hitting the DB.

### F.1 — Cardinality + cost estimator

New service `backend/src/services/query-cost-estimator.service.ts`. Given a parsed SQL query, it returns:

```ts
interface CostEstimate {
  estimatedRows: number;       // rows scanned (not returned)
  estimatedMs: number;         // expected wall-clock
  warningLevel: 'green' | 'yellow' | 'red';
  reasons: string[];           // why it's expensive
  suggestions: string[];       // ways to bound it
}
```

Heuristics:
- Look up table cardinality from the mirror (`SELECT reltuples FROM pg_class` for local; cached counts for remote).
- Detect missing required filters per table:
  - `intermediate_kpi_table` → must have `USID` AND (date range ≤ 90 days OR `kpi_name` filter).
  - `hourly_intermediate_kpis_table` → must have `USID` AND date range ≤ 7 days.
  - `subcomponent_table` → must have `USID` OR `DATE_ID` (single date).
  - `site_table` → must have `USID` OR `DATE_ID`.
- Estimate scan size: `(table_rows × selectivity_factor)`. Selectivity factors per filter type (USID = 0.0001, date = 0.03/day, kpi_name = 0.02).
- Estimate ms: `~1 ms per 1000 rows for index-backed scans, ~50 ms per 1000 rows for full scans`.

Tiers:
- 🟢 **green** (≤ 2 s, ≤ 10k rows scanned) — execute silently.
- 🟡 **yellow** (2–15 s OR ≤ 100k rows) — execute but surface "Took X seconds, scanned ~Y rows. Add a filter to make this faster next time" as a small footnote on the result.
- 🔴 **red** (> 15 s OR > 100k rows OR missing required filter) — DO NOT execute. Emit a `cost_warning` UI block with the reasons + suggested constraints.

### F.2 — `cost_warning` UI block

A new generative UI block that renders the cost concern as a small card with action chips:

```
┌─────────────────────────────────────────────────────────┐
│ ⚠ This query might be expensive                          │
│                                                          │
│ I'd be scanning ~3.2M rows across 6,806 sites.           │
│ Estimated time: ~45 seconds.                             │
│                                                          │
│ Quick fixes:                                             │
│ [ Pick a site ]  [ Last 7 days ]  [ Top 50 offenders ]  │
│ [ Run anyway ]  [ Cancel ]                              │
└─────────────────────────────────────────────────────────┘
```

The chips emit pre-filled follow-up prompts (or set the `force_unbounded: true` flag for "Run anyway"). The conversation pauses until the user picks one.

### F.3 — Required-filter enforcement in the SQL gate

Update `SQLGeneratorService.validateSQL` to detect missing required filters per table and reject the query before it leaves the backend:

```ts
const REQUIRED_FILTERS: Record<string, string[]> = {
  intermediate_kpi_table: ['USID'],
  hourly_intermediate_kpis_table: ['USID', 'DATE_ID'],
  subcomponent_table: ['USID', 'DATE_ID'],
  configuration_parameters_table: ['USID'],
  outage_table: ['USID', 'DATE_ID'],
};
```

When a required filter is missing AND the user didn't explicitly ask for "all sites / entire network", the validator returns `unbounded` → the orchestrator emits the `cost_warning` block.

### F.4 — Live progress for queries that ARE expected to be slow

Even with cost gating, some queries legitimately take 5–30 s (e.g. a 7-day hourly trend across multiple cells). Instead of a vague spinner:

1. The tool emits an `execution_status` UI block before executing.
2. The block streams updates: "Resolving KPI → Validating filters → Running query (8s elapsed of ~12s estimated) → Aggregating results".
3. If the actual time exceeds 2× the estimate, the status flips to "Taking longer than expected" with a Cancel button.

### F.5 — Auto-bound defaults at the intent layer

For each Intent (Part B), define a `defaultBounds` function that fills in sensible bounds when the user didn't specify any:

- `KPIChartIntent.defaultBounds()`: site = required (no default), date range = last 30 days, daysBack = 30 daily / 48h hourly.
- `SiteAnalysisIntent.defaultBounds()`: date = today − 3.
- `WorstOffendersIntent.defaultBounds()`: date = today − 3, limit = 50.

If a required slot has no default (like `site` for `KPIChartIntent`), the slot resolver asks. If a slot has a default, the agent uses it and **shows it in the plan card** so the user knows what assumption was made.

### F.6 — Walk-through of the fixed UL_RSSI flow with cost gating

**User:** *"show me UL RSSI"*

1. Intent classifier picks `kpi_chart`.
2. Slot resolver: `kpi=UL_RSSI` (resolved after clarification chip), `site=null`, `timeframe=daily`, `daysBack=30 (default)`.
3. Required slot `site` is null → emit `slot_prompt`: *"Which site? Pick from the top 5 offenders or search:"* + chips.

**User clicks USID 9787.**

4. Slots complete: `kpi=UL_RSSI`, `site=9787`, `daysBack=30`.
5. Cost estimator runs against the synthesized query (USID filter + 30 day range + kpi_name filter on `intermediate_kpi_table`): estimated 90 rows, 80 ms. 🟢 green → execute silently.
6. Plan card pinned: `✓ kpi: UL_RSSI · ✓ site: 9787 · ✓ window: 30 days (default)`.
7. Chart renders in under 1 second showing UL_RSSI daily for USID 9787 across its cells.

**Compare to today:** the user gets a 41-second wait, no warning, a chart of 50 unrelated cells, and no idea what went wrong.

### F.7 — Phase + effort additions to Part E

| Phase | Scope | Duration | Risk |
|---|---|---|---|
| **F1** | `query-cost-estimator.service.ts` with cardinality + heuristics | 1 day | Low |
| **F2** | Required-filter enforcement in `SQLGeneratorService.validateSQL` | half day | Low |
| **F3** | `cost_warning` UI block (frontend + type) | half day | Low |
| **F4** | Live `execution_status` streaming for slow queries | 1 day | Med (needs streaming infra) |
| **F5** | `defaultBounds` per intent (depends on Part B intents existing) | half day | Low — bolt-on to B2 |

Total new work: ~3.5 days, **most of which lands in the same A-phase window so demos in week 1 already have cost gating.**

### F.8 — Telemetry to validate this is working

Add a `query_cost_log` table in PG capturing:
- threadId, intent, generated SQL, estimated ms, actual ms, scanned rows, tier (green/yellow/red), user action (executed / cancelled / refined).

Use it to tune the heuristics weekly. The first week's data will show where the estimator is over- or under-estimating.

---

## Part D — Risks and open decisions

1. **Performance:** every chat turn now runs the slot resolver before any LLM. The resolver hits two in-memory indexes (DataDict + schema names) — ~5 ms. Acceptable.

2. **The V2 chat:** today's universal chat has V2 fallback for non-V3 users. The unified agent should obsolete V2. Decision needed: rip V2 out, or keep it dual-tracked for one release?

3. **AppGen migration risk:** the existing AppGen chat is the only one that works well today. Moving it last (after the unified shell is proven on universal + Observe + Map) minimizes regression risk.

4. **Intent classifier scope creep:** if we keep adding intents, the classifier becomes brittle. Cap the registry at ~10 well-defined intents; everything else falls through to "free-form chat" (current V3 behavior).

5. **State growth:** per-thread per-intent state in PG. With ~3k threads/day, we're looking at modest growth. Add a 30-day TTL on conversation_context rows.

6. **DataDict freshness:** today the catalog is loaded from a static JSON at startup. If telco_RAN updates the dictionary, we don't see it until restart. Decision: hot-reload on disk change, or accept the staleness?

---

## Part E — Phased delivery

| Phase | Scope | Duration | Risk |
|---|---|---|---|
| **A1** | Pre-flight KPI/parameter gate in V3 orchestrator | 1 day | Low — additive |
| **A2** | SQL generator output validator | 1 day | Low |
| **A3** | Chart-generator sanity check | half day | Low |
| **B1** | Generic `ConversationalAgent` + intent registry | 2 days | Med — touches core |
| **B2** | 3 first intents (`kpi_chart`, `site_analysis`, `kpi_knowledge`) | 2 days | Med |
| **B3** | `UnifiedChat.tsx` shell + new UI block types | 2 days | Med |
| **B4** | Wire `UnifiedChat` into universal chat + MapChatBar | 1 day | Low |
| **B5** | Wire `UnifiedChat` into AppGen (replace existing) | 2 days | High — most regression-prone |
| **B6** | Persistent conversation state in PG (per-thread per-intent) | 1 day | Low |

Total: ~12–13 working days for a clean v1. Part A alone (~2.5 days) stops the hallucination — if that's all you ship before the demo, the demo is already safer.

---

## Recommendation

Do **Part A + Part F this week** so the demo stops hallucinating *and* stops surprising the user with 41-second silent scans. Schedule **Part B starting next week** as a 2–3 sprint commit; it's a real refactor and shouldn't be rushed.

The week-1 bundle (Part A + Part F):
- A1 — pre-flight schema gate (1d)
- A2 — SQL output validator (1d)
- A3 — chart-generator sanity check (½d)
- F1 — cost estimator (1d)
- F2 — required-filter enforcement (½d)
- F3 — `cost_warning` UI block (½d)

≈ **4.5 days of work** that, on their own, would have prevented both the "fake UL_RSSI bar" hallucination and the "41-second hidden scan" bug from your two screenshots. UI of every chat stays unchanged for week 1 — these are backend-and-block-type changes only.

If you want, I can start with **F2 + F1 + A1** as a coordinated push — those three together would have stopped both your bug screenshots cold.
