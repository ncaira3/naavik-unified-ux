import { useMemo } from 'react';
import {
  AlertTriangle, AlertCircle, Activity, CheckCircle, GitBranch, Target, ListChecks,
  Sparkles, Wrench, Eye, ShieldAlert, Layers,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

interface DiagnosisCardProps {
  /** Raw markdown synthesis text emitted by the agent. */
  synthesis: string;
  /** Optional context line (e.g. "USID 9787 · 2026-04-25"). */
  context?: string;
}

type Severity = 'critical' | 'major' | 'minor' | 'nominal';
type BulletTone = 'positive' | 'neutral' | 'warning' | 'critical';

interface ParsedSynthesis {
  severity: Severity;
  headline: string;
  whatChanged: string[];
  whatDegraded: string[];
  rootCause: string[];
  nextActions: string[];
  fallback?: string;
}

interface ClassifiedBullet {
  raw: string;
  tone: BulletTone;
  metric?: { value: string; unit?: string };
  rank?: { current: number; total: number; percentile?: number };
  cellName?: string;
}

// ─── Parsing ────────────────────────────────────────────────────────────────

function parseHeader(line: string): string | null {
  const t = line.trim();
  if (!t) return null;
  const atx = t.match(/^#{1,4}\s*(.+?)\s*#*$/);
  if (atx) return atx[1].replace(/^[*_`]+|[*_`]+$/g, '').trim();
  const bold = t.match(/^\*\*(.+?)\*\*$|^__(.+?)__$/);
  if (bold) return (bold[1] || bold[2] || '').trim();
  const colon = t.match(/^([A-Za-z][A-Za-z\s]+?)\s*:\s*$/);
  if (colon) return colon[1].trim();
  return null;
}

function canonicalSection(name: string): keyof Omit<ParsedSynthesis, 'fallback'> | null {
  const n = name.toLowerCase().trim();
  if (/severity/.test(n)) return 'severity';
  if (/headline|summary|overview/.test(n)) return 'headline';
  if (/what.*chang|changes?|recent change/.test(n)) return 'whatChanged';
  if (/what.*degrad|degraded?|impact|symptoms?/.test(n)) return 'whatDegraded';
  if (/root cause|likely.*cause|cause/.test(n)) return 'rootCause';
  if (/next action|recommend|action items?/.test(n)) return 'nextActions';
  return null;
}

function parseSynthesis(raw: string): ParsedSynthesis {
  const text = String(raw || '').trim();
  if (!text) return { severity: 'nominal', headline: '', whatChanged: [], whatDegraded: [], rootCause: [], nextActions: [] };

  const sections: Partial<Record<string, string>> = {};
  const lines = text.split(/\r?\n/);
  let curr: keyof ParsedSynthesis | null = null;
  let buf: string[] = [];
  const flush = () => { if (curr) sections[curr] = buf.join('\n').trim(); buf = []; };

  for (const line of lines) {
    const h = parseHeader(line);
    const c = h ? canonicalSection(h) : null;
    if (c) { flush(); curr = c as any; }
    else if (curr) buf.push(line);
  }
  flush();

  const toBullets = (s: string | undefined): string[] => !s ? [] : s
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+\.)\s*/, '').trim())
    .filter(Boolean);

  const sevRaw = (sections['severity'] || '').toLowerCase();
  const severity: Severity = /critical/.test(sevRaw) ? 'critical' : /major/.test(sevRaw) ? 'major' : /minor/.test(sevRaw) ? 'minor' : 'nominal';
  const hasStructured = ['headline','whatChanged','whatDegraded','rootCause','nextActions'].some((k) => (sections[k] || '').length);

  return {
    severity,
    headline: (sections['headline'] || '').replace(/^["']|["']$/g, '').replace(/^\*\*|\*\*$/g, '').trim(),
    whatChanged: toBullets(sections['whatChanged']),
    whatDegraded: toBullets(sections['whatDegraded']),
    rootCause: toBullets(sections['rootCause']),
    nextActions: toBullets(sections['nextActions']),
    fallback: hasStructured ? undefined : text,
  };
}

function classifyBullet(raw: string): ClassifiedBullet {
  const text = raw.trim();
  let tone: BulletTone = 'neutral';
  if (/^(no |none |stable|nominal|healthy|continue routine|no critical)/i.test(text)) tone = 'positive';
  else if (/critical|outage|down|severe/i.test(text)) tone = 'critical';
  else if (/degrad|drop|fail|anomal|underperform|low |risk|warning/i.test(text)) tone = 'warning';

  const numMatch = text.match(/\(([0-9]+\.?[0-9]*\s*%?)\)/) ||
                   text.match(/\b([0-9]+\.?[0-9]*\s*(?:Mbps|GB|%|dBm|min))\b/);
  const metric = numMatch ? (() => {
    const v = numMatch[1].trim();
    const m = v.match(/^([0-9.]+)\s*(.+)?$/);
    return m ? { value: m[1], unit: m[2] } : { value: v };
  })() : undefined;

  const rankMatch = text.match(/(\d+)(?:st|nd|rd|th)?\s+(?:out\s+of|of)\s+(\d+)/i);
  const pctMatch = text.match(/\b(\d+)(?:st|nd|rd|th)\s+percentile\b/i);
  const rank = rankMatch ? { current: Number(rankMatch[1]), total: Number(rankMatch[2]), percentile: pctMatch ? Number(pctMatch[1]) : undefined } : undefined;

  const cellMatch = text.match(/\b[A-Z]{3}\d{4,6}_[A-Za-z0-9_]+\b/);
  const cellName = cellMatch ? cellMatch[0] : undefined;

  return { raw: text, tone, metric, rank, cellName };
}

// ─── Component ──────────────────────────────────────────────────────────────

const SEV: Record<Severity, { label: string; from: string; to: string; ring: string; icon: typeof AlertTriangle }> = {
  critical: { label: 'CRITICAL', from: '#dc2626', to: '#991b1b', ring: 'rgba(220,38,38,0.35)', icon: ShieldAlert },
  major:    { label: 'MAJOR',    from: '#ea580c', to: '#c2410c', ring: 'rgba(234,88,12,0.30)', icon: AlertTriangle },
  minor:    { label: 'MINOR',    from: '#ca8a04', to: '#a16207', ring: 'rgba(202,138,4,0.30)', icon: Activity },
  nominal:  { label: 'NOMINAL',  from: '#16a34a', to: '#15803d', ring: 'rgba(22,163,74,0.30)', icon: CheckCircle },
};

const TONE: Record<BulletTone, { fg: string; fgDark: string; bg: string; bgDark: string }> = {
  positive: { fg: '#16a34a', fgDark: '#86efac', bg: 'rgba(22,163,74,0.10)',  bgDark: 'rgba(22,163,74,0.18)' },
  neutral:  { fg: '#475569', fgDark: '#cbd5e1', bg: 'rgba(71,85,105,0.08)',  bgDark: 'rgba(255,255,255,0.06)' },
  warning:  { fg: '#ca8a04', fgDark: '#fde047', bg: 'rgba(202,138,4,0.10)',  bgDark: 'rgba(202,138,4,0.18)' },
  critical: { fg: '#dc2626', fgDark: '#fca5a5', bg: 'rgba(220,38,38,0.10)',  bgDark: 'rgba(220,38,38,0.18)' },
};

export default function DiagnosisCard({ synthesis, context }: DiagnosisCardProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const parsed = useMemo(() => parseSynthesis(synthesis), [synthesis]);

  const sev = SEV[parsed.severity];
  const SevIcon = sev.icon;

  const tone = (t: BulletTone) => {
    const c = TONE[t];
    return { fg: isDark ? c.fgDark : c.fg, bg: isDark ? c.bgDark : c.bg };
  };

  const cardSurface = isDark ? 'rgba(28,28,30,0.85)' : 'rgba(255,255,255,0.92)';
  const cardBorder = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(45,42,38,0.10)';
  const text = isDark ? '#FBFBFB' : '#1F1D1A';
  const textSec = isDark ? '#B3B3B3' : '#6B6762';
  const textMuted = isDark ? '#8C8C8C' : '#8F8B85';
  const innerSurface = isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.018)';

  // ─── Hero (severity strip + headline + meta) ─────────────────────────────
  const Hero = () => (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{ background: cardSurface, border: `1px solid ${cardBorder}`, boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.45)' : '0 4px 18px rgba(45,42,38,0.06)' }}
    >
      {/* Top severity gradient ribbon */}
      <div
        className="absolute inset-x-0 top-0 h-1.5"
        style={{ background: `linear-gradient(90deg, ${sev.from}, ${sev.to})` }}
      />
      <div className="relative p-5 flex items-start gap-4">
        {/* Severity orb */}
        <div className="relative shrink-0">
          <div
            className="absolute inset-0 rounded-full blur-xl opacity-60 animate-pulse"
            style={{ background: sev.ring }}
            aria-hidden
          />
          <div
            className="relative flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg"
            style={{ background: `linear-gradient(135deg, ${sev.from}, ${sev.to})` }}
          >
            <SevIcon className="h-5 w-5" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span
              className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white shadow-sm"
              style={{ background: `linear-gradient(135deg, ${sev.from}, ${sev.to})` }}
            >
              {sev.label}
            </span>
            {context && (
              <span className="text-[11px] font-medium" style={{ color: textMuted }}>
                {context}
              </span>
            )}
          </div>
          <div className="text-[16px] font-semibold leading-snug" style={{ color: text }}>
            {parsed.headline || 'Investigation complete.'}
          </div>
        </div>
      </div>
    </div>
  );

  // ─── Section card with section accent ────────────────────────────────────
  const Section = ({ Icon, title, accent, children }: { Icon: typeof Activity; title: string; accent: string; children: React.ReactNode }) => (
    <div
      className="relative overflow-hidden rounded-2xl group transition-all duration-200 hover:-translate-y-0.5"
      style={{
        background: cardSurface,
        border: `1px solid ${cardBorder}`,
        boxShadow: isDark ? '0 6px 22px rgba(0,0,0,0.35)' : '0 3px 14px rgba(45,42,38,0.05)',
      }}
    >
      {/* Subtle radial accent in the corner */}
      <div
        className="absolute -top-12 -right-12 h-32 w-32 rounded-full opacity-30 blur-2xl pointer-events-none transition-opacity group-hover:opacity-50"
        style={{ background: accent }}
        aria-hidden
      />
      <div className="relative p-4">
        <div className="flex items-center gap-2 mb-3">
          <div
            className="rounded-lg p-1.5"
            style={{ background: accent + '22', color: accent }}
          >
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: textSec }}>
            {title}
          </div>
        </div>
        {children}
      </div>
    </div>
  );

  // ─── Bullet renderers ────────────────────────────────────────────────────
  const StatusBadge = ({ b }: { b: ClassifiedBullet }) => {
    const { fg, bg } = tone(b.tone);
    const Icon = b.tone === 'positive' ? CheckCircle : b.tone === 'critical' ? AlertTriangle : b.tone === 'warning' ? AlertCircle : Activity;
    return (
      <div
        className="flex items-start gap-2.5 rounded-xl px-3 py-2.5 transition-all duration-150 hover:translate-x-0.5"
        style={{ background: innerSurface, border: `1px solid ${cardBorder}` }}
      >
        <div className="rounded-md p-1.5 shrink-0" style={{ background: bg, color: fg }}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 text-[12.5px] leading-snug" style={{ color: text }}>{b.raw}</div>
      </div>
    );
  };

  const MetricBar = ({ b }: { b: ClassifiedBullet }) => {
    const { fg, bg } = tone(b.tone);
    const showRank = !!b.rank;
    const showMetric = !showRank && !!b.metric;
    return (
      <div
        className="rounded-xl p-3.5 transition-all duration-150 hover:scale-[1.01]"
        style={{ background: innerSurface, border: `1px solid ${cardBorder}` }}
      >
        <div className="flex items-start gap-2.5">
          <div className="rounded-lg p-2 shrink-0" style={{ background: bg, color: fg }}>
            {showRank ? <Layers className="h-4 w-4" /> : <Activity className="h-4 w-4" />}
          </div>
          <div className="flex-1 min-w-0">
            {showRank ? (
              <div className="flex items-baseline gap-1.5">
                <span className="text-[22px] font-bold leading-none tabular-nums" style={{ color: fg }}>{b.rank!.current}</span>
                <span className="text-[12px] font-medium" style={{ color: textMuted }}>/ {b.rank!.total}</span>
                {b.rank!.percentile != null && (
                  <span className="text-[10px] ml-1 px-1.5 py-0.5 rounded-full font-semibold" style={{ background: bg, color: fg }}>
                    {b.rank!.percentile}th pct
                  </span>
                )}
              </div>
            ) : showMetric ? (
              <div className="flex items-baseline gap-1">
                <span className="text-[22px] font-bold leading-none tabular-nums" style={{ color: fg }}>{b.metric!.value}</span>
                {b.metric!.unit && <span className="text-[12px] font-medium" style={{ color: textMuted }}>{b.metric!.unit}</span>}
              </div>
            ) : null}
            <div className="mt-1.5 text-[12px] leading-snug" style={{ color: text }}>{b.raw}</div>
            {b.cellName && (
              <div className="mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-mono"
                style={{ background: bg, color: fg }}>
                <Eye className="h-2.5 w-2.5" />
                {b.cellName}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const ReasonItem = ({ b, index }: { b: ClassifiedBullet; index: number }) => (
    <div
      className="flex items-start gap-3 rounded-xl p-3 transition-all duration-150 hover:translate-x-0.5"
      style={{ background: innerSurface, border: `1px solid ${cardBorder}` }}
    >
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white text-[12px] font-bold shadow-sm"
        style={{ background: 'linear-gradient(135deg, #ea580c, #c2410c)' }}
      >
        {index + 1}
      </div>
      <div className="text-[13px] leading-relaxed" style={{ color: text }}>{b.raw}</div>
    </div>
  );

  const ActionTile = ({ b }: { b: ClassifiedBullet }) => {
    const verb = (b.raw.match(/^(\w+)/)?.[1] || '').toLowerCase();
    const Icon =
      /monitor|watch|observe/.test(verb) ? Activity :
      /check|verify|inspect|investigate|review/.test(verb) ? Target :
      /escalate|alert|notify/.test(verb) ? AlertTriangle :
      /rollback|revert|undo|fix|patch/.test(verb) ? Wrench :
      /continue|maintain|keep/.test(verb) ? CheckCircle :
      ListChecks;
    const splitIdx = b.raw.search(/[,.;:]/);
    const head = splitIdx > 0 ? b.raw.slice(0, splitIdx) : b.raw;
    const tail = splitIdx > 0 ? b.raw.slice(splitIdx + 1).trim() : '';
    return (
      <div
        className="flex items-start gap-3 rounded-xl p-3 transition-all duration-150 hover:translate-x-0.5"
        style={{ background: innerSurface, border: `1px solid ${cardBorder}` }}
      >
        <div
          className="rounded-lg p-2 shrink-0 text-white shadow-sm"
          style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold" style={{ color: text }}>{head}</div>
          {tail && <div className="mt-0.5 text-[11.5px] leading-snug" style={{ color: textMuted }}>{tail}</div>}
        </div>
      </div>
    );
  };

  const Empty = () => (
    <div className="text-[12px] italic" style={{ color: textMuted }}>None reported.</div>
  );

  // Fallback path: synthesis didn't match the structured format.
  if (parsed.fallback) {
    return (
      <div
        className="rounded-2xl p-5"
        style={{ background: cardSurface, border: `1px solid ${cardBorder}` }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4" style={{ color: textSec }} />
          <div className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: textSec }}>Diagnosis</div>
        </div>
        <div className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: text }}>
          {parsed.fallback}
        </div>
      </div>
    );
  }

  const changed = parsed.whatChanged.map(classifyBullet);
  const degraded = parsed.whatDegraded.map(classifyBullet);
  const rootCauses = parsed.rootCause.map(classifyBullet);
  const actions = parsed.nextActions.map(classifyBullet);

  return (
    <div className="space-y-3">
      <Hero />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section Icon={GitBranch} title="What Changed" accent="#2563eb">
          {changed.length ? <div className="space-y-2">{changed.map((b, i) => <StatusBadge key={i} b={b} />)}</div> : <Empty />}
        </Section>
        <Section Icon={Activity} title="What Degraded" accent="#dc2626">
          {degraded.length ? <div className="space-y-2">{degraded.map((b, i) => <MetricBar key={i} b={b} />)}</div> : <Empty />}
        </Section>
        <Section Icon={Target} title="Likely Root Cause" accent="#ea580c">
          {rootCauses.length ? <div className="space-y-2">{rootCauses.map((b, i) => <ReasonItem key={i} b={b} index={i} />)}</div> : <Empty />}
        </Section>
        <Section Icon={ListChecks} title="Next Actions" accent="#16a34a">
          {actions.length ? <div className="space-y-2">{actions.map((b, i) => <ActionTile key={i} b={b} />)}</div> : <Empty />}
        </Section>
      </div>
    </div>
  );
}
