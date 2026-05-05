import { useMemo } from 'react';
import { useTheme } from '../../context/ThemeContext';

interface CompactTableProps {
  title?: string;
  subtitle?: string;
  rows: Array<Record<string, any>>;
  /** Optional explicit column order. If omitted, derived from the first row. */
  columnOrder?: string[];
  /**
   * Per-column hint. We auto-detect numeric/anomaly otherwise. Use this when
   * a column should be force-aligned or rendered in a specific way.
   */
  columnHints?: Record<string, 'numeric' | 'text' | 'anomaly' | 'mono'>;
  /**
   * Maximum visible rows. If the row count exceeds this, the table is scrollable.
   */
  maxHeight?: number;
}

/**
 * Lightweight, dense table — no AG-Grid, no row chrome, no Explain button.
 * Use for read-only telemetry where the user just wants to scan numbers.
 *
 * Visual rules applied automatically:
 *  - Columns whose values are mostly numeric → right-aligned, monospace
 *  - Cells starting with "⚠" → red tint
 *  - Cells = "OK" / "—" → muted
 *  - Cells matching a cell-name pattern (e.g. CVL07221_9A_1) → mono, blue accent
 */
export default function CompactTable({
  title,
  subtitle,
  rows,
  columnOrder,
  columnHints,
  maxHeight = 360,
}: CompactTableProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Determine column order
  const columns = useMemo<string[]>(() => {
    if (columnOrder && columnOrder.length) return columnOrder;
    if (!rows.length) return [];
    return Object.keys(rows[0]).filter((k) => !k.startsWith('__'));
  }, [columnOrder, rows]);

  // Auto-detect column types for alignment + styling
  const detectedTypes = useMemo<Record<string, 'numeric' | 'text' | 'anomaly' | 'mono'>>(() => {
    const out: Record<string, 'numeric' | 'text' | 'anomaly' | 'mono'> = {};
    if (!rows.length) return out;
    const sample = rows.slice(0, 25);
    for (const col of columns) {
      if (columnHints?.[col]) { out[col] = columnHints[col]; continue; }
      const vals = sample.map((r) => r[col]).filter((v) => v !== null && v !== undefined && v !== '');
      if (!vals.length) { out[col] = 'text'; continue; }
      // Numeric column: every non-empty value parses to a number.
      const numericRatio = vals.filter((v) => {
        const s = String(v).replace(/[%,°mskgbMHzdBmMbpsGB$\s]/gi, '').trim();
        return s !== '' && !isNaN(Number(s));
      }).length / vals.length;
      if (numericRatio >= 0.7) { out[col] = 'numeric'; continue; }
      // Anomaly-ish column: values like "OK", "⚠ 0.42", "BAD"
      const anomalyRatio = vals.filter((v) => {
        const s = String(v);
        return s.includes('⚠') || s === 'OK' || s === '—' || /^[A-Z]{2,5}$/.test(s);
      }).length / vals.length;
      if (anomalyRatio >= 0.6) { out[col] = 'anomaly'; continue; }
      // Cell-name pattern (CVL07221_9A_1)
      const cellRatio = vals.filter((v) => /^[A-Z]{3}\d{4,6}_[A-Z0-9_]+$/.test(String(v))).length / vals.length;
      if (cellRatio >= 0.5) { out[col] = 'mono'; continue; }
      out[col] = 'text';
    }
    return out;
  }, [columns, rows, columnHints]);

  // Theme tokens
  const surface = isDark ? 'rgba(38,38,38,0.7)' : 'rgba(255,255,255,0.85)';
  const border = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(45,42,38,0.10)';
  const text = isDark ? '#FBFBFB' : '#2D2A26';
  const textMuted = isDark ? '#8C8C8C' : '#8F8B85';
  const textSecondary = isDark ? '#B3B3B3' : '#6B6762';
  const headerBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.025)';
  const rowAltBg = isDark ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.01)';
  const accent = isDark ? '#a5b4fc' : '#4f46e5';
  const danger = isDark ? '#fca5a5' : '#dc2626';
  const dangerBg = isDark ? 'rgba(220,38,38,0.10)' : 'rgba(220,38,38,0.06)';

  const renderCell = (value: any, type: string) => {
    if (value === null || value === undefined || value === '') {
      return <span style={{ color: textMuted }}>—</span>;
    }
    const s = String(value);
    if (type === 'anomaly') {
      if (s.includes('⚠')) {
        return (
          <span
            className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold"
            style={{ background: dangerBg, color: danger }}
          >
            {s}
          </span>
        );
      }
      if (s === 'OK') {
        return <span style={{ color: textMuted, fontSize: 11 }}>OK</span>;
      }
      return <span style={{ color: textSecondary }}>{s}</span>;
    }
    if (type === 'mono') {
      return (
        <span className="font-mono text-[11px]" style={{ color: accent }}>
          {s}
        </span>
      );
    }
    if (type === 'numeric') {
      return (
        <span className="font-mono tabular-nums" style={{ color: text }}>
          {s}
        </span>
      );
    }
    return <span style={{ color: text }}>{s}</span>;
  };

  if (!rows.length) {
    return (
      <div
        className="rounded-lg border px-4 py-3 text-[12px] italic"
        style={{ borderColor: border, background: surface, color: textMuted }}
      >
        {title ? <div className="font-semibold not-italic mb-1" style={{ color: textSecondary }}>{title}</div> : null}
        No data.
      </div>
    );
  }

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: border, background: surface }}
    >
      {(title || subtitle) && (
        <div
          className="px-3 py-2 border-b flex items-baseline justify-between gap-2"
          style={{ borderColor: border, background: headerBg }}
        >
          {title && (
            <div className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: textSecondary }}>
              {title}
            </div>
          )}
          <div className="text-[10px]" style={{ color: textMuted }}>
            {rows.length} row{rows.length === 1 ? '' : 's'}
            {subtitle ? ` · ${subtitle}` : ''}
          </div>
        </div>
      )}

      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-10" style={{ background: headerBg }}>
            <tr>
              {columns.map((col) => {
                const t = detectedTypes[col] || 'text';
                const align = t === 'numeric' ? 'right' : 'left';
                return (
                  <th
                    key={col}
                    className="px-3 py-2 font-semibold text-[10px] uppercase tracking-[0.10em] whitespace-nowrap"
                    style={{ color: textMuted, textAlign: align, borderBottom: `1px solid ${border}` }}
                  >
                    {col}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                style={{ background: i % 2 === 0 ? 'transparent' : rowAltBg }}
              >
                {columns.map((col) => {
                  const t = detectedTypes[col] || 'text';
                  const align = t === 'numeric' ? 'right' : 'left';
                  return (
                    <td
                      key={col}
                      className="px-3 py-1.5 whitespace-nowrap"
                      style={{
                        textAlign: align,
                        borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${border}`,
                      }}
                      title={row[col] != null ? String(row[col]) : undefined}
                    >
                      {renderCell(row[col], t)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
