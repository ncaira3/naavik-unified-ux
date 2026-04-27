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
import { useMemo, useRef, useCallback, useEffect } from 'react';
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

      {/* Footer — SQL source */}
      {source && (
        <div className="px-4 py-2 border-t flex items-center gap-1.5" style={{ borderColor: hdrBdr }}>
          <svg
            className="h-3 w-3 shrink-0"
            style={{ color: sourceColor }}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="8" cy="8" r="6" />
            <path d="M8 7v5M8 5.5v.5" strokeLinecap="round" />
          </svg>
          <span className="text-[10px] font-mono truncate" style={{ color: sourceColor }}>
            {source}
          </span>
        </div>
      )}
    </div>
  );
}
