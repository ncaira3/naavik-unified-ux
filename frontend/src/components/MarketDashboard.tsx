import { useEffect, useState } from 'react';
import { Activity, Database, AlertCircle, Calendar } from 'lucide-react';
import api from '../services/api';

interface MetricCardProps {
  icon: React.ReactNode;
  title: string;
  value: string | number;
  subtitle?: string;
  color?: 'blue' | 'green' | 'amber' | 'red';
}

function MetricCard({ icon, title, value, subtitle, color = 'blue' }: MetricCardProps) {
  const colorMap = {
    blue: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20',
    green: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20',
    amber: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20',
    red: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
  };

  return (
    <div className="rounded-[16px] border border-border dark:border-pulse-border bg-cream-surface dark:bg-pulse-surface p-6 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-text-secondary dark:text-text-secondary">{title}</p>
          <p className="mt-2 text-3xl font-bold text-text-primary dark:text-text-primary">{value}</p>
          {subtitle && <p className="mt-1 text-xs text-text-muted dark:text-text-secondary">{subtitle}</p>}
        </div>
        <div className={`rounded-full p-3 ${colorMap[color]}`}>{icon}</div>
      </div>
    </div>
  );
}

interface DataAvailabilityRow {
  table_name: string;
  latest_date: string;
  record_count: number;
  days_old: number;
}

export default function MarketDashboard() {
  const [marketData, setMarketData] = useState<{
    total_sites: number;
    total_cells: number;
    total_offenders: number;
    latest_date: string;
  } | null>(null);
  const [dataAvailability, setDataAvailability] = useState<DataAvailabilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [marketRes, availRes] = await Promise.all([
          api.getCompassMarketDashboard(),
          api.getCompassDataAvailability(),
        ]);

        setMarketData(marketRes);
        setDataAvailability(availRes as DataAvailabilityRow[]);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load dashboard data';
        setError(errorMessage);
        console.error('Error loading market dashboard:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-secondary dark:text-text-secondary">Loading market dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 dark:text-red-400 font-medium">Error loading dashboard</p>
          <p className="text-sm text-text-muted dark:text-text-secondary mt-1">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col gap-6 overflow-auto p-6">
      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={<Activity className="w-6 h-6" />} title="Total Sites" value={marketData?.total_sites ?? 0} color="blue" />
        <MetricCard icon={<Database className="w-6 h-6" />} title="Total Cells" value={marketData?.total_cells ?? 0} color="green" />
        <MetricCard
          icon={<AlertCircle className="w-6 h-6" />}
          title="Offenders"
          value={marketData?.total_offenders ?? 0}
          subtitle="Sites with degradation"
          color="amber"
        />
        <MetricCard icon={<Calendar className="w-6 h-6" />} title="Latest Date" value={marketData?.latest_date || 'N/A'} color="blue" />
      </div>

      {/* Data Availability Table */}
      <div className="rounded-[16px] border border-border dark:border-pulse-border bg-cream-surface dark:bg-pulse-surface p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-text-primary dark:text-text-primary mb-4">Data Availability & Freshness</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border dark:border-pulse-border">
                <th className="px-4 py-3 text-left font-semibold text-text-secondary dark:text-text-primary">Table</th>
                <th className="px-4 py-3 text-left font-semibold text-text-secondary dark:text-text-primary">Latest Date</th>
                <th className="px-4 py-3 text-right font-semibold text-text-secondary dark:text-text-primary">Record Count</th>
                <th className="px-4 py-3 text-right font-semibold text-text-secondary dark:text-text-primary">Days Old</th>
              </tr>
            </thead>
            <tbody>
              {dataAvailability.map((row, idx) => (
                <tr key={idx} className="border-b border-border dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-text-secondary dark:text-text-secondary">{row.table_name}</td>
                  <td className="px-4 py-3 text-text-secondary dark:text-text-secondary">{row.latest_date || 'N/A'}</td>
                  <td className="px-4 py-3 text-right text-text-secondary dark:text-text-secondary">
                    {row.record_count ? row.record_count.toLocaleString() : '0'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`inline-block px-2 py-1 rounded font-semibold text-xs ${
                        row.days_old === 0
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : row.days_old <= 7
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      }`}
                    >
                      {row.days_old} day{row.days_old !== 1 ? 's' : ''}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-text-muted dark:text-text-secondary mt-4">
          Shows the freshness of data in each table. Green = up-to-date, Amber = slightly stale, Red = outdated
        </p>
      </div>
    </div>
  );
}
