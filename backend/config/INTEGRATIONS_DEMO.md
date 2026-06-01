# MCP Integrations — Demo

Five pre-configured MCP servers ship with Naavik so you can show external-tool
integration without configuring anything. They auto-load from
`backend/config/mcp-servers.bootstrap.json` on first backend start.

## What's wired by default

| Server                       | Auth   | Network | Risk                                                                 | Best demo                                                                                 |
|------------------------------|--------|---------|----------------------------------------------------------------------|-------------------------------------------------------------------------------------------|
| `demo-filesystem`            | none   | none    | none (scoped to `backend/data/mcp-demo-workspace`)                   | "List the files in the demo workspace", "Show me the runbook for coverage degradation"   |
| `demo-fetch`                 | none   | egress  | low — read-only HTTP                                                 | "Fetch https://www.gsma.com/spectrum/ and summarise"                                      |
| `demo-memory`                | none   | none    | low — local JSON store                                               | "Remember USID 9787 has a known tilt issue" → new session → "What do you know about 9787?" |
| `demo-sequential-thinking`   | none   | none    | none                                                                 | Long-form RCA narratives — agent surfaces its reasoning steps                              |
| `demo-everything` (disabled) | none   | none    | none — reference test server                                         | Toggle on in Settings → Integrations to prove auto-discovery                              |

The first four are **enabled** by default. The last one is **disabled** —
flip it on from Settings → Integrations when you want to show how a new
server's tools auto-appear.

## How the bootstrap works

On every backend boot, `McpRegistryService.init()` reads
`NAAVIK_MCP_BOOTSTRAP_PATH` and `INSERT … ON CONFLICT DO NOTHING` for any
server name that isn't already in the `mcp_servers` table. So:

- First boot — all five rows get inserted.
- Subsequent boots — no duplicates, your admin changes persist.
- Delete a row from the UI — it stays deleted across restarts.
- Edit a row from the UI — your edits stick.

The bootstrap only ever **adds**, never updates or removes.

## Talking points

1. **Open Settings → Integrations.** Show the five rows with green/grey
   status badges. Expand one — the right pane shows the discovered tools
   (e.g. `mcp__demo-filesystem__read_file`, `…__list_directory`, `…__search_files`).
   "These appeared automatically — Naavik discovered them via MCP."
2. **Switch to chat.** Ask: *"What files are in my demo workspace? Read me the
   coverage degradation runbook."*
   The agent picks `mcp__demo-filesystem__*` tools, returns the README and the
   markdown content rendered inline.
3. **Add a server.** Click "Add MCP server". Show stdio vs HTTP options.
   "We can wire in GitHub, Slack, Salesforce, internal AT&T MCP servers —
   anything that speaks MCP."
4. **Switch to A2A.** "Other agents can also plug in — Naavik will discover
   their skills the same way." Add an A2A agent URL (use a stub if no real
   one available), Naavik fetches `.well-known/agent.json` and exposes its
   skills as `a2a__<agent>__<skill>` tools.
5. **Show the trace ribbon.** Tool calls show provenance — engineers see
   when a tool came from Naavik vs. an external MCP server.

## Removing the demo set

Comment out `NAAVIK_MCP_BOOTSTRAP_PATH` in `backend/.env`, restart, and the
five rows stay in the DB (no auto-removal) — delete from the UI when
ready.
