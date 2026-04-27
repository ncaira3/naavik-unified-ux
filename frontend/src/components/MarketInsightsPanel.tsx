import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Signal,
  Radio,
  Wifi,
  Zap,
  BarChart3,
  Activity,
  ChevronUp,
  ChevronDown,
  Minus,
} from 'lucide-react';
import api from '../services/api';
import { useMapData } from '../context/MapDataContext';
import { idbCacheAside, idbDelete } from '../utils/idbCache';

// ─── Types ────────────────────────────────────────────────────────────────────

type OffenderInsights = Awaited<ReturnType<typeof api.getCompassMarketOffenderInsights>>;
type CellHealth       = Awaited<ReturnType<typeof api.getCompassMarketCellHealth>>;

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2) {
  if (n === 0) return '0';
  if (Math.abs(n) < 0.0001) return n.toExponential(2);
  return n.toFixed(decimals);
}
function fmtImpact(n: number) {
  if (n === 0) return '0';
  if (Math.abs(n) >= 0.001) return (n * 100).toFixed(3) + '%';
  return (n * 1_000_000).toFixed(1) + 'µ';
}
function pct(part: number, total: number) {
  if (!total) return 0;
  return (part / total) * 100;
}

// ─── Micro sparkline (SVG polyline, no deps) ──────────────────────────────────

function Sparkline({
  values,
  stroke,
  fill,
  height = 40,
}: {
  values: number[];
  stroke: string;
  fill: string;
  height?: number;
}) {
  if (!values.length) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / Math.max(values.length - 1, 1)) * 100},${100 - ((v - min) / span) * 100}`)
    .join(' ');
  const area = `${pts} 100,100 0,100`;
  const id = `mkt-spark-${stroke.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity="0.28" />
          <stop offset="100%" stopColor={fill} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── Horizontal bar (relative %) ──────────────────────────────────────────────

function ImpactBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 2;
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-light-muted dark:text-text-muted truncate">
        {label}
      </div>
      <div className="flex-1 h-2 rounded-full bg-cream-surface-light dark:bg-white/8 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${w}%`, background: color }}
        />
      </div>
      <div className="w-16 shrink-0 text-right text-[11px] font-semibold text-text-light-primary dark:text-text-primary">
        {fmtImpact(value)}
      </div>
    </div>
  );
}

// ─── Donut segment ────────────────────────────────────────────────────────────

function DonutChart({ segments }: { segments: Array<{ value: number; color: string; label: string }> }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  let offset = 0;
  const r = 38;
  const circ = 2 * Math.PI * r;

  return (
    <div className="relative flex items-center justify-center">
      <svg viewBox="0 0 100 100" className="w-28 h-28 -rotate-90">
        {segments.map((seg, i) => {
          const frac = seg.value / total;
          const dash = frac * circ;
          const gap  = circ - dash;
          const el = (
            <circle
              key={i}
              cx="50" cy="50" r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth="12"
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={-offset * circ}
              strokeLinecap="butt"
              style={{ transition: 'stroke-dasharray 0.6s ease' }}
            />
          );
          offset += frac;
          return el;
        })}
        {/* inner hole */}
        <circle cx="50" cy="50" r="26" className="fill-white dark:fill-[#1c1c2e]" />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-xl font-bold tracking-tight text-text-light-primary dark:text-text-primary">
          {total}
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-widest text-text-light-muted dark:text-text-muted mt-0.5">
          Sites
        </span>
      </div>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-xl bg-cream-surface-light dark:bg-white/6 ${className ?? ''}`}
    />
  );
}

// ─── KPI Hero Card ────────────────────────────────────────────────────────────

function HeroCard({
  label,
  value,
  sub,
  trend,
  delta,
  accentBg,
  accentText,
  icon,
  sparkValues,
  sparkColor,
}: {
  label: string;
  value: string | number;
  sub?: string;
  trend?: 'up' | 'down' | 'flat';
  delta?: string;
  accentBg: string;
  accentText: string;
  icon: React.ReactNode;
  sparkValues?: number[];
  sparkColor: string;
}) {
  const TrendIcon = trend === 'up' ? ChevronUp : trend === 'down' ? ChevronDown : Minus;
  return (
    <div
      className="rounded-[24px] border p-4 flex flex-col gap-3 shadow-[0_16px_36px_rgba(15,23,42,0.07)] overflow-hidden relative"
      style={{ borderColor: `${accentBg}40`, background: `linear-gradient(145deg, ${accentBg}14, transparent 60%)` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className="rounded-xl p-2.5 flex items-center justify-center"
          style={{ background: `${accentBg}22` }}
        >
          <span style={{ color: accentText }}>{icon}</span>
        </div>
        {delta && (
          <div
            className="flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{ background: `${accentBg}1a`, color: accentText }}
          >
            <TrendIcon className="w-3 h-3" />
            {delta}
          </div>
        )}
      </div>

      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-light-muted dark:text-text-muted">
          {label}
        </div>
        <div className="mt-1 text-3xl font-bold tracking-[-0.03em] text-text-light-primary dark:text-text-primary">
          {value}
        </div>
        {sub && (
          <div className="mt-0.5 text-xs text-text-light-secondary dark:text-text-secondary">{sub}</div>
        )}
      </div>

      {sparkValues && sparkValues.length > 0 && (
        <div className="w-full">
          <Sparkline values={sparkValues} stroke={sparkColor} fill={sparkColor} height={36} />
        </div>
      )}
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, icon, children, badge }: { title: string; icon: React.ReactNode; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <section className="rounded-[28px] border border-cream-border bg-white/88 shadow-[0_18px_42px_rgba(15,23,42,0.08)] backdrop-blur-sm dark:border-pulse-border dark:bg-pulse-surface/90 dark:shadow-[0_22px_54px_rgba(0,0,0,0.28)]">
      <div className="flex items-center justify-between gap-3 border-b border-cream-border/70 px-5 py-4 dark:border-pulse-border/70">
        <div className="flex items-center gap-2.5">
          <span className="text-text-light-muted dark:text-text-muted">{icon}</span>
          <h3 className="text-sm font-semibold text-text-light-primary dark:text-text-primary">{title}</h3>
        </div>
        {badge}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

// ─── Cell health pill ─────────────────────────────────────────────────────────

function CellHealthCard({
  label,
  count,
  subtitle,
  severity,
  icon,
}: {
  label: string;
  count: number;
  subtitle: string;
  severity: 'critical' | 'warning' | 'info' | 'ok';
  icon: React.ReactNode;
}) {
  const colors = {
    critical: { bg: '#ef4444', text: '#ef4444', pill: 'bg-red-50 border-red-200 dark:bg-red-500/10 dark:border-red-500/25' },
    warning:  { bg: '#f59e0b', text: '#f59e0b', pill: 'bg-amber-50 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/25' },
    info:     { bg: '#0891b2', text: '#0891b2', pill: 'bg-cyan-50 border-cyan-200 dark:bg-cyan-500/10 dark:border-cyan-500/25' },
    ok:       { bg: '#10b981', text: '#10b981', pill: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/25' },
  }[severity];
  return (
    <div className={`rounded-[22px] border p-4 flex flex-col gap-2 ${colors.pill}`}>
      <div className="flex items-center justify-between">
        <span style={{ color: colors.text }}>{icon}</span>
        <span className="text-xs font-bold" style={{ color: colors.text }}>{count.toLocaleString()}</span>
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">{label}</div>
      <div className="text-xs text-text-light-secondary dark:text-text-secondary">{subtitle}</div>
    </div>
  );
}

// ─── Threshold badge ──────────────────────────────────────────────────────────

function ThresholdBadge({ threshold, count, color }: { threshold: string; count: number; color: string }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border px-3 py-2.5"
      style={{ borderColor: `${color}30`, background: `${color}0d` }}>
      <div className="text-xs font-mono font-semibold" style={{ color }}>
        {threshold}
      </div>
      <div className="text-base font-bold text-text-light-primary dark:text-text-primary">
        {count.toLocaleString()}
      </div>
    </div>
  );
}

// ─── Fallback / demo data when DB returns nothing ────────────────────────────

function demoOffender(): OffenderInsights {
  return {
    summary: { critical_count: 582, high_count: 1993, total_offenders: 2575, total_sites: 6682, cqx_tracked: 6640, avg_impact: 0.003412 },
    impact_breakdown: { dl_tput: 0.00312, ul_tput: 0.00189, data_drop: 0.00824, data_acc: 0.00631, vran_acc: 0.00278, vcdr_acc: 0.00144, voice_drop: 0.00392, ns_eso: 0.00204, quality: 0.00561 },
    top_offenders: Array.from({ length: 10 }, (_, i) => ({
      usid: String(200000 + i * 3711),
      total_impact: 0.0072 - i * 0.00052,
      wow_impact: 0.0068 - i * 0.00044,
      impact_delta: (i % 3 === 0 ? 1 : -1) * 0.0004 * (i + 1),
      dl_tput_imp: 0.0012 - i * 0.0001,
      data_drop_imp: 0.0021 - i * 0.00018,
      data_acc_imp: 0.0018 - i * 0.00014,
      quality_imp: 0.0009 - i * 0.00007,
    })),
    trend: Array.from({ length: 14 }, (_, i) => ({
      date_id: new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10),
      total_offenders: 6200 + Math.round(Math.sin(i / 2) * 180 + i * 22),
      critical: 520 + Math.round(Math.sin(i / 3) * 40 + i * 4.5),
      high_plus: 1800 + Math.round(Math.sin(i / 2.5) * 80 + i * 14),
      avg_impact: 0.0031 + i * 0.000055,
    })),
  };
}

function demoCell(): CellHealth {
  return {
    prb_hot_cells: 287,
    pdcch_hot_cells: 143,
    high_drop_cells: 512,
    low_acc_cells: 374,
    low_tput_cells: 228,
    avg_prb_util: 72.4,
    cell_health_summary: [],
    top_congested_cells: Array.from({ length: 10 }, (_, i) => ({
      cell_name: `CVL0${1000 + i * 37}_${i % 3 === 0 ? '9A' : i % 3 === 1 ? '3C' : '6B'}_1`,
      usid: String(10000 + i * 1337),
      kpi_name: 'AVG_DL_PRB_UTIL',
      avg_kpi_value: 98 - i * 0.8,
    })),
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

// Cache TTL: market insights are daily aggregates — 4 hours is safe
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

function offenderKey(dateId: string) { return `market:offender:${dateId}`; }
function cellKey(dateId: string)     { return `market:cell:${dateId}`; }

export interface MarketHeaderMeta {
  dateId: string;
  loading: boolean;
  fromCache: boolean;
  error: string | null;
  lastRefresh: Date | null;
  refresh: () => void;
}

interface MarketInsightsPanelProps {
  onHeaderMetaChange?: (meta: MarketHeaderMeta | null) => void;
}

export default function MarketInsightsPanel({ onHeaderMetaChange }: MarketInsightsPanelProps) {
  const { selectedDateId } = useMapData();
  const [offenderData, setOffenderData] = useState<OffenderInsights | null>(null);
  const [cellData,     setCellData]     = useState<CellHealth | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [fromCache,    setFromCache]    = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [lastRefresh,  setLastRefresh]  = useState<Date | null>(null);

  const dateId = selectedDateId || new Date().toISOString().slice(0, 10);

  const load = useCallback(async (forceRefresh = false) => {
    // On a forced refresh wipe the IDB entries first so we always go to the API
    if (forceRefresh) {
      await Promise.all([idbDelete(offenderKey(dateId)), idbDelete(cellKey(dateId))]);
    }

    // Show full spinner only when we have no data yet (cold load)
    if (!offenderData) setLoading(true);
    setError(null);

    try {
      const [offResult, cellResult] = await Promise.all([
        idbCacheAside(
          offenderKey(dateId),
          () => api.getCompassMarketOffenderInsights(dateId),
          CACHE_TTL_MS
        ),
        idbCacheAside(
          cellKey(dateId),
          () => api.getCompassMarketCellHealth(dateId),
          CACHE_TTL_MS
        ),
      ]);

      const off  = offResult.value;
      const cell = cellResult.value;

      // Fall back to demo data when the DB returns empty results
      setOffenderData((off.summary.total_sites ?? off.summary.cqx_tracked ?? 0) > 0 ? off : demoOffender());
      setCellData(cell.prb_hot_cells + cell.pdcch_hot_cells + cell.high_drop_cells > 0 ? cell : demoCell());
      setFromCache(offResult.fromCache && cellResult.fromCache);
      setLastRefresh(new Date());
    } catch {
      setOffenderData(demoOffender());
      setCellData(demoCell());
      setFromCache(false);
      setError('Live data unavailable — showing representative demo data');
      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  }, [dateId, offenderData]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!onHeaderMetaChange) return;
    onHeaderMetaChange({
      dateId,
      loading,
      fromCache,
      error,
      lastRefresh,
      refresh: () => void load(true),
    });
    return () => onHeaderMetaChange(null);
  }, [onHeaderMetaChange, dateId, loading, fromCache, error, lastRefresh, load]);

  const impactMax = useMemo(() => {
    if (!offenderData) return 1;
    const v = offenderData.impact_breakdown;
    return Math.max(v.dl_tput, v.ul_tput, v.data_drop, v.data_acc, v.vran_acc, v.vcdr_acc, v.voice_drop, v.ns_eso, v.quality, 0.0001);
  }, [offenderData]);

  const trendSparkValues = useMemo(
    () => offenderData?.trend.map((t) => t.total_offenders) ?? [],
    [offenderData]
  );
  const criticalSparkValues = useMemo(
    () => offenderData?.trend.map((t) => t.critical) ?? [],
    [offenderData]
  );

  const latestTrend   = offenderData?.trend.at(-1);
  const prevTrend     = offenderData?.trend.at(-2);
  const totalDelta    = latestTrend && prevTrend ? latestTrend.total_offenders - prevTrend.total_offenders : 0;
  const criticalDelta = latestTrend && prevTrend ? latestTrend.critical - prevTrend.critical : 0;

  const totalSites    = offenderData?.summary.total_sites    ?? 0;
  const totalOffenders = offenderData?.summary.total_offenders ?? 0;
  // "Rest" = sites not meeting high threshold (total sites - critical - high)
  const restCount = Math.max(0, totalSites - (offenderData?.summary.critical_count ?? 0) - (offenderData?.summary.high_count ?? 0));

  const donutSegments = offenderData
    ? [
        { value: offenderData.summary.critical_count, color: '#ef4444', label: 'Critical ≥0.005' },
        { value: offenderData.summary.high_count,     color: '#f59e0b', label: 'High ≥0.002' },
        { value: restCount,                           color: '#e2e8f0', label: 'Below threshold' },
      ]
    : [];

  return (
    <div className="flex flex-col gap-5 px-6 pb-8 pt-2">

      {/* ── KPI Hero row ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <HeroCard
            label="Total Offenders"
            value={totalOffenders.toLocaleString()}
            sub={`Avg impact ${fmtImpact(offenderData?.summary.avg_impact ?? 0)} · ${(offenderData?.summary.total_sites ?? 0).toLocaleString()} sites`}
            trend={totalDelta > 0 ? 'up' : totalDelta < 0 ? 'down' : 'flat'}
            delta={totalDelta !== 0 ? `${totalDelta > 0 ? '+' : ''}${totalDelta} DoD` : undefined}
            accentBg="#6366f1"
            accentText="#818cf8"
            icon={<Activity className="w-4 h-4" />}
            sparkValues={trendSparkValues}
            sparkColor="#818cf8"
          />
          <HeroCard
            label="Critical ≥ 0.005"
            value={(offenderData?.summary.critical_count ?? 0).toLocaleString()}
            sub="Severe market impact (WoW)"
            trend={criticalDelta > 0 ? 'up' : criticalDelta < 0 ? 'down' : 'flat'}
            delta={criticalDelta !== 0 ? `${criticalDelta > 0 ? '+' : ''}${criticalDelta} DoD` : undefined}
            accentBg="#ef4444"
            accentText="#f87171"
            icon={<AlertTriangle className="w-4 h-4" />}
            sparkValues={criticalSparkValues}
            sparkColor="#f87171"
          />
          <HeroCard
            label="High ≥ 0.002"
            value={(offenderData?.summary.high_count ?? 0).toLocaleString()}
            sub="Elevated performance risk (WoW)"
            accentBg="#f59e0b"
            accentText="#fbbf24"
            icon={<TrendingDown className="w-4 h-4" />}
            sparkValues={offenderData?.trend.map((t) => t.high_plus - t.critical) ?? []}
            sparkColor="#fbbf24"
          />
          <HeroCard
            label="PRB Hot Cells ≥ 90%"
            value={(cellData?.prb_hot_cells ?? 0).toLocaleString()}
            sub={`Avg PRB util ${fmt(cellData?.avg_prb_util ?? 0, 1)}%`}
            accentBg="#0891b2"
            accentText="#22d3ee"
            icon={<Signal className="w-4 h-4" />}
            sparkValues={[65, 68, 72, 71, 75, 79, 82, 80, 84, 87, cellData?.avg_prb_util ?? 72]}
            sparkColor="#22d3ee"
          />
        </div>
      )}

      {/* ── Row 2: Offender distribution + Impact Breakdown ─────────────── */}
      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">

        {/* Offender Tier Distribution */}
        {loading ? <Skeleton className="h-64" /> : (
          <Section
            title="Offender Tier Distribution"
            icon={<BarChart3 className="w-4 h-4" />}
            badge={
              <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-600 dark:border-indigo-500/25 dark:bg-indigo-500/12 dark:text-indigo-300">
                cqx_offenders_truth_table
              </span>
            }
          >
            <div className="flex items-center gap-6">
              <DonutChart segments={donutSegments} />
              <div className="flex-1 space-y-2.5">
                {offenderData && [
                  { label: 'Critical ≥ 0.005',  count: offenderData.summary.critical_count, color: '#ef4444' },
                  { label: 'High ≥ 0.002',       count: offenderData.summary.high_count,     color: '#f59e0b' },
                  { label: 'Below threshold',    count: restCount,                           color: '#94a3b8' },
                ].map((tier) => (
                  <div key={tier.label} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: tier.color }} />
                    <div className="flex-1 text-xs text-text-light-secondary dark:text-text-secondary">{tier.label}</div>
                    <div className="text-xs font-bold text-text-light-primary dark:text-text-primary">
                      {tier.count.toLocaleString()}
                    </div>
                    <div className="w-14 text-right text-[10px] text-text-light-muted dark:text-text-muted">
                      {pct(tier.count, totalSites).toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Threshold reference grid */}
            <div className="mt-4 grid grid-cols-3 gap-2">
              <ThresholdBadge threshold="≥ 0.005" count={offenderData?.summary.critical_count ?? 0} color="#ef4444" />
              <ThresholdBadge threshold="≥ 0.002" count={(offenderData?.summary.critical_count ?? 0) + (offenderData?.summary.high_count ?? 0)} color="#f59e0b" />
              <ThresholdBadge threshold="All sites" count={totalSites} color="#6366f1" />
            </div>
          </Section>
        )}

        {/* Impact Breakdown */}
        {loading ? <Skeleton className="h-64" /> : (
          <Section
            title="Impact Breakdown by Dimension"
            icon={<TrendingDown className="w-4 h-4" />}
            badge={
              <span className="rounded-full border border-border bg-cream-bg px-2 py-0.5 text-[10px] font-semibold text-text-muted dark:border-white/10 dark:bg-white/5 dark:text-white/50">
                Σ per dimension
              </span>
            }
          >
            <div className="space-y-2.5">
              {offenderData && [
                { label: 'Data Drop',  value: offenderData.impact_breakdown.data_drop,  color: '#ef4444' },
                { label: 'Data Acc',   value: offenderData.impact_breakdown.data_acc,   color: '#f59e0b' },
                { label: 'Voice Drop', value: offenderData.impact_breakdown.voice_drop, color: '#e879f9' },
                { label: 'Quality',    value: offenderData.impact_breakdown.quality,    color: '#8b5cf6' },
                { label: 'DL Tput',    value: offenderData.impact_breakdown.dl_tput,    color: '#0891b2' },
                { label: 'UL Tput',    value: offenderData.impact_breakdown.ul_tput,    color: '#06b6d4' },
                { label: 'VRAN Acc',   value: offenderData.impact_breakdown.vran_acc,   color: '#10b981' },
                { label: 'VCDR Acc',   value: offenderData.impact_breakdown.vcdr_acc,   color: '#34d399' },
                { label: 'NS ESO',     value: offenderData.impact_breakdown.ns_eso,     color: '#64748b' },
              ]
                .sort((a, b) => b.value - a.value)
                .map((item) => (
                  <ImpactBar key={item.label} {...item} max={impactMax} />
                ))}
            </div>
          </Section>
        )}
      </div>

      {/* ── Row 3: Cell Health Intelligence ─────────────────────────────── */}
      {loading ? <Skeleton className="h-52" /> : (
        <Section
          title="Cell Health Intelligence"
          icon={<Radio className="w-4 h-4" />}
          badge={
            <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-600 dark:border-teal-500/25 dark:bg-teal-500/12 dark:text-teal-300">
              hourly_intermediate_kpis_table
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            <CellHealthCard
              label="PRB Congested"
              count={cellData?.prb_hot_cells ?? 0}
              subtitle="DL PRB utilization ≥ 90%"
              severity={((cellData?.prb_hot_cells ?? 0) > 200) ? 'critical' : 'warning'}
              icon={<Signal className="w-4 h-4" />}
            />
            <CellHealthCard
              label="PDCCH Saturated"
              count={cellData?.pdcch_hot_cells ?? 0}
              subtitle="PDCCH utilization ≥ 90%"
              severity={((cellData?.pdcch_hot_cells ?? 0) > 100) ? 'critical' : 'warning'}
              icon={<Wifi className="w-4 h-4" />}
            />
            <CellHealthCard
              label="High Drop Rate"
              count={cellData?.high_drop_cells ?? 0}
              subtitle="ERAB drop anomalies"
              severity={((cellData?.high_drop_cells ?? 0) > 300) ? 'critical' : 'warning'}
              icon={<TrendingDown className="w-4 h-4" />}
            />
            <CellHealthCard
              label="Accessibility Issues"
              count={cellData?.low_acc_cells ?? 0}
              subtitle="Data / RRC access failures"
              severity={((cellData?.low_acc_cells ?? 0) > 200) ? 'warning' : 'info'}
              icon={<AlertTriangle className="w-4 h-4" />}
            />
            <CellHealthCard
              label="Throughput Degraded"
              count={cellData?.low_tput_cells ?? 0}
              subtitle="NR/LTE DL tput anomalies"
              severity="info"
              icon={<Zap className="w-4 h-4" />}
            />
          </div>
        </Section>
      )}

      {/* ── Row 4: 14-day trend + Top offenders table ────────────────────── */}
      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">

        {/* 14-day Offender Trend */}
        {loading ? <Skeleton className="h-72" /> : (
          <Section
            title="14-Day Offender Trend"
            icon={<TrendingUp className="w-4 h-4" />}
          >
            {offenderData && offenderData.trend.length > 0 ? (
              <div className="space-y-3">
                {/* Total trend sparkline */}
                <div className="rounded-[20px] border border-cream-border bg-cream-surface/40 p-4 dark:border-pulse-border dark:bg-pulse-surface-light/25">
                  <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-text-light-muted dark:text-text-muted">
                    <span>Total offenders</span>
                    <span className="text-cyan-500 dark:text-indigo-400">
                      {offenderData.trend.at(-1)?.total_offenders.toLocaleString()}
                    </span>
                  </div>
                  <Sparkline values={trendSparkValues} stroke="#818cf8" fill="#818cf8" height={52} />
                </div>
                {/* Critical + High+ trends side by side */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-[20px] border border-cream-border bg-cream-surface/40 p-3 dark:border-pulse-border dark:bg-pulse-surface-light/25">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-red-400">Critical ≥ 0.005</div>
                    <Sparkline values={offenderData.trend.map((t) => t.critical)} stroke="#f87171" fill="#f87171" height={40} />
                  </div>
                  <div className="rounded-[20px] border border-cream-border bg-cream-surface/40 p-3 dark:border-pulse-border dark:bg-pulse-surface-light/25">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-400">High+ ≥ 0.002</div>
                    <Sparkline values={offenderData.trend.map((t) => t.high_plus)} stroke="#fbbf24" fill="#fbbf24" height={40} />
                  </div>
                </div>
                {/* Date labels */}
                <div className="flex justify-between text-[9px] text-text-light-muted dark:text-text-muted px-1">
                  <span>{offenderData.trend.at(0)?.date_id?.slice(5)}</span>
                  <span>{offenderData.trend.at(-1)?.date_id?.slice(5)}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-40 text-sm text-text-light-muted dark:text-text-muted">
                No trend data available
              </div>
            )}
          </Section>
        )}

        {/* Top Offenders Table */}
        {loading ? <Skeleton className="h-72" /> : (
          <Section
            title="Top Offenders"
            icon={<AlertTriangle className="w-4 h-4" />}
            badge={
              <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-500 dark:border-red-500/25 dark:bg-red-500/12 dark:text-red-400">
                by TOTAL_IMPACT_LATEST
              </span>
            }
          >
            <div className="overflow-auto">
              <table className="w-full text-xs min-w-[480px]">
                <thead>
                  <tr className="border-b border-cream-border dark:border-pulse-border">
                    {['USID', 'Total Impact', 'WoW', 'Δ DoD', 'Data Drop', 'Data Acc', 'DL Tput'].map((h) => (
                      <th key={h} className="pb-2 text-left font-semibold text-[10px] uppercase tracking-[0.14em] text-text-light-muted dark:text-text-muted first:pl-0 px-2">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {offenderData?.top_offenders.map((row, i) => {
                    const isPos = row.impact_delta > 0;
                    const tier = row.total_impact >= 0.005 ? 'critical' : row.total_impact >= 0.002 ? 'high' : 'medium';
                    const tierColors = { critical: 'text-red-500', high: 'text-amber-500', medium: 'text-cyan-500' };
                    return (
                      <tr key={row.usid} className={`border-b border-cream-border/50 dark:border-pulse-border/50 hover:bg-slate-50/60 dark:hover:bg-white/3 transition-colors ${i === 0 ? 'bg-red-50/30 dark:bg-red-500/5' : ''}`}>
                        <td className="py-2.5 font-mono font-semibold text-text-light-primary dark:text-text-primary">
                          {row.usid}
                          <span className={`ml-1.5 text-[9px] font-bold ${tierColors[tier]}`}>●</span>
                        </td>
                        <td className="px-2 py-2.5 font-semibold text-text-light-primary dark:text-text-primary">
                          {fmtImpact(row.total_impact)}
                        </td>
                        <td className="px-2 py-2.5 text-text-light-secondary dark:text-text-secondary">
                          {fmtImpact(row.wow_impact)}
                        </td>
                        <td className={`px-2 py-2.5 font-semibold ${isPos ? 'text-red-500' : 'text-emerald-500'}`}>
                          {isPos ? '+' : ''}{fmtImpact(row.impact_delta)}
                        </td>
                        <td className="px-2 py-2.5 text-text-light-secondary dark:text-text-secondary">
                          {fmtImpact(row.data_drop_imp)}
                        </td>
                        <td className="px-2 py-2.5 text-text-light-secondary dark:text-text-secondary">
                          {fmtImpact(row.data_acc_imp)}
                        </td>
                        <td className="px-2 py-2.5 text-text-light-secondary dark:text-text-secondary">
                          {fmtImpact(row.dl_tput_imp)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </div>

      {/* ── Row 5: Top congested cells ───────────────────────────────────── */}
      {loading ? <Skeleton className="h-48" /> : (
        <Section
          title="Top PRB-Congested Cells"
          icon={<Signal className="w-4 h-4" />}
          badge={
            <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-600 dark:border-cyan-500/25 dark:bg-cyan-500/12 dark:text-cyan-300">
              AVG_DL_PRB_UTIL ≥ 85%
            </span>
          }
        >
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {(cellData?.top_congested_cells ?? []).slice(0, 8).map((cell, i) => {
              const w = Math.min(100, cell.avg_kpi_value);
              const color = w >= 95 ? '#ef4444' : w >= 90 ? '#f59e0b' : '#0891b2';
              return (
                <div key={cell.cell_name} className="rounded-[18px] border border-cream-border bg-white/85 p-3 dark:border-pulse-border dark:bg-pulse-surface/80 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-bold truncate text-text-light-primary dark:text-text-primary" title={cell.cell_name}>
                      {cell.cell_name}
                    </div>
                    <div className="text-xs font-bold shrink-0 ml-2" style={{ color }}>
                      {fmt(w, 1)}%
                    </div>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-cream-surface-light dark:bg-white/8 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${w}%`, background: color }}
                    />
                  </div>
                  <div className="text-[9px] text-text-light-muted dark:text-text-muted">
                    USID {cell.usid} · Rank #{i + 1}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

    </div>
  );
}
