/**
 * UI Command Interpreter
 * Converts natural language into UI actions the frontend can execute.
 *
 * Goal: avoid hard-coded phrase matching in the client. Use LLM when available,
 * with a small fallback parser when OPENAI_API_KEY isn't configured.
 */
import { openai, hasConfiguredOpenAIKey } from '../config/openai.js';
import { logger } from '../utils/logger.js';

export type UiCommandAction =
  // ── Existing ──────────────────────────────────────────────────────────────
  | { type: 'MAP_FOCUS_SITE'; siteToken: string; openAnalysis?: boolean }
  | { type: 'SHOW_SITE_STATS'; siteToken?: string }
  | { type: 'EXPLAIN_RCA'; siteToken?: string }
  | { type: 'SHOW_CAPABILITIES' }
  // ── Generative UI: tab navigation ─────────────────────────────────────────
  | { type: 'OPEN_SITE_TAB'; tab: 'site-kpi' | 'rca' | 'operational' | 'topology'; siteToken?: string }
  | { type: 'OPEN_KPI_TAB'; kpiTab: 'cqx' | 'daily' | 'hourly' | 'overlay' | 'traffic-profile' | 'mobility' | 'outages'; siteToken?: string }
  | { type: 'OPEN_RCA_TAB'; rcaTab: 'evidences' | 'summary' | 'raw-data'; siteToken?: string }
  | { type: 'OPEN_DIAGNOSTIC'; siteToken?: string }
  // ── Generative UI: map state ───────────────────────────────────────────────
  | { type: 'SET_DATE_FILTER'; dateId: string }
  | { type: 'SET_MAP_LAYER'; layer: 'degraded' | 'outage' | 'overutilized' }
  | { type: 'CLEAR_MAP_LAYER' }
  | { type: 'TOGGLE_EVENTS_LAYER'; enabled?: boolean }
  | { type: 'TOGGLE_EXTERNAL_MAP'; enabled?: boolean; provider?: 'maplibre' | 'esri' }
  // ── Generative UI: app navigation ─────────────────────────────────────────
  | { type: 'NAVIGATE_VIEW'; view: 'observe' | 'appgen' | 'provision' | 'settings' | 'home' };

export interface UiCommandResult {
  assistantText: string;
  actions: UiCommandAction[];
  followUpQuestions?: string[];
  capabilities?: Array<{ id: string; label: string; examples: string[] }>;
}

const CAPABILITIES: UiCommandResult['capabilities'] = [
  {
    id: 'map_navigate',
    label: 'Navigate / zoom the map to a site',
    examples: ['Take me to site 9817', 'Show me USID 9817', 'Where is UST9817?'],
  },
  {
    id: 'site_stats',
    label: 'Open site stats / analysis',
    examples: ['Show stats for site 9817', 'Open analysis for USID 9817'],
  },
  {
    id: 'site_rca',
    label: 'Explain RCA for a site',
    examples: ['Explain the RCA for USID 9817', 'Why is site 9817 degraded?'],
  },
  {
    id: 'open_kpi',
    label: 'Open a specific KPI view (CQX, Daily, Hourly, Traffic, Mobility, Outages)',
    examples: ['Show daily KPI', 'Open CQX view', 'Show traffic profile', 'Open hourly KPI for 9817'],
  },
  {
    id: 'open_rca_tab',
    label: 'Open a specific RCA sub-tab (evidences, summary, raw data)',
    examples: ['Show RCA evidence', 'Open RCA summary', 'Show raw RCA data'],
  },
  {
    id: 'open_diagnostic',
    label: 'Switch the analysis panel to diagnostic mode',
    examples: ['Open diagnostic view', 'Show diagnostic for 9817', 'Switch to diagnostic'],
  },
  {
    id: 'set_date',
    label: 'Change the map date filter',
    examples: ['Set date to 2026-04-07', 'Switch to April 7th'],
  },
  {
    id: 'set_layer',
    label: 'Switch or clear the active site layer on the map',
    examples: ['Show outage sites', 'Switch to overutilized layer', 'Show degraded sites', 'Clear the site layer'],
  },
  {
    id: 'toggle_events',
    label: 'Toggle the local events overlay (concerts, weather, news, sports)',
    examples: ['Turn on the events layer', 'Hide events', 'Show nearby events', 'Toggle events layer'],
  },
  {
    id: 'toggle_external_map',
    label: 'Toggle the external base-map overlay (MapLibre or Esri)',
    examples: ['Show Esri map overlay', 'Enable external map layer', 'Switch to Esri', 'Hide the MapLibre overlay'],
  },
  {
    id: 'navigate',
    label: 'Navigate to a different app section',
    examples: ['Go to AppGen', 'Open provisioning', 'Navigate to settings'],
  },
];

function normalizeSiteToken(input: string): string {
  const s = String(input || '').trim();
  if (!s) return '';
  const upper = s.toUpperCase();
  const ust = upper.match(/^UST0*(\d{4,8})$/);
  if (ust) return ust[1];
  if (/^\d{4,8}$/.test(upper)) return String(parseInt(upper, 10));
  return upper;
}

function fallbackInterpret(query: string): UiCommandResult {
  const q = String(query || '').trim();
  const lower = q.toLowerCase();

  if (/\b(help|what can you do|capabilities|commands)\b/.test(lower)) {
    return {
      assistantText:
        'Here are a few things I can do in this map view:\n' +
        CAPABILITIES!.map((c) => `• **${c.label}** — e.g. *${c.examples[0]}*`).join('\n'),
      actions: [{ type: 'SHOW_CAPABILITIES' }],
      capabilities: CAPABILITIES,
    };
  }

  // ── App navigation ─────────────────────────────────────────────────────────
  if (/\b(go to|open|navigate to|switch to)\s+(appgen|app gen|app generation)\b/.test(lower)) {
    return { assistantText: 'Opening AppGen studio.', actions: [{ type: 'NAVIGATE_VIEW', view: 'appgen' }], capabilities: CAPABILITIES };
  }
  if (/\b(go to|open|navigate to|switch to)\s+(provision|provisioning)\b/.test(lower)) {
    return { assistantText: 'Opening Provisioning.', actions: [{ type: 'NAVIGATE_VIEW', view: 'provision' }], capabilities: CAPABILITIES };
  }
  if (/\b(go to|open|navigate to|switch to)\s+(settings|setting)\b/.test(lower)) {
    return { assistantText: 'Opening Settings.', actions: [{ type: 'NAVIGATE_VIEW', view: 'settings' }], capabilities: CAPABILITIES };
  }

  // ── Map layer ──────────────────────────────────────────────────────────────
  if (/\b(outage|outages)\b/.test(lower) && /\b(layer|sites|show|switch)\b/.test(lower)) {
    return { assistantText: 'Switching to outage sites layer.', actions: [{ type: 'SET_MAP_LAYER', layer: 'outage' }], capabilities: CAPABILITIES };
  }
  if (/\b(overutil|over-util|overutilized)\b/.test(lower)) {
    return { assistantText: 'Switching to overutilized sites layer.', actions: [{ type: 'SET_MAP_LAYER', layer: 'overutilized' }], capabilities: CAPABILITIES };
  }
  if (/\b(degraded|degrad)\b/.test(lower)) {
    return { assistantText: 'Switching to degraded sites layer.', actions: [{ type: 'SET_MAP_LAYER', layer: 'degraded' }], capabilities: CAPABILITIES };
  }
  if (/\b(clear|hide|remove|reset)\b/.test(lower) && /\b(layer|filter|site layer|map layer)\b/.test(lower)) {
    return { assistantText: 'Cleared the site layer filter — showing all sites.', actions: [{ type: 'CLEAR_MAP_LAYER' }], capabilities: CAPABILITIES };
  }

  // ── Events layer ───────────────────────────────────────────────────────────
  if (/\b(events?|concert|sports?|weather|news|festival|holiday)\b/.test(lower)) {
    const hide = /\b(hide|off|disable|turn off|remove)\b/.test(lower);
    const show = /\b(show|on|enable|turn on|add|toggle)\b/.test(lower);
    const enabled = hide ? false : (show ? true : undefined);
    const text = hide ? 'Events layer hidden.' : 'Events layer enabled — showing nearby concerts, sports, weather, and news.';
    return { assistantText: text, actions: [{ type: 'TOGGLE_EVENTS_LAYER', enabled }], capabilities: CAPABILITIES };
  }

  // ── External map layer ─────────────────────────────────────────────────────
  if (/\b(esri|arcgis)\b/.test(lower)) {
    const hide = /\b(hide|off|disable|turn off|remove)\b/.test(lower);
    return {
      assistantText: hide ? 'External map layer hidden.' : 'Switching to Esri map overlay.',
      actions: [{ type: 'TOGGLE_EXTERNAL_MAP', enabled: hide ? false : true, provider: 'esri' }],
      capabilities: CAPABILITIES,
    };
  }
  if (/\b(maplibre|openstreetmap|osm|external map)\b/.test(lower)) {
    const hide = /\b(hide|off|disable|turn off|remove)\b/.test(lower);
    return {
      assistantText: hide ? 'External map layer hidden.' : 'Enabling MapLibre overlay.',
      actions: [{ type: 'TOGGLE_EXTERNAL_MAP', enabled: hide ? false : true, provider: 'maplibre' }],
      capabilities: CAPABILITIES,
    };
  }
  if (/\b(external map|base.?map overlay)\b/.test(lower)) {
    const hide = /\b(hide|off|disable|turn off|remove)\b/.test(lower);
    return {
      assistantText: hide ? 'External map layer hidden.' : 'External map layer enabled.',
      actions: [{ type: 'TOGGLE_EXTERNAL_MAP', enabled: hide ? false : true }],
      capabilities: CAPABILITIES,
    };
  }

  // ── Date filter ────────────────────────────────────────────────────────────
  const dateMatch =
    q.match(/\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/) ??
    q.match(/\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/);
  if (dateMatch && /\b(date|set|switch|change|filter|show)\b/.test(lower)) {
    const rawDate = dateMatch[1];
    let dateId = rawDate.replace(/\//g, '-');
    const parts = dateId.split('-');
    if (parts.length === 3 && parts[0].length <= 2) {
      const [m, d, y] = parts;
      const year = y.length === 2 ? `20${y}` : y;
      dateId = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return {
      assistantText: `Setting map date to **${dateId}**.`,
      actions: [{ type: 'SET_DATE_FILTER', dateId }],
      capabilities: CAPABILITIES,
    };
  }

  // ── Diagnostic / summary view ──────────────────────────────────────────────
  const siteToken =
    q.match(/\bUST0*(\d{4,8})\b/i)?.[1] ??
    q.match(/\bfor\s+(\d{4,8})\b/i)?.[1] ??
    q.match(/\b(\d{4,8})\b/)?.[1] ??
    '';
  const normalized = normalizeSiteToken(siteToken);

  if (/\b(diagnostic|diagnostics)\b/.test(lower)) {
    return {
      assistantText: normalized ? `Opening diagnostic view for **${normalized}**.` : 'Switching to diagnostic view.',
      actions: [{ type: 'OPEN_DIAGNOSTIC', ...(normalized ? { siteToken: normalized } : {}) }],
      capabilities: CAPABILITIES,
    };
  }

  // ── KPI sub-tabs ───────────────────────────────────────────────────────────
  if (/\b(cqx)\b/.test(lower)) {
    return { assistantText: 'Opening CQX view.', actions: [{ type: 'OPEN_KPI_TAB', kpiTab: 'cqx', ...(normalized ? { siteToken: normalized } : {}) }], capabilities: CAPABILITIES };
  }
  if (/\b(hourly)\b/.test(lower) && /\b(kpi|view|tab|metric)\b/.test(lower)) {
    return { assistantText: 'Opening hourly KPI view.', actions: [{ type: 'OPEN_KPI_TAB', kpiTab: 'hourly', ...(normalized ? { siteToken: normalized } : {}) }], capabilities: CAPABILITIES };
  }
  if (/\b(daily)\b/.test(lower) && /\b(kpi|view|tab|metric)\b/.test(lower)) {
    return { assistantText: 'Opening daily KPI view.', actions: [{ type: 'OPEN_KPI_TAB', kpiTab: 'daily', ...(normalized ? { siteToken: normalized } : {}) }], capabilities: CAPABILITIES };
  }
  if (/\b(traffic|traffic profile)\b/.test(lower)) {
    return { assistantText: 'Opening traffic profile.', actions: [{ type: 'OPEN_KPI_TAB', kpiTab: 'traffic-profile', ...(normalized ? { siteToken: normalized } : {}) }], capabilities: CAPABILITIES };
  }
  if (/\b(mobility)\b/.test(lower)) {
    return { assistantText: 'Opening mobility view.', actions: [{ type: 'OPEN_KPI_TAB', kpiTab: 'mobility', ...(normalized ? { siteToken: normalized } : {}) }], capabilities: CAPABILITIES };
  }
  if (/\b(outage)\b/.test(lower) && /\b(kpi|view|tab|analysis|panel)\b/.test(lower)) {
    return { assistantText: 'Opening outages KPI view.', actions: [{ type: 'OPEN_KPI_TAB', kpiTab: 'outages', ...(normalized ? { siteToken: normalized } : {}) }], capabilities: CAPABILITIES };
  }

  // ── RCA sub-tabs ───────────────────────────────────────────────────────────
  if (/\b(rca evidence|rca evidences|evidence)\b/.test(lower)) {
    return { assistantText: 'Opening RCA evidences.', actions: [{ type: 'OPEN_RCA_TAB', rcaTab: 'evidences', ...(normalized ? { siteToken: normalized } : {}) }], capabilities: CAPABILITIES };
  }
  if (/\b(rca summary|rca summaries)\b/.test(lower)) {
    return { assistantText: 'Opening RCA summary.', actions: [{ type: 'OPEN_RCA_TAB', rcaTab: 'summary', ...(normalized ? { siteToken: normalized } : {}) }], capabilities: CAPABILITIES };
  }
  if (/\b(raw data|raw rca|rca raw)\b/.test(lower)) {
    return { assistantText: 'Opening raw RCA data.', actions: [{ type: 'OPEN_RCA_TAB', rcaTab: 'raw-data', ...(normalized ? { siteToken: normalized } : {}) }], capabilities: CAPABILITIES };
  }

  // ── Top-level analysis tabs ────────────────────────────────────────────────
  if (/\b(site kpi|kpi tab|kpi view|show kpi|open kpi)\b/.test(lower)) {
    return { assistantText: 'Opening Site KPI view.', actions: [{ type: 'OPEN_SITE_TAB', tab: 'site-kpi', ...(normalized ? { siteToken: normalized } : {}) }], capabilities: CAPABILITIES };
  }
  if (/\b(operational|operational info)\b/.test(lower)) {
    return { assistantText: 'Opening Operational Info.', actions: [{ type: 'OPEN_SITE_TAB', tab: 'operational', ...(normalized ? { siteToken: normalized } : {}) }], capabilities: CAPABILITIES };
  }
  if (/\b(topology|site topology)\b/.test(lower)) {
    return { assistantText: 'Opening Site Topology.', actions: [{ type: 'OPEN_SITE_TAB', tab: 'topology', ...(normalized ? { siteToken: normalized } : {}) }], capabilities: CAPABILITIES };
  }

  // ── RCA / Stats / Map focus (existing) ────────────────────────────────────
  if (/\b(rca|root cause|why)\b/.test(lower)) {
    return {
      assistantText: normalized
        ? `Got it — I'll explain the RCA for **${normalized}**.`
        : `Which site/USID should I explain the RCA for?`,
      actions: normalized ? [{ type: 'EXPLAIN_RCA', siteToken: normalized }] : [],
      followUpQuestions: normalized ? undefined : ['Which USID/site should I use?'],
      capabilities: CAPABILITIES,
    };
  }

  if (/\b(stats|kpi|metrics|performance|health)\b/.test(lower)) {
    return {
      assistantText: normalized
        ? `Opening stats for **${normalized}**.`
        : `Which site/USID should I show stats for?`,
      actions: normalized ? [{ type: 'SHOW_SITE_STATS', siteToken: normalized }] : [],
      followUpQuestions: normalized ? undefined : ['Which USID/site should I use?'],
      capabilities: CAPABILITIES,
    };
  }

  if (normalized) {
    return {
      assistantText: `Taking you to **${normalized}** on the map.`,
      actions: [{ type: 'MAP_FOCUS_SITE', siteToken: normalized, openAnalysis: false }],
      capabilities: CAPABILITIES,
    };
  }

  return {
    assistantText:
      "Tell me what you'd like to do. For example: *Show KPI for 9817*, *Open CQX view*, *Explain RCA for USID 9817*, or *Switch to outage layer*.",
    actions: [],
    capabilities: CAPABILITIES,
  };
}

export class UiCommandService {
  static async interpret(payload: {
    query: string;
    currentView?: string;
    selectedSiteToken?: string | null;
    selectedDateId?: string | null;
  }): Promise<UiCommandResult> {
    const query = String(payload.query || '').trim();
    if (!query) {
      return {
        assistantText: 'Ask me something like: *Take me to site 9817*.',
        actions: [],
        capabilities: CAPABILITIES,
      };
    }

    if (!hasConfiguredOpenAIKey()) {
      return fallbackInterpret(query);
    }

    const model = String(process.env.OPENAI_UI_COMMAND_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini');

    const system = `You are "Aira", an AI copilot embedded in a network observability web app.
Your job: interpret the user's message and produce UI actions the frontend can execute.

You MUST return ONLY valid JSON (no markdown).

Current view: ${payload.currentView || 'observe'}
Selected date: ${payload.selectedDateId || 'unknown'}
Selected site (if any): ${payload.selectedSiteToken || 'none'}

Supported actions (use these EXACT type strings):

Navigation:
- MAP_FOCUS_SITE: zoom map to a site { siteToken: string, openAnalysis?: boolean }
- SHOW_SITE_STATS: open site stats { siteToken?: string }
- EXPLAIN_RCA: explain RCA for a site { siteToken?: string }
- SHOW_CAPABILITIES: list available commands

Generative UI — tab navigation (these open specific panels inside the analysis tile):
- OPEN_SITE_TAB: open a top-level analysis tab { tab: "site-kpi"|"rca"|"operational"|"topology", siteToken?: string }
- OPEN_KPI_TAB: open a KPI sub-tab { kpiTab: "cqx"|"daily"|"hourly"|"overlay"|"traffic-profile"|"mobility"|"outages", siteToken?: string }
- OPEN_RCA_TAB: open an RCA sub-tab { rcaTab: "evidences"|"summary"|"raw-data", siteToken?: string }
- OPEN_DIAGNOSTIC: switch to diagnostic (full KPI) mode { siteToken?: string }

Generative UI — map state:
- SET_DATE_FILTER: change the map date { dateId: "YYYY-MM-DD" }
- SET_MAP_LAYER: switch site layer { layer: "degraded"|"outage"|"overutilized" }
- CLEAR_MAP_LAYER: clear/hide the active site layer, show all sites (no extra params)
- TOGGLE_EVENTS_LAYER: toggle events overlay (concerts, sports, weather, news) { enabled?: boolean }
- TOGGLE_EXTERNAL_MAP: toggle base-map overlay { enabled?: boolean, provider?: "maplibre"|"esri" }

Generative UI — app navigation:
- NAVIGATE_VIEW: go to a section { view: "observe"|"appgen"|"provision"|"settings"|"home" }

Rules:
- Extract "USID 9817", "site 9817", "UST9817" → siteToken.
- If the user says "show KPI", "open diagnostic", or "open CQX", prefer OPEN_KPI_TAB / OPEN_SITE_TAB over SHOW_SITE_STATS.
- For "show daily KPI for 9817" → OPEN_KPI_TAB kpiTab=daily + siteToken=9817.
- If no siteToken but selectedSiteToken is set, use selectedSiteToken.
- Never ask for confirmation. Return actions immediately when intent is clear.
- Return multiple actions when needed (e.g. focus site THEN open tab).

Output schema:
{
  "assistantText": string,
  "actions": UiCommandAction[],
  "followUpQuestions": string[] | undefined
}`;

    try {
      const resp = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: query },
        ],
        temperature: 0.2,
        max_tokens: 450,
        response_format: { type: 'json_object' } as any,
      });

      const content = resp.choices?.[0]?.message?.content;
      if (!content) throw new Error('No content from model');

      const parsed = JSON.parse(content) as Partial<UiCommandResult>;
      const assistantText = String(parsed.assistantText || '').trim();
      const actionsRaw = Array.isArray(parsed.actions) ? parsed.actions : [];

      const VALID_TOP_TABS  = new Set(['site-kpi', 'rca', 'operational', 'topology']);
      const VALID_KPI_TABS  = new Set(['cqx', 'daily', 'hourly', 'overlay', 'traffic-profile', 'mobility', 'outages']);
      const VALID_RCA_TABS  = new Set(['evidences', 'summary', 'raw-data']);
      const VALID_LAYERS    = new Set(['degraded', 'outage', 'overutilized']);
      const VALID_VIEWS     = new Set(['observe', 'appgen', 'provision', 'settings', 'home']);
      const VALID_PROVIDERS = new Set(['maplibre', 'esri']);

      const actions: UiCommandAction[] = actionsRaw
        .map((a: any) => {
          const type = String(a?.type || '').trim();
          const st = (a?.siteToken) ? normalizeSiteToken(String(a.siteToken)) : undefined;
          if (type === 'MAP_FOCUS_SITE') {
            const siteToken = normalizeSiteToken(String(a?.siteToken || ''));
            if (!siteToken) return null;
            return { type, siteToken, openAnalysis: Boolean(a?.openAnalysis) } as UiCommandAction;
          }
          if (type === 'SHOW_SITE_STATS') return { type, ...(st ? { siteToken: st } : {}) } as UiCommandAction;
          if (type === 'EXPLAIN_RCA')     return { type, ...(st ? { siteToken: st } : {}) } as UiCommandAction;
          if (type === 'SHOW_CAPABILITIES') return { type } as UiCommandAction;
          if (type === 'OPEN_SITE_TAB') {
            const tab = String(a?.tab || '');
            if (!VALID_TOP_TABS.has(tab)) return null;
            return { type, tab, ...(st ? { siteToken: st } : {}) } as UiCommandAction;
          }
          if (type === 'OPEN_KPI_TAB') {
            const kpiTab = String(a?.kpiTab || '');
            if (!VALID_KPI_TABS.has(kpiTab)) return null;
            return { type, kpiTab, ...(st ? { siteToken: st } : {}) } as UiCommandAction;
          }
          if (type === 'OPEN_RCA_TAB') {
            const rcaTab = String(a?.rcaTab || '');
            if (!VALID_RCA_TABS.has(rcaTab)) return null;
            return { type, rcaTab, ...(st ? { siteToken: st } : {}) } as UiCommandAction;
          }
          if (type === 'OPEN_DIAGNOSTIC') return { type, ...(st ? { siteToken: st } : {}) } as UiCommandAction;
          if (type === 'SET_DATE_FILTER') {
            const dateId = String(a?.dateId || '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateId)) return null;
            return { type, dateId } as UiCommandAction;
          }
          if (type === 'SET_MAP_LAYER') {
            const layer = String(a?.layer || '');
            if (!VALID_LAYERS.has(layer)) return null;
            return { type, layer } as UiCommandAction;
          }
          if (type === 'CLEAR_MAP_LAYER') return { type } as UiCommandAction;
          if (type === 'TOGGLE_EVENTS_LAYER') {
            const enabled = a?.enabled == null ? undefined : Boolean(a.enabled);
            return { type, ...(enabled !== undefined ? { enabled } : {}) } as UiCommandAction;
          }
          if (type === 'TOGGLE_EXTERNAL_MAP') {
            const enabled = a?.enabled == null ? undefined : Boolean(a.enabled);
            const provider = String(a?.provider || '');
            return {
              type,
              ...(enabled !== undefined ? { enabled } : {}),
              ...(VALID_PROVIDERS.has(provider) ? { provider } : {}),
            } as UiCommandAction;
          }
          if (type === 'NAVIGATE_VIEW') {
            const view = String(a?.view || '');
            if (!VALID_VIEWS.has(view)) return null;
            return { type, view } as UiCommandAction;
          }
          return null;
        })
        .filter(Boolean) as UiCommandAction[];

      const followUpQuestions = Array.isArray(parsed.followUpQuestions)
        ? parsed.followUpQuestions.map((x) => String(x)).filter(Boolean).slice(0, 3)
        : undefined;

      // Fill missing siteToken for actions that can default to the currently selected site.
      const selectedToken = normalizeSiteToken(String(payload.selectedSiteToken || ''));
      const SITE_TOKEN_ACTIONS = new Set(['SHOW_SITE_STATS', 'EXPLAIN_RCA', 'OPEN_SITE_TAB', 'OPEN_KPI_TAB', 'OPEN_RCA_TAB', 'OPEN_DIAGNOSTIC']);
      const actionsWithDefaults: UiCommandAction[] = actions.map((action) => {
        if (!selectedToken) return action;
        if (SITE_TOKEN_ACTIONS.has(action.type) && !('siteToken' in action && (action as any).siteToken)) {
          return { ...action, siteToken: selectedToken } as UiCommandAction;
        }
        return action;
      });

      return {
        assistantText: assistantText || fallbackInterpret(query).assistantText,
        actions: actionsWithDefaults,
        followUpQuestions,
        capabilities: CAPABILITIES,
      };
    } catch (error) {
      logger.warn('UI command interpretation failed; using fallback.', error);
      return fallbackInterpret(query);
    }
  }
}
