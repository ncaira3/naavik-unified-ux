/**
 * ChatKpiDashboard — inline KPI dashboard rendered inside chat messages.
 * Uses the same chart engine (palette, options, ChartPanel) as Naavik Observe.
 */
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import {
  BarChart2, Clock, Calendar, RefreshCw, ChevronDown, ChevronUp,
  AlertCircle, Loader2, X, Check, Bookmark, BookmarkCheck,
  Plus, ChevronRight, Users, Search, Database,
} from 'lucide-react';
import api from '../../../services/api';
import { useTheme } from '../../../context/ThemeContext';
import { useSavedDashboards } from '../../../hooks/useSavedDashboards';
import type { CellKpiSeriesRow, CellKpiViewType } from '../../../types';

// ── Standard KPI groups (mirrors ObserveSiteAnalysisTile DEFAULT_KPIS) ────────

export const STANDARD_KPI_GROUPS: Array<{ group: string; kpis: Array<{ name: string; label: string; unit: string }> }> = [
  {
    group: 'Throughput',
    kpis: [
      { name: 'DL_TOTAL_DRB_THPUT', label: 'DL Throughput', unit: 'Mbps' },
      { name: 'UL_TPUT',            label: 'UL Throughput', unit: 'Mbps' },
      { name: 'DL_VOL_GB',          label: 'DL Volume',     unit: 'GB' },
      { name: 'UL_VOL_GB',          label: 'UL Volume',     unit: 'GB' },
    ],
  },
  {
    group: 'Accessibility',
    kpis: [
      { name: 'DATA_RAN_ACC',   label: 'Data Accessibility',   unit: '%' },
      { name: 'DATA_ERB_RET',   label: 'ERB Retention',        unit: '%' },
      { name: 'RRC_FAIL',       label: 'RRC Setup Fail',       unit: '%' },
      { name: 'DUAC_FAIL',      label: 'DUAC Fail Rate',       unit: '%' },
    ],
  },
  {
    group: 'Utilization',
    kpis: [
      { name: 'AVG_DL_PRB_UTIL',   label: 'DL PRB Util',  unit: '%' },
      { name: 'PDCCH_Utilization', label: 'PDCCH Util',   unit: '%' },
      { name: 'UL_RSSI',           label: 'UL RSSI',      unit: 'dBm' },
    ],
  },
  {
    group: 'Quality',
    kpis: [
      { name: 'DL_PKTLOSS_RT', label: 'DL Packet Loss', unit: '%' },
      { name: 'UL_PKTLOSS_RT', label: 'UL Packet Loss', unit: '%' },
    ],
  },
  {
    group: 'Availability',
    kpis: [
      { name: 'EUCELL_DOWNTIME_AUTO',   label: 'Auto Downtime',   unit: 'min' },
      { name: 'EUCELL_DOWNTIME_MANUAL', label: 'Manual Downtime', unit: 'min' },
      { name: 'PMUECTXTRELSCEUTRA',     label: 'UE Context Rel',  unit: '' },
    ],
  },
];

export const ALL_STANDARD_KPIS = STANDARD_KPI_GROUPS.flatMap((g) => g.kpis);

export const KPI_MAP: Record<string, { label: string; unit: string }> = Object.fromEntries(
  ALL_STANDARD_KPIS.map((k) => [k.name, { label: k.label, unit: k.unit }])
);

// ── Exact palette from ObserveSiteAnalysisTile ─────────────────────────────

const KPI_PALETTE = [
  '#6366f1', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4',
  '#f97316', '#3b82f6', '#ec4899', '#14b8a6', '#a855f7',
  '#84cc16', '#64748b', '#0ea5e9', '#22c55e', '#d946ef',
  '#2563eb', '#7c3aed', '#059669', '#fb923c', '#38bdf8',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDate(base: string, offsetDays: number): string {
  // Parse as local date (appending T00:00:00 avoids UTC midnight shift)
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + offsetDays);
  return localIso(d);
}

function formatDateLabel(value: string): string {
  const segs = String(value).slice(0, 10).split('-');
  if (segs.length < 3) return value;
  return `${parseInt(segs[1], 10)}/${parseInt(segs[2], 10)}`;
}

// ── Observe-identical chart option builder ────────────────────────────────────

function buildObserveBaseOption(theme: 'light' | 'dark'): EChartsOption {
  const isDark = theme === 'dark';
  const muted   = isDark ? '#8a8580' : '#6B6762';          // warm muted — 5:1 on light bg
  const grid    = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(45,42,38,0.09)';
  const text    = isDark ? '#F0EDE8' : '#2D2A26';           // warm primary — 13.6:1 on light
  const surface = isDark ? 'rgba(22,22,22,0.98)' : 'rgba(255,253,250,1)';
  const border  = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(45,42,38,0.10)';

  return {
    animation: true,
    animationDuration: 320,
    animationEasing: 'cubicOut',
    animationDurationUpdate: 420,
    animationEasingUpdate: 'cubicOut',
    backgroundColor: 'transparent',
    grid: { left: 60, right: 20, top: 60, bottom: 40, containLabel: false },
    tooltip: {
      trigger: 'axis',
      backgroundColor: surface,
      borderColor: border,
      padding: 0,
      formatter: (params: any) => {
        try {
          const arr = Array.isArray(params) ? params : [params];
          const label = arr[0]?.name ?? '';
          const rows = arr
            .filter((p: any) => p.value != null)
            .map((p: any) => {
              const raw = typeof p.value === 'number' ? p.value : parseFloat(p.value);
              const formatted = isNaN(raw) ? String(p.value)
                : Math.abs(raw) >= 1000
                  ? raw.toLocaleString(undefined, { maximumFractionDigits: 2 })
                  : Number(raw.toPrecision(4)).toString();
              return `<div style="display:flex;align-items:center;gap:8px;font-size:11px;color:${text}">
                <span style="width:9px;height:9px;border-radius:50%;background:${p.color};flex-shrink:0"></span>
                <span style="flex:1">${p.seriesName}</span>
                <span style="font-weight:700;margin-left:8px">${formatted}</span>
              </div>`;
            }).join('');
          return `<div style="padding:8px 12px">
            <div style="font-size:11px;color:${muted};margin-bottom:5px;font-weight:600">${label}</div>
            ${rows}
          </div>`;
        } catch { return ''; }
      },
    },
    legend: {
      top: 10, type: 'scroll',
      textStyle: { color: muted, fontSize: 11 },
      itemWidth: 14, itemHeight: 7,
      pageIconColor: muted,
    },
    xAxis: {
      type: 'category',
      axisLine: { lineStyle: { color: grid } },
      axisLabel: { color: muted, fontSize: 11, rotate: 45, hideOverlap: true },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value', scale: true,
      axisLabel: { color: muted, fontSize: 11 },
      splitLine: { lineStyle: { color: grid, type: 'dashed' } },
      axisTick: { show: false },
    },
    textStyle: { color: text, fontFamily: 'inherit' },
  };
}

function buildKpiOption(
  rows: CellKpiSeriesRow[],
  kpiName: string,
  kpiIndex: number,
  timeframe: 'daily' | 'hourly',
  theme: 'light' | 'dark',
  unit: string,
): EChartsOption {
  const base = buildObserveBaseOption(theme);
  const isDark = theme === 'dark';
  const muted = isDark ? '#8e8e93' : '#64748b';
  const isHourly = timeframe === 'hourly';

  // Build label → cellName → value map (mirrors Observe's buildKpiPointMap)
  const kpiRows = rows.filter((r) => r.kpiName === kpiName);
  const labelFn = (r: CellKpiSeriesRow) =>
    isHourly ? `${r.dateId} ${String(r.hourId ?? 0).padStart(2, '0')}:00` : r.dateId;

  const labels = Array.from(new Set(kpiRows.map(labelFn))).sort();
  const traces = Array.from(new Set(kpiRows.map((r) => r.cellName || 'Site'))).slice(0, 8);

  const valMap: Record<string, Record<string, number | null>> = {};
  for (const r of kpiRows) {
    const lbl = labelFn(r);
    const trace = r.cellName || 'Site';
    if (!valMap[trace]) valMap[trace] = {};
    const vals = valMap[trace][lbl];
    const v = r.kpiValue != null ? Number(r.kpiValue) : null;
    valMap[trace][lbl] = vals != null && v != null ? (vals + v) / 2 : (v ?? vals ?? null);
  }

  const color = (i: number) => KPI_PALETTE[(i + kpiIndex) % KPI_PALETTE.length];

  const xAxisOverride = isHourly ? {
    axisLabel: {
      color: muted, fontSize: 10, rotate: 40, interval: 0, hideOverlap: false,
      formatter: (value: string) => {
        const spaceIdx = value.indexOf(' ');
        if (spaceIdx === -1) return value;
        const datePart = value.slice(0, spaceIdx);
        const timePart = value.slice(spaceIdx + 1);
        const segs = datePart.split('-');
        const mm = parseInt(segs[1] || '0', 10);
        const dd = parseInt(segs[2] || '0', 10);
        const hour = parseInt(timePart.slice(0, 2), 10);
        if (hour % 6 !== 0) return '';
        return hour === 0 ? `${mm}/${dd}` : `${mm}/${dd} ${String(hour).padStart(2, '0')}h`;
      },
    },
  } : {
    axisLabel: { color: muted, fontSize: 11, rotate: 30, hideOverlap: true, formatter: formatDateLabel },
  };

  const yAxisOverride = unit ? {
    axisLabel: {
      color: muted, fontSize: 11,
      formatter: (v: number) => {
        if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
        return `${v}`;
      },
    },
  } : {};

  return {
    ...base,
    grid: { left: 52, right: 24, top: 36, bottom: isHourly ? 56 : 44 },
    xAxis: { ...(base.xAxis as object), data: labels, ...xAxisOverride },
    yAxis: { ...(base.yAxis as object), ...yAxisOverride },
    series: traces.map((trace, i) => ({
      name: trace,
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 5,
      showSymbol: false,
      lineStyle: { width: 2, color: color(i) },
      itemStyle: { color: color(i) },
      emphasis: { focus: 'series', lineStyle: { width: 3 } },
      data: labels.map((lbl) => valMap[trace]?.[lbl] ?? null),
      connectNulls: false,
    })),
  } as EChartsOption;
}

// ── ChartPanel — exact Observe implementation ─────────────────────────────────

function ChartPanel({
  title, option, height = 320, unit, loading = false, error,
}: {
  title: string; option: EChartsOption; height?: number;
  unit?: string; loading?: boolean; error?: string | null;
}) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const chartRef = useRef<ReactECharts | null>(null);
  const isolatedRef = useRef<string | null>(null);
  const lastClickRef = useRef<{ name: string; ts: number } | null>(null);

  const hasSeries = useMemo(() => {
    const s: any = (option as any)?.series;
    return Array.isArray(s) ? s.length > 0 : Boolean(s);
  }, [option]);

  const getInst = useCallback(() =>
    (chartRef.current as any)?.getEchartsInstance?.() ?? null, []);

  const handleLegendSelectChanged = useCallback((params: any) => {
    const chart = getInst();
    if (!chart) return;
    const { name } = params;
    const now = Date.now();
    const last = lastClickRef.current;
    const isDouble = last && last.name === name && now - last.ts < 400;
    lastClickRef.current = { name, ts: now };
    if (!isDouble) return;
    const allNames = ((chart.getOption() as any)?.series || []).map((s: any) => s.name).filter(Boolean);
    if (isolatedRef.current === name) {
      isolatedRef.current = null;
      allNames.forEach((n: string) => chart.dispatchAction({ type: 'legendSelect', name: n }));
    } else {
      isolatedRef.current = name;
      allNames.forEach((n: string) =>
        chart.dispatchAction({ type: n === name ? 'legendSelect' : 'legendUnSelect', name: n })
      );
    }
  }, [getInst]);

  useEffect(() => { isolatedRef.current = null; }, [option]);

  // Design tokens scoped to ChartPanel
  const cpTextPrimary = isDark ? '#F0EDE8' : '#2D2A26';
  const cpMuted       = isDark ? '#7A7570' : '#6B6762';
  const cpCardBg      = isDark ? 'rgba(22,22,22,0.94)' : 'rgba(255,253,250,0.97)';
  const cpCardBorder  = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(45,42,38,0.10)';
  const cpHeaderBg    = isDark ? 'rgba(255,255,255,0.025)' : 'rgba(45,42,38,0.025)';
  const cpHeaderBorder = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(45,42,38,0.07)';
  const cpUnitBg      = isDark ? 'rgba(99,102,241,0.16)' : 'rgba(99,102,241,0.09)';
  const cpUnitBorder  = isDark ? 'rgba(99,102,241,0.30)' : 'rgba(99,102,241,0.20)';
  const cpUnitColor   = isDark ? '#a5b4fc' : '#3730a3';   // indigo-800 light = 7.2:1 on white
  const cpErrorColor  = isDark ? '#f87171' : '#b91c1c';

  return (
    <div className="overflow-hidden rounded-2xl border"
      style={{
        background: cpCardBg,
        borderColor: cpCardBorder,
        boxShadow: isDark
          ? '0 4px 16px rgba(0,0,0,0.45), 0 1px 3px rgba(0,0,0,0.30)'
          : '0 2px 10px rgba(45,42,38,0.07), 0 1px 3px rgba(45,42,38,0.04)',
      }}>

      {/* ── Card header ── */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b"
        style={{ background: cpHeaderBg, borderColor: cpHeaderBorder }}>
        <h4 className="text-[13px] font-semibold tracking-[-0.01em]"
          style={{ color: cpTextPrimary }}>{title}</h4>
        <div className="flex items-center gap-2">
          {unit && (
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full border"
              style={{ background: cpUnitBg, borderColor: cpUnitBorder, color: cpUnitColor }}>
              {unit}
            </span>
          )}
          {loading && hasSeries && (
            <div className="flex items-center gap-1.5 text-[11px]" style={{ color: cpMuted }}>
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <span>Syncing…</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Chart area ── */}
      <div style={{ height }} className="relative">
        {loading && !hasSeries ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <svg className="h-5 w-5 animate-spin" style={{ color: cpMuted }} viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span className="text-[12px]" style={{ color: cpMuted }}>Loading {title}…</span>
          </div>
        ) : error && !hasSeries ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <AlertCircle className="w-5 h-5" style={{ color: cpErrorColor }} />
            <span className="text-[12px]" style={{ color: cpErrorColor, opacity: 0.85 }}>{error}</span>
          </div>
        ) : !hasSeries ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <svg className="h-8 w-8" style={{ color: cpMuted, opacity: 0.45 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <span className="text-[12px]" style={{ color: cpMuted }}>No data for this period</span>
          </div>
        ) : (
          <>
            {loading && (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden">
                <div className="h-full w-1/2 animate-pulse"
                  style={{ background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.65), transparent)', marginLeft: '25%' }} />
              </div>
            )}
            <ReactECharts
              ref={chartRef}
              option={option}
              style={{ height: '100%' }}
              opts={{ renderer: 'canvas' }}
              notMerge={false}
              lazyUpdate
              onEvents={{ legendselectchanged: handleLegendSelectChanged }}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ChatKpiDashboardProps {
  siteId: string;
  /** Optional — defaults to yesterday if omitted */
  endDate?: string;
  kpiNames?: string[];
  timeframe: 'daily' | 'hourly';
  daysBack?: number;
  /** If provided, this is a saved dashboard with multiple possible USIDs */
  availableSiteIds?: string[];
  /**
   * When set, only the first N KPI groups render initially; an "Expand to show
   * all KPIs" bar appears below them. Click to reveal the rest. Useful inside
   * embedded contexts (e.g. the Analyzer) where vertical space is precious.
   */
  collapseAfterGroups?: number;
}

function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localIso(d);
}

// ── Save Dashboard Modal ──────────────────────────────────────────────────────

interface SaveDashboardModalProps {
  initial: { siteId: string; endDate: string; kpiNames: string[]; timeframe: 'daily' | 'hourly'; daysBack: number };
  onSave: (config: { name: string; siteIds: string[]; kpiNames: string[]; timeframe: 'daily' | 'hourly'; daysBack: number; endDate: string }) => void;
  onCancel: () => void;
  isDark: boolean;
}

function SaveDashboardModal({ initial, onSave, onCancel, isDark }: SaveDashboardModalProps) {
  const [name, setName]           = useState(`KPI Dashboard — ${initial.siteId}`);
  const [siteInput, setSiteInput] = useState('');
  const [siteIds, setSiteIds]     = useState<string[]>([initial.siteId]);
  const [kpiNames, setKpiNames]   = useState<string[]>(initial.kpiNames);
  const [timeframe, setTimeframe] = useState<'daily' | 'hourly'>(initial.timeframe);
  const [daysBack, setDaysBack]   = useState(initial.daysBack);
  const [endDate, setEndDate]     = useState(initial.endDate);
  const [showKpiPicker, setShowKpiPicker] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const border   = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.09)';
  const surface  = isDark ? '#1a1a1e' : '#ffffff';
  const text     = isDark ? '#e2e8f0' : '#0f172a';
  const muted    = isDark ? '#64748b' : '#94a3b8';
  const inputBg  = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.03)';

  const addSite = () => {
    const s = siteInput.trim().replace(/^UST0*/i, '');
    if (s && !siteIds.includes(s)) setSiteIds((p) => [...p, s]);
    setSiteInput('');
  };

  const toggleKpi = (n: string) =>
    setKpiNames((p) => p.includes(n) ? p.filter((k) => k !== n) : [...p, n]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.60)', backdropFilter: 'blur(6px)' }}>
      <div className="w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden" style={{ background: surface, border: `1px solid ${border}` }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: border }}>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/20 flex items-center justify-center">
              <Bookmark className="w-4 h-4 text-cyan-400" />
            </div>
            <span className="text-sm font-semibold" style={{ color: text }}>Save Dashboard</span>
          </div>
          <button onClick={onCancel} className="rounded-lg p-1 hover:bg-white/10 transition-colors">
            <X className="w-4 h-4" style={{ color: muted }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Name */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: muted }}>Dashboard Name</label>
            <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Daily KPI Watch — Site 9817"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none border transition-colors"
              style={{ background: inputBg, borderColor: border, color: text }} />
          </div>

          {/* Sites */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: muted }}>USIDs / Sites</label>
            <p className="text-[11px] mb-2" style={{ color: muted }}>Add multiple USIDs — you can switch between them inside the dashboard.</p>
            <div className="flex gap-2 mb-2">
              <input value={siteInput} onChange={(e) => setSiteInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSite(); } }}
                placeholder="Add USID (e.g. 9817)…"
                className="flex-1 rounded-lg px-3 py-2 text-sm outline-none border"
                style={{ background: inputBg, borderColor: border, color: text }} />
              <button onClick={addSite} disabled={!siteInput.trim()}
                className="px-3 py-2 rounded-lg bg-cyan-500 hover:bg-indigo-400 text-white transition-colors disabled:opacity-40">
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {siteIds.map((id) => (
                <span key={id} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-medium border"
                  style={{ borderColor: 'rgba(99,102,241,0.40)', background: 'rgba(99,102,241,0.12)', color: isDark ? '#a5b4fc' : '#4f46e5' }}>
                  {id}
                  <button onClick={() => setSiteIds((p) => p.filter((s) => s !== id))} className="ml-0.5 opacity-60 hover:opacity-100">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Timeframe + Days */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: muted }}>Timeframe</label>
              <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: border }}>
                {(['daily', 'hourly'] as const).map((tf) => (
                  <button key={tf} onClick={() => setTimeframe(tf)}
                    className="flex-1 flex items-center justify-center gap-1 py-2 text-[12px] font-semibold transition-colors"
                    style={{ background: timeframe === tf ? 'rgba(99,102,241,0.20)' : 'transparent', color: timeframe === tf ? '#818cf8' : muted }}>
                    {tf === 'daily' ? <Calendar className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                    {tf === 'daily' ? 'Daily' : 'Hourly'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: muted }}>
                {timeframe === 'daily' ? 'Days Back' : 'Hours Back'}
              </label>
              <div className="relative">
                <select value={daysBack} onChange={(e) => setDaysBack(Number(e.target.value))}
                  className="appearance-none w-full text-sm pl-3 pr-7 py-2 rounded-lg border outline-none"
                  style={{ background: inputBg, borderColor: border, color: text }}>
                  {(timeframe === 'daily' ? [7, 14, 30, 60, 90] : [24, 48]).map((d) => (
                    <option key={d} value={d}>{d}{timeframe === 'daily' ? 'd' : 'h'}</option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: muted }} />
              </div>
            </div>
          </div>

          {/* End date */}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: muted }}>Anchor End Date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none border transition-colors"
              style={{ background: inputBg, borderColor: border, color: text }} />
          </div>

          {/* KPI selection */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: muted }}>KPIs</label>
              <button onClick={() => setShowKpiPicker((p) => !p)}
                className="flex items-center gap-1 text-[11px] font-semibold hover:opacity-80"
                style={{ color: '#818cf8' }}>
                {showKpiPicker ? 'Hide' : 'Customise'}
                <ChevronRight className={`w-3 h-3 transition-transform ${showKpiPicker ? 'rotate-90' : ''}`} />
              </button>
            </div>
            {!showKpiPicker && (
              <p className="text-sm" style={{ color: muted }}>
                {kpiNames.length === 0 ? 'All standard KPIs' : `${kpiNames.length} KPI${kpiNames.length !== 1 ? 's' : ''} selected`}
              </p>
            )}
            {showKpiPicker && (
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: border }}>
                <div className="flex gap-2 px-3 py-2 border-b" style={{ borderColor: border }}>
                  <button onClick={() => setKpiNames(ALL_STANDARD_KPIS.map((k) => k.name))} className="text-[11px] font-semibold px-2.5 py-1 rounded-md border hover:opacity-80" style={{ borderColor: border, color: muted }}>All</button>
                  <button onClick={() => setKpiNames([])} className="text-[11px] font-semibold px-2.5 py-1 rounded-md border hover:opacity-80" style={{ borderColor: border, color: muted }}>None</button>
                </div>
                <div className="max-h-48 overflow-y-auto p-2 space-y-3">
                  {STANDARD_KPI_GROUPS.map((g) => (
                    <div key={g.group}>
                      <div className="text-[10px] font-bold uppercase tracking-widest px-1 mb-1" style={{ color: muted }}>{g.group}</div>
                      <div className="grid grid-cols-2 gap-1">
                        {g.kpis.map((k) => {
                          const active = kpiNames.includes(k.name);
                          return (
                            <button key={k.name} onClick={() => toggleKpi(k.name)}
                              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-left text-[11px] font-medium border transition-colors"
                              style={{ background: active ? 'rgba(99,102,241,0.15)' : 'transparent', borderColor: active ? 'rgba(99,102,241,0.45)' : border, color: active ? '#a5b4fc' : muted }}>
                              <span className="w-3 h-3 rounded flex items-center justify-center flex-shrink-0 border" style={{ background: active ? '#6366f1' : 'transparent', borderColor: active ? '#818cf8' : border }}>
                                {active && <Check className="w-2 h-2 text-white" />}
                              </span>
                              <span className="truncate">{k.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 px-5 py-4 border-t" style={{ borderColor: border }}>
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border hover:opacity-80" style={{ borderColor: border, color: muted }}>Cancel</button>
          <button onClick={() => onSave({ name: name.trim() || `Dashboard — ${siteIds[0]}`, siteIds, kpiNames, timeframe, daysBack, endDate })}
            disabled={siteIds.length === 0}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-cyan-500 hover:bg-indigo-400 text-white transition-colors disabled:opacity-40">
            Save Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

// ── KPI selector overlay ──────────────────────────────────────────────────────

// Cache the DB catalog at module scope so reopening the picker doesn't refetch.
let CATALOG_CACHE: string[] | null = null;
async function loadKpiCatalog(): Promise<string[]> {
  if (CATALOG_CACHE) return CATALOG_CACHE;
  try {
    const resp = await api.get<{ success: boolean; data: { names: string[] } }>('/kpis/catalog');
    const names = resp?.data?.names ?? [];
    CATALOG_CACHE = names;
    return names;
  } catch {
    return [];
  }
}

function KpiSelector({ selected, onApply, onCancel, isDark }: {
  selected: string[];
  onApply: (kpis: string[]) => void;
  onCancel: () => void;
  isDark: boolean;
}) {
  const [local, setLocal] = useState<string[]>(selected);
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<string[]>(CATALOG_CACHE ?? []);
  const [catalogLoading, setCatalogLoading] = useState(!CATALOG_CACHE);
  const toggle = (name: string) =>
    setLocal((prev) => (prev.includes(name) ? prev.filter((k) => k !== name) : [...prev, name]));

  useEffect(() => {
    let cancelled = false;
    if (!CATALOG_CACHE) {
      setCatalogLoading(true);
      loadKpiCatalog().then((names) => {
        if (cancelled) return;
        setCatalog(names);
        setCatalogLoading(false);
      });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Filter / search logic ────────────────────────────────────────────────
  // Standard groups are kept intact when there's no search. When the user
  // searches, we filter standard + DB catalog into a single ranked list.
  const standardNameSet = useMemo(
    () => new Set(ALL_STANDARD_KPIS.map((k) => k.name)),
    [],
  );
  const customCatalog = useMemo(
    () => catalog.filter((n) => !standardNameSet.has(n)),
    [catalog, standardNameSet],
  );

  const trimmedQuery = query.trim().toUpperCase();
  const searchResults = useMemo(() => {
    if (!trimmedQuery) return [] as { name: string; label: string; group: 'standard' | 'custom' }[];
    const matches: { name: string; label: string; group: 'standard' | 'custom' }[] = [];
    for (const k of ALL_STANDARD_KPIS) {
      if (
        k.name.toUpperCase().includes(trimmedQuery) ||
        k.label.toUpperCase().includes(trimmedQuery)
      ) {
        matches.push({ name: k.name, label: k.label, group: 'standard' });
      }
    }
    for (const name of customCatalog) {
      if (name.toUpperCase().includes(trimmedQuery)) {
        matches.push({ name, label: name.replace(/_/g, ' '), group: 'custom' });
      }
    }
    return matches.slice(0, 80);
  }, [trimmedQuery, customCatalog]);

  const sTextPrimary   = isDark ? '#F0EDE8' : '#2D2A26';
  const sTextSecondary = isDark ? '#B8B3AB' : '#4A4641';
  const sMuted         = isDark ? '#7A7570' : '#6B6762';
  const sBg            = isDark ? 'rgba(14,14,14,0.96)' : 'rgba(250,248,245,0.98)';
  const sBorder        = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(45,42,38,0.12)';
  const sItemBg        = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(45,42,38,0.03)';
  const sItemBorder    = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(45,42,38,0.10)';
  const sAccent        = isDark ? '#818cf8' : '#3730a3';
  const sAccentActive  = isDark ? '#a5b4fc' : '#3730a3';
  const sCheckBg       = isDark ? '#6366f1' : '#4338ca';
  const sInputBg       = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(45,42,38,0.04)';

  const renderTile = (name: string, label: string, isCustom: boolean) => {
    const active = local.includes(name);
    return (
      <button
        key={name}
        onClick={() => toggle(name)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs font-medium border transition-colors cursor-pointer"
        style={{
          background: active
            ? isDark ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.10)'
            : sItemBg,
          borderColor: active
            ? isDark ? 'rgba(99,102,241,0.45)' : 'rgba(99,102,241,0.35)'
            : sItemBorder,
          color: active ? sAccentActive : sTextSecondary,
        }}
        title={name}
      >
        <span
          className="w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0 border transition-colors"
          style={{
            background: active ? sCheckBg : 'transparent',
            borderColor: active ? sCheckBg : sMuted,
          }}
        >
          {active && <Check className="w-2.5 h-2.5 text-white" />}
        </span>
        <span className="truncate flex-1">{label}</span>
        {isCustom && (
          <Database className="w-2.5 h-2.5 flex-shrink-0 opacity-50" />
        )}
      </button>
    );
  };

  return (
    <div className="absolute inset-0 z-30 rounded-2xl flex flex-col overflow-hidden"
      style={{ background: sBg, backdropFilter: 'blur(8px)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: sBorder }}>
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold" style={{ color: sTextPrimary }}>
            Select KPIs to plot
          </span>
          <span className="text-[10.5px] mt-0.5" style={{ color: sMuted }}>
            {catalogLoading
              ? 'Loading catalog…'
              : `${ALL_STANDARD_KPIS.length} standard · ${customCatalog.length} more from the database`}
          </span>
        </div>
        <button onClick={onCancel} className="hover:opacity-70 transition-opacity" style={{ color: sMuted }}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search bar */}
      <div className="px-4 pt-3" >
        <div
          className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
          style={{ borderColor: sBorder, background: sInputBg }}
        >
          <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: sMuted }} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search standard or DB KPIs (e.g. DL_DRB_TPUT, drop, accessibility)…"
            className="flex-1 bg-transparent text-[12px] outline-none"
            style={{ color: sTextPrimary }}
          />
          {query ? (
            <button onClick={() => setQuery('')} className="opacity-70 hover:opacity-100" style={{ color: sMuted }} title="Clear">
              <X className="w-3 h-3" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {trimmedQuery ? (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] mb-2 flex items-center gap-1.5"
              style={{ color: sTextSecondary }}
            >
              <span>Results</span>
              <span style={{ color: sMuted }}>· {searchResults.length}</span>
            </div>
            {searchResults.length === 0 ? (
              <p className="text-[12px]" style={{ color: sMuted }}>
                No KPIs match &ldquo;{query}&rdquo;.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {searchResults.map((r) => renderTile(r.name, r.label, r.group === 'custom'))}
              </div>
            )}
          </div>
        ) : (
          <>
            {STANDARD_KPI_GROUPS.map((g) => (
              <div key={g.group}>
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] mb-2"
                  style={{ color: sTextSecondary }}>{g.group}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {g.kpis.map((k) => renderTile(k.name, k.label, false))}
                </div>
              </div>
            ))}
            {customCatalog.length > 0 && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.12em] mb-2 flex items-center gap-1.5"
                  style={{ color: sTextSecondary }}
                >
                  <Database className="w-3 h-3" />
                  <span>From the database</span>
                  <span style={{ color: sMuted }}>· {customCatalog.length}</span>
                </div>
                <p className="text-[10.5px] mb-2" style={{ color: sMuted }}>
                  Type in the search box above to find any of the live KPI names from the DB.
                </p>
                {/* Always-selected custom KPIs surface here so users can untick them. */}
                <div className="grid grid-cols-2 gap-1.5">
                  {customCatalog
                    .filter((n) => local.includes(n))
                    .map((n) => renderTile(n, n.replace(/_/g, ' '), true))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="flex gap-2 px-4 py-3 border-t" style={{ borderColor: sBorder }}>
        <button onClick={onCancel}
          className="flex-1 py-2 text-sm rounded-xl border font-medium hover:opacity-75 transition-opacity cursor-pointer"
          style={{ borderColor: sBorder, color: sMuted }}>
          Cancel
        </button>
        <button onClick={() => onApply(local)} disabled={local.length === 0}
          className="flex-1 py-2 text-sm rounded-xl font-semibold text-white transition-opacity disabled:opacity-40 cursor-pointer"
          style={{ background: sAccent }}>
          Plot {local.length} KPI{local.length !== 1 ? 's' : ''}
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

// Per-timeframe defaults when the caller doesn't pass an explicit daysBack.
// Daily: 30 days of data; Hourly: 48 hours.
const DEFAULT_DAILY_DAYS = 30;
const DEFAULT_HOURLY_HOURS = 48;
const DAILY_OPTIONS = [7, 14, 30, 60, 90];
const HOURLY_OPTIONS = [24, 48, 72];
const defaultDaysBackFor = (tf: 'daily' | 'hourly') =>
  tf === 'hourly' ? DEFAULT_HOURLY_HOURS : DEFAULT_DAILY_DAYS;

/**
 * Snap an incoming daysBack to a valid picker option for the given timeframe.
 * Without this, an unmatched value (e.g. a legacy `21` from saved dashboards
 * or chat-intent fallbacks) leaves the <select> showing the first option (7d
 * for daily / 24h for hourly) — confusing for users since the displayed value
 * doesn't match the underlying state.
 */
const snapDaysBack = (value: number, tf: 'daily' | 'hourly'): number => {
  const opts = tf === 'hourly' ? HOURLY_OPTIONS : DAILY_OPTIONS;
  if (opts.includes(value)) return value;
  // Pick the closest valid option (ties → larger window).
  return opts.reduce((best, opt) =>
    Math.abs(opt - value) < Math.abs(best - value) ? opt : best,
    opts[0]);
};

export default function ChatKpiDashboard({
  siteId: initialSiteId,
  endDate: endDateProp,
  kpiNames: initialKpiNames,
  timeframe: initialTimeframe,
  daysBack: initialDaysBack,
  availableSiteIds,
  collapseAfterGroups,
}: ChatKpiDashboardProps) {
  const endDate = endDateProp || yesterdayISO();
  // Collapsible mode: only the first N groups render until user expands.
  const [groupsExpanded, setGroupsExpanded] = useState(false);
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { saveDashboard } = useSavedDashboards();

  // Active site can be switched via USID input
  const [activeSiteId, setActiveSiteId] = useState(initialSiteId);
  const [usidInput, setUsidInput] = useState(initialSiteId);
  const [timeframe, setTimeframe] = useState<'daily' | 'hourly'>(initialTimeframe);
  // daysBack defaults are timeframe-aware: 30 for daily, 48 for hourly.
  // Caller can still override via initialDaysBack — but we snap that value to
  // the nearest valid picker option so the <select> always reflects state.
  const [daysBack, setDaysBack] = useState<number>(
    snapDaysBack(initialDaysBack ?? defaultDaysBackFor(initialTimeframe), initialTimeframe),
  );

  // Keep usidInput in sync if activeSiteId changes externally
  useEffect(() => { setUsidInput(activeSiteId); }, [activeSiteId]);
  const [activeKpis, setActiveKpis] = useState<string[]>(
    initialKpiNames?.length ? initialKpiNames : ALL_STANDARD_KPIS.map((k) => k.name)
  );
  const [rows, setRows] = useState<CellKpiSeriesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [savedConfirm, setSavedConfirm] = useState(false);

  // Design tokens — warm glassmorphism, WCAG-safe contrast
  const textPrimary   = isDark ? '#F0EDE8' : '#2D2A26';    // 13.6:1 on bg
  const textSecondary = isDark ? '#B8B3AB' : '#4A4641';    // 8.2:1 on bg
  const muted         = isDark ? '#7A7570' : '#6B6762';    // 5.0:1 on bg — min for UI labels
  const surfaceBg     = isDark ? 'rgba(12,12,12,0.97)' : 'rgba(250,248,245,0.99)';
  const borderColor   = isDark ? 'rgba(255,255,255,0.09)' : 'rgba(45,42,38,0.10)';
  const borderMed     = isDark ? 'rgba(255,255,255,0.13)' : 'rgba(45,42,38,0.16)';
  const surface2      = isDark ? 'rgba(26,26,26,0.80)' : '#F5F1ED';
  const accent        = isDark ? '#818cf8' : '#3730a3';    // indigo: 7.2:1 light / 8.1:1 dark
  const accentBg      = isDark ? 'rgba(99,102,241,0.14)' : 'rgba(99,102,241,0.08)';
  const accentBorder  = isDark ? 'rgba(99,102,241,0.32)' : 'rgba(99,102,241,0.22)';
  const accentActive  = isDark ? '#a5b4fc' : '#3730a3';

  const fetchData = useCallback(async (siteId: string, kpis: string[], tf: CellKpiViewType, db: number) => {
    if (!kpis.length) return;
    setLoading(true);
    setError(null);
    try {
      const startDate = shiftDate(endDate, tf === 'hourly' ? -Math.max(1, Math.ceil(db / 24)) : -db);
      const resp = await api.getSiteCellKpis(siteId, {
        kpiNames: kpis, viewType: tf,
        startDate, endDate, dateId: endDate,
      });
      setRows(resp?.data?.data ?? []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load KPI data');
    } finally {
      setLoading(false);
    }
  }, [endDate]);

  useEffect(() => {
    fetchData(activeSiteId, activeKpis, timeframe as CellKpiViewType, daysBack);
  }, [fetchData, activeSiteId, activeKpis, timeframe, daysBack]);

  const standardKpiSet = useMemo(() => new Set(ALL_STANDARD_KPIS.map((k) => k.name)), []);
  const shownGroups = useMemo(() => {
    const standard = STANDARD_KPI_GROUPS
      .map((g) => ({ ...g, kpis: g.kpis.filter((k) => activeKpis.includes(k.name)) }))
      .filter((g) => g.kpis.length > 0);
    const custom = activeKpis
      .filter((n) => !standardKpiSet.has(n))
      .map((name) => ({ name, label: name.replace(/_/g, ' '), unit: '' }));
    return custom.length > 0 ? [...standard, { group: 'Custom', kpis: custom }] : standard;
  }, [activeKpis, standardKpiSet]);

  // All known site IDs (initial + any from availableSiteIds prop)
  const allSiteIds = useMemo(() => {
    const ids = [initialSiteId, ...(availableSiteIds ?? [])].filter(Boolean);
    return Array.from(new Set(ids));
  }, [initialSiteId, availableSiteIds]);

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border"
      style={{
        background: surfaceBg,
        borderColor,
        boxShadow: isDark
          ? '0 8px 32px rgba(0,0,0,0.55), 0 1px 4px rgba(0,0,0,0.35)'
          : '0 4px 20px rgba(45,42,38,0.08), 0 1px 4px rgba(45,42,38,0.05)',
      }}>

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b flex-wrap"
        style={{ borderColor, background: isDark ? 'rgba(255,255,255,0.025)' : 'rgba(45,42,38,0.02)' }}>

        {/* Left: icon + title */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: accentBg, border: `1px solid ${accentBorder}` }}>
            <BarChart2 className="w-4 h-4" style={{ color: accent }} />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold tracking-[-0.01em] truncate"
              style={{ color: textPrimary }}>
              KPI Dashboard — {activeSiteId}
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: muted }}>
              {timeframe === 'hourly' ? `Last ${daysBack}h` : `Last ${daysBack} days`} · ending {endDate}
            </div>
          </div>
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-2 flex-wrap flex-shrink-0">

          {/* USID input */}
          <div className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition-colors"
            style={{ borderColor: accentBorder, background: accentBg }}>
            <Users className="w-3 h-3 flex-shrink-0" style={{ color: accent }} />
            <input
              value={usidInput}
              onChange={(e) => setUsidInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = e.currentTarget.value.trim();
                  if (v) setActiveSiteId(v);
                }
              }}
              className="w-16 bg-transparent text-[11px] font-semibold outline-none"
              style={{ color: accentActive }}
              placeholder="USID…"
              title="Type a USID and press Enter to reload"
            />
            {usidInput.trim() !== activeSiteId && usidInput.trim() !== '' && (
              <button
                onClick={() => setActiveSiteId(usidInput.trim())}
                className="flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold transition-colors hover:opacity-80"
                style={{ background: accent, color: '#fff' }}
                title="Apply USID">
                Go
              </button>
            )}
          </div>

          {/* Timeframe toggle */}
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: borderMed }}>
            {(['daily', 'hourly'] as const).map((tf) => {
              const isActive = timeframe === tf;
              return (
                <button key={tf} onClick={() => {
                  setTimeframe(tf);
                  // Snap to the nearest valid option for the new mode so the
                  // <select> always shows a value that matches its options.
                  const opts = tf === 'hourly' ? HOURLY_OPTIONS : DAILY_OPTIONS;
                  if (!opts.includes(daysBack)) setDaysBack(defaultDaysBackFor(tf));
                }}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold transition-colors"
                  style={{
                    background: isActive ? accentBg : 'transparent',
                    color: isActive ? accentActive : muted,
                    borderRight: tf === 'daily' ? `1px solid ${borderMed}` : undefined,
                  }}>
                  {tf === 'daily' ? <Calendar className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                  {tf === 'daily' ? 'Daily' : 'Hourly'}
                </button>
              );
            })}
          </div>

          {/* Time range selector */}
          <div className="relative">
            <select value={daysBack} onChange={(e) => setDaysBack(Number(e.target.value))}
              className="appearance-none text-[11px] font-semibold pl-2.5 pr-6 py-1.5 rounded-lg border outline-none cursor-pointer"
              style={{ background: isDark ? 'rgba(255,255,255,0.06)' : surface2, borderColor: borderMed, color: textSecondary }}>
              {timeframe === 'daily'
                ? [7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d}d</option>)
                : [24, 48, 72].map((h) => <option key={h} value={h}>{h}h</option>)
              }
            </select>
            <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: muted }} />
          </div>

          {/* KPI selector */}
          <button onClick={() => setSelectorOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold hover:opacity-80 transition-opacity cursor-pointer"
            style={{ borderColor: borderMed, color: textSecondary, background: isDark ? 'rgba(255,255,255,0.05)' : surface2 }}>
            <BarChart2 className="w-3 h-3" style={{ color: muted }} />
            KPIs ({activeKpis.length})
          </button>

          {/* Save */}
          <button onClick={() => { setSavedConfirm(false); setSaveModalOpen(true); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all hover:opacity-80 cursor-pointer"
            style={{
              borderColor: savedConfirm ? 'rgba(16,185,129,0.40)' : accentBorder,
              background: savedConfirm ? 'rgba(16,185,129,0.10)' : accentBg,
              color: savedConfirm ? (isDark ? '#34d399' : '#065f46') : accentActive,
            }}>
            {savedConfirm ? <BookmarkCheck className="w-3 h-3" /> : <Bookmark className="w-3 h-3" />}
            {savedConfirm ? 'Saved!' : 'Save'}
          </button>

          {/* Refresh */}
          <button onClick={() => fetchData(activeSiteId, activeKpis, timeframe as CellKpiViewType, daysBack)}
            disabled={loading}
            className="w-7 h-7 rounded-lg border flex items-center justify-center hover:opacity-80 disabled:opacity-40 transition-opacity cursor-pointer"
            style={{ borderColor: borderMed, background: isDark ? 'rgba(255,255,255,0.05)' : surface2 }}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} style={{ color: muted }} />
          </button>
        </div>
      </div>

      {/* ── USID quick-switch strip (only when multiple sites loaded) ── */}
      {allSiteIds.length > 1 && (
        <div
          className="flex items-center gap-2 px-4 py-2 border-b overflow-x-auto scrollbar-thin"
          style={{ borderColor, background: isDark ? 'rgba(255,255,255,0.015)' : 'rgba(45,42,38,0.015)' }}
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] shrink-0" style={{ color: muted }}>
            Sites
          </span>
          {allSiteIds.map((id) => {
            const isActive = id === activeSiteId;
            return (
              <button
                key={id}
                onClick={() => { setActiveSiteId(id); setUsidInput(id); }}
                className="shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors"
                style={{
                  background: isActive ? accentBg : 'transparent',
                  borderColor: isActive ? accentBorder : borderMed,
                  color: isActive ? accentActive : textSecondary,
                }}
                title={`Switch to USID ${id}`}
              >
                {id}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────────── */}
      {error ? (
        <div className="flex items-center gap-3 px-5 py-6 text-sm"
          style={{ color: isDark ? '#f87171' : '#b91c1c' }}>
          <AlertCircle className="w-4 h-4 flex-shrink-0 opacity-80" />
          <span>{error}</span>
        </div>
      ) : loading && rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-14">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: muted }} />
          <span className="text-[13px]" style={{ color: muted }}>Loading KPI data…</span>
        </div>
      ) : (
        <div className="p-4 space-y-6">
          {(() => {
            const limit = collapseAfterGroups && !groupsExpanded ? collapseAfterGroups : shownGroups.length;
            const visible = shownGroups.slice(0, limit);
            const hiddenCount = Math.max(0, shownGroups.length - limit);
            const hiddenChartCount = shownGroups.slice(limit).reduce((n, g) => n + g.kpis.length, 0);
            return (
              <>
                {visible.map((group) => (
                  <div key={group.group}>
                    <div className="flex items-center gap-3 mb-4">
                      <span className="text-[10px] font-bold uppercase tracking-[0.12em] flex-shrink-0"
                        style={{ color: textSecondary }}>
                        {group.group}
                      </span>
                      <span className="flex-1 h-px"
                        style={{ background: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(45,42,38,0.12)' }} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      {group.kpis.map((kpi, i) => {
                        const kpiRows = rows.filter((r) => r.kpiName === kpi.name);
                        const kpiIndex = ALL_STANDARD_KPIS.findIndex((k) => k.name === kpi.name);
                        const option = buildKpiOption(kpiRows, kpi.name, kpiIndex >= 0 ? kpiIndex : i, timeframe, theme, kpi.unit);
                        return (
                          <ChartPanel
                            key={kpi.name}
                            title={kpi.label}
                            option={option}
                            unit={kpi.unit}
                            height={280}
                            loading={loading}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Expand bar — only when collapseAfterGroups is set and there's more to show */}
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setGroupsExpanded(true)}
                    className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed py-3 text-[12px] font-semibold uppercase tracking-[0.10em] transition-colors hover:opacity-80"
                    style={{
                      borderColor: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(45,42,38,0.18)',
                      color: textSecondary,
                      background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(45,42,38,0.02)',
                    }}
                  >
                    <ChevronDown className="h-4 w-4" />
                    Show {hiddenChartCount} more KPI{hiddenChartCount === 1 ? '' : 's'}
                    <span className="font-mono normal-case opacity-60">
                      ({hiddenCount} group{hiddenCount === 1 ? '' : 's'})
                    </span>
                  </button>
                )}

                {/* Collapse bar — appears when expanded so users can re-collapse */}
                {collapseAfterGroups && groupsExpanded && shownGroups.length > collapseAfterGroups && (
                  <button
                    type="button"
                    onClick={() => setGroupsExpanded(false)}
                    className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed py-2.5 text-[11px] font-semibold uppercase tracking-[0.10em] transition-colors hover:opacity-80"
                    style={{
                      borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(45,42,38,0.14)',
                      color: textSecondary,
                    }}
                  >
                    <ChevronUp className="h-4 w-4" />
                    Collapse
                  </button>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* ── KPI selector overlay ──────────────────────────────── */}
      {selectorOpen && (
        <KpiSelector selected={activeKpis} isDark={isDark} onApply={(kpis) => { setActiveKpis(kpis); setSelectorOpen(false); }} onCancel={() => setSelectorOpen(false)} />
      )}

      {/* ── Save modal ────────────────────────────────────────── */}
      {saveModalOpen && (
        <SaveDashboardModal
          isDark={isDark}
          initial={{ siteId: activeSiteId, endDate, kpiNames: activeKpis, timeframe, daysBack }}
          onCancel={() => setSaveModalOpen(false)}
          onSave={(config) => {
            saveDashboard(config);
            setSaveModalOpen(false);
            setSavedConfirm(true);
            setTimeout(() => setSavedConfirm(false), 3000);
          }}
        />
      )}
    </div>
  );
}
