import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AgGridWrapper from './AgGridWrapper';
import { createPortal } from 'react-dom';
import {
  Activity,
  BarChart2,
  Wifi,
  ArrowLeftRight,
  ZapOff,
  type LucideIcon,
} from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import api from '../services/api';
import { useTheme } from '../context/ThemeContext';
import { useMapData } from '../context/MapDataContext';
import { useDummifier } from '../context/DummifierContext';
import type {
  CellKpiResponse,
  CellKpiSeriesRow,
  CellKpiViewType,
  CqxResponse,
  KpiWorkbenchState,
  MobilityTrendResponse,
  OperationalInfoPayload,
  SiteAnalysisPayload,
  SiteTopologyPayload,
  TrafficProfileResponse,
} from '../types';
import { type RCAMapSignals } from './RCAReasoningPanel';
import type { MapSite } from './MapView';
import SiteAnalyzerTab from './SiteAnalyzerTab';

const TOP_TABS: Array<{ id: KpiWorkbenchState['topTab']; label: string }> = [
  { id: 'site-kpi', label: 'Site KPI' },
  { id: 'rca', label: 'RCA' },
  { id: 'operational', label: 'Operational Info' },
  { id: 'topology', label: 'Site Topology' },
  { id: 'analyzer', label: 'AI Analyzer' },
];

const KPI_MENU_TABS: Array<{ id: KpiWorkbenchState['kpiTab']; label: string }> = [
  { id: 'daily', label: 'Daily' },
  { id: 'hourly', label: 'Hourly' },
  { id: 'overlay', label: 'Overlay' },
];

const KPI_RAIL_TABS: Array<{ id: KpiWorkbenchState['kpiTab']; label: string; Icon: LucideIcon }> = [
  { id: 'cqx',            label: 'CQX',            Icon: Activity },
  { id: 'daily',          label: 'KPI',            Icon: BarChart2 },
  { id: 'traffic-profile',label: 'Traffic Profile',Icon: Wifi },
  { id: 'mobility',       label: 'Mobility',       Icon: ArrowLeftRight },
  { id: 'outages',        label: 'Outages',        Icon: ZapOff },
  // Insights/Correlation intentionally removed for redesign
];

const DEFAULT_KPIS = [
  'DL_VOL_GB', 'UL_VOL_GB', 'DATA_RAN_ACC', 'DATA_ERB_RET',
  'DL_TOTAL_DRB_THPUT', 'UL_TPUT', 'DL_PKTLOSS_RT', 'UL_PKTLOSS_RT',
  'RRC_FAIL', 'DUAC_FAIL', 'UL_RSSI', 'AVG_DL_PRB_UTIL',
  'PDCCH_Utilization', 'EUCELL_DOWNTIME_AUTO', 'EUCELL_DOWNTIME_MANUAL', 'PMUECTXTRELSCEUTRA',
];
const DEFAULT_CQX_METRICS = ['Total_Impact_Mkt_CQX_Delta', 'Total_Impact_Mkt_CQX'];

interface ObserveSiteAnalysisTileProps {
  site: MapSite;
  selectedDateId: string;
  onClose: () => void;
  onRcaMapSignals: (signals: RCAMapSignals | null) => void;
  panelMode: 'overlay' | 'split' | 'full';
  onPanelModeChange: (mode: 'overlay' | 'split' | 'full') => void;
}

interface AsyncSection<T> {
  loading: boolean;
  error: string | null;
  data: T | null;
}

function shiftDate(base: string, offset: number): string {
  const date = new Date(base);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function formatTitle(value: string): string {
  return value.replace(/_/g, ' ');
}

/** Formats a "YYYY-MM-DD" label as "M/D" for compact axis display. */
function formatDateLabel(value: string): string {
  const segs = String(value).slice(0, 10).split('-');
  if (segs.length < 3) return value;
  return `${parseInt(segs[1], 10)}/${parseInt(segs[2], 10)}`;
}

function getField(row: Record<string, any>, candidates: string[]): any {
  for (const candidate of candidates) {
    if (row[candidate] !== undefined) return row[candidate];
  }
  const lower: Record<string, any> = {};
  Object.keys(row).forEach((key) => {
    lower[key.toLowerCase()] = row[key];
  });
  for (const candidate of candidates) {
    const hit = lower[candidate.toLowerCase()];
    if (hit !== undefined) return hit;
  }
  return null;
}

function toNum(value: any): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function panelTone(theme: 'light' | 'dark') {
  const isDark = theme === 'dark';
  return {
    // Surfaces — light side uses the warm cream glassmorphism palette
    shell:          isDark ? '#141414'                     : '#FAF8F5',
    shellEdge:      isDark ? 'rgba(255,255,255,0.10)'      : 'rgba(45,42,38,0.10)',
    surface:        isDark ? 'rgba(20,20,20,0.88)'         : 'rgba(255,253,250,0.96)',
    surfaceStrong:  isDark ? 'rgba(20,20,20,0.98)'         : 'rgba(255,253,250,1)',
    surfaceElevated:isDark ? 'rgba(30,30,30,1)'            : 'rgba(255,253,250,1)',
    border:         isDark ? 'rgba(255,255,255,0.10)'      : 'rgba(45,42,38,0.10)',
    borderStrong:   isDark ? 'rgba(255,255,255,0.22)'      : 'rgba(45,42,38,0.22)',
    // Text — light side uses warm-dark per glassmorphism spec
    text:           isDark ? '#FBFBFB'                     : '#2D2A26',
    muted:          isDark ? '#B3B3B3'                     : '#6B6762',
    subtle:         isDark ? '#8C8C8C'                     : '#8F8B85',
    grid:           isDark ? 'rgba(255,255,255,0.07)'      : 'rgba(45,42,38,0.10)',
    // primary = active TEXT / BORDER color (high contrast, readable)
    primary:        isDark ? 'rgba(255,255,255,0.92)'      : 'rgba(45,42,38,0.92)',
    secondary:      isDark ? 'rgba(255,255,255,0.62)'      : 'rgba(45,42,38,0.62)',
    accent:         isDark ? '#FBFBFB'                     : '#2D2A26',
    tertiary:       isDark ? 'rgba(255,255,255,0.50)'      : 'rgba(45,42,38,0.45)',
    // fill = active BACKGROUND for glass tabs
    fill:           isDark ? 'rgba(255,255,255,0.12)'      : 'rgba(45,42,38,0.08)',
    glow:           isDark ? 'rgba(0,0,0,0.28)'            : 'rgba(45,42,38,0.06)',
    // === Active UI state — warm-neutral (no hue conflict with semantic red/green) ===
    activeText:     isDark ? '#FBFBFB'                     : '#2D2A26',
    activeFill:     isDark ? 'rgba(255,255,255,0.12)'      : 'rgba(45,42,38,0.10)',
    activeBorder:   isDark ? 'rgba(255,255,255,0.32)'      : 'rgba(45,42,38,0.32)',
  };
}

function baseChartOption(theme: 'light' | 'dark'): EChartsOption {
  const tone = panelTone(theme);
  return {
    // Smooth chart transitions (Compass-style) — keeps UI feeling seamless on tab/date switches.
    animation: true,
    animationDuration: 320,
    animationEasing: 'cubicOut',
    animationDurationUpdate: 420,
    animationEasingUpdate: 'cubicOut',
    animationThreshold: 5000,
    progressive: 400,
    grid: { left: 60, right: 20, top: 60, bottom: 40, containLabel: false },
    tooltip: {
      trigger: 'item',
      backgroundColor: tone.surfaceStrong,
      borderColor: tone.border,
      padding: 0,
      formatter: (params: any) => {
        try {
          const p = Array.isArray(params) ? params[0] : params;
          if (!p || p.value == null || (typeof p.value === 'number' && isNaN(p.value))) return '';
          const raw = typeof p.value === 'number' ? p.value : parseFloat(p.value);
          const formatted = isNaN(raw)
            ? String(p.value)
            : Math.abs(raw) >= 1000
              ? raw.toLocaleString(undefined, { maximumFractionDigits: 2 })
              : Number(raw.toPrecision(4)).toString();
          const date = String(p.name || '');
          const series = String(p.seriesName || '');
          const color = String(p.color || '#ccc');
          return `<div style="padding:8px 12px;">
            <div style="font-size:11px;color:${tone.muted};margin-bottom:5px;font-weight:600;">${date}</div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="width:9px;height:9px;border-radius:50%;background:${color};flex-shrink:0;"></span>
              <span style="font-size:12px;color:${tone.text};">${series}</span>
              <span style="font-size:13px;font-weight:700;color:${tone.text};margin-left:8px;">${formatted}</span>
            </div>
          </div>`;
        } catch { return ''; }
      },
    },
    textStyle: { color: tone.text, fontFamily: 'inherit' },
    xAxis: {
      type: 'category',
      axisLine: { lineStyle: { color: tone.grid } },
      axisLabel: { color: tone.muted, fontSize: 11, rotate: 45, hideOverlap: true },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { color: tone.muted, fontSize: 11 },
      splitLine: { lineStyle: { color: tone.grid, type: 'dashed' } },
      axisTick: { show: false },
    },
    legend: {
      top: 10,
      right: 56,
      type: 'scroll',
      textStyle: { color: tone.muted, fontSize: 11 },
    },
    toolbox: {
      top: 6,
      right: 4,
      feature: {
        restore: {},
        saveAsImage: { backgroundColor: theme === 'dark' ? '#1c1c1e' : '#ffffff' },
      },
      iconStyle: { borderColor: tone.muted },
      emphasis: { iconStyle: { borderColor: tone.text } },
    },
  };
}

function CompactMetric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="relative overflow-hidden rounded-[22px] border border-black/5 dark:border-white/10 bg-white/80 dark:bg-[#242424]/75 px-4 py-3 shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur-md">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted dark:text-slate-400">{label}</div>
        <span className="h-2 w-2 rounded-full bg-sky-400/80 shadow-[0_0_8px_rgba(14,165,233,0.40)]" />
      </div>
      <div className="mt-2 text-[18px] leading-tight font-semibold text-slate-950 dark:text-slate-50 truncate" title={hint || value}>{value}</div>
      {hint ? <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-text-muted dark:text-slate-500 truncate">{hint}</div> : null}
    </div>
  );
}

function TableView({ title, rows, theme: _theme }: { title: string; rows: Array<Record<string, unknown>>; theme?: 'dark' | 'light' }) {
  const colDefs = useMemo(() => {
    const keys = Object.keys(rows[0] || {}).slice(0, 8);
    return keys.map((key) => ({
      field: key,
      headerName: formatTitle(key),
      flex: 1,
      minWidth: 100,
      valueFormatter: (p: any) => String(p.value ?? '-'),
    }));
  }, [rows]);

  const height = Math.min(38 * rows.length + 36 + 2, 420);

  return (
    <div className="rounded-[16px] overflow-hidden border border-border dark:border-white/10">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border dark:border-white/10 bg-cream-surface-light/70 dark:bg-white/[0.04]">
        <span className="text-[12px] font-semibold text-text-secondary dark:text-slate-200">{title}</span>
        <span className="rounded-full border border-border dark:border-white/10 px-2.5 py-0.5 text-[11px] font-medium text-text-muted dark:text-slate-500">{rows.length}</span>
      </div>
      <AgGridWrapper columnDefs={colDefs} rowData={rows as Record<string, any>[]} height={height} />
    </div>
  );
}

/** Compass-style multi-select dropdown for cell filters (Face / Band / Technology) */
function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  tone,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  tone: ReturnType<typeof panelTone>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const allSelected = selected.length === options.length;
  const displayText = allSelected || selected.length === 0 ? 'All' : `${selected.length} selected`;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
          background: tone.surface, border: `1px solid ${tone.border}`,
          borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 500,
          color: tone.text, minWidth: 110, userSelect: 'none' as const,
        }}
      >
        <span style={{ fontWeight: 700, color: tone.text }}>{label}:</span>
        <span style={{ flex: 1, textAlign: 'right', color: tone.muted }}>{displayText}</span>
        <span style={{ fontSize: 9, color: tone.muted }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 200,
          background: tone.surfaceStrong, border: `1px solid ${tone.border}`,
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          minWidth: 180, maxHeight: 220, overflowY: 'auto', padding: 4,
        }}>
          <div style={{ display: 'flex', gap: 4, padding: '4px 4px 8px', borderBottom: `1px solid ${tone.border}`, marginBottom: 4 }}>
            <button type="button" onClick={() => onChange([...options])}
              style={{ flex: 1, padding: '3px 8px', background: tone.fill, border: `1px solid ${tone.border}`, borderRadius: 4, color: tone.primary, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
              All
            </button>
            <button type="button" onClick={() => onChange([])}
              style={{ flex: 1, padding: '3px 8px', background: 'transparent', border: `1px solid ${tone.border}`, borderRadius: 4, color: tone.muted, cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
              None
            </button>
          </div>
          {options.map((opt) => (
            <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer', borderRadius: 4, fontSize: 12, color: tone.text }}>
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => onChange(selected.includes(opt) ? selected.filter((v) => v !== opt) : [...selected, opt])}
                style={{ cursor: 'pointer', accentColor: tone.primary }}
              />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * ChartPanel — wraps ReactECharts with Compass-style legend interactivity:
 *  • Single click legend item  → show/hide that series (ECharts default)
 *  • Double click legend item  → isolate that series (hide all others); double again to restore
 */
function ChartPanel({
  title,
  option,
  height = 300,
  headerContent,
  loading = false,
  error,
}: {
  title: string;
  option: EChartsOption;
  height?: number;
  headerContent?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
}) {
  const chartRef = useRef<ReactECharts | null>(null);
  const isolatedRef = useRef<string | null>(null);
  const lastClickRef = useRef<{ name: string; ts: number } | null>(null);
  const hasSeries = useMemo(() => {
    const s: any = (option as any)?.series;
    if (Array.isArray(s)) return s.length > 0;
    return Boolean(s);
  }, [option]);

  const getEchartsInstance = useCallback(() => {
    return (chartRef.current as any)?.getEchartsInstance?.() ?? null;
  }, []);

  const handleLegendSelectChanged = useCallback((params: any) => {
    const chart = getEchartsInstance();
    if (!chart) return;
    const { name } = params;
    const now = Date.now();
    const last = lastClickRef.current;
    const isDoubleClick = last && last.name === name && now - last.ts < 400;
    lastClickRef.current = { name, ts: now };

    if (!isDoubleClick) return; // single click handled natively by ECharts

    const currentOption = chart.getOption() as any;
    const allSeries: any[] = currentOption?.series || [];
    const allNames = allSeries.map((s: any) => s.name).filter(Boolean);

    if (isolatedRef.current === name) {
      // Un-isolate: restore all series
      isolatedRef.current = null;
      allNames.forEach((n) => chart.dispatchAction({ type: 'legendSelect', name: n }));
    } else {
      // Isolate this series
      isolatedRef.current = name;
      allNames.forEach((n) => {
        chart.dispatchAction({ type: n === name ? 'legendSelect' : 'legendUnSelect', name: n });
      });
    }
  }, [getEchartsInstance]);

  // Reset isolation when option changes (new site/date)
  useEffect(() => { isolatedRef.current = null; }, [option]);

  return (
    <div className="overflow-hidden rounded-[20px] border border-border dark:border-white/12 bg-cream-surface/70 dark:bg-[#141414]/70 backdrop-blur-2xl shadow-[0_14px_34px_rgba(45,42,38,0.10)] dark:shadow-[0_14px_34px_rgba(0,0,0,0.28)]">
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-border dark:border-white/12 bg-cream-surface-light/50 dark:bg-white/5 backdrop-blur-xl">
        <h4 className="text-[15px] font-semibold text-text-primary dark:text-white">{title}</h4>
        <div className="flex items-center gap-3">
          {error && hasSeries ? (
            <span className="rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.28)', background: 'rgba(239,68,68,0.10)' }}>
              Data error
            </span>
          ) : null}
          {loading && hasSeries ? (
            <div className="flex items-center gap-2 text-[11px] text-text-muted dark:text-slate-500">
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Syncing…
            </div>
          ) : null}
          {headerContent ?? <div />}
        </div>
      </div>
      <div style={{ height }} className="relative">
        {loading && !hasSeries ? (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-text-muted dark:text-slate-500">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Loading {title} data…
          </div>
        ) : error && !hasSeries ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-sm text-red-400 dark:text-red-500">
            <svg className="h-5 w-5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><circle cx="12" cy="16" r="0.5" fill="currentColor" />
            </svg>
            <span className="text-xs opacity-80">{error}</span>
          </div>
        ) : !option.series || (Array.isArray(option.series) && (option.series as any[]).length === 0) ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
            <svg className="h-8 w-8 text-text-muted dark:text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <span className="text-xs text-text-muted dark:text-slate-500">No data available for this period</span>
          </div>
        ) : (
          <>
            {loading ? (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] overflow-hidden">
                <div
                  className="h-full w-1/2 animate-pulse"
                  style={{
                    background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.9), transparent)',
                    marginLeft: '25%',
                  }}
                />
              </div>
            ) : null}
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

function useSectionState<T>(loader: (() => Promise<T>) | null, deps: unknown[]): AsyncSection<T> {
  const [state, setState] = useState<AsyncSection<T>>({ loading: Boolean(loader), error: null, data: null });

  useEffect(() => {
    let cancelled = false;
    if (!loader) {
      setState({ loading: false, error: null, data: null });
      return undefined;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));
    loader()
      .then((data) => {
        if (!cancelled) setState({ loading: false, error: null, data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ loading: false, error: error instanceof Error ? error.message : 'Failed to load', data: null });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

// ─── Per-KPI lazy chart loading ───────────────────────────────────────────────

/**
 * KPI_PALETTE — Maritime cool palette (no purple/pink/red/amber/emerald).
 * Reserves red/green/amber for semantic map/status signals.
 * 20 colours cycled via brightness + hue variants of teal/sky/navy/cyan/slate.
 */
const KPI_PALETTE = [
  '#0F766E', // teal-700
  '#0284C7', // sky-600
  '#1E40AF', // blue-800
  '#0E7490', // cyan-700
  '#475569', // slate-600
  '#14B8A6', // teal-500
  '#38BDF8', // sky-400
  '#2563EB', // blue-600
  '#06B6D4', // cyan-500
  '#94A3B8', // slate-400
  '#5EEAD4', // teal-300
  '#0EA5E9', // sky-500
  '#3B82F6', // blue-500
  '#22D3EE', // cyan-400
  '#64748B', // slate-500
  '#115E59', // teal-800
  '#0891B2', // cyan-600
  '#1D4ED8', // blue-700
  '#334155', // slate-700
  '#67E8F9', // cyan-300
];

/**
 * Parse face from cell name format: NODENAME_BANDFACE_CARRIER (e.g. CVL01419_2A_1)
 * Face = the alphabetic character in the 2nd underscore-delimited segment (e.g. "2A" → "A")
 * Used as fallback when topology cellMeta hasn't loaded.
 */
function parseCellNameMeta(cellName: string): { face: string; band: string; tech: string } {
  const parts = cellName.split('_');
  if (parts.length >= 2) {
    const seg = parts[1]; // e.g. "2A", "14B", "3C"
    const faceChar = seg.match(/([A-C])$/i);
    if (faceChar) return { face: faceChar[1].toUpperCase(), band: parts[1], tech: 'Unknown' };
  }
  return { face: '?', band: '?', tech: 'Unknown' };
}

function buildKpiPointMap(
  rows: CellKpiSeriesRow[],
  labelKey: 'date' | 'hour',
  traceField: 'cellName' | 'dateId' | 'site',
  cellMeta: Map<string, { face: string; band: string; tech: string }>,
  selectedFaces: string[],
  selectedBands: string[],
  selectedTechs: string[],
) {
  const labels = Array.from(new Set(rows.map((row) => {
    if (labelKey === 'hour') return `${row.dateId} ${String(row.hourId ?? 0).padStart(2, '0')}:00`;
    return row.dateId;
  }))).sort();
  const traces = Array.from(new Set(rows.map((row) =>
    traceField === 'site' ? 'Site Aggregate' : String(row[traceField] || 'Unknown')
  ))).filter((trace) => {
    if (trace === 'Site Aggregate') return true;
    // Use topology meta if available, otherwise parse directly from cell name
    const meta = cellMeta.get(trace) ?? parseCellNameMeta(trace);
    return (selectedFaces.length === 0 || selectedFaces.includes(meta.face))
      && (selectedBands.length === 0 || selectedBands.includes(meta.band))
      && (selectedTechs.length === 0 || selectedTechs.includes(meta.tech));
  }).slice(0, 8);

  return {
    labels,
    traces,
    valueFor(trace: string, label: string) {
      const values = rows
        .filter((row) => {
          const rowLabel = labelKey === 'hour'
            ? `${row.dateId} ${String(row.hourId ?? 0).padStart(2, '0')}:00`
            : row.dateId;
          const rowTrace = traceField === 'site' ? 'Site Aggregate' : String(row[traceField] || 'Unknown');
          return rowLabel === label && rowTrace === trace;
        })
        .map((row) => Number(row.kpiValue || 0));
      if (!values.length) return null;
      return values.reduce((sum, v) => sum + v, 0) / values.length;
    },
  };
}

function buildKpiChartOption(
  rows: CellKpiSeriesRow[],
  kpiIndex: number,
  kpiTab: string,
  cellMeta: Map<string, { face: string; band: string; tech: string }>,
  selectedFaces: string[],
  selectedBands: string[],
  selectedTechs: string[],
  theme: 'light' | 'dark',
): EChartsOption {
  const traceMode = kpiTab === 'overlay'
    ? { labelKey: 'date' as const, traceField: 'site' as const }
    : kpiTab === 'hourly'
      ? { labelKey: 'hour' as const, traceField: 'cellName' as const }
      : { labelKey: 'date' as const, traceField: 'cellName' as const };
  const model = buildKpiPointMap(rows, traceMode.labelKey, traceMode.traceField, cellMeta, selectedFaces, selectedBands, selectedTechs);
  const color = (i: number) => KPI_PALETTE[(i + kpiIndex) % KPI_PALETTE.length];
  const toneBase = baseChartOption(theme);

  const isHourlyLabels = traceMode.labelKey === 'hour';
  const baseLabelStyle = { color: (toneBase.xAxis as any).axisLabel?.color, fontSize: 10 };

  // Hourly: "YYYY-MM-DD HH:00" × 72+ — show only day boundaries + 6-hour marks
  // Daily/overlay: "YYYY-MM-DD" × 7–30 — shorten to "M/D"
  const xAxisOverride = isHourlyLabels ? {
    axisLabel: {
      ...baseLabelStyle,
      rotate: 40,
      interval: 0,
      hideOverlap: false,
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
        const dayStr = `${mm}/${dd}`;
        return hour === 0 ? dayStr : `${dayStr} ${String(hour).padStart(2, '0')}h`;
      },
    },
  } : {
    axisLabel: { ...baseLabelStyle, rotate: 30, hideOverlap: true, formatter: formatDateLabel },
  };

  return {
    ...toneBase,
    grid: { left: 52, right: 24, top: 36, bottom: isHourlyLabels ? 56 : 44 },
    xAxis: { ...(toneBase.xAxis as object), data: model.labels, ...xAxisOverride },
    series: model.traces.map((trace, i) => ({
      name: trace,
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      showSymbol: true,
      lineStyle: { width: 2, color: color(i) },
      itemStyle: { color: color(i) },
      emphasis: { focus: 'series', lineStyle: { width: 3 } },
      data: model.labels.map((label) => model.valueFor(trace, label)),
    })),
  } as EChartsOption;
}

/** Fetches and renders a single KPI chart independently — enables parallel per-KPI loading. */
function KpiChartPanel({
  kpiName, kpiIndex, siteId, selectedDateId, kpiTab, daysBack,
  cellMeta, selectedFaces, selectedBands, selectedTechs, theme,
  startDateOverride, viewTypeOverride,
}: {
  kpiName: string; kpiIndex: number; siteId: string; selectedDateId: string;
  kpiTab: string; daysBack: number;
  cellMeta: Map<string, { face: string; band: string; tech: string }>;
  selectedFaces: string[]; selectedBands: string[]; selectedTechs: string[];
  theme: 'light' | 'dark';
  startDateOverride?: string;
  viewTypeOverride?: CellKpiViewType;
}) {
  const viewType: CellKpiViewType = viewTypeOverride ?? (kpiTab === 'overlay' ? 'daily' : kpiTab as CellKpiViewType);
  const startDate = startDateOverride ?? shiftDate(selectedDateId, kpiTab === 'hourly' ? -2 : -daysBack);

  const kpiData = useSectionState<CellKpiResponse | null>(
    () => api.getSiteCellKpis(siteId, {
      kpiNames: [kpiName],
      viewType,
      dateId: selectedDateId,
      endDate: selectedDateId,
      startDate,
    }).then((res) => res.data ?? null),
    [kpiName, siteId, selectedDateId, kpiTab, daysBack]
  );

  // Keep a brief minimum loading time to avoid flash/jank on first load,
  // but don't block when we already have previous data (smooth tab switching).
  const [minLoadDone, setMinLoadDone] = useState(false);
  useEffect(() => {
    if (kpiData.data) {
      setMinLoadDone(true);
      return;
    }
    setMinLoadDone(false);
    const t = setTimeout(() => setMinLoadDone(true), 450);
    return () => clearTimeout(t);
  }, [kpiName, siteId, selectedDateId, kpiTab, daysBack, Boolean(kpiData.data)]);

  const option = useMemo<EChartsOption>(() => {
    if (!kpiData.data) return baseChartOption(theme) as EChartsOption;
    const rows = kpiData.data.data.filter((r) => r.kpiName === kpiName);
    return buildKpiChartOption(rows, kpiIndex, kpiTab, cellMeta, selectedFaces, selectedBands, selectedTechs, theme);
  }, [kpiData.data, kpiName, kpiIndex, kpiTab, cellMeta, selectedFaces, selectedBands, selectedTechs, theme]);

  return (
    <ChartPanel
      title={formatTitle(kpiName)}
      option={option}
      height={360}
      loading={kpiData.loading || !minLoadDone}
      error={kpiData.error}
    />
  );
}

// ─── JSON field parser ─────────────────────────────────────────────────────
// The API returns some fields as JSON strings (e.g. bucket, solutionRecommendation).
function parseJsonField<T = Record<string, any>>(raw: unknown): T | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { return JSON.parse(trimmed) as T; } catch { /* fall through */ }
    }
  }
  return null;
}

function extractText(raw: unknown): string {
  if (!raw) return '';
  const parsed = parseJsonField<{ text?: string }>(raw);
  if (parsed?.text) return parsed.text;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return trimmed;
  }
  return '';
}

function extractRecommendation(raw: unknown): { title: string; justification: string } | null {
  if (!raw) return null;
  const parsed = parseJsonField<{ text?: string; details?: { short_justification?: string; category?: string } }>(raw);
  if (!parsed) {
    const s = String(raw).trim();
    return s && !s.startsWith('{') ? { title: s, justification: '' } : null;
  }
  return {
    title: parsed.text || parsed.details?.category || '',
    justification: parsed.details?.short_justification || '',
  };
}

function extractBestEvidenceText(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') {
    const s = raw.trim();
    const parsed = parseJsonField<any>(s);
    if (parsed) return extractBestEvidenceText(parsed);
    return s.startsWith('{') || s.startsWith('[') ? '' : s;
  }
  if (Array.isArray(raw)) {
    const parts = raw.map((x) => extractBestEvidenceText(x)).filter(Boolean);
    return parts.join(' · ');
  }
  if (typeof raw === 'object') {
    const o: any = raw;
    const candidates = [
      o.text,
      o.title,
      o.step,
      o.phase,
      o.summary,
      o.reasoning,
      o.description,
      o.content,
      o.short_justification,
      o.justification,
      o.explanation,
      o.details?.short_justification,
      o.details?.category,
      o.details?.text,
    ];
    for (const c of candidates) {
      const t = extractText(c) || extractBestEvidenceText(c);
      if (t) return t;
    }
  }
  return '';
}

function extractIntuitionDetails(inv: Record<string, any>): {
  summary: string;
  confidenceLine: string;
  reasoning: string;
} {
  const summary = inv?.summary || inv?.description || '';
  const confidenceLine = inv?.confidence != null
    ? (typeof inv.confidence === 'number' ? `${Math.round(inv.confidence * 100)}%` : String(inv.confidence))
    : '';

  const candidates = [
    inv?.reasoning,
    inv?.rationale,
    inv?.justification,
    inv?.explanation,
    inv?.details,
    inv?.evidence,
    inv?.analysis,
    inv?.notes,
  ].filter((v) => v != null);

  let reasoning = '';
  for (const c of candidates) {
    const text = extractText(c) || extractBestEvidenceText(c);
    if (text) { reasoning = text; break; }
    if (typeof c === 'string') {
      const s = c.trim();
      if (s && !s.startsWith('{') && !s.startsWith('[')) { reasoning = s; break; }
      const parsed = parseJsonField<any>(s);
      if (parsed) {
        const best = extractBestEvidenceText(parsed);
        if (best) { reasoning = best; break; }
      }
    } else if (typeof c === 'object') {
      const best = extractBestEvidenceText(c);
      if (best) { reasoning = best; break; }
    }
  }

  return { summary: String(summary || ''), confidenceLine: String(confidenceLine || ''), reasoning };
}

// ─── Summary Mode ──────────────────────────────────────────────────────────
interface SummaryModeViewProps {
  analysis: SiteAnalysisPayload;
  isLoading: boolean;
  site?: MapSite;
  theme: 'light' | 'dark';
  tone: ReturnType<typeof panelTone>;
  onSwitchToDiagnostic: () => void;
  hideCta?: boolean;
}

function RcaReasoningSteps({ steps, tone }: { steps: any[]; tone: ReturnType<typeof panelTone> }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-[14px] border overflow-hidden" style={{ borderColor: tone.border, background: tone.fill }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded((p) => !p); }}
        className="w-full px-3 py-2 flex items-center justify-between"
        style={{ background: 'transparent' }}
      >
        <span className="text-[9px] font-bold uppercase tracking-[0.18em]" style={{ color: tone.muted }}>
          Reasoning Chain
        </span>
        <span className="text-[10px] font-semibold" style={{ color: tone.activeText }}>
          {expanded ? '▲ Hide details' : '▼ Show details'}
        </span>
      </button>
      {expanded ? (
        <div className="relative px-3 pb-2 space-y-2 border-t" style={{ borderColor: tone.border }}>
          <div className="absolute left-[18px] top-0 bottom-0 w-px" style={{ background: tone.border }} />
          {steps.map((step: any, i) => {
            const text: string = extractBestEvidenceText(step?.reasoning ?? step?.description ?? step?.content ?? step?.details ?? step);
            const label: string = extractBestEvidenceText(step?.step ?? step?.title ?? step?.phase ?? '');
            if (!text) return null;
            return (
              <div key={i} className="relative flex gap-2.5 pl-5 pt-2">
                <span
                  className="absolute left-0 top-2.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold"
                  style={{ background: tone.activeFill, color: tone.activeText, border: `1px solid ${tone.activeBorder}`, zIndex: 1 }}
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  {label ? (
                    <div className="text-[9px] font-semibold uppercase tracking-[0.12em] mb-0.5" style={{ color: tone.muted }}>
                      {label}
                    </div>
                  ) : null}
                  <p className="text-[11px] leading-relaxed" style={{ color: tone.secondary }}>{text}</p>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SummaryModeView({ analysis, isLoading, theme, tone, onSwitchToDiagnostic, hideCta }: SummaryModeViewProps) {
  const { dText } = useDummifier();
  // Animation phases: 0=entering, 1=highlight-applies, 2=show-rca
  const [phase, setPhase] = useState(0);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const analysisCardRef = useRef<HTMLDivElement | null>(null);
  const evidenceRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [overlaySize, setOverlaySize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [linkPaths, setLinkPaths] = useState<Array<{ key: string; d: string; delayMs: number }>>([]);

  const cardSurface = useMemo(
    () => ({
      background: tone.surface,
      borderColor: tone.border,
      backdropFilter: 'blur(14px)',
      boxShadow: theme === 'dark' ? '0 18px 40px rgba(0,0,0,0.35)' : '0 18px 40px rgba(15,23,42,0.10)',
    }),
    [theme, tone.border, tone.surface]
  );

  const cardSurfaceStrong = useMemo(
    () => ({
      background: tone.surfaceStrong,
      borderColor: tone.border,
      backdropFilter: 'blur(16px)',
      boxShadow: theme === 'dark' ? '0 22px 52px rgba(0,0,0,0.45)' : '0 22px 52px rgba(15,23,42,0.12)',
    }),
    [theme, tone.border, tone.surfaceStrong]
  );

  const intuitionEntries: [string, Record<string, any>][] = Object.entries(analysis.intuitions || {})
    .map(([k, v]) => [k, v as Record<string, any>]);

  // Phase 1: alphabetically sorted; we advance through phases via timers
  const sortedAlpha = [...intuitionEntries].sort(([a], [b]) => a.localeCompare(b));
  const enterDuration = sortedAlpha.length * 70 + 200; // time for all cards to enter

  useEffect(() => {
    if (isLoading) return;
    setPhase(0);
    const t1 = setTimeout(() => setPhase(1), enterDuration);
    const t2 = setTimeout(() => setPhase(2), enterDuration + 700);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [analysis.rca.bucket, isLoading, intuitionEntries.length]);

  const rcaBucket = extractText(analysis.rca.bucket);
  const recommendation = extractRecommendation(analysis.rca.solutionRecommendation);
  const hasRca = Boolean(rcaBucket);

  const orderedEvidence = useMemo(() => {
    if (phase < 1) return sortedAlpha;
    const score = (inv: Record<string, any>) => {
      const applies = inv?.applies ?? inv?.result ?? null;
      if (applies === true) return 2;
      if (applies === false) return 1;
      return 0;
    };
    return [...sortedAlpha].sort((a, b) => {
      const sa = score(a[1]);
      const sb = score(b[1]);
      if (sa !== sb) return sb - sa;
      return a[0].localeCompare(b[0]);
    });
  }, [phase, sortedAlpha]);

  const appliedCount = useMemo(
    () => intuitionEntries.filter(([, inv]) => (inv?.applies ?? inv?.result) === true).length,
    [intuitionEntries]
  );

  // Draw animated connectors from APPLIES evidence → RCA card.
  useEffect(() => {
    if (phase < 2) {
      setLinkPaths([]);
      return;
    }

    const compute = () => {
      const container = containerRef.current;
      const analysisEl = analysisCardRef.current;
      if (!container || !analysisEl) return;

      const containerRect = container.getBoundingClientRect();
      const analysisRect = analysisEl.getBoundingClientRect();
      const w = Math.max(0, Math.round(containerRect.width));
      const h = Math.max(0, Math.round(containerRect.height));
      setOverlaySize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));

      // Only draw connectors when the layout is side-by-side (desktop).
      const sideBySide = (analysisRect.left - containerRect.left) > containerRect.width * 0.45;
      if (!sideBySide) {
        setLinkPaths([]);
        return;
      }

      const appliedKeys = orderedEvidence
        .filter(([, inv]) => (inv?.applies ?? inv?.result) === true)
        .map(([k]) => k);

      const fromRects = appliedKeys
        .map((k) => ({ key: k, el: evidenceRefs.current.get(k) }))
        .filter((x): x is { key: string; el: HTMLButtonElement } => Boolean(x.el))
        .map((x) => ({ key: x.key, rect: x.el.getBoundingClientRect() }));

      if (!fromRects.length) {
        setLinkPaths([]);
        return;
      }

      // All lines converge to a single point at the left-center border of the RCA card.
      const endX = (analysisRect.left - containerRect.left) + 6;
      const endY = (analysisRect.top - containerRect.top) + analysisRect.height / 2;

      const paths = fromRects.map((fr, idx) => {
        const startX = (fr.rect.right - containerRect.left) - 8;
        const startY = (fr.rect.top - containerRect.top) + fr.rect.height / 2;

        const dx = Math.max(60, Math.min(220, endX - startX));
        const c1x = startX + dx * 0.55;
        const c1y = startY;
        const c2x = endX - dx * 0.25;
        const c2y = endY;

        return {
          key: fr.key,
          d: `M ${startX.toFixed(1)} ${startY.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${endX.toFixed(1)} ${endY.toFixed(1)}`,
          delayMs: idx * 90,
        };
      });

      setLinkPaths(paths);
    };

    compute();

    const container = containerRef.current;
    const analysisEl = analysisCardRef.current;
    const ro = new ResizeObserver(() => compute());
    if (container) ro.observe(container);
    if (analysisEl) ro.observe(analysisEl);
    evidenceRefs.current.forEach((el) => ro.observe(el));

    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, expandedKey, orderedEvidence.map(([k]) => k).join('|')]);

  if (isLoading) {
    return (
      <div className="space-y-3 pt-1">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] mb-4 text-center" style={{ color: tone.muted }}>
          Analysing site…
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-12 rounded-[14px] border animate-pulse"
              style={{
                borderColor: tone.border,
                background: theme === 'dark' ? 'rgba(38,38,38,0.55)' : 'rgba(255,255,255,0.72)',
                animationDelay: `${i * 55}ms`,
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="pt-2 relative">
      {/* Animated connectors (APPLIES → RCA) */}
      {phase >= 2 && overlaySize.w > 0 && overlaySize.h > 0 && linkPaths.length > 0 ? (
        <svg
          className="pointer-events-none absolute inset-0 z-[5]"
          width={overlaySize.w}
          height={overlaySize.h}
          viewBox={`0 0 ${overlaySize.w} ${overlaySize.h}`}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="rcaLinkStroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(34,197,94,0.15)" />
              <stop offset="40%" stopColor="rgba(34,197,94,0.75)" />
              <stop offset="100%" stopColor={tone.activeText} stopOpacity="0.8" />
            </linearGradient>
            <filter id="rcaLinkGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <style>{`
            @keyframes rcaDashIn {
              from { stroke-dashoffset: 1; opacity: 0.0; }
              25% { opacity: 1.0; }
              to { stroke-dashoffset: 0; opacity: 1.0; }
            }
          `}</style>
          {linkPaths.map((p) => (
            <g key={p.key}>
              <path
                d={p.d}
                fill="none"
                stroke="rgba(34,197,94,0.15)"
                strokeWidth="6"
                strokeLinecap="round"
                filter="url(#rcaLinkGlow)"
                opacity="0.25"
              />
              <path
                d={p.d}
                fill="none"
                stroke="url(#rcaLinkStroke)"
                strokeWidth="2.2"
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1}
                style={{ animation: `rcaDashIn 820ms cubic-bezier(0.16, 1, 0.3, 1) forwards`, animationDelay: `${p.delayMs}ms` }}
              />
            </g>
          ))}
        </svg>
      ) : null}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,360px)_1fr] gap-4">
        {/* Evidence column */}
        <div>
          <div className="text-[13px] font-bold tracking-wide mb-2" style={{ color: tone.text }}>
            Evidence
          </div>

          <div className="space-y-1.5">
            {(phase < 1 ? sortedAlpha : orderedEvidence).map(([key, inv], idx) => {
              const applies = inv?.applies ?? inv?.result ?? null;
              const enterDelay = idx * 60;
              const isApplied = applies === true;
              const isRejected = applies === false;
              const highlightApplied = phase >= 1 && isApplied;
              const statusLabel = phase < 1
                ? (applies === null ? 'CHECKING' : isApplied ? 'APPLIES' : isRejected ? "DOESN'T APPLY" : 'UNKNOWN')
                : isApplied ? 'APPLIES' : isRejected ? "DOESN'T APPLY" : 'UNKNOWN';
              const statusColor = phase < 1
                ? (applies === null
                  ? (theme === 'dark' ? 'rgba(148,163,184,0.85)' : 'rgba(100,116,139,0.85)')
                  : isApplied
                    ? 'rgba(34,197,94,0.92)'
                    : isRejected
                      ? 'rgba(239,68,68,0.92)'
                      : tone.muted)
                : isApplied
                  ? '#22c55e'
                  : isRejected
                    ? '#ef4444'
                    : tone.muted;
              const barColor = isApplied ? '#22c55e' : isRejected ? '#ef4444' : (theme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.12)');

              const isExpanded = expandedKey === key;
              const { summary, confidenceLine, reasoning } = extractIntuitionDetails(inv || {});

              return (
                <button
                  key={`${phase < 1 ? 'alpha' : 'ordered'}:${key}`}
                  type="button"
                  onClick={() => setExpandedKey((prev) => (prev === key ? null : key))}
                  ref={(el) => {
                    if (el) evidenceRefs.current.set(key, el);
                    else evidenceRefs.current.delete(key);
                  }}
                  className="rca-card-in w-full text-left rounded-[12px] border px-3 py-2"
                  style={{
                    animationDelay: `${enterDelay}ms`,
                    borderColor: cardSurface.borderColor,
                    background: cardSurface.background,
                    backdropFilter: cardSurface.backdropFilter,
                    boxShadow: highlightApplied
                      ? '0 0 0 1px rgba(34,197,94,0.22), 0 18px 40px rgba(0,0,0,0.18)'
                      : cardSurface.boxShadow,
                    position: 'relative',
                  }}
                >
                  <div
                    aria-hidden
                    style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 3,
                    borderTopLeftRadius: 12,
                    borderBottomLeftRadius: 12,
                    background: barColor,
                    }}
                  />
                  <div className="flex items-center gap-2.5">
                    {/* LED indicator */}
                    <span
                      className="shrink-0 rounded-full"
                      style={{
                        width: 8,
                        height: 8,
                        background: isApplied
                          ? '#22c55e'
                          : isRejected
                            ? '#ef4444'
                            : theme === 'dark' ? 'rgba(148,163,184,0.5)' : 'rgba(100,116,139,0.4)',
                        boxShadow: isApplied
                          ? '0 0 5px rgba(34,197,94,0.70)'
                          : isRejected
                            ? '0 0 5px rgba(239,68,68,0.55)'
                            : 'none',
                      }}
                    />
                    <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
                      <div
                        className="min-w-0 text-[12px] font-medium leading-snug"
                        title={formatTitle(key)}
                        style={{
                          color: tone.text,
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          wordBreak: 'break-word',
                        }}
                      >
                        {formatTitle(key)}
                      </div>
                      <div
                        className="shrink-0 text-[10px] font-bold tracking-[0.14em] whitespace-nowrap"
                        style={{ color: statusColor, minWidth: 112, textAlign: 'right' }}
                      >
                        {statusLabel}
                      </div>
                    </div>
                    <div className="shrink-0 text-[11px] opacity-40" style={{ color: tone.muted }}>
                      {isExpanded ? '▴' : '▾'}
                    </div>
                  </div>
                  {isExpanded && (summary || confidenceLine || reasoning) ? (
                    <div className="mt-1.5 space-y-1.5 pl-[20px]">
                      {summary ? (
                        <div className="text-[11px] leading-relaxed" style={{ color: tone.secondary }}>
                          {dText(String(summary))}
                        </div>
                      ) : null}
                      {reasoning ? (
                        <div className="rounded-[10px] border px-2.5 py-1.5" style={{ borderColor: tone.border, background: tone.fill }}>
                          <div className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: tone.muted }}>
                            Reasoning
                          </div>
                          <div className="mt-0.5 text-[11px] whitespace-pre-wrap leading-relaxed" style={{ color: tone.secondary }}>
                            {dText(String(reasoning))}
                          </div>
                        </div>
                      ) : null}
                      {confidenceLine ? (
                        <div className="text-[10px]" style={{ color: tone.subtle }}>
                          Confidence: {confidenceLine}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Analysis column */}
        <div>
          <div className="text-[18px] font-bold tracking-wide mb-3" style={{ color: tone.text }}>
            Analysis
          </div>

          {phase < 2 ? (
            <div
              className="rounded-[20px] border p-5"
              style={{
                borderColor: cardSurface.borderColor,
                background: cardSurface.background,
                backdropFilter: cardSurface.backdropFilter,
                boxShadow: cardSurface.boxShadow,
              }}
            >
              <div className="text-[12px]" style={{ color: tone.muted }}>Awaiting evidence evaluation…</div>
            </div>
          ) : (
            <div
              ref={analysisCardRef}
              className="rca-hero-in rounded-[20px] border p-6 space-y-4"
              style={{
                borderColor: hasRca ? tone.activeBorder : cardSurfaceStrong.borderColor,
                background: cardSurfaceStrong.background,
                backdropFilter: cardSurfaceStrong.backdropFilter,
                boxShadow: hasRca
                  ? `0 0 0 1px ${tone.activeBorder}, ${cardSurfaceStrong.boxShadow}`
                  : cardSurfaceStrong.boxShadow,
              }}
            >
              <div className="space-y-1">
                <div className="text-[18px] font-bold" style={{ color: tone.text }}>
                  {rcaBucket || 'Root Cause'}
                </div>
                {analysis.rca.rcaSummary ? (
                  <div className="text-[13px] leading-relaxed" style={{ color: tone.secondary }}>
                    {dText(String(analysis.rca.rcaSummary))}
                  </div>
                ) : analysis.rca.longSummary ? (
                  <div className="text-[13px] leading-relaxed" style={{ color: tone.secondary }}>
                    {dText(String(analysis.rca.longSummary))}
                  </div>
                ) : null}
              </div>

              {/* Chain-of-thought reasoning steps */}
              {Array.isArray(analysis.rca.chainOfThought) && (analysis.rca.chainOfThought as any[]).length > 0 ? (
                <RcaReasoningSteps steps={analysis.rca.chainOfThought as any[]} tone={tone} />
              ) : null}

              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="inline-flex items-center rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em]"
                  style={{ background: tone.activeFill, color: tone.activeText, border: `1px solid ${tone.activeBorder}` }}
                >
                  {appliedCount} intuitions applied
                </span>
              </div>

              {recommendation?.title ? (
                <div
                  className="rounded-[16px] border px-4 py-3 space-y-1"
                  style={{
                    borderColor: tone.border,
                    background: tone.fill,
                  }}
                >
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: tone.muted }}>Recommendation</div>
                  <div className="text-[13px] font-semibold" style={{ color: tone.text }}>{recommendation.title}</div>
                  {recommendation.justification ? (
                    <div className="text-[12px] leading-relaxed" style={{ color: tone.secondary }}>
                      {recommendation.justification}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* ── CTA ──────────────────────────────────────────────────── */}
      {phase >= 2 && !hideCta && (
        <div className="rca-card-in flex items-center justify-center pt-2 pb-4" style={{ animationDelay: '200ms' }}>
          <button
            type="button"
            onClick={onSwitchToDiagnostic}
            className="group flex items-center gap-2.5 rounded-full border px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] transition-all duration-200"
            style={{ borderColor: tone.border, color: tone.muted, background: 'transparent' }}
          >
            <span>View Diagnostics</span>
            <svg className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-1" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

export default function ObserveSiteAnalysisTile({
  site,
  selectedDateId,
  onClose,
  onRcaMapSignals: _onRcaMapSignals,
  panelMode,
  onPanelModeChange,
}: ObserveSiteAnalysisTileProps) {
  const { theme } = useTheme();
  // Site is "red" (has RCA) iff it's in the offender set — the canonical signal
  // that drives both the map marker color and whether RCA data is generated.
  // We no longer key off site.status because RCA availability is the authority.
  const { offenderSiteIds: offenderSiteIdsFromCtx } = useMapData();
  const isRedSite = useMemo(() => {
    const sid = String(site.siteId || '');
    const rsid = String(site.realSiteId || '');
    return offenderSiteIdsFromCtx.has(sid) || (rsid ? offenderSiteIdsFromCtx.has(rsid) : false);
  }, [offenderSiteIdsFromCtx, site.siteId, site.realSiteId]);
  const isOutageSite = site.status === 'OUTAGE';
  const isTopDegradedSite = isRedSite && !isOutageSite;
  const statusLabel = isOutageSite ? 'OUTAGE' : (isTopDegradedSite ? 'TOP DEGRADED' : site.status);
  const statusTone = isOutageSite
    ? { bg: 'rgba(239,68,68,0.14)', fg: '#ef4444', border: 'rgba(239,68,68,0.30)', ping: 'bg-red-400', dot: 'bg-red-500' }
    : { bg: 'rgba(239,68,68,0.09)', fg: '#f87171', border: 'rgba(239,68,68,0.22)', ping: 'bg-red-300', dot: 'bg-red-400' };
  const [state, setState] = useState<KpiWorkbenchState>({
    topTab: isRedSite ? 'rca' : 'site-kpi',
    kpiTab: 'cqx',
    granularity: 'daily',
    selectedKpis: [...DEFAULT_KPIS],
    cqxMetric: DEFAULT_CQX_METRICS[0],
  });
  const [viewMode, setViewMode] = useState<'summary' | 'diagnostic'>(isRedSite ? 'summary' : 'diagnostic');
  const [cqxDataType, setCqxDataType] = useState<'impact' | 'value'>('impact');
  const [rcaSubTab, setRcaSubTab] = useState<'evidences' | 'summary' | 'raw-data'>(isRedSite ? 'summary' : 'evidences');
  const [hoveredRailTab, setHoveredRailTab] = useState<string | null>(null);
  const [activeKpis, setActiveKpis] = useState<string[]>([...DEFAULT_KPIS]);
  const [selectedFaces, setSelectedFaces] = useState<string[]>([]);
  const [selectedBands, setSelectedBands] = useState<string[]>([]);
  const [selectedTechs, setSelectedTechs] = useState<string[]>([]);
  const [daysBack, setDaysBack] = useState(30);
  const [addKpiOpen, setAddKpiOpen] = useState(false);
  const [kpiSearch, setKpiSearch] = useState('');
  const tone = panelTone(theme);
  const { dId, dText } = useDummifier();
  const rawRealSiteId = site.realSiteId || site.siteId;
  const realSiteId = rawRealSiteId;
  const displayRealSiteId = dId(rawRealSiteId);

  // ── Chat-driven tab / view navigation ──────────────────────────────────────
  // (offenderSiteIds already pulled above for isRedSite)
  const { chatTabRequest } = useMapData();
  useEffect(() => {
    if (!chatTabRequest) return;
    if (chatTabRequest.viewMode) {
      setViewMode(chatTabRequest.viewMode);
    }
    if (chatTabRequest.topTab) {
      setState(prev => ({ ...prev, topTab: chatTabRequest.topTab! }));
    }
    if (chatTabRequest.kpiTab) {
      // Switching to a KPI sub-tab implies we should also be on site-kpi top tab
      setState(prev => ({ ...prev, topTab: 'site-kpi', kpiTab: chatTabRequest.kpiTab! }));
    }
    if (chatTabRequest.rcaSubTab) {
      // Switching to an RCA sub-tab implies we should be on the rca top tab
      setState(prev => ({ ...prev, topTab: 'rca' }));
      setRcaSubTab(chatTabRequest.rcaSubTab);
    }
  }, [chatTabRequest]);

  const nodesPillRef = useRef<HTMLSpanElement | null>(null);
  const nodesPopoverRef = useRef<HTMLDivElement | null>(null);
  const [nodesPopoverOpen, setNodesPopoverOpen] = useState(false);
  const [nodesPopoverPos, setNodesPopoverPos] = useState<{ left: number; top: number; width: number } | null>(null);

  const updateNodesPopoverPos = useCallback(() => {
    const rect = nodesPillRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(260, Math.min(340, rect.width * 2.2));
    setNodesPopoverPos({ left: rect.left, top: rect.bottom + 10, width });
  }, []);

  const closeNodesPopover = useCallback(() => setNodesPopoverOpen(false), []);

  const toggleNodesPopover = useCallback(() => {
    setNodesPopoverOpen((prev) => {
      const next = !prev;
      if (next) updateNodesPopoverPos();
      return next;
    });
  }, [updateNodesPopoverPos]);

  useEffect(() => {
    if (!nodesPopoverOpen) return;
    const onReposition = () => updateNodesPopoverPos();
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [nodesPopoverOpen, updateNodesPopoverPos]);

  // Close nodes popover on outside click / Esc (so it stays open for copy/paste).
  useEffect(() => {
    if (!nodesPopoverOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (nodesPillRef.current?.contains(target)) return;
      if (nodesPopoverRef.current?.contains(target)) return;
      closeNodesPopover();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeNodesPopover();
    };
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [nodesPopoverOpen, closeNodesPopover]);

  const analysis = useSectionState<SiteAnalysisPayload | null>(
    () => api.getSiteComprehensiveAnalysis(realSiteId, selectedDateId).then((response) => response.data ?? null),
    [realSiteId, selectedDateId]
  );

  const topology = useSectionState<SiteTopologyPayload | null>(
    () => api.getSiteCellTopology(realSiteId, selectedDateId).then((response) => response.data ?? null),
    [realSiteId, selectedDateId]
  );

  const nodes = useSectionState<string[]>(
    () => api.getCompassNodesForUsid(realSiteId, selectedDateId).then((rows) => rows || []),
    [realSiteId, selectedDateId]
  );

  const operational = useSectionState<OperationalInfoPayload | null>(
    () => api.getSiteOperationalWorkbench(realSiteId, selectedDateId).then((response) => response.data ?? null),
    [realSiteId, selectedDateId]
  );

  // Always fetch subcomponent_table (has Total_Impact_Mkt_CQX + _Delta) for the top totals chart.
  const cqxTotals = useSectionState<CqxResponse>(
    state.topTab === 'site-kpi' && state.kpiTab === 'cqx'
      ? () =>
          api.getCompassSubcomponentData(realSiteId, selectedDateId, 30).then((rows) => ({
            usid: realSiteId,
            dateId: selectedDateId,
            dataType: 'value' as const,
            subcomponentData: rows || [],
          }))
      : null,
    [realSiteId, selectedDateId, state.topTab, state.kpiTab]
  );

  const cqx = useSectionState<CqxResponse>(
    state.topTab === 'site-kpi' && state.kpiTab === 'cqx'
      ? () =>
          (cqxDataType === 'impact'
            ? api.getCompassSubcomponentImpact(realSiteId, selectedDateId, 30)
            : api.getCompassSubcomponentData(realSiteId, selectedDateId, 30)
          ).then((rows) => ({
            usid: realSiteId,
            dateId: selectedDateId,
            dataType: cqxDataType,
            subcomponentData: rows || [],
          }))
      : null,
    [realSiteId, selectedDateId, state.topTab, state.kpiTab, cqxDataType]
  );

  const displayedAnalysis: SiteAnalysisPayload = analysis.data ?? {
    usid: realSiteId, dateId: selectedDateId,
    topology: { siteName: site.siteName, latitude: site.latitude, longitude: site.longitude, district: '', zoneId: '', zoneEngineer: '', engineerUid: '', managerUid: '', market: '', siteType: '', structureType: '', cellCount: site.cellCount, county: '', city: '', state: '', streetAddress: '', zip: '', clusterId: '', clusterName: '' },
    strongestFactors: [],
    rca: { bucket: '', shortSummary: {}, longSummary: '', rcaSummary: '', chainOfThought: [], confidenceScore: null, confidenceScoreInt: null, solutionRecommendation: '', solutionSummary: '', degradedCategory: '', rcaTraversal: null },
    intuitions: {},
    summaries: { kpi: '', ticket: '', alarm: '', neighbor: '', parameter: '', outage: '' },
    outage: { flag: false, timestamp: '' },
    metadata: { runTimeSeconds: null, tokenAndCostUsage: null, updateTime: '', anomalyFlag: false, anomalyScore: null },
  };
  const displayedTopology: SiteTopologyPayload = topology.data ?? { usid: realSiteId, dateId: selectedDateId, cellTopology: [] };
  // RCA tab/mode visibility is driven purely by whether the RCA payload has real content.
  // A site is "red" (offender) iff it has RCA — so anytime we get a payload, show it.
  const hasRcaData = Boolean(
    extractText(displayedAnalysis.rca.bucket) || (displayedAnalysis.rca.chainOfThought as any[])?.length
  );
  const visibleTopTabs = TOP_TABS.filter((tab) => tab.id !== 'rca' || hasRcaData);

  // If the active top tab is 'rca' but RCA is no longer visible, fall back to 'site-kpi'
  useEffect(() => {
    if (state.topTab === 'rca' && !hasRcaData) {
      setState((prev) => ({ ...prev, topTab: 'site-kpi' }));
    }
  }, [hasRcaData, state.topTab]);

  // When RCA data arrives for a red site, ensure the panel lands on the RCA → Summary view.
  // Guarded by a ref so we don't clobber user-driven tab changes.
  const rcaAutoLandedRef = useRef(false);
  useEffect(() => {
    if (!isRedSite) return;
    if (!hasRcaData) return;
    if (rcaAutoLandedRef.current) return;
    rcaAutoLandedRef.current = true;
    setState((prev) => (prev.topTab === 'rca' ? prev : { ...prev, topTab: 'rca' }));
    setViewMode('summary');
    setRcaSubTab('summary');
  }, [isRedSite, hasRcaData]);
  const displayedOperational: OperationalInfoPayload = operational.data ?? { usid: realSiteId, dateId: selectedDateId, siteRows: [], neighborRows: [] };
  // cell meta: face/band/tech per cellName derived from topology
  const cellMeta = useMemo(() => {
    const map = new Map<string, { face: string; band: string; tech: string }>();
    for (const c of displayedTopology.cellTopology) {
      const id = (c.useId || c.cellName || '');
      let face = '?';
      let band = c.carrier || 'Unknown';

      // Face: alphabetic character at end of 2nd underscore-segment (e.g. CVL01419_2A_1 → "A")
      // Band: topology CARRIER field (e.g. "AWS", "700 MHz", "PCS") — meaningful label from DB
      const nameParts = id.split('_');
      if (nameParts.length >= 2) {
        const seg = nameParts[1]; // e.g. "2A", "14B"
        const faceChar = seg.match(/([A-C])$/i);
        if (faceChar) face = faceChar[1].toUpperCase();
      }
      if (face === '?' && c.azimuth != null) {
        const az = ((c.azimuth % 360) + 360) % 360;
        face = az < 120 ? 'A' : az < 240 ? 'B' : 'C';
      }

      map.set(c.cellName, { face, band, tech: c.technology || 'Unknown' });
    }
    return map;
  }, [displayedTopology.cellTopology]);

  const uniqueFaces = useMemo(() => [...new Set(Array.from(cellMeta.values()).map((m) => m.face))].sort(), [cellMeta]);
  const uniqueBands = useMemo(() => [...new Set(Array.from(cellMeta.values()).map((m) => m.band))].sort(), [cellMeta]);
  const uniqueTechs = useMemo(() => [...new Set(Array.from(cellMeta.values()).map((m) => m.tech))].sort(), [cellMeta]);

  // Initialize selections to "all" when topology first loads
  useEffect(() => {
    if (uniqueFaces.length > 0 && selectedFaces.length === 0) setSelectedFaces(uniqueFaces);
  }, [uniqueFaces]);
  useEffect(() => {
    if (uniqueBands.length > 0 && selectedBands.length === 0) setSelectedBands(uniqueBands);
  }, [uniqueBands]);
  useEffect(() => {
    if (uniqueTechs.length > 0 && selectedTechs.length === 0) setSelectedTechs(uniqueTechs);
  }, [uniqueTechs]);

  const availableKpis = useSectionState<string[]>(
    state.topTab === 'site-kpi' && ['daily', 'hourly', 'overlay'].includes(state.kpiTab)
      ? () => api.getSiteAvailableKpis(realSiteId, state.kpiTab === 'hourly' ? 'hourly' : 'daily').then((response) => response.data || DEFAULT_KPIS)
      : null,
    [realSiteId, state.topTab, state.kpiTab]
  );

  // Daily / hourly / overlay use per-KPI KpiChartPanel components for parallel lazy loading.

  const mobility = useSectionState<MobilityTrendResponse>(
    state.topTab === 'site-kpi' && ['traffic-profile', 'mobility'].includes(state.kpiTab)
      ? () =>
          api.getCompassNeighborTrends(realSiteId, 30).then((rows) => {
            if (!rows?.length) return { usid: realSiteId, dateId: selectedDateId, days: 30, data: [] } as MobilityTrendResponse;
            return {
              usid: realSiteId,
              dateId: selectedDateId,
              days: 30,
              data: rows.map((row, index) => ({
                sourceUsid: String(getField(row as Record<string, any>, ['SOURCE_USID', 'source_usid']) || realSiteId),
                sourceFace: String(getField(row as Record<string, any>, ['SOURCE_USID_FACE', 'source_usid_face']) || 'A'),
                neighborUsid: String(getField(row as Record<string, any>, ['NEIGH_USID', 'neigh_usid']) || ''),
                neighborFace: String(getField(row as Record<string, any>, ['NEIGH_USID_FACE', 'neigh_usid_face']) || 'A'),
                handoverCount: toNum(getField(row as Record<string, any>, ['HANDOVER_COUNT', 'handover_count'])),
                rank: index + 1,
                totalHandover: null,
                cumulativeSum: null,
                handoverPercent: toNum(getField(row as Record<string, any>, ['PERC_HANDOVER', 'perc_handover'])),
                distanceMeters: null,
                dateId: String(getField(row as Record<string, any>, ['DATE_ID', 'date_id']) || selectedDateId).slice(0, 10),
              })),
            } as MobilityTrendResponse;
          })
      : null,
    [realSiteId, selectedDateId, state.topTab, state.kpiTab]
  );

  const traffic = useSectionState<TrafficProfileResponse | null>(
    state.topTab === 'site-kpi' && state.kpiTab === 'traffic-profile'
      ? () => api.getSiteTrafficProfile(realSiteId, selectedDateId).then((response) => response.data ?? null)
      : null,
    [realSiteId, selectedDateId, state.topTab, state.kpiTab]
  );

  const siteOutages = useSectionState<any[]>(
    state.topTab === 'site-kpi' && state.kpiTab === 'outages'
      ? () =>
          api.getCompassSiteNeighborOutages(realSiteId, selectedDateId, 14).then((rows) => {
            if (Array.isArray(rows)) return rows;
            return [];
          })
      : null,
    [realSiteId, selectedDateId, state.topTab, state.kpiTab]
  );

  // Compass operational data: alarms, tickets, config, outages, EIM
  const [compassOpTab, setCompassOpTab] = useState<'cell-topology' | 'neighbors' | 'alarms' | 'tickets' | 'config' | 'outages' | 'eim'>('cell-topology');
  const compassOperational = useSectionState<{
    alarms: Array<Record<string, unknown>>;
    tickets: Array<Record<string, unknown>>;
    config_changes: Array<Record<string, unknown>>;
    outages: Array<Record<string, unknown>>;
    eim: Array<Record<string, unknown>>;
  }>(
    state.topTab === 'operational'
      ? () => api.getCompassSiteOperational(realSiteId, selectedDateId).then((data) => ({
          alarms: data.alarms || [],
          tickets: data.tickets || [],
          config_changes: data.config_changes || [],
          outages: data.outages || [],
          eim: data.eim || [],
        }))
      : null,
    [realSiteId, selectedDateId, state.topTab]
  );

  useEffect(() => {
    if (availableKpis.data && availableKpis.data.length && !state.selectedKpis.length) {
      setState((prev) => ({ ...prev, selectedKpis: availableKpis.data!.slice(0, 3) }));
    }
  }, [availableKpis.data, state.selectedKpis.length]);

  // Sync activeKpis with what the DB actually has for this site.
  // DEFAULT_KPIS may not match the DB's kpi_name casing/format — auto-select real names.
  useEffect(() => {
    if (!availableKpis.data?.length) return;
    const available = availableKpis.data;
    const availableSet = new Set(available.map((k) => k.toUpperCase()));
    const validActive = activeKpis.filter((kpi) => availableSet.has(kpi.toUpperCase()));
    if (validActive.length === 0) {
      // None of the current KPIs exist in DB — fall back to first 8 available
      setActiveKpis(available.slice(0, 8));
    } else if (validActive.length < activeKpis.length) {
      // Some KPIs not available — keep only valid ones
      setActiveKpis(validActive);
    }
  }, [availableKpis.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset activeKpis when switching to a different site
  useEffect(() => {
    setActiveKpis([...DEFAULT_KPIS]);
  }, [realSiteId]);


  const cqxMetricOptions = useMemo(() => {
    const sample = cqxTotals.data?.subcomponentData[0] || {};
    const keys = Object.keys(sample).filter((key) => key !== 'DATE_ID' && key !== 'USID');
    const preferred = DEFAULT_CQX_METRICS.filter((metric) => keys.includes(metric));
    const remaining = keys
      .filter((key) => !DEFAULT_CQX_METRICS.includes(key))
      .sort((a, b) => a.localeCompare(b));
    return [...preferred, ...remaining].slice(0, 16);
  }, [cqxTotals.data]);

  useEffect(() => {
    if (cqxMetricOptions.length && !cqxMetricOptions.includes(state.cqxMetric)) {
      const nextMetric = cqxMetricOptions[0] ?? DEFAULT_CQX_METRICS[0];
      setState((prev) => ({ ...prev, cqxMetric: nextMetric }));
    }
  }, [cqxMetricOptions, state.cqxMetric]);

  const cqxChart = useMemo<EChartsOption>(() => {
    const rows = cqxTotals.data?.subcomponentData || [];
    const toneBase = baseChartOption(theme);
    const labels = rows.map((row) => String(row.DATE_ID || '').slice(0, 10)).slice(-30);
    const values = rows.map((row) => Number(row[state.cqxMetric] || 0)).slice(-30);
    return {
      ...toneBase,
      grid: { left: 52, right: 24, top: 36, bottom: 48 },
      xAxis: { ...(toneBase.xAxis as object), data: labels, axisLabel: { ...(toneBase.xAxis as any).axisLabel, formatter: formatDateLabel } },
      series: [
        {
          name: formatTitle(state.cqxMetric),
          type: 'line' as const,
          smooth: true,
          symbol: 'circle',
          symbolSize: 7,
          data: values,
          lineStyle: { width: 2.5, color: panelTone(theme).activeText },
          areaStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: theme === 'dark' ? 'rgba(129,140,248,0.28)' : 'rgba(79,70,229,0.18)' },
                { offset: 1, color: 'rgba(0,0,0,0)' },
              ],
            },
          },
          itemStyle: { color: panelTone(theme).activeText, borderColor: theme === 'dark' ? '#1c1c1e' : '#fff', borderWidth: 2 },
        },
      ],
    };
  }, [cqxTotals.data, selectedDateId, site, state.cqxMetric, theme]);

  // Insights/Correlation views intentionally removed for redesign.

  const mobilityChart = useMemo<EChartsOption | null>(() => {
    const mobilityData: MobilityTrendResponse = mobility.data || {
      usid: realSiteId,
      dateId: selectedDateId,
      days: 30,
      data: [],
    };
    const toneBase = baseChartOption(theme);
    const grouped = new Map<string, number>();
    mobilityData.data.forEach((row) => {
      const target = String(row.neighborFace || row.neighborUsid || '').trim();
      if (!target) return;
      grouped.set(target, (grouped.get(target) || 0) + row.handoverCount);
    });
    const labels = Array.from(grouped.entries())
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))
      .slice(0, 10)
      .map(([k]) => k);
    return {
      ...toneBase,
      grid: { left: 48, right: 24, top: 36, bottom: 24 },
      xAxis: { type: 'value', axisLabel: { color: panelTone(theme).muted }, splitLine: { lineStyle: { color: panelTone(theme).grid } } },
      yAxis: { type: 'category', axisLabel: { color: panelTone(theme).muted }, data: labels },
      series: [{ type: 'bar', data: labels.map((label) => grouped.get(label) || 0), itemStyle: { color: theme === 'dark' ? '#818cf8' : '#4f46e5', borderRadius: [0, 8, 8, 0] } }],
    };
  }, [mobility.data, realSiteId, selectedDateId, site, theme]);

  const mobilityFaceCharts = useMemo<Array<{ sourceFace: string; option: EChartsOption }> | null>(() => {
    const mobilityData: MobilityTrendResponse = mobility.data || {
      usid: realSiteId,
      dateId: selectedDateId,
      days: 30,
      data: [],
    };
    const toneBase = baseChartOption(theme);
    if (!mobilityData.data.length) return null;

    const allDates = Array.from(new Set(mobilityData.data.map((r) => String(r.dateId || '').slice(0, 10)))).sort();
    const tone = panelTone(theme);
    const palette = [tone.primary, tone.secondary, tone.accent, tone.tertiary, '#f59e0b', '#22c55e', '#ef4444', '#38bdf8'];

    // Group by SOURCE_USID_FACE; within each group create traces to TARGET_USID_FACE over time.
    const bySourceFace = new Map<string, MobilityTrendResponse['data']>();
    for (const row of mobilityData.data) {
      const source = String(row.sourceFace || '').trim() || 'Unknown';
      if (!bySourceFace.has(source)) bySourceFace.set(source, []);
      bySourceFace.get(source)!.push(row);
    }

    const charts: Array<{ sourceFace: string; option: EChartsOption }> = [];
    for (const [sourceFace, rows] of Array.from(bySourceFace.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      const byTarget = new Map<string, Map<string, number>>();
      const targetTotals = new Map<string, number>();

      for (const row of rows) {
        const target = String(row.neighborFace || row.neighborUsid || '').trim();
        if (!target) continue;
        const date = String(row.dateId || '').slice(0, 10);
        if (!byTarget.has(target)) byTarget.set(target, new Map());
        const dateMap = byTarget.get(target)!;
        dateMap.set(date, (dateMap.get(date) || 0) + (row.handoverCount || 0));
        targetTotals.set(target, (targetTotals.get(target) || 0) + (row.handoverCount || 0));
      }

      const rankedTargets = Array.from(targetTotals.entries())
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))
        .map(([t]) => t);

      const MAX_TRACES = 7;
      const keep = rankedTargets.slice(0, MAX_TRACES);
      const otherTargets = rankedTargets.slice(MAX_TRACES);

      const series: any[] = keep.map((target, idx) => ({
        name: target,
        type: 'line' as const,
        smooth: true,
        showSymbol: false,
        data: allDates.map((d) => byTarget.get(target)?.get(d) || 0),
        lineStyle: { width: 2, color: palette[idx % palette.length] },
        itemStyle: { color: palette[idx % palette.length] },
      }));

      if (otherTargets.length) {
        const otherMap = new Map<string, number>();
        for (const target of otherTargets) {
          const dateMap = byTarget.get(target);
          if (!dateMap) continue;
          for (const [d, v] of dateMap.entries()) {
            otherMap.set(d, (otherMap.get(d) || 0) + v);
          }
        }
        series.push({
          name: `Other (${otherTargets.length})`,
          type: 'line' as const,
          smooth: true,
          showSymbol: false,
          data: allDates.map((d) => otherMap.get(d) || 0),
          lineStyle: { width: 2, type: 'dashed', color: 'rgba(148,163,184,0.85)' },
          itemStyle: { color: 'rgba(148,163,184,0.85)' },
        });
      }

      charts.push({
        sourceFace,
        option: {
          ...toneBase,
          grid: { left: 54, right: 28, top: 46, bottom: 34 },
          xAxis: {
            ...(toneBase.xAxis as object),
            data: allDates,
            axisLabel: {
              ...((toneBase.xAxis as any).axisLabel || {}),
              rotate: 25,
              hideOverlap: true,
              formatter: formatDateLabel,
            },
          },
          legend: { ...(toneBase.legend as object), type: 'scroll' as const, top: 10 },
          tooltip: { ...(toneBase.tooltip as object), trigger: 'axis' as const },
          series,
        },
      });
    }

    return charts;
  }, [mobility.data, realSiteId, selectedDateId, site, theme]);

  const trafficCharts = useMemo(() => {
    const trafficData: TrafficProfileResponse = traffic.data || {
      usid: realSiteId,
      dateId: selectedDateId,
      bandTraffic: [],
      sectorTraffic: [],
      neighborTraffic: [],
      handoverImpact: [],
    };
    const toneBase = baseChartOption(theme);
    const band = {
      ...toneBase,
      xAxis: { ...(toneBase.xAxis as object), data: trafficData.bandTraffic.map((row) => row.dimension) },
      series: [{ type: 'bar', data: trafficData.bandTraffic.map((row) => row.totalTrafficGb), itemStyle: { color: theme === 'dark' ? '#818cf8' : '#4f46e5', borderRadius: [8, 8, 0, 0] } }],
    } as EChartsOption;
    const sector = {
      ...toneBase,
      xAxis: { ...(toneBase.xAxis as object), data: trafficData.sectorTraffic.map((row) => row.dimension) },
      series: [{ type: 'bar', data: trafficData.sectorTraffic.map((row) => row.totalTrafficGb), itemStyle: { color: theme === 'dark' ? '#a5b4fc' : '#7c3aed', borderRadius: [8, 8, 0, 0] } }],
    } as EChartsOption;
    return { band, sector };
  }, [realSiteId, selectedDateId, site, theme, traffic.data]);

  const cqxRows = cqx.data?.subcomponentData || [];
  const trafficSeriesKeys = ['LTE_PDCP_MB', 'SA_PDCP_MB', 'NR_PDCP_MB', 'SMALLCELL_PDCP_MB'].filter((key) => cqxRows.some((row) => row[key] != null));
  const qualitySeriesKeys = ['QUALITY', 'DATA_ACC', 'DATA_DROP', 'TPUT'].filter((key) => cqxRows.some((row) => row[key] != null));

  const trafficKpiChart = useMemo<EChartsOption>(() => {
    const toneBase = baseChartOption(theme);
    const palette = [panelTone(theme).tertiary, panelTone(theme).secondary, panelTone(theme).accent, '#f59e0b'];
    const labels = cqxRows.map((row) => String(row.DATE_ID || '').slice(0, 10)).slice(-30);
    return {
      ...toneBase,
      xAxis: {
        ...(toneBase.xAxis as object),
        data: labels,
        axisLabel: {
          ...((toneBase.xAxis as any).axisLabel || {}),
          rotate: 25,
          hideOverlap: true,
          formatter: formatDateLabel,
        },
      },
      legend: { ...(toneBase.legend as object), top: 10 },
      series: trafficSeriesKeys.map((seriesKey, index) => ({
        name: formatTitle(seriesKey),
        type: 'line' as const,
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        data: cqxRows.map((row) => Number(row[seriesKey] || 0)).slice(-30),
        lineStyle: { width: 2, color: palette[index % palette.length] },
        itemStyle: { color: palette[index % palette.length] },
      })),
    };
  }, [cqxRows, theme, trafficSeriesKeys]);

  const qualityKpiChart = useMemo<EChartsOption>(() => {
    const toneBase = baseChartOption(theme);
    const impactKeys = Object.keys(cqxRows[0] || {}).filter((key) => key.endsWith('_IMP'));
    const primaryKeys = cqxDataType === 'impact'
      ? impactKeys
      : ['QUALITY', 'DATA_ACC', 'VRAN_ACC', 'DATA_DROP', 'VCDR_DROP', 'NS_ESO', 'VCDR_ACC'].filter((key) => cqxRows.some((row) => row[key] != null));
    const secondaryKeys = cqxDataType === 'impact'
      ? []
      : ['TPUT', 'UL_TPUT'].filter((key) => cqxRows.some((row) => row[key] != null));
    const palette = ['#22c55e', '#94a3b8', '#cbd5e1', '#f59e0b', '#e2e8f0', '#ec4899', '#14b8a6', '#64748b'];
    const labels = cqxRows.map((row) => String(row.DATE_ID || '').slice(0, 10)).slice(-30);
    return {
      ...toneBase,
      xAxis: {
        ...(toneBase.xAxis as object),
        data: labels,
        axisLabel: {
          ...((toneBase.xAxis as any).axisLabel || {}),
          rotate: 25,
          hideOverlap: true,
          formatter: formatDateLabel,
        },
      },
      legend: { ...(toneBase.legend as object), top: 10 },
      yAxis: [
        {
          type: 'value',
          axisLabel: { color: panelTone(theme).muted, fontSize: 11 },
          splitLine: { lineStyle: { color: panelTone(theme).grid, type: 'dashed' } },
          axisTick: { show: false },
        },
        {
          type: 'value',
          axisLabel: { color: panelTone(theme).muted, fontSize: 11 },
          splitLine: { show: false },
          axisTick: { show: false },
        },
      ],
      series: [...primaryKeys, ...secondaryKeys].map((seriesKey, index) => ({
        name: formatTitle(seriesKey),
        type: 'line' as const,
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        data: cqxRows.map((row) => Number(row[seriesKey] || 0)).slice(-30),
        lineStyle: { width: 2, color: palette[index % palette.length] },
        itemStyle: { color: palette[index % palette.length] },
        yAxisIndex: secondaryKeys.includes(seriesKey) ? 1 : 0,
      })),
    };
  }, [cqxDataType, cqxRows, theme]);

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{
        background:
          theme === 'dark'
            ? 'linear-gradient(180deg, rgba(18,18,20,0.30) 0%, rgba(14,14,16,0.18) 100%)'
            : 'linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(248,250,252,0.14) 100%)',
      }}
    >
      <div
        className="flex-shrink-0 border-b"
        style={{
          borderColor: tone.border,
          background: theme === 'dark' ? 'rgba(18,18,20,0.55)' : 'rgba(255,255,255,0.38)',
          backdropFilter: 'blur(18px)',
        }}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3">
	          {/* Site identity */}
	          <div className="min-w-0 flex-1 flex items-center gap-2">
	            <div className="min-w-0 flex items-center gap-2">
	              <h2 className="truncate text-[14px] font-semibold text-slate-950 dark:text-slate-50">
	                {displayRealSiteId}
	              </h2>
	              <span
	                ref={nodesPillRef}
	                onClick={toggleNodesPopover}
	                className="hidden sm:inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] cursor-pointer"
	                style={{
	                  borderColor: nodesPopoverOpen ? tone.activeBorder : tone.border,
	                  color: nodesPopoverOpen ? tone.activeText : tone.muted,
	                  background: nodesPopoverOpen
	                    ? (theme === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.06)')
	                    : (theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.04)'),
	                  userSelect: 'none',
	                }}
	                title="Show node list"
	              >
	                Nodes
	                <span className="text-[10px] font-mono opacity-70">
	                  {nodes.loading ? '…' : `(${(nodes.data || []).length})`}
	                </span>
	              </span>
	              {isRedSite ? (
	                <span
	                  className="shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em]"
	                  style={{
	                    background: statusTone.bg,
	                    color: statusTone.fg,
	                    border: `1px solid ${statusTone.border}`,
	                  }}
	                >
	                  <span className="relative flex h-1.5 w-1.5">
	                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${statusTone.ping} opacity-75`} />
	                    <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${statusTone.dot}`} />
	                  </span>
	                  {statusLabel}
	                </span>
	              ) : null}
	            </div>
	          </div>

          {/* Mode toggle pill — only for red sites */}
	          {isRedSite && (
            <div
              className="flex items-center rounded-full p-0.5 shrink-0"
              style={{
                background: theme === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.06)',
                border: `1px solid ${tone.border}`,
              }}
            >
	              <button
	                type="button"
	                onClick={() => setViewMode('summary')}
	                className="rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] transition-all duration-200"
	                style={{
	                  background: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)',
	                  color: viewMode === 'summary' ? tone.primary : tone.muted,
	                  boxShadow: viewMode === 'summary' ? `inset 0 0 0 1px ${tone.activeBorder}` : 'none',
	                }}
	              >
	                Summary
	              </button>
              <button
                type="button"
                onClick={() => {
                  // When switching Summary → Diagnostic, land on the KPI tab
                  // first so the user sees measurements before deep-dive views
                  // like RCA / Operational / Topology.
                  if (viewMode !== 'diagnostic') {
                    setState((prev) => (prev.topTab === 'site-kpi' ? prev : { ...prev, topTab: 'site-kpi' }));
                  }
                  setViewMode('diagnostic');
                }}
                className="rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] transition-all duration-200"
                style={{
                  background: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)',
                  color: viewMode === 'diagnostic' ? tone.primary : tone.muted,
                  boxShadow: viewMode === 'diagnostic' ? `inset 0 0 0 1px ${tone.activeBorder}` : 'none',
                }}
              >
                Diagnostic
              </button>
            </div>
          )}

          {/* Window controls */}
	          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onPanelModeChange(panelMode === 'split' ? 'overlay' : 'split')}
              className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors"
              style={{
                borderColor: panelMode === 'split' ? tone.primary : tone.border,
                backgroundColor: panelMode === 'split' ? tone.fill : tone.surfaceElevated,
                color: panelMode === 'split' ? tone.primary : tone.muted,
              }}
              title={panelMode === 'split' ? 'Return to overlay view' : 'Dock to split view'}
            >
              <span className="text-[13px] leading-none">◫</span>
            </button>
            <button
              type="button"
              onClick={() => onPanelModeChange(panelMode === 'full' ? 'overlay' : 'full')}
              className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors"
              style={{
                borderColor: panelMode === 'full' ? tone.primary : tone.border,
                backgroundColor: panelMode === 'full' ? tone.fill : tone.surfaceElevated,
                color: panelMode === 'full' ? tone.primary : tone.muted,
              }}
              title={panelMode === 'full' ? 'Exit full screen' : 'Expand to full screen'}
            >
              <span className="text-[13px] leading-none">⤢</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg border text-[20px] leading-none transition-colors"
              style={{ borderColor: tone.border, backgroundColor: tone.surfaceElevated, color: tone.muted }}
              aria-label="Close"
            >
              ×
            </button>
	          </div>
	        </div>

	        {nodesPopoverOpen && nodesPopoverPos
	          ? createPortal(
	              <div
	                ref={nodesPopoverRef}
	                className="rounded-2xl border p-3 shadow-2xl"
	                style={{
	                  position: 'fixed',
	                  left: nodesPopoverPos.left,
	                  top: nodesPopoverPos.top,
	                  width: nodesPopoverPos.width,
	                  zIndex: 9999,
	                  borderColor: tone.border,
	                  background: theme === 'dark' ? 'rgba(17,17,19,0.92)' : 'rgba(255,255,255,0.92)',
	                  backdropFilter: 'blur(16px)',
	                }}
	              >
	                <div className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: tone.muted }}>
	                  Nodes
	                </div>
	                <div className="mt-2 max-h-44 overflow-auto pr-1">
	                  {(nodes.data || []).length ? (
	                    <ul className="space-y-1">
	                      {(nodes.data || []).map((node) => (
	                        <li
	                          key={node}
	                          className="rounded-lg px-2.5 py-1.5 text-[12px]"
	                          style={{
	                            color: tone.text,
	                            background: theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.03)',
	                            border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)'}`,
	                          }}
	                        >
	                          {node}
	                        </li>
	                      ))}
	                    </ul>
	                  ) : (
	                    <div className="text-[12px]" style={{ color: tone.secondary }}>
	                      {nodes.loading ? 'Loading…' : 'No nodes found'}
	                    </div>
	                  )}
	                </div>
	              </div>,
	              document.body
	            )
	          : null}

	        {/* Diagnostic sub-tabs (only visible in diagnostic mode) */}
	        {viewMode === 'diagnostic' && (
	          <div className="px-5 pb-3">
            <div
              className="grid overflow-hidden rounded-none border"
              style={{
                gridTemplateColumns: `repeat(${visibleTopTabs.length}, 1fr)`,
                borderColor: tone.border,
                backgroundColor: theme === 'dark' ? 'rgba(32,32,32,0.55)' : 'rgba(248,250,252,0.46)',
                backdropFilter: 'blur(12px)',
              }}
            >
              {visibleTopTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setState((prev) => ({ ...prev, topTab: tab.id }))}
                  className="border-r px-4 py-3 text-center text-[13px] font-medium uppercase tracking-[0.08em] transition-colors last:border-r-0"
                  style={{
                    borderColor: tone.border,
                    backgroundColor: state.topTab === tab.id ? tone.activeFill : 'transparent',
                    color: state.topTab === tab.id ? tone.activeText : tone.muted,
                    boxShadow: state.topTab === tab.id ? `inset 0 -2px 0 ${tone.activeText}` : 'none',
                    fontWeight: state.topTab === tab.id ? 600 : undefined,
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">

        {/* ═══════════════════════════════════════════════════════
            SUMMARY MODE — animated RCA view (red sites only)
            ═══════════════════════════════════════════════════════ */}
        {viewMode === 'summary' ? (
          <SummaryModeView
            analysis={displayedAnalysis}
            isLoading={analysis.loading}
            theme={theme}
            tone={tone}
            onSwitchToDiagnostic={() => setViewMode('diagnostic')}
          />
        ) : null}

        {/* ═══════════════════════════════════════════════════════
            DIAGNOSTIC MODE — existing chart tabs
            ═══════════════════════════════════════════════════════ */}
        {viewMode === 'diagnostic' && state.topTab === 'site-kpi' ? (
          <div className="space-y-5">
            {/* Animated icon-to-word sub-tab rail */}
            <div className="border-b pb-3" style={{ borderColor: tone.border }}>
              <div className="flex items-center gap-1">
                {KPI_RAIL_TABS.map((tab) => {
                  const kpiGroupActive = tab.id === 'daily' && ['daily', 'hourly', 'overlay'].includes(state.kpiTab);
                  const isActive = state.kpiTab === tab.id || kpiGroupActive;
                  const isExpanded = isActive || hoveredRailTab === tab.id;
                  const { Icon } = tab;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setState((prev) => ({ ...prev, kpiTab: tab.id }))}
                      onMouseEnter={() => setHoveredRailTab(tab.id)}
                      onMouseLeave={() => setHoveredRailTab(null)}
                      title={isExpanded ? undefined : tab.label}
                      className="flex items-center gap-1.5 overflow-hidden rounded-lg border transition-all duration-200 ease-out"
                      style={{
                        borderColor: isActive ? tone.activeBorder : tone.border,
                        backgroundColor: isActive ? tone.activeFill : 'transparent',
                        color: isActive ? tone.activeText : tone.muted,
                        padding: isExpanded ? '6px 12px' : '6px 8px',
                      }}
                    >
                      <Icon className="h-[14px] w-[14px] shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
                      <span
                        className="overflow-hidden whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.08em] transition-[max-width,opacity] duration-200 ease-out"
                        style={{
                          maxWidth: isExpanded ? 120 : 0,
                          opacity: isExpanded ? 1 : 0,
                        }}
                      >
                        {tab.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* KPI sub-tab selector — visible when KPI group is active */}
              {['daily', 'hourly', 'overlay'].includes(state.kpiTab) && (
                <div className="mt-2 flex items-center gap-1 pl-0.5">
                  {KPI_MENU_TABS.map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => setState((prev) => ({ ...prev, kpiTab: sub.id }))}
                      className="rounded-md px-3 py-1 text-[11px] font-medium uppercase tracking-[0.07em] transition-colors"
                      style={{
                        backgroundColor: state.kpiTab === sub.id ? tone.activeFill : 'transparent',
                        color: state.kpiTab === sub.id ? tone.activeText : tone.muted,
                        border: `1px solid ${state.kpiTab === sub.id ? tone.activeBorder : 'transparent'}`,
                      }}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {state.kpiTab === 'cqx' ? (
              <div className="space-y-6">
                <ChartPanel
                  title="Impact KPIs"
                  option={cqxChart}
                  height={420}
                  loading={cqxTotals.loading}
                  headerContent={(
                    <div
                      className="flex items-center gap-2 rounded-full border p-1"
                      style={{ borderColor: tone.borderStrong, backgroundColor: theme === 'dark' ? '#2a2a2c' : '#f1f5f9' }}
                    >
                      {DEFAULT_CQX_METRICS.map((metric) => (
                        <button
                          key={metric}
                          type="button"
                          onClick={() => setState((prev) => ({ ...prev, cqxMetric: metric }))}
                          className="rounded-full px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] transition-all"
                          style={{
                            backgroundColor: state.cqxMetric === metric ? tone.activeFill : 'transparent',
                            color: state.cqxMetric === metric ? tone.activeText : tone.muted,
                          }}
                        >
                          {formatTitle(metric)}
                        </button>
                      ))}
                    </div>
                  )}
                />
                {(cqx.loading || trafficSeriesKeys.length > 0) ? (
                  <ChartPanel title="Traffic KPIs (Data Payload)" option={trafficKpiChart} height={380} loading={cqx.loading} />
                ) : null}
                {(cqx.loading || qualitySeriesKeys.length > 0 || cqxDataType === 'impact') ? (
                  <ChartPanel
                    title="CQX Subcomponents"
                    option={qualityKpiChart}
                    height={400}
                    loading={cqx.loading}
                    headerContent={(
                      <div className="flex items-center gap-2 rounded-full border p-1" style={{ borderColor: tone.borderStrong, backgroundColor: theme === 'dark' ? '#2a2a2c' : '#f1f5f9' }}>
                        <button
                          type="button"
                          onClick={() => setCqxDataType('impact')}
                          className="rounded-full px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors"
                          style={{
                            backgroundColor: cqxDataType === 'impact' ? tone.activeFill : 'transparent',
                            color: cqxDataType === 'impact' ? tone.activeText : tone.muted,
                          }}
                        >
                          Impact to CQX
                        </button>
                        <button
                          type="button"
                          onClick={() => setCqxDataType('value')}
                          className="rounded-full px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors"
                          style={{
                            backgroundColor: cqxDataType === 'value' ? tone.activeFill : 'transparent',
                            color: cqxDataType === 'value' ? tone.activeText : tone.muted,
                          }}
                        >
                          Subcomponent Value
                        </button>
                      </div>
                    )}
                  />
                ) : null}
              </div>
            ) : null}

            {['daily', 'hourly', 'overlay'].includes(state.kpiTab) ? (
              <div className="space-y-4">
                {/* Compass-style Cell Filters bar */}
                <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: tone.border, background: tone.surface }}>
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] mr-1 shrink-0" style={{ color: tone.muted }}>
                    Cell Filters:
                  </span>
                  {uniqueFaces.length > 0 && (
                    <MultiSelectDropdown label="Face" options={uniqueFaces} selected={selectedFaces} onChange={setSelectedFaces} tone={tone} />
                  )}
                  {uniqueBands.length > 0 && (
                    <MultiSelectDropdown label="Band" options={uniqueBands} selected={selectedBands} onChange={setSelectedBands} tone={tone} />
                  )}
                  {uniqueTechs.length > 0 && (
                    <MultiSelectDropdown label="Technology" options={uniqueTechs} selected={selectedTechs} onChange={setSelectedTechs} tone={tone} />
                  )}
                  {['daily', 'overlay'].includes(state.kpiTab) && (
                    <div className="flex items-center gap-1 ml-2">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] mr-1" style={{ color: tone.muted }}>Days:</span>
                      {[7, 14, 30].map((d) => (
                        <button key={d} type="button" onClick={() => setDaysBack(d)}
                          className="px-2 py-1 rounded text-[11px] font-semibold transition-colors"
                          style={{ background: daysBack === d ? tone.fill : 'transparent', color: daysBack === d ? tone.primary : tone.muted, border: `1px solid ${daysBack === d ? tone.border : 'transparent'}` }}>
                          {d}d
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setAddKpiOpen(true)}
                    className="ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors"
                    style={{ borderColor: tone.border, color: tone.text, background: 'transparent' }}
                  >
                    <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Add KPI
                  </button>
                </div>
                {activeKpis.map((kpiName, idx) => (
                  <KpiChartPanel
                    key={`${state.kpiTab}-${realSiteId}-${kpiName}`}
                    kpiName={kpiName}
                    kpiIndex={idx}
                    siteId={realSiteId}
                    selectedDateId={selectedDateId}
                    kpiTab={state.kpiTab}
                    daysBack={daysBack}
                    cellMeta={cellMeta}
                    selectedFaces={selectedFaces}
                    selectedBands={selectedBands}
                    selectedTechs={selectedTechs}
                    theme={theme}
                  />
                ))}
              </div>
            ) : null}

            {state.kpiTab === 'traffic-profile' ? (
              <div className="space-y-4">
                <ChartPanel title="Traffic by band" option={trafficCharts?.band ?? baseChartOption(theme) as EChartsOption} height={360} loading={traffic.loading} />
                <ChartPanel title="Traffic by sector" option={trafficCharts?.sector ?? baseChartOption(theme) as EChartsOption} height={360} loading={traffic.loading} />
                {(traffic.loading || mobilityChart) ? <ChartPanel title="Neighbor handover concentration" option={mobilityChart ?? baseChartOption(theme) as EChartsOption} height={360} loading={traffic.loading} /> : null}
              </div>
            ) : null}

            {state.kpiTab === 'mobility' ? (
              <div className="space-y-4">
                {mobility.loading ? (
                  <div className="flex items-center justify-center py-16" style={{ color: tone.muted }}>
                    <div className="text-sm">Loading mobility data…</div>
                  </div>
                ) : (
                  <>
                    {mobilityFaceCharts?.length
                      ? mobilityFaceCharts.map((c) => (
                          <ChartPanel
                            key={`mobility-${realSiteId}-${c.sourceFace}`}
                            title={`Handover attempts — ${c.sourceFace}`}
                            option={c.option}
                            height={360}
                          />
                        ))
                      : null}
                    {mobilityChart ? (
                      <ChartPanel title="Top target faces by total handovers" option={mobilityChart} height={380} />
                    ) : null}
                    {(mobility.data?.data || []).length > 0 ? (
                      <TableView
                        title="Mobility detail"
                        rows={(mobility.data?.data || []).slice(0, 50).map((row) => ({
                          Source: row.sourceUsid,
                          Face: row.sourceFace,
                          Neighbor: row.neighborUsid,
                          'Nbr Face': row.neighborFace,
                          HO_Count: row.handoverCount,
                          'HO %': typeof row.handoverPercent === 'number' ? row.handoverPercent.toFixed(1) : '-',
                          'Dist (m)': typeof row.distanceMeters === 'number' ? Math.round(row.distanceMeters) : '-',
                        }))}
                      />
                    ) : null}
                  </>
                )}
              </div>
            ) : null}

            {state.kpiTab === 'outages' ? (
              <div className="space-y-4">
                {siteOutages.loading ? (
                  <div className="flex items-center justify-center py-16" style={{ color: tone.muted }}>
                    <div className="text-sm">Loading outages…</div>
                  </div>
                ) : (siteOutages.data?.length || 0) === 0 ? (
                  <div className="rounded-[24px] border border-black/5 dark:border-white/10 bg-white/82 dark:bg-[#242424]/80 p-8 text-center">
                    <p className="text-sm font-medium" style={{ color: tone.muted }}>No outage events found for this site in the last 14 days</p>
                    <p className="text-[11px] mt-1" style={{ color: tone.subtle }}>Outage data is sourced from the outage_table</p>
                  </div>
                ) : (
                  <TableView
                    title={`Outage events (last 14 days) — ${siteOutages.data!.length} record${siteOutages.data!.length !== 1 ? 's' : ''}`}
                    rows={siteOutages.data!.map((row: any) => {
                      const pick = (...keys: string[]) => {
                        for (const key of keys) {
                          if (row[key] != null) return String(row[key]);
                        }
                        return '-';
                      };
                      return {
                        USID: pick('USID', 'usid'),
                        Cell: pick('cell_name', 'CELL_NAME', 'USEID'),
                        Start: pick('START_TIME', 'start_time', 'BEGIN_TIME', 'DATE_ID'),
                        End: pick('END_TIME', 'end_time', 'RESTORE_TIME'),
                        Duration: pick('DURATION_MIN', 'duration', 'OUTAGE_DURATION'),
                        Type: pick('OUTAGE_TYPE', 'outage_type', 'TYPE'),
                        Cause: pick('CAUSE', 'CAUSE_CODE', 'cause'),
                      };
                    })}
                  />
                )}
              </div>
            ) : null}

            {/* Insights views removed for redesign */}

          </div>
        ) : null}

        {viewMode === 'diagnostic' && state.topTab === 'rca' ? (
          <div className="space-y-4">
            {/* RCA Sub-tab rail */}
            <div className="flex items-center justify-between gap-2 border-b pb-3" style={{ borderColor: tone.border }}>
              <div className="flex items-center gap-2">
                {(
                  [
                    { id: 'evidences' as const, label: 'Evidences' },
                    { id: 'summary' as const, label: 'Summary' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setRcaSubTab(tab.id)}
                    className="rounded-md border px-4 py-2 text-[12px] font-medium uppercase tracking-[0.08em] transition-colors"
                    style={{
                      borderColor: rcaSubTab === tab.id ? tone.primary : tone.border,
                      backgroundColor: rcaSubTab === tab.id ? tone.fill : 'transparent',
                      color: rcaSubTab === tab.id ? tone.primary : tone.text,
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {/* Raw data toggle icon */}
              <button
                type="button"
                onClick={() => setRcaSubTab(rcaSubTab === 'raw-data' ? 'evidences' : 'raw-data')}
                title="Toggle raw data"
                className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors"
                style={{
                  borderColor: rcaSubTab === 'raw-data' ? tone.primary : tone.border,
                  backgroundColor: rcaSubTab === 'raw-data' ? tone.fill : 'transparent',
                  color: rcaSubTab === 'raw-data' ? tone.primary : tone.muted,
                }}
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5">
                  <rect x="2" y="2" width="12" height="3" rx="1" />
                  <rect x="2" y="6.5" width="8" height="3" rx="1" />
                  <rect x="2" y="11" width="10" height="3" rx="1" />
                </svg>
              </button>
            </div>

            {/* ── Tab 1: Evidences (chain of thought) ─────────────────── */}
            {rcaSubTab === 'evidences' ? (
              <div className="space-y-3">
                {/* RCA conclusion banner */}
                {(() => {
                  const rcaBucket = extractText(displayedAnalysis.rca.bucket);
                  const rec = extractRecommendation(displayedAnalysis.rca.solutionRecommendation);
                  return (
                    <div
                      className="rounded-[18px] border p-4 flex items-start justify-between gap-4"
                      style={{
                        borderColor: rcaBucket ? 'rgba(99,102,241,0.3)' : tone.border,
                        background: theme === 'dark' ? 'rgba(38,38,38,0.7)' : 'rgba(255,255,255,0.85)',
                        backdropFilter: 'blur(12px)',
                      }}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: tone.muted }}>Root Cause</div>
                        <div className="text-[15px] font-bold leading-snug" style={{ color: tone.text }}>{rcaBucket || '—'}</div>
                        {rec?.title && (
                          <div className="text-[12px] leading-relaxed pt-0.5" style={{ color: tone.secondary }}>
                            <span className="font-semibold" style={{ color: tone.muted }}>Fix: </span>{rec.title}
                          </div>
                        )}
                        {rec?.justification && (
                          <div className="text-[12px] leading-relaxed" style={{ color: tone.secondary }}>{rec.justification}</div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Chain of thought as evidence items */}
                {Array.isArray(displayedAnalysis.rca.chainOfThought) && displayedAnalysis.rca.chainOfThought.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] px-1" style={{ color: tone.muted }}>Evidence Chain</div>
                    <div className="relative">
                      {/* vertical rail */}
                      <div
                        className="absolute left-[19px] top-4 bottom-4 w-px"
                        style={{ background: `linear-gradient(to bottom, ${tone.primary}60, ${tone.border})` }}
                      />
                      <div className="space-y-2">
                        {(displayedAnalysis.rca.chainOfThought as any[]).map((step: any, index: number) => {
                          const titleRaw = step?.step ?? step?.title ?? step?.text ?? `Evidence ${index + 1}`;
                          const bodyRaw = step?.reasoning ?? step?.description ?? step?.content ?? step?.details ?? '';
                          const title = extractBestEvidenceText(titleRaw) || `Evidence ${index + 1}`;
                          const body = extractBestEvidenceText(bodyRaw);
                          const isLast = index === (displayedAnalysis.rca.chainOfThought as any[]).length - 1;
                          return (
                            <div key={index} className="flex gap-3 pl-1">
                              {/* Node */}
                              <div className="shrink-0 flex flex-col items-center pt-3" style={{ width: 38 }}>
                                <div
                                  className="h-5 w-5 rounded-full border-2 flex items-center justify-center text-[9px] font-bold z-10"
                                  style={{
                                    borderColor: isLast ? tone.primary : tone.border,
                                    background: isLast ? tone.fill : (theme === 'dark' ? '#1c1c1e' : '#fff'),
                                    color: isLast ? tone.primary : tone.muted,
                                  }}
                                >
                                  {index + 1}
                                </div>
                              </div>
                              {/* Content */}
                              <div
                                className="flex-1 rounded-[14px] border px-3.5 py-3 mb-1"
                                style={{
                                  borderColor: isLast ? `${tone.primary}50` : tone.border,
                                  background: isLast
                                    ? (theme === 'dark' ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.04)')
                                    : (theme === 'dark' ? 'rgba(38,38,38,0.5)' : 'rgba(255,255,255,0.7)'),
                                }}
                              >
                                <div className="flex items-start justify-between gap-2 mb-1">
                                  <div className="text-[12px] font-semibold" style={{ color: tone.text }}>{title}</div>
                                </div>
                                {body ? (
                                  <p className="text-[12px] leading-relaxed" style={{ color: tone.secondary }}>{dText(String(body))}</p>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[18px] border p-8 text-center" style={{ borderColor: tone.border }}>
                    <p className="text-[13px] font-medium" style={{ color: tone.muted }}>No evidence chain available</p>
                    {displayedAnalysis.rca.rcaSummary ? (
                      <p className="text-[12px] mt-1 leading-relaxed" style={{ color: tone.subtle }}>{dText(String(displayedAnalysis.rca.rcaSummary))}</p>
                    ) : null}
                  </div>
                )}

                {/* Strongest KPI factors */}
                {(displayedAnalysis.strongestFactors?.length ?? 0) > 0 && (
                  <div className="pt-1">
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] mb-2 px-1" style={{ color: tone.muted }}>Key KPI Signals</div>
                    <div className="flex flex-wrap gap-2">
                      {displayedAnalysis.strongestFactors.map((factor) => (
                        <span
                          key={String(factor)}
                          className="rounded-full border px-3 py-1 text-[11px] font-semibold"
                          style={{ borderColor: tone.border, color: tone.text, background: tone.fill }}
                        >
                          {formatTitle(String(factor))}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/* ── Tab 2: RCA (intuitions + conclusion — same as summary view) ── */}
            {rcaSubTab === 'summary' ? (
              <SummaryModeView
                analysis={displayedAnalysis}
                isLoading={analysis.loading}
                theme={theme}
                tone={tone}
                onSwitchToDiagnostic={() => {}}
                hideCta
              />
            ) : null}

            {/* ── Raw Data (hidden, toggled by icon) ──────────────────── */}
            {rcaSubTab === 'raw-data' ? (
              <div
                className="rounded-[18px] border p-4"
                style={{ borderColor: tone.border, background: theme === 'dark' ? 'rgba(38,38,38,0.7)' : 'rgba(255,255,255,0.85)' }}
              >
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] mb-3" style={{ color: tone.muted }}>Raw RCA Data</div>
                <pre
                  className="text-[11px] overflow-auto max-h-[600px] leading-relaxed"
                  style={{ color: tone.secondary, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
                >
                  {JSON.stringify(
                    { rca: displayedAnalysis.rca, intuitions: displayedAnalysis.intuitions, strongestFactors: displayedAnalysis.strongestFactors, summaries: displayedAnalysis.summaries },
                    null, 2
                  )}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}

        {viewMode === 'diagnostic' && state.topTab === 'operational' ? (
          <div className="space-y-4">
            {/* Operational sub-tabs */}
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { id: 'cell-topology', label: 'Cell Topology', countKey: null },
                  { id: 'neighbors', label: 'Neighbors', countKey: null },
                  { id: 'alarms', label: 'Alarms', countKey: 'alarms' },
                  { id: 'tickets', label: 'Tickets', countKey: 'tickets' },
                  { id: 'config', label: 'Config Changes', countKey: 'config_changes' },
                  { id: 'outages', label: 'Outages', countKey: 'outages' },
                  { id: 'eim', label: 'EIM', countKey: 'eim' },
                ] as const
              ).map((tab) => {
                const count = tab.countKey && compassOperational.data
                  ? ((compassOperational.data as any)[tab.countKey] as unknown[])?.length ?? 0
                  : null;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setCompassOpTab(tab.id as any)}
                    className="rounded-md border px-4 py-2 text-[12px] font-medium uppercase tracking-[0.08em] transition-colors"
                    style={{
                      borderColor: compassOpTab === tab.id ? tone.primary : tone.border,
                      backgroundColor: compassOpTab === tab.id ? tone.fill : 'transparent',
                      color: compassOpTab === tab.id ? tone.primary : tone.text,
                    }}
                  >
                    {tab.label}
                    {count != null && (
                      <span
                        className="ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                        style={{
                          backgroundColor: compassOpTab === tab.id ? tone.fill : (theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.07)'),
                          color: compassOpTab === tab.id ? tone.primary : tone.muted,
                        }}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Cell Topology tab */}
            {compassOpTab === 'cell-topology' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  <CompactMetric label="Cell Count" value={String(displayedTopology.cellTopology.length)} />
                  <CompactMetric label="Site" value={dId(displayedTopology.usid || realSiteId)} />
                  <CompactMetric label="Date" value={displayedTopology.dateId || selectedDateId} />
                  <CompactMetric
                    label="Technologies"
                    value={Array.from(new Set(displayedTopology.cellTopology.map((c) => (c as any).technology || (c as any).TECH || ''))).filter(Boolean).join(', ') || '—'}
                  />
                </div>
                <TableView
                  title={`Cell Topology — ${displayedTopology.cellTopology.length} cells`}
                  rows={displayedTopology.cellTopology.map((cell) => {
                    const c = cell as any;
                    return {
                      Cell: c.cellName || c.cell_name || c.CELL_NAME || '—',
                      Azimuth: c.azimuth != null ? `${Math.round(c.azimuth)}°` : (c.AZIMUTH != null ? `${Math.round(c.AZIMUTH)}°` : '—'),
                      Height: c.height != null ? `${Math.round(c.height)}m` : (c.HEIGHT != null ? `${Math.round(c.HEIGHT)}m` : '—'),
                      Latitude: c.latitude != null ? Number(c.latitude).toFixed(5) : (c.LATITUDE != null ? Number(c.LATITUDE).toFixed(5) : '—'),
                      Longitude: c.longitude != null ? Number(c.longitude).toFixed(5) : (c.LONGITUDE != null ? Number(c.LONGITUDE).toFixed(5) : '—'),
                      Tech: c.technology || c.TECH || '—',
                      Carrier: c.carrier || c.CARRIER || '—',
                      UseID: c.useId || c.useid || c.USE_ID || '—',
                    };
                  })}
                />
              </div>
            ) : null}

            {/* Neighbors tab */}
            {compassOpTab === 'neighbors' ? (
              <div className="space-y-4">
                {displayedOperational.neighborRows.length === 0 ? (
                  <div className="rounded-[24px] border border-black/5 dark:border-white/10 bg-white/82 dark:bg-[#242424]/80 p-8 text-center">
                    <p className="text-sm font-medium" style={{ color: tone.muted }}>No neighbor data available</p>
                  </div>
                ) : (
                  <TableView
                    title={`Neighbor sites — ${displayedOperational.neighborRows.length} entries`}
                    rows={displayedOperational.neighborRows.map((row) => {
                      const r = row as any;
                      return {
                        'Neighbor USID': r.neighborUsid || r.NEIGH_USID || r.neighbor_usid || '—',
                        'Downtime Auto (min)': r.totalDowntimeAuto ?? r.TOTAL_DOWNTIME_AUTO ?? '—',
                        'Downtime Manual (min)': r.totalDowntimeManual ?? r.TOTAL_DOWNTIME_MANUAL ?? '—',
                        'RRC Fail': r.totalRrcFail ?? r.TOTAL_RRC_FAIL ?? '—',
                        'Cells Affected': r.cellsAffected ?? r.CELLS_AFFECTED ?? '—',
                        'HO %': r.handoverPercent != null ? Number(r.handoverPercent).toFixed(2) : (r.PERC_HANDOVER != null ? Number(r.PERC_HANDOVER).toFixed(2) : '—'),
                      };
                    })}
                  />
                )}
              </div>
            ) : null}

            {/* Existing operational sub-tabs (alarms/tickets/config/outages/eim) */}
            {(['alarms', 'tickets', 'config', 'outages', 'eim'] as const).includes(compassOpTab as any) ? (
              compassOperational.loading ? (
                <div className="flex items-center justify-center py-16" style={{ color: tone.muted }}>
                  <div className="text-sm">Loading operational data…</div>
                </div>
              ) : compassOperational.error ? (
                <div className="rounded-[24px] border border-red-200 dark:border-red-900/30 bg-red-50 dark:bg-red-950/20 p-6">
                  <p className="text-sm text-red-600 dark:text-red-400">Failed to load operational data: {compassOperational.error}</p>
                  <p className="text-[11px] mt-1" style={{ color: tone.subtle }}>Falling back to local data below</p>
                  <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <TableView title="Site operations" rows={displayedOperational.siteRows as unknown as Array<Record<string, unknown>>} />
                    <TableView title="Neighbor operations" rows={displayedOperational.neighborRows as Array<Record<string, unknown>>} />
                  </div>
                </div>
              ) : (() => {
                const opData = compassOperational.data;
                if (!opData) {
                  return (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      <TableView title="Site operations" rows={displayedOperational.siteRows as unknown as Array<Record<string, unknown>>} />
                      <TableView title="Neighbor operations" rows={displayedOperational.neighborRows as Array<Record<string, unknown>>} />
                    </div>
                  );
                }
                const currentRows =
                  compassOpTab === 'alarms' ? opData.alarms
                  : compassOpTab === 'tickets' ? opData.tickets
                  : compassOpTab === 'config' ? opData.config_changes
                  : compassOpTab === 'outages' ? opData.outages
                  : opData.eim;
                const opTabLabel =
                  compassOpTab === 'alarms' ? 'Alarms (7-day window)'
                  : compassOpTab === 'tickets' ? 'Tickets (7-day window)'
                  : compassOpTab === 'config' ? 'Configuration changes (7-day window)'
                  : compassOpTab === 'outages' ? 'Outage events (7-day window)'
                  : 'EIM events (7-day window)';
                if (!currentRows.length) {
                  return (
                    <div className="rounded-[24px] border border-black/5 dark:border-white/10 bg-white/82 dark:bg-[#242424]/80 p-8 text-center">
                      <p className="text-sm font-medium" style={{ color: tone.muted }}>
                        No {compassOpTab} found for this site in the 7-day window
                      </p>
                      <p className="text-[11px] mt-1" style={{ color: tone.subtle }}>
                        Data includes site + immediate neighbors
                      </p>
                    </div>
                  );
                }
                return <TableView title={opTabLabel} rows={currentRows} />;
              })()
            ) : null}
          </div>
        ) : null}

        {viewMode === 'diagnostic' && state.topTab === 'topology' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <CompactMetric label="Market" value={displayedAnalysis.topology.market || 'Metro'} />
              <CompactMetric label="District" value={displayedAnalysis.topology.district || 'West'} />
              <CompactMetric label="Structure" value={displayedAnalysis.topology.structureType || 'Tower'} />
              <CompactMetric label="Cluster" value={displayedAnalysis.topology.clusterName || 'Cluster'} />
            </div>
            <div className="rounded-[24px] border border-black/5 dark:border-white/10 bg-white/82 dark:bg-[#242424]/80 backdrop-blur-md p-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 text-sm shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
              {Object.entries(displayedAnalysis.topology).map(([key, value]) => (
                <div key={key} className="rounded-xl border border-black/5 dark:border-white/10 bg-white/60 dark:bg-white/5 px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted dark:text-slate-400">{formatTitle(key)}</div>
                  <div className="mt-2 text-text-primary dark:text-slate-100">{String(value || '-')}</div>
                </div>
              ))}
            </div>
            <TableView title="Cell topology" rows={displayedTopology.cellTopology as unknown as Array<Record<string, unknown>>} />
          </div>
        ) : null}

        {viewMode === 'diagnostic' && state.topTab === 'analyzer' ? (
          <SiteAnalyzerTab
            realSiteId={realSiteId}
            selectedDateId={selectedDateId}
            theme={theme}
            tone={{
              primary: tone.primary,
              border: tone.border,
              muted: tone.muted,
              text: tone.text,
              secondary: tone.secondary,
              fill: tone.fill,
            }}
          />
        ) : null}
      </div>

      {/* Add KPI modal */}
      {addKpiOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setAddKpiOpen(false)}>
          <div
            className="w-96 rounded-2xl border shadow-2xl overflow-hidden"
            style={{ background: tone.surfaceStrong, borderColor: tone.border }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: tone.border }}>
              <h3 className="text-sm font-semibold" style={{ color: tone.text }}>Add KPI Charts</h3>
              <button type="button" onClick={() => setAddKpiOpen(false)} className="text-lg leading-none" style={{ color: tone.muted }}>✕</button>
            </div>
            <div className="px-4 pt-3 pb-2">
              <input
                type="text"
                placeholder="Search KPIs…"
                value={kpiSearch}
                onChange={(e) => setKpiSearch(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{ background: tone.surface, borderColor: tone.border, color: tone.text }}
              />
            </div>
            <div className="max-h-72 overflow-y-auto px-4 pb-2 space-y-0.5">
              {(availableKpis.data || DEFAULT_KPIS)
                .filter((k) => k.toLowerCase().includes(kpiSearch.toLowerCase()))
                .map((kpi) => (
                  <label key={kpi} className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg cursor-pointer" style={{ color: tone.text }}>
                    <input
                      type="checkbox"
                      checked={activeKpis.includes(kpi)}
                      onChange={() => setActiveKpis((prev) =>
                        prev.includes(kpi) ? prev.filter((k) => k !== kpi) : [...prev, kpi]
                      )}
                      style={{ cursor: 'pointer', accentColor: tone.primary }}
                    />
                    <span className="text-[12px] flex-1">{formatTitle(kpi)}</span>
                    {DEFAULT_KPIS.includes(kpi) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: tone.fill, color: tone.primary }}>Standard</span>
                    )}
                  </label>
                ))}
            </div>
            <div className="flex gap-2 px-4 py-3 border-t" style={{ borderColor: tone.border }}>
              <button
                type="button"
                onClick={() => setActiveKpis([...DEFAULT_KPIS])}
                className="flex-1 rounded-lg py-2 text-[12px] font-semibold border transition-colors"
                style={{ borderColor: tone.border, color: tone.muted, background: 'transparent' }}
              >
                Reset to Standard
              </button>
              <button
                type="button"
                onClick={() => { setAddKpiOpen(false); setKpiSearch(''); }}
                className="flex-1 rounded-lg py-2 text-[12px] font-semibold"
                style={{ background: tone.fill, color: tone.primary }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
