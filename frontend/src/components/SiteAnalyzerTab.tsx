import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Loader2,
  Sparkles,
  Wrench,
  CheckCircle,
  AlertCircle,
  Play,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Activity,
  GitBranch,
  Zap,
  Target,
  ListChecks,
  Radio,
  Network,
  History,
  BarChart3,
  Layers,
} from 'lucide-react';
import api from '../services/api';
import UiBlocksRenderer from './GenerativeUI/UiBlocksRenderer';
import type { UiBlock } from '../types';

interface SiteAnalyzerTabProps {
  realSiteId: string;
  selectedDateId: string;
  theme: 'dark' | 'light';
  tone: {
    primary: string;
    border: string;
    muted: string;
    text: string;
    secondary: string;
    fill: string;
  };
}

interface AgentTrace {
  type: 'tool_call' | 'tool_result' | 'thought';
  name?: string;
  args?: Record<string, any>;
  summary?: string;
  text?: string;
}

interface AnalyzerResult {
  threadId: string;
  assistantMessage: string;
  uiBlocks?: UiBlock[];
  trace: AgentTrace[];
  iterations: number;
  hitIterationCap: boolean;
}

type Severity = 'critical' | 'major' | 'minor' | 'nominal';

interface ParsedSynthesis {
  severity: Severity;
  headline: string;
  whatChanged: string[];
  whatDegraded: string[];
  rootCause: string[];
  nextActions: string[];
  unstructuredFallback?: string;
}

const TOOL_LABELS: Record<string, string> = {
  get_site_topology: 'Site Topology',
  get_site_outages: 'Site Outages',
  get_hourly_trends: 'Hourly KPI Dashboard',
  get_kpi_impact_breakdown: 'KPI Impact Breakdown',
  get_config_changes: 'Config Changes',
  get_ret_changes: 'RET Tilt Changes',
  get_neighbor_relations: 'Neighbor Relations',
  get_neighbor_outages: 'Neighbor Outages',
  compare_with_cluster: 'Cluster Comparison',
  get_ticket_history: 'Ticket History',
  get_site_kpis: 'KPI Snapshot',
  get_site_rca: 'RCA',
  show_kpi_dashboard: 'KPI Dashboard',
};

// Group evidence blocks by category — drives the named sections in the result panel.
const EVIDENCE_GROUPS: Array<{
  id: string;
  label: string;
  Icon: typeof Activity;
  match: (block: UiBlock) => boolean;
}> = [
  {
    id: 'topology',
    label: 'Topology',
    Icon: Network,
    match: (b) => /Topology/i.test(String(b.title || '')),
  },
  {
    id: 'health',
    label: 'Network Health',
    Icon: AlertTriangle,
    match: (b) => /Outage|Tickets/i.test(String(b.title || '')),
  },
  {
    id: 'changes',
    label: 'Recent Changes',
    Icon: GitBranch,
    match: (b) => /Config Changes|RET Tilts/i.test(String(b.title || '')),
  },
  {
    id: 'performance',
    label: 'Performance & KPIs',
    Icon: BarChart3,
    match: (b) =>
      b.type === 'kpi_dashboard' ||
      /Hourly|Impact Breakdown/i.test(String(b.title || '')),
  },
  {
    id: 'comparative',
    label: 'Cluster Comparison',
    Icon: Layers,
    match: (b) => /Cluster Comparison|Neighbor Relations|Neighbor Outage/i.test(String(b.title || '')),
  },
];

// ─── Synthesis parser ───────────────────────────────────────────────────────

// Match section header lines in any of the variants the LLM emits in practice:
//   `## What Changed`
//   `### Likely Root Cause`
//   `**What Changed**`
//   `What Changed:`  (followed by content on next line)
function parseHeader(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // ATX headers: # | ## | ###
  const atx = trimmed.match(/^#{1,4}\s*(.+?)\s*#*$/);
  if (atx) return cleanHeader(atx[1]);

  // Bold-only line: **Header** or __Header__
  const bold = trimmed.match(/^\*\*(.+?)\*\*$|^__(.+?)__$/);
  if (bold) return cleanHeader(bold[1] || bold[2] || '');

  // Plain header followed by a colon and nothing else, e.g. "What Changed:"
  const colon = trimmed.match(/^([A-Za-z][A-Za-z\s]+?)\s*:\s*$/);
  if (colon) return cleanHeader(colon[1]);

  return null;
}

function cleanHeader(raw: string): string {
  // Strip stray markdown emphasis around the captured text.
  return raw.replace(/^[*_`]+|[*_`]+$/g, '').trim();
}

// Map LLM-section-name variants → canonical key.
function canonicalSection(name: string): keyof Omit<ParsedSynthesis, 'severity' | 'unstructuredFallback'> | 'severity' | null {
  const n = name.toLowerCase().trim();
  if (/severity/.test(n)) return 'severity';
  if (/headline|summary|overview/.test(n)) return 'headline';
  if (/what.*chang|changes?|recent change/.test(n)) return 'whatChanged';
  if (/what.*degrad|degraded?|impact|symptoms?/.test(n)) return 'whatDegraded';
  if (/root cause|likely.*cause|cause/.test(n)) return 'rootCause';
  if (/next action|recommend|action items?|recommendations?/.test(n)) return 'nextActions';
  return null;
}

function parseSynthesis(raw: string): ParsedSynthesis {
  const text = String(raw || '').trim();
  if (!text) {
    return { severity: 'nominal', headline: '', whatChanged: [], whatDegraded: [], rootCause: [], nextActions: [] };
  }

  const sections: Partial<Record<string, string>> = {};
  const lines = text.split(/\r?\n/);
  let currentKey: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (currentKey) sections[currentKey] = buf.join('\n').trim();
    buf = [];
  };

  for (const line of lines) {
    const header = parseHeader(line);
    const canon = header ? canonicalSection(header) : null;
    if (canon) {
      flush();
      currentKey = canon;
    } else if (currentKey) {
      buf.push(line);
    }
  }
  flush();

  // Extract bullet lists; tolerate `- `, `* `, `• `, `1.` and plain lines.
  const toBullets = (s: string | undefined): string[] => {
    if (!s) return [];
    return s
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+\.)\s*/, '').trim())
      .filter(Boolean);
  };

  const sevRaw = (sections['severity'] || '').toLowerCase();
  const severity: Severity =
    /critical/.test(sevRaw) ? 'critical' :
    /major/.test(sevRaw) ? 'major' :
    /minor/.test(sevRaw) ? 'minor' :
    'nominal';

  const hasStructured = ['headline', 'whatChanged', 'whatDegraded', 'rootCause', 'nextActions']
    .some((k) => (sections[k] || '').length > 0);

  return {
    severity,
    headline: (sections['headline'] || '').replace(/^["']|["']$/g, '').replace(/^\*\*|\*\*$/g, '').trim(),
    whatChanged: toBullets(sections['whatChanged']),
    whatDegraded: toBullets(sections['whatDegraded']),
    rootCause: toBullets(sections['rootCause']),
    nextActions: toBullets(sections['nextActions']),
    unstructuredFallback: hasStructured ? undefined : text,
  };
}

// ─── Bullet classifier — drives icon + tone for visual rendering ────────────

type BulletTone = 'positive' | 'neutral' | 'warning' | 'critical';

interface ClassifiedBullet {
  raw: string;
  tone: BulletTone;
  /** Numeric value parsed from `(0.077)` or `0.1 Mbps` patterns. */
  metric?: { value: string; unit?: string };
  /** Rank like "15th out of 19" → { current: 15, total: 19, percentile: 21 } */
  rank?: { current: number; total: number; percentile?: number };
  /** Cell name like CVL02383_7C_1 spotted in the bullet. */
  cellName?: string;
}

function classifyBullet(raw: string): ClassifiedBullet {
  const text = raw.trim();
  const lc = text.toLowerCase();

  let tone: BulletTone = 'neutral';
  if (/^(no |none |stable|nominal|healthy|continue routine|no critical)/i.test(text)) tone = 'positive';
  else if (/critical|outage|down|severe|severely/i.test(lc)) tone = 'critical';
  else if (/degrad|drop|fail|anomal|underperform|low |risk|warning/i.test(lc)) tone = 'warning';

  const numMatch = text.match(/\(([0-9]+\.?[0-9]*\s*%?)\)/) ||
                   text.match(/\b([0-9]+\.?[0-9]*\s*(?:Mbps|GB|%|dBm|min))\b/);
  const metric = numMatch
    ? (() => {
        const v = numMatch[1].trim();
        const m = v.match(/^([0-9.]+)\s*(.+)?$/);
        return m ? { value: m[1], unit: m[2] } : { value: v };
      })()
    : undefined;

  const rankMatch = text.match(/(\d+)(?:st|nd|rd|th)?\s+(?:out\s+of|of)\s+(\d+)/i);
  const pctMatch = text.match(/\b(\d+)(?:st|nd|rd|th)\s+percentile\b/i);
  const rank = rankMatch
    ? { current: Number(rankMatch[1]), total: Number(rankMatch[2]), percentile: pctMatch ? Number(pctMatch[1]) : undefined }
    : undefined;

  const cellMatch = text.match(/\b[A-Z]{3}\d{4,6}_[A-Za-z0-9_]+\b/);
  const cellName = cellMatch ? cellMatch[0] : undefined;

  return { raw: text, tone, metric, rank, cellName };
}

// ─── Stat extraction from tool results ──────────────────────────────────────

function extractKeyStats(blocks: UiBlock[] | undefined, trace: AgentTrace[]) {
  const stats = { cells: 0, anomalousCells: 0, outageEvents: 0, configChanges: 0, retChanges: 0, neighborOutages: 0 };

  for (const b of blocks || []) {
    const t = String(b.title || '');
    const rows: any[] = (b.data as any)?.rows || [];

    if (/Topology/i.test(t)) {
      stats.cells = rows.length;
      stats.anomalousCells = rows.filter((r) => String(r.Anomaly || '').includes('⚠')).length;
    }
    if (/Outage Events/i.test(t)) stats.outageEvents = rows.length;
    if (/Parameter Changes/i.test(t)) stats.configChanges = rows.length;
    if (/Antenna Tilts/i.test(t)) stats.retChanges = rows.filter((r) => String(r.Changed || '').includes('⚠')).length;
    if (/Neighbor Outage/i.test(t)) stats.neighborOutages = rows.length;
  }

  // If we can't infer counts from blocks, fall back to scanning trace summaries.
  if (!stats.outageEvents) {
    const t = trace.find((x) => x.name === 'get_site_outages' && x.type === 'tool_result');
    const m = (t?.summary || '').match(/(\d+)\s+cell-outage events/i);
    if (m) stats.outageEvents = Number(m[1]);
  }
  return stats;
}

// ─── Severity styling ───────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<Severity, { bg: string; bgDark: string; fg: string; fgDark: string; label: string; icon: typeof Activity }> = {
  critical: { bg: 'rgba(220,38,38,0.10)', bgDark: 'rgba(220,38,38,0.18)', fg: '#dc2626', fgDark: '#fca5a5', label: 'CRITICAL', icon: AlertTriangle },
  major:    { bg: 'rgba(234,88,12,0.10)', bgDark: 'rgba(234,88,12,0.18)', fg: '#ea580c', fgDark: '#fdba74', label: 'MAJOR',    icon: AlertCircle },
  minor:    { bg: 'rgba(202,138,4,0.10)', bgDark: 'rgba(202,138,4,0.18)', fg: '#ca8a04', fgDark: '#fde047', label: 'MINOR',    icon: Activity },
  nominal:  { bg: 'rgba(22,163,74,0.10)', bgDark: 'rgba(22,163,74,0.18)', fg: '#16a34a', fgDark: '#86efac', label: 'NOMINAL',  icon: CheckCircle },
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function SiteAnalyzerTab({ realSiteId, selectedDateId, theme, tone }: SiteAnalyzerTabProps) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AnalyzerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [traceExpanded, setTraceExpanded] = useState(false);
  const isDark = theme === 'dark';

  useEffect(() => {
    setResult(null);
    setError(null);
  }, [realSiteId, selectedDateId]);

  const runAnalysis = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const message =
        `Run a comprehensive deep investigation of USID ${realSiteId} for date ${selectedDateId}. ` +
        `Follow the full site analysis workflow with parallel batched tool calls (Step A: get_site_topology + get_site_outages + get_kpi_impact_breakdown; ` +
        `Step B: get_hourly_trends + get_config_changes + get_ret_changes; ` +
        `Step C: get_neighbor_relations + get_neighbor_outages; ` +
        `Step D: compare_with_cluster on the most-impacted KPI). ` +
        `Then synthesize using the REQUIRED markdown format with sections: ## Severity, ## Headline, ## What Changed, ## What Degraded, ## Likely Root Cause, ## Next Actions.`;
      const response = await api.agentV3Chat({
        message,
        currentView: 'observe',
        stream: 'observability',
      });
      setResult(response as AnalyzerResult);
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || e?.message || 'Analysis failed.');
    } finally {
      setRunning(false);
    }
  }, [realSiteId, selectedDateId]);

  const synthesis = useMemo(() => (result ? parseSynthesis(result.assistantMessage) : null), [result]);
  const stats = useMemo(() => (result ? extractKeyStats(result.uiBlocks, result.trace) : null), [result]);
  const groupedEvidence = useMemo(() => {
    if (!result?.uiBlocks?.length) return [] as Array<{ id: string; label: string; Icon: typeof Activity; blocks: UiBlock[] }>;
    const used = new Set<UiBlock>();
    const groups = EVIDENCE_GROUPS.map((g) => ({
      id: g.id,
      label: g.label,
      Icon: g.Icon,
      blocks: result.uiBlocks!.filter((b) => {
        if (used.has(b)) return false;
        if (g.match(b)) { used.add(b); return true; }
        return false;
      }),
    })).filter((g) => g.blocks.length);
    // Anything left over goes into "Other"
    const leftover = result.uiBlocks.filter((b) => !used.has(b));
    if (leftover.length) {
      groups.push({ id: 'other', label: 'Additional Findings', Icon: Layers, blocks: leftover });
    }
    return groups;
  }, [result]);

  // ─── Sub-components ──────────────────────────────────────────────────────

  const SectionCard = ({ Icon, title, accent, children }: { Icon: typeof Activity; title: string; accent: string; children: React.ReactNode }) => (
    <div
      className="rounded-[18px] border overflow-hidden"
      style={{ borderColor: tone.border, background: isDark ? 'rgba(38,38,38,0.7)' : 'rgba(255,255,255,0.85)' }}
    >
      <div
        className="flex items-center gap-2 px-5 py-3 border-b"
        style={{ borderColor: tone.border, background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)' }}
      >
        <div className="rounded-md p-1.5" style={{ background: accent + '22', color: accent }}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: tone.muted }}>
          {title}
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );

  const StatTile = ({ label, value, Icon, accent }: { label: string; value: string | number; Icon: typeof Activity; accent: string }) => (
    <div
      className="rounded-xl border px-3 py-2.5 flex items-center gap-2.5"
      style={{ borderColor: tone.border, background: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(248,250,252,0.6)' }}
    >
      <div className="rounded-md p-1.5" style={{ background: accent + '22', color: accent }}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-[0.10em]" style={{ color: tone.muted }}>{label}</div>
        <div className="text-[15px] font-semibold leading-tight" style={{ color: tone.text }}>{value}</div>
      </div>
    </div>
  );

  const Empty = () => (
    <div className="text-[12px] italic" style={{ color: tone.muted }}>None reported.</div>
  );

  const TONE_COLORS: Record<BulletTone, { fg: string; fgDark: string; bg: string; bgDark: string }> = {
    positive: { fg: '#16a34a', fgDark: '#86efac', bg: 'rgba(22,163,74,0.10)', bgDark: 'rgba(22,163,74,0.18)' },
    neutral:  { fg: '#475569', fgDark: '#cbd5e1', bg: 'rgba(71,85,105,0.08)', bgDark: 'rgba(255,255,255,0.06)' },
    warning:  { fg: '#ca8a04', fgDark: '#fde047', bg: 'rgba(202,138,4,0.10)', bgDark: 'rgba(202,138,4,0.18)' },
    critical: { fg: '#dc2626', fgDark: '#fca5a5', bg: 'rgba(220,38,38,0.10)', bgDark: 'rgba(220,38,38,0.18)' },
  };

  const toneColor = (t: BulletTone) => {
    const c = TONE_COLORS[t];
    return { fg: isDark ? c.fgDark : c.fg, bg: isDark ? c.bgDark : c.bg };
  };

  /** A pill-style status row — used for "What Changed". */
  const StatusBadge = ({ b }: { b: ClassifiedBullet }) => {
    const { fg, bg } = toneColor(b.tone);
    const Icon = b.tone === 'positive' ? CheckCircle : b.tone === 'critical' ? AlertTriangle : b.tone === 'warning' ? AlertCircle : Activity;
    return (
      <div
        className="flex items-start gap-2.5 rounded-xl border px-3 py-2.5"
        style={{ borderColor: tone.border, background: isDark ? 'rgba(0,0,0,0.18)' : 'rgba(248,250,252,0.6)' }}
      >
        <div className="rounded-md p-1.5 shrink-0" style={{ background: bg, color: fg }}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 text-[12.5px] leading-snug" style={{ color: tone.text }}>
          {b.raw}
        </div>
      </div>
    );
  };

  /** Big-number metric tile — used for "What Degraded". */
  const MetricCard = ({ b }: { b: ClassifiedBullet }) => {
    const { fg, bg } = toneColor(b.tone);
    const showRank = !!b.rank;
    const showMetric = !showRank && !!b.metric;
    return (
      <div
        className="rounded-xl border p-3.5"
        style={{ borderColor: tone.border, background: isDark ? 'rgba(0,0,0,0.18)' : 'rgba(248,250,252,0.6)' }}
      >
        <div className="flex items-start gap-2.5">
          {showRank ? (
            <div className="rounded-lg p-2 shrink-0" style={{ background: bg, color: fg }}>
              <Layers className="h-4 w-4" />
            </div>
          ) : showMetric ? (
            <div className="rounded-lg p-2 shrink-0" style={{ background: bg, color: fg }}>
              <Activity className="h-4 w-4" />
            </div>
          ) : (
            <div className="rounded-lg p-2 shrink-0" style={{ background: bg, color: fg }}>
              <AlertTriangle className="h-4 w-4" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            {showRank ? (
              <div className="flex items-baseline gap-1.5">
                <span className="text-[20px] font-bold leading-none" style={{ color: fg }}>
                  {b.rank!.current}
                </span>
                <span className="text-[12px] font-medium" style={{ color: tone.muted }}>
                  / {b.rank!.total}
                </span>
                {b.rank!.percentile != null && (
                  <span className="text-[10px] ml-1 px-1.5 py-0.5 rounded-full font-semibold" style={{ background: bg, color: fg }}>
                    {b.rank!.percentile}th pct
                  </span>
                )}
              </div>
            ) : showMetric ? (
              <div className="flex items-baseline gap-1">
                <span className="text-[20px] font-bold leading-none" style={{ color: fg }}>
                  {b.metric!.value}
                </span>
                {b.metric!.unit && (
                  <span className="text-[12px] font-medium" style={{ color: tone.muted }}>
                    {b.metric!.unit}
                  </span>
                )}
              </div>
            ) : null}

            <div className="mt-1.5 text-[12px] leading-snug" style={{ color: tone.text }}>
              {b.raw}
            </div>
            {b.cellName && (
              <div className="mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-mono"
                style={{ background: tone.fill, color: tone.secondary }}>
                <Radio className="h-2.5 w-2.5" />
                {b.cellName}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  /** Numbered reasoning bullet — used for "Likely Root Cause". */
  const ReasonItem = ({ b, index }: { b: ClassifiedBullet; index: number }) => (
    <div
      className="flex items-start gap-3 rounded-xl border p-3"
      style={{ borderColor: tone.border, background: isDark ? 'rgba(0,0,0,0.18)' : 'rgba(248,250,252,0.6)' }}
    >
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
        style={{ background: 'rgba(234,88,12,0.12)', color: '#ea580c' }}
      >
        {index + 1}
      </div>
      <div className="text-[13px] leading-relaxed" style={{ color: tone.text }}>
        {b.raw}
      </div>
    </div>
  );

  /** Action tile with verb + body — used for "Next Actions". */
  const ActionTile = ({ b }: { b: ClassifiedBullet }) => {
    // Pick an icon based on the leading verb.
    const verbMatch = b.raw.match(/^(\w+)/);
    const verb = (verbMatch?.[1] || '').toLowerCase();
    const Icon =
      /monitor|watch|observe/.test(verb) ? Activity :
      /check|verify|inspect|investigate|review/.test(verb) ? Target :
      /escalate|alert|notify/.test(verb) ? AlertTriangle :
      /rollback|revert|undo|fix|patch/.test(verb) ? Wrench :
      /continue|maintain|keep/.test(verb) ? CheckCircle :
      ListChecks;

    // Split into "verb phrase" (first sentence-fragment up to first comma/period) and the rest.
    const splitIdx = b.raw.search(/[,.;:]/);
    const head = splitIdx > 0 ? b.raw.slice(0, splitIdx) : b.raw;
    const tail = splitIdx > 0 ? b.raw.slice(splitIdx + 1).trim() : '';

    return (
      <div
        className="flex items-start gap-3 rounded-xl border p-3 transition-colors"
        style={{ borderColor: tone.border, background: isDark ? 'rgba(0,0,0,0.18)' : 'rgba(248,250,252,0.6)' }}
      >
        <div
          className="rounded-lg p-2 shrink-0"
          style={{ background: 'rgba(22,163,74,0.12)', color: '#16a34a' }}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold" style={{ color: tone.text }}>{head}</div>
          {tail && <div className="mt-0.5 text-[11.5px] leading-snug" style={{ color: tone.muted }}>{tail}</div>}
        </div>
      </div>
    );
  };

  // ─── Hero card (severity + headline) ─────────────────────────────────────

  const renderHero = () => {
    if (!synthesis || !stats) return null;
    const sev = SEVERITY_STYLES[synthesis.severity];
    const SevIcon = sev.icon;
    const fg = isDark ? sev.fgDark : sev.fg;
    const bg = isDark ? sev.bgDark : sev.bg;
    return (
      <div
        className="rounded-[18px] border overflow-hidden"
        style={{ borderColor: tone.border, background: isDark ? 'rgba(38,38,38,0.85)' : 'rgba(255,255,255,0.95)' }}
      >
        <div className="px-5 py-4 flex items-start gap-4">
          <div className="rounded-xl p-2.5 shrink-0" style={{ background: bg, color: fg }}>
            <SevIcon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]"
                style={{ background: bg, color: fg }}
              >
                {sev.label}
              </span>
              <span className="text-[11px]" style={{ color: tone.muted }}>
                USID <span className="font-mono">{realSiteId}</span> · {selectedDateId}
              </span>
            </div>
            <div className="text-[16px] font-semibold leading-snug" style={{ color: tone.text }}>
              {synthesis.headline || 'Deep investigation complete.'}
            </div>
          </div>
        </div>
        {/* Stat tiles */}
        <div
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 px-5 pb-5 pt-1"
        >
          <StatTile label="Cells" value={stats.cells || '—'} Icon={Radio} accent="#6366f1" />
          <StatTile label="Anomalous Cells" value={stats.anomalousCells} Icon={AlertTriangle} accent="#dc2626" />
          <StatTile label="Outage Events" value={stats.outageEvents} Icon={Zap} accent="#ea580c" />
          <StatTile label="Config Changes" value={stats.configChanges} Icon={GitBranch} accent="#2563eb" />
          <StatTile label="RET Changes" value={stats.retChanges} Icon={History} accent="#9333ea" />
        </div>
      </div>
    );
  };

  // ─── Verdict (4 sections) ────────────────────────────────────────────────

  const renderVerdict = () => {
    if (!synthesis) return null;

    if (synthesis.unstructuredFallback) {
      // Fallback: LLM didn't follow the markdown format — display raw text in a card.
      return (
        <SectionCard Icon={Sparkles} title="Diagnosis" accent="#6366f1">
          <div className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: tone.text }}>
            {synthesis.unstructuredFallback}
          </div>
        </SectionCard>
      );
    }

    const changed = synthesis.whatChanged.map(classifyBullet);
    const degraded = synthesis.whatDegraded.map(classifyBullet);
    const rootCauses = synthesis.rootCause.map(classifyBullet);
    const actions = synthesis.nextActions.map(classifyBullet);

    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <SectionCard Icon={GitBranch} title="What Changed" accent="#2563eb">
          {changed.length ? (
            <div className="space-y-2">
              {changed.map((b, i) => <StatusBadge key={i} b={b} />)}
            </div>
          ) : <Empty />}
        </SectionCard>

        <SectionCard Icon={Activity} title="What Degraded" accent="#dc2626">
          {degraded.length ? (
            <div className="space-y-2">
              {degraded.map((b, i) => <MetricCard key={i} b={b} />)}
            </div>
          ) : <Empty />}
        </SectionCard>

        <SectionCard Icon={Target} title="Likely Root Cause" accent="#ea580c">
          {rootCauses.length ? (
            <div className="space-y-2">
              {rootCauses.map((b, i) => <ReasonItem key={i} b={b} index={i} />)}
            </div>
          ) : <Empty />}
        </SectionCard>

        <SectionCard Icon={ListChecks} title="Next Actions" accent="#16a34a">
          {actions.length ? (
            <div className="space-y-2">
              {actions.map((b, i) => <ActionTile key={i} b={b} />)}
            </div>
          ) : <Empty />}
        </SectionCard>
      </div>
    );
  };

  // ─── Tools used ──────────────────────────────────────────────────────────

  const toolsUsed = useMemo(() => {
    if (!result?.trace?.length) return [] as Array<{ name: string; summary?: string }>;
    const tools: Array<{ name: string; summary?: string }> = [];
    for (const t of result.trace) {
      if (t.type === 'tool_call' && t.name) tools.push({ name: t.name });
      if (t.type === 'tool_result' && t.name && tools.length) {
        const last = tools[tools.length - 1];
        if (last && last.name === t.name && !last.summary) last.summary = t.summary;
      }
    }
    return tools;
  }, [result]);

  const renderToolsTimeline = () => {
    if (!toolsUsed.length) return null;
    return (
      <div
        className="rounded-[18px] border"
        style={{ borderColor: tone.border, background: isDark ? 'rgba(38,38,38,0.5)' : 'rgba(255,255,255,0.7)' }}
      >
        <button
          type="button"
          onClick={() => setTraceExpanded((v) => !v)}
          className="flex w-full items-center gap-2 px-5 py-3 text-left"
        >
          {traceExpanded ? (
            <ChevronDown className="h-4 w-4" style={{ color: tone.muted }} />
          ) : (
            <ChevronRight className="h-4 w-4" style={{ color: tone.muted }} />
          )}
          <Wrench className="h-4 w-4" style={{ color: tone.muted }} />
          <span className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: tone.muted }}>
            Investigation Trail
          </span>
          <span className="ml-auto text-[11px]" style={{ color: tone.secondary }}>
            {toolsUsed.length} tool call{toolsUsed.length === 1 ? '' : 's'} ·{' '}
            {result?.iterations} iteration{result?.iterations === 1 ? '' : 's'}
          </span>
        </button>
        {traceExpanded && (
          <div className="px-5 pb-4 space-y-2">
            {toolsUsed.map((tool, i) => (
              <div
                key={`${tool.name}-${i}`}
                className="rounded-lg border px-3 py-2"
                style={{ borderColor: tone.border, background: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(248,250,252,0.6)' }}
              >
                <div className="flex items-center gap-2 text-[12px] font-medium" style={{ color: tone.text }}>
                  <span
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold"
                    style={{ background: tone.fill, color: tone.primary }}
                  >
                    {i + 1}
                  </span>
                  {TOOL_LABELS[tool.name] || tool.name}
                </div>
                {tool.summary ? (
                  <div className="mt-1 ml-7 text-[11px] leading-snug" style={{ color: tone.muted }}>
                    {tool.summary}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ─── Evidence (grouped by category) ──────────────────────────────────────

  const renderEvidence = () => {
    if (!groupedEvidence.length) return null;
    return (
      <div className="space-y-4">
        {groupedEvidence.map((g) => (
          <div key={g.id} className="space-y-3">
            <div className="flex items-center gap-2">
              <g.Icon className="h-3.5 w-3.5" style={{ color: tone.muted }} />
              <div className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: tone.muted }}>
                {g.label}
              </div>
              <div className="flex-1 h-px" style={{ background: tone.border }} />
            </div>
            <UiBlocksRenderer blocks={g.blocks} />
          </div>
        ))}
      </div>
    );
  };

  // ─── Header (always shown) ───────────────────────────────────────────────

  const headerCard = (
    <div
      className="rounded-[18px] border p-5"
      style={{ borderColor: tone.border, background: isDark ? 'rgba(38,38,38,0.7)' : 'rgba(255,255,255,0.85)' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg p-2" style={{ background: tone.fill, color: tone.primary }}>
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[15px] font-semibold" style={{ color: tone.text }}>
              Aira AI Analyzer
            </div>
            <div className="mt-1 text-[12px] leading-relaxed" style={{ color: tone.muted }}>
              Multi-tool deep investigation for USID <span className="font-mono">{realSiteId}</span> on{' '}
              <span className="font-mono">{selectedDateId}</span>.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={runAnalysis}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.08em] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: tone.primary, color: isDark ? '#0a0a0a' : '#ffffff' }}
        >
          {running ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Analyzing…</>
          ) : result ? (
            <><RefreshCw className="h-4 w-4" /> Re-run</>
          ) : (
            <><Play className="h-4 w-4" /> Run Analysis</>
          )}
        </button>
      </div>
    </div>
  );

  const runningCard = running ? (
    <div
      className="rounded-[18px] border p-5"
      style={{ borderColor: tone.border, background: isDark ? 'rgba(38,38,38,0.5)' : 'rgba(255,255,255,0.6)' }}
    >
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: tone.primary }} />
        <div>
          <div className="text-[13px] font-semibold" style={{ color: tone.text }}>Investigating site…</div>
          <div className="text-[11px]" style={{ color: tone.muted }}>
            Running 8–10 tools in parallel batches. Typically 20–45 seconds.
          </div>
        </div>
      </div>
    </div>
  ) : null;

  const errorCard = error ? (
    <div
      className="rounded-[18px] border p-4"
      style={{ borderColor: '#ef4444', background: isDark ? 'rgba(127,29,29,0.25)' : 'rgba(254,226,226,0.6)' }}
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 shrink-0" style={{ color: '#ef4444' }} />
        <div className="text-[12px] leading-relaxed" style={{ color: isDark ? '#fecaca' : '#7f1d1d' }}>
          {error}
        </div>
      </div>
    </div>
  ) : null;

  const emptyState = !running && !result && !error ? (
    <div
      className="rounded-[18px] border border-dashed p-8 text-center"
      style={{ borderColor: tone.border, background: isDark ? 'rgba(38,38,38,0.4)' : 'rgba(255,255,255,0.5)' }}
    >
      <Sparkles className="mx-auto mb-3 h-6 w-6" style={{ color: tone.muted }} />
      <div className="text-[13px] font-medium" style={{ color: tone.text }}>
        Click <span className="font-semibold" style={{ color: tone.primary }}>Run Analysis</span> to start.
      </div>
      <div className="mt-1 text-[11px]" style={{ color: tone.muted }}>
        The agent runs a structured investigation and synthesizes a root-cause diagnosis.
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-4">
      {headerCard}
      {emptyState}
      {runningCard}
      {errorCard}
      {result && (
        <>
          {renderHero()}
          {renderVerdict()}
          {renderToolsTimeline()}
          {renderEvidence()}
        </>
      )}
    </div>
  );
}
