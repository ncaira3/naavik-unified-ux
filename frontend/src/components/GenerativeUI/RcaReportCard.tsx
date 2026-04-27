import { useState } from 'react';
import RCAReasoningPanel from '../RCAReasoningPanel';
import RcaMiniMap from './RcaMiniMap';

// ─── Type scale (strict 3-level system) ──────────────────────────────────────
// eyebrow : text-[10px] font-bold uppercase tracking-[0.14em] — labels, section headers
// body    : text-[13px] font-normal leading-[1.6]             — narrative content
// value   : text-[13px] font-medium                           — key-value data
// meta    : text-[11px] font-medium                           — secondary / muted info

// ─── Input ────────────────────────────────────────────────────────────────────

export interface RcaReportData {
  siteId?: string;
  date?: string;
  dateId?: string;
  bucket?: string | null;
  rcaBucket?: string | null;
  summary?: string | Record<string, unknown> | null;
  shortSummary?: string | Record<string, unknown> | null;
  rcaSummary?: string | null;
  confidenceScore?: number | null;
  confidenceScoreInt?: number | null;
  chainOfThought?: string | null;
  degradedCategory?: string | null;
}

interface CotSection { section: string; content: string; }

// ─── Parsing ──────────────────────────────────────────────────────────────────

function tryJson(raw: unknown): any {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (s.startsWith('{') || s.startsWith('[')) {
      try { return JSON.parse(s); } catch { /* fall through */ }
    }
  }
  return null;
}

function extractText(raw: unknown): string {
  if (!raw) return '';
  const p = tryJson(raw);
  if (p?.text && typeof p.text === 'string') return p.text.trim();
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s.startsWith('{') && !s.startsWith('[')) return s;
  }
  return '';
}

function parseCot(raw: string | null | undefined): CotSection[] {
  if (!raw) return [];
  const arr = tryJson(raw);
  if (Array.isArray(arr))
    return arr
      .filter((x: any) => x && typeof x.section === 'string' && typeof x.content === 'string')
      .map((x: any) => ({ section: String(x.section), content: String(x.content) }));
  return [];
}

function parseMdBullets(text: string): [string, string][] {
  return text.split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .reduce<[string, string][]>((acc, line) => {
      const m = line.match(/^-?\s*\*\*([^*]+)\*\*:\s*(.+)/);
      if (m) acc.push([m[1].trim(), m[2].trim()]);
      return acc;
    }, []);
}

function pullMdValue(text: string, key: string): string {
  const m = text.match(new RegExp(`\\*\\*${key}\\*\\*:\\s*(.+)`));
  return m ? m[1].trim() : '';
}

function isEmptyContent(content: string): boolean {
  const l = content.toLowerCase().trim();
  return l.includes('no ') && (l.includes('available for analysis') || l.includes('data available') || l.includes('not available'));
}

function resolveConfidence(data: RcaReportData, cot: CotSection[]): number | null {
  if (data.confidenceScoreInt != null && Number.isFinite(data.confidenceScoreInt))
    return Math.min(100, Math.max(0, data.confidenceScoreInt));
  if (data.confidenceScore != null && Number.isFinite(data.confidenceScore)) {
    const v = data.confidenceScore;
    return Math.min(100, Math.max(0, v > 1 ? v : Math.round(v * 100)));
  }
  const bp = tryJson(data.bucket || data.rcaBucket);
  if (Array.isArray(bp?.details)) {
    const c = bp.details[0]?.confidence;
    if (c != null) return Math.min(100, Math.round(Number(c) <= 1 ? Number(c) * 100 : Number(c)));
  }
  const rcaSec = cot.find((s) => s.section === 'rca');
  if (rcaSec) {
    const n = parseFloat(pullMdValue(rcaSec.content, 'Confidence'));
    if (!isNaN(n)) return Math.min(100, Math.round(n <= 1 ? n * 100 : n));
  }
  return null;
}

// ─── Bucket theme ─────────────────────────────────────────────────────────────

function getBucketTheme(b: string) {
  const bl = b.toLowerCase();
  if (bl.includes('congestion') || bl.includes('traffic'))
    return { pill: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300', dot: 'bg-amber-400' };
  if (bl.includes('outage') || bl.includes('down'))
    return { pill: 'border-red-300 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300', dot: 'bg-red-400' };
  if (bl.includes('interference') || bl.includes('rf'))
    return { pill: 'border-purple-300 bg-purple-50 text-purple-800 dark:border-purple-500/30 dark:bg-purple-500/10 dark:text-purple-300', dot: 'bg-purple-400' };
  return { pill: 'border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300', dot: 'bg-indigo-400' };
}

// ─── Confidence badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ score }: { score: number }) {
  const high = score >= 80;
  const med  = score >= 60;
  const label = high ? 'High' : med ? 'Moderate' : 'Low';
  const cls = high
    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
    : med
      ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
      : 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300';
  const dot = high ? 'bg-emerald-400' : med ? 'bg-amber-400' : 'bg-red-400';

  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Confidence</span>
      <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[13px] font-semibold ${cls}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label} · {score}%
      </span>
    </div>
  );
}

// ─── SVG section icons (replaces emoji) ──────────────────────────────────────

function Icon({ section }: { section: string }) {
  const cls = 'h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400';
  switch (section) {
    case 'kpi': return (
      <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polyline points="2,12 6,7 9,9 14,4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
    case 'rca': return (
      <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="6.5" cy="6.5" r="4"/>
        <line x1="9.5" y1="9.5" x2="13.5" y2="13.5" strokeLinecap="round"/>
      </svg>
    );
    case 'solution': return (
      <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 2a4 4 0 0 1 2.5 7.1V11H5.5V9.1A4 4 0 0 1 8 2z" strokeLinejoin="round"/>
        <line x1="5.5" y1="13" x2="10.5" y2="13" strokeLinecap="round"/>
      </svg>
    );
    case 'alarms': return (
      <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 2a5 5 0 0 1 5 5v2l1 2H2l1-2V7a5 5 0 0 1 5-5z" strokeLinejoin="round"/>
        <path d="M6.5 11.5a1.5 1.5 0 0 0 3 0"/>
      </svg>
    );
    case 'tickets': return (
      <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="4" width="12" height="8" rx="1"/>
        <path d="M11 4V3M11 13v-1M5 4V3M5 13v-1" strokeLinecap="round"/>
      </svg>
    );
    case 'cm_changes': return (
      <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="2.5"/>
        <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4" strokeLinecap="round"/>
      </svg>
    );
    case 'outages': return (
      <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polygon points="8,2 15,14 1,14" strokeLinejoin="round"/>
        <line x1="8" y1="7" x2="8" y2="10" strokeLinecap="round"/>
        <circle cx="8" cy="12" r="0.5" fill="currentColor"/>
      </svg>
    );
    case 'neighbors': return (
      <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="5"/>
        <path d="M3 8h10M8 3c-1.5 2-1.5 6 0 10M8 3c1.5 2 1.5 6 0 10" strokeLinecap="round"/>
      </svg>
    );
    default: return (
      <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="2" width="12" height="12" rx="1.5"/>
        <line x1="5" y1="6" x2="11" y2="6" strokeLinecap="round"/>
        <line x1="5" y1="9" x2="9" y2="9" strokeLinecap="round"/>
      </svg>
    );
  }
}

// ─── Section metadata ─────────────────────────────────────────────────────────

const SECTION_META: Record<string, { label: string; important?: boolean }> = {
  kpi:        { label: 'KPI Signals',    important: true },
  rca:        { label: 'Root Cause',     important: true },
  solution:   { label: 'Recommendation', important: true },
  alarms:     { label: 'Alarms' },
  tickets:    { label: 'Tickets' },
  cm_changes: { label: 'CM Changes' },
  outages:    { label: 'Outages' },
  neighbors:  { label: 'Neighbors' },
};

// ─── KPI section ──────────────────────────────────────────────────────────────

function KpiSection({ content }: { content: string }) {
  const lines  = content.split('\n').map((l) => l.trim()).filter(Boolean);
  const narrative = lines[0]?.startsWith('-') ? '' : lines[0];
  const kpis  = lines.slice(narrative ? 1 : 0).map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean);
  return (
    <div className="space-y-2.5">
      {narrative && (
        <p className="text-[13px] font-normal leading-[1.6] text-slate-600 dark:text-slate-300">{narrative}</p>
      )}
      {kpis.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {kpis.map((k) => (
            <span key={k} className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-600 dark:border-white/10 dark:bg-white/6 dark:text-slate-300">
              {k}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Root cause section ───────────────────────────────────────────────────────

const PRIMARY_RCA_KEYS  = ['Primary Root Cause', 'Failure Mode', 'Fault Classification', 'Impact Scope', 'Contributing Factors', 'Rationale'];
const SECONDARY_RCA_KEYS = ['Propagation Path', 'Other Applicable Insights'];

function RcaSection({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const all      = parseMdBullets(content);
  const primary  = all.filter(([k]) => PRIMARY_RCA_KEYS.includes(k));
  const secondary = all.filter(([k]) => SECONDARY_RCA_KEYS.includes(k));
  const shown    = expanded ? all : primary;

  return (
    <div className="space-y-0">
      {shown.map(([k, v], i) => (
        <div
          key={k}
          className={`flex items-start gap-3 py-2 ${i < shown.length - 1 ? 'border-b border-slate-100 dark:border-white/5' : ''}`}
        >
          {/* Key label */}
          <span className="w-40 shrink-0 pt-px text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400 leading-[1.6]">
            {k}
          </span>
          {/* Value */}
          <span className="flex-1 text-[13px] font-normal leading-[1.6] text-slate-700 dark:text-slate-200">
            {v}
          </span>
        </div>
      ))}
      {secondary.length > 0 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 flex cursor-pointer items-center gap-1 text-[11px] font-medium text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
        >
          <svg className={`h-3 w-3 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 3l4 3-4 3"/>
          </svg>
          {expanded ? 'Show less' : `Show ${secondary.length} more`}
        </button>
      )}
    </div>
  );
}

// ─── Solution section ─────────────────────────────────────────────────────────

function SolutionSection({ content }: { content: string }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 dark:border-emerald-500/25 dark:bg-emerald-500/8">
      <p className="text-[13px] font-normal leading-[1.6] text-emerald-800 dark:text-emerald-200">
        {content.trim()}
      </p>
    </div>
  );
}

// ─── Generic section ──────────────────────────────────────────────────────────

function GenericSection({ content }: { content: string }) {
  return (
    <p className="text-[13px] font-normal leading-[1.6] text-slate-600 dark:text-slate-300">
      {content.trim()}
    </p>
  );
}

// ─── Evidence accordion item ──────────────────────────────────────────────────

function EvidenceItem({ sec }: { sec: CotSection }) {
  const meta  = SECTION_META[sec.section] || { label: sec.section };
  const [open, setOpen] = useState(Boolean(meta.important));

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors duration-150 ${
          open
            ? 'bg-slate-50 dark:bg-white/5'
            : 'bg-transparent hover:bg-slate-50 dark:hover:bg-white/4'
        }`}
      >
        <Icon section={sec.section} />
        <span className="flex-1 text-[12px] font-semibold text-slate-800 dark:text-slate-100">
          {meta.label}
        </span>
        <svg
          className={`h-3 w-3 shrink-0 text-slate-500 dark:text-slate-400 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 3l4 3-4 3"/>
        </svg>
      </button>

      {open && (
        <div className="border-t border-slate-100 bg-slate-50/80 px-3.5 py-3 dark:border-white/5 dark:bg-white/3">
          {sec.section === 'kpi'      && <KpiSection     content={sec.content} />}
          {sec.section === 'rca'      && <RcaSection     content={sec.content} />}
          {sec.section === 'solution' && <SolutionSection content={sec.content} />}
          {!['kpi','rca','solution'].includes(sec.section) && <GenericSection content={sec.content} />}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RcaReportCard({ data }: { data: RcaReportData }) {
  const [showPanel, setShowPanel] = useState(false);

  const siteId = data.siteId || '—';
  const dateId = data.dateId || data.date || '—';
  const bucketRaw = data.bucket || data.rcaBucket || '';
  const bucket  = extractText(bucketRaw) || bucketRaw || 'Unknown';
  const cot     = parseCot(data.chainOfThought);
  const score   = resolveConfidence(data, cot);

  let summary   =
    extractText(data.summary) ||
    extractText(data.shortSummary) ||
    data.rcaSummary || '';
  if (!summary) {
    const rcaSec = cot.find((s) => s.section === 'rca');
    if (rcaSec) summary = pullMdValue(rcaSec.content, 'Primary Root Cause');
  }

  const theme   = getBucketTheme(bucket);
  const visible = [
    ...cot.filter((s) => SECTION_META[s.section]?.important),
    ...cot.filter((s) => !SECTION_META[s.section]?.important),
  ].filter((s) => !isEmptyContent(s.content));

  const hasSiteId = Boolean(data.siteId && data.siteId !== '—');

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900/90">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-white/10">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          Root Cause Analysis
        </span>
        <span className="font-mono text-[11px] font-medium text-slate-500 dark:text-slate-400">
          {siteId} · {dateId}
        </span>
      </div>

      {/* ── Category + Confidence ──────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 px-4 py-4">
        {/* Bucket */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Category
          </span>
          <div>
            <span className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[13px] font-semibold ${theme.pill}`}>
              <span className={`h-2 w-2 rounded-full ${theme.dot}`} />
              {bucket.replace(/_/g, ' ')}
            </span>
          </div>
        </div>
        {/* Confidence */}
        {score != null && <ConfidenceBadge score={score} />}
      </div>

      {/* ── Summary ────────────────────────────────────────────────────────── */}
      {summary && (
        <div className="px-4 pb-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-white/10 dark:bg-white/6">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Summary
            </p>
            <p className="text-[13px] font-normal leading-[1.6] text-slate-800 dark:text-slate-100">
              {summary}
            </p>
          </div>
        </div>
      )}

      {/* ── Site Map ───────────────────────────────────────────────────────── */}
      {hasSiteId && (
        <div className="px-4 pb-4">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Site Location
          </p>
          <RcaMiniMap siteId={data.siteId!} height={240} />
        </div>
      )}

      {/* ── Evidence Chain ─────────────────────────────────────────────────── */}
      {visible.length > 0 && (
        <div className="px-4 pb-4">
          <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
            Evidence Chain
          </p>
          <div className="space-y-1.5">
            {visible.map((sec) => <EvidenceItem key={sec.section} sec={sec} />)}
          </div>
        </div>
      )}

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-t border-slate-200 px-4 py-3 dark:border-white/10">
        <button
          onClick={() => setShowPanel(true)}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors duration-150 hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.6">
            <circle cx="8" cy="8" r="6"/>
            <path strokeLinecap="round" d="M8 7v4M8 5.5v.5"/>
          </svg>
          Explain Intuitions
        </button>
        <span className="ml-auto text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
          AI-generated
        </span>
      </div>

      {/* ── Reasoning panel modal ───────────────────────────────────────────── */}
      {showPanel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowPanel(false); }}
        >
          <div className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-900">
            <button
              onClick={() => setShowPanel(false)}
              className="absolute right-3 top-3 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/20"
              aria-label="Close"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" d="M4 4l8 8M12 4l-8 8"/>
              </svg>
            </button>
            <div className="p-4">
              <RCAReasoningPanel siteId={siteId} dateId={dateId} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
