# Naavik Unified UX — Demo Readiness Audit

Three tiers of gaps to close before this is a confident, no-recovery-needed live demo. Tier 1 must be closed; Tier 2 should be; Tier 3 makes it sing.

The bar for "demo-worth" is **a 15-minute walkthrough where nothing surprises you and at least two moments make the audience lean forward**. We're not there yet — but we're close.

---

## Tier 1 — Demo-Blocking (must fix)

### 1. Demo dataset coverage and freshness
The mirror only contains offender USIDs. If you click any non-offender site on the map, the Summary tab falls back to remote MSSQL and the user waits 10–30 s on a cold path. Likewise, KPI dashboards for non-offender USIDs go to remote.
**Fix:** Either (a) curate a list of 5–10 known-good demo USIDs that are ALL in the mirror and that have rich RCA data, OR (b) widen the mirror filter beyond `chain_of_thought IS NOT NULL` to include high-anomaly non-offenders. **Effort: 1 day.**

### 2. End-to-end smoke before every demo
There is no scripted golden-path walkthrough. Anyone running a demo today is improvising. The risk: an unexpected slow query, a missing data point, or a stale state from a prior demo blows up mid-presentation.
**Fix:** Write a `DEMO_SCRIPT.md` with 6–8 concrete steps (login → market select → map → pick USID 9787 → analyzer → ask "what changed?" → switch to AppGen → build an app). Time each step. Reset state between runs. **Effort: half day.**

### 3. AppGen demo path is unverified
We've built the 6-stage pipeline UI but I haven't seen one full end-to-end run produce a clean, deployable rApp on the current branch. If the AppGen demo is part of the story, this is the highest-risk feature.
**Fix:** Pick ONE canonical prompt ("Increase qRxLevMin when PRB exceeds 80%") and run the pipeline 5 times consecutively. Fix any flakiness. Pin the system prompt + model + temperature so the output is deterministic enough to demo. **Effort: 1–2 days.**

### 4. Loading + error states are inconsistent
The Summary tab shows "Analysing site…" with skeletons; the AI Analyzer shows a spinning Loader2; chat shows just "Reasoning about your request…"; KPI dashboards have their own loader; the map shows nothing. If any one of those takes >5 s in a demo, it looks broken.
**Fix:** Standardize the loading vocabulary: animated copy that changes every ~3 s ("Looking up offenders" → "Fetching cell topology" → "Running cluster comparison") so the audience can see *progress*. Same pattern in chat, analyzer, and Summary. **Effort: 1 day.**

### 5. Error states throw raw stack traces
When a query fails (timeout, malformed SQL, no data) the chat sometimes shows raw axios error text. Not demo-safe.
**Fix:** Audit the error catch blocks in `ChatInterface.tsx` and the V3 orchestrator. Map every error class to a friendly one-liner. Hide the stack. Keep verbose logs server-side. **Effort: half day.**

### 6. Backend startup is slow (60–90 s)
Schema discovery + mirror init + DataDict load run sequentially. If the demo machine boots cold, you wait. If tsx-watch reloads mid-demo, you wait again.
**Fix:** Boot the server 10 min before the demo. (Long-term: parallelize the boot steps and add a `/health/ready` endpoint that returns 503 until everything's warm.) **Effort: workaround free; permanent fix 1 day.**

---

## Tier 2 — Should-have (sharp edges that audiences notice)

### 7. Naavik AppGen + Naavik Provision don't share a visual language with Observe
Observe got the modern generative-UI overhaul (DiagnosisCard, SeverityMeter, TopologyGrid, compact tables). AppGen + Provision still look like the old design — flat tables, plain forms. Visually jarring when the user moves between modules.
**Fix:** Apply the new card pattern (glass surface, gradient accents, hover lift) to the AppGen stage list and the Provision change-request form. **Effort: 2 days.**

### 8. Default-landing-page setting is set-it-and-forget-it, no preview
We added the toggle but the user has no idea what each option looks like. Demos will keep landing on the same screen.
**Fix:** Add a small screenshot thumbnail next to each option (Chat / Observe / AppGen). Persist works but the affordance is invisible. **Effort: half day.**

### 9. "Aha moment" depth chart is shallow
Today, the wow is "the AI runs 10 tools in parallel and gives you a diagnosis card." That's one beat. There's no second beat.
**Fix:** Add **one** of these for variety:
   - **What-if simulator** in the Analyzer — "what if I increase qRxLevMin by 2 dB?" → shows predicted KPI delta.
   - **Drill from card to action** — click a verdict bullet → automation pipeline prefilled.
   - **Comparative analyzer** — side-by-side analysis of two sites.
   **Effort: 2–3 days for any one.**

### 10. Saved dashboards have no seed
First-time user sees an empty Saved Dashboards section. Demos miss the chance to show "look, here are my saved views" without scripting it.
**Fix:** Seed 3–4 named demo dashboards in localStorage on first market-select: "Top 10 Sacramento Offenders", "USID 9787 — full week", "Cluster CASA-047 health". **Effort: half day.**

### 11. Map view doesn't surface market context
The map shows 6,800 sites but doesn't visually communicate "you're looking at Northern California right now." The market chip is in the user menu but invisible in the map.
**Fix:** Add a subtle market label and offender count in the map's top-left corner ("Northern California · 47 offenders today"). **Effort: 2 hours.**

### 12. Operational Info tab still looks like a 2024 table
The new operational data shows alarms/tickets/config/outages/EIM in stacked compact tables. That's fine but it lacks the visual hierarchy of the new Analyzer. Pre-aggregation chips ("3 alarms · 2 tickets · 5 config changes") would help skimming.
**Fix:** Add a stat-row summary tile at the top of each Operational sub-tab. Reuse `stat_row` block. **Effort: half day.**

### 13. No reset-state mechanism between demos
Browser localStorage holds market, theme, saved dashboards, chat history per stream, dummifier state. Between two demos the second one inherits the first's state.
**Fix:** Add a hidden `?demo=reset` URL parameter that clears localStorage and reloads. Or a Settings → "Reset all preferences" button. **Effort: 2 hours.**

### 14. Knowledge stream answers feel un-anchored
"What is qRxLevMin?" returns text — useful but visually plain. Compare to Observe's rich cards.
**Fix:** Build a `kpi_explainer` block (or reuse compact_table) that shows: name, formula, valid range, default, dependent KPIs, similar parameters. **Effort: 1 day.**

### 15. Chat history is local-only and per-session
If the user reloads, history disappears. Demos that rely on "remember when I asked about USID 9787 earlier?" don't work after a reload.
**Fix:** Conversation context already persists server-side (in PG). Wire the sidebar history to read from there so it survives reloads. **Effort: 1 day.**

---

## Tier 3 — Polish (makes it feel premium)

### 16. Empty states are blank screens
"No outages found." Just text. Could be an illustrated empty state.

### 17. No keyboard shortcuts
Power users (and demo personas pretending to be them) expect ⌘K for global search, ⌘/ for chat focus, ⌘B for sidebar collapse.

### 18. No tooltips for icon-only buttons
The sidebar nav is icon-first when collapsed. New users hover and see nothing. Title attrs are inconsistent.

### 19. Animations are inconsistent across views
The Analyzer tab uses hover-lift; the Site Detail panel uses subtle fade; the chat just snaps in. Pick one motion vocabulary and apply it everywhere.

### 20. No "you're on the dashboard" affordance
A subtle breadcrumb or current-view chip in the top bar would orient the user. Some screens have it, others don't.

### 21. Settings page is generic-looking
The Settings tabs are flat forms. No visual differentiation between sections. Compare to Linear or Notion settings UIs.

### 22. No onboarding tour
First-time users get dropped into the app. A 5-step product tour ("This is the chat. This is the map. This is the analyzer.") would help cold demos.

### 23. Toast/notification system is missing
Saved dashboard, ran an automation, mirror finished backfill — no visible feedback. Either toasts or a notification bell.

### 24. Demo Mode could be even more demo-friendly
Currently it just masks USIDs. A "demo mode" could also seed fake-but-realistic site names ("ATT_DEMO_001"), hide internal jargon, and present clean copy.

### 25. Mobile / smaller-screen layouts are untested
Most demos run on the presenter's laptop, but if anyone projects on a 4K screen or zooms in, layouts may break. We never tested below 1280px.

---

## Suggested 1-Week Plan to Reach Demo-Worth

| Day | Focus |
|---|---|
| **Mon** | Tier 1 #1 (demo dataset) + #2 (script) — write DEMO_SCRIPT.md, curate 5 USIDs, smoke-test |
| **Tue** | Tier 1 #3 (AppGen path) — run the pipeline 5× on one canonical prompt, fix flakiness |
| **Wed** | Tier 1 #4 (loading states) + #5 (error states) — standardize loaders and friendly errors |
| **Thu** | Tier 2 #7 (AppGen + Provision visual polish) — apply new card pattern |
| **Fri** | Tier 2 #9 (pick one "aha moment") + dress-rehearsal — full walkthrough at 9 AM, fix what breaks |

After this week you have a demo that you'd let a customer's CTO drive themselves.

---

## What's Already Strong

To balance the audit — these are the things that *do* feel demo-quality today and you should lead with:

- **AI Analyzer tab** — running the full 10-tool deep investigation produces a hero severity card, four verdict sections, and grouped evidence. The animation and density are good. Best part of the demo today.
- **Generative UI in chat** — DiagnosisCard + SeverityMeter + TopologyGrid render with depth that feels premium. The auto-pairing of compact tables is delightful.
- **Map view** — Mapbox with severity color-coding looks professional even before zoom.
- **Stop button** — works, looks polished, removes the "what if I want to cancel?" awkwardness.
- **Multi-stream chat** — switching from Observe to AppGen to Provision and watching prompts/tools adapt is genuinely impressive.
- **Local data mirror** — invisible to the audience but means every site on the offender list opens in <1 s. This is what makes the demo feel real-time vs. demo-time.
- **Theme + sidebar** — clean, Claude-style sidebar with collapsible profile menu is on par with modern SaaS.

Lean on these as the spine of the demo and use the rest as support.
