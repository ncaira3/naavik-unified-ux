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
  type ToolContext,
  type UiBlockSuggestion,
  type UiCommandSuggestion,
} from './agent-tools.registry.js';

// ─── Types ──────────────────────────────────────────────────────────────────
export interface AgentV3ChatRequest {
  threadId?: string;
  message: string;
  currentView?: string;
  stream?: string;
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
// 8 is enough for the deep workflow when the LLM batches in parallel
// (find_site → 3 parallel batches × 1 iter each → cluster compare → synthesis).
// Going higher just lets the model burn LLM round-trips without producing more value.
const MAX_ITERATIONS = 8;
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

function buildSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  const todayMinus3 = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  return `You are Naavik, an agentic co-pilot for telecom network operators.

You help users observe their network, diagnose degraded sites, analyze KPIs, and
navigate the Naavik app. You have access to a set of tools for fetching data and
controlling the UI — call them as needed to answer the user's request.

Current date: ${today}. Default data date (freshest reliable): ${todayMinus3}.

Guidelines:
- Prefer calling tools over guessing. If the user asks about a site, call tools to get real data.
- If the user gives a partial site ID or name, call find_site first to resolve it. Exception: for ticket/incident queries that include a USID number, skip find_site and call query_data directly — ticket_table is keyed by USID and does not require site resolution.
- When showing site diagnostics (KPIs, RCA, dashboard), prefer show_kpi_dashboard
  for a rich in-chat experience. Use get_site_kpis for a quick numeric snapshot.
- Keep assistant text concise — rich data goes into UI blocks automatically.
- CRITICAL: When tool calls return UI blocks (data tables, severity meters,
  topology grids, KPI dashboards), DO NOT repeat their contents as bullet lists
  in your response text. The user already sees the visual cards. Your text
  response should be at most 1–2 sentences when UI blocks are present.
  Do NOT echo cell names, KPI values, band lists, anomaly counts, or topology
  details that the UI block already shows. Just call out the headline insight.
- Dates default to ${todayMinus3} when unspecified; that's our freshest reliable data.
- If a tool returns no data or an error, either try a related tool or tell the
  user plainly — don't fabricate results.
- Use navigate_to and set_map_layer to control the app when the user asks
  (e.g. "open observe", "show outages").
- For any data visualization request ("show me a chart of...", "plot...",
  "visualize...", "what's the trend of...", "compare sites by..."), always
  use query_data — it runs text-to-SQL, executes it, and renders the result
  as a chart automatically.
- For comprehensive analysis requests ("create a report on...", "give me a
  dashboard for...", "full analysis of..."), use generate_report — it builds
  a multi-panel tabbed report with several charts.
- Prefer query_data over manually constructing SQL or guessing results.

Deep site investigation workflow:
When asked to "analyse", "investigate", "diagnose", "what's wrong with", or "give me a full picture of" a site, follow this sequence — batching independent calls in parallel (see below):
  Step A (parallel): get_site_topology + get_site_outages + get_kpi_impact_breakdown
  Step B (parallel): get_hourly_trends (last 3 days, kpiNames: ["DL_DRB_TPUT","HOSR","DATA_RAN_ACC"]) + get_config_changes (last 7 days) + get_ret_changes (last 14 days)
  Step C (parallel): get_neighbor_relations + get_neighbor_outages
  Step D: compare_with_cluster for the most-impacted KPI from Step A
  Step E: synthesise all findings into a structured diagnosis using EXACTLY the markdown format below.
Use get_ticket_history if the user mentions a ticket number or ongoing incident.

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

Available tools: ${ALL_TOOLS.map((t) => t.name).join(', ')}.`;
}

// ─── Main loop ──────────────────────────────────────────────────────────────
export class AgentOrchestratorV3 {
  static async chat(input: AgentV3ChatRequest): Promise<AgentV3ChatResponse> {
    const threadId = input.threadId || uuidv4();
    const userMessage = String(input.message || '').trim();
    const currentView = String(input.currentView || 'home');

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

    const toolCtx: ToolContext = { threadId, currentView, contextData };

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

    for (iterations = 0; iterations < MAX_ITERATIONS; iterations++) {
      let completion: OpenAI.Chat.Completions.ChatCompletion;
      try {
        completion = await openai.chat.completions.create({
          model: MODEL,
          messages,
          tools: toOpenAITools(),
          tool_choice: 'auto',
          temperature: 0.3,
        });
      } catch (err) {
        logger.error('[agent-v3] OpenAI call failed', err);
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
        break;
      }

      // Execute all tool calls for this iteration concurrently.
      const functionCalls = msg.tool_calls.filter((tc) => tc.type === 'function');

      type ToolOutcome = {
        toolCall: (typeof functionCalls)[number];
        name: string;
        resultText: string;
        uiBlock?: UiBlockSuggestion;
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

          const tool = TOOLS_BY_NAME[name];
          if (!tool) {
            return { toolCall, name, resultText: `Error: tool "${name}" is not registered.` };
          }
          try {
            const result = await tool.execute(parsedArgs, toolCtx);
            return {
              toolCall,
              name,
              resultText: result.llmText,
              uiBlock: result.uiBlock,
              uiCommand: result.uiCommand,
            };
          } catch (err) {
            logger.warn(`[agent-v3] tool ${name} failed`, err);
            return { toolCall, name, resultText: `Tool "${name}" threw: ${(err as Error).message}` };
          }
        }),
      );

      // Collect results in order; append tool messages for the next LLM call.
      for (const outcome of settled) {
        const { toolCall, name, resultText, uiBlock, uiCommand } =
          outcome.status === 'fulfilled'
            ? outcome.value
            : {
                toolCall: (outcome as any).reason?.toolCall ?? functionCalls[0],
                name: '?',
                resultText: `Tool threw: ${(outcome as PromiseRejectedResult).reason?.message ?? 'unknown error'}`,
                uiBlock: undefined,
                uiCommand: undefined,
              };

        if (uiBlock) uiBlocks.push(uiBlock);
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
      // Even without the structured format: if the agent produced rich UI blocks,
      // the long text is almost always duplicated tool output. Trim it to a brief
      // one-liner so the chat doesn't read like a wall of bullets.
      const firstLine = assistantMessage.split(/\r?\n/).find((l) => l.trim().length > 8) || '';
      const trimmed = firstLine.replace(/^[#\-*•\s]+/, '').replace(/\*\*/g, '').trim();
      if (trimmed) assistantMessage = trimmed.slice(0, 200);
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
      assistantMessage: assistantMessage || 'Done.',
      uiBlocks: uiBlocks.length ? uiBlocks : undefined,
      uiCommands: uiCommands.length ? uiCommands : undefined,
      trace,
      iterations,
      hitIterationCap,
    };
  }
}
