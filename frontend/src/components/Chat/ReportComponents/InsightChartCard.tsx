/**
 * InsightChartCard — Generative chart component for the chat pipeline.
 *
 * Accepts a raw ECharts option object produced by the AI / backend so that
 * any chart type (line, bar, pie, heatmap, scatter, radar, …) can be rendered
 * without a fixed schema on the frontend.
 *
 * Data shape (message.visualization.data):
 *   {
 *     title:        string          // chart heading
 *     subtitle?:    string          // optional sub-heading
 *     source?:      string          // optional data-source label (SQL snippet)
 *     height?:      number          // override height (default 320)
 *     echartsOption: EChartsOption  // full ECharts option object
 *   }
 */
import { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { useTheme } from '../../../context/ThemeContext';

interface InsightChartCardProps {
  data: {
    title?: string;
    subtitle?: string;
    source?: string;
    height?: number;
    echartsOption: Record<string, any>;
  };
}

const PALETTE = [
  '#6366f1', '#22d3ee', '#f59e0b', '#34d399', '#f87171',
  '#a78bfa', '#38bdf8', '#fb923c', '#4ade80', '#f472b6',
];

function buildThemeDefaults(isDark: boolean): Record<string, any> {
  const textColor   = isDark ? '#e2e8f0' : '#1e293b';
  const mutedColor  = isDark ? '#94a3b8' : '#64748b';
  const gridLine    = isDark ? 'rgba(255,255,255,0.06)'  : 'rgba(15,23,42,0.07)';
  const axisLine    = isDark ? 'rgba(255,255,255,0.12)'  : 'rgba(15,23,42,0.15)';
  const tooltipBg   = isDark ? 'rgba(17,17,19,0.96)'     : 'rgba(255,255,255,0.97)';
  const tooltipBdr  = isDark ? 'rgba(255,255,255,0.10)'  : 'rgba(15,23,42,0.12)';
  const tooltipText = isDark ? '#e2e8f0'                 : '#0f172a';

  return {
    backgroundColor: 'transparent',
    color: PALETTE,
    textStyle: { fontFamily: 'Inter, system-ui, sans-serif', color: textColor },
    _axisDefaults: {
      axisLine:  { lineStyle: { color: axisLine } },
      axisLabel: { color: mutedColor, fontSize: 11 },
      splitLine: { lineStyle: { color: gridLine, type: 'dashed' as const } },
    },
    _tooltipDefaults: {
      backgroundColor: tooltipBg,
      borderColor: tooltipBdr,
      borderWidth: 1,
      textStyle: { color: tooltipText, fontSize: 12 },
    },
    _legendDefaults: {
      textStyle: { color: mutedColor, fontSize: 11 },
    },
  };
}

const TRUNCATE_FORMATTER = (val: string) =>
  String(val).length > 14 ? String(val).slice(0, 13) + '…' : String(val);

function fixAxisLabel(axisLabel: any): any {
  if (!axisLabel) return axisLabel;
  // LLM sometimes emits formatter as a string — replace with a real function
  if (typeof axisLabel.formatter === 'string') {
    return { ...axisLabel, formatter: TRUNCATE_FORMATTER };
  }
  return axisLabel;
}

function patchAxisObj(ax: any, defaults: any): any {
  const patched = { ...defaults, ...ax };
  patched.axisLabel = fixAxisLabel(patched.axisLabel ?? defaults.axisLabel);
  return patched;
}

function applyTheme(option: Record<string, any>, isDark: boolean): Record<string, any> {
  const defaults = buildThemeDefaults(isDark);
  const { _axisDefaults, _tooltipDefaults, _legendDefaults, ...base } = defaults;

  const merged: Record<string, any> = { ...base, ...option };

  if (merged.xAxis) {
    merged.xAxis = Array.isArray(merged.xAxis)
      ? merged.xAxis.map((ax: any) => patchAxisObj(ax, _axisDefaults))
      : patchAxisObj(merged.xAxis, _axisDefaults);
  }
  if (merged.yAxis) {
    merged.yAxis = Array.isArray(merged.yAxis)
      ? merged.yAxis.map((ax: any) => patchAxisObj(ax, _axisDefaults))
      : patchAxisObj(merged.yAxis, _axisDefaults);
  }

  // Strip string formatters from series labels; also ensure data arrays exist
  if (Array.isArray(merged.series)) {
    merged.series = merged.series
      .filter((s: any) => s && typeof s === 'object')
      .map((s: any) => {
        const out = { ...s };
        if (out.label?.formatter && typeof out.label.formatter === 'string') {
          out.label = { ...out.label, formatter: undefined };
        }
        if (out.data === undefined || out.data === null) out.data = [];
        return out;
      });
  }

  // Preserve dataZoom — theme patches should not strip it
  if (option.dataZoom !== undefined) merged.dataZoom = option.dataZoom;

  if (merged.tooltip === undefined || merged.tooltip === true) merged.tooltip = {};
  if (merged.tooltip && typeof merged.tooltip === 'object') {
    merged.tooltip = { ..._tooltipDefaults, ...merged.tooltip };
    if (typeof merged.tooltip.formatter === 'string') delete merged.tooltip.formatter;
  }

  if (merged.legend && typeof merged.legend === 'object') {
    merged.legend = { ..._legendDefaults, ...merged.legend };
  }

  if (!merged.grid) {
    merged.grid = { left: 48, right: 24, top: 24, bottom: 40, containLabel: true };
  }

  return merged;
}

function hasRenderableData(option: Record<string, any>): boolean {
  // dataset-based charts are valid even without series.data
  if (option.dataset) return true;
  const series = option.series;
  if (!Array.isArray(series) || series.length === 0) return false;
  return series.some((s: any) => Array.isArray(s?.data) && s.data.length > 0);
}

export default function InsightChartCard({ data }: InsightChartCardProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const chartRef = useRef<any>(null);

  const { title, subtitle, source, height = 320, echartsOption } = data;

  const option = useMemo(
    () => applyTheme(echartsOption ?? {}, isDark),
    [echartsOption, isDark],
  );

  const renderable = useMemo(() => hasRenderableData(option), [option]);

  const containerRef = useRef<HTMLDivElement>(null);

  const onChartReady = useCallback((chart: any) => {
    setTimeout(() => chart.resize(), 0);
  }, []);

  // Keep chart sized to its container as the chat panel resizes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const instance = chartRef.current?.getEchartsInstance?.();
      if (instance) instance.resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bg     = isDark ? 'rgba(17,17,19,0.85)' : 'rgba(255,255,255,0.92)';
  const border = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.10)';
  const hdrBdr = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)';
  const titleColor    = isDark ? '#f1f5f9' : '#0f172a';
  const subtitleColor = isDark ? '#94a3b8' : '#64748b';
  const sourceColor   = isDark ? '#64748b' : '#94a3b8';
  const emptyColor    = isDark ? '#475569' : '#94a3b8';

  return (
    <div
      className="mt-3 rounded-[14px] overflow-hidden"
      style={{
        background: bg,
        border: `1px solid ${border}`,
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* Header */}
      {(title || subtitle) && (
        <div className="px-4 pt-3.5 pb-2 border-b" style={{ borderColor: hdrBdr }}>
          {title && (
            <h3 className="text-[13px] font-semibold leading-snug" style={{ color: titleColor }}>
              {title}
            </h3>
          )}
          {subtitle && (
            <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: subtitleColor }}>
              {subtitle}
            </p>
          )}
        </div>
      )}

      {/* Chart */}
      <div ref={containerRef} className="px-1 py-1">
        {renderable ? (
          <ReactECharts
            ref={chartRef}
            option={option}
            style={{ width: '100%', height: `${height}px` }}
            opts={{ renderer: 'canvas' }}
            notMerge
            onChartReady={onChartReady}
          />
        ) : (
          <div
            style={{ height: `${height}px`, color: emptyColor }}
            className="flex items-center justify-center text-[12px]"
          >
            No renderable data in chart response
          </div>
        )}
      </div>

      {/* Footer — SQL source (expandable) */}
      {source && (
        <SqlSource source={source} sourceColor={sourceColor} borderColor={hdrBdr} isDark={isDark} />
      )}
    </div>
  );
}

// ─── Expandable SQL source footer ───────────────────────────────────────────
function SqlSource({
  source,
  sourceColor,
  borderColor,
  isDark,
}: {
  source: string;
  sourceColor: string;
  borderColor: string;
  isDark: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const codeBg = isDark ? 'rgba(15,15,18,0.75)' : 'rgba(248,250,252,0.92)';
  const codeText = isDark ? '#e2e8f0' : '#0f172a';
  const hoverBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)';

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="border-t" style={{ borderColor }}>
      {/* Header / toggle row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-2 flex items-center gap-1.5 text-left transition-colors"
        style={{ color: sourceColor }}
        onMouseEnter={(e) => (e.currentTarget.style.background = hoverBg)}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide SQL query' : 'Show full SQL query'}
        title={expanded ? 'Hide SQL' : 'Show full SQL'}
      >
        <svg
          className="h-3 w-3 shrink-0"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="8" cy="8" r="6" />
          <path d="M8 7v5M8 5.5v.5" strokeLinecap="round" />
        </svg>
        <span
          className={`text-[10px] font-mono min-w-0 flex-1 ${expanded ? '' : 'truncate'}`}
        >
          {expanded ? 'SQL query' : source}
        </span>
        <svg
          className={`h-3 w-3 shrink-0 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-3">
          <div
            className="relative rounded-md border"
            style={{ background: codeBg, borderColor }}
          >
            <button
              type="button"
              onClick={copy}
              className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors"
              style={{
                background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.85)',
                borderColor,
                color: copied ? '#22c55e' : sourceColor,
              }}
              title="Copy SQL"
            >
              {copied ? (
                <>
                  <svg className="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <svg className="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <rect x="5" y="5" width="9" height="9" rx="1.5" />
                    <path d="M3 11V3a1 1 0 011-1h8" />
                  </svg>
                  <span>Copy</span>
                </>
              )}
            </button>
            <pre
              className="font-mono text-[11px] leading-[1.55] whitespace-pre-wrap break-words m-0 px-3 py-2.5 pr-16 max-h-[280px] overflow-y-auto scrollbar-thin"
              style={{ color: codeText }}
            >
              {source}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
