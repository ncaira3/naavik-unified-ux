/**
 * Agent Orchestrator V3 — true tool-use loop.
 *
 * Architecture:
 *   1. Build conversation messages [system prompt, past turns, user message]
 *   2. Call OpenAI with the tool registry advertised (function-calling)
 *   3. If the LLM asks to call tools, execute them, append results, loop
 *   4. When the LLM emits a final assistant message (no tool calls), return
 *
 * This replaces the old plan() → executePlan() pattern. The LLM itself is
 * the planner — no hardcoded intent → handler dispatch. The frontend route
 * /agent/v3/chat uses this; /agent/v2/chat still works for backwards compat.
 *
 * Tools collect optional UI blocks + UI commands along the way; those are
 * bundled into the final response so the frontend renderer can display them.
 */
import { v4 as uuidv4 } from 'uuid';
import type OpenAI from 'openai';
import { openai } from '../config/openai.js';
import { logger } from '../utils/logger.js';
import { ConversationContextService } from './conversation-context.service.js';
import {
  ALL_TOOLS,
  TOOLS_BY_NAME,
  toOpenAITools,
  type AgentTool,
  type ToolContext,
  type UiBlockSuggestion,
  type UiCommandSuggestion,
} from './agent-tools.registry.js';
import { buildFollowupChips, type ToolTrace } from './agent-followups.service.js';
import { listMcpTools } from './mcp-client/tool-bridge.js';
import { listA2aTools } from './a2a-client/skill-bridge.js';
import type { SseEvent } from '../types/sse-events.js';
import { FULL_SCHEMA } from './db-schema-reference.service.js';

// ─── Types ──────────────────────────────────────────────────────────────────
export interface AgentV3ChatRequest {
  threadId?: string;
  message: string;
  currentView?: string;
  stream?: string;
  /** SSE event emitter — injected by the /v3/stream route. */
  onEvent?: (e: SseEvent) => void;
}

export interface AgentV3ChatResponse {
  threadId: string;
  assistantMessage: string;
  uiBlocks?: UiBlockSuggestion[];
  uiCommands?: UiCommandSuggestion[];
  /** Diagnostic trail so the frontend can show "agent was thinking…" */
  trace: Array<
    | { type: 'tool_call'; name: string; args: Record<string, any> }
    | { type: 'tool_result'; name: string; summary: string }
    | { type: 'thought'; text: string }
  >;
  iterations: number;
  hitIterationCap: boolean;
}

// ─── Constants ──────────────────────────────────────────────────────────────
// 12 iterations allows the full deep-investigation workflow (9 steps) plus
// clarification turns and retries without hitting the cap on normal usage.
const MAX_ITERATIONS = 12;
const MODEL = process.env.OPENAI_AGENT_MODEL || 'gpt-4o-mini';
const MAX_HISTORY_TURNS = 12; // user+assistant message pairs to keep in context

/**
 * Detects whether an assistant message follows the deep-investigation
 * synthesis format (Severity / Headline / What Changed / What Degraded / etc.).
 * Matches both `## Header`, `**Header**`, and `Header:` styles.
 */
function hasStructuredSynthesis(text: string): boolean {
  const headerPattern = /(^|\n)\s*(?:#{1,4}\s*|\*\*|__)?\s*(severity|headline|what\s+changed|what\s+degraded|likely\s+root\s+cause|root\s+cause|next\s+actions|recommend)/i;
  const matches = text.match(new RegExp(headerPattern.source, 'gi'));
  // Need at least 3 distinct section markers — guards against accidental matches.
  return !!matches && matches.length >= 3;
}

/**
 * Pull the one-sentence headline out of a structured synthesis. Looks for
 * "## Headline" (or its bold/colon variants) and returns the first non-empty
 * line below it. Falls back to the first non-empty line if no header found.
 */
function extractHeadline(text: string): string {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const isHeadlineHeader =
      /^#{1,4}\s*headline\b/i.test(line) ||
      /^\*\*\s*headline\s*\*\*/i.test(line) ||
      /^headline\s*:/i.test(line);
    if (!isHeadlineHeader) continue;
    // Try the inline form: `Headline: site is stable...`
    const inline = line.replace(/^[#*\s]*headline[\s:]*\**\s*/i, '').replace(/\*\*$/, '').trim();
    if (inline) return inline;
    // Otherwise look at the next non-empty, non-header lines
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (!next) continue;
      if (/^#{1,4}\s/.test(next) || /^\*\*[A-Z]/.test(next)) break;
      return next.replace(/^[*_`]+|[*_`]+$/g, '').trim();
    }
    break;
  }
  // Fallback: first meaningful line of the synthesis
  for (const l of lines) {
    const t = l.replace(/^[#\-*•\s]+/, '').replace(/\*\*/g, '').trim();
    if (t.length > 8 && !/^(severity|what changed|what degraded|root cause|next action)/i.test(t)) {
      return t.slice(0, 200);
    }
  }
  return '';
}

// ─── Tabify supporting evidence ─────────────────────────────────────────────

/**
 * Blocks that stay top-level — they ARE the answer.
 * Everything else falls into the "Supporting evidence" tabs container.
 */
const HEADLINE_BLOCK_TYPES = new Set<string>([
  'diagnosis_card',
  'recommendation_card',
  'rca_summary',
  'rca_report',
  'rca_story',
  'callout',
  'chips',
  'kpi_dashboard',  // interactive, stand-alone
  'map_inset',      // small visual
]);

/**
 * Block types that are fully self-contained visuals — when any of these are
 * present the assistant text is suppressed entirely so the user sees only
 * the card, with no duplicate narrative above it.
 */
const RICH_BLOCK_TYPES = new Set<string>([
  'recommendation_card',
  'rca_summary',
  'rca_story',
  'rca_report',
]);

/** Per-type label fallback when no `title` was supplied. */
const TAB_LABEL_BY_TYPE: Record<string, string> = {
  compact_table: 'Data',
  data_table: 'Table',
  severity_meter: 'Impact',
  topology_grid: 'Topology',
  insight_chart: 'Chart',
  ranked_list: 'Ranked list',
  stat_row: 'Stats',
};

function tabLabelFor(block: UiBlockSuggestion, index: number): string {
  const explicit =
    (block as any).title ||
    (block.data as any)?.title;
  if (typeof explicit === 'string' && explicit.trim()) {
    // Strip a leading "Tool · " or "Whatever · " prefix and just keep the suffix
    // when present, so labels stay short.
    const cleaned = String(explicit).replace(/^[^·]+·\s*/, '').trim();
    return cleaned.length <= 40 ? cleaned : cleaned.slice(0, 38) + '…';
  }
  return TAB_LABEL_BY_TYPE[block.type] || `Section ${index + 1}`;
}

/**
 * Mutate `uiBlocks` in place: when there are 3+ supporting blocks alongside
 * at least one headline block, collapse the supporting ones into a single
 * `tabs` block placed at the end of the headline section.
 */
function tabifySupportingBlocks(uiBlocks: UiBlockSuggestion[]): void {
  if (uiBlocks.length < 4) return;

  const headlineIdxs: number[] = [];
  const supportingIdxs: number[] = [];
  for (let i = 0; i < uiBlocks.length; i++) {
    const b = uiBlocks[i];
    if (HEADLINE_BLOCK_TYPES.has(b.type)) headlineIdxs.push(i);
    else supportingIdxs.push(i);
  }
  if (headlineIdxs.length === 0) return;     // nothing to anchor the tabs under
  if (supportingIdxs.length < 3) return;     // not worth the chrome

  // Build the tabs block from the supporting items, preserving order.
  const tabs = supportingIdxs.map((idx, i) => {
    const block = uiBlocks[idx];
    const id = `tab_${idx}_${block.type}`;
    return {
      id,
      label: tabLabelFor(block, i),
      blocks: [block],
    };
  });

  const tabsBlock: UiBlockSuggestion = {
    type: 'tabs',
    title: 'Supporting evidence',
    data: {
      tabs,
    },
  };

  // Strip the supporting blocks (descending so indices stay valid) and append
  // the tabs block at the end of the array (above any chips block which we
  // add later in the pipeline).
  for (let i = uiBlocks.length - 1; i >= 0; i--) {
    if (supportingIdxs.includes(i)) uiBlocks.splice(i, 1);
  }
  uiBlocks.push(tabsBlock);
}

function buildSystemPrompt(): string {
  // Use local (wall-clock) date so the LLM sees the same "today" the user sees,
  // even when the server's UTC date has already ticked past midnight locally.
  const _now = new Date();
  const _pad = (n: number) => String(n).padStart(2, '0');
  const today = `${_now.getFullYear()}-${_pad(_now.getMonth() + 1)}-${_pad(_now.getDate())}`;
  const _t3 = new Date(Date.now() - 3 * 86_400_000);
  const todayMinus3 = `${_t3.getFullYear()}-${_pad(_t3.getMonth() + 1)}-${_pad(_t3.getDate())}`;
  return `You are Naavik, an agentic co-pilot for telecom network operators.

You help users observe their network, diagnose degraded sites, analyze KPIs, and
navigate the Naavik app. You have access to a set of tools for fetching data and
controlling the UI — call them as needed to answer the user's request.

Current date: ${today}. Default data date (freshest reliable): ${todayMinus3}.

Guidelines:
- Prefer calling tools over guessing. If the user asks about a site, call tools to get real data.
- If the user gives a partial site ID or name, call find_site first to resolve it. Exception: for ticket/incident queries that include a USID number, skip find_site and call query_data directly — ticket_table is keyed by USID and does not require site resolution.
- RCA SPEED RULE: For "explain RCA", "why is site X degraded", or any RCA request, ALWAYS call get_site_rca FIRST. If it returns an rca_summary card, you are DONE — do NOT call run_rca_live. The precomputed DB answer is fast and complete. run_rca_live is a LAST RESORT: only call it if get_site_rca explicitly returned "No RCA found" AND the user specifically asked for a live or fresh analysis. Calling run_rca_live speculatively costs 30–180 seconds of unnecessary wait time.
- When showing site diagnostics (KPIs, RCA, dashboard), prefer show_kpi_dashboard
  for a rich in-chat experience. Use get_site_kpis for a quick numeric snapshot.
- Keep assistant text concise — rich data goes into UI blocks automatically.
- STRICT RULE — NO DUPLICATION: When any tool call produces a UI block (table,
  chart, severity card, KPI dashboard, topology grid, offender list), your text
  response MUST be ONE sentence or fewer. DO NOT list, enumerate, or summarise
  the data that is already visible in the card. The user can read the card.
  BAD: "Here are the worst offenders: 1. USID 9631 — Congestion... 2. USID 50512..."
  GOOD: "Showing the top 5 offenders for today." (then stop — the card has the rest)
  BAD: "The topology shows cells A1, A2, B1 on bands 700MHz, 1900MHz..."
  GOOD: "Site topology loaded." (one sentence, no echoing)
  If no UI block was produced, you may give a full text answer.
- Dates default to ${todayMinus3} when unspecified; that's our freshest reliable data.
- If a tool returns no data or an error, either try a related tool or tell the
  user plainly — don't fabricate results.
- Use navigate_to and set_map_layer to control the app when the user asks
  (e.g. "open observe", "show outages").
- query_data is your primary tool for ANY data retrieval. Write T-SQL SELECT
  directly using the schema and rules at the end of this prompt. Use it for:
  site KPIs, config changes, neighbor relations, ticket history, trends,
  comparisons, aggregate counts — anything needing live data. ALWAYS prefer
  query_data when a user's request isn't covered by a dedicated tool.
- For charts/trends: use query_data with a GROUP BY date query + SELECT TOP 500.
- For comprehensive analysis: use generate_report (multi-panel tabbed charts).
- query_data works for ANY site — not just offender sites in the mirror.

Deep site investigation workflow:
When asked to "analyse", "investigate", "diagnose", "what's wrong with", or "give me a full picture of" a site, follow this sequence — batching independent calls in parallel (see below):
  Step A (parallel): get_site_topology + get_site_outages + get_kpi_impact_breakdown
  Step B (parallel): get_hourly_trends (last 3 days, kpiNames: ["DL_DRB_TPUT","HOSR","DATA_RAN_ACC"]) + get_config_changes (last 7 days) + get_ret_changes (last 14 days)
  Step C (parallel): get_neighbor_relations + get_neighbor_outages
  Step D: compare_with_cluster for the most-impacted KPI from Step A
  Step E: synthesise all findings into a structured diagnosis using EXACTLY the markdown format below.
Use get_ticket_history if the user mentions a ticket number or ongoing incident.
Use get_local_events in parallel with Step A whenever investigating unusual traffic spikes or capacity events — an event (concert, sports game, weather) may explain the anomaly without requiring a network fix.

Synthesis output format (REQUIRED for deep investigation requests):
Always output the synthesis using EXACTLY these six markdown headers (in this order). Each section MUST be present. Keep each section to 1–4 short bullet points or sentences — concise, no fluff. Do NOT add any introductory paragraph before "## Headline". Do NOT add any other sections (no "Topology", "Hourly KPI Trends", "Cells", "Bands", etc. — that data is already shown in the UI blocks above).

## Severity
One word: critical | major | minor | nominal. Pick based on outages + anomaly count + KPI impact.

## Headline
A single sentence (≤ 18 words) summarizing the top finding.

## What Changed
- Bullet list of recent config / RET / topology changes that may matter, with old→new where known.

## What Degraded
- Bullet list of KPIs / CQX sub-components that are anomalous or off-target. Include numeric deltas.

## Likely Root Cause
- 1–3 bullet points naming the most probable cause(s), grounded in the tool data.

## Next Actions
- 1–3 concrete next steps for the operator (validate, rollback, escalate, monitor).

DO NOT include any other markdown sections, raw tool data dumps, cell-by-cell statistics, band lists, or anything that the UI blocks already render visually. If a section has no data, write a single bullet "- None detected." rather than skipping or listing tool output.

Parallel tool calls:
When you need multiple independent data points for the same site, request ALL of them in a single response using parallel tool calls — do NOT call them one at a time if they don't depend on each other's results. The system executes parallel tool calls concurrently so batching saves significant time.

ONE DASHBOARD FOR MULTIPLE SITES (very important):
When the user wants KPI trends for two or more sites (e.g. "top 3 offenders", "USIDs 9787 and 13081", "compare site A vs B"), call show_kpi_dashboard EXACTLY ONCE with the siteIds array argument set to all the USIDs. NEVER emit multiple show_kpi_dashboard calls — that produces stacked dashboards which is bad UX. The dashboard renders a single card with a USID switcher so the user can flip between sites in place.

New site-analysis tools (use these for deep diagnosis):
- get_site_topology: cell inventory, bands (lowband/midband/5G NR), azimuths, anomaly flags
- get_config_changes: parameter change log (Old→New) with impact analysis
- get_neighbor_relations: handover distribution, top neighbors, HO concentration
- get_ret_changes: antenna tilt snapshots across two dates — detects tilt changes per sector
- get_site_outages: cell-level outage events (metric type, hour) + site outage flag
- get_neighbor_outages: which neighbors have outages and their HO share of this site
- get_hourly_trends: multi-cell, multi-day hourly KPI time series with anomaly flagging and LLM narrative
- get_kpi_impact_breakdown: CQX sub-component impact scores — tells you where to dig next
- get_ticket_history: trouble tickets by category and status
- compare_with_cluster: site KPI vs cluster peers — confirm if issue is isolated or cluster-wide
- get_ret_changes: use when symptoms suggest coverage change (HOSR drop, unexpected throughput pattern, interference)
- get_local_events: real-world events near a site — concerts, sports, weather alerts, breaking news, holidays (Ticketmaster, SeatGeek, NWS, GDELT). Use when user asks "what events are near site X", "is there a concert tonight", "what's happening around USID 9817", or when correlating traffic anomalies with local events.

KPI / CM parameter resolution (IMPORTANT):
- The DataDict catalog indexes 16,038 Ericsson EIAP telco_RAN parameters (KPIs and CM attributes).
- Whenever the user mentions a KPI or CM parameter name that is not obviously an exact known DB column
  (i.e. it doesn't match ALL_CAPS_WITH_UNDERSCORES or looks informal/abbreviated/misspelled),
  call resolve_kpi_param FIRST before attempting any data query.
- If resolve_kpi_param returns a single high-confidence match, use that canonical name in
  all subsequent tool calls (show_kpi_dashboard, query_data, etc.).
- If resolve_kpi_param returns multiple candidates, surface the chip selector to the user and
  WAIT for their selection before querying data.
- When the user selects a chip (a short ALL_CAPS_WITH_UNDERSCORES value arriving as a follow-up),
  treat it as the answer to the previous disambiguation question. Check conversation history to
  recover the original siteId, date range, and intent, then proceed immediately with the resolved name.
- Examples that should trigger resolve_kpi_param:
    "downlink throughput", "DL_TROUGHPUT" (misspelling), "handover success rate",
    "RSRP", "drop rate", "PRB utilization", "avg cqi", "erab retention".

Multi-KPI dashboard:
- When the user mentions MULTIPLE KPIs in one message (e.g. "show me DL_VOL_GB, HOSR and drop rate"),
  call resolve_kpi_param for each ambiguous name, then call show_kpi_dashboard with kpiNames as a list
  containing ALL resolved names. Do not create separate dashboards per KPI.
- If the user says "add X to the dashboard" or "also show Y", append to the current KPI list
  (visible in conversation history) and re-call show_kpi_dashboard with the full updated list.
- show_kpi_dashboard accepts kpiNames as an array — always pass the complete list.

Available tools: ${ALL_TOOLS.map((t) => t.name).join(', ')}.

────────────────────────────────────────────────────────────────
DATABASE SCHEMA  (Microsoft SQL Server / T-SQL)
────────────────────────────────────────────────────────────────
${FULL_SCHEMA}

T-SQL RULES for query_data (write SQL yourself — do NOT rely on NL conversion):
- Syntax: SELECT TOP N … (no LIMIT), table hints WITH (NOLOCK) on every table.
- Date point-in-time: CAST(DATE_ID AS DATE) = CAST('YYYY-MM-DD' AS DATE)
- Date range:         DATE_ID >= DATEADD(day, -N, GETDATE())
- Default date: ${todayMinus3}
- Trend/time-series:  SELECT TOP 500, GROUP BY CAST(DATE_ID AS DATE) — one row per date.
- Snapshot/list:      SELECT TOP 50
- KPI queries:        join via USID + DATE_ID + cell_name + kpi_name
- "degraded sites":   WHERE degraded_category IS NOT NULL
- "offenders/RCA":    WHERE chain_of_thought IS NOT NULL
- rca_bucket filter:  rca_bucket LIKE '%keyword%'
- Only SELECT — never INSERT/UPDATE/DELETE/DROP/TRUNCATE/ALTER/EXEC.
- Always include WITH (NOLOCK) to avoid locking production tables.
────────────────────────────────────────────────────────────────`;
}

// ─── Main loop ──────────────────────────────────────────────────────────────
export class AgentOrchestratorV3 {
  static async chat(input: AgentV3ChatRequest): Promise<AgentV3ChatResponse> {
    const threadId = input.threadId || uuidv4();
    const userMessage = String(input.message || '').trim();
    const currentView = String(input.currentView || 'home');
    const stream = input.stream ? String(input.stream) : undefined;
    const onEvent = input.onEvent;

    // Retrieve conversation context (full turn history + metadata).
    const context = await ConversationContextService.getContext(threadId);
    const contextData = (context?.contextData || {}) as Record<string, any>;

    // Full turn history — stored as [{role, content}] pairs.
    type HistoryMsg = { role: 'user' | 'assistant'; content: string };
    const rawHistory: unknown[] = Array.isArray(contextData.history) ? contextData.history : [];
    const history: HistoryMsg[] = rawHistory
      .filter((h): h is HistoryMsg =>
        typeof h === 'object' && h !== null &&
        (((h as any).role === 'user') || ((h as any).role === 'assistant')) &&
        typeof (h as any).content === 'string',
      )
      .slice(-MAX_HISTORY_TURNS);

    const toolCtx: ToolContext = { threadId, currentView, contextData, onEvent };

    // Build the message array: system prompt → history → current user message.
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSystemPrompt() },
      {
        role: 'system',
        content: `Current app view: ${currentView}.`,
      },
      // Replay previous turns so the LLM has full context
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: userMessage },
    ];

    const trace: AgentV3ChatResponse['trace'] = [];
    const uiBlocks: UiBlockSuggestion[] = [];
    const uiCommands: UiCommandSuggestion[] = [];
    let iterations = 0;
    let hitIterationCap = false;
    let assistantMessage = '';

    // Build the union of native + external tools ONCE per request. External
    // tools come from configured MCP servers and A2A agents, namespaced so
    // collisions with native tools are impossible (mcp__xxx, a2a__xxx).
    // Discovery is cached inside each manager (10 min) — this is cheap.
    const externalTools: AgentTool[] = [];
    try {
      const [mcpTools, a2aTools] = await Promise.all([
        listMcpTools(stream),
        listA2aTools(stream),
      ]);
      externalTools.push(...mcpTools, ...a2aTools);
    } catch (err) {
      logger.warn('[agent-v3] external tool discovery failed; proceeding with native only', err);
    }
    const requestTools: AgentTool[] = [...ALL_TOOLS, ...externalTools];
    const requestToolMap: Record<string, AgentTool> = { ...TOOLS_BY_NAME };
    for (const t of externalTools) requestToolMap[t.name] = t;

    for (iterations = 0; iterations < MAX_ITERATIONS; iterations++) {
      let completion: OpenAI.Chat.Completions.ChatCompletion;
      try {
        completion = await openai.chat.completions.create({
          model: MODEL,
          messages,
          tools: toOpenAITools(requestTools),
          tool_choice: 'auto',
          temperature: 0.3,
        });
      } catch (err) {
        logger.error('[agent-v3] OpenAI call failed', err);
        onEvent?.({
          type: 'error',
          message: 'Sorry — I hit an error reaching the language model. Please retry in a moment.',
        });
        return {
          threadId,
          assistantMessage:
            'Sorry — I hit an error reaching the language model. Please retry in a moment.',
          uiBlocks,
          uiCommands,
          trace,
          iterations,
          hitIterationCap: false,
        };
      }

      const msg = completion.choices[0]?.message;
      if (!msg) break;
      messages.push(msg);

      // No tool calls → the LLM is done, this is the final answer.
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        assistantMessage = String(msg.content || '').trim();
        if (msg.content && typeof msg.content === 'string') {
          trace.push({ type: 'thought', text: msg.content });
        }

        // If self-contained visual blocks are already rendered, keep only the
        // first clean sentence — enough context without repeating the card content.
        const richAlready = uiBlocks.some((b) => RICH_BLOCK_TYPES.has(b.type));
        if (richAlready) {
          const firstSentence = assistantMessage
            .replace(/\*\*/g, '')                   // strip bold
            .replace(/^#+\s*/gm, '')               // strip headings
            .replace(/^[-*•]\s+/gm, '')            // strip bullets
            .split(/(?<=[.!?])\s+/)[0]             // first sentence
            ?.trim() ?? '';
          assistantMessage = firstSentence.slice(0, 200) || 'Analysis complete — see results below.';
        } else if (!assistantMessage && uiBlocks.length > 0) {
          assistantMessage = 'Analysis complete — see the results below.';
        } else if (!assistantMessage) {
          assistantMessage = "I ran the analysis but didn't produce a summary. Please try again.";
        }

        // SSE: stream tokens only when there's text to show.
        if (onEvent && assistantMessage) {
          const chunks = assistantMessage.match(/\S+\s*/g) || [assistantMessage];
          for (const chunk of chunks) {
            onEvent({ type: 'token', delta: chunk });
          }
        }
        break;
      }

      // Execute all tool calls for this iteration concurrently.
      const functionCalls = msg.tool_calls.filter((tc) => tc.type === 'function');

      type ToolOutcome = {
        toolCall: (typeof functionCalls)[number];
        name: string;
        resultText: string;
        uiBlock?: UiBlockSuggestion;
        extraUiBlocks?: UiBlockSuggestion[];
        uiCommand?: UiCommandSuggestion;
      };

      const settled = await Promise.allSettled(
        functionCalls.map(async (toolCall): Promise<ToolOutcome> => {
          const name = toolCall.function.name;
          let parsedArgs: Record<string, any> = {};
          try {
            parsedArgs = toolCall.function.arguments
              ? JSON.parse(toolCall.function.arguments)
              : {};
          } catch {
            parsedArgs = {};
          }
          trace.push({ type: 'tool_call', name, args: parsedArgs });

          // SSE: notify frontend that a tool started.
          onEvent?.({
            type: 'tool_start',
            name,
            args: parsedArgs,
            callId: toolCall.id,
          });

          const tool = requestToolMap[name];
          if (!tool) {
            onEvent?.({
              type: 'tool_end',
              callId: toolCall.id,
              summary: 'not registered',
              hasUiBlock: false,
            });
            return { toolCall, name, resultText: `Error: tool "${name}" is not registered.` };
          }
          try {
            const result = await tool.execute(parsedArgs, toolCtx);

            // SSE: notify frontend that the tool completed and stream any UI
            // blocks / commands immediately so the user sees results as they
            // arrive rather than waiting for the whole batch.
            onEvent?.({
              type: 'tool_end',
              callId: toolCall.id,
              summary: result.llmText.slice(0, 120),
              hasUiBlock: !!result.uiBlock,
            });
            if (result.uiBlock) {
              onEvent?.({ type: 'block', block: result.uiBlock as unknown as Record<string, unknown> });
            }
            if ((result as any).extraUiBlocks?.length) {
              for (const b of (result as any).extraUiBlocks) {
                onEvent?.({ type: 'block', block: b as Record<string, unknown> });
              }
            }
            if (result.uiCommand) {
              onEvent?.({ type: 'command', command: result.uiCommand as unknown as Record<string, unknown> });
            }

            return {
              toolCall,
              name,
              resultText: result.llmText,
              uiBlock: result.uiBlock,
              extraUiBlocks: (result as any).extraUiBlocks,
              uiCommand: result.uiCommand,
            };
          } catch (err) {
            logger.warn(`[agent-v3] tool ${name} failed`, err);
            onEvent?.({
              type: 'tool_end',
              callId: toolCall.id,
              summary: `error: ${(err as Error).message}`,
              hasUiBlock: false,
            });
            return { toolCall, name, resultText: `Tool "${name}" threw: ${(err as Error).message}` };
          }
        }),
      );

      // Collect results in order; append tool messages for the next LLM call.
      for (const outcome of settled) {
        const { toolCall, name, resultText, uiBlock, extraUiBlocks, uiCommand } =
          outcome.status === 'fulfilled'
            ? outcome.value
            : {
                toolCall: (outcome as any).reason?.toolCall ?? functionCalls[0],
                name: '?',
                resultText: `Tool threw: ${(outcome as PromiseRejectedResult).reason?.message ?? 'unknown error'}`,
                uiBlock: undefined,
                extraUiBlocks: undefined,
                uiCommand: undefined,
              };

        if (uiBlock) uiBlocks.push(uiBlock);
        if (extraUiBlocks?.length) uiBlocks.push(...extraUiBlocks);
        if (uiCommand) uiCommands.push(uiCommand);
        trace.push({ type: 'tool_result', name, summary: resultText.slice(0, 200) });
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: resultText });
      }
    }

    if (iterations >= MAX_ITERATIONS) {
      hitIterationCap = true;
      if (!assistantMessage) {
        assistantMessage =
          "I made several tool calls but couldn't quite close this out. Here's what I found along the way.";
      }
    }

    // If the synthesis follows the structured "## Severity / ## Headline / …"
    // format, surface it as a `diagnosis_card` UI block AND replace the chat
    // message with just the headline so we don't render the same content twice.
    if (assistantMessage && hasStructuredSynthesis(assistantMessage)) {
      const fullSynthesis = assistantMessage;
      uiBlocks.unshift({
        type: 'diagnosis_card',
        title: 'Diagnosis',
        data: {
          synthesis: fullSynthesis,
          context: currentView ? `View: ${currentView}` : undefined,
        },
      });
      // Extract just the headline for the chat-bubble text.
      const headline = extractHeadline(fullSynthesis);
      assistantMessage = headline || 'Investigation complete — see diagnosis below.';
    } else if (assistantMessage && uiBlocks.length >= 2 && assistantMessage.length > 400) {
      // Generic multi-block trimming — same idea, less strict threshold.
      const firstLine = assistantMessage.split(/\r?\n/).find((l) => l.trim().length > 8) || '';
      const trimmed = firstLine.replace(/^[#\-*•\s]+/, '').replace(/\*\*/g, '').trim();
      if (trimmed) assistantMessage = trimmed.slice(0, 200);
    }

    // Compact the response — when the deep-investigation workflow produced
    // many "supporting" UI blocks (topology, parameter changes, RET, outages,
    // neighbors, cluster comparison), collapse them into a single tabs block
    // titled "Supporting evidence" under the headline RCA + recommendation.
    // The user reads the verdict first; the heavy context sits behind tabs.
    tabifySupportingBlocks(uiBlocks);

    // Append conversation-builder follow-up chips. Each chip is either:
    //   - fire-and-forget (every param already known → just sends the prompt)
    //   - or a conversation builder (carries inline questions like "Which site?")
    // We skip the block entirely when the agent already emitted its own chips
    // (cost gate, KPI clarifier) so we never stack two chip rows.
    const toolTrace: ToolTrace[] = trace
      .filter((e) => e.type === 'tool_call')
      .map((e) => ({ name: (e as any).name, args: (e as any).args }));
    const alreadyHasChips = uiBlocks.some((b) => b.type === 'chips');
    if (!alreadyHasChips) {
      const chips = buildFollowupChips(toolTrace, { maxChips: 4 });
      if (chips && chips.length) {
        uiBlocks.push({
          type: 'chips',
          title: 'What next',
          data: {
            prompt: 'Pick a follow-up — or keep typing.',
            chips,            // each entry has { label, description?, prompt, needs?, intent? }
            variant: 'followups',
          },
        });
      }
    }

    // Persist full turn history so the next request has real conversation context.
    const newHistory: HistoryMsg[] = (
      [
        ...history,
        { role: 'user' as const, content: userMessage },
        ...(assistantMessage ? [{ role: 'assistant' as const, content: assistantMessage }] : []),
      ] as HistoryMsg[]
    ).slice(-MAX_HISTORY_TURNS);

    await ConversationContextService.updateContext(threadId, {
      lastQuery: userMessage,
      contextData: {
        ...contextData,
        history: newHistory,
        lastAgentVersion: 'v3',
        lastIterations: iterations,
        lastUpdatedAt: new Date().toISOString(),
      },
    });

    return {
      threadId,
      // Empty string is valid when rich uiBlocks carry the full response.
      assistantMessage: assistantMessage ?? '',
      uiBlocks: uiBlocks.length ? uiBlocks : undefined,
      uiCommands: uiCommands.length ? uiCommands : undefined,
      trace,
      iterations,
      hitIterationCap,
    };
  }
}
