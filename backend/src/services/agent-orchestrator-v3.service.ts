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
const MAX_ITERATIONS = 6;
const MODEL = process.env.OPENAI_AGENT_MODEL || 'gpt-4.1-mini';
const MAX_HISTORY_TURNS = 12; // user+assistant message pairs to keep in context

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

      // Execute each tool call the LLM requested.
      for (const toolCall of msg.tool_calls) {
        if (toolCall.type !== 'function') continue;
        const name = toolCall.function.name;
        const tool = TOOLS_BY_NAME[name];
        let parsedArgs: Record<string, any> = {};
        try {
          parsedArgs = toolCall.function.arguments
            ? JSON.parse(toolCall.function.arguments)
            : {};
        } catch {
          parsedArgs = {};
        }
        trace.push({ type: 'tool_call', name, args: parsedArgs });

        let resultText = '';
        if (!tool) {
          resultText = `Error: tool "${name}" is not registered.`;
        } else {
          try {
            const result = await tool.execute(parsedArgs, toolCtx);
            resultText = result.llmText;
            if (result.uiBlock) uiBlocks.push(result.uiBlock);
            if (result.uiCommand) uiCommands.push(result.uiCommand);
          } catch (err) {
            resultText = `Tool "${name}" threw: ${(err as Error).message}`;
            logger.warn(`[agent-v3] tool ${name} failed`, err);
          }
        }
        trace.push({ type: 'tool_result', name, summary: resultText.slice(0, 200) });

        // Append the tool result so the next LLM call can see it.
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: resultText,
        });
      }
    }

    if (iterations >= MAX_ITERATIONS) {
      hitIterationCap = true;
      if (!assistantMessage) {
        assistantMessage =
          "I made several tool calls but couldn't quite close this out. Here's what I found along the way.";
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
      assistantMessage: assistantMessage || 'Done.',
      uiBlocks: uiBlocks.length ? uiBlocks : undefined,
      uiCommands: uiCommands.length ? uiCommands : undefined,
      trace,
      iterations,
      hitIterationCap,
    };
  }
}
