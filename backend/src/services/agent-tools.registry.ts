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
  | 'text' | 'callout' | 'chips' | 'stat_row' | 'data_table'
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
