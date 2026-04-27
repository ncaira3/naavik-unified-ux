import { useEffect, useState } from 'react';
import { AlertCircle, TrendingUp } from 'lucide-react';
import api from '../../../services/api';
import SiteKpiTrends from '../../SiteKpiTrends';
import { useDummifier } from '../../../context/DummifierContext';

interface SiteKpiDashboardProps {
  siteId: string;
  /** When provided, show only these KPIs instead of the smart site dashboard */
  kpiNames?: string[];
}

const DEFAULT_STAT_KPIS = [
  { name: 'DL_TOTAL_DRB_THPUT', label: 'DL Throughput', unit: 'Mbps' },
  { name: 'UL_TPUT', label: 'UL Throughput', unit: 'Mbps' },
  { name: 'DATA_RAN_ACC', label: 'Accessibility', unit: '%' },
  { name: 'AVG_DL_PRB_UTIL', label: 'DL PRB Util', unit: '%' },
];

function kpiLabel(name: string): string {
  return name
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function SiteKpiDashboard({ siteId, kpiNames }: SiteKpiDashboardProps) {
  const { dId } = useDummifier();
  const [latestKpis, setLatestKpis] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    api.getSiteLatestKPIs(siteId)
      .then((response) => { if (mounted) setLatestKpis(response.data || {}); })
      .catch((err: any) => { if (mounted) setError(err?.message || 'Failed to load KPI data'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [siteId]);

  // Stat cards: use caller-specified KPIs or the default set
  const statKpis = kpiNames && kpiNames.length > 0
    ? kpiNames.map((name) => ({ name, label: kpiLabel(name), unit: '' }))
    : DEFAULT_STAT_KPIS;

  const heading = kpiNames?.length === 1
    ? kpiNames[0].replace(/_/g, ' ')
    : kpiNames?.length
      ? `${kpiNames.length} KPIs`
      : 'KPI Dashboard';

  return (
    <div className="w-full bg-gradient-to-br from-white to-gray-50 dark:from-slate-900 dark:to-slate-800 rounded-2xl border border-border dark:border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border dark:border-slate-700 bg-cream-surface dark:bg-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-sky-100 dark:bg-sky-900/20">
            <TrendingUp className="w-4.5 h-4.5 text-sky-500 dark:text-sky-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-text-primary dark:text-white">{heading}</h3>
            <p className="text-xs text-text-muted dark:text-gray-400">Site {dId(siteId)} · last 30 days</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-5 space-y-6">
        {/* Stat cards */}
        {!error && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {statKpis.map((kpi) => {
              const value = latestKpis[kpi.name];
              return (
                <div
                  key={kpi.name}
                  className="p-3 rounded-xl bg-cream-bg dark:bg-slate-700/50 border border-border dark:border-slate-600"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary dark:text-gray-400 mb-1 truncate">
                    {kpi.label}
                  </p>
                  <p className="text-sm font-bold text-text-primary dark:text-white">
                    {value !== undefined ? value.toFixed(2) : loading ? '—' : 'N/A'}
                  </p>
                  {kpi.unit && value !== undefined && (
                    <p className="text-[10px] text-text-muted dark:text-gray-500 mt-0.5">{kpi.unit}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {error && (
          <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-red-800 dark:text-red-200">Failed to load KPI data</p>
              <p className="text-[11px] text-red-700 dark:text-red-300 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Trend charts — same component, optionally filtered to specific KPIs */}
        {!error && (
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-[0.1em] text-text-secondary dark:text-gray-400 mb-3">
              Historical Trends
            </h4>
            <SiteKpiTrends siteId={siteId} kpiNames={kpiNames} />
          </div>
        )}
      </div>
    </div>
  );
}
