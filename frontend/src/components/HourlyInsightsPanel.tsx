import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';

interface HourlyInsightRow {
  USID: string;
  DATE_ID: string;
  HOUR_ID: number;
  cell_name: string;
  kpi_name: string;
  kpi_value: number | null;
}

interface HourlyInsightsPanelProps {
  data: HourlyInsightRow[];
  theme: 'light' | 'dark';
}

export default function HourlyInsightsPanel({ data, theme }: HourlyInsightsPanelProps) {
  // Group data by KPI name
  const chartOption = useMemo<EChartsOption>(() => {
    const isDark = theme === 'dark';

    // Group data by kpi_name and aggregate by hour
    const kpiMap = new Map<string, { hour: number; avg: number }[]>();

    data.forEach((row) => {
      if (!row.kpi_name || row.kpi_value === null) return;

      if (!kpiMap.has(row.kpi_name)) {
        kpiMap.set(row.kpi_name, []);
      }

      const list = kpiMap.get(row.kpi_name)!;
      const existing = list.find((item) => item.hour === row.HOUR_ID);

      if (existing) {
        existing.avg = (existing.avg + row.kpi_value) / 2;
      } else {
        list.push({ hour: row.HOUR_ID, avg: row.kpi_value });
      }
    });

    // Sort by hour
    kpiMap.forEach((list) => {
      list.sort((a, b) => a.hour - b.hour);
    });

    // Get hours range
    const allHours = new Set<number>();
    kpiMap.forEach((list) => {
      list.forEach((item) => {
        allHours.add(item.hour);
      });
    });

    const xAxisData = Array.from(allHours).sort((a, b) => a - b);

    // Build series for each KPI
    const series: EChartsOption['series'] = Array.from(kpiMap.entries()).map(([kpiName, data], index) => ({
      name: kpiName,
      type: 'line',
      smooth: true,
      data: xAxisData.map((hour) => {
        const item = data.find((d) => d.hour === hour);
        return item ? item.avg : null;
      }),
      itemStyle: { color: ['#94a3b8', '#10b981', '#f59e0b', '#ef4444', '#cbd5e1', '#ec4899', '#64748b', '#14b8a6'][index % 8] },
      lineStyle: { width: 2 },
      symbolSize: 4,
    }));

    return {
      backgroundColor: isDark ? '#0b1220' : 'transparent',
      grid: { left: 60, right: 20, top: 20, bottom: 40, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: isDark ? 'rgba(17,24,39,0.9)' : 'rgba(255,255,255,0.96)',
        textStyle: { color: isDark ? '#e2e8f0' : '#0f172a' },
        borderColor: isDark ? 'rgba(148,163,184,0.16)' : 'rgba(15,23,42,0.08)',
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: xAxisData.map((h) => `${h}:00`),
        axisLine: { lineStyle: { color: isDark ? 'rgba(148,163,184,0.16)' : 'rgba(148,163,184,0.16)' } },
        axisLabel: { color: isDark ? '#94a3b8' : '#64748b', fontSize: 12 },
      },
      yAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: isDark ? 'rgba(148,163,184,0.16)' : 'rgba(148,163,184,0.16)' } },
        axisLabel: { color: isDark ? '#94a3b8' : '#64748b', fontSize: 12 },
        splitLine: { lineStyle: { color: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(148,163,184,0.16)' } },
      },
      legend: {
        type: 'scroll',
        bottom: 0,
        left: 'center',
        itemGap: 20,
        textStyle: { color: isDark ? '#e2e8f0' : '#0f172a' },
      },
      series,
    };
  }, [data, theme]);

  if (data.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-text-muted dark:text-gray-400">
        <p>No hourly insights data available for this site and date</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      <ReactECharts option={chartOption} style={{ width: '100%', height: '100%' }} />
      <div className="text-xs text-text-muted dark:text-gray-400 px-4 py-2 border-t border-border dark:border-pulse-border">
        <p>Showing hourly KPI trends. Average values aggregated across cell sectors.</p>
      </div>
    </div>
  );
}
