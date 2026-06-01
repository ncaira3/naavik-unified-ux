# A2A Demo Flow

How to demonstrate Naavik's A2A integration end-to-end in under 3 minutes.

## What you'll show

Naavik discovers a **second agent** running on a separate port, fetches its
**Agent Card**, lists its **skills**, and **delegates tasks** to it from
natural-language chat. The remote agent is a real, separate process — not
mocked inside Naavik.

The demo agent (`Naavik Companion Agent`) exposes three ops-flavoured skills:
- `summarize-incident` — convert free-text incident reports to structured form
- `lookup-runbook` — return the on-call runbook for an RCA category
- `draft-escalation` — produce a ready-to-send escalation email

These are deliberately **process-of-work** skills (not network-data skills) so
the demo shows clear complementarity with Naavik's own tools rather than
overlap.

## Prereqs

- Naavik backend + frontend running as usual.
- Two free terminals.

## Step 1 — Start the Companion Agent

In a new terminal:

```bash
cd backend
npm run demo:a2a
```

You should see:
```
[a2a-companion] listening on http://0.0.0.0:9555
[a2a-companion] Agent Card: http://0.0.0.0:9555/.well-known/agent.json
[a2a-companion] Skills: summarize-incident, lookup-runbook, draft-escalation
```

(Optional) Verify discovery works:
```bash
curl -s http://localhost:9555/.well-known/agent.json | jq .
```

## Step 2 — Add the agent in Naavik

1. Open Naavik → **Settings → Integrations → A2A agents**.
2. Click **Add A2A agent**.
3. Fill in:
   - **Name:** `companion`
   - **URL:** `http://localhost:9555`
   - **Auth method:** `none`
4. Click **Save**.

The agent row should appear with a green **Connected** badge within a couple
seconds.

5. Click the row to expand. You'll see three discovered skills:
   - `a2a__companion__summarize-incident`
   - `a2a__companion__lookup-runbook`
   - `a2a__companion__draft-escalation`

**Talking point:** *"Naavik fetched the Agent Card from `/.well-known/agent.json`,
read the skills declaration, and registered each one as a callable tool. The
LLM will discover these on its next chat turn — no Naavik code change."*

## Step 3 — Delegate from chat

Open any chat stream and try (one at a time):

### Demo prompt #1
> *"Summarise this incident: site 9787 lost coverage in sector A starting 18:00, root cause appears to be a tilt change on neighbor 9821."*

Expected behaviour:
- Agent calls `a2a__companion__summarize-incident` (visible in the trace
  ribbon — small "via A2A · companion" badge).
- Returns a structured Markdown summary inline with severity, sector, root
  cause hypothesis.

### Demo prompt #2
> *"What's the runbook for coverage_degradation?"*

Expected behaviour:
- Agent calls `a2a__companion__lookup-runbook`.
- Returns the runbook with steps + primary owner.

### Demo prompt #3
> *"Draft a high-severity escalation for site 9787."*

Expected behaviour:
- Agent calls `a2a__companion__draft-escalation`.
- Returns a ready-to-send email template.

## Step 4 — Composability story

Tie it back to the native Naavik tools:

> *"Run RCA on site 9787, then summarise the incident, then draft an
> escalation for it."*

The orchestrator chains native + A2A tools in one turn:
1. `get_site_rca` (native) — pulls precomputed RCA + recommendation
2. `a2a__companion__summarize-incident` — structures the narrative
3. `a2a__companion__draft-escalation` — drafts the email

**Talking point:** *"Naavik treats native and external tools identically.
Add a peer agent — incident management, ticketing, knowledge base, anything
that speaks A2A — and your engineers can drive it from the same chat."*

## Talking points for the room

1. **Discovery is automatic.** No Naavik release needed to add new skills —
   the Companion Agent could publish a new skill version tomorrow and Naavik
   would pick it up on the next Agent Card refresh (every 10 min, or on
   manual reload).

2. **Auth-aware.** This demo uses `none` auth for simplicity. Naavik also
   supports `bearer` and `oauth2_client_credentials` — secrets stored in
   the configured provider (Postgres-encrypted by default, GCP Secret
   Manager or Azure Key Vault if your deployment selects those).

3. **Cloud-portable.** The same config works on any cloud. Aira's reference
   deployment runs on GCP; a customer running on Azure changes one env var.

4. **A2A + MCP together.** Same chat can call MCP tools (filesystem, GitHub,
   fetch) AND A2A skills (delegate-to-peer-agent). Naavik is the hub.

## Stopping the agent

In the terminal running `npm run demo:a2a`, hit `Ctrl-C`. Or:

```bash
lsof -ti:9555 | xargs kill
```

The agent row in Settings → Integrations will flip to **Error** within a few
seconds. Click **refresh** on the row to confirm — proves the health check
works.

## Customising

Edit `backend/src/demo/a2a-companion-agent.ts`:
- Add a new skill by extending `AGENT_CARD.skills[]` and the switch in
  `handleTaskSend`.
- Change the port via `A2A_COMPANION_PORT=9556 npm run demo:a2a`.
- Replace the deterministic logic with real LLM calls if you want — the
  agent just needs to return a valid `A2ATask` shape.
