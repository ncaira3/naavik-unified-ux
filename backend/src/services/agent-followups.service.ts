/**
 * Agent Follow-up Suggestions — conversation builders.
 *
 * After each turn the orchestrator inspects which tools fired and emits a
 * small set of follow-up chips. Each chip is either:
 *
 *   1. Fire-and-forget — every parameter is already known, so clicking the
 *      chip sends a fully-formed prompt verbatim.
 *
 *   2. Conversation builder — one or more `needs` questions are surfaced
 *      inline (single-choice, multi-choice, or free text). The chip's
 *      `prompt` is a template with {{slot}} placeholders that get filled
 *      once the user submits their answers.
 *
 * This style is inspired by the AppGen agent's ClarificationCard: instead of
 * cryptic chips like "Explain RCA for #1", we surface a clear chip ("Explain
 * RCA") and ask "Which site?" only when we don't already know it.
 */

export type FollowupQuestionMode = 'single' | 'multi' | 'free';

export interface FollowupQuestionOption {
  key: string;
  label: string;
  description?: string;
}

export interface FollowupQuestion {
  id: string;                              // slot name used in {{...}} substitution
  text: string;                            // human-readable prompt
  mode: FollowupQuestionMode;
  options?: FollowupQuestionOption[];      // for single / multi
  allowFreeText?: boolean;                 // for single / multi — surface a "Custom…" field
  placeholder?: string;                    // for free / allowFreeText
  defaultValue?: string;                   // pre-filled (e.g. last-known USID)
  required?: boolean;                      // default true for single / free, false for multi
}

export interface FollowupChip {
  label: string;                           // short button label, max ~3 words
  description?: string;                    // longer tooltip / 2nd line
  prompt: string;                          // template — `Show KPI trends for site {{siteId}}`
  needs?: FollowupQuestion[];              // when set, clicking opens an inline form
  intent?: string;                         // canonical action id for analytics / routing
}

export interface ToolTrace {
  name: string;
  args?: Record<string, any>;
}

// ─── Canonical follow-up library ────────────────────────────────────────────
// Each entry is a function `(vars) => FollowupChip` so we can decide at
// build-time whether `needs` should be empty (everything resolved) or carry
// questions for what's still missing.

const STANDARD_KPI_OPTIONS: FollowupQuestionOption[] = [
  { key: 'DL_DRB_TPUT',    label: 'DL Throughput (DL_DRB_TPUT)', description: 'Downlink user throughput' },
  { key: 'DATA_RAN_ACC',   label: 'Data Accessibility',          description: 'Successful PDP context activations' },
  { key: 'HOSR',           label: 'Handover Success Rate',       description: 'Mobility' },
  { key: 'DL_PKTLOSS_RT',  label: 'DL Packet Loss',              description: 'Quality' },
  { key: 'AVG_DL_PRB_UTIL',label: 'DL PRB Utilization',          description: 'Capacity / load' },
  { key: 'ERAB_DROP_CDT',  label: 'eRAB Drop',                   description: 'Bearer drop' },
];

function siteIdQuestion(known: string | undefined, recentSiteIds: string[]): FollowupQuestion {
  // Pre-fill with the last-known USID; offer up to 4 recent ones as quick picks.
  const options = recentSiteIds.slice(0, 4).map((s) => ({
    key: s,
    label: `USID ${s}`,
  }));
  return {
    id: 'siteId',
    text: known ? 'Confirm or change the site' : 'Which site?',
    mode: 'single',
    options,
    allowFreeText: true,
    placeholder: 'e.g., 9787',
    defaultValue: known ?? '',
    required: true,
  };
}

function kpiQuestion(opts: { multi?: boolean; required?: boolean } = {}): FollowupQuestion {
  return {
    id: 'kpiName',
    text: opts.multi ? 'Which KPIs (optional)?' : 'Which KPI?',
    mode: opts.multi ? 'multi' : 'single',
    options: STANDARD_KPI_OPTIONS,
    allowFreeText: true,
    placeholder: 'Type any KPI name from the DB…',
    required: opts.required ?? !opts.multi,
  };
}

function timeWindowQuestion(): FollowupQuestion {
  return {
    id: 'daysBack',
    text: 'How far back?',
    mode: 'single',
    options: [
      { key: '7',  label: 'Last 7 days' },
      { key: '14', label: 'Last 14 days' },
      { key: '30', label: 'Last 30 days' },
      { key: '60', label: 'Last 60 days' },
      { key: '90', label: 'Last 90 days' },
    ],
    required: true,
    defaultValue: '30',
  };
}

// Helper: build a chip whose siteId is already known → fire-and-forget.
// If `vars.siteId` is missing, the chip becomes a conversation builder.
function chipShowKpiTrends(vars: Vars, recentSiteIds: string[]): FollowupChip {
  if (vars.siteId) {
    return {
      label: 'Show KPI trends',
      description: `For site ${vars.siteId}`,
      intent: 'show_kpi_trends',
      // siteId known → ask only which KPIs (optional, multi)
      prompt: 'Show KPI trends for site {{siteId}}{{#kpiName}} — focus on {{kpiName}}{{/kpiName}}',
      needs: [kpiQuestion({ multi: true, required: false })],
    };
  }
  return {
    label: 'Show KPI trends',
    description: 'Pick a site and KPIs',
    intent: 'show_kpi_trends',
    prompt: 'Show KPI trends for site {{siteId}}{{#kpiName}} — focus on {{kpiName}}{{/kpiName}}',
    needs: [
      siteIdQuestion(vars.siteId, recentSiteIds),
      kpiQuestion({ multi: true, required: false }),
    ],
  };
}

function chipExplainRca(vars: Vars, recentSiteIds: string[]): FollowupChip {
  return {
    label: 'Explain RCA',
    description: vars.siteId ? `For site ${vars.siteId}` : 'Pick the site to investigate',
    intent: 'explain_rca',
    prompt: 'Run a root-cause analysis for site {{siteId}}',
    needs: [siteIdQuestion(vars.siteId, recentSiteIds)],
  };
}

function chipDeepAnalysis(vars: Vars, recentSiteIds: string[]): FollowupChip {
  return {
    label: 'Run deep analysis',
    description: vars.siteId
      ? `Full investigation on site ${vars.siteId}`
      : 'Full investigation — pick a site',
    intent: 'deep_analysis',
    prompt: 'Run a deep AI investigation on site {{siteId}} — topology, hourly trends, config changes, neighbors, cluster comparison',
    needs: [siteIdQuestion(vars.siteId, recentSiteIds)],
  };
}

function chipShowTopology(vars: Vars, recentSiteIds: string[]): FollowupChip {
  if (vars.siteId) {
    return {
      label: 'Show topology',
      description: `Cells and bands for site ${vars.siteId}`,
      intent: 'show_topology',
      prompt: 'Show the topology for site {{siteId}}',
    };
  }
  return {
    label: 'Show topology',
    description: 'Pick a site',
    intent: 'show_topology',
    prompt: 'Show the topology for site {{siteId}}',
    needs: [siteIdQuestion(vars.siteId, recentSiteIds)],
  };
}

function chipConfigChanges(vars: Vars, recentSiteIds: string[]): FollowupChip {
  return {
    label: 'Check config changes',
    description: vars.siteId ? `Parameters changed on site ${vars.siteId}` : 'Pick a site',
    intent: 'check_config_changes',
    prompt: 'What parameters changed on site {{siteId}} in the last {{daysBack}} days?',
    needs: [
      ...(vars.siteId ? [] : [siteIdQuestion(vars.siteId, recentSiteIds)]),
      timeWindowQuestion(),
    ],
  };
}

function chipRetChanges(vars: Vars, recentSiteIds: string[]): FollowupChip {
  return {
    label: 'Check RET changes',
    description: vars.siteId ? `Antenna tilts on site ${vars.siteId}` : 'Pick a site',
    intent: 'check_ret_changes',
    prompt: 'Show antenna tilt changes for site {{siteId}} over the last 14 days',
    needs: vars.siteId ? undefined : [siteIdQuestion(vars.siteId, recentSiteIds)],
  };
}

function chipNeighborOutages(vars: Vars, recentSiteIds: string[]): FollowupChip {
  return {
    label: 'Check neighbor outages',
    description: vars.siteId ? `Neighbors of site ${vars.siteId}` : 'Pick a site',
    intent: 'check_neighbor_outages',
    prompt: 'Are any of site {{siteId}} neighbors having outages?',
    needs: vars.siteId ? undefined : [siteIdQuestion(vars.siteId, recentSiteIds)],
  };
}

function chipCompareCluster(vars: Vars, recentSiteIds: string[]): FollowupChip {
  return {
    label: 'Compare with cluster',
    description: vars.siteId ? `Rank site ${vars.siteId} vs peers` : 'Pick a site and KPI',
    intent: 'compare_with_cluster',
    prompt: 'Compare site {{siteId}} with its cluster peers on {{kpiName}}',
    needs: [
      ...(vars.siteId ? [] : [siteIdQuestion(vars.siteId, recentSiteIds)]),
      kpiQuestion({ multi: false, required: true }),
    ],
  };
}

function chipAddKpi(vars: Vars): FollowupChip {
  return {
    label: 'Add another KPI',
    description: 'Pick from the full DB list',
    intent: 'add_kpi_to_dashboard',
    prompt: vars.siteId
      ? 'Add {{kpiName}} to the dashboard for site {{siteId}}'
      : 'Add {{kpiName}} to the dashboard',
    needs: [kpiQuestion({ multi: true, required: true })],
  };
}

function chipSwitchHourly(vars: Vars): FollowupChip {
  return {
    label: 'Switch to hourly',
    description: vars.siteId ? `Hourly view for ${vars.siteId}` : 'Hourly granularity',
    intent: 'switch_hourly',
    prompt: vars.siteId
      ? 'Switch the dashboard for site {{siteId}} to hourly view (last 48 hours)'
      : 'Switch the current dashboard to hourly view',
  };
}

function chipSaveDashboard(): FollowupChip {
  return {
    label: 'Save dashboard',
    description: 'Pin to the sidebar',
    intent: 'save_dashboard',
    prompt: 'Save this dashboard',
  };
}

function chipExplainTopOffender(): FollowupChip {
  return {
    label: 'Explain top offender',
    description: 'RCA on the #1 site in the list',
    intent: 'explain_top_offender',
    prompt: 'Run an RCA on the worst offender today',
  };
}

function chipFilterCluster(): FollowupChip {
  return {
    label: 'Filter by cluster',
    description: 'Group results by cluster',
    intent: 'filter_by_cluster',
    prompt: 'Show worst offenders grouped by cluster',
  };
}

function chipFindSitesUsingParam(): FollowupChip {
  return {
    label: 'Find sites using this',
    description: 'Where is this parameter non-default?',
    intent: 'find_sites_using_param',
    prompt: 'Find sites where this parameter has a non-default value',
  };
}

// ─── Trace introspection ────────────────────────────────────────────────────

interface Vars {
  siteId?: string;
  kpiName?: string;
  startDate?: string;
  endDate?: string;
}

function extractVars(trace: ToolTrace[]): { vars: Vars; recentSiteIds: string[] } {
  const vars: Vars = {};
  const siteIds: string[] = [];
  for (let i = trace.length - 1; i >= 0; i--) {
    const args = trace[i].args ?? {};
    // siteId — walk every common alias
    const sid =
      args.siteId ??
      args.usid ??
      args.USID ??
      args.SOURCE_USID ??
      args.source_usid ??
      (Array.isArray(args.siteIds) && args.siteIds[0]) ??
      undefined;
    if (sid && !siteIds.includes(String(sid))) siteIds.push(String(sid));
    if (Array.isArray(args.siteIds)) {
      for (const s of args.siteIds) {
        if (s && !siteIds.includes(String(s))) siteIds.push(String(s));
      }
    }
    if (!vars.siteId && sid) vars.siteId = String(sid);
    if (!vars.kpiName && Array.isArray(args.kpiNames) && args.kpiNames.length) {
      vars.kpiName = String(args.kpiNames[0]);
    }
    if (!vars.startDate && typeof args.startDate === 'string') vars.startDate = args.startDate;
    if (!vars.endDate && typeof args.endDate === 'string') vars.endDate = args.endDate;
  }
  return { vars, recentSiteIds: siteIds };
}

// ─── Per-tool follow-up plans ───────────────────────────────────────────────

type ChipBuilder = (vars: Vars, recent: string[]) => FollowupChip;

const PLAN_BY_TOOL: Record<string, ChipBuilder[]> = {
  // Discovery / search
  find_site:        [chipExplainRca, chipShowKpiTrends, chipShowTopology],
  get_worst_offenders: [
    chipExplainTopOffender,
    chipShowKpiTrends,
    chipDeepAnalysis,
    chipFilterCluster,
  ],

  // Site investigation
  get_site_rca:                [chipShowKpiTrends, chipShowTopology, chipConfigChanges, chipNeighborOutages],
  // Live RCA produces a recommendation card alongside the summary — same
  // useful follow-ups as the precomputed path.
  run_rca_live:                [chipShowKpiTrends, chipShowTopology, chipConfigChanges, chipCompareCluster],
  get_site_kpis:               [chipShowKpiTrends, chipCompareCluster, chipExplainRca],
  get_site_topology:           [chipShowKpiTrends, chipRetChanges, chipConfigChanges],
  get_neighbor_relations:      [chipNeighborOutages, chipShowKpiTrends, chipCompareCluster],
  get_neighbor_outages:        [chipShowKpiTrends, chipExplainRca],
  get_ret_changes:             [chipShowKpiTrends, chipConfigChanges],
  get_site_outages:            [chipExplainRca, chipShowKpiTrends, chipNeighborOutages],
  get_config_changes:          [chipShowKpiTrends, chipExplainRca],
  get_kpi_impact_breakdown:    [chipShowKpiTrends, chipExplainRca, chipCompareCluster],
  get_ticket_history:          [chipExplainRca],
  compare_with_cluster:        [chipShowKpiTrends, chipExplainRca],

  // Dashboard / ad-hoc
  show_kpi_dashboard: [chipAddKpi, chipSwitchHourly, chipCompareCluster, chipSaveDashboard],
  get_hourly_trends:  [chipAddKpi, chipExplainRca],
  query_data:         [chipSaveDashboard],

  // Knowledge / map
  get_telecom_knowledge: [chipFindSitesUsingParam],
  resolve_kpi_param:     [chipShowKpiTrends],
  set_map_layer:         [chipExplainTopOffender],
  get_local_events:      [chipExplainRca, chipShowKpiTrends],
  navigate_to:           [],
};

// Tools that mention the same chip type are de-duplicated — first occurrence wins.
const TOOL_PRIORITY: Record<string, number> = {
  get_site_rca: 100,
  get_kpi_impact_breakdown: 95,
  show_kpi_dashboard: 90,
  get_hourly_trends: 88,
  get_worst_offenders: 85,
  get_site_topology: 80,
  get_site_outages: 78,
  get_neighbor_relations: 75,
  get_neighbor_outages: 73,
  get_config_changes: 70,
  get_ret_changes: 68,
  compare_with_cluster: 65,
  get_site_kpis: 60,
  query_data: 55,
  get_ticket_history: 50,
  find_site: 45,
  get_telecom_knowledge: 30,
  resolve_kpi_param: 25,
  get_local_events: 20,
  set_map_layer: 10,
  navigate_to: 5,
};

// ─── Public API ─────────────────────────────────────────────────────────────

export function buildFollowupChips(
  trace: ToolTrace[],
  options: { maxChips?: number } = {},
): FollowupChip[] | null {
  const maxChips = options.maxChips ?? 4;
  if (!trace.length) return null;

  const usedTools = Array.from(new Set(trace.map((t) => t.name).filter(Boolean)));
  if (!usedTools.length) return null;
  usedTools.sort((a, b) => (TOOL_PRIORITY[b] ?? 0) - (TOOL_PRIORITY[a] ?? 0));

  const { vars, recentSiteIds } = extractVars(trace);

  const seenIntents = new Set<string>();
  const out: FollowupChip[] = [];
  for (const tool of usedTools) {
    const builders = PLAN_BY_TOOL[tool] ?? [];
    for (const builder of builders) {
      const chip = builder(vars, recentSiteIds);
      const key = chip.intent ?? chip.label;
      if (seenIntents.has(key)) continue;
      seenIntents.add(key);
      out.push(chip);
      if (out.length >= maxChips) return out;
    }
  }
  return out.length ? out : null;
}
