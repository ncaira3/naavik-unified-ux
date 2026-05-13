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

Do **Part A this week** so the demo stops hallucinating. Schedule **Part B starting next week** as a 2–3 sprint commit; it's a real refactor and shouldn't be rushed.

If you want, I can start Part A1 (the pre-flight gate) right now — it's the single highest-leverage change against the bug in your screenshot.
