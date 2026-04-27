import { useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Cpu,
  Radio,
  Signal,
  TrendingUp,
  Waves,
  Zap,
  Globe,
  RefreshCw,
} from 'lucide-react';
import type { MapSite } from './MapView';
import MarketInsightsPanel, { type MarketHeaderMeta } from './MarketInsightsPanel';

type DashboardTab = 'executive' | 'ran' | 'capacity' | 'alarms' | 'forecast' | 'market';

interface TelemetryDashboardProps {
  onClose: () => void;
  site?: MapSite | null;
  activeTab?: DashboardTab;
  onTabChange?: (tab: DashboardTab) => void;
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function SparkArea({ values, stroke, fill }: { values: number[]; stroke: string; fill: string }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      const y = 100 - ((value - min) / span) * 100;
      return `${x},${y}`;
    })
    .join(' ');
  const area = `${points} 100,100 0,100`;
  const gradientId = `telemetry-${stroke.replace('#', '')}`;

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-24 w-full">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity="0.34" />
          <stop offset="100%" stopColor={fill} stopOpacity="0.04" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradientId})`} />
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="2.3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CompactBars({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values) || 1;
  return (
    <div className="flex h-24 items-end gap-1.5">
      {values.map((value, index) => (
        <div
          key={`${value}-${index}`}
          className="flex-1 rounded-t-[10px]"
          style={{
            height: `${Math.max(16, (value / max) * 100)}%`,
            background: `linear-gradient(180deg, ${color}, rgba(15,23,42,0.06))`,
          }}
        />
      ))}
    </div>
  );
}

function HeatStrip({ items }: { items: Array<{ label: string; value: string; level: number }> }) {
  return (
    <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
      {items.map((item) => {
        const opacity = 0.12 + item.level * 0.2;
        return (
          <div
            key={item.label}
            className="rounded-2xl border p-3"
            style={{
              borderColor: `rgba(20,184,166,${0.12 + item.level * 0.12})`,
              background: `linear-gradient(180deg, rgba(20,184,166,${opacity}), rgba(255,255,255,0.02))`,
            }}
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">
              {item.label}
            </div>
            <div className="mt-2 text-lg font-semibold text-text-light-primary dark:text-text-primary">{item.value}</div>
          </div>
        );
      })}
    </div>
  );
}

function SectionCard({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-cream-border bg-white/88 shadow-[0_18px_42px_rgba(15,23,42,0.08)] backdrop-blur-sm dark:border-pulse-border dark:bg-pulse-surface/90 dark:shadow-[0_22px_54px_rgba(0,0,0,0.28)]">
      <div className="flex items-center justify-between gap-3 border-b border-cream-border/80 px-5 py-4 dark:border-pulse-border/80">
        <div className="flex items-center gap-2.5">
          {icon ? <div className="text-red-500 dark:text-red-400">{icon}</div> : null}
          <h3 className="text-sm font-semibold text-text-light-primary dark:text-text-primary">{title}</h3>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function StatCard({
  label,
  value,
  delta,
  values,
  accent,
  badge,
}: {
  label: string;
  value: string;
  delta: string;
  values: number[];
  accent: string;
  badge: string;
}) {
  return (
    <div className="rounded-[24px] border border-cream-border bg-white/92 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.06)] dark:border-pulse-border dark:bg-pulse-surface/92 dark:shadow-[0_18px_40px_rgba(0,0,0,0.26)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-light-muted dark:text-text-muted">{label}</div>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-3xl font-semibold tracking-[-0.03em] text-text-light-primary dark:text-text-primary">{value}</span>
            <span className="rounded-full border border-border bg-cream-bg px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary dark:border-white/10 dark:bg-white/5 dark:text-white/72">
              {badge}
            </span>
          </div>
        </div>
        <div className="rounded-2xl border border-cream-border px-2.5 py-1 text-right dark:border-pulse-border">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-light-muted dark:text-text-muted">Delta</div>
          <div className="mt-1 text-sm font-semibold" style={{ color: accent }}>{delta}</div>
        </div>
      </div>
      <SparkArea values={values} stroke={accent} fill={accent} />
    </div>
  );
}

export default function TelemetryDashboard({ onClose: _onClose, site, activeTab: controlledTab, onTabChange }: TelemetryDashboardProps) {
  const [localTab, setLocalTab] = useState<DashboardTab>('market');
  const activeTab = controlledTab ?? localTab;
  const setActiveTab = (tab: DashboardTab) => { setLocalTab(tab); onTabChange?.(tab); };
  const [marketHeaderMeta, setMarketHeaderMeta] = useState<MarketHeaderMeta | null>(null);

  const data = useMemo(() => {
    const siteLabel = site?.siteId || 'National RAN Mesh';
    return {
      siteLabel,
      updateStamp: '12s',
      confidence: '93.4%',
      tabs: [
        { id: 'market' as const,    label: 'Market',      primary: true  },
        { id: 'executive' as const, label: 'Executive',   primary: false },
        { id: 'ran' as const,       label: 'RAN Health',  primary: false },
        { id: 'capacity' as const,  label: 'Capacity',    primary: false },
        { id: 'alarms' as const,    label: 'Alarms',      primary: false },
        { id: 'forecast' as const,  label: 'AI Forecast', primary: false },
      ],
      topStats: [
        { label: 'RRC Success', value: '98.21%', delta: '+0.42%', badge: 'Stable', accent: '#0f766e', values: [94, 95, 95.8, 96.4, 97.2, 97.8, 98.21] },
        { label: 'ERAB Drop', value: '0.61%', delta: '+0.18%', badge: 'Watch', accent: '#94a3b8', values: [0.22, 0.24, 0.31, 0.38, 0.49, 0.55, 0.61] },
        { label: 'PRB Load', value: '84.7%', delta: '+6.1%', badge: 'High', accent: '#64748b', values: [61, 64, 67, 72, 76, 81, 84.7] },
        { label: 'SINR', value: '19.6 dB', delta: '-0.7 dB', badge: 'Tight', accent: '#0891b2', values: [22.6, 22.4, 21.9, 21.4, 20.9, 20.3, 19.6] },
      ],
      busyHour: [56, 59, 63, 69, 71, 75, 82, 88, 92, 96, 94, 90],
      anomalyBars: [28, 31, 35, 41, 39, 44, 47, 49, 52, 58, 61, 57],
      sectors: [
        { sector: 'S1 n77', load: '91%', users: '182', sinr: '18.8', handover: '96.2%', anomaly: '0.92' },
        { sector: 'S2 B66', load: '78%', users: '149', sinr: '21.1', handover: '98.4%', anomaly: '0.44' },
        { sector: 'S3 LTE2100', load: '82%', users: '136', sinr: '19.4', handover: '97.1%', anomaly: '0.68' },
        { sector: 'NBR n41', load: '74%', users: '167', sinr: '20.7', handover: '97.8%', anomaly: '0.57' },
      ],
      stackHeat: [
        { label: 'RU Sync', value: '99.2%', level: 0.18 },
        { label: 'DU CPU', value: '83.6%', level: 0.74 },
        { label: 'CU-UP Jitter', value: '4.3 ms', level: 0.46 },
        { label: 'Fronthaul Loss', value: '0.08%', level: 0.22 },
      ],
      capacityRows: [
        { name: 'UST237369 / S1 / n77', now: '86%', next15: '91%', next60: '96%', action: 'Offload' },
        { name: 'UST410764 / S3 / n41', now: '69%', next15: '83%', next60: '88%', action: 'Pre-arm' },
        { name: 'UST516644 / LTE2100', now: '78%', next15: '84%', next60: '89%', action: 'Tilt audit' },
        { name: 'Airport macro strip', now: '73%', next15: '79%', next60: '85%', action: 'Watch' },
      ],
      alarms: [
        { title: 'Beam mismatch', severity: 'Critical', score: '0.94', vector: [41, 46, 53, 58, 62, 70, 81] },
        { title: 'RLC retry burst', severity: 'High', score: '0.87', vector: [18, 22, 27, 39, 36, 44, 51] },
        { title: 'Backhaul latency', severity: 'Medium', score: '0.71', vector: [12, 16, 19, 21, 29, 26, 33] },
      ],
      forecast: [64, 67, 70, 74, 79, 83, 88, 92, 95, 98, 96, 93],
      forecastTiles: [
        { label: 'Next spike', value: '14 min', level: 0.72 },
        { label: 'Impact radius', value: '4 sectors', level: 0.56 },
        { label: 'Auto-approved', value: '2 / 5', level: 0.42 },
        { label: 'Model drift', value: '2.1%', level: 0.28 },
      ],
      forecastMix: [52, 56, 61, 65, 68, 74, 81, 85, 89, 91],
    };
  }, [site]);

  const tabButtonClass = (tab: DashboardTab, primary: boolean) =>
    cx(
      'rounded-full border transition-all',
      // Market tab — full size; legacy tabs — smaller & muted
      primary
        ? 'px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em]'
        : 'px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] opacity-40 hover:opacity-70',
      activeTab === tab
        ? 'border-slate-900 bg-slate-900 text-white shadow-[0_12px_24px_rgba(15,23,42,0.18)] dark:border-white dark:bg-white dark:text-slate-900 opacity-100'
        : primary
        ? 'border-cream-border bg-white/80 text-text-light-secondary hover:border-slate-300 hover:text-text-light-primary dark:border-pulse-border dark:bg-pulse-surface/75 dark:text-text-secondary dark:hover:border-white/18 dark:hover:text-text-primary'
        : 'border-cream-border bg-transparent text-text-light-muted dark:border-white/8 dark:text-text-muted',
    );

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-cream-bg text-text-light-primary dark:bg-pulse-bg dark:text-text-primary">
      <div className="relative flex flex-1 min-h-0 flex-col overflow-hidden pt-20">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(15,118,110,0.08),transparent_28%)] dark:bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.12),transparent_24%)]" />

        <header className="relative px-6 pb-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-4">
            <div className="min-w-0 pt-1">
              {activeTab === 'market' && marketHeaderMeta && (
                <div className="flex items-center gap-2 text-xs text-text-light-secondary dark:text-text-secondary">
                  <span className="font-medium text-text-light-primary dark:text-text-primary">Date:</span>
                  <span className="font-mono">{marketHeaderMeta.dateId}</span>
                  {marketHeaderMeta.lastRefresh && !marketHeaderMeta.error && (
                    <>
                      <span className="text-text-light-muted dark:text-text-muted">·</span>
                      {marketHeaderMeta.fromCache ? (
                        <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-600 dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-300">
                          Cached
                        </span>
                      ) : (
                        <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-600 dark:border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-300">
                          Live
                        </span>
                      )}
                    </>
                  )}
                  {marketHeaderMeta.error && (
                    <>
                      <span className="text-text-light-muted dark:text-text-muted">·</span>
                      <span className="text-amber-500 dark:text-amber-400">{marketHeaderMeta.error}</span>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col items-center gap-3">
              <div className="inline-flex items-center gap-1 rounded-full border border-cream-border bg-white/82 p-1.5 shadow-[0_18px_36px_rgba(15,23,42,0.08)] backdrop-blur-md dark:border-pulse-border dark:bg-pulse-surface/78 dark:shadow-[0_20px_44px_rgba(0,0,0,0.24)]">
                {data.tabs.map((tab, i) => (
                  <>
                    {/* Divider between Market and the legacy tabs */}
                    {i === 1 && (
                      <span key="divider" className="mx-1 h-4 w-px rounded-full bg-cream-surface-light dark:bg-white/10" />
                    )}
                    <button
                      key={tab.id}
                      className={tabButtonClass(tab.id, tab.primary)}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      {tab.id === 'market' ? (
                        <span className="flex items-center gap-1.5">
                          <Globe className="w-3 h-3" />
                          {tab.label}
                        </span>
                      ) : tab.label}
                    </button>
                  </>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-0.5">
              {activeTab === 'market' && marketHeaderMeta && (
                <button
                  type="button"
                  onClick={marketHeaderMeta.refresh}
                  disabled={marketHeaderMeta.loading}
                  title="Force-refresh (bypasses cache)"
                  className="flex items-center gap-1.5 rounded-xl border border-cream-border bg-white/80 px-3 py-1.5 text-[11px] font-semibold text-text-light-secondary transition-colors hover:text-text-light-primary disabled:opacity-50 dark:border-pulse-border dark:bg-pulse-surface/70 dark:text-text-secondary dark:hover:text-text-primary"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${marketHeaderMeta.loading ? 'animate-spin' : ''}`} />
                  {marketHeaderMeta.fromCache ? 'Force refresh' : 'Refresh'}
                </button>
              )}
            </div>
          </div>
        </header>

        <div className={`relative flex-1 overflow-y-auto scrollbar-thin ${activeTab !== 'market' ? 'px-6 pb-6' : ''}`}>
          {activeTab === 'market' && (
            <MarketInsightsPanel onHeaderMetaChange={setMarketHeaderMeta} />
          )}
          <div className={`grid gap-5 ${activeTab === 'market' ? 'hidden' : ''}`}>
            <div className="grid gap-5 xl:grid-cols-4">
              {data.topStats.map((item) => (
                <StatCard
                  key={item.label}
                  label={item.label}
                  value={item.value}
                  delta={item.delta}
                  badge={item.badge}
                  values={item.values}
                  accent={item.accent}
                />
              ))}
            </div>

            {activeTab === 'executive' && (
              <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
                <SectionCard title="National Snapshot" icon={<TrendingUp className="h-4 w-4" />}>
                  <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-[24px] border border-cream-border bg-cream-surface/55 p-4 dark:border-pulse-border dark:bg-pulse-surface-light/35">
                      <div className="mb-4 flex items-center justify-between">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">Busy Hour Pressure</div>
                          <div className="mt-1 text-xl font-semibold text-text-light-primary dark:text-text-primary">92 / 100</div>
                        </div>
                        <div className="text-right text-xs text-text-light-secondary dark:text-text-secondary">
                          <div>Congestion cells 17</div>
                          <div>Affected sessions 4.8k</div>
                        </div>
                      </div>
                      <SparkArea values={data.busyHour} stroke="#0f766e" fill="#14b8a6" />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[22px] border border-cream-border bg-white/90 p-4 dark:border-pulse-border dark:bg-pulse-surface/84">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">Predicted spikes</div>
                        <div className="mt-3 text-3xl font-semibold text-text-light-primary dark:text-text-primary">6</div>
                      </div>
                      <div className="rounded-[22px] border border-cream-border bg-white/90 p-4 dark:border-pulse-border dark:bg-pulse-surface/84">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">Auto-guarded</div>
                        <div className="mt-3 text-3xl font-semibold text-text-light-primary dark:text-text-primary">82%</div>
                      </div>
                      <div className="rounded-[22px] border border-cream-border bg-white/90 p-4 dark:border-pulse-border dark:bg-pulse-surface/84">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">Alarm graph score</div>
                        <div className="mt-3 text-3xl font-semibold text-text-light-primary dark:text-text-primary">0.94</div>
                      </div>
                      <div className="rounded-[22px] border border-cream-border bg-white/90 p-4 dark:border-pulse-border dark:bg-pulse-surface/84">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">Forecast horizon</div>
                        <div className="mt-3 text-3xl font-semibold text-text-light-primary dark:text-text-primary">60m</div>
                      </div>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="RAN Stack Heat" icon={<Cpu className="h-4 w-4" />}>
                  <HeatStrip items={data.stackHeat} />
                  <div className="mt-4 rounded-[22px] border border-cream-border bg-cream-surface/55 p-4 dark:border-pulse-border dark:bg-pulse-surface-light/35">
                    <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">Anomaly velocity</div>
                    <CompactBars values={data.anomalyBars} color="#94a3b8" />
                  </div>
                </SectionCard>
              </div>
            )}

            {activeTab === 'ran' && (
              <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                <SectionCard title="Sector Diagnostics" icon={<Radio className="h-4 w-4" />}>
                  <div className="grid gap-3">
                    {data.sectors.map((sector) => (
                      <div key={sector.sector} className="grid grid-cols-[1.1fr_repeat(4,minmax(0,0.55fr))] gap-3 rounded-[22px] border border-cream-border bg-white/92 px-4 py-3 text-sm dark:border-pulse-border dark:bg-pulse-surface/84">
                        <div>
                          <div className="font-semibold text-text-light-primary dark:text-text-primary">{sector.sector}</div>
                          <div className="text-[10px] uppercase tracking-[0.14em] text-text-light-muted dark:text-text-muted">Users {sector.users}</div>
                        </div>
                        <div><div className="text-[10px] uppercase tracking-[0.14em] text-text-light-muted dark:text-text-muted">Load</div><div className="mt-1 font-semibold">{sector.load}</div></div>
                        <div><div className="text-[10px] uppercase tracking-[0.14em] text-text-light-muted dark:text-text-muted">SINR</div><div className="mt-1 font-semibold">{sector.sinr}</div></div>
                        <div><div className="text-[10px] uppercase tracking-[0.14em] text-text-light-muted dark:text-text-muted">HO</div><div className="mt-1 font-semibold">{sector.handover}</div></div>
                        <div><div className="text-[10px] uppercase tracking-[0.14em] text-text-light-muted dark:text-text-muted">Anomaly</div><div className="mt-1 font-semibold text-red-600 dark:text-red-300">{sector.anomaly}</div></div>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Signal Distribution" icon={<Signal className="h-4 w-4" />}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-[22px] border border-cream-border bg-cream-surface/55 p-4 dark:border-pulse-border dark:bg-pulse-surface-light/35">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">SINR envelope</div>
                      <SparkArea values={[74, 72, 75, 78, 76, 81, 84, 82, 86, 88]} stroke="#0891b2" fill="#22d3ee" />
                    </div>
                    <div className="rounded-[22px] border border-cream-border bg-cream-surface/55 p-4 dark:border-pulse-border dark:bg-pulse-surface-light/35">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">Interference</div>
                      <SparkArea values={[18, 21, 27, 33, 31, 29, 35, 39, 42, 40]} stroke="#64748b" fill="#94a3b8" />
                    </div>
                    <div className="rounded-[22px] border border-cream-border bg-cream-surface/55 p-4 dark:border-pulse-border dark:bg-pulse-surface-light/35">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">HARQ retry</div>
                      <CompactBars values={[16, 19, 23, 28, 25, 31, 36, 42, 38, 34]} color="#0f766e" />
                    </div>
                    <div className="rounded-[22px] border border-cream-border bg-cream-surface/55 p-4 dark:border-pulse-border dark:bg-pulse-surface-light/35">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">SON score</div>
                      <div className="mt-6 text-center">
                        <div className="text-5xl font-semibold tracking-[-0.04em] text-text-light-primary dark:text-text-primary">8.4</div>
                        <div className="mt-2 text-xs uppercase tracking-[0.16em] text-text-secondary dark:text-white/62">Closed-loop stable</div>
                      </div>
                    </div>
                  </div>
                </SectionCard>
              </div>
            )}

            {activeTab === 'capacity' && (
              <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
                <SectionCard title="Carrier Forecast Table" icon={<Zap className="h-4 w-4" />}>
                  <div className="space-y-3">
                    {data.capacityRows.map((row) => (
                      <div key={row.name} className="grid grid-cols-[1.45fr_repeat(3,minmax(0,0.45fr))_0.55fr] gap-3 rounded-[22px] border border-cream-border bg-white/92 px-4 py-3 text-sm dark:border-pulse-border dark:bg-pulse-surface/84">
                        <div className="font-semibold text-text-light-primary dark:text-text-primary">{row.name}</div>
                        <div><div className="text-[10px] uppercase tracking-[0.14em] text-text-light-muted dark:text-text-muted">Now</div><div className="mt-1 font-semibold">{row.now}</div></div>
                        <div><div className="text-[10px] uppercase tracking-[0.14em] text-text-light-muted dark:text-text-muted">+15m</div><div className="mt-1 font-semibold">{row.next15}</div></div>
                        <div><div className="text-[10px] uppercase tracking-[0.14em] text-text-light-muted dark:text-text-muted">+60m</div><div className="mt-1 font-semibold text-red-600 dark:text-red-300">{row.next60}</div></div>
                        <div><div className="text-[10px] uppercase tracking-[0.14em] text-text-light-muted dark:text-text-muted">Action</div><div className="mt-1 font-semibold">{row.action}</div></div>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Balancing Matrix" icon={<Waves className="h-4 w-4" />}>
                  <HeatStrip
                    items={[
                      { label: 'n77 C1', value: '92%', level: 0.88 },
                      { label: 'n77 C2', value: '81%', level: 0.68 },
                      { label: 'B66 Anchor', value: '66%', level: 0.36 },
                      { label: 'LTE2100', value: '74%', level: 0.5 },
                    ]}
                  />
                  <div className="mt-4 rounded-[22px] border border-cream-border bg-cream-surface/55 p-4 dark:border-pulse-border dark:bg-pulse-surface-light/35">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">Forecast mix</div>
                    <CompactBars values={data.forecastMix} color="#64748b" />
                  </div>
                </SectionCard>
              </div>
            )}

            {activeTab === 'alarms' && (
              <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                <SectionCard title="Alarm Graph" icon={<AlertTriangle className="h-4 w-4" />}>
                  <div className="space-y-3">
                    {data.alarms.map((alarm) => (
                      <div key={alarm.title} className="rounded-[22px] border border-cream-border bg-white/92 p-4 dark:border-pulse-border dark:bg-pulse-surface/84">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="font-semibold text-text-light-primary dark:text-text-primary">{alarm.title}</div>
                          <div className="rounded-full border border-border bg-cream-bg px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary dark:border-white/10 dark:bg-white/5 dark:text-white/72">
                            {alarm.severity} · {alarm.score}
                          </div>
                        </div>
                        <CompactBars values={alarm.vector} color="#94a3b8" />
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard title="Incident Pressure" icon={<Activity className="h-4 w-4" />}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-[22px] border border-cream-border bg-cream-surface/55 p-4 dark:border-pulse-border dark:bg-pulse-surface-light/35">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">Transport jitter</div>
                      <SparkArea values={[12, 14, 18, 21, 27, 24, 29, 34, 31, 37]} stroke="#64748b" fill="#94a3b8" />
                    </div>
                    <div className="rounded-[22px] border border-cream-border bg-cream-surface/55 p-4 dark:border-pulse-border dark:bg-pulse-surface-light/35">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">HO failure pocket</div>
                      <SparkArea values={[8, 12, 11, 17, 23, 28, 25, 31, 36, 32]} stroke="#0891b2" fill="#22d3ee" />
                    </div>
                    <div className="rounded-[22px] border border-cream-border bg-white/92 p-4 dark:border-pulse-border dark:bg-pulse-surface/84">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">Correlated domains</div>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-2xl border border-cream-border px-3 py-3 dark:border-pulse-border">RAN</div>
                        <div className="rounded-2xl border border-cream-border px-3 py-3 dark:border-pulse-border">Transport</div>
                        <div className="rounded-2xl border border-cream-border px-3 py-3 dark:border-pulse-border">Scheduler</div>
                        <div className="rounded-2xl border border-cream-border px-3 py-3 dark:border-pulse-border">SON</div>
                      </div>
                    </div>
                    <div className="rounded-[22px] border border-cream-border bg-white/92 p-4 dark:border-pulse-border dark:bg-pulse-surface/84">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">Root cause score</div>
                      <div className="mt-5 text-center text-5xl font-semibold tracking-[-0.04em] text-text-light-primary dark:text-text-primary">0.94</div>
                    </div>
                  </div>
                </SectionCard>
              </div>
            )}

            {activeTab === 'forecast' && (
              <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
                <SectionCard title="Predictive Congestion" icon={<BrainCircuit className="h-4 w-4" />}>
                  <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-[22px] border border-cream-border bg-cream-surface/55 p-4 dark:border-pulse-border dark:bg-pulse-surface-light/35">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">60 minute forecast</div>
                        <div className="text-sm font-semibold text-text-secondary dark:text-white/82">96%</div>
                      </div>
                      <SparkArea values={data.forecast} stroke="#0f766e" fill="#14b8a6" />
                    </div>
                    <HeatStrip items={data.forecastTiles} />
                  </div>
                </SectionCard>

                <SectionCard title="Inference Fabric" icon={<Cpu className="h-4 w-4" />}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-[22px] border border-cream-border bg-white/92 p-4 dark:border-pulse-border dark:bg-pulse-surface/84">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">Model health</div>
                      <div className="mt-3 text-3xl font-semibold text-text-light-primary dark:text-text-primary">Healthy</div>
                      <div className="mt-2 text-sm text-text-light-secondary dark:text-text-secondary">Drift 2.1%</div>
                    </div>
                    <div className="rounded-[22px] border border-cream-border bg-white/92 p-4 dark:border-pulse-border dark:bg-pulse-surface/84">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">Active detectors</div>
                      <div className="mt-3 text-3xl font-semibold text-text-light-primary dark:text-text-primary">7</div>
                      <div className="mt-2 text-sm text-text-light-secondary dark:text-text-secondary">Graph + counter fusion</div>
                    </div>
                    <div className="rounded-[22px] border border-cream-border bg-white/92 p-4 dark:border-pulse-border dark:bg-pulse-surface/84">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">Auto approvals</div>
                      <div className="mt-3 text-3xl font-semibold text-text-light-primary dark:text-text-primary">2 / 5</div>
                      <div className="mt-2 text-sm text-text-light-secondary dark:text-text-secondary">Guardrails active</div>
                    </div>
                    <div className="rounded-[22px] border border-cream-border bg-white/92 p-4 dark:border-pulse-border dark:bg-pulse-surface/84">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-light-muted dark:text-text-muted">Inference latency</div>
                      <div className="mt-3 text-3xl font-semibold text-text-light-primary dark:text-text-primary">142 ms</div>
                      <div className="mt-2 text-sm text-text-light-secondary dark:text-text-secondary">Near real-time</div>
                    </div>
                  </div>
                </SectionCard>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
