import { useMemo, useCallback, useState, useEffect } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import { themeQuartz } from 'ag-grid-community';
import type { MapSite } from './MapView';
import api from '../services/api';
import { useTheme } from '../context/ThemeContext';

interface OfferersTableProps {
  offenderSiteIds: Set<string>;
  sites: MapSite[];
  selectedSite: MapSite | null;
  onSelectSite: (site: MapSite | null) => void;
  selectedDateId?: string | null;
}

interface CompassSiteRow {
  USID: string;
  DATE_ID: string;
  site_name?: string;
  ZONE_ENGINEER?: string;
  Degraded_KPI_Category?: string;
  CQX_Impact_Delta?: number;
  Possible_RCA?: string;
  User_Feedback?: string;
}

export default function OfferersTable({
  offenderSiteIds,
  sites,
  selectedSite,
  onSelectSite,
  selectedDateId,
}: OfferersTableProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [compassData, setCompassData] = useState<CompassSiteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const currentPage = 1;
  const [totalPages, setTotalPages] = useState(1);
  const pageSize = 10000; // Fetch all sites

  // Fetch compass data when selectedDateId changes
  useEffect(() => {
    if (!selectedDateId) {
      setCompassData([]);
      return;
    }

    const fetchCompassData = async () => {
      try {
        setLoading(true);
        const result = await api.getCompassSiteTable({
          date: selectedDateId,
          page: currentPage,
          page_size: pageSize,
        });
        setCompassData(result.data as CompassSiteRow[]);
        setTotalPages(result.total_pages);
      } catch (error) {
        console.error('Failed to fetch compass data:', error);
        setCompassData([]);
      } finally {
        setLoading(false);
      }
    };

    fetchCompassData();
  }, [selectedDateId]);

  const offenderSites = useMemo(() => {
    // If compass data is available, use it; otherwise fall back to local site data
    if (compassData.length > 0) {
      return compassData;
    }
    // Fallback: match sites against offenderSiteIds and map to CompassSiteRow shape
    return sites
      .filter((site) => {
        const ids = [site.siteId, site.realSiteId].filter(Boolean).map((s) => String(s).toUpperCase());
        for (const id of offenderSiteIds) {
          if (ids.includes(String(id).toUpperCase())) return true;
        }
        return false;
      })
      .map((site) => ({
        USID: site.realSiteId || site.siteId,
        DATE_ID: selectedDateId || '',
        site_name: site.siteName,
        ZONE_ENGINEER: undefined,
        Degraded_KPI_Category: undefined,
        CQX_Impact_Delta: undefined,
        Possible_RCA: undefined,
        User_Feedback: undefined,
      } as CompassSiteRow));
  }, [compassData, sites, offenderSiteIds, selectedDateId]);

  const columnDefs: ColDef[] = useMemo(
    () => [
      {
        field: 'USID',
        headerName: 'Site ID',
        flex: 1,
        minWidth: 120,
        filter: 'agTextColumnFilter',
        sort: 'asc',
      },
      {
        field: 'site_name',
        headerName: 'Site Name',
        flex: 1.5,
        minWidth: 150,
        filter: 'agTextColumnFilter',
      },
      {
        field: 'ZONE_ENGINEER',
        headerName: 'Zone Engineer',
        flex: 1,
        minWidth: 130,
        filter: 'agTextColumnFilter',
      },
      {
        field: 'CQX_Impact_Delta',
        headerName: 'CQX Impact',
        flex: 0.9,
        minWidth: 100,
        valueFormatter: (params) => {
          const val = params.value;
          return typeof val === 'number' ? val.toFixed(2) : val;
        },
        sort: 'desc',
      },
      {
        field: 'Degraded_KPI_Category',
        headerName: 'Degraded KPI',
        flex: 1,
        minWidth: 130,
        filter: 'agTextColumnFilter',
      },
      {
        field: 'Possible_RCA',
        headerName: 'Possible RCA',
        flex: 1.5,
        minWidth: 150,
        filter: 'agTextColumnFilter',
        tooltipField: 'Possible_RCA',
      },
      {
        field: 'User_Feedback',
        headerName: 'Feedback',
        flex: 1,
        minWidth: 120,
        filter: 'agTextColumnFilter',
        editable: true,
      },
    ],
    []
  );

  const defaultColDef: ColDef = useMemo(
    () => ({
      sortable: true,
      resizable: true,
      filterParams: {
        debounceMs: 200,
      },
    }),
    []
  );

  const handleRowClick = useCallback(
    (event: any) => {
      const row = event.data;
      const usid = String(row.USID || row.siteId || '');
      // Try to find the actual MapSite for real coordinates
      const existing = sites.find(
        (s) =>
          String(s.realSiteId || '').toLowerCase() === usid.toLowerCase() ||
          String(s.siteId || '').toLowerCase() === usid.toLowerCase()
      );
      const mapSite: MapSite = existing ?? {
        siteId: usid,
        realSiteId: usid,
        siteName: row.site_name || row.siteName || usid,
        latitude: 0,
        longitude: 0,
        cellCount: 0,
        status: 'CRITICAL',
        anomalyCount: 0,
        hasActiveTickets: false,
      };
      onSelectSite(mapSite);
    },
    [onSelectSite, sites]
  );

  const rowStyle = useCallback(
    (params: any) => {
      if (selectedSite && params.data.USID === selectedSite.siteId) {
        return { backgroundColor: '#fee2e2', borderLeft: '4px solid #dc2626' };
      }
      return {};
    },
    [selectedSite]
  );

  const handleSaveFeedback = useCallback(
    async (event: any) => {
      if (event.column.colId !== 'User_Feedback') return;
      const row = event.data as CompassSiteRow;
      try {
        await api.postCompassUserFeedback(row.USID, row.DATE_ID, event.value || '');
      } catch (error) {
        console.error('Failed to save feedback:', error);
      }
    },
    []
  );

  const bg        = isDark ? '#111113'  : '#FFFFFF';
  const bgSubtle  = isDark ? '#0d0d0f'  : '#F8FAFC';
  const bgOddRow  = isDark ? 'rgba(255,255,255,0.025)' : 'rgba(15,23,42,0.025)';
  const textPri   = isDark ? '#e2e8f0'  : '#0F172A';
  const textMuted = isDark ? '#64748b'  : '#475569';
  const border    = isDark ? 'rgba(255,255,255,0.07)' : '#E2E8F0';
  const rowHover  = isDark ? 'rgba(99,102,241,0.08)'  : 'rgba(99,102,241,0.06)';
  const rowSel    = isDark ? 'rgba(99,102,241,0.15)'  : 'rgba(99,102,241,0.10)';

  return (
    <div className="w-full h-full flex flex-col" style={{ background: bg }}>
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b" style={{ borderColor: border }}>
        <h2 className="text-[15px] font-semibold" style={{ color: textPri }}>
          Offenders — {selectedDateId || 'Selected Date'}
        </h2>
        <p className="text-[12px] mt-0.5" style={{ color: textMuted }}>
          {loading ? 'Loading…' : `${offenderSites.length} sites · ${totalPages > 1 ? `page 1 of ${totalPages}` : 'all'}`}
        </p>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 w-full overflow-hidden">
        <AgGridReact<any>
          theme={themeQuartz.withParams({
            backgroundColor: bg,
            oddRowBackgroundColor: bgOddRow,
            headerBackgroundColor: bgSubtle,
            headerTextColor: textMuted,
            foregroundColor: textPri,
            borderColor: border,
            rowHoverColor: rowHover,
            selectedRowBackgroundColor: rowSel,
            fontSize: 12,
            fontFamily: 'Inter, system-ui, sans-serif',
            cellHorizontalPaddingScale: 1.1,
            rowHeight: 40,
            headerHeight: 38,
            wrapperBorder: false,
          })}
          columnDefs={columnDefs}
          rowData={offenderSites}
          defaultColDef={defaultColDef}
          rowSelection="single"
          onRowClicked={handleRowClick}
          onCellValueChanged={handleSaveFeedback}
          rowStyle={rowStyle as any}
          loading={loading}
          animateRows
        />
      </div>

      {offenderSites.length > 0 && (
        <div className="flex-shrink-0 px-6 py-2 border-t text-[11px]" style={{ borderColor: border, color: textMuted }}>
          {offenderSites.length} offender sites
        </div>
      )}
    </div>
  );
}
