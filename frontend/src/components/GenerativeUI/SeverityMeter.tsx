import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

interface MeterRow {
  label: string;
  value: number | null;
  /** Optional: explicit anomaly flag */
  anomaly?: boolean;
  /** Optional: secondary value (e.g. previous-week comparison). */
  prev?: number | null;
}

interface SeverityMeterProps {
  title?: string;
  subtitle?: string;
  rows: MeterRow[];
  /**
   * If set, the bars are normalised to this maximum. Otherwise we use
   * max(abs(values)).
   */
  max?: number;
  /**
   * Total impact summary value to render as a hero number above the bars.
   */
  total?: { label: string; value: number; wow?: number };
}

/**
 * Horizontal bar gauge for KPI / impact subcomponents.
 * Renders each row as an animated gradient bar; severity (red→green) is
 * derived from the magnitude of the value relative to the max.
 *
 * Visual rules:
 *  - Larger absolute values render as longer red→orange bars
 *  - Small/zero values render as short green bars
 *  - Anomaly rows get a glowing amber edge
 *  - Total impact (if provided) renders as a hero stat with WoW delta
 */
export default function SeverityMeter({ title, subtitle, rows, max, total }: SeverityMeterProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const surface = isDark ? 'rgba(28,28,30,0.85)' : 'rgba(255,255,255,0.92)';
  const border = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(45,42,38,0.10)';
  const text = isDark ? '#FBFBFB' : '#1F1D1A';
  const textSec = isDark ? '#B3B3B3' : '#6B6762';
  const textMuted = isDark ? '#8C8C8C' : '#8F8B85';
  const trackBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';

  const computedMax = useMemo(() => {
    if (max && max > 0) return max;
    const m = Math.max(...rows.map((r) => Math.abs(Number(r.value) || 0)), 0.001);
    return m;
  }, [rows, max]);

  const colorFor = (v: number, anomaly?: boolean) => {
    const ratio = Math.min(1, Math.abs(v) / computedMax);
    if (anomaly || ratio >= 0.7) return { from: '#dc2626', to: '#991b1b', glow: 'rgba(220,38,38,0.35)' };
    if (ratio >= 0.4) return { from: '#ea580c', to: '#c2410c', glow: 'rgba(234,88,12,0.30)' };
    if (ratio >= 0.15) return { from: '#ca8a04', to: '#a16207', glow: 'rgba(202,138,4,0.30)' };
    return { from: '#16a34a', to: '#15803d', glow: 'rgba(22,163,74,0.25)' };
  };

  const wowSign = total?.wow ?? 0;
  const WowIcon = wowSign > 0.001 ? TrendingUp : wowSign < -0.001 ? TrendingDown : Minus;
  const wowColor = wowSign > 0.001 ? '#dc2626' : wowSign < -0.001 ? '#16a34a' : textMuted;

  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{
        background: surface,
        border: `1px solid ${border}`,
        boxShadow: isDark ? '0 6px 22px rgba(0,0,0,0.35)' : '0 3px 14px rgba(45,42,38,0.05)',
      }}
    >
      {/* Soft accent glow in the corner */}
      <div
        className="absolute -top-16 -right-16 h-40 w-40 rounded-full opacity-30 blur-2xl pointer-events-none"
        style={{ background: total && total.value > 0.05 ? '#dc2626' : '#6366f1' }}
        aria-hidden
      />

      {/* Header */}
      {(title || subtitle) && (
        <div className="relative px-5 pt-4 pb-2 flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="rounded-md p-1.5" style={{ background: 'rgba(99,102,241,0.15)', color: isDark ? '#a5b4fc' : '#4f46e5' }}>
              <Activity className="h-3.5 w-3.5" />
            </div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: textSec }}>
              {title}
            </div>
          </div>
          {subtitle && <div className="text-[11px]" style={{ color: textMuted }}>{subtitle}</div>}
        </div>
      )}

      {/* Total hero stat */}
      {total && (
        <div className="relative px-5 pb-3">
          <div className="flex items-baseline gap-2">
            <span className="text-[28px] font-bold leading-none tabular-nums" style={{ color: text }}>
              {total.value.toFixed(3)}
            </span>
            <span className="text-[11px] font-medium" style={{ color: textSec }}>{total.label}</span>
            {typeof total.wow === 'number' && (
              <span
                className="ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ background: wowColor + '22', color: wowColor }}
              >
                <WowIcon className="h-3 w-3" />
                {total.wow > 0 ? '+' : ''}{total.wow.toFixed(3)} WoW
              </span>
            )}
          </div>
        </div>
      )}

      {/* Bars */}
      <div className="relative px-5 pb-5 pt-2 space-y-2">
        {rows.length === 0 ? (
          <div className="text-[12px] italic" style={{ color: textMuted }}>No data.</div>
        ) : rows.map((r) => {
          const v = Number(r.value) || 0;
          const ratio = Math.min(1, Math.abs(v) / computedMax);
          const widthPct = Math.max(2, ratio * 100); // min visible width
          const c = colorFor(v, r.anomaly);
          return (
            <div key={r.label} className="group">
              <div className="flex items-center justify-between gap-3 mb-1">
                <div className="text-[11.5px] font-medium truncate" style={{ color: text }}>{r.label}</div>
                <div className="flex items-baseline gap-1.5 shrink-0">
                  <span className="text-[12px] font-semibold tabular-nums" style={{ color: c.from }}>
                    {v.toFixed(4)}
                  </span>
                  {r.anomaly && (
                    <span
                      className="text-[9px] font-bold px-1 rounded"
                      style={{ background: c.glow, color: c.from }}
                    >
                      ⚠
                    </span>
                  )}
                </div>
              </div>
              <div className="relative h-2 rounded-full overflow-hidden" style={{ background: trackBg }}>
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${widthPct}%`,
                    background: `linear-gradient(90deg, ${c.from}, ${c.to})`,
                    boxShadow: r.anomaly ? `0 0 8px ${c.glow}` : 'none',
                  }}
                />
                {/* Shimmer for anomaly rows */}
                {r.anomaly && (
                  <div
                    className="absolute inset-y-0 left-0 opacity-40 animate-pulse"
                    style={{ width: `${widthPct}%`, background: `linear-gradient(90deg, transparent, ${c.glow}, transparent)` }}
                    aria-hidden
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
