/**
 * AgGridWrapper — shared AG Grid component with Naavik dark/light theme.
 *
 * Theme auto-detects from ThemeContext. Pass an explicit `theme` only to
 * force one mode regardless of app theme (useful inside dark-mode-only
 * panels like the legacy Observe site analysis tile).
 *
 * Usage:
 *   <AgGridWrapper columnDefs={cols} rowData={rows} height={320} />
 *   <AgGridWrapper ... theme="dark" />   // force, ignore app theme
 *
 * Thin wrapper — all extra AG Grid props pass through via `gridProps`.
 */
import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridOptions, RowClickedEvent } from 'ag-grid-community';
import { themeQuartz } from 'ag-grid-community';
import { useTheme } from '../context/ThemeContext';

interface AgGridWrapperProps {
  columnDefs: ColDef[];
  rowData: Record<string, any>[];
  height?: number | string;
  /** Optional override; if omitted, uses the active app theme. */
  theme?: 'dark' | 'light';
  onRowClicked?: (e: RowClickedEvent) => void;
  gridProps?: Partial<GridOptions>;
  className?: string;
}

/** Shared column defaults */
const BASE_DEFAULT_COL: ColDef = {
  sortable: true,
  filter: true,
  resizable: true,
  minWidth: 80,
  cellStyle: { display: 'flex', alignItems: 'center' },
};

const darkTheme = themeQuartz.withParams({
  backgroundColor: '#0F0F0F',
  oddRowBackgroundColor: 'rgba(255,255,255,0.025)',
  headerBackgroundColor: '#0A0A0A',
  headerTextColor: '#B3B3B3',
  foregroundColor: '#FBFBFB',
  borderColor: 'rgba(255,255,255,0.10)',
  rowHoverColor: 'rgba(167,139,250,0.10)',
  selectedRowBackgroundColor: 'rgba(167,139,250,0.18)',
  fontSize: 12,
  fontFamily: 'Inter, system-ui, sans-serif',
  cellHorizontalPaddingScale: 1,
  rowHeight: 38,
  headerHeight: 36,
  wrapperBorderRadius: 12,
  wrapperBorder: false,
});

/** Light theme tuned to match the creamy glassmorphism page (#FAF8F5). */
const lightTheme = themeQuartz.withParams({
  backgroundColor: '#FFFDFA',                       // surface-1 (card)
  oddRowBackgroundColor: 'rgba(45,42,38,0.025)',    // subtle warm wash
  headerBackgroundColor: '#F5F1ED',                 // surface-2 (raised)
  headerTextColor: '#6B6762',                       // text-muted
  foregroundColor: '#2D2A26',                       // text-primary
  borderColor: 'rgba(45,42,38,0.10)',               // glass-border
  rowHoverColor: 'rgba(139,92,246,0.07)',           // chart-1 wash
  selectedRowBackgroundColor: 'rgba(139,92,246,0.12)',
  fontSize: 12,
  fontFamily: 'Inter, system-ui, sans-serif',
  cellHorizontalPaddingScale: 1,
  rowHeight: 38,
  headerHeight: 36,
  wrapperBorderRadius: 12,
  wrapperBorder: false,
});

export default function AgGridWrapper({
  columnDefs,
  rowData,
  height = 360,
  theme,
  onRowClicked,
  gridProps = {},
  className,
}: AgGridWrapperProps) {
  const defaultColDef = useMemo<ColDef>(() => BASE_DEFAULT_COL, []);
  const { theme: appTheme } = useTheme();
  const effectiveTheme = theme ?? appTheme;

  return (
    <div
      className={`w-full rounded-[12px] overflow-hidden ${className ?? ''}`}
      style={{ height: typeof height === 'number' ? `${height}px` : height }}
    >
      <AgGridReact
        theme={effectiveTheme === 'dark' ? darkTheme : lightTheme}
        columnDefs={columnDefs}
        rowData={rowData}
        defaultColDef={defaultColDef}
        onRowClicked={onRowClicked}
        animateRows
        suppressMovableColumns={false}
        suppressCellFocus={false}
        rowSelection="single"
        {...gridProps}
      />
    </div>
  );
}
