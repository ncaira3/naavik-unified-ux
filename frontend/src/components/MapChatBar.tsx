/**
 * MapChatBar — AI assistant anchored to the Observe map.
 * Supports agentic actions: navigate to site, show stats, explain RCA.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, X, Sparkles, MapPin, Brain, ChevronDown,
  AlertCircle, CheckCircle2, BarChart2, Loader2, Database,
} from 'lucide-react';
import api from '../services/api';
import type { MapSite } from './MapView';
import { useChat } from '../context/ChatContext';
import { useMapData } from '../context/MapDataContext';
import { useDummifier } from '../context/DummifierContext';
import type { SiteAnalysisPayload, UiCommandAction, UiCommandResult } from '../types';
import UiBlocksRenderer from './GenerativeUI/UiBlocksRenderer';

// ── Message model ─────────────────────────────────────────────────────────────

type ChatMsg =
  | { id: string; role: 'user';      type: 'text';     text: string }
  | { id: string; role: 'assistant'; type: 'text';     text: string; loading?: boolean; uiBlocks?: any[] }
  | { id: string; role: 'assistant'; type: 'nav_card'; site: MapSite }
  | { id: string; role: 'assistant'; type: 'stats_card'; site: MapSite }
  | { id: string; role: 'assistant'; type: 'rca_card'; site: MapSite; analysis: SiteAnalysisPayload; dateId: string }
  | { id: string; role: 'assistant'; type: 'no_rca';   site: MapSite; dateId: string }
  | { id: string; role: 'assistant'; type: 'error';    text: string };

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
type ChatMsgDraft = DistributiveOmit<ChatMsg, 'id'>;

let _seq = 0;
const uid = () => `m${++_seq}_${Date.now()}`;

type PendingConfirmation = {
  actions: UiCommandAction[];
  promptText: string;
};

/** Parse a date from free-text (e.g. "on 4/7/2026" or "2026-04-07"). */
function extractDateFromQuery(text: string): string | undefined {
  // ISO-ish: 2026-04-07 or 2026/04/07
  const iso = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }
  // US short: 4/7/2026 or 4-7-2026
  const us = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/);
  if (us) {
    const m = us[1].padStart(2, '0');
    const d = us[2].padStart(2, '0');
    const y = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${y}-${m}-${d}`;
  }
  return undefined;
}

function normalizeSiteToken(value?: string | null): string {
  const s = String(value || '').trim();
  if (!s) return '';
  const upper = s.toUpperCase();
  const ust = upper.match(/^UST0*(\d{4,8})$/);
  if (ust) return ust[1];
  if (/^\d{4,8}$/.test(upper)) return String(parseInt(upper, 10));
  return upper;
}

function resolveSiteByToken(siteToken: string, sites: MapSite[]): MapSite | null {
  if (!siteToken || !sites.length) return null;
  const needle = normalizeSiteToken(siteToken);
  const tokenMatch = (s: MapSite) => {
    const a = normalizeSiteToken(s.realSiteId || '');
    const b = normalizeSiteToken(s.siteId || '');
    return needle === a || needle === b;
  };
  const direct = sites.find(tokenMatch);
  if (direct) return direct;

  // Soft match: allow exact substring hit in siteName for nicer UX.
  const lowerNeedle = needle.toLowerCase();
  return sites.find((s) => String(s.siteName || '').toLowerCase().includes(lowerNeedle)) ?? null;
}

function isAffirmative(text: string): boolean {
  const t = String(text || '').trim().toLowerCase();
  return ['y', 'yes', 'yeah', 'yep', 'ok', 'okay', 'sure', 'do it', 'confirm'].includes(t);
}

function isNegative(text: string): boolean {
  const t = String(text || '').trim().toLowerCase();
  return ['n', 'no', 'nope', 'nah', 'cancel', 'stop', 'never mind', 'nevermind'].includes(t);
}

function extractSiteTokenFromText(text: string): string {
  const lower = text.toLowerCase();
  // Explicit prefixes first (most reliable)
  const s =
    text.match(/\bUST0*(\d{4,8})\b/i)?.[1] ??
    text.match(/\bUSID\s*[:#]?\s*(\d{4,8})\b/i)?.[1] ??
    text.match(/\bsite\s*[:#]?\s*(\d{4,8})\b/i)?.[1] ??
    text.match(/\bfor\s+(\d{4,8})\b/i)?.[1] ??    // "RCA for 9817"
    text.match(/\b(\d{4,8})\s+on\s+\d/i)?.[1] ??  // "9817 on 4/7/2026"
    // Bare 4-8 digit number only in clearly site-related queries
    (/(rca|root cause|stats|kpi|analysis|site|explain|diagnose)/i.test(lower)
      ? text.match(/\b(\d{4,8})\b/)?.[1]
      : '') ??
    '';
  return normalizeSiteToken(s);
}

function inferActionsFromConfirmationText(args: {
  assistantText: string;
  selectedSiteToken?: string | null;
}): UiCommandAction[] | null {
  const { assistantText, selectedSiteToken } = args;
  const t = String(assistantText || '').trim();
  const lower = t.toLowerCase();

  if (!/\bconfirm\b/.test(lower)) return null;

  const tokenFromText = extractSiteTokenFromText(t);
  const fallbackToken = normalizeSiteToken(selectedSiteToken || '');
  const siteToken = tokenFromText || fallbackToken;

  if (/\b(stats|kpi|metrics|performance|site stats)\b/.test(lower)) {
    return [{ type: 'SHOW_SITE_STATS', ...(siteToken ? { siteToken } : {}) }];
  }
  if (/\b(rca|root cause|why)\b/.test(lower)) {
    return [{ type: 'EXPLAIN_RCA', ...(siteToken ? { siteToken } : {}) }];
  }
  if (/\b(take me to|go to|navigate|zoom|focus)\b/.test(lower)) {
    if (!siteToken) return null;
    return [{ type: 'MAP_FOCUS_SITE', siteToken, openAnalysis: false }];
  }
  return null;
}

const INSIGHTS_TAB_LABELS: Record<string, string> = {
  market: 'Market (offender rankings, health scores)',
  executive: 'Executive (RRC, ERAB, PRB, SINR KPIs)',
  ran: 'RAN Health (sector diagnostics, load, handover)',
  capacity: 'Capacity (PRB forecasts, offload actions)',
  alarms: 'Alarms (active anomaly scores)',
  forecast: 'AI Forecast (predicted load trends)',
};

function buildObserveContext(
  site: MapSite | null | undefined,
  dateId?: string,
  subView?: string,
  insightsTab?: string,
): string {
  const parts: string[] = ['[Observe Context]'];
  if (subView === 'insights') {
    const tabLabel = insightsTab ? (INSIGHTS_TAB_LABELS[insightsTab] ?? insightsTab) : 'unknown';
    parts.push(`View: Insights dashboard — active tab: ${tabLabel}`);
    parts.push(`Available tabs: market, executive, ran, capacity, alarms, forecast`);
  } else {
    parts.push('View: Network Map');
  }
  if (site) {
    parts.push(`Selected Site: ${site.siteId}${site.realSiteId && site.realSiteId !== site.siteId ? ` (USID: ${site.realSiteId})` : ''}`);
    if (site.siteName) parts.push(`Site Name: ${site.siteName}`);
    parts.push(`Status: ${site.status}`);
    if (site.anomalyCount > 0) parts.push(`Anomalies: ${site.anomalyCount}`);
    if (site.cellCount) parts.push(`Cells: ${site.cellCount}`);
  } else {
    parts.push('No site selected — network-wide view');
  }
  if (dateId) parts.push(`Date: ${dateId}`);
  return parts.join(' | ');
}

function isDataQueryIntent(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(query|select|show me|list|top \d|how many|count|average|avg|sum|worst|best|rank|breakdown|distribution|which sites|compare)\b/.test(t);
}

async function executeUiActions(args: {
  actions: UiCommandAction[];
  selectedSite: MapSite | null;
  selectedDateId?: string;
  queryDateId?: string;
  sites: MapSite[];
  openSite: (site: MapSite) => void;
  pushMsg: (msg: ChatMsgDraft) => string;
  replaceMsg: (id: string, replacement: ChatMsgDraft) => void;
  thinkingId: string;
  assistantText: string;
  // Generative UI context setters
  dispatchTabRequest?: (req: { topTab?: string; kpiTab?: string; rcaSubTab?: string; viewMode?: string }) => void;
  setDateFilter?: (dateId: string) => void;
  setMapLayer?: (layer: 'degraded' | 'outage' | 'overutilized') => void;
  onNavigate?: (view: string) => void;
}): Promise<void> {
  const { actions, selectedSite, selectedDateId, queryDateId, sites, openSite, pushMsg, replaceMsg, thinkingId, assistantText,
    dispatchTabRequest, setDateFilter, setMapLayer, onNavigate } = args;
  // queryDateId (extracted from the user's message text) takes priority over the map's selected date.
  const dateId = queryDateId ?? selectedDateId ?? new Date().toISOString().slice(0, 10);

  // Always show the assistant message first (then cards/actions follow).
  replaceMsg(thinkingId, { role: 'assistant', type: 'text', text: assistantText || 'Okay.' });

  const getTarget = (siteToken?: string) =>
    (siteToken ? resolveSiteByToken(siteToken, sites) : null) ?? selectedSite ?? null;

  for (const action of actions) {
    if (action.type === 'SHOW_CAPABILITIES') continue;

    if (action.type === 'MAP_FOCUS_SITE') {
      const target = getTarget(action.siteToken);
      if (!target) {
        pushMsg({
          role: 'assistant',
          type: 'text',
          text: `I couldn't find **${action.siteToken}** in the loaded map dataset. Try a different USID/site, or zoom out to load more sites.`,
        });
        continue;
      }
      openSite(target);
      pushMsg({ role: 'assistant', type: 'nav_card', site: target });
      continue;
    }

    if (action.type === 'SHOW_SITE_STATS') {
      const target = getTarget(action.siteToken);
      if (!target) {
        pushMsg({
          role: 'assistant',
          type: 'text',
          text: "Which site/USID should I show stats for? (e.g. *Show stats for 9817*)",
        });
        continue;
      }
      openSite(target);
      pushMsg({ role: 'assistant', type: 'stats_card', site: target });
      continue;
    }

    if (action.type === 'EXPLAIN_RCA') {
      const target = getTarget(action.siteToken);
      if (!target) {
        pushMsg({
          role: 'assistant',
          type: 'text',
          text: "Which site/USID should I explain RCA for? (e.g. *Explain RCA for 9817*)",
        });
        continue;
      }

      // Try both ID forms — the backend may index by either siteId (node name) or realSiteId (USID).
      const primaryId   = target.siteId;
      const fallbackId  = target.realSiteId && target.realSiteId !== target.siteId ? target.realSiteId : null;

      let analysis = (await api.getSiteComprehensiveAnalysis(primaryId, dateId))?.data ?? null;

      // If primary returned no useful data, retry with the alternate ID.
      if (fallbackId && (!analysis || (!analysis.metadata?.anomalyFlag && !analysis.rca?.bucket))) {
        const alt = (await api.getSiteComprehensiveAnalysis(fallbackId, dateId))?.data ?? null;
        if (alt && (alt.metadata?.anomalyFlag || alt.rca?.bucket)) analysis = alt;
      }

      if (!analysis) {
        pushMsg({ role: 'assistant', type: 'error', text: 'Could not retrieve analysis data for this site.' });
        continue;
      }

      // Use ALL available signals to decide if the site is anomalous:
      // 1. The API's anomalyFlag (may be boolean, integer, or string)
      // 2. The RCA bucket being populated (RCA data exists even if flag is wrong)
      // 3. The MapSite's own status/anomalyCount (from the offenders table — what makes it red on the map)
      const apiAnomaly = Boolean(analysis.metadata?.anomalyFlag) || Boolean(analysis.rca?.bucket);
      const mapAnomaly = target.status !== 'NORMAL' || (target.anomalyCount ?? 0) > 0;
      const isAnomalous = apiAnomaly || mapAnomaly;

      if (!isAnomalous) {
        pushMsg({ role: 'assistant', type: 'no_rca', site: target, dateId });
      } else {
        openSite(target);
        pushMsg({ role: 'assistant', type: 'rca_card', site: target, analysis, dateId });
      }
      continue;
    }

    // ── Generative UI actions ────────────────────────────────────────────────

    if (action.type === 'OPEN_SITE_TAB') {
      const target = getTarget(action.siteToken);
      if (target) openSite(target);
      dispatchTabRequest?.({ topTab: action.tab });
      continue;
    }

    if (action.type === 'OPEN_KPI_TAB') {
      const target = getTarget(action.siteToken);
      if (target) openSite(target);
      dispatchTabRequest?.({ topTab: 'site-kpi', kpiTab: action.kpiTab, viewMode: 'diagnostic' });
      continue;
    }

    if (action.type === 'OPEN_RCA_TAB') {
      const target = getTarget(action.siteToken);
      if (target) openSite(target);
      dispatchTabRequest?.({ topTab: 'rca', rcaSubTab: action.rcaTab });
      continue;
    }

    if (action.type === 'OPEN_DIAGNOSTIC') {
      const target = getTarget(action.siteToken);
      if (target) openSite(target);
      dispatchTabRequest?.({ viewMode: 'diagnostic' });
      continue;
    }

    if (action.type === 'SET_DATE_FILTER') {
      setDateFilter?.(action.dateId);
      continue;
    }

    if (action.type === 'SET_MAP_LAYER') {
      setMapLayer?.(action.layer);
      continue;
    }

    if (action.type === 'NAVIGATE_VIEW') {
      onNavigate?.(action.view);
      continue;
    }
  }
}

// ── Small UI pieces ───────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-cyan-400"
          style={{
            animation: 'bounce 0.9s ease-in-out infinite',
            animationDelay: `${i * 0.18}s`,
          }}
        />
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: MapSite['status'] }) {
  const cfg: Record<MapSite['status'], { dot: string; text: string; label: string }> = {
    NORMAL:   { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'Normal' },
    WARNING:  { dot: 'bg-amber-400',   text: 'text-amber-300',   label: 'Warning' },
    CRITICAL: { dot: 'bg-red-400',     text: 'text-red-300',     label: 'Critical' },
    OUTAGE:   { dot: 'bg-rose-500',    text: 'text-rose-300',    label: 'Outage' },
  };
  const c = cfg[status];
  return (
    <span className={`flex items-center gap-1 text-[10px] font-semibold ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

function CardButton({
  label, onClick, color = 'cyan',
}: { label: string; onClick: () => void; color?: 'cyan' | 'teal' | 'indigo' | 'violet' }) {
  // 'indigo' / 'violet' kept as legacy aliases for callers that still pass them
  const isTeal = color === 'teal' || color === 'violet';
  const cls = isTeal
    ? 'text-teal-300 border-teal-500/40 hover:bg-teal-500/15'
    : 'text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/15';
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-lg py-1.5 text-[11px] font-semibold border transition-colors ${cls}`}
    >
      {label} →
    </button>
  );
}

// ── Card components ───────────────────────────────────────────────────────────

function NavCard({ site, onOpen }: { site: MapSite; onOpen: () => void }) {
  const { dId } = useDummifier();
  return (
    <div className="mt-2 rounded-xl border border-cyan-500/25 bg-slate-900/70 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-cyan-500/15 bg-cyan-500/8">
        <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-300">Navigated to site</span>
      </div>
      <div className="px-3 py-2.5 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-white">{site.siteName || dId(site.siteId)}</span>
          <StatusPill status={site.status} />
        </div>
        <p className="text-[11px] text-text-muted">
          Site: {dId(site.realSiteId || site.siteId)} &nbsp;·&nbsp; {site.cellCount} cells
        </p>
        {site.anomalyCount > 0 && (
          <p className="flex items-center gap-1.5 text-[11px] text-amber-400">
            <AlertCircle className="w-3 h-3 shrink-0" />
            {site.anomalyCount} anomal{site.anomalyCount > 1 ? 'ies' : 'y'} detected
          </p>
        )}
      </div>
      <div className="px-3 pb-3">
        <CardButton label="Open Analysis" onClick={onOpen} color="indigo" />
      </div>
    </div>
  );
}

function StatsCard({ site, onOpen }: { site: MapSite; onOpen: () => void }) {
  const { dId } = useDummifier();
  return (
    <div className="mt-2 rounded-xl border border-blue-500/25 bg-slate-900/70 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-blue-500/15 bg-blue-500/8">
        <BarChart2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-300">Site Overview</span>
      </div>
      <div className="px-3 py-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-white">{site.siteName || dId(site.siteId)}</span>
          <StatusPill status={site.status} />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { label: 'Site', value: dId(site.realSiteId || site.siteId) },
            { label: 'Cells', value: String(site.cellCount) },
            { label: 'Anomalies', value: String(site.anomalyCount) },
            { label: 'Tickets', value: site.hasActiveTickets ? 'Active' : 'None' },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg bg-white/5 px-2.5 py-1.5">
              <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-text-muted mb-0.5">{label}</p>
              <p className="text-[12px] font-semibold text-text-primary">{value}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="px-3 pb-3">
        <CardButton label="Open Full Analysis" onClick={onOpen} color="indigo" />
      </div>
    </div>
  );
}

function RcaCard({
  site, analysis, dateId, onOpen,
}: { site: MapSite; analysis: SiteAnalysisPayload; dateId: string; onOpen: () => void }) {
  const { dId, dText } = useDummifier();
  const { rca } = analysis;
  const score = rca.confidenceScoreInt ?? (rca.confidenceScore != null ? Math.round(rca.confidenceScore * 100) : null);
  const shortEntries = Object.entries(rca.shortSummary ?? {}).slice(0, 3);

  return (
    <div className="mt-2 rounded-xl border border-teal-500/25 bg-slate-900/70 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-teal-500/15 bg-teal-500/8">
        <Brain className="w-3.5 h-3.5 text-teal-400 shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-teal-300">Root Cause Analysis</span>
        {score != null && score > 0 && (
          <span className="ml-auto text-[10px] font-bold text-teal-300 bg-teal-500/20 rounded-full px-2 py-0.5">
            {score}% confidence
          </span>
        )}
      </div>
      <div className="px-3 py-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-white">{site.siteName || dId(site.siteId)}</span>
          <StatusPill status={site.status} />
        </div>
        <p className="text-[11px] text-text-muted">
          Date: <span className="text-text-muted font-medium">{dateId}</span>
        </p>
        {rca.bucket && (
          <div className="rounded-lg bg-teal-950/50 border border-teal-500/15 px-2.5 py-1.5">
            <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-teal-400 mb-0.5">Bucket</p>
            <p className="text-[12px] font-semibold text-text-primary">{rca.bucket.replace(/_/g, ' ')}</p>
          </div>
        )}
        {shortEntries.length > 0 && (
          <div className="space-y-1">
            {shortEntries.map(([k, v]) => (
              <p key={k} className="text-[11px] text-text-muted leading-snug">
                <span className="text-text-muted">{k}: </span>
                {dText(String(v))}
              </p>
            ))}
          </div>
        )}
        {rca.solutionSummary && (
          <div className="rounded-lg bg-emerald-950/40 border border-emerald-500/20 px-2.5 py-2">
            <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-emerald-400 mb-0.5">Recommendation</p>
            <p className="text-[11px] text-text-muted leading-relaxed line-clamp-3">{dText(String(rca.solutionSummary))}</p>
          </div>
        )}
      </div>
      <div className="px-3 pb-3">
        <CardButton label="Open Full RCA" onClick={onOpen} color="violet" />
      </div>
    </div>
  );
}

function NoRcaCard({ site, dateId }: { site: MapSite; dateId: string }) {
  const { dId } = useDummifier();
  return (
    <div className="mt-2 rounded-xl border border-emerald-500/20 bg-slate-900/70 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-emerald-500/15 bg-emerald-500/8">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">No Degradation Detected</span>
      </div>
      <div className="px-3 py-3 space-y-1">
        <p className="text-[13px] font-semibold text-white">{site.siteName || dId(site.siteId)}</p>
        <p className="text-[12px] text-emerald-300">Site is operating normally on {dateId}.</p>
        <p className="text-[11px] text-text-muted mt-1">
          RCA is unavailable — no anomalies were detected.
        </p>
      </div>
    </div>
  );
}

// ── Suggestion chips ──────────────────────────────────────────────────────────

const GENERAL_SUGGESTIONS = [
  { icon: BarChart2, text: 'Show KPI dashboard for this site' },
  { icon: Brain,     text: 'Run full RCA analysis for this site' },
  { icon: MapPin,    text: 'Which sites have the most anomalies today?' },
  { icon: Sparkles,  text: 'Create a degradation summary dashboard' },
];
const NO_SITE_SUGGESTIONS = [
  { icon: MapPin,    text: 'Show top offender sites on the network' },
  { icon: BarChart2, text: 'Create a network KPI dashboard' },
  { icon: Brain,     text: 'What are the active anomalies today?' },
  { icon: Sparkles,  text: 'Show capacity-at-risk breakdown' },
];
const INSIGHTS_SUGGESTIONS = [
  { icon: Database,  text: 'Top 10 sites by PRB utilization' },
  { icon: BarChart2, text: 'Switch to RAN Health tab' },
  { icon: Brain,     text: 'Which sites are at capacity risk?' },
  { icon: Sparkles,  text: 'Show alarm trend breakdown this week' },
];
const INSIGHTS_NO_SITE_SUGGESTIONS = [
  { icon: Database,  text: 'List sites with ERAB drop rate above 1%' },
  { icon: BarChart2, text: 'Show executive KPI summary' },
  { icon: Brain,     text: 'Which markets have the most anomalies?' },
  { icon: Sparkles,  text: 'Switch to Capacity tab' },
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface MapChatBarProps {
  selectedSite?: MapSite | null;
  selectedDateId?: string;
  centerX?: string;
  sites?: MapSite[];
  onSelectSite?: (site: MapSite) => void;
  currentSubView?: 'network' | 'insights';
  currentInsightsTab?: string;
  onSwitchInsightsTab?: (tab: string) => void;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MapChatBar({
  selectedSite,
  selectedDateId,
  centerX = '50%',
  sites = [],
  onSelectSite,
  currentSubView = 'network',
  currentInsightsTab,
  onSwitchInsightsTab,
}: MapChatBarProps) {
  const { sessionId } = useChat();
  const { setSelectedDateId, setActiveSiteLayer, dispatchTabRequest } = useMapData();
  const { dId, dText, unmapText } = useDummifier();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages or loading state change
  useEffect(() => {
    if (!isOpen || !scrollRef.current) return;
    // Delay to allow large visualizations (maps, charts) to paint before measuring scrollHeight
    const lastMsg = messages[messages.length - 1];
    const delayMs = lastMsg?.visualization ? 800 : 120;
    const t = setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, delayMs);
    return () => clearTimeout(t);
  }, [messages, isOpen, loading]);

  // Reset when site changes
  useEffect(() => {
    setMessages([]);
    setIsOpen(false);
    setPendingConfirmation(null);
  }, [selectedSite?.siteId]);

  const pushMsg = useCallback((msg: ChatMsgDraft) => {
    const full = { ...msg, id: uid() } as ChatMsg;
    setMessages(prev => [...prev, full]);
    return full.id;
  }, []);

  const replaceMsg = useCallback((id: string, replacement: ChatMsgDraft) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...replacement, id } as ChatMsg : m));
  }, []);

  const openSite = useCallback((site: MapSite) => {
    onSelectSite?.(site);
  }, [onSelectSite]);

  const send = useCallback(async (text: string) => {
    const trimmedRaw = text.trim();
    if (!trimmedRaw || loading) return;

    setInput('');
    setIsOpen(true);
    setLoading(true);
    // Show the user's message as typed (with UST ids preserved). Downstream calls
    // use `trimmed`, which has UST###### tokens reverse-mapped to the real USIDs
    // the backend understands — so demo-mode users can freely type masked ids.
    pushMsg({ role: 'user', type: 'text', text: trimmedRaw });
    const trimmed = unmapText(trimmedRaw);
    const thinkingId = pushMsg({ role: 'assistant', type: 'text', text: '', loading: true });

    try {
      const selectedSiteToken = normalizeSiteToken(selectedSite?.realSiteId || selectedSite?.siteId || '');

      // Handle "yes/no" replies for model-driven confirmations without re-calling the LLM.
      if (pendingConfirmation && isAffirmative(trimmed)) {
        const pending = pendingConfirmation;
        setPendingConfirmation(null);
        await executeUiActions({
          actions: pending.actions,
          selectedSite: selectedSite ?? null,
          selectedDateId,
          sites,
          openSite,
          pushMsg,
          replaceMsg,
          thinkingId,
          assistantText: 'Okay — doing that now.',
          dispatchTabRequest,
          setDateFilter: setSelectedDateId,
          setMapLayer: setActiveSiteLayer,
        });
        return;
      }
      if (pendingConfirmation && isNegative(trimmed)) {
        setPendingConfirmation(null);
        replaceMsg(thinkingId, { role: 'assistant', type: 'text', text: 'Okay — cancelled.' });
        return;
      }

      let ui: UiCommandResult | null = null;
      try {
        ui = await api.interpretUiCommand({
          query: trimmed,
          currentView: 'observe',
          selectedSiteToken: selectedSiteToken || null,
          selectedDateId: selectedDateId || null,
        });
      } catch {
        ui = null;
      }

      // If we got actionable UI steps, execute them. Otherwise fall back to the general agent.
      if (ui && Array.isArray(ui.actions) && ui.actions.length > 0) {
        setPendingConfirmation(null);
        // Extract date from the user's message (e.g. "on 4/7/2026") to override the map's date picker.
        const queryDateId = extractDateFromQuery(trimmed);
        await executeUiActions({
          actions: ui.actions,
          selectedSite: selectedSite ?? null,
          selectedDateId,
          queryDateId,
          sites,
          openSite,
          pushMsg,
          replaceMsg,
          thinkingId,
          assistantText: ui.assistantText || 'Okay.',
          dispatchTabRequest,
          setDateFilter: setSelectedDateId,
          setMapLayer: setActiveSiteLayer,
        });
        return;
      }

      if (ui && ui.assistantText) {
        const inferred = inferActionsFromConfirmationText({
          assistantText: ui.assistantText,
          selectedSiteToken: selectedSiteToken || null,
        });
        setPendingConfirmation(inferred ? { actions: inferred, promptText: ui.assistantText } : null);
        replaceMsg(thinkingId, { role: 'assistant', type: 'text', text: ui.assistantText });
        return;
      }

      setPendingConfirmation(null);
      const contextPrefix = buildObserveContext(selectedSite, selectedDateId, currentSubView, currentInsightsTab);

      // For data-query intents in insights view, fire executeNaturalQuery in parallel
      const sqlPromise = (currentSubView === 'insights' && isDataQueryIntent(trimmed))
        ? api.executeNaturalQuery(trimmed).catch(() => null)
        : Promise.resolve(null);

      const result = await api.agentV3Chat({
        threadId: sessionId,
        message: `${contextPrefix}\n\n${trimmed}`,
        stream: 'observability',
        currentView: 'observe',
      });

      // Apply map/UI commands from the agent
      if (Array.isArray(result?.uiCommands)) {
        result.uiCommands.forEach((cmd: { type: string; payload: any }) => {
          if (cmd.type === 'set_date' && cmd.payload?.dateId) {
            setSelectedDateId(String(cmd.payload.dateId));
          } else if (cmd.type === 'set_layer' && cmd.payload?.layer) {
            setActiveSiteLayer(String(cmd.payload.layer) as 'degraded' | 'outage' | 'overutilized');
          } else if ((cmd.type === 'MAP_FOCUS_SITE' || cmd.type === 'map_focus_site') && cmd.payload?.siteToken) {
            const target = resolveSiteByToken(String(cmd.payload.siteToken), sites);
            if (target) openSite(target);
          } else if (cmd.type === 'switch_insights_tab' && cmd.payload?.tab) {
            onSwitchInsightsTab?.(String(cmd.payload.tab));
          }
        });
      }

      // Check for tab-switch intent in text (fast path, no roundtrip needed)
      const tabMatch = trimmed.match(/\b(?:switch|go|open|show)\s+(?:to\s+)?(?:the\s+)?(market|executive|ran health|ran|capacity|alarms|forecast)\s*(?:tab)?\b/i);
      if (tabMatch) {
        const tabKey = tabMatch[1].toLowerCase().replace(' ', '');
        const resolved: Record<string, string> = { ranhealth: 'ran', 'ran': 'ran', market: 'market', executive: 'executive', capacity: 'capacity', alarms: 'alarms', forecast: 'forecast' };
        if (resolved[tabKey]) onSwitchInsightsTab?.(resolved[tabKey]);
      }

      const reply = result?.assistantMessage || result?.reply || result?.message || result?.text
        || (typeof result === 'string' ? result : 'No response received.');

      // Merge SQL result as a data_table block if agent returned no blocks
      const agentBlocks: any[] = Array.isArray(result?.uiBlocks) ? result.uiBlocks : [];
      const sqlResult = await sqlPromise;
      const sqlBlock = sqlResult?.result?.rows?.length
        ? [{
            type: 'data_table',
            data: {
              title: sqlResult.query || trimmed,
              rows: sqlResult.result.rows,
              ...(sqlResult.generatedSQL ? { subtitle: sqlResult.generatedSQL } : {}),
            },
          }]
        : [];

      const uiBlocks = [...agentBlocks, ...sqlBlock].length > 0 ? [...agentBlocks, ...sqlBlock] : undefined;
      replaceMsg(thinkingId, { role: 'assistant', type: 'text', text: reply, uiBlocks });

    } catch (err) {
      setPendingConfirmation(null);
      replaceMsg(thinkingId, { role: 'assistant', type: 'error', text: 'Unable to reach the agent. Please try again.' });
    } finally {
      setLoading(false);
    }
  }, [loading, pendingConfirmation, sites, selectedSite, selectedDateId, sessionId, openSite, pushMsg, replaceMsg, currentSubView, currentInsightsTab, onSwitchInsightsTab, unmapText]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
    if (e.key === 'Escape') setIsOpen(false);
  };

  const suggestions = currentSubView === 'insights'
    ? (selectedSite ? INSIGHTS_SUGGESTIONS : INSIGHTS_NO_SITE_SUGGESTIONS)
    : (selectedSite ? GENERAL_SUGGESTIONS : NO_SITE_SUGGESTIONS);
  const showSuggestions = messages.length === 0;

  return (
    <div
      className="absolute z-[70] bottom-5 flex flex-col items-center"
      style={{
        left: centerX,
        transform: 'translateX(-50%)',
        width: 'min(540px, calc(100% - 2rem))',
        pointerEvents: 'auto',
      }}
    >
      {/* ── Chat panel ───────────────────────────────────────────────────── */}
      {isOpen && (
        <div
          className="w-full mb-2.5 rounded-[22px] overflow-hidden"
          style={{
            background: 'linear-gradient(155deg, rgba(15,23,42,0.56) 0%, rgba(2,6,23,0.72) 100%)',
            border: '1px solid rgba(226,232,240,0.18)',
            boxShadow: '0 30px 90px rgba(2,6,23,0.42), 0 0 0 0.5px rgba(255,255,255,0.10) inset, 0 1px 0 rgba(255,255,255,0.12) inset',
            backdropFilter: 'blur(46px) saturate(150%)',
            WebkitBackdropFilter: 'blur(46px) saturate(150%)',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{
              borderBottom: '1px solid rgba(255,255,255,0.07)',
              background: 'linear-gradient(90deg, rgba(148,163,184,0.12) 0%, rgba(148,163,184,0.04) 52%, transparent 82%)',
            }}
          >
            <div className="flex items-center gap-2.5">
              <div
                className="flex items-center justify-center w-6 h-6 rounded-full"
                style={{
                  background: 'linear-gradient(135deg, rgba(226,232,240,0.28), rgba(148,163,184,0.16))',
                  boxShadow: '0 0 10px rgba(15,23,42,0.22)',
                  border: '1px solid rgba(203,213,225,0.34)',
                }}
              >
                <Sparkles className="w-3 h-3 text-text-primary" />
              </div>
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/85">
                Aira
              </span>
              <span className="text-[10px] text-white/18">|</span>
              <span className="text-[11px] text-white/38 font-medium truncate max-w-[180px]">
                {currentSubView === 'insights'
                  ? `Insights · ${currentInsightsTab ?? 'market'}`
                  : selectedSite ? dId(selectedSite.siteId) : 'Network Intelligence'}
              </span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 rounded-lg transition-all"
              style={{ color: 'rgba(255,255,255,0.35)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; }}
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Messages / suggestions */}
          <div
            ref={scrollRef}
            className="overflow-y-auto px-3.5 py-3.5 space-y-3"
            style={{ maxHeight: 520, scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.08) transparent' }}
          >
            {/* Suggestions */}
            {showSuggestions && (
              <div className="space-y-1.5 pb-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] px-1 mb-2" style={{ color: 'rgba(255,255,255,0.25)' }}>
                  Try asking…
                </p>
                {suggestions.map(({ icon: Icon, text }) => (
                  <button
                    key={text}
                    onClick={() => send(text)}
                    className="w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[12px] transition-all"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.10)',
                      color: 'rgba(255,255,255,0.55)',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(148,163,184,0.16)';
                      e.currentTarget.style.borderColor = 'rgba(148,163,184,0.30)';
                      e.currentTarget.style.color = 'rgba(255,255,255,0.85)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)';
                      e.currentTarget.style.color = 'rgba(255,255,255,0.55)';
                    }}
                  >
                    <Icon className="w-3.5 h-3.5 text-text-muted shrink-0" />
                    {text}
                  </button>
                ))}
              </div>
            )}

            {/* Message list */}
            {messages.map(msg => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start gap-2'}`}
              >
                {msg.role === 'assistant' && (
                  <div
                    className="shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center"
                    style={{
                      background: 'linear-gradient(135deg, rgba(226,232,240,0.24), rgba(148,163,184,0.14))',
                      border: '1px solid rgba(203,213,225,0.26)',
                    }}
                  >
                    <Sparkles className="w-2.5 h-2.5 text-text-primary" />
                  </div>
                )}

                <div className="max-w-[88%] min-w-0">
                  {msg.role === 'user' && msg.type === 'text' && (
                    <div
                      className="rounded-2xl rounded-tr-sm px-3.5 py-2 text-[13px] leading-relaxed text-white"
                      style={{
                        background: 'linear-gradient(135deg, rgba(71,85,105,0.44), rgba(30,41,59,0.40))',
                        border: '1px solid rgba(148,163,184,0.36)',
                        boxShadow: '0 4px 16px rgba(15,23,42,0.24)',
                      }}
                    >
                      {dText(msg.text)}
                    </div>
                  )}

                  {msg.role === 'assistant' && msg.type === 'text' && (
                    <div>
                      {msg.loading ? (
                        <ThinkingDots />
                      ) : (
                        <>
                          {msg.text && (
                            <p
                              className="text-[13px] leading-relaxed"
                              style={{ color: 'rgba(255,255,255,0.80)' }}
                              dangerouslySetInnerHTML={{
                                __html: dText(msg.text)
                                  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                                  .replace(/\*(.+?)\*/g, '<em>$1</em>'),
                              }}
                            />
                          )}
                          {Array.isArray(msg.uiBlocks) && msg.uiBlocks.length > 0 && (
                            <div className="mt-3">
                              <UiBlocksRenderer blocks={msg.uiBlocks} />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {msg.type === 'error' && (
                    <p className="text-[12px] text-red-400/90 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {dText(msg.text)}
                    </p>
                  )}

                  {msg.type === 'nav_card'   && <NavCard    site={msg.site} onOpen={() => openSite(msg.site)} />}
                  {msg.type === 'stats_card' && <StatsCard  site={msg.site} onOpen={() => openSite(msg.site)} />}
                  {msg.type === 'rca_card'   && (
                    <RcaCard site={msg.site} analysis={msg.analysis} dateId={msg.dateId} onOpen={() => openSite(msg.site)} />
                  )}
                  {msg.type === 'no_rca'     && <NoRcaCard  site={msg.site} dateId={msg.dateId} />}
                </div>
              </div>
            ))}

            {pendingConfirmation && (
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => send('no')}
                  className="rounded-full px-3 py-1 text-[11px] font-semibold transition-colors"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.10)',
                    color: 'rgba(255,255,255,0.72)',
                  }}
                >
                  No
                </button>
                <button
                  onClick={() => send('yes')}
                  className="rounded-full px-3 py-1 text-[11px] font-semibold transition-colors"
                  style={{
                    background: 'linear-gradient(135deg, rgba(51,65,85,0.88), rgba(30,41,59,0.72))',
                    border: '1px solid rgba(148,163,184,0.40)',
                    color: 'white',
                    boxShadow: '0 6px 16px rgba(15,23,42,0.30)',
                  }}
                >
                  Yes
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Input bar ────────────────────────────────────────────────────── */}
      <div
        className="w-full flex items-center gap-2.5 rounded-full px-3.5 py-2"
        style={{
          background: 'linear-gradient(140deg, rgba(15,23,42,0.54) 0%, rgba(2,6,23,0.70) 100%)',
          border: '1px solid rgba(226,232,240,0.22)',
          boxShadow: [
            '0 20px 60px rgba(2,6,23,0.38)',
            '0 2px 8px rgba(2,6,23,0.24)',
            'inset 0 1px 0 rgba(255,255,255,0.16)',
            'inset 0 -1px 0 rgba(2,6,23,0.26)',
          ].join(', '),
          backdropFilter: 'blur(44px) saturate(145%)',
          WebkitBackdropFilter: 'blur(44px) saturate(145%)',
        }}
      >
        {/* Aira icon */}
        <div
          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer transition-all"
          style={{
            background: 'linear-gradient(135deg, rgba(226,232,240,0.24), rgba(148,163,184,0.14))',
            border: '1px solid rgba(203,213,225,0.34)',
            boxShadow: '0 0 12px rgba(15,23,42,0.20)',
          }}
          onClick={() => messages.length > 0 && setIsOpen(v => !v)}
          title="Aira"
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 16px rgba(148,163,184,0.38)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 12px rgba(15,23,42,0.20)'; }}
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-text-primary" />
          ) : (
            <img src="/aira-logo.png" alt="Aira" className="w-4 h-4 object-contain" />
          )}
        </div>

        {/* Site badge */}
        {selectedSite && (
          <span
            className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold truncate max-w-[110px]"
            style={{
              background: 'rgba(255,255,255,0.09)',
              border: '1px solid rgba(255,255,255,0.13)',
              color: 'rgba(255,255,255,0.65)',
              letterSpacing: '0.02em',
            }}
          >
            {dId(selectedSite.siteId)}
          </span>
        )}

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (messages.length > 0) setIsOpen(true); }}
          placeholder={selectedSite ? `Ask about this site…` : 'Ask Aira about the network…'}
          className="flex-1 min-w-0 bg-transparent text-[13px] text-white placeholder:text-white/60 focus:outline-none"
          style={{ caretColor: 'rgba(148,163,184,0.95)', color: 'rgba(255,255,255,0.90)' }}
          disabled={loading}
        />

        {/* Clear */}
        {input && (
          <button
            onClick={() => setInput('')}
            className="shrink-0 p-1 rounded-full transition-all"
            style={{ color: 'rgba(255,255,255,0.35)' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.70)'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; e.currentTarget.style.background = 'transparent'; }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Send */}
        <button
          onClick={() => send(input)}
          disabled={!input.trim() || loading}
          className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full transition-all disabled:opacity-25 disabled:cursor-not-allowed"
          style={input.trim() && !loading ? {
            background: 'linear-gradient(135deg, rgba(51,65,85,0.92), rgba(30,41,59,0.82))',
            border: '1px solid rgba(148,163,184,0.40)',
            boxShadow: '0 4px 14px rgba(15,23,42,0.34)',
          } : {
            background: 'rgba(255,255,255,0.07)',
            border: '1px solid rgba(255,255,255,0.10)',
          }}
        >
          <Send className="w-3 h-3 text-white" />
        </button>
      </div>
    </div>
  );
}
