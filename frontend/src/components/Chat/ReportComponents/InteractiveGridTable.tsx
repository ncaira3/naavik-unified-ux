import { useMemo, useState, useCallback } from 'react';
import type { ColDef, RowClickedEvent } from 'ag-grid-community';
import AgGridWrapper from '../../AgGridWrapper';
import { useDummifier } from '../../../context/DummifierContext';

interface InteractiveGridTableProps {
  rows: Record<string, any>[];
  title?: string;
  showSelection?: boolean;
  rowTooltipField?: string;
  onRowAction?: (action: string, row: Record<string, any>) => void;
}

// ── Offenders AG Grid ──────────────────────────────────────────────────────
function OffendersView({ rows, onRowAction }: { rows: Record<string, any>[]; onRowAction?: (action: string, row: Record<string, any>) => void }) {
  const { dId } = useDummifier();
  const colDefs = useMemo<ColDef[]>(() => [
    {
      field: 'USID',
      headerName: 'Site',
      flex: 1,
      minWidth: 110,
      valueGetter: (p) => dId(p.data['USID'] ?? p.data['Site'] ?? ''),
      cellStyle: { fontWeight: 500 },
    },
    {
      field: 'Degraded KPI',
      headerName: 'Degraded KPI Category',
      flex: 1.2,
      minWidth: 160,
      valueGetter: (p) => p.data['Degraded KPI'] ?? p.data['Degraded KPI Category'] ?? '',
      cellRenderer: (p: any) => {
        const cat = String(p.value || '');
        return cat
          ? <span className="text-text-muted text-[12px]">{cat}</span>
          : <span className="text-text-muted">—</span>;
      },
    },
    {
      field: 'CQX Value',
      headerName: 'Super KPI Value',
      width: 130,
      valueGetter: (p) => p.data['CQX Value'] ?? p.data['Super KPI Value'] ?? 0,
      valueFormatter: (p) => typeof p.value === 'number' ? p.value.toFixed(2) : String(p.value ?? '—'),
    },
    {
      field: 'RCA Category',
      headerName: 'Root Cause Of Degradation',
      flex: 2,
      minWidth: 200,
      valueGetter: (p) => p.data['RCA Category'] ?? p.data['Root Cause Of Degradation'] ?? '',
      tooltipValueGetter: (p) => p.data['__shortSummaryTooltip'] ?? p.data['RCA Category'] ?? '',
    },
    ...(onRowAction ? [{
      headerName: 'Actions',
      field: '__explain',
      width: 130,
      sortable: false,
      filter: false,
      resizable: false,
      cellRenderer: (p: any) => (
        <button
          type="button"
          onClick={() => onRowAction('explain-rca', p.data)}
          className="rounded px-3 py-1 text-[12px] font-semibold transition-colors"
          style={{ background: '#2563eb', color: '#fff' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#1d4ed8'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#2563eb'; }}
        >
          Explain RCA
        </button>
      ),
    } as ColDef] : []),
  ], [onRowAction, dId]);

  const height = Math.min(44 * rows.length + 42 + 2, 400);

  return (
    <AgGridWrapper
      columnDefs={colDefs}
      rowData={rows}
      height={height}
      onRowClicked={onRowAction ? (e) => onRowAction('row-click', e.data) : undefined}
    />
  );
}

// ── Generic AG Grid fallback ───────────────────────────────────────────────
function GenericAgGrid({
  columns, filtered, rowTooltipField, onRowAction,
}: {
  columns: string[];
  filtered: Record<string, any>[];
  rowTooltipField?: string;
  onRowAction?: (action: string, row: Record<string, any>) => void;
}) {
  const { dId } = useDummifier();
  const colDefs = useMemo<ColDef[]>(() => {
    const isUsidKey = (k: string) => /usid|site[_ ]?id|^site$/i.test(k);
    const dataCols: ColDef[] = columns.map((key) => ({
      field: key,
      headerName: key,
      flex: 1,
      minWidth: 100,
      tooltipField: key === (rowTooltipField ?? '') ? key : undefined,
      valueFormatter: (p) => {
        const raw = p.value;
        if (raw === null || raw === undefined) return '-';
        return isUsidKey(key) ? dId(raw) : String(raw);
      },
    }));

    if (onRowAction) {
      dataCols.push({
        headerName: 'Actions',
        field: '__action',
        width: 110,
        sortable: false,
        filter: false,
        resizable: false,
        cellRenderer: (p: any) => (
          <button
            type="button"
            onClick={() => onRowAction('explain-rca', p.data)}
            className="rounded px-3 py-1 text-[12px] font-semibold transition-colors"
            style={{ background: '#2563eb', color: '#fff' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#1d4ed8'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#2563eb'; }}
          >
            Explain
          </button>
        ),
      });
    }
    return dataCols;
  }, [columns, rowTooltipField, onRowAction, dId]);

  const handleRowClick = useCallback((e: RowClickedEvent) => {
    if (onRowAction) onRowAction('row-click', e.data);
  }, [onRowAction]);

  return (
    <AgGridWrapper
      columnDefs={colDefs}
      rowData={filtered}
      height={Math.min(44 * filtered.length + 42 + 2, 400)}
      onRowClicked={onRowAction ? handleRowClick : undefined}
    />
  );
}

// ── Main export ─────────────────────────────────────────────────────────────
export default function InteractiveGridTable({
  rows,
  title = 'Results',
  showSelection: _showSelection = true,
  rowTooltipField,
  onRowAction,
}: InteractiveGridTableProps) {
  const [query, setQuery] = useState('');

  const safeRows = useMemo(() => rows.map((row) => row ?? {}), [rows]);

  const columns = useMemo(() => {
    if (!safeRows.length) return [] as string[];
    return Object.keys(safeRows[0]).filter((key) => !key.startsWith('__'));
  }, [safeRows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? safeRows.filter((row) => Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(q)))
      : safeRows;
  }, [safeRows, query]);

  const isOffendersLayout = (columns.includes('USID') && columns.includes('Degraded KPI')) ||
    (columns.includes('Site') && columns.includes('Degraded KPI Category'));

  return (
    <div className="mt-3 rounded-xl border border-border dark:border-white/10 bg-cream-surface dark:bg-[#1a1f2e] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border dark:border-white/10">
        <h3 className="text-[13px] font-semibold text-text-primary">{title}</h3>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter rows..."
          className="w-36 text-xs rounded border border-border dark:border-white/10 bg-cream-bg dark:bg-white/5 px-2.5 py-1.5 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-blue-500/60"
        />
      </div>

      {/* Content */}
      {isOffendersLayout ? (
        <OffendersView rows={filtered} onRowAction={onRowAction} />
      ) : (
        <GenericAgGrid
          columns={columns}
          filtered={filtered}
          rowTooltipField={rowTooltipField}
          onRowAction={onRowAction}
        />
      )}

      <p className="px-4 py-2 text-[11px] text-text-muted border-t border-white/10">{filtered.length} row{filtered.length !== 1 ? 's' : ''}</p>
    </div>
  );
}
