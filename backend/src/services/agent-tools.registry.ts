/**
 * Agent Tool Registry — tools the LLM can invoke via function-calling.
 *
 * Each tool exposes:
 *   - name, description (for the LLM)
 *   - JSON Schema parameters (for OpenAI tools API)
 *   - execute(args, ctx) → returns result + optional UI suggestion
 *
 * The orchestrator's tool-use loop reads this registry to advertise
 * tools to the LLM, then routes the LLM's tool_calls back to execute().
 */
import { TelecomKnowledgeService } from './telecom-knowledge.service.js';
import { logger } from '../utils/logger.js';
import { NaavikDBConnector } from './naavik-db-connector.service.js';
import { ChartGeneratorService } from './chart-generator.service.js';
import { openai } from '../config/openai.js';
import { dbSchemaRef } from './db-schema-reference.service.js';
import { dataDictResolver } from './datadict-resolver.service.js';
import { mirrorOrRemote } from './db-mirror/lib/mirror-or-remote.js';

// Shared remote DB connector for all data-query tools
const remoteDb = new NaavikDBConnector();

// ─── Types ──────────────────────────────────────────────────────────────────
export interface ToolContext {
  threadId: string;
  currentView?: string;
  contextData: Record<string, any>;
}

export type UiCommandType =
  | 'set_date' | 'set_layer' | 'open_view' | 'map_focus_site'
  | 'map_fit_bounds' | 'map_highlight_set' | 'set_filters';

export type UiBlockType =
  | 'text' | 'callout' | 'chips' | 'stat_row' | 'data_table' | 'compact_table'
  | 'diagnosis_card' | 'severity_meter' | 'topology_grid'
  | 'ranked_list' | 'kpi_dashboard' | 'rca_story' | 'rca_summary' | 'map_inset'
  | 'insight_chart' | 'tabs' | 'grid_layout';

export interface UiBlockSuggestion {
  type: UiBlockType;
  title?: string;
  data: Record<string, any>;
}

export interface UiCommandSuggestion {
  type: UiCommandType;
  payload: Record<string, any>;
}

export interface ToolResult {
  /** Compact text result the LLM will see — keep < 4 KB. */
  llmText: string;
  /** Optional UI block to render alongside the final answer. */
  uiBlock?: UiBlockSuggestion;
  /** Optional UI command (navigation, filter, etc.) */
  uiCommand?: UiCommandSuggestion;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  execute: (args: Record<string, any>, ctx: ToolContext) => Promise<ToolResult>;
}

// ─── Helper ─────────────────────────────────────────────────────────────────
function clampString(s: string, max = 4000): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 20) + '… [truncated]';
}

function todayMinus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function sanitizeSiteId(id: string): string {
  return id.replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 60);
}

function sanitizeDate(d: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayMinus(3);
}

/** Days between two YYYY-MM-DD dates (positive if end > start). */
function daysBetween(start: string, end: string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (!isFinite(s) || !isFinite(e)) return 0;
  return Math.round((e - s) / 86_400_000);
}

/** Clamp a date range so endDate is no more than maxDays after startDate (and not before it). */
function clampDateRange(startDate: string, endDate: string, maxDays: number): { startDate: string; endDate: string } {
  const start = sanitizeDate(startDate);
  let end = sanitizeDate(endDate);
  // If end < start, reset end to start
  if (daysBetween(start, end) < 0) end = start;
  // If span too wide, push start forward to maxDays before end
  if (daysBetween(start, end) > maxDays) {
    const newStart = new Date(end);
    newStart.setDate(newStart.getDate() - maxDays);
    return { startDate: newStart.toISOString().slice(0, 10), endDate: end };
  }
  return { startDate: start, endDate: end };
}

/** Sanitize and cap an array of KPI names. */
function sanitizeKpiList(input: unknown, fallback: string[], maxItems = 8): string[] {
  const arr = Array.isArray(input) && input.length ? (input as unknown[]) : fallback;
  return arr
    .map((k) => String(k).replace(/[^A-Za-z0-9_]/g, '').slice(0, 60))
    .filter(Boolean)
    .slice(0, maxItems);
}

/** Try fn(dateId) stepping one day back at a time until rows are returned or maxTries exhausted. */
async function withDateFallback(
  fn: (dateId: string) => Promise<any[]>,
  startDate: string,
  maxTries = 5,
): Promise<{ rows: any[]; dateId: string } | null> {
  const d = new Date(startDate);
  for (let i = 0; i < maxTries; i++) {
    const dateId = d.toISOString().slice(0, 10);
    try {
      const rows = await fn(dateId);
      if (rows.length) return { rows, dateId };
    } catch {
      // ignore individual date errors, try the next day
    }
    d.setDate(d.getDate() - 1);
  }
  return null;
}

// ─── Tool implementations ───────────────────────────────────────────────────

/** Returns the worst-performing sites for a given date. */
const tool_get_worst_offenders: AgentTool = {
  name: 'get_worst_offenders',
  description:
    'Get the most-degraded network sites for a specific date. Returns a ranked list ' +
    'of sites with their degradation category and severity score. Use this when the ' +
    'user asks about "worst offenders", "top degraded sites", "what\'s broken", etc.',
  parameters: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: 'Date in YYYY-MM-DD format. Defaults to 3 days ago if omitted.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of sites to return (1–20). Default 5.',
      },
    },
  },
  async execute(args) {
    const startDate = sanitizeDate(String(args.date || todayMinus(3)));
    const limit = Math.min(20, Math.max(1, Number(args.limit) || 5));

    const found = await withDateFallback(async (dateId) => {
      const sql = `SELECT TOP ${limit}
        s.USID, s.degraded_category, s.rca_bucket, s.short_summary,
        sc.subcomponent_value as impact_score
      FROM site_table s WITH (NOLOCK)
      LEFT JOIN subcomponent_table sc WITH (NOLOCK)
        ON s.USID = sc.USID
        AND CAST(s.DATE_ID AS DATE) = CAST(sc.DATE_ID AS DATE)
        AND sc.subcomponent_name = 'Total_Impact_to_SuperKPI_Delta'
      WHERE s.chain_of_thought IS NOT NULL
        AND CAST(s.DATE_ID AS DATE) = CAST('${dateId}' AS DATE)
      ORDER BY ISNULL(sc.subcomponent_value, 0) DESC`;
      return remoteDb.query(sql);
    }, startDate);

    if (!found) {
      return { llmText: `No worst-offender data found near ${startDate}. The AI analysis pipeline may not have run for recent dates.` };
    }

    const { rows, dateId } = found;

    const parseRcaBucket = (raw: any): string => {
      const s = String(raw || '');
      if (s.startsWith('{') || s.startsWith('[')) {
        try {
          const p = JSON.parse(s);
          if (typeof p?.text === 'string') return p.text;
          if (typeof p?.bucket === 'string') return p.bucket;
        } catch {}
      }
      return s;
    };

    const parseDegradedCategory = (raw: any): string => {
      const s = String(raw || '');
      if (s.startsWith('{') || s.startsWith('[')) {
        try {
          const p = JSON.parse(s);
          // Shape: {"details": {"category_ranking": {"Quality": 0.002, ...}}}
          const ranking = p?.details?.category_ranking;
          if (ranking && typeof ranking === 'object') {
            // Return the key with the highest value
            const top = Object.entries(ranking).sort((a, b) => (b[1] as number) - (a[1] as number))[0];
            if (top) return String(top[0]);
          }
          if (typeof p?.category === 'string') return p.category;
          if (typeof p?.text === 'string') return p.text;
        } catch {}
      }
      return s;
    };

    const tableRows = rows.map((r) => ({
      USID: String(r.USID || '—'),
      'Degraded KPI': parseDegradedCategory(r.degraded_category),
      'CQX Value': r.impact_score != null ? Number(r.impact_score).toFixed(2) : '—',
      'RCA Category': parseRcaBucket(r.rca_bucket) || String(r.degraded_category || '—'),
      __shortSummaryTooltip: String(r.short_summary || ''),
    }));

    const llmText = clampString(
      `Found ${rows.length} worst offenders for ${dateId}:\n` +
        tableRows.map((r, i) => `${i + 1}. ${r.USID} — ${r['RCA Category']}`).join('\n'),
    );

    return {
      llmText,
      uiBlock: {
        type: 'data_table',
        title: `Worst Offenders · ${dateId}`,
        data: { title: `Worst Offenders · ${dateId}`, rows: tableRows, rowTooltipField: '__shortSummaryTooltip' },
      },
    };
  },
};

/** Get root-cause analysis for a specific site on a specific date. */
const tool_get_site_rca: AgentTool = {
  name: 'get_site_rca',
  description:
    'Get the root-cause analysis for a degraded site. Returns the RCA bucket, ' +
    'short summary, and reasoning intuitions. Use when the user asks "why is site X ' +
    'degraded?", "explain RCA", "root cause of site Y".',
  parameters: {
    type: 'object',
    properties: {
      siteId: { type: 'string', description: 'Site ID (real USID or display ID).' },
      date: {
        type: 'string',
        description: 'Date in YYYY-MM-DD. Defaults to 3 days ago.',
      },
    },
    required: ['siteId'],
  },
  async execute(args) {
    const rawId = String(args.siteId || '').trim();
    if (!rawId) return { llmText: 'siteId is required.' };
    const siteId = sanitizeSiteId(rawId);
    const startDate = sanitizeDate(String(args.date || todayMinus(3)));

    const found = await withDateFallback(async (dateId) => {
      const sql = `SELECT TOP 1
        USID, CAST(DATE_ID AS DATE) as date_id,
        rca_bucket, short_summary, chain_of_thought
      FROM site_table WITH (NOLOCK)
      WHERE USID = '${siteId}'
        AND CAST(DATE_ID AS DATE) = CAST('${dateId}' AS DATE)
        AND chain_of_thought IS NOT NULL`;
      return remoteDb.query(sql);
    }, startDate);

    if (!found) {
      return { llmText: `No RCA found for site ${siteId} near ${startDate}. Site may not be in the degraded set or AI analysis not yet run.` };
    }

    const { rows, dateId } = found;
    const row = rows[0];
    const summary = String(row.short_summary || '').slice(0, 600);
    const bucket = String(row.rca_bucket || 'Unknown');
    const chainOfThought = row.chain_of_thought ? String(row.chain_of_thought).slice(0, 3000) : undefined;

    const llmText = clampString(
      `RCA for site ${siteId} on ${dateId}:\nBucket: ${bucket}\nSummary: ${summary}`,
    );
    return {
      llmText,
      uiBlock: {
        type: 'rca_summary',
        title: `RCA · ${siteId}`,
        data: { siteId, date: dateId, bucket, summary, chainOfThought },
      },
    };
  },
};

/** Get the latest KPIs for a site (for "site health" / "site overview" queries). */
const tool_get_site_kpis: AgentTool = {
  name: 'get_site_kpis',
  description:
    'Get the latest KPI snapshot for a single site (throughput, accessibility, ' +
    'retention, etc.). Use for "site health", "site overview", "how is site X doing?".',
  parameters: {
    type: 'object',
    properties: {
      siteId: { type: 'string', description: 'Site USID or display ID.' },
    },
    required: ['siteId'],
  },
  async execute(args) {
    const rawId = String(args.siteId || '').trim();
    if (!rawId) return { llmText: 'siteId is required.' };
    const siteId = sanitizeSiteId(rawId);
    const startDate = sanitizeDate(String(args.date || todayMinus(3)));

    const found = await withDateFallback(async (dateId) => {
      const sql = `SELECT TOP 30
        kpi_name, AVG(CAST(kpi_value AS FLOAT)) as kpi_value,
        CAST(MAX(DATE_ID) AS DATE) as date_id
      FROM intermediate_kpi_table WITH (NOLOCK)
      WHERE USID = '${siteId}'
        AND CAST(DATE_ID AS DATE) = CAST('${dateId}' AS DATE)
      GROUP BY kpi_name
      ORDER BY kpi_name`;
      return remoteDb.query(sql);
    }, startDate);

    if (!found) {
      return { llmText: `No KPI data found for site ${siteId} near ${startDate}.` };
    }

    const { rows, dateId } = found;
    const items = rows.slice(0, 8).map((r: any) => ({
      label: String(r.kpi_name).replace(/_/g, ' '),
      value: r.kpi_value != null ? String(Number(r.kpi_value).toPrecision(4)) : '—',
    }));
    const llmText = clampString(
      `KPIs for ${siteId} on ${dateId}:\n` +
        rows.map((r: any) => `• ${r.kpi_name} = ${r.kpi_value}`).join('\n'),
    );
    return {
      llmText,
      uiBlock: { type: 'stat_row', title: `${siteId} · KPIs · ${dateId}`, data: { items } },
    };
  },
};

/** Render the inline KPI dashboard for a site. */
const tool_show_kpi_dashboard: AgentTool = {
  name: 'show_kpi_dashboard',
  description:
    'Render an interactive KPI trend dashboard for a site directly in the chat. ' +
    'Use for ALL of these: "dashboard for site X", "show KPI dashboard", "create a dashboard for X", ' +
    '"show me DL_VOL_GB for site 9817", "plot DATA_DROP_RATE for 13081", ' +
    '"trend of AVG_DL_PRB_UTIL for USID 9817", "show KPI X for site Y", ' +
    '"chart KPI X for site Y over N days" — any KPI visualization request for a specific site. ' +
    'ALWAYS prefer this over query_data when the user names a specific site/USID. ' +
    'For MULTIPLE KPIs pass all names in the kpiNames array — the dashboard renders all together. ' +
    'User can also interactively add/remove KPIs from the rendered dashboard.',
  parameters: {
    type: 'object',
    properties: {
      siteId: {
        type: 'string',
        description: 'Site USID or display ID (e.g. "9817", "13081").',
      },
      kpiNames: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional KPI name(s) to display (e.g. ["DL_VOL_GB"] or ["DATA_DROP_RATE", "AVG_DL_PRB_UTIL"]). ' +
          'Omit to show the full site dashboard with all standard KPIs.',
      },
      daysBack: {
        type: 'number',
        description: 'Number of days of history to show (default 30). Use the number from "past N days".',
      },
      timeframe: {
        type: 'string',
        enum: ['daily', 'hourly'],
        description: 'daily (default) or hourly granularity.',
      },
    },
    required: ['siteId'],
  },
  async execute(args) {
    const siteId = String(args.siteId || '').trim();
    if (!siteId) return { llmText: 'siteId is required.' };
    const kpiNames =
      Array.isArray(args.kpiNames) && args.kpiNames.length
        ? args.kpiNames
            .filter((k: any) => typeof k === 'string' && k.trim())
            .map((k: any) => String(k).trim().toUpperCase())
        : undefined;
    const daysBack = Math.min(90, Math.max(1, Number(args.daysBack) || 30));
    const timeframe = args.timeframe === 'hourly' ? 'hourly' : 'daily';
    return {
      llmText: kpiNames?.length
        ? `Rendered KPI dashboard for site ${siteId} showing: ${kpiNames.join(', ')}.`
        : `Rendered KPI dashboard for site ${siteId}.`,
      uiBlock: {
        type: 'kpi_dashboard',
        data: { siteId, timeframe, daysBack, ...(kpiNames ? { kpiNames } : {}) },
      },
    };
  },
};

/** Telecom domain knowledge / parameter lookup. */
const tool_telecom_knowledge: AgentTool = {
  name: 'get_telecom_knowledge',
  description:
    'Look up telecom domain knowledge (parameter definitions, KPI explanations, ' +
    '3GPP standards, vendor-specific behaviour). Use for "what is QRxLevMin?", ' +
    '"explain parameter X", "what does this KPI mean?".',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The user\'s knowledge question.' },
    },
    required: ['question'],
  },
  async execute(args) {
    const question = String(args.question || '').trim();
    if (!question) return { llmText: 'question is required.' };
    try {
      const result = await TelecomKnowledgeService.answerQuestion(question);
      return { llmText: clampString(String((result as any)?.answer || (result as any)?.text || '')) };
    } catch (err) {
      return { llmText: `Knowledge lookup failed: ${(err as Error).message}` };
    }
  },
};

/** Switch the map's site-status layer. */
const tool_set_map_layer: AgentTool = {
  name: 'set_map_layer',
  description:
    'Switch the map view to highlight a specific site category. Use when user says ' +
    '"show degraded sites", "highlight outages", "show overutilized cells".',
  parameters: {
    type: 'object',
    properties: {
      layer: {
        type: 'string',
        enum: ['degraded', 'outage', 'overutilized'],
        description: 'Which site category to highlight.',
      },
    },
    required: ['layer'],
  },
  async execute(args) {
    const layer = String(args.layer || 'degraded') as 'degraded' | 'outage' | 'overutilized';
    return {
      llmText: `Map layer set to "${layer}".`,
      uiCommand: { type: 'set_layer', payload: { layer } },
    };
  },
};

/** Navigate to a specific app view. */
const tool_navigate_to: AgentTool = {
  name: 'navigate_to',
  description:
    'Navigate the user to a different app view. Use for "open observe", ' +
    '"go to settings", "show me the app builder", "take me to provision".',
  parameters: {
    type: 'object',
    properties: {
      view: {
        type: 'string',
        enum: ['observe', 'home', 'appgen', 'provision', 'settings'],
      },
    },
    required: ['view'],
  },
  async execute(args) {
    const view = String(args.view || 'home');
    return {
      llmText: `Navigated to ${view}.`,
      uiCommand: { type: 'open_view', payload: { view } },
    };
  },
};

/** Resolve a site name / partial id to a real USID. */
const tool_find_site: AgentTool = {
  name: 'find_site',
  description:
    'Look up a site by partial ID, full USID, or site name. Returns the canonical ' +
    'USID + display name. Use this BEFORE other site-specific tools when the user ' +
    'gives an ambiguous identifier (e.g. "site 9817", "the Phoenix site").',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Partial site ID or name to search for.' },
    },
    required: ['query'],
  },
  async execute(args) {
    const q = sanitizeSiteId(String(args.query || '').trim());
    if (!q) return { llmText: 'query is required.' };

    try {
      const sql = `SELECT TOP 5 DISTINCT USID
        FROM site_table WITH (NOLOCK)
        WHERE USID LIKE '%${q}%'
        ORDER BY USID`;
      const rows = await remoteDb.query(sql);
      if (!rows.length) return { llmText: `No site found matching "${q}". Try a different partial USID.` };
      const llmText = `Found ${rows.length} matching site(s):\n` +
        rows.map((r: any) => `• USID=${r.USID}`).join('\n');
      return { llmText };
    } catch (err) {
      return { llmText: `Site lookup failed: ${(err as Error).message}` };
    }
  },
};

// ─── MSSQL schema context for LLM SQL generation ────────────────────────────

/**
 * Build the full LLM system prompt for T-SQL generation.
 * Uses the live schema reference (populated from DB at startup; falls back to
 * the static full schema when the DB is unreachable).
 */
function getMssqlSchemaPrompt(): string {
  const schemaBlock = dbSchemaRef.buildSchemaPrompt();
  return `You are a T-SQL expert for a telecom network SQL Server database.
Convert the user's natural language request into a safe, read-only SELECT query.

${schemaBlock}

─────────────────────────────────────────
CRITICAL — CHOOSE THE RIGHT FILTER:
- "degraded sites" / "offenders" / site counts over time → WHERE degraded_category IS NOT NULL
  (covers ALL degraded records including recent dates where AI has not yet run)
- "RCA" / "root cause" / "rca_bucket" / "chain of thought" queries → WHERE chain_of_thought IS NOT NULL
  (only records where AI analysis completed — will miss recent dates if pipeline is behind)
- NEVER use chain_of_thought IS NOT NULL for general degraded-site counts — it truncates recent data

QUERY RULES:
- Use T-SQL syntax: SELECT TOP N (not LIMIT), WITH (NOLOCK)
- ONLY SELECT statements — no INSERT/UPDATE/DELETE/DROP
- Trend/time-series queries: SELECT TOP 500 (one row per date after GROUP BY, 30 days = 30 rows)
- Snapshot/list queries: SELECT TOP 50
- For trend queries: GROUP BY CAST(DATE_ID AS DATE) only — one row per date
- Date RANGE ("over the past N days" / "last N days"): use DATE_ID >= DATEADD(day, -N, GETDATE())
- Point-in-time ("on date X" / snapshot): use CAST(DATE_ID AS DATE) = CAST('YYYY-MM-DD' AS DATE)
- RCA category filter: rca_bucket LIKE '%keyword%' — split multi-word categories into separate LIKE clauses
- Default point-in-time date: use the context date provided below

EXAMPLES:
Q: "Count of degraded network sites per day for last 30 days"
A: SELECT TOP 500 CAST(DATE_ID AS DATE) as date, COUNT(DISTINCT USID) as degraded_site_count
   FROM site_table WITH (NOLOCK)
   WHERE degraded_category IS NOT NULL
   AND DATE_ID >= DATEADD(day, -30, GETDATE())
   GROUP BY CAST(DATE_ID AS DATE)
   ORDER BY date ASC

Q: "Show drop rate trend over the last 7 days"
A: SELECT TOP 500 CAST(DATE_ID AS DATE) as date, AVG(kpi_value) as avg_drop_rate
   FROM intermediate_kpi_table WITH (NOLOCK)
   WHERE kpi_name = 'DATA_DROP_RATE'
   AND DATE_ID >= DATEADD(day, -7, GETDATE())
   GROUP BY CAST(DATE_ID AS DATE)
   ORDER BY date ASC

Q: "Top 10 worst sites by degradation impact"
A: SELECT TOP 10 s.USID, s.degraded_category, sc.subcomponent_value as impact
   FROM site_table s WITH (NOLOCK)
   JOIN subcomponent_table sc WITH (NOLOCK) ON s.USID = sc.USID AND s.DATE_ID = sc.DATE_ID
   WHERE s.chain_of_thought IS NOT NULL
   AND sc.subcomponent_name = 'Total_Impact_Mkt_CQX_Delta'
   AND CAST(s.DATE_ID AS DATE) = CAST('${todayMinus(3)}' AS DATE)
   ORDER BY sc.subcomponent_value DESC

Q: "Distribution of RCA buckets"
A: SELECT TOP 20 rca_bucket, COUNT(*) as site_count
   FROM site_table WITH (NOLOCK)
   WHERE chain_of_thought IS NOT NULL
   AND CAST(DATE_ID AS DATE) = CAST('${todayMinus(3)}' AS DATE)
   GROUP BY rca_bucket
   ORDER BY site_count DESC

Q: "Show me the trend for tickets for USID 9817 for past 30 days"
A: SELECT CAST(CREATE_TIME AS DATE) as date, COUNT(*) as ticket_count
   FROM ticket_table WITH (NOLOCK)
   WHERE USID = '9817'
   AND CREATE_TIME >= DATEADD(day, -30, GETDATE())
   GROUP BY CAST(CREATE_TIME AS DATE)
   ORDER BY date ASC

NOTE: For ticket queries, use ticket_table (not site_table). Key columns: USID, TICKET_NUMBER,
TICKET_STATUS, CREATE_TIME, SHORT_DESCRIPTION, PROBLEM_CATEGORY, PROBLEM_SUBCATEGORY.

Q: "Trend of Outage Neighbor RCA cases over the past 30 days"
A: SELECT TOP 500 CAST(DATE_ID AS DATE) as date, COUNT(*) as case_count
   FROM site_table WITH (NOLOCK)
   WHERE chain_of_thought IS NOT NULL
   AND rca_bucket LIKE '%Outage%' AND rca_bucket LIKE '%Neighbor%'
   AND DATE_ID >= DATEADD(day, -30, GETDATE())
   GROUP BY CAST(DATE_ID AS DATE)
   ORDER BY date ASC

Q: "Give me a trend for DL_VOL_GB over past 30 days for USID 9817"
A: SELECT TOP 500 CAST(DATE_ID AS DATE) as date, AVG(kpi_value) as avg_dl_vol_gb
   FROM intermediate_kpi_table WITH (NOLOCK)
   WHERE kpi_name = 'DL_VOL_GB'
   AND USID = '9817'
   AND DATE_ID >= DATEADD(day, -30, GETDATE())
   GROUP BY CAST(DATE_ID AS DATE)
   ORDER BY date ASC

Q: "Show AVG_DL_PRB_UTIL for site 13081 last 7 days"
A: SELECT TOP 500 CAST(DATE_ID AS DATE) as date, AVG(kpi_value) as avg_prb_util
   FROM intermediate_kpi_table WITH (NOLOCK)
   WHERE kpi_name = 'AVG_DL_PRB_UTIL'
   AND USID = '13081'
   AND DATE_ID >= DATEADD(day, -7, GETDATE())
   GROUP BY CAST(DATE_ID AS DATE)
   ORDER BY date ASC

USID RULE: When the user mentions a site number or USID (4-6 digit number, or "USID XXXX", or "site XXXX"), ALWAYS add AND USID = '<number>' to the WHERE clause.

KPI NAME RULE: If the user provides an explicit KPI name in ALL_CAPS_WITH_UNDERSCORES format (e.g. DL_VOL_GB, DATA_DROP_RATE), use it verbatim as kpi_name — do not substitute a different name.

CELL RULE: KPI data in intermediate_kpi_table, hourly_intermediate_kpis_table, and kpi_table is cell-level (each row belongs to one cell_name). When querying KPIs for a specific USID, always include cell_name in SELECT and GROUP BY so every cell becomes its own series in the chart. Do NOT average across cells when a USID is specified.

NO TRUNCATION RULE: For per-cell KPI trend queries (USID specified), use SELECT TOP 5000. Return all cells × all dates — do not limit or collapse them. For network-wide aggregates (no USID), use SELECT TOP 500 grouped by date only.

Respond with ONLY the SQL query, no explanation, no markdown.`;
}

/**
 * If the LLM omits GROUP BY on an aggregate query, inject it automatically.
 * Handles the common pattern: SELECT TOP N <expr> as alias, COUNT(...) as alias FROM ...
 */
function ensureGroupBy(sql: string): string {
  if (!/\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(sql)) return sql;
  if (/\bGROUP\s+BY\b/i.test(sql)) return sql;

  // Extract the SELECT list (between SELECT [TOP N] and FROM)
  const selectMatch = sql.match(/SELECT(?:\s+TOP\s+\d+)?\s+([\s\S]+?)\s+FROM\b/i);
  if (!selectMatch) return sql;

  const colExprs = selectMatch[1].split(',').map((s) => s.trim());
  const nonAgg: string[] = [];
  for (const expr of colExprs) {
    if (!/\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(expr)) {
      // Strip trailing alias (AS word)
      const withoutAlias = expr.replace(/\s+AS\s+\w+\s*$/i, '').trim();
      if (withoutAlias) nonAgg.push(withoutAlias);
    }
  }
  if (nonAgg.length === 0) return sql;

  const groupBy = `GROUP BY ${nonAgg.join(', ')}`;
  if (/\bORDER\s+BY\b/i.test(sql)) {
    return sql.replace(/(\bORDER\s+BY\b)/i, `${groupBy}\n$1`);
  }
  return `${sql}\n${groupBy}`;
}

async function generateMssqlQuery(naturalLanguageQuery: string, dateHint?: string): Promise<string> {
  const dateContext = dateHint ? `\nContext date: ${dateHint}` : `\nContext date: ${todayMinus(3)}`;

  // LLM path
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'dummy-key') {
    try {
      const resp = await openai.chat.completions.create({
        model: process.env.OPENAI_AGENT_MODEL || 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: getMssqlSchemaPrompt() + dateContext },
          { role: 'user', content: naturalLanguageQuery },
        ],
        temperature: 0.05,
        max_tokens: 600,
      });
      const raw = (resp.choices[0].message.content || '').replace(/```sql|```/gi, '').trim();
      const sql = ensureGroupBy(raw);
      if (sql.toUpperCase().startsWith('SELECT')) return sql;
    } catch (err) {
      logger.warn('[query_data] LLM SQL generation failed, using fallback', err);
    }
  }

  // Deterministic fallback — covers the most common queries
  const q = naturalLanguageQuery.toLowerCase();
  const date = dateHint || todayMinus(3);

  // Extract USID: "USID 9817", "for 9817", "UST9817", or any 4-6 digit non-year number
  const usidRaw =
    naturalLanguageQuery.match(/\bUSID\s+(\d{4,6})\b/i)?.[1] ??
    naturalLanguageQuery.match(/\bUST0*(\d{4,8})\b/i)?.[1] ??
    naturalLanguageQuery.match(/\bsite\s+(\d{4,6})\b/i)?.[1] ??
    naturalLanguageQuery.match(/\bfor\s+(\d{4,6})\b/i)?.[1] ??
    [...naturalLanguageQuery.matchAll(/\b(\d{4,6})\b/g)]
      .map((m) => m[1])
      .find((n) => { const v = parseInt(n, 10); return !(n.length === 4 && v >= 1900 && v <= 2099); });
  const usidClause = usidRaw ? `AND USID = '${usidRaw.replace(/\D/g, '')}'` : '';

  // Extract explicit KPI name: ALL_CAPS_WITH_UNDERSCORES token (e.g. DL_VOL_GB)
  const SQL_KEYWORDS = new Set(['SELECT', 'FROM', 'WHERE', 'GROUP', 'ORDER', 'CAST', 'NOLOCK', 'USID', 'DATE', 'GETDATE', 'DATEADD', 'TOP', 'AND', 'NOT', 'NULL', 'DESC', 'ASC', 'JOIN', 'WITH']);
  const explicitKpiMatch = naturalLanguageQuery.match(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/);
  const explicitKpiName = explicitKpiMatch && !SQL_KEYWORDS.has(explicitKpiMatch[1]) ? explicitKpiMatch[1] : null;

  // Extract "past/last N days" temporal range
  const pastNMatch = q.match(/(?:past|last|over\s+(?:the\s+)?(?:past|last))\s+(\d+)\s+days?/);
  const pastDays = pastNMatch ? parseInt(pastNMatch[1], 10) : null;
  const isTrend = q.includes('trend') || q.includes('over time') || q.includes('daily') || pastDays != null;

  // Handle explicit KPI name queries (user typed the exact kpi_name like DL_VOL_GB)
  if (explicitKpiName && (isTrend || usidRaw)) {
    const days = pastDays || 14;
    const alias = explicitKpiName.toLowerCase();
    if (isTrend) {
      if (usidRaw) {
        // Per-cell trend for a specific site — one series per cell
        return `SELECT TOP 5000 CAST(DATE_ID AS DATE) as date, cell_name, AVG(kpi_value) as avg_${alias}
FROM intermediate_kpi_table WITH (NOLOCK)
WHERE kpi_name = '${explicitKpiName}' ${usidClause}
AND DATE_ID >= DATEADD(day, -${days}, GETDATE())
GROUP BY CAST(DATE_ID AS DATE), cell_name ORDER BY date ASC, cell_name ASC`;
      }
      // Network-wide aggregated trend (no USID)
      return `SELECT TOP 500 CAST(DATE_ID AS DATE) as date, AVG(kpi_value) as avg_${alias}
FROM intermediate_kpi_table WITH (NOLOCK)
WHERE kpi_name = '${explicitKpiName}'
AND DATE_ID >= DATEADD(day, -${days}, GETDATE())
GROUP BY CAST(DATE_ID AS DATE) ORDER BY date ASC`;
    }
    return `SELECT TOP 200 USID, cell_name, kpi_value as ${alias}
FROM intermediate_kpi_table WITH (NOLOCK)
WHERE kpi_name = '${explicitKpiName}' ${usidClause}
AND CAST(DATE_ID AS DATE) = CAST('${date}' AS DATE)
ORDER BY ${alias} DESC`;
  }

  // Extract RCA category terms: words before "rca" or "cases" that aren't common stop words
  function extractRcaTerms(): string[] {
    const stop = new Set(['trend', 'number', 'count', 'cases', 'sites', 'over', 'past', 'last', 'days', 'the', 'of', 'how', 'many', 'show', 'give', 'total', 'per', 'day', 'and']);
    const m = q.match(/([a-z ]+?)\s+(?:rca|cases)/);
    if (!m) return [];
    return m[1].trim().split(/\s+/).filter((w) => w.length > 3 && !stop.has(w));
  }

  // Helper: build a KPI trend query, per-cell when USID is known
  function kpiTrend(kpiName: string, alias: string, days: number): string {
    if (usidRaw) {
      return `SELECT TOP 5000 CAST(DATE_ID AS DATE) as date, cell_name, AVG(kpi_value) as avg_${alias}
FROM intermediate_kpi_table WITH (NOLOCK)
WHERE kpi_name = '${kpiName}' ${usidClause}
AND DATE_ID >= DATEADD(day, -${days}, GETDATE())
GROUP BY CAST(DATE_ID AS DATE), cell_name ORDER BY date ASC, cell_name ASC`;
    }
    return `SELECT TOP 500 CAST(DATE_ID AS DATE) as date, AVG(kpi_value) as avg_${alias}
FROM intermediate_kpi_table WITH (NOLOCK)
WHERE kpi_name = '${kpiName}'
AND DATE_ID >= DATEADD(day, -${days}, GETDATE())
GROUP BY CAST(DATE_ID AS DATE) ORDER BY date ASC`;
  }

  if (q.includes('drop rate') || q.includes('drop_rate')) {
    const days = pastDays || 14;
    if (isTrend) return kpiTrend('DATA_DROP_RATE', 'drop_rate', days);
    return `SELECT TOP 50 USID, cell_name, AVG(kpi_value) as avg_drop_rate
FROM intermediate_kpi_table WITH (NOLOCK)
WHERE kpi_name = 'DATA_DROP_RATE' ${usidClause} AND CAST(DATE_ID AS DATE) = CAST('${date}' AS DATE)
GROUP BY USID, cell_name ORDER BY avg_drop_rate DESC`;
  }

  if (q.includes('throughput') || q.includes('tput') || q.includes('dl_drb')) {
    return kpiTrend('DL_DRB_TPUT', 'throughput_mbps', pastDays || 14);
  }

  if (q.includes('prb') || q.includes('utiliz')) {
    return kpiTrend('AVG_DL_PRB_UTIL', 'prb_util_pct', pastDays || 14);
  }

  if (q.includes('accessibility') || q.includes('acc_rate')) {
    return kpiTrend('DATA_ACC_RATE', 'acc_rate', pastDays || 14);
  }

  if (q.includes('handover') || q.includes('ho_fail')) {
    return kpiTrend('HO_FAIL_RATE', 'ho_fail_rate', pastDays || 14);
  }

  if (q.includes('rrc')) {
    return kpiTrend('RRC_FAILURE_RATE', 'rrc_fail_rate', pastDays || 14);
  }

  if (q.includes('rca') || q.includes('root cause') || q.includes('bucket') || q.includes('distribution')) {
    if (isTrend) {
      // Time-series count of RCA cases, optionally filtered by category keywords
      const days = pastDays || 14;
      const rcaTerms = extractRcaTerms();
      const likeFilters = rcaTerms.map((t) => `rca_bucket LIKE '%${t}%'`);
      const allFilters = ['chain_of_thought IS NOT NULL', ...likeFilters, `DATE_ID >= DATEADD(day, -${days}, GETDATE())`];
      return `SELECT CAST(DATE_ID AS DATE) as date, COUNT(*) as case_count
FROM site_table WITH (NOLOCK)
WHERE ${allFilters.join('\n   AND ')}
GROUP BY CAST(DATE_ID AS DATE) ORDER BY date ASC`;
    }
    // Point-in-time distribution
    return `SELECT TOP 15 rca_bucket, COUNT(*) as site_count
FROM site_table WITH (NOLOCK)
WHERE chain_of_thought IS NOT NULL AND CAST(DATE_ID AS DATE) = CAST('${date}' AS DATE)
GROUP BY rca_bucket ORDER BY site_count DESC`;
  }

  if (q.includes('offender') || q.includes('worst') || q.includes('impact')) {
    if (isTrend) {
      const days = pastDays || 14;
      return `SELECT TOP 500 CAST(DATE_ID AS DATE) as date, COUNT(DISTINCT USID) as offender_count
FROM site_table WITH (NOLOCK)
WHERE chain_of_thought IS NOT NULL AND DATE_ID >= DATEADD(day, -${days}, GETDATE())
GROUP BY CAST(DATE_ID AS DATE) ORDER BY date ASC`;
    }
    return `SELECT TOP 20 s.USID, s.degraded_category, sc.subcomponent_value as impact_score
FROM site_table s WITH (NOLOCK)
JOIN subcomponent_table sc WITH (NOLOCK) ON s.USID = sc.USID AND CAST(s.DATE_ID AS DATE) = CAST(sc.DATE_ID AS DATE)
WHERE s.chain_of_thought IS NOT NULL AND sc.subcomponent_name = 'Total_Impact_Mkt_CQX_Delta'
AND CAST(s.DATE_ID AS DATE) = CAST('${date}' AS DATE)
ORDER BY sc.subcomponent_value DESC`;
  }

  if (q.includes('degraded')) {
    const days = pastDays || 30;
    if (isTrend) {
      return `SELECT TOP 500 CAST(DATE_ID AS DATE) as date, COUNT(DISTINCT USID) as degraded_site_count
FROM site_table WITH (NOLOCK)
WHERE degraded_category IS NOT NULL AND DATE_ID >= DATEADD(day, -${days}, GETDATE())
GROUP BY CAST(DATE_ID AS DATE) ORDER BY date ASC`;
    }
    return `SELECT TOP 20 USID, degraded_category, rca_bucket
FROM site_table WITH (NOLOCK)
WHERE degraded_category IS NOT NULL AND CAST(DATE_ID AS DATE) = CAST('${date}' AS DATE)
ORDER BY USID`;
  }

  if (q.includes('ticket') || q.includes('trouble ticket') || q.includes('incident')) {
    const days = pastDays || 30;
    if (isTrend) {
      const usidFilter = usidRaw ? `\nAND USID = '${usidRaw}'` : '';
      return `SELECT CAST(CREATE_TIME AS DATE) as date, COUNT(*) as ticket_count
FROM ticket_table WITH (NOLOCK)
WHERE CREATE_TIME >= DATEADD(day, -${days}, GETDATE())${usidFilter}
GROUP BY CAST(CREATE_TIME AS DATE) ORDER BY date ASC`;
    }
    return `SELECT TOP 50 USID, TICKET_NUMBER, TICKET_STATUS, CREATE_TIME,
  SHORT_DESCRIPTION, PROBLEM_CATEGORY, PROBLEM_SUBCATEGORY, ASSIGNED_DEPARTMENT
FROM ticket_table WITH (NOLOCK)
WHERE CREATE_TIME >= DATEADD(day, -${days}, GETDATE())
${usidRaw ? `AND USID = '${usidRaw}'` : ''}
ORDER BY CREATE_TIME DESC`;
  }

  // Default: show recent degraded sites (use degraded_category for full coverage)
  return `SELECT TOP 20 USID, degraded_category, rca_bucket
FROM site_table WITH (NOLOCK)
WHERE degraded_category IS NOT NULL AND CAST(DATE_ID AS DATE) = CAST('${date}' AS DATE)
ORDER BY USID`;
}

/**
 * Run a natural language query against the remote MSSQL network DB
 * and render results as a chart or table directly in the chat.
 */
const tool_query_data: AgentTool = {
  name: 'query_data',
  description:
    'Query the network database with natural language and instantly visualize the ' +
    'results as a chart or table in the chat. Use for: "show me...", "chart the...", ' +
    '"visualize...", "plot...", "what is the trend of...", "compare...", ' +
    '"how many sites have...", "analyze..." — any request that needs live data + a visual.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language description of the data you want.',
      },
      dateId: {
        type: 'string',
        description: 'Optional date context (YYYY-MM-DD). Defaults to 3 days ago.',
      },
    },
    required: ['query'],
  },
  async execute(args) {
    const query = String(args.query || '').trim();
    const dateId = args.dateId ? String(args.dateId) : todayMinus(3);
    if (!query) return { llmText: 'query is required.' };

    const start = Date.now();
    let sql = '';
    try {
      // 1. Generate T-SQL for remote MSSQL
      sql = await generateMssqlQuery(query, dateId);
      logger.info(`[tool:query_data] SQL: ${sql.slice(0, 200)}`);

      // 2. Execute via remote DB connector
      const rows: Record<string, any>[] = await remoteDb.query(sql);
      const execMs = Date.now() - start;

      if (!rows.length) {
        return {
          llmText: `Query returned 0 rows for: "${query}"`,
          uiBlock: {
            type: 'callout',
            data: { tone: 'info', title: 'No data found', text: `No rows returned for this query on ${dateId}.` },
          },
        };
      }

      // 3. Generate chart
      const chart = await ChartGeneratorService.generateChartOption(rows, query);
      const execSummary = `${rows.length} rows · ${execMs}ms`;
      const sqlSnippet = sql.replace(/\s+/g, ' ').trim().slice(0, 120);

      if (chart.preferTable) {
        return {
          llmText: `Query returned ${rows.length} rows. Displayed as table.`,
          uiBlock: {
            type: 'data_table',
            title: chart.title,
            data: { title: chart.title, rows: rows.slice(0, 200) },
          },
        };
      }

      const seriesCount = Array.isArray(chart.echartsOption.series) ? chart.echartsOption.series.length : 1;
      const chartHeight = seriesCount > 8 ? 480 : seriesCount > 3 ? 400 : 340;

      return {
        llmText: `Query returned ${rows.length} rows in ${execMs}ms. Rendered as ${chart.chartType} chart.`,
        uiBlock: {
          type: 'insight_chart',
          title: chart.title,
          data: {
            title: chart.title,
            subtitle: chart.subtitle ? `${chart.subtitle} · ${execSummary}` : execSummary,
            source: sqlSnippet,
            height: chartHeight,
            echartsOption: chart.echartsOption,
          },
        },
      };
    } catch (err) {
      logger.warn('[tool:query_data] failed', err);
      return { llmText: `Data query failed: ${(err as Error).message}${sql ? `\nSQL attempted: ${sql.slice(0, 200)}` : ''}` };
    }
  },
};

/**
 * Generate a multi-panel tabbed report with several charts for a topic.
 */
const tool_generate_report: AgentTool = {
  name: 'generate_report',
  description:
    'Generate a multi-panel visual report with several charts for a given topic. ' +
    'Use when the user asks for "create a report on...", "full analysis of...", ' +
    '"give me a dashboard for...", "comprehensive view of...", "report on network performance".',
  parameters: {
    type: 'object',
    properties: {
      topic: {
        type: 'string',
        description: 'Report topic. E.g. "site degradation", "KPI performance", "network health".',
      },
      dateId: {
        type: 'string',
        description: 'Date filter (YYYY-MM-DD). Defaults to 3 days ago.',
      },
    },
    required: ['topic'],
  },
  async execute(args) {
    const topic = String(args.topic || '').trim();
    const dateId = args.dateId ? String(args.dateId) : todayMinus(3);
    if (!topic) return { llmText: 'topic is required.' };

    // Fixed report panels — each is a direct T-SQL query relevant to any network topic
    const reportQueries: Array<{ label: string; sql: string }> = [
      {
        label: 'RCA Breakdown',
        sql: `SELECT TOP 15 rca_bucket, COUNT(*) as site_count
FROM site_table WITH (NOLOCK)
WHERE chain_of_thought IS NOT NULL AND CAST(DATE_ID AS DATE) = CAST('${dateId}' AS DATE)
GROUP BY rca_bucket ORDER BY site_count DESC`,
      },
      {
        label: 'Drop Rate Trend',
        sql: `SELECT CAST(DATE_ID AS DATE) as date, AVG(kpi_value) as avg_drop_rate
FROM intermediate_kpi_table WITH (NOLOCK)
WHERE kpi_name = 'DATA_DROP_RATE' AND DATE_ID >= CAST('${todayMinus(14)}' AS DATETIME)
GROUP BY CAST(DATE_ID AS DATE) ORDER BY date ASC`,
      },
      {
        label: 'Top Offenders',
        sql: `SELECT TOP 15 s.USID, s.degraded_category, sc.subcomponent_value as impact
FROM site_table s WITH (NOLOCK)
JOIN subcomponent_table sc WITH (NOLOCK) ON s.USID = sc.USID AND CAST(s.DATE_ID AS DATE) = CAST(sc.DATE_ID AS DATE)
WHERE s.chain_of_thought IS NOT NULL AND sc.subcomponent_name = 'Total_Impact_Mkt_CQX_Delta'
AND CAST(s.DATE_ID AS DATE) = CAST('${dateId}' AS DATE)
ORDER BY sc.subcomponent_value DESC`,
      },
    ];

    interface PanelResult { label: string; title: string; echartsOption: Record<string, any> }
    const panels: PanelResult[] = [];

    for (const { label, sql } of reportQueries) {
      try {
        const rows: Record<string, any>[] = await remoteDb.query(sql);
        if (!rows.length) continue;
        const chart = await ChartGeneratorService.generateChartOption(rows, label);
        if (!chart.preferTable && Object.keys(chart.echartsOption).length > 0) {
          panels.push({ label, title: chart.title, echartsOption: chart.echartsOption });
        }
      } catch (err) {
        logger.warn(`[tool:generate_report] panel "${label}" failed`, err);
      }
    }

    if (!panels.length) {
      return { llmText: `No data available for "${topic}" on ${dateId}. The remote database may be unreachable.` };
    }

    if (panels.length === 1) {
      const p = panels[0];
      return {
        llmText: `Generated 1-panel report for "${topic}" on ${dateId}.`,
        uiBlock: {
          type: 'insight_chart',
          title: p.title,
          data: { title: p.title, subtitle: `${topic} · ${dateId}`, echartsOption: p.echartsOption },
        },
      };
    }

    const tabs = panels.map((p, i) => ({
      id: `panel_${i}`,
      label: p.label,
      blocks: [{
        type: 'insight_chart',
        data: { title: p.title, subtitle: `${topic} · ${dateId}`, echartsOption: p.echartsOption },
      }],
    }));

    return {
      llmText: `Generated ${tabs.length}-panel report for "${topic}" on ${dateId}.`,
      uiBlock: { type: 'tabs', title: `${topic} · ${dateId}`, data: { tabs } },
    };
  },
};

// ─── Helpers for resolve_kpi_param ──────────────────────────────────────────

/** Simple similarity score (0–1) used for DB KPI name matching. */
function kpiSimilarity(needle: string, candidate: string): number {
  const n = needle.toUpperCase();
  const c = candidate.toUpperCase();
  if (n === c) return 1.0;
  if (n.includes(c) || c.includes(n)) return 0.85;
  const tokN = new Set(n.split(/[_\W]+/).filter(Boolean));
  const tokC = new Set(c.split(/[_\W]+/).filter(Boolean));
  const inter = [...tokN].filter((t) => tokC.has(t)).length;
  const union = new Set([...tokN, ...tokC]).size;
  const tokenScore = union > 0 ? inter / union : 0;
  const maxLen = Math.max(n.length, c.length);
  // quick n-gram similarity (faster than levenshtein for this step)
  let matches = 0;
  for (let i = 0; i < n.length - 1; i++) {
    if (c.includes(n.slice(i, i + 2))) matches++;
  }
  const bigramScore = n.length > 1 ? matches / (n.length - 1) : 0;
  return tokenScore * 0.55 + bigramScore * 0.45;
}

interface KpiMatch {
  name: string;
  source: 'db_kpi' | 'datadict';
  detail: string;
  score: number;
}

// ─── Tool: resolve_kpi_param ─────────────────────────────────────────────────
const tool_resolve_kpi_param: AgentTool = {
  name: 'resolve_kpi_param',
  description:
    'Fuzzy-match a potentially incorrect, partial, or informal KPI or CM parameter name. ' +
    'Searches two sources: (1) the live DB KPI catalog (analytics KPIs like DL_VOL_GB, HOSR, etc.) ' +
    'and (2) the Ericsson EIAP DataDict (16,038 telco_RAN configuration parameters). ' +
    'Call this whenever the user mentions a KPI or CM parameter name that is not obviously correct — ' +
    'misspelled, abbreviated, informal, or in plain English. ' +
    'Returns the best match(es). If a single high-confidence match is found, use that name ' +
    'in subsequent tool calls. If multiple candidates are found, show chips for user selection.',
  parameters: {
    type: 'object',
    properties: {
      userInput: {
        type: 'string',
        description:
          'The KPI or CM parameter name the user typed — may be misspelled, abbreviated, or informal ' +
          '(e.g. "downlink throughput", "DL_TROUGHPUT", "handover success rate", "drop rate").',
      },
      limit: {
        type: 'number',
        description: 'Max candidates to return (default 5).',
      },
    },
    required: ['userInput'],
  },

  async execute(args): Promise<ToolResult> {
    const userInput = String(args.userInput || '').trim();
    const limit = Math.min(10, Math.max(1, Number(args.limit) || 5));

    if (!userInput) {
      return { llmText: 'No input provided to resolve_kpi_param.' };
    }

    const results: KpiMatch[] = [];
    const needle = userInput.toUpperCase();

    // ── Source 1: DB KPI names (analytics performance KPIs) ──────────────────
    const FALLBACK_KPI_NAMES = [
      'DL_DRB_TPUT', 'AVG_DL_PRB_UTIL', 'DATA_RAN_ACC', 'D_ERB_ATTEMPTS',
      'D_ERB_DROP', 'D_ERB_FAIL', 'DATA_ERB_RET', 'DL_VOL_GB',
      'DL_PKTLOSS_RT', 'ERAB_DROP_CDT', 'RRC_FAIL', 'DUAC_FAIL',
      'UL_DRB_TPUT', 'UL_VOL_GB', 'AVG_UL_PRB_UTIL', 'HOSR', 'CSSR', 'CALL_DROP_RATE',
      'DATA_DROP_RATE',
    ];
    const dbKpis = dbSchemaRef.getKpiNames();
    const kpiCatalog = dbKpis.length > 0 ? dbKpis : FALLBACK_KPI_NAMES;

    // Exact DB KPI match
    const exactDbKpi = kpiCatalog.find((k) => k.toUpperCase() === needle);
    if (exactDbKpi) {
      return {
        llmText: `"${userInput}" is an exact match for DB KPI "${exactDbKpi}". Use this name directly in data queries.`,
      };
    }

    for (const kpiName of kpiCatalog) {
      const score = kpiSimilarity(needle, kpiName);
      if (score >= 0.3) {
        results.push({ name: kpiName, source: 'db_kpi', detail: 'Analytics KPI', score });
      }
    }

    // ── Source 2: DataDict CM parameters ─────────────────────────────────────
    if (dataDictResolver.isLoaded) {
      const ddMatches = dataDictResolver.fuzzyMatch(userInput, { limit, minScore: 0.4 });
      for (const m of ddMatches) {
        results.push({
          name: m.paramName,
          source: 'datadict',
          detail: [m.structureName, m.category, m.dataType].filter(Boolean).join(' · '),
          score: m.score,
        });
      }
    }

    if (results.length === 0) {
      return {
        llmText: `No match found for "${userInput}" in either the DB KPI catalog or DataDict. ` +
          `Ask the user to check the spelling or provide the exact parameter name.`,
      };
    }

    // Deduplicate and sort
    const seen = new Set<string>();
    const deduped = results
      .filter((r) => { const k = r.name.toUpperCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const top = deduped[0];

    // High-confidence single match
    if (top.score >= 0.85 && (deduped.length === 1 || deduped[1].score < top.score - 0.15)) {
      return {
        llmText:
          `Resolved "${userInput}" → "${top.name}" (${top.source === 'db_kpi' ? 'DB KPI' : 'DataDict CM param'}, ` +
          `${(top.score * 100).toFixed(0)}% confidence). ` +
          `Use "${top.name}" in all subsequent data queries.`,
      };
    }

    // Multiple candidates — present chips
    const candidateList = deduped
      .map((m, i) => `${i + 1}. ${m.name} [${m.source}] ${(m.score * 100).toFixed(0)}%`)
      .join('\n');

    return {
      llmText:
        `Found ${deduped.length} possible matches for "${userInput}":\n${candidateList}\n` +
        `Present these to the user as selectable options before proceeding.`,
      uiBlock: {
        type: 'chips',
        title: `Which parameter did you mean by "${userInput}"?`,
        data: {
          prompt: `I found several parameters matching "${userInput}". Which one did you mean?`,
          chips: deduped.map((m) => ({
            label: m.name,
            value: m.name,
            description: `${m.source === 'db_kpi' ? 'Analytics KPI' : 'CM parameter'} · ${m.detail}`,
          })),
        },
      },
    };
  },
};

// ─── Site-analysis tools (Tools 1–10) ────────────────────────────────────────

/** Helper: derive band label from CARRIER + TECH strings */
function deriveBand(carrier: string, tech: string): string {
  const c = String(carrier || '').toUpperCase();
  const t = String(tech || '').toUpperCase();
  if (t === '5G') {
    if (/mmW|28G|39G|37G/i.test(c)) return '5G mmWave';
    if (/n77|n78|C.?BAND|3\.5/i.test(c)) return '5G C-Band (midband)';
    return '5G NR';
  }
  if (/700|_1_|^1_/.test(c)) return '4G Lowband 700';
  if (/1900|_9_|^9_/.test(c)) return '4G PCS 1900 (midband)';
  if (/AWS|1700|_5_|^5_/.test(c)) return '4G AWS (midband)';
  if (/850|_3_|^3_/.test(c)) return '4G CLR 850';
  return `${t || '4G'} ${carrier}`;
}

/** Tool 1 — Full cell/band/sector inventory for a USID */
const tool_get_site_topology: AgentTool = {
  name: 'get_site_topology',
  description:
    'Get the complete cell inventory for a site (USID): all cells, their technology (4G/5G), ' +
    'carrier/band (lowband, PCS, AWS, C-band, mmWave), azimuth, height, and anomaly status. ' +
    'Also returns site-level metadata: name, structure type, cluster, coordinates. ' +
    'Use as the first step in any site investigation to understand what the site looks like.',
  parameters: {
    type: 'object',
    properties: {
      usid: { type: 'string', description: 'Site USID.' },
      date: { type: 'string', description: 'Date YYYY-MM-DD. Defaults to 3 days ago.' },
    },
    required: ['usid'],
  },
  async execute(args) {
    const usid = sanitizeSiteId(String(args.usid || '').trim());
    if (!usid) return { llmText: 'usid is required.' };
    const startDate = sanitizeDate(String(args.date || todayMinus(3)));

    const found = await withDateFallback(async (dateId) => {
      const [cellRows, siteRows] = await Promise.all([
        // Bounded by (USID, single DATE_ID) — naturally yields one row per cell on that day.
        mirrorOrRemote({
          local: {
            sql: `SELECT cell_name,
                         tech AS "TECH",
                         carrier AS "CARRIER",
                         useid AS "USEID",
                         azimuth AS "AZIMUTH",
                         height AS "HEIGHT",
                         anomaly_flag, anomaly_score
                  FROM mirror.cell_table
                  WHERE usid = $1 AND date_id::date = $2::date
                  ORDER BY cell_name`,
            params: [usid, dateId],
          },
          remote: `
            SELECT cell_name, TECH, CARRIER, USEID, AZIMUTH, HEIGHT, anomaly_flag, anomaly_score
            FROM cell_table WITH (NOLOCK)
            WHERE USID = '${usid}' AND CAST(DATE_ID AS DATE) = CAST('${dateId}' AS DATE)
            ORDER BY cell_name`,
          tag: 'get_site_topology.cells',
        }),
        mirrorOrRemote({
          local: {
            sql: `SELECT site_name,
                         site_type AS "SITE_TYPE",
                         structure_tower_type AS "STRUCTURE_TOWER_TYPE",
                         latitude AS "LATITUDE",
                         longitude AS "LONGITUDE",
                         cell_num,
                         clusterid AS "CLUSTERID",
                         clustername AS "CLUSTERNAME",
                         city AS "CITY",
                         state AS "STATE"
                  FROM mirror.site_table
                  WHERE usid = $1 AND date_id::date = $2::date
                  LIMIT 1`,
            params: [usid, dateId],
          },
          remote: `
            SELECT TOP 1 site_name, SITE_TYPE, STRUCTURE_TOWER_TYPE, LATITUDE, LONGITUDE,
              cell_num, CLUSTERID, CLUSTERNAME, CITY, STATE
            FROM site_table WITH (NOLOCK)
            WHERE USID = '${usid}' AND CAST(DATE_ID AS DATE) = CAST('${dateId}' AS DATE)`,
          tag: 'get_site_topology.site',
        }),
      ]);
      return cellRows.length ? [{ cellRows, siteRows }] : [];
    }, startDate);

    if (!found) return { llmText: `No topology data found for USID ${usid} near ${startDate}.` };
    const { cellRows, siteRows } = (found.rows[0] as any);
    const site = siteRows[0] || {};

    const bands = new Set<string>();
    const tiles = cellRows.map((r: any) => {
      const band = deriveBand(String(r.CARRIER || ''), String(r.TECH || ''));
      bands.add(band);
      return {
        cellName: String(r.cell_name || '—'),
        tech: String(r.TECH || ''),
        carrier: String(r.CARRIER || ''),
        band,
        azimuth: r.AZIMUTH != null ? Number(r.AZIMUTH) : null,
        height: r.HEIGHT != null ? Number(r.HEIGHT) : null,
        anomaly: Boolean(r.anomaly_flag),
        anomalyScore: r.anomaly_score != null ? Number(r.anomaly_score) : null,
      };
    });

    const bandsStr = [...bands].join(', ') || 'unknown';
    const anomalousCells = cellRows.filter((r: any) => r.anomaly_flag).length;
    const llmText = clampString(
      `USID ${usid} · ${site.site_name || '?'} · ${site.CITY || ''}, ${site.STATE || ''}\n` +
      `Structure: ${site.SITE_TYPE || '?'} / ${site.STRUCTURE_TOWER_TYPE || '?'}\n` +
      `Cluster: ${site.CLUSTERID || '?'} (${site.CLUSTERNAME || '?'})\n` +
      `Cells: ${cellRows.length} | Bands: ${bandsStr}\n` +
      `Anomalous cells: ${anomalousCells}/${cellRows.length}\n` +
      tiles.map((t: any) => `• ${t.cellName}: ${t.tech} ${t.band} Az=${t.azimuth ?? '—'}° ${t.anomaly ? '⚠' : ''}`).join('\n'),
    );

    return {
      llmText,
      uiBlock: {
        type: 'topology_grid',
        title: `Topology · USID ${usid} · ${found.dateId}`,
        data: {
          title: `Cell Inventory — USID ${usid}`,
          subtitle: found.dateId,
          cells: tiles,
          meta: {
            siteName: String(site.site_name || ''),
            siteType: [site.SITE_TYPE, site.STRUCTURE_TOWER_TYPE].filter(Boolean).join(' / '),
            cluster: String(site.CLUSTERID || ''),
            city: String(site.CITY || ''),
            state: String(site.STATE || ''),
          },
        },
      },
    };
  },
};

/** Tool 2 — Configuration parameter changes (Old→New) for a USID */
const tool_get_config_changes: AgentTool = {
  name: 'get_config_changes',
  description:
    'Get configuration parameter changes (Old Value → New Value) for a site USID over a date range. ' +
    'Bounded by USID + date range. Date range is auto-capped to 30 days; pass a tighter range for faster queries. ' +
    'Returns each changed parameter with its cell/node context and an AI-generated impact note. ' +
    'Use when investigating "what changed?", "parameter changes", "config audit", or as part of RCA.',
  parameters: {
    type: 'object',
    properties: {
      usid: { type: 'string', description: 'Site USID.' },
      startDate: { type: 'string', description: 'Start date YYYY-MM-DD. Defaults to 7 days ago.' },
      endDate: { type: 'string', description: 'End date YYYY-MM-DD. Defaults to 3 days ago.' },
      parameterFilter: { type: 'string', description: 'Optional parameter name substring to filter (e.g. "POWER", "TILT").' },
    },
    required: ['usid'],
  },
  async execute(args) {
    const usid = sanitizeSiteId(String(args.usid || '').trim());
    if (!usid) return { llmText: 'usid is required.' };
    // Bound: USID + date range (≤ 30 days) — every change for the site within the window.
    const range = clampDateRange(
      String(args.startDate || todayMinus(7)),
      String(args.endDate || todayMinus(3)),
      30,
    );
    const startDate = range.startDate;
    const endDate = range.endDate;
    const paramFilter = String(args.parameterFilter || '').replace(/[^A-Za-z0-9_%]/g, '').slice(0, 60);
    const filterClause = paramFilter ? `AND Parameter LIKE '%${paramFilter}%'` : '';

    let rows: any[] = [];
    try {
      const localFilter = paramFilter ? ` AND parameter ILIKE '%${paramFilter}%'` : '';
      rows = await mirrorOrRemote({
        local: {
          sql: `SELECT date_id::date AS date_id,
                       node AS "NODE",
                       subelmt AS cell_name,
                       parameter AS "Parameter",
                       old_value AS "Old_Value",
                       new_value AS "New_Value"
                FROM mirror.configuration_parameters_table
                WHERE usid = $1
                  AND date_id::date BETWEEN $2::date AND $3::date
                  ${localFilter}
                ORDER BY date_id DESC, parameter`,
          params: [usid, startDate, endDate],
        },
        remote: `
          SELECT CAST(DATE_ID AS DATE) as date_id, NODE, SUBELMT as cell_name,
            Parameter, Old_Value, New_Value
          FROM configuration_parameters_table WITH (NOLOCK)
          WHERE USID = '${usid}'
            AND CAST(DATE_ID AS DATE) >= CAST('${startDate}' AS DATE)
            AND CAST(DATE_ID AS DATE) <= CAST('${endDate}' AS DATE)
            ${filterClause}
          ORDER BY DATE_ID DESC, Parameter`,
        tag: 'get_config_changes',
      });
    } catch (err) {
      return { llmText: `Failed to fetch config changes for ${usid}: ${(err as Error).message}` };
    }

    if (!rows.length) {
      return { llmText: `No configuration changes found for USID ${usid} between ${startDate} and ${endDate}${paramFilter ? ` matching "${paramFilter}"` : ''}.` };
    }

    // Per-parameter impact annotation: skip the extra LLM call (5–10s) and
    // instead pass the DataDict description verbatim. The orchestrator's
    // synthesis step already interprets these in the "What Changed" section.
    const uniqueParams = [...new Set(rows.map((r) => String(r.Parameter || '')))].slice(0, 10);
    let impactNote = '';
    if (dataDictResolver.isLoaded && uniqueParams.length) {
      const paramDefs = uniqueParams
        .map((p) => {
          const match = dataDictResolver.fuzzyMatch(p, { limit: 1, minScore: 0.5 });
          const desc = match[0]?.description || match[0]?.paramName;
          return desc ? `• ${p} — ${String(desc).slice(0, 200)}` : `• ${p}`;
        })
        .join('\n');
      impactNote = paramDefs;
    }

    const tableRows = rows.map((r: any) => ({
      Date: String(r.date_id || '').slice(0, 10),
      Cell: String(r.cell_name || '—'),
      Parameter: String(r.Parameter || '—'),
      'Old Value': String(r.Old_Value ?? '—'),
      'New Value': String(r.New_Value ?? '—'),
    }));

    // The llmText is sent to the LLM (4 KB cap via clampString). Show first ~20 in the
    // textual summary; the full set is rendered in the data_table UI below.
    const llmText = clampString(
      `Config changes for USID ${usid} (${startDate} → ${endDate}): ${rows.length} changes\n` +
      tableRows.slice(0, 20).map((r) => `• ${r.Date} ${r.Cell}: ${r.Parameter} ${r['Old Value']} → ${r['New Value']}`).join('\n') +
      (impactNote ? `\n\nPotential impact:\n${impactNote}` : ''),
    );

    return {
      llmText,
      uiBlock: {
        type: 'compact_table',
        title: `Config Changes · USID ${usid} · ${startDate}–${endDate}`,
        data: { title: `Parameter Changes — USID ${usid}`, subtitle: `${startDate}→${endDate}`, rows: tableRows },
      },
    };
  },
};

/** Tool 3 — Neighbor handover relations with distribution analysis */
const tool_get_neighbor_relations: AgentTool = {
  name: 'get_neighbor_relations',
  description:
    'Get the neighbor handover relation map for a USID. Returns all neighbors ranked by handover volume, ' +
    'with HO counts, cumulative %, face (sector), and physical distance. ' +
    'Includes analysis: top-neighbor dominance, distance distribution, HO concentration. ' +
    'Use to understand coverage dependencies and identify potentially missing/broken relations.',
  parameters: {
    type: 'object',
    properties: {
      usid: { type: 'string', description: 'Source site USID.' },
      date: { type: 'string', description: 'Date YYYY-MM-DD. Defaults to 3 days ago.' },
    },
    required: ['usid'],
  },
  async execute(args) {
    const usid = sanitizeSiteId(String(args.usid || '').trim());
    if (!usid) return { llmText: 'usid is required.' };
    const startDate = sanitizeDate(String(args.date || todayMinus(3)));

    const found = await withDateFallback(async (dateId) => {
      return mirrorOrRemote({
        local: {
          sql: `SELECT source_usid AS "SOURCE_USID",
                       neigh_usid AS "NEIGH_USID",
                       source_usid_face AS "SOURCE_USID_FACE",
                       neigh_usid_face AS "NEIGH_USID_FACE",
                       handover_count AS "HANDOVER_COUNT",
                       ho_rank AS "HO_RANK",
                       total_handover AS "TOTAL_HANDOVER",
                       cummulative_sum AS "CUMMULATIVE_SUM",
                       perc_handover AS "PERC_HANDOVER",
                       source_neigh_distance_meters AS "SOURCE_NEIGH_DISTANCE_METERS"
                FROM mirror.neighbors_table_date_id
                WHERE source_usid = $1 AND date_id::date = $2::date
                ORDER BY ho_rank ASC`,
          params: [usid, dateId],
        },
        remote: `
          SELECT SOURCE_USID, NEIGH_USID, SOURCE_USID_FACE, NEIGH_USID_FACE,
            HANDOVER_COUNT, HO_RANK, TOTAL_HANDOVER, CUMMULATIVE_SUM,
            PERC_HANDOVER, SOURCE_NEIGH_DISTANCE_METERS
          FROM neighbors_table_date_id WITH (NOLOCK)
          WHERE SOURCE_USID = '${usid}'
            AND CAST(DATE_ID AS DATE) = CAST('${dateId}' AS DATE)
          ORDER BY HO_RANK ASC`,
        tag: 'get_neighbor_relations',
      });
    }, startDate);

    if (!found || !found.rows.length) {
      return { llmText: `No neighbor relation data found for USID ${usid} near ${startDate}.` };
    }

    const { rows, dateId } = found;

    // Analysis
    const top5HoPct = rows.slice(0, 5).reduce((s: number, r: any) => s + Number(r.PERC_HANDOVER || 0), 0);
    const near = rows.filter((r: any) => Number(r.SOURCE_NEIGH_DISTANCE_METERS) < 500).length;
    const mid = rows.filter((r: any) => { const d = Number(r.SOURCE_NEIGH_DISTANCE_METERS); return d >= 500 && d < 2000; }).length;
    const far = rows.filter((r: any) => Number(r.SOURCE_NEIGH_DISTANCE_METERS) >= 2000).length;
    const top1Pct = Number(rows[0]?.PERC_HANDOVER || 0);
    const dominanceNote = top1Pct > 40 ? `⚠ Top neighbor handles ${top1Pct.toFixed(1)}% of HOs — possible coverage gap.` : '';

    const tableRows = rows.map((r: any) => ({
      Rank: String(r.HO_RANK || '—'),
      'Neighbor USID': String(r.NEIGH_USID || '—'),
      'Src Face': String(r.SOURCE_USID_FACE || '—'),
      'Nbr Face': String(r.NEIGH_USID_FACE || '—'),
      'HO Count': String(r.HANDOVER_COUNT || 0),
      'HO %': Number(r.PERC_HANDOVER || 0).toFixed(1) + '%',
      'Cumul %': Number(r.CUMMULATIVE_SUM || 0).toFixed(1) + '%',
      'Distance (m)': r.SOURCE_NEIGH_DISTANCE_METERS != null ? String(Math.round(Number(r.SOURCE_NEIGH_DISTANCE_METERS))) : '—',
    }));

    const llmText = clampString(
      `Neighbor relations for USID ${usid} on ${dateId}: ${rows.length} neighbors\n` +
      `Top-5 neighbors handle ${top5HoPct.toFixed(1)}% of all HOs\n` +
      `Distance distribution: near<500m=${near}, mid 500m–2km=${mid}, far>2km=${far}\n` +
      (dominanceNote ? dominanceNote + '\n' : '') +
      rows.slice(0, 15).map((r: any) =>
        `  Rank ${r.HO_RANK}: USID ${r.NEIGH_USID} (${Number(r.PERC_HANDOVER || 0).toFixed(1)}% HO, ${Math.round(Number(r.SOURCE_NEIGH_DISTANCE_METERS || 0))}m)`
      ).join('\n'),
    );

    return {
      llmText,
      uiBlock: {
        type: 'compact_table',
        title: `Neighbor Relations · USID ${usid} · ${dateId}`,
        data: { title: `Neighbor HO Map — USID ${usid}`, subtitle: dateId, rows: tableRows },
      },
    };
  },
};

/** Tool 4 — RET (Remote Electrical Tilt) values + change detection across two dates */
const tool_get_ret_changes: AgentTool = {
  name: 'get_ret_changes',
  description:
    'Get Remote Electrical Tilt (RET) values for all sectors of a USID, and detect tilt changes ' +
    'between a start date and end date. Returns current tilt, min/max range, antenna model, and ' +
    'sector label (ALPHA/BETA/GAMMA). Highlights any sectors where the tilt changed. ' +
    'Use when HOSR drops, unexpected coverage changes, or interference symptoms appear.',
  parameters: {
    type: 'object',
    properties: {
      usid: { type: 'string', description: 'Site USID.' },
      startDate: { type: 'string', description: 'Earlier snapshot date YYYY-MM-DD. Defaults to 14 days ago.' },
      endDate: { type: 'string', description: 'Later snapshot date YYYY-MM-DD. Defaults to 3 days ago.' },
    },
    required: ['usid'],
  },
  async execute(args) {
    const usid = sanitizeSiteId(String(args.usid || '').trim());
    if (!usid) return { llmText: 'usid is required.' };
    const startDate = sanitizeDate(String(args.startDate || todayMinus(14)));
    const endDate = sanitizeDate(String(args.endDate || todayMinus(3)));

    // Fetch both snapshots in parallel; walk back if needed
    const fetchRet = (dateId: string) => mirrorOrRemote({
      local: {
        sql: `SELECT iuantsectorid AS "IUANTSECTORID",
                     userlabel AS "USERLABEL",
                     electricalantennatilt AS "ELECTRICALANTENNATILT",
                     mintilt AS "MINTILT",
                     maxtilt AS "MAXTILT",
                     iuantantennamodelnumber AS "IUANTANTENNAMODELNUMBER",
                     node AS "NODE",
                     date_id::date AS snap_date
              FROM mirror.ret_table
              WHERE usid = $1 AND date_id::date = $2::date`,
        params: [usid, dateId],
      },
      remote: `
        SELECT IUANTSECTORID, USERLABEL, ELECTRICALANTENNATILT, MINTILT, MAXTILT,
          IUANTANTENNAMODELNUMBER, NODE, CAST(DATE_ID AS DATE) as snap_date
        FROM ret_table WITH (NOLOCK)
        WHERE USID = '${usid}' AND CAST(DATE_ID AS DATE) = CAST('${dateId}' AS DATE)`,
      tag: 'get_ret_changes',
    });

    const [endFound, startFound] = await Promise.all([
      withDateFallback((d) => fetchRet(d), endDate, 7),
      withDateFallback((d) => fetchRet(d), startDate, 7),
    ]);

    if (!endFound || !endFound.rows.length) {
      return { llmText: `No RET data found for USID ${usid} near ${endDate}.` };
    }

    const endRows: any[] = endFound.rows;
    const startRows: any[] = startFound?.rows || [];

    // Build lookup for start snapshot by label key
    const startByKey = new Map<string, any>();
    for (const r of startRows) {
      const key = `${r.IUANTSECTORID || ''}|${r.USERLABEL || ''}`;
      startByKey.set(key, r);
    }

    const tableRows = endRows.map((r: any) => {
      const key = `${r.IUANTSECTORID || ''}|${r.USERLABEL || ''}`;
      const prev = startByKey.get(key);
      const prevTilt = prev ? Number(prev.ELECTRICALANTENNATILT) : null;
      const curTilt = r.ELECTRICALANTENNATILT != null ? Number(r.ELECTRICALANTENNATILT) : null;
      const changed = prevTilt !== null && curTilt !== null && prevTilt !== curTilt;
      return {
        Sector: String(r.IUANTSECTORID || '—'),
        Label: String(r.USERLABEL || '—'),
        'Tilt (current)': curTilt != null ? `${curTilt}°` : '—',
        'Tilt (prev)': prevTilt != null ? `${prevTilt}°` : '—',
        'Min': r.MINTILT != null ? `${r.MINTILT}°` : '—',
        'Max': r.MAXTILT != null ? `${r.MAXTILT}°` : '—',
        'Model': String(r.IUANTANTENNAMODELNUMBER || '—'),
        'Changed': changed ? `⚠ ${prevTilt}° → ${curTilt}°` : '—',
      };
    });

    const changed = tableRows.filter((r) => r.Changed !== '—');
    const llmText = clampString(
      `RET data for USID ${usid} (${startFound?.dateId || startDate} → ${endFound.dateId}):\n` +
      `Sectors: ${endRows.length} | Tilt changes detected: ${changed.length}\n` +
      (changed.length ? `Changed sectors:\n${changed.map((r) => `  ${r.Sector} (${r.Label}): ${r.Changed}`).join('\n')}\n` : 'No tilt changes detected between the two snapshots.\n') +
      tableRows.map((r) => `• ${r.Sector} ${r.Label}: tilt=${r['Tilt (current)']} min=${r.Min} max=${r.Max} model=${r.Model}`).join('\n'),
    );

    return {
      llmText,
      uiBlock: {
        type: 'compact_table',
        title: `RET Tilts · USID ${usid} · ${endFound.dateId}`,
        data: { title: `Antenna Tilts — USID ${usid}`, subtitle: endFound.dateId, rows: tableRows },
      },
    };
  },
};

/** Tool 5 — Outage events on the site itself */
const tool_get_site_outages: AgentTool = {
  name: 'get_site_outages',
  description:
    'Get outage events on a specific site (USID): which cells were down, what metric (4G_CELL_DOWN etc.), ' +
    'and at which hour. Bounded by USID + date range (auto-capped to 14 days). ' +
    'Also returns the site-level outage flag and outage summary from the AI RCA. ' +
    'Use early in any site investigation to confirm whether cells are actually out.',
  parameters: {
    type: 'object',
    properties: {
      usid: { type: 'string', description: 'Site USID.' },
      startDate: { type: 'string', description: 'Start date YYYY-MM-DD. Defaults to 7 days ago.' },
      endDate: { type: 'string', description: 'End date YYYY-MM-DD. Defaults to 3 days ago.' },
    },
    required: ['usid'],
  },
  async execute(args) {
    const usid = sanitizeSiteId(String(args.usid || '').trim());
    if (!usid) return { llmText: 'usid is required.' };
    // Bound: USID + date range (≤ 14 days). Both queries strictly bracket DATE_ID.
    const range = clampDateRange(
      String(args.startDate || todayMinus(7)),
      String(args.endDate || todayMinus(3)),
      14,
    );
    const startDate = range.startDate;
    const endDate = range.endDate;

    const [outageRows, siteRows] = await Promise.all([
      mirrorOrRemote({
        local: {
          sql: `SELECT date_id::date AS date_id, cell_name,
                       metric AS "METRIC",
                       snapshot_hour AS "SNAPSHOT_HOUR"
                FROM mirror.outage_table
                WHERE usid = $1
                  AND date_id::date BETWEEN $2::date AND $3::date
                ORDER BY date_id DESC, snapshot_hour`,
          params: [usid, startDate, endDate],
        },
        remote: `
          SELECT CAST(DATE_ID AS DATE) as date_id, cell_name, METRIC, SNAPSHOT_HOUR
          FROM outage_table WITH (NOLOCK)
          WHERE USID = '${usid}'
            AND CAST(DATE_ID AS DATE) >= CAST('${startDate}' AS DATE)
            AND CAST(DATE_ID AS DATE) <= CAST('${endDate}' AS DATE)
          ORDER BY DATE_ID DESC, SNAPSHOT_HOUR`,
        tag: 'get_site_outages.outage',
      }).catch(() => []),
      mirrorOrRemote({
        local: {
          sql: `SELECT date_id::date AS date_id, outage, outage_timestamp, outage_summary
                FROM mirror.site_table
                WHERE usid = $1
                  AND date_id::date BETWEEN $2::date AND $3::date
                ORDER BY date_id DESC`,
          params: [usid, startDate, endDate],
        },
        remote: `
          SELECT CAST(DATE_ID AS DATE) as date_id, outage, outage_timestamp, outage_summary
          FROM site_table WITH (NOLOCK)
          WHERE USID = '${usid}'
            AND CAST(DATE_ID AS DATE) >= CAST('${startDate}' AS DATE)
            AND CAST(DATE_ID AS DATE) <= CAST('${endDate}' AS DATE)
          ORDER BY DATE_ID DESC`,
        tag: 'get_site_outages.site',
      }).catch(() => []),
    ]);

    const activeOutage = siteRows.find((r: any) => r.outage);

    if (!outageRows.length && !activeOutage) {
      return { llmText: `No outage events found for USID ${usid} between ${startDate} and ${endDate}.` };
    }

    const tableRows = outageRows.map((r: any) => ({
      Date: String(r.date_id || '').slice(0, 10),
      Cell: String(r.cell_name || '—'),
      Metric: String(r.METRIC || '—'),
      Hour: r.SNAPSHOT_HOUR != null ? `${r.SNAPSHOT_HOUR}:00` : '—',
    }));

    const outageFlag = activeOutage ? `⚠ ACTIVE OUTAGE: ${String(activeOutage.outage_summary || '').slice(0, 200)}` : '';

    const llmText = clampString(
      `Outages for USID ${usid} (${startDate}–${endDate}): ${outageRows.length} cell-outage events\n` +
      (outageFlag ? outageFlag + '\n' : '') +
      tableRows.slice(0, 20).map((r) => `• ${r.Date} ${r.Cell}: ${r.Metric} at ${r.Hour}`).join('\n'),
    );

    const result: ToolResult = { llmText };
    if (tableRows.length) {
      result.uiBlock = {
        type: 'compact_table',
        title: `Outages · USID ${usid} · ${startDate}–${endDate}`,
        data: { title: `Outage Events — USID ${usid}`, subtitle: `${startDate}→${endDate}`, rows: tableRows },
      };
    }
    return result;
  },
};

/** Tool 6 — Outages on this site's handover neighbors */
const tool_get_neighbor_outages: AgentTool = {
  name: 'get_neighbor_outages',
  description:
    'Find which of a site\'s handover neighbors have active outages, and estimate how much of the ' +
    'source site\'s handover traffic they represent. Use after get_neighbor_relations to understand ' +
    'whether neighbour outages are causing HOSR degradation or traffic absorption problems.',
  parameters: {
    type: 'object',
    properties: {
      usid: { type: 'string', description: 'Source site USID.' },
      date: { type: 'string', description: 'Date YYYY-MM-DD. Defaults to 3 days ago.' },
    },
    required: ['usid'],
  },
  async execute(args) {
    const usid = sanitizeSiteId(String(args.usid || '').trim());
    if (!usid) return { llmText: 'usid is required.' };
    const startDate = sanitizeDate(String(args.date || todayMinus(3)));

    const neighborFound = await withDateFallback(async (dateId) => {
      // Bound: SOURCE_USID + single DATE_ID — naturally yields all neighbors of the source.
      return mirrorOrRemote({
        local: {
          sql: `SELECT neigh_usid AS "NEIGH_USID",
                       ho_rank AS "HO_RANK",
                       perc_handover AS "PERC_HANDOVER",
                       source_neigh_distance_meters AS "SOURCE_NEIGH_DISTANCE_METERS"
                FROM mirror.neighbors_table_date_id
                WHERE source_usid = $1 AND date_id::date = $2::date
                ORDER BY ho_rank ASC`,
          params: [usid, dateId],
        },
        remote: `
          SELECT NEIGH_USID, HO_RANK, PERC_HANDOVER, SOURCE_NEIGH_DISTANCE_METERS
          FROM neighbors_table_date_id WITH (NOLOCK)
          WHERE SOURCE_USID = '${usid}'
            AND CAST(DATE_ID AS DATE) = CAST('${dateId}' AS DATE)
          ORDER BY HO_RANK ASC`,
        tag: 'get_neighbor_outages.neighbors',
      });
    }, startDate);

    if (!neighborFound || !neighborFound.rows.length) {
      return { llmText: `No neighbor data found for USID ${usid} near ${startDate}.` };
    }

    const { rows: neighborRows, dateId } = neighborFound;
    // Build sanitized neighbor USID list for both local and remote queries.
    const neighborUsidArr = neighborRows.map((r: any) => sanitizeSiteId(String(r.NEIGH_USID))).filter(Boolean);
    const neighborUsidsRemote = neighborUsidArr.map((u) => `'${u}'`).join(',');
    if (!neighborUsidArr.length) return { llmText: `No neighbor USIDs resolved for ${usid}.` };

    // Bound: USID list (already capped by physical neighbor count) + single DATE_ID.
    const outageRows: any[] = await mirrorOrRemote({
      local: {
        sql: `SELECT usid AS "USID", cell_name,
                     metric AS "METRIC",
                     snapshot_hour AS "SNAPSHOT_HOUR",
                     date_id::date AS date_id
              FROM mirror.outage_table
              WHERE usid = ANY($1::text[]) AND date_id::date = $2::date`,
        params: [neighborUsidArr, dateId],
      },
      remote: `
        SELECT o.USID, o.cell_name, o.METRIC, o.SNAPSHOT_HOUR, CAST(o.DATE_ID AS DATE) as date_id
        FROM outage_table o WITH (NOLOCK)
        WHERE o.USID IN (${neighborUsidsRemote})
          AND CAST(o.DATE_ID AS DATE) = CAST('${dateId}' AS DATE)`,
      tag: 'get_neighbor_outages.outages',
    }).catch(() => []);

    const outagedUsids = new Set(outageRows.map((r: any) => String(r.USID)));

    const impacted = neighborRows
      .filter((r: any) => outagedUsids.has(String(r.NEIGH_USID)))
      .map((r: any) => ({
        'Neighbor USID': String(r.NEIGH_USID),
        'HO Rank': String(r.HO_RANK),
        'HO %': Number(r.PERC_HANDOVER || 0).toFixed(1) + '%',
        'Distance (m)': r.SOURCE_NEIGH_DISTANCE_METERS != null ? String(Math.round(Number(r.SOURCE_NEIGH_DISTANCE_METERS))) : '—',
        'Outage Cells': outageRows.filter((o: any) => String(o.USID) === String(r.NEIGH_USID)).map((o: any) => o.cell_name).join(', '),
      }));

    if (!impacted.length) {
      return { llmText: `None of USID ${usid}'s ${neighborRows.length} neighbors have outages on ${dateId}.` };
    }

    const totalHoPct = impacted.reduce((s, r) => s + parseFloat(r['HO %']), 0);
    const llmText = clampString(
      `${impacted.length} of ${neighborRows.length} neighbors have outages on ${dateId} — affecting ${totalHoPct.toFixed(1)}% of ${usid}'s handover traffic.\n` +
      impacted.map((r) => `• USID ${r['Neighbor USID']} (Rank ${r['HO Rank']}, ${r['HO %']} HO): cells down: ${r['Outage Cells']}`).join('\n'),
    );

    return {
      llmText,
      uiBlock: {
        type: 'compact_table',
        title: `Neighbor Outages · USID ${usid} · ${dateId}`,
        data: { title: `Neighbor Outage Impact — USID ${usid}`, subtitle: dateId, rows: impacted },
      },
    };
  },
};

/** Tool 7 — Hourly KPI trends: multi-cell, multi-day, anomaly flagging + LLM narrative */
const tool_get_hourly_trends: AgentTool = {
  name: 'get_hourly_trends',
  description:
    'Show the standard hourly KPI dashboard for a USID, preloaded with the requested KPIs. ' +
    'The user gets the full interactive dashboard (with daily/hourly toggle, KPI selector, ' +
    'multi-cell breakdown). The tool also fetches raw rows server-side to compute anomaly-hour ' +
    'flags and a short LLM narrative — these are returned to the LLM as text context (not as ' +
    'separate UI blocks) so the agent can reason about the pattern. ' +
    'Bounded by USID + KPI list (≤8) + date range (auto-capped to 7 days).',
  parameters: {
    type: 'object',
    properties: {
      usid: { type: 'string', description: 'Site USID.' },
      kpiNames: {
        type: 'array',
        items: { type: 'string' },
        description: 'KPI names. Defaults to ["DL_DRB_TPUT","HOSR","DATA_RAN_ACC"].',
      },
      startDate: { type: 'string', description: 'Start date YYYY-MM-DD. Defaults to 3 days ago.' },
      endDate: { type: 'string', description: 'End date YYYY-MM-DD. Defaults to same as startDate.' },
      includeNarrative: { type: 'boolean', description: 'Generate LLM narrative. Default true.' },
    },
    required: ['usid'],
  },
  async execute(args) {
    const usid = sanitizeSiteId(String(args.usid || '').trim());
    if (!usid) return { llmText: 'usid is required.' };

    const rawKpis = sanitizeKpiList(args.kpiNames, ['DL_DRB_TPUT', 'HOSR', 'DATA_RAN_ACC'], 8);
    const kpiList = rawKpis.map((k) => `'${k}'`).join(',');

    const range = clampDateRange(
      String(args.startDate || todayMinus(3)),
      String(args.endDate || args.startDate || todayMinus(3)),
      7,
    );
    const startDate = range.startDate;
    const endDate = range.endDate;
    const includeNarrative = args.includeNarrative !== false;

    // Fetch raw rows for analytical context — drives the narrative + anomaly callouts
    // that the LLM uses in its synthesis. The visual dashboard re-fetches its own data
    // via the existing /api/kpis pipeline, so this query is purely for reasoning.
    let rows: any[] = [];
    try {
      rows = await mirrorOrRemote({
        local: {
          sql: `SELECT cell_name,
                       date_id::date AS date_id,
                       hour_id AS "HOUR_ID",
                       kpi_name, kpi_value, anomaly_flag, anomaly_score
                FROM mirror.hourly_intermediate_kpis_table
                WHERE usid = $1
                  AND kpi_name = ANY($2::text[])
                  AND date_id::date BETWEEN $3::date AND $4::date
                ORDER BY cell_name, date_id ASC, hour_id ASC`,
          params: [usid, rawKpis, startDate, endDate],
        },
        remote: `
          SELECT cell_name, CAST(DATE_ID AS DATE) as date_id, HOUR_ID,
            kpi_name, kpi_value, anomaly_flag, anomaly_score
          FROM hourly_intermediate_kpis_table WITH (NOLOCK)
          WHERE USID = '${usid}'
            AND kpi_name IN (${kpiList})
            AND CAST(DATE_ID AS DATE) >= CAST('${startDate}' AS DATE)
            AND CAST(DATE_ID AS DATE) <= CAST('${endDate}' AS DATE)
          ORDER BY cell_name, DATE_ID ASC, HOUR_ID ASC`,
        tag: 'get_hourly_trends',
      });
    } catch (err) {
      // Even if the analytical query fails, still return the dashboard.
      return {
        llmText: `Loaded hourly dashboard for USID ${usid}. Analytical context unavailable: ${(err as Error).message}`,
        uiBlock: {
          type: 'kpi_dashboard',
          // No kpiNames → dashboard shows the full ALL_STANDARD_KPIS set.
          // collapseAfterGroups=2 → only Throughput + Accessibility render initially.
          data: { siteId: usid, timeframe: 'hourly', daysBack: 3, collapseAfterGroups: 2 },
        },
      };
    }

    const primaryKpi = rawKpis[0];
    const cells = [...new Set(rows.map((r) => String(r.cell_name)))];

    const anomalyHours = rows
      .filter((r) => r.anomaly_flag || Number(r.anomaly_score) > 0.7)
      .map((r) => ({
        cell: r.cell_name,
        date: String(r.date_id).slice(0, 10),
        hour: r.HOUR_ID,
        kpi: r.kpi_name,
        value: r.kpi_value,
        score: Number(r.anomaly_score || 0).toFixed(2),
      }));

    const statItems = cells.map((cell) => {
      const cellRows = rows.filter((r) => String(r.cell_name) === cell && String(r.kpi_name) === primaryKpi);
      const vals = cellRows.map((r) => Number(r.kpi_value)).filter(isFinite);
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      const peak = vals.length ? Math.max(...vals) : 0;
      const min = vals.length ? Math.min(...vals) : 0;
      return { label: cell, avg, peak, min };
    });

    // Per-tool narrative was removed: the orchestrator's final synthesis already
    // interprets the raw stats + anomaly list passed via llmText. Keeping a second
    // LLM call here added 5–10s with no quality benefit. The `includeNarrative`
    // arg is preserved for API compatibility but is now a no-op.
    void includeNarrative;
    const narrative = '';

    const anomalyText = anomalyHours.length
      ? `Anomalous hours (${anomalyHours.length}): ` +
        anomalyHours.slice(0, 8).map((a) => `${a.cell} ${a.date} ${a.hour}:00`).join(', ') +
        (anomalyHours.length > 8 ? ` … +${anomalyHours.length - 8} more` : '')
      : 'No anomaly hours flagged.';

    const llmText = clampString(
      `Loaded hourly KPI dashboard for USID ${usid} (${startDate}–${endDate}, KPIs: ${rawKpis.join(', ')}).\n` +
        `Cells: ${cells.length} | data points: ${rows.length}\n` +
        anomalyText + '\n' +
        statItems
          .map((s) => `• ${s.label}: avg ${s.avg.toFixed(1)} | peak ${s.peak.toFixed(1)} | min ${s.min.toFixed(1)} (${primaryKpi})`)
          .join('\n') +
        (narrative ? `\n\nAnalysis:\n${narrative}` : ''),
    );

    // Convert the requested day-range into a valid hourly window (24/48/72h).
    // The kpi_dashboard daysBack field is HOURS when timeframe='hourly'.
    const daysSpan = Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000) + 1);
    const hoursBack = daysSpan <= 1 ? 24 : daysSpan <= 2 ? 48 : 72;

    return {
      llmText,
      uiBlock: {
        type: 'kpi_dashboard',
        // No kpiNames → dashboard shows the full ALL_STANDARD_KPIS set so the user
        // gets a complete view (not just the 3 KPIs we used for narrative analysis).
        // collapseAfterGroups=2 → only Throughput + Accessibility render initially;
        // an "Expand to show more" bar reveals the rest on click.
        data: {
          siteId: usid,
          timeframe: 'hourly',
          daysBack: hoursBack,
          collapseAfterGroups: 2,
        },
      },
    };
  },
};

/** Tool 8 — CQX sub-component impact breakdown */
const tool_get_kpi_impact_breakdown: AgentTool = {
  name: 'get_kpi_impact_breakdown',
  description:
    'Get the CQX super-KPI impact breakdown for a site — shows which dimensions ' +
    '(DL throughput, data drop, voice drop, accessibility, etc.) are contributing to degradation. ' +
    'Also returns week-over-week impact delta. Use after initial KPI snapshot to understand WHERE ' +
    'to dig deeper (e.g. high DATA_DROP_IMP → investigate drop rate tools).',
  parameters: {
    type: 'object',
    properties: {
      usid: { type: 'string', description: 'Site USID.' },
      date: { type: 'string', description: 'Date YYYY-MM-DD. Defaults to 3 days ago.' },
    },
    required: ['usid'],
  },
  async execute(args) {
    const usid = sanitizeSiteId(String(args.usid || '').trim());
    if (!usid) return { llmText: 'usid is required.' };
    const startDate = sanitizeDate(String(args.date || todayMinus(3)));

    const found = await withDateFallback(async (dateId) => {
      const [subRows, cqxRows] = await Promise.all([
        mirrorOrRemote({
          local: {
            sql: `SELECT subcomponent_name, subcomponent_value, anomaly_flag, anomaly_score_ratio
                  FROM mirror.subcomponent_table
                  WHERE usid = $1 AND date_id::date = $2::date
                  ORDER BY ABS(COALESCE(subcomponent_value, 0)) DESC`,
            params: [usid, dateId],
          },
          remote: `
            SELECT subcomponent_name, subcomponent_value, anomaly_flag, anomaly_score_ratio
            FROM subcomponent_table WITH (NOLOCK)
            WHERE USID = '${usid}' AND CAST(DATE_ID AS DATE) = CAST('${dateId}' AS DATE)
            ORDER BY ABS(ISNULL(subcomponent_value, 0)) DESC`,
          tag: 'get_kpi_impact_breakdown.sub',
        }),
        mirrorOrRemote({
          local: {
            sql: `SELECT total_impact_latest AS "TOTAL_IMPACT_LATEST",
                         dl_tput_imp AS "DL_TPUT_IMP",
                         ul_tput_imp AS "UL_TPUT_IMP",
                         data_drop_imp AS "DATA_DROP_IMP",
                         data_acc_imp AS "DATA_ACC_IMP",
                         voice_drop_imp AS "VOICE_DROP_IMP",
                         ns_eso_imp AS "NS_ESO_IMP",
                         quality_imp AS "QUALITY_IMP",
                         total_impact_wow AS "TOTAL_IMPACT_WOW",
                         impact_delta AS "IMPACT_DELTA"
                  FROM mirror.cqx_offenders_truth_table
                  WHERE usid = $1 AND date_id::date = $2::date`,
            params: [usid, dateId],
          },
          remote: `
            SELECT TOTAL_IMPACT_LATEST, DL_TPUT_IMP, UL_TPUT_IMP, DATA_DROP_IMP,
              DATA_ACC_IMP, VOICE_DROP_IMP, NS_ESO_IMP, QUALITY_IMP, TOTAL_IMPACT_WOW, IMPACT_DELTA
            FROM cqx_offenders_truth_table WITH (NOLOCK)
            WHERE USID = '${usid}' AND CAST(DATE_ID AS DATE) = CAST('${dateId}' AS DATE)`,
          tag: 'get_kpi_impact_breakdown.cqx',
        }),
      ]);
      return [...subRows, ...cqxRows].length ? [{ subRows, cqxRows }] : [];
    }, startDate);

    if (!found) return { llmText: `No impact data found for USID ${usid} near ${startDate}.` };
    const { subRows, cqxRows } = (found.rows[0] as any);
    const cqx = cqxRows[0] || {};

    // Bar-gauge rows: one per subcomponent, ordered by absolute magnitude.
    const meterRows = subRows
      .map((r: any) => ({
        label: String(r.subcomponent_name || 'Unknown'),
        value: r.subcomponent_value != null ? Number(r.subcomponent_value) : null,
        anomaly: Boolean(r.anomaly_flag),
      }))
      .sort((a: any, b: any) => Math.abs(Number(b.value) || 0) - Math.abs(Number(a.value) || 0));

    const total = cqx.TOTAL_IMPACT_LATEST != null
      ? {
          label: 'Total CQX impact',
          value: Number(cqx.TOTAL_IMPACT_LATEST),
          wow: cqx.TOTAL_IMPACT_WOW != null ? Number(cqx.TOTAL_IMPACT_WOW) : undefined,
        }
      : undefined;

    const cqxSummary = total
      ? `Total CQX impact: ${total.value.toFixed(3)}${total.wow != null ? ` | WoW: ${total.wow.toFixed(3)}` : ''}\n` +
        `  DL_TPUT=${Number(cqx.DL_TPUT_IMP||0).toFixed(3)} UL_TPUT=${Number(cqx.UL_TPUT_IMP||0).toFixed(3)} ` +
        `DATA_DROP=${Number(cqx.DATA_DROP_IMP||0).toFixed(3)} VOICE_DROP=${Number(cqx.VOICE_DROP_IMP||0).toFixed(3)} ` +
        `ACC=${Number(cqx.DATA_ACC_IMP||0).toFixed(3)} QUALITY=${Number(cqx.QUALITY_IMP||0).toFixed(3)}`
      : '';

    const llmText = clampString(
      `KPI impact breakdown for USID ${usid} on ${found.dateId}:\n` +
      (cqxSummary ? cqxSummary + '\n' : '') +
      subRows.slice(0, 10).map((r: any) => `• ${r.subcomponent_name}: ${Number(r.subcomponent_value||0).toFixed(4)}${r.anomaly_flag ? ' ⚠' : ''}`).join('\n'),
    );

    return {
      llmText,
      uiBlock: {
        type: 'severity_meter',
        title: `Impact Breakdown · USID ${usid} · ${found.dateId}`,
        data: {
          title: `CQX Impact — USID ${usid}`,
          subtitle: found.dateId,
          rows: meterRows,
          total,
        },
      },
    };
  },
};

/** Tool 9 — Trouble ticket history for a site */
const tool_get_ticket_history: AgentTool = {
  name: 'get_ticket_history',
  description:
    'Get trouble tickets for a site (USID) — categories, status, description, and assigned department. ' +
    'Bounded by USID + date range (auto-capped to 90 days). ' +
    'Use when the user mentions a ticket number, incident, or ongoing work order, or as part of ' +
    'a full site investigation to correlate outages with field activity.',
  parameters: {
    type: 'object',
    properties: {
      usid: { type: 'string', description: 'Site USID.' },
      startDate: { type: 'string', description: 'Start date YYYY-MM-DD. Defaults to 30 days ago.' },
      endDate: { type: 'string', description: 'End date YYYY-MM-DD. Defaults to today.' },
    },
    required: ['usid'],
  },
  async execute(args) {
    const usid = sanitizeSiteId(String(args.usid || '').trim());
    if (!usid) return { llmText: 'usid is required.' };
    // Bound: USID + date range (≤ 90 days). Both ends bracketed.
    const range = clampDateRange(
      String(args.startDate || todayMinus(30)),
      String(args.endDate || todayMinus(0)),
      90,
    );
    const startDate = range.startDate;
    const endDate = range.endDate;

    let rows: any[] = [];
    try {
      rows = await mirrorOrRemote({
        local: {
          sql: `SELECT ticket_number AS "TICKET_NUMBER",
                       create_time AS "CREATE_TIME",
                       ticket_status AS "TICKET_STATUS",
                       problem_category AS "PROBLEM_CATEGORY",
                       problem_subcategory AS "PROBLEM_SUBCATEGORY",
                       short_description AS "SHORT_DESCRIPTION",
                       assigned_department AS "ASSIGNED_DEPARTMENT",
                       date_id::date AS date_id
                FROM mirror.ticket_table
                WHERE usid = $1
                  AND date_id::date BETWEEN $2::date AND $3::date
                ORDER BY create_time DESC`,
          params: [usid, startDate, endDate],
        },
        remote: `
          SELECT TICKET_NUMBER, CREATE_TIME, TICKET_STATUS, PROBLEM_CATEGORY,
            PROBLEM_SUBCATEGORY, SHORT_DESCRIPTION, ASSIGNED_DEPARTMENT,
            CAST(DATE_ID AS DATE) as date_id
          FROM ticket_table WITH (NOLOCK)
          WHERE USID = '${usid}'
            AND CAST(DATE_ID AS DATE) >= CAST('${startDate}' AS DATE)
            AND CAST(DATE_ID AS DATE) <= CAST('${endDate}' AS DATE)
          ORDER BY CREATE_TIME DESC`,
        tag: 'get_ticket_history',
      });
    } catch (err) {
      return { llmText: `Failed to fetch tickets for ${usid}: ${(err as Error).message}` };
    }

    if (!rows.length) {
      return { llmText: `No tickets found for USID ${usid} between ${startDate} and ${endDate}.` };
    }

    const open = rows.filter((r) => String(r.TICKET_STATUS || '').toUpperCase() !== 'CLOSED').length;
    const tableRows = rows.map((r: any) => ({
      Ticket: String(r.TICKET_NUMBER || '—'),
      Created: String(r.CREATE_TIME || '').slice(0, 10),
      Status: String(r.TICKET_STATUS || '—'),
      Category: String(r.PROBLEM_CATEGORY || '—'),
      Subcategory: String(r.PROBLEM_SUBCATEGORY || '—'),
      Description: String(r.SHORT_DESCRIPTION || '—').slice(0, 80),
      Department: String(r.ASSIGNED_DEPARTMENT || '—'),
    }));

    const llmText = clampString(
      `Tickets for USID ${usid} (${startDate} → ${endDate}): ${rows.length} total (${open} open)\n` +
      tableRows.slice(0, 10).map((r) => `• [${r.Status}] ${r.Created} ${r.Category}/${r.Subcategory}: ${r.Description}`).join('\n'),
    );

    return {
      llmText,
      uiBlock: {
        type: 'compact_table',
        title: `Tickets · USID ${usid}`,
        data: { title: `Trouble Tickets — USID ${usid}`, rows: tableRows },
      },
    };
  },
};

/** Tool 10 — Compare site KPI against its cluster peers */
const tool_compare_with_cluster: AgentTool = {
  name: 'compare_with_cluster',
  description:
    'Compare a site\'s KPI value against all peers in the same cluster. Returns a ranked list of ' +
    'cluster sites with their avg KPI value, the source site\'s rank/percentile, and whether it is ' +
    'a statistical outlier. Use to confirm whether an issue is site-specific or cluster-wide.',
  parameters: {
    type: 'object',
    properties: {
      usid: { type: 'string', description: 'Site USID.' },
      kpiName: { type: 'string', description: 'Exact KPI name (e.g. DL_DRB_TPUT, HOSR).' },
      date: { type: 'string', description: 'Date YYYY-MM-DD. Defaults to 3 days ago.' },
    },
    required: ['usid', 'kpiName'],
  },
  async execute(args) {
    const usid = sanitizeSiteId(String(args.usid || '').trim());
    const kpiName = String(args.kpiName || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 60);
    if (!usid || !kpiName) return { llmText: 'usid and kpiName are required.' };
    const startDate = sanitizeDate(String(args.date || todayMinus(3)));

    const clusterFound = await withDateFallback(async (dateId) => {
      return mirrorOrRemote({
        local: {
          sql: `SELECT clusterid AS "CLUSTERID"
                FROM mirror.site_table
                WHERE usid = $1 AND date_id::date = $2::date
                LIMIT 1`,
          params: [usid, dateId],
        },
        remote: `
          SELECT TOP 1 CLUSTERID FROM site_table WITH (NOLOCK)
          WHERE USID = '${usid}' AND CAST(DATE_ID AS DATE) = CAST('${dateId}' AS DATE)`,
        tag: 'compare_with_cluster.lookup',
      });
    }, startDate);

    if (!clusterFound || !clusterFound.rows.length) {
      return { llmText: `Could not find cluster for USID ${usid} near ${startDate}.` };
    }

    const clusterId = String(clusterFound.rows[0].CLUSTERID || '').replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 60);
    const dateId = clusterFound.dateId;

    if (!clusterId) return { llmText: `No cluster ID found for USID ${usid}.` };

    // Local mirror only contains offender USIDs, so the JOIN here is restricted
    // to offender peers in the cluster. If the local result is empty (e.g. cluster
    // has no offenders other than the source), we fall back to the full remote scan.
    let peerRows: any[] = [];
    try {
      peerRows = await mirrorOrRemote({
        local: {
          sql: `SELECT s.usid AS "USID",
                       s.site_name,
                       AVG(k.kpi_value::float) AS avg_kpi,
                       MAX(s.anomaly_flag::int)::boolean AS anomaly_flag,
                       MAX(s.anomaly_score) AS anomaly_score
                FROM mirror.site_table s
                JOIN mirror.intermediate_kpi_table k
                  ON s.usid = k.usid AND s.date_id::date = k.date_id::date
                WHERE s.clusterid = $1
                  AND k.kpi_name = $2
                  AND k.date_id::date = $3::date
                GROUP BY s.usid, s.site_name
                ORDER BY avg_kpi DESC`,
          params: [clusterId, kpiName, dateId],
        },
        remote: `
          SELECT s.USID, s.site_name, AVG(CAST(k.kpi_value AS FLOAT)) as avg_kpi,
            s.anomaly_flag, s.anomaly_score
          FROM site_table s WITH (NOLOCK)
          JOIN intermediate_kpi_table k WITH (NOLOCK)
            ON s.USID = k.USID AND CAST(s.DATE_ID AS DATE) = CAST(k.DATE_ID AS DATE)
          WHERE s.CLUSTERID = '${clusterId}'
            AND k.kpi_name = '${kpiName}'
            AND CAST(k.DATE_ID AS DATE) = CAST('${dateId}' AS DATE)
          GROUP BY s.USID, s.site_name, s.anomaly_flag, s.anomaly_score
          ORDER BY avg_kpi DESC`,
        tag: 'compare_with_cluster.peers',
      });
    } catch (err) {
      return { llmText: `Failed to fetch cluster KPIs: ${(err as Error).message}` };
    }

    if (!peerRows.length) {
      return { llmText: `No ${kpiName} data found for cluster ${clusterId} on ${dateId}.` };
    }

    const vals = peerRows.map((r: any) => Number(r.avg_kpi)).filter(isFinite);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.map((v) => (v - mean) ** 2).reduce((a, b) => a + b, 0) / vals.length);

    const sourceIdx = peerRows.findIndex((r: any) => String(r.USID) === usid);
    const sourceRow = sourceIdx >= 0 ? peerRows[sourceIdx] : null;
    const sourceVal = sourceRow ? Number(sourceRow.avg_kpi) : null;
    const rank = sourceIdx >= 0 ? sourceIdx + 1 : null;
    const pct = rank != null ? Math.round((1 - rank / peerRows.length) * 100) : null;
    const isOutlier = sourceVal != null && std > 0 && Math.abs(sourceVal - mean) > 2 * std;

    const tableRows = peerRows.map((r: any, i: number) => ({
      Rank: String(i + 1),
      USID: String(r.USID),
      Site: String(r.site_name || '—'),
      [`Avg ${kpiName}`]: Number(r.avg_kpi).toFixed(2),
      Anomaly: r.anomaly_flag ? '⚠' : '—',
      Source: String(r.USID) === usid ? '← THIS SITE' : '',
    }));

    const rankNote = rank != null
      ? `USID ${usid} ranks ${rank}/${peerRows.length} in cluster ${clusterId} for ${kpiName} (${pct}th percentile)${isOutlier ? ' — OUTLIER (>2σ below mean)' : ''}.`
      : `USID ${usid} not found in cluster ${clusterId} KPI data for ${dateId}.`;

    const llmText = clampString(
      `${rankNote}\n` +
      `Cluster avg: ${mean.toFixed(2)} | std: ${std.toFixed(2)} | source site: ${sourceVal?.toFixed(2) ?? '—'}\n` +
      tableRows.map((r) => `  ${r.Rank}. ${r.USID} ${r.Site}: ${r[`Avg ${kpiName}`]}${r.Source ? ' ← THIS SITE' : ''}`).join('\n'),
    );

    return {
      llmText,
      uiBlock: {
        type: 'insight_chart',
        title: `Cluster Comparison · ${kpiName} · ${dateId}`,
        data: {
          title: `${kpiName} — Cluster ${clusterId}`,
          subtitle: rankNote,
          echartsOption: {
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: tableRows.map((r) => r.USID), axisLabel: { rotate: 45 } },
            yAxis: { type: 'value', name: kpiName },
            series: [{
              type: 'bar',
              data: peerRows.map((r: any, i: number) => ({
                value: Number(r.avg_kpi).toFixed(2),
                itemStyle: { color: String(r.USID) === usid ? '#f97316' : '#6366f1' },
              })),
            }],
          },
          height: Math.max(300, peerRows.length * 18),
        },
      },
    };
  },
};

// ─── Registry ───────────────────────────────────────────────────────────────
export const ALL_TOOLS: AgentTool[] = [
  tool_find_site,
  tool_get_worst_offenders,
  tool_get_site_rca,
  tool_get_site_kpis,
  tool_show_kpi_dashboard,
  tool_query_data,
  tool_generate_report,
  tool_telecom_knowledge,
  tool_resolve_kpi_param,
  tool_set_map_layer,
  tool_navigate_to,
  // Site-analysis tools (deep investigation)
  tool_get_site_topology,
  tool_get_config_changes,
  tool_get_neighbor_relations,
  tool_get_ret_changes,
  tool_get_site_outages,
  tool_get_neighbor_outages,
  tool_get_hourly_trends,
  tool_get_kpi_impact_breakdown,
  tool_get_ticket_history,
  tool_compare_with_cluster,
];

export const TOOLS_BY_NAME: Record<string, AgentTool> = Object.fromEntries(
  ALL_TOOLS.map((t) => [t.name, t]),
);

/** Convert the registry into the OpenAI tools API format. */
export function toOpenAITools() {
  return ALL_TOOLS.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
