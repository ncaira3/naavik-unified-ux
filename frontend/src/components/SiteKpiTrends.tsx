import { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import api from '../services/api';
import { useTheme } from '../context/ThemeContext';

const FALLBACK_KPIS = [
  'DL_DRB_TPUT',
  'AVG_DL_PRB_UTIL',
  'DATA_RAN_ACC',
  'D_ERB_DROP',
  'D_ERB_FAIL',
  'DL_VOL_GB',
];

const STANDARD_NORMAL_SITE_KPIS = [
  'DL_VOL_GB',
  'UL_VOL_GB',
  'DATA_RAN_ACC',
  'DATA_ERB_RET',
  'DL_TOTAL_DRB_THPUT',
  'UL_TPUT',
  'DL_PKTLOSS_RT',
  'UL_PKTLOSS_RT',
  'RRC_FAIL',
  'DUAC_FAIL',
  'UL_RSSI',
  'AVG_DL_PRB_UTIL',
  'EUCELL_DOWNTIME_AUTO',
  'EUCELL_DOWNTIME_MANUAL',
  'PMUECTXTRELSCEUTRA',
];

const CONGESTION_SEED_KPIS = ['RRC_FAIL', 'RRC_ATTEMPTS', 'DUAC_FAIL', 'V_ERB_FAIL'];
const OUTAGE_SEED_KPIS = ['PMDOWNTIMEAUTO', 'PMDOWNTIMEMANUAL', 'RRC_FAIL', 'RRC_ATTEMPTS', 'DUAC_FAIL', 'V_ERB_FAIL'];

interface KPITimeSeriesPoint {
  dateId: string;
  hourId?: number;
  value: number;
  anomalyFlag: boolean;
  anomalyScore: number;
}

interface KPIResult {
  siteId: string;
  kpiName: string;
  timeSeries: KPITimeSeriesPoint[];
  aggregate: { avg: number; min: number; max: number; count: number };
}

interface SiteRcaMeta {
  rcaBucket?: string | null;
  strongestFactors?: unknown;
}

/** Offender date - trends end here and show degradation toward this date */
const OFFENDER_END_DATE = '2025-01-10';

interface SiteKpiTrendsProps {
  siteId: string;
  /** Number of days from latest; 0 = entire available range */
  days?: number;
  /** When true, end x-axis at Jan 10 and show KPI degradation */
  isDegraded?: boolean;
  /** Inclusive end date for displayed time series (YYYY-MM-DD) */
  endDate?: string;
  /** Override smart KPI selection — show exactly these KPIs */
  kpiNames?: string[];
}

function getChartTheme(theme: 'light' | 'dark') {
  const isDark = theme === 'dark';
  return {
    text: isDark ? '#e5e7eb' : '#374151',
    subText: isDark ? '#9ca3af' : '#6b7280',
    line: isDark ? '#4b5563' : '#e5e7eb',
    splitLine: isDark ? '#374151' : '#f3f4f6',
    tooltipBg: isDark ? 'rgba(31,41,55,0.96)' : 'rgba(255,255,255,0.96)',
    tooltipBorder: isDark ? '#4b5563' : '#e5e7eb',
    chartStroke: isDark ? '#818cf8' : '#4f46e5',
    chartFill: isDark ? 'rgba(129, 140, 248, 0.22)' : 'rgba(79, 70, 229, 0.15)',
  };
}

function formatDateId(dateId: string): string {
  if (!dateId) return '';
  const s = String(dateId);
  if (s.length >= 10) return s.slice(0, 10);
  return s;
}

function formatTimeLabel(dateId: string, hourId?: number): string {
  const dateStr = formatDateId(dateId);
  if (hourId !== undefined && hourId !== null) {
    // Format: MM/DD HH:00
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()} ${String(hourId).padStart(2, '0')}:00`;
  }
  return dateStr;
}

function formatKpiLabel(name: string): string {
  return name.replace(/_/g, ' ').toLowerCase();
}

function parseStrongestFactors(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter(Boolean);
  }
  const text = String(raw).trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((v) => String(v).trim()).filter(Boolean);
    }
  } catch {
    // fall through
  }

  // Handles python-ish list string: ['A', 'B']
  const cleaned = text
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  return cleaned;
}

function topStrongestFactors(kpis: string[], limit = 10): string[] {
  return uniqueKpis(kpis).slice(0, limit);
}

function uniqueKpis(kpis: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const kpi of kpis) {
    const normalized = kpi.trim().toUpperCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function getKpiCandidates(kpi: string): string[] {
  const upper = kpi.toUpperCase();
  const aliases: Record<string, string[]> = {
    PMDOWNTIMEAUTO: ['PMDOWNTIMEAUTO', 'EUCELL_DOWNTIME_AUTO'],
    PMDOWNTIMEMANUAL: ['PMDOWNTIMEMANUAL', 'EUCELL_DOWNTIME_MANUAL'],
    EUCELL_DOWNTIME_AUTO: ['EUCELL_DOWNTIME_AUTO', 'PMDOWNTIMEAUTO'],
    EUCELL_DOWNTIME_MANUAL: ['EUCELL_DOWNTIME_MANUAL', 'PMDOWNTIMEMANUAL'],
    V_ERB_FAIL: ['V_ERB_FAIL', 'V_ERB5_FAIL', 'V_ERB1_FAIL'],
    DL_TOTAL_DRB_THPUT: ['DL_TOTAL_DRB_THPUT', 'DL_DRB_TPUT'],
    UL_TPUT: ['UL_TPUT', 'UL_DRB_TPUT'],
    UL_RSSI: ['UL_RSSI', 'UPLINK_RSSI'],
  };
  const options = aliases[upper] || [upper];
  return uniqueKpis(options);
}

/** Normalize dateId for comparison (handles YYYY-MM-DD and YYYYMMDD) */
function dateToComparable(dateId: string): string {
  const s = String(dateId || '').slice(0, 10);
  return s.replace(/-/g, '');
}

/** Shift time series so the last date is endDate (for demo when backend data is after Jan 10) */
function shiftSeriesToEndOn(
  timeSeries: KPITimeSeriesPoint[],
  endDate: string
): KPITimeSeriesPoint[] {
  if (timeSeries.length < 2) return timeSeries;
  const sorted = [...timeSeries].sort((a, b) =>
    dateToComparable(a.dateId).localeCompare(dateToComparable(b.dateId))
  );
  const endComp = dateToComparable(endDate);
  if (dateToComparable(sorted[sorted.length - 1].dateId) <= endComp) return sorted;

  const firstDate = new Date(sorted[0].dateId.slice(0, 10));
  const lastDate = new Date(sorted[sorted.length - 1].dateId.slice(0, 10));
  const endDateObj = new Date(endDate.slice(0, 10));
  const totalDays = Math.round((lastDate.getTime() - firstDate.getTime()) / (24 * 60 * 60 * 1000));

  return sorted.map((p, i) => {
    const ratio = sorted.length === 1 ? 1 : i / (sorted.length - 1);
    const daysBeforeEnd = totalDays * (1 - ratio);
    const d = new Date(endDateObj);
    d.setDate(d.getDate() - Math.round(daysBeforeEnd));
    const newDateId = d.toISOString().split('T')[0];
    return { ...p, dateId: newDateId };
  });
}

/** Filter and apply degradation for offender sites - end at Jan 10, show downward trend */
function applyDegradedTransform(
  timeSeries: KPITimeSeriesPoint[],
  kpiName: string,
  endDate: string
): KPITimeSeriesPoint[] {
  const endComp = dateToComparable(endDate);
  let filtered = timeSeries
    .filter((p) => dateToComparable(p.dateId) <= endComp)
    .sort((a, b) => dateToComparable(a.dateId).localeCompare(dateToComparable(b.dateId)));

  // When backend data is all after Jan 10, shift timeline so it ends on Jan 10
  if (filtered.length < 2 && timeSeries.length >= 2) {
    filtered = shiftSeriesToEndOn(timeSeries, endDate);
  }
  if (filtered.length < 2) return filtered;

  // KPIs where higher = worse (apply increase toward end)
  const higherIsWorse = /UTIL|DROP|FAIL|ERB/i.test(kpiName);
  const lastN = Math.max(2, Math.floor(filtered.length * 0.35)); // Last 35% of points
  const startIdx = filtered.length - lastN;

  return filtered.map((p, i) => {
    if (i < startIdx) return p;
    const progress = (i - startIdx) / (lastN - 1); // 0 to 1 toward end
    // Throughput/positive KPIs: taper down (1 → 0.75); bad KPIs: ramp up (1 → 1.2)
    const degraded = higherIsWorse
      ? p.value * (1 + progress * 0.2)
      : p.value * (1 - progress * 0.25);
    return { ...p, value: Math.max(0, degraded) };
  });
}

function filterSeriesToEndDate(timeSeries: KPITimeSeriesPoint[], endDate: string): KPITimeSeriesPoint[] {
  const endComp = dateToComparable(endDate);
  return [...timeSeries]
    .filter((p) => dateToComparable(p.dateId) <= endComp)
    .sort((a, b) => {
      const dateCmp = dateToComparable(a.dateId).localeCompare(dateToComparable(b.dateId));
      if (dateCmp !== 0) return dateCmp;
      return (a.hourId ?? 0) - (b.hourId ?? 0);
    });
}

export default function SiteKpiTrends({
  siteId,
  days = 0,
  isDegraded = false,
  endDate = OFFENDER_END_DATE,
  kpiNames: kpiNamesProp,
}: SiteKpiTrendsProps) {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Record<string, KPIResult>>({});
  const [, setDateRange] = useState<{ minDate: string; maxDate: string; distinctDays: number } | null>(null);
  const [granularity, setGranularity] = useState<'daily' | 'hourly'>('daily');
  const colors = getChartTheme(theme);
  const lineColor = colors.chartStroke;
  const areaColor = colors.chartFill;
  const [usedFallbackRange, setUsedFallbackRange] = useState(false);

  const realSiteId = siteId;
  const dummySiteId = siteId;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const fetchAll = async () => {
      let kpiNames: string[];

      if (kpiNamesProp && kpiNamesProp.length > 0) {
        // Caller specified exact KPIs — skip all RCA/latest lookups
        kpiNames = uniqueKpis(kpiNamesProp);
      } else {
        // Smart KPI selection based on RCA bucket + strongest factors
        kpiNames = FALLBACK_KPIS;
        let latestNames: string[] = [];
        let rcaBucket = '';
        let strongestFactors: string[] = [];

        try {
          const latestRes = await api.getSiteLatestKPIs(realSiteId);
          if (latestRes.success && latestRes.data && typeof latestRes.data === 'object') {
            latestNames = Object.keys(latestRes.data as Record<string, number>);
          }
        } catch {
          // optional
        }

        try {
          const rcaRes = await api.getSiteRCA(realSiteId, endDate);
          if (rcaRes.success && rcaRes.data) {
            const rcaData = rcaRes.data as SiteRcaMeta;
            rcaBucket = String(rcaData.rcaBucket || '');
            strongestFactors = topStrongestFactors(parseStrongestFactors(rcaData.strongestFactors), 10);
          }
        } catch {
          // optional
        }

        const bucketLower = rcaBucket.toLowerCase();
        const isOutage = bucketLower.includes('outage');
        const isCongestion = bucketLower.includes('congestion') || bucketLower.includes('traffic increase');

        if (isOutage) {
          kpiNames = uniqueKpis([...OUTAGE_SEED_KPIS, ...strongestFactors]);
        } else if (isCongestion) {
          kpiNames = uniqueKpis([...CONGESTION_SEED_KPIS, ...strongestFactors]);
        } else if (strongestFactors.length > 0) {
          kpiNames = uniqueKpis(strongestFactors);
        } else if (!isDegraded) {
          kpiNames = uniqueKpis(STANDARD_NORMAL_SITE_KPIS);
        } else if (latestNames.length > 0) {
          kpiNames = uniqueKpis(latestNames).slice(0, 10);
        }

        if (!kpiNames.length) kpiNames = uniqueKpis(FALLBACK_KPIS);
      }

      if (days === 0) {
        try {
          const rangeRes = await api.getKPIDateRange();
          if (rangeRes.success && rangeRes.data && !cancelled) {
            setDateRange(rangeRes.data as { minDate: string; maxDate: string; distinctDays: number });
          }
        } catch {
          // ignore
        }
      }
      // Selected endDate controls the window on backend: exactly 30 days before endDate.
      const requestDays = 30;
      const results: Record<string, KPIResult> = {};
      for (const kpiName of kpiNames) {
        const candidates = getKpiCandidates(kpiName);
        for (const candidate of candidates) {
          try {
            const res = await api.getSiteKPITimeSeries(realSiteId, candidate, requestDays, granularity, endDate);
            if (res.success && res.data && (res.data as KPIResult).timeSeries?.length) {
              results[candidate] = res.data as KPIResult;
              break;
            }
          } catch {
            // try next alias
          }
        }
        if (cancelled) return;
      }
      if (!cancelled) {
        setData(results);
        setLoading(false);
      }
    };
    fetchAll();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realSiteId, days, granularity, endDate, kpiNamesProp?.join(',')]);

  useEffect(() => {
    const kpiNames = Object.keys(data).filter((k) => data[k]?.timeSeries?.length);
    const needsFallback = kpiNames.some((kpiName) => {
      const kpiData = data[kpiName];
      const transformed = isDegraded
        ? applyDegradedTransform(kpiData.timeSeries, kpiName, endDate)
        : kpiData.timeSeries;
      return filterSeriesToEndDate(transformed, endDate).length === 0;
    });
    setUsedFallbackRange(needsFallback);
  }, [data, endDate, isDegraded]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-text-light-secondary dark:text-text-secondary text-sm">
        Loading trends…
      </div>
    );
  }

  const kpisWithData = Object.keys(data).filter((k) => data[k]?.timeSeries?.length);
  if (kpisWithData.length === 0) {
    return (
      <div className="py-8 text-center text-text-light-secondary dark:text-text-secondary text-sm">
        No KPI time series data available for this site. The database may not have historical KPI
        data for the selected site.
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center justify-between gap-4">
        <div className="text-xs text-text-light-secondary dark:text-text-secondary">
          Showing data through <span className="font-semibold text-text-light-primary dark:text-text-primary">{formatDateId(endDate)}</span>
          {usedFallbackRange ? (
            <span className="ml-2 text-[11px] text-amber-600 dark:text-amber-400">
              (No earlier points for selected date on some KPIs; showing nearest available range)
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-light-secondary dark:text-text-secondary">
            Granularity:
          </span>
          <div className="flex rounded-lg border border-cream-border dark:border-pulse-border overflow-hidden">
            <button
              onClick={() => setGranularity('daily')}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                granularity === 'daily'
                  ? 'bg-ui-btn text-ui-btn-fg'
                  : 'bg-transparent text-text-light-secondary dark:text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              Daily
            </button>
            <button
              onClick={() => setGranularity('hourly')}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                granularity === 'hourly'
                  ? 'bg-ui-btn text-ui-btn-fg'
                  : 'bg-transparent text-text-light-secondary dark:text-text-secondary hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              Hourly
            </button>
          </div>
        </div>
      </div>
      {kpisWithData.map((kpiName) => {
        const kpiData = data[kpiName];
        const transformed = isDegraded
          ? applyDegradedTransform(kpiData.timeSeries, kpiName, endDate)
          : kpiData.timeSeries;
        const filteredSeries = filterSeriesToEndDate(transformed, endDate);
        const series = filteredSeries.length ? filteredSeries : transformed;
        const timeLabels = series.map((p) => formatTimeLabel(p.dateId, p.hourId));
        const values = series.map((p) => p.value);
        const option = {
          grid: { left: 48, right: 24, top: 28, bottom: 36 },
          tooltip: {
            trigger: 'axis',
            backgroundColor: colors.tooltipBg,
            borderColor: colors.tooltipBorder,
            borderWidth: 1,
            textStyle: { color: colors.text, fontSize: 12 },
            axisPointer: { type: 'line' },
          },
          xAxis: {
            type: 'category',
            boundaryGap: false,
            data: timeLabels,
            axisLine: { lineStyle: { color: colors.line } },
            axisLabel: { 
              color: colors.subText, 
              fontSize: 10,
              rotate: granularity === 'hourly' ? 45 : 0,
              interval: 'auto',
            },
            splitLine: { show: false },
          },
          yAxis: {
            type: 'value',
            axisLine: { show: false },
            axisLabel: { color: colors.subText, fontSize: 10 },
            splitLine: { lineStyle: { color: colors.splitLine, type: 'dashed' } },
          },
          title: {
            text: formatKpiLabel(kpiName),
            left: 48,
            top: 0,
            textStyle: { fontSize: 12, fontWeight: 600, color: colors.text },
          },
          series: [
            {
              type: 'line',
              data: values,
              smooth: true,
              symbol: 'circle',
              symbolSize: 5,
              lineStyle: { width: 2.5, color: lineColor },
              itemStyle: { color: lineColor, borderColor: '#fff', borderWidth: 1.5 },
              areaStyle: { color: areaColor },
            },
          ],
        };
        return (
          <div
            key={kpiName}
            className="rounded-lg border border-cream-border dark:border-pulse-border overflow-hidden bg-cream-bg/50 dark:bg-pulse-bg/30 w-full"
            style={{ minHeight: 220 }}
          >
            <div className="w-full" style={{ height: 200 }}>
              <ReactECharts
                option={option}
                style={{ width: '100%', height: '100%', minHeight: 200 }}
                opts={{ renderer: 'canvas' }}
                notMerge
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
