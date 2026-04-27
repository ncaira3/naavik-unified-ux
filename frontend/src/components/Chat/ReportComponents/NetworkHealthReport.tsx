/**
 * Network Health Report Component
 * Displays network health summary with statistics and problem sites
 */
import { useMemo, useState } from 'react';
import type { ColDef } from 'ag-grid-community';
import { ReportData } from '../../../types';
import InlineMap from '../../InlineMap';
import { MapSite } from '../../../types';
import AgGridWrapper from '../../AgGridWrapper';

interface NetworkHealthReportProps {
  data: ReportData;
}

export const NetworkHealthReport: React.FC<NetworkHealthReportProps> = ({ data }) => {
  if (!data || typeof data !== 'object') return null;

  const summary = data.summary && typeof data.summary === 'object' ? data.summary : {};
  const details = data.details && typeof data.details === 'object' ? data.details : {};
  const outages = Array.isArray(details.outages) ? details.outages : [];
  const congested = Array.isArray(details.congested) ? details.congested : [];
  const [mapFilter, setMapFilter] = useState<'all' | 'degraded' | 'normal'>('degraded');

  const mapSites = useMemo<MapSite[]>(() => {
    const degradedSiteIds = new Set<string>(
      [...outages, ...congested]
        .map((site: any) => String(site.siteId ?? site.SiteID ?? '').trim().toUpperCase())
        .filter(Boolean)
    );

    if (Array.isArray(details.mapSites) && details.mapSites.length > 0) {
      return (details.mapSites as any[]).map((site) => {
        const rawStatus = String(site.status ?? '').toUpperCase();
        const sourceSiteId = String(site.siteId ?? site.SiteID ?? '').trim().toUpperCase();
        const isDegradedFromSummary = degradedSiteIds.has(sourceSiteId);
        const anomalyCount = Number(site.anomalyCount ?? (isDegradedFromSummary ? 1 : 0));
        const normalizedStatus: MapSite['status'] =
          rawStatus === 'OUTAGE' || rawStatus === 'CRITICAL' || rawStatus === 'WARNING'
            ? (rawStatus as MapSite['status'])
            : anomalyCount > 0
              ? 'CRITICAL'
              : rawStatus === 'NORMAL'
                ? 'NORMAL'
                : 'NORMAL';
        const normalized = {
          siteId: site.siteId ?? site.SiteID ?? '-',
          siteName: site.siteName ?? site.SiteName ?? '-',
          latitude: Number(site.latitude ?? site.Latitude ?? 0),
          longitude: Number(site.longitude ?? site.Longitude ?? 0),
          cellCount: Number(site.cellCount ?? 0),
          status: normalizedStatus,
          anomalyCount,
          hasActiveTickets: Boolean(site.hasActiveTickets ?? anomalyCount > 0),
        } as MapSite;
        return normalized as MapSite;
      });
    }
    const merged = [...outages, ...congested].map((site: any) => ({
      siteId: site.siteId ?? site.SiteID ?? '-',
      siteName: site.siteName ?? site.SiteName ?? '-',
      latitude: Number(site.latitude ?? site.Latitude ?? 0),
      longitude: Number(site.longitude ?? site.Longitude ?? 0),
      cellCount: 0,
      status: (site.status ?? 'WARNING') as MapSite['status'],
      anomalyCount: 1,
      hasActiveTickets: true,
    }));
    return merged.filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude) && s.latitude !== 0 && s.longitude !== 0);
  }, [details.mapSites, outages, congested]);

  const filteredMapSites = useMemo(() => {
    if (mapFilter === 'all') return mapSites;
    if (mapFilter === 'degraded') return mapSites.filter((s) => s.status !== 'NORMAL' || Number(s.anomalyCount) > 0);
    return mapSites.filter((s) => s.status === 'NORMAL' && Number(s.anomalyCount) === 0);
  }, [mapSites, mapFilter]);

  const tableRows = Array.isArray(details.tableRows)
    ? details.tableRows
    : [...outages, ...congested].slice(0, 25).map((s: any) => ({
        siteId: s.siteId ?? s.SiteID ?? '-',
        date: s.dateId ?? '-',
        estCqxImpactDelta: s.anomalyScore != null ? Number(s.anomalyScore).toFixed(4) : '-',
        possibleRca: s.status === 'OUTAGE' ? 'Outage/Transport' : 'Congestion',
        action: s.status === 'OUTAGE' ? 'Outage Resolution' : 'Change Parameter',
      }));
  const hasInsights = Number(summary.outageSites ?? 0) > 0 || Number(summary.congestedSites ?? 0) > 0;
  const hasTableRows = tableRows.length > 0;
  const hasMapSites = filteredMapSites.length > 0;

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-border dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 p-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-cream-surface-light dark:bg-gray-800 rounded-lg p-4">
          <div className="mb-2">
            <h3 className="text-sm font-medium text-text-primary dark:text-white">Total Sites</h3>
          </div>
          <p className="text-3xl font-bold text-text-primary dark:text-white">
            {summary.totalSites ?? 0}
          </p>
        </div>
        <div className="bg-red-100 dark:bg-red-900/30 rounded-lg p-4">
          <div className="mb-2">
            <h3 className="text-sm font-medium text-red-900 dark:text-red-200">Outages</h3>
          </div>
          <p className="text-3xl font-bold text-red-900 dark:text-red-200">
            {summary.outageSites ?? 0}
          </p>
        </div>
        <div className="bg-amber-100 dark:bg-amber-900/30 rounded-lg p-4">
          <div className="mb-2">
            <h3 className="text-sm font-medium text-amber-900 dark:text-amber-200">Congested</h3>
          </div>
          <p className="text-3xl font-bold text-amber-900 dark:text-amber-200">
            {summary.congestedSites ?? 0}
          </p>
        </div>
      </div>

      {/* Inset mini dashboard */}
      <div className="rounded-lg border border-border dark:border-gray-700 bg-white/80 dark:bg-gray-800/40 p-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-text-primary dark:text-white">Map View</h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMapFilter('all')}
                className={mapFilter === 'all' ? 'naavik-btn-info' : 'naavik-btn-secondary'}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setMapFilter('degraded')}
                className={mapFilter === 'degraded' ? 'naavik-btn-danger' : 'naavik-btn-secondary'}
              >
                Degraded
              </button>
              <button
                type="button"
                onClick={() => setMapFilter('normal')}
                className={mapFilter === 'normal' ? 'naavik-btn-success' : 'naavik-btn-secondary'}
              >
                Normal
              </button>
            </div>
          </div>
          {hasMapSites ? (
            <InlineMap sites={filteredMapSites} height={310} interactive />
          ) : (
            <div className="h-[310px] rounded-lg border border-dashed border-border dark:border-gray-600 flex items-center justify-center text-sm text-text-muted dark:text-gray-400">
              No map sites available for this date.
            </div>
          )}
          <p className="mt-2 text-xs text-text-secondary dark:text-gray-400">
            Interactive inset map{summary.reportDate ? ` for ${summary.reportDate}` : ''}. Use Open Observe for full map workflows.
          </p>
      </div>

      {hasInsights && (
        <div className="rounded-lg border border-border dark:border-gray-700 bg-white/80 dark:bg-gray-800/40 p-3">
          <h3 className="text-sm font-medium text-text-primary dark:text-white mb-2">Agent Insights</h3>
          <p className="text-sm text-text-secondary dark:text-gray-300 mb-3">
            {String(summary.topIssue || 'Reasoning agent assembled this report from current outage and congestion signals.')}
          </p>
          <div className="text-xs text-text-secondary dark:text-gray-400 space-y-1">
            <p>Outages: {summary.outageSites ?? 0}</p>
            <p>Congested: {summary.congestedSites ?? 0}</p>
            <p>Affected Cells: {summary.affectedCells ?? 0}</p>
          </div>
        </div>
      )}

      {/* Problem Sites Table */}
      {hasTableRows && (() => {
        const safeRows = tableRows.map((rawRow: any) => ({
          Site: String(rawRow?.siteId ?? '-'),
          Date: String(rawRow?.date ?? '-'),
          'KPI Impact Δ': String(rawRow?.estSuperKpiImpactDelta ?? rawRow?.estCqxImpactDelta ?? '-'),
          'Possible RCA': String(rawRow?.possibleRca ?? '-'),
          Action: String(rawRow?.action ?? '-'),
        }));
        const colDefs: ColDef[] = [
          { field: 'Site', flex: 1, minWidth: 100 },
          { field: 'Date', width: 110 },
          { field: 'KPI Impact Δ', width: 130 },
          { field: 'Possible RCA', flex: 2, minWidth: 160 },
          { field: 'Action', flex: 1, minWidth: 120 },
        ];
        return (
          <div className="rounded-[14px] overflow-hidden border border-gray-700/50">
            <div className="px-4 py-2.5 border-b border-gray-700/50 bg-white/[0.03] flex items-center justify-between">
              <span className="text-[12px] font-semibold text-text-primary">Site Analysis</span>
              <span className="text-[11px] text-text-muted">{safeRows.length} sites</span>
            </div>
            <AgGridWrapper
              columnDefs={colDefs}
              rowData={safeRows}
              height={Math.min(38 * safeRows.length + 36 + 2, 400)}
            />
          </div>
        );
      })()}
    </div>
  );
};
