import { useMemo } from 'react';
import { Radio, Wifi, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

interface CellTile {
  cellName: string;
  tech?: string;     // 4G | 5G
  carrier?: string;
  band?: string;     // pre-derived band label, e.g. "4G PCS 1900"
  azimuth?: number | null;
  height?: number | null;
  anomaly?: boolean;
  anomalyScore?: number | null;
}

interface TopologyGridProps {
  title?: string;
  subtitle?: string;
  cells: CellTile[];
  /** Optional site-level metadata to show in a header strip. */
  meta?: { siteName?: string; siteType?: string; cluster?: string; city?: string; state?: string };
}

/**
 * Cells grouped by band — tile-grid view of a site's topology.
 * Each band gets a colored chip header + a flex-wrap of cell tiles.
 * Anomalous cells glow softly with a red ring.
 */
export default function TopologyGrid({ title, subtitle, cells, meta }: TopologyGridProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const surface = isDark ? 'rgba(28,28,30,0.85)' : 'rgba(255,255,255,0.92)';
  const border = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(45,42,38,0.10)';
  const text = isDark ? '#FBFBFB' : '#1F1D1A';
  const textSec = isDark ? '#B3B3B3' : '#6B6762';
  const textMuted = isDark ? '#8C8C8C' : '#8F8B85';
  const tileBg = isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.012)';

  const bandPalette: Record<string, { from: string; to: string; chip: string }> = {
    'low':       { from: '#0ea5e9', to: '#0369a1', chip: 'rgba(14,165,233,0.12)' },
    'mid':       { from: '#6366f1', to: '#4338ca', chip: 'rgba(99,102,241,0.12)' },
    'high':      { from: '#a855f7', to: '#7e22ce', chip: 'rgba(168,85,247,0.12)' },
    '5g':        { from: '#10b981', to: '#047857', chip: 'rgba(16,185,129,0.12)' },
    'unknown':   { from: '#6b7280', to: '#374151', chip: 'rgba(107,114,128,0.12)' },
  };

  const bandKey = (band?: string, tech?: string): keyof typeof bandPalette => {
    const b = (band || '').toLowerCase();
    const t = (tech || '').toUpperCase();
    if (b.includes('mmwave') || b.includes('high')) return 'high';
    if (t === '5G' || b.includes('5g') || b.includes('c-band') || b.includes('n7')) return '5g';
    if (b.includes('low') || b.includes('700') || b.includes('850')) return 'low';
    if (b.includes('mid') || b.includes('pcs') || b.includes('1900') || b.includes('aws') || b.includes('1700')) return 'mid';
    return 'unknown';
  };

  // Group cells by band
  const grouped = useMemo(() => {
    const groups: Record<string, CellTile[]> = {};
    for (const c of cells) {
      const key = c.band || `${c.tech} ${c.carrier || ''}`.trim();
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    }
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [cells]);

  const anomalousCount = cells.filter((c) => c.anomaly).length;

  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{
        background: surface,
        border: `1px solid ${border}`,
        boxShadow: isDark ? '0 6px 22px rgba(0,0,0,0.35)' : '0 3px 14px rgba(45,42,38,0.05)',
      }}
    >
      {/* Soft accent in corner */}
      <div
        className="absolute -bottom-16 -left-16 h-40 w-40 rounded-full opacity-25 blur-2xl pointer-events-none"
        style={{ background: anomalousCount > 0 ? '#dc2626' : '#10b981' }}
        aria-hidden
      />

      {/* Header */}
      <div className="relative px-5 pt-4 pb-3 flex items-start justify-between gap-3 border-b" style={{ borderColor: border }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <div className="rounded-md p-1.5" style={{ background: 'rgba(99,102,241,0.15)', color: isDark ? '#a5b4fc' : '#4f46e5' }}>
              <Radio className="h-3.5 w-3.5" />
            </div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: textSec }}>
              {title || 'Site Topology'}
            </div>
          </div>
          {meta?.siteName && (
            <div className="text-[14px] font-semibold leading-tight" style={{ color: text }}>
              {meta.siteName}
            </div>
          )}
          {(meta?.siteType || meta?.city || meta?.state || meta?.cluster) && (
            <div className="mt-0.5 text-[11px]" style={{ color: textMuted }}>
              {[meta.siteType, [meta.city, meta.state].filter(Boolean).join(', '), meta.cluster && `Cluster ${meta.cluster}`].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="text-[20px] font-bold tabular-nums leading-none" style={{ color: text }}>{cells.length}</div>
          <div className="text-[9px] font-bold uppercase tracking-[0.16em]" style={{ color: textMuted }}>cells</div>
          {anomalousCount > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold mt-0.5"
              style={{ background: 'rgba(220,38,38,0.15)', color: isDark ? '#fca5a5' : '#dc2626' }}
            >
              <AlertTriangle className="h-3 w-3" />
              {anomalousCount} anomalous
            </span>
          )}
        </div>
        {subtitle && (
          <div className="absolute right-5 bottom-2 text-[10px]" style={{ color: textMuted }}>{subtitle}</div>
        )}
      </div>

      {/* Bands */}
      <div className="relative p-4 space-y-4">
        {grouped.map(([bandLabel, group]) => {
          const palette = bandPalette[bandKey(bandLabel, group[0]?.tech)];
          return (
            <div key={bandLabel}>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.10em]"
                  style={{ background: palette.chip, color: palette.from }}
                >
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: `linear-gradient(135deg, ${palette.from}, ${palette.to})` }}
                  />
                  {bandLabel}
                </span>
                <span className="text-[10px] font-medium" style={{ color: textMuted }}>
                  {group.length} cell{group.length === 1 ? '' : 's'}
                </span>
                <span className="flex-1 h-px" style={{ background: border }} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {group.map((cell) => {
                  const anomalyTint = cell.anomaly
                    ? (isDark ? 'rgba(220,38,38,0.10)' : 'rgba(220,38,38,0.05)')
                    : tileBg;
                  const anomalyBorder = cell.anomaly
                    ? (isDark ? 'rgba(252,165,165,0.45)' : 'rgba(220,38,38,0.35)')
                    : border;
                  return (
                    <div
                      key={cell.cellName}
                      className="relative rounded-xl p-2.5 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md cursor-default"
                      style={{
                        background: anomalyTint,
                        border: `1px solid ${anomalyBorder}`,
                        boxShadow: cell.anomaly ? `0 0 0 1px ${anomalyBorder}` : 'none',
                      }}
                      title={cell.cellName}
                    >
                      {cell.anomaly && (
                        <div
                          className="absolute -top-1 -right-1 h-2 w-2 rounded-full animate-pulse"
                          style={{ background: '#dc2626', boxShadow: '0 0 6px rgba(220,38,38,0.6)' }}
                          aria-hidden
                        />
                      )}
                      <div className="flex items-center gap-1.5 mb-1">
                        <Wifi className="h-3 w-3" style={{ color: palette.from }} />
                        <span className="text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: palette.from }}>
                          {cell.tech || '—'}
                        </span>
                      </div>
                      <div className="font-mono text-[11px] font-semibold truncate" style={{ color: text }}>
                        {cell.cellName}
                      </div>
                      <div className="mt-1 text-[10px]" style={{ color: textMuted }}>
                        {cell.azimuth != null && <span className="tabular-nums">Az {Math.round(cell.azimuth)}°</span>}
                        {cell.azimuth != null && cell.height != null && <span> · </span>}
                        {cell.height != null && <span className="tabular-nums">{Math.round(cell.height)}m</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
