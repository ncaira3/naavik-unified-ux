import { useState, useEffect, useMemo, useRef } from 'react';
import { Map as MapIcon, Grid3x3, Search, X, Menu } from 'lucide-react';
import MapView, { type MapSite } from './MapView';
import { useMapData } from '../context/MapDataContext';
import { useDummifier } from '../context/DummifierContext';
import { usePlatformBus } from '../platform/PlatformBusContext';
import SiteKpiTrends from './SiteKpiTrends';
import TelemetryDashboard from './TelemetryDashboard';
import OfferersTable from './OfferersTable';
import api from '../services/api';
import RCAReasoningPanel, { type RCAMapSignals } from './RCAReasoningPanel';
import type { ProvisioningCandidateSite } from '../types';
import ObserveSiteAnalysisTile from './ObserveSiteAnalysisTile';
import MapChatBar from './MapChatBar';

const PANEL_EXIT_MS = 280;

function normalizeSiteToken(value?: string | null): string {
  const s = String(value || '').trim();
  if (!s) return '';
  const upper = s.toUpperCase();
  const siteMatch = upper.match(/^SITE[_-][A-Z]\d{4}$/);
  if (siteMatch) return upper;
  const ustMatch = upper.match(/^UST0*(\d{4,8})$/);
  if (ustMatch) return ustMatch[1];
  if (/^\d{4,8}$/.test(upper)) return String(parseInt(upper, 10));
  return upper;
}

function isOffenderSite(site: MapSite, offenderSiteIds: Set<string>): boolean {
  const tokens = new Set<string>();
  const rawSiteId = String(site.siteId || '');
  const rawRealSiteId = String(site.realSiteId || '');
  tokens.add(rawSiteId);
  if (rawRealSiteId) tokens.add(rawRealSiteId);
  const n1 = normalizeSiteToken(rawSiteId);
  const n2 = normalizeSiteToken(rawRealSiteId);
  if (n1) tokens.add(n1);
  if (n2) tokens.add(n2);

  for (const id of offenderSiteIds) {
    const raw = String(id || '');
    const normalized = normalizeSiteToken(raw);
    if (tokens.has(raw) || (normalized && tokens.has(normalized))) return true;
  }
  return false;
}

export default function ObserveView() {
  const [selectedSite, setSelectedSite] = useState<MapSite | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [rcaMapSignals, setRcaMapSignals] = useState<RCAMapSignals | null>(null);
  const [mainView, setMainView] = useState<'network' | 'insights'>('network');
  const [insightsTab, setInsightsTab] = useState<string>('market');
  const [displayMode, setDisplayMode] = useState<'map' | 'table'>('map');
  const [isMapMenuOpen, setIsMapMenuOpen] = useState(false);
  const [analysisPanelMode, setAnalysisPanelMode] = useState<'overlay' | 'split' | 'full'>('overlay');
  const { offenderSiteIds, selectedDateId, dataDateId, sites, focusSiteToken, setFocusSiteToken } = useMapData();
  const { dId } = useDummifier();
  const { publish, subscribe } = usePlatformBus();
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [searchHighlightIdx, setSearchHighlightIdx] = useState(0);
  const [searchFocusSite, setSearchFocusSite] = useState<MapSite | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [provisioningLayerEnabled, setProvisioningLayerEnabled] = useState(false);
  const [provisioningFocusSiteId, setProvisioningFocusSiteId] = useState<string | null>(null);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return sites
      .filter(
        (s) =>
          s.siteId.toLowerCase().includes(q) ||
          s.siteName.toLowerCase().includes(q) ||
          (s.realSiteId || '').toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [searchQuery, sites]);

  const handleSearchFocus = (site: MapSite) => {
    setSearchFocusSite(site);
    setSearchQuery('');
    setShowSearchDropdown(false);
    setSearchHighlightIdx(0);
  };

  // Focus map when chat / UI commands request it (e.g. "Take me to site 9817").
  useEffect(() => {
    if (!focusSiteToken) return;
    const token = normalizeSiteToken(focusSiteToken);
    if (!token) {
      setFocusSiteToken(null);
      return;
    }
    const match = sites.find((s) => {
      const siteToken = normalizeSiteToken(s.realSiteId || s.siteId);
      return siteToken === token || String(s.siteId).toUpperCase() === token.toUpperCase();
    });
    if (match) setSearchFocusSite(match);
    setFocusSiteToken(null);
  }, [focusSiteToken, sites, setFocusSiteToken]);

  const closeSearch = () => {
    setIsSearchExpanded(false);
    setSearchQuery('');
    setShowSearchDropdown(false);
    setSearchHighlightIdx(0);
  };

  const handleSiteSelect = (site: MapSite | null) => {
    if (site) {
      setIsClosing(false);
      setRcaMapSignals(null);
      setAnalysisPanelMode('overlay');
      setSelectedSite(site);
    } else {
      setIsClosing(true);
      setRcaMapSignals(null);
    }
  };

  const handleProvisioningSiteSelected = (site: ProvisioningCandidateSite) => {
    // Publish platform bus events
    publish({
      type: 'PROVISION_SITES_SELECTED',
      payload: { sites: [site] },
    });
    publish({
      type: 'NAVIGATE_TO_APP',
      payload: { appId: 'provision' },
    });
  };

  useEffect(() => {
    if (!isClosing) return;
    const t = setTimeout(() => {
      setSelectedSite(null);
      setIsClosing(false);
    }, PANEL_EXIT_MS);
    return () => clearTimeout(t);
  }, [isClosing]);

  // Subscribe to platform bus events for provisioning layer
  useEffect(() => {
    const unsubscribeLayer = subscribe('MAP_PROVISIONING_LAYER_ENABLED', () => {
      setProvisioningLayerEnabled(true);
    });

    const unsubscribeFocus = subscribe('MAP_FOCUS_SITE', (payload: { siteId: string }) => {
      setProvisioningFocusSiteId(payload.siteId);
    });

    const unsubscribeConsumed = subscribe('MAP_PROVISIONING_FOCUS_CONSUMED', () => {
      setProvisioningFocusSiteId(null);
    });

    return () => {
      unsubscribeLayer();
      unsubscribeFocus();
      unsubscribeConsumed();
    };
  }, [subscribe]);

  return (
    <div className="flex-1 min-h-0 relative">
      {/* Top-Left Toolbar: Hamburger | Map/Table Toggle | Search */}
      <div className="absolute top-4 left-4 z-40 flex items-center gap-3 rounded-xl border border-slate-200/80 bg-white/88 p-2 backdrop-blur-md shadow-[0_12px_28px_rgba(15,23,42,0.10)] dark:border-white/10 dark:bg-black/55 dark:shadow-lg">
        {/* Hamburger Menu - Opens Map Settings */}
        <button
          onClick={() => setIsMapMenuOpen(!isMapMenuOpen)}
          className="p-2 rounded-md bg-cream-bg dark:bg-white/10 border border-border dark:border-white/10 hover:bg-white dark:hover:bg-white/15 transition-all flex-shrink-0"
          title="Map Settings"
          aria-label="Map Settings"
        >
          <Menu className="w-4 h-4 text-text-secondary dark:text-gray-300" />
        </button>

        {/* Map/Table Toggle */}
        <div className="flex items-center rounded-md border border-border bg-cream-bg p-1 gap-0 dark:border-white/10 dark:bg-white/10">
          <button
            onClick={() => setDisplayMode('map')}
            className={`p-1.5 rounded transition-all ${
              displayMode === 'map'
                ? 'bg-ui-btn text-ui-btn-fg'
                : 'text-text-secondary dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
            title="Map View"
            aria-label="Switch to map view"
          >
            <MapIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => setDisplayMode('table')}
            className={`p-1.5 rounded transition-all ${
              displayMode === 'table'
                ? 'bg-ui-btn text-ui-btn-fg'
                : 'text-text-secondary dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
            title="Table View"
            aria-label="Switch to table view"
          >
            <Grid3x3 className="w-4 h-4" />
          </button>
        </div>

        {/* Search Icon - with gap from table toggle */}
        <div className="ml-2 relative flex items-center rounded-md overflow-visible border border-border dark:border-white/10 bg-cream-bg dark:bg-white/10">
          {isSearchExpanded ? (
            <div className="flex items-center gap-2 px-2 py-1 min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-text-secondary dark:text-gray-400 flex-shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSearchDropdown(true);
                  setSearchHighlightIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSearchHighlightIdx((i) => Math.min(i + 1, searchResults.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSearchHighlightIdx((i) => Math.max(i - 1, 0));
                  } else if (e.key === 'Enter') {
                    const target = searchResults[searchHighlightIdx];
                    if (target) handleSearchFocus(target);
                  } else if (e.key === 'Escape') {
                    closeSearch();
                  }
                }}
                onFocus={() => { if (searchQuery.trim()) setShowSearchDropdown(true); }}
                onBlur={() => setTimeout(() => setShowSearchDropdown(false), 150)}
                placeholder="Search site..."
                className="flex-1 min-w-0 bg-transparent text-xs text-text-primary dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none"
                autoFocus
              />
              <button
                onClick={closeSearch}
                className="p-0.5 rounded hover:bg-white/50 dark:hover:bg-white/10 text-text-muted dark:text-gray-400"
                aria-label="Close search"
              >
                <X className="w-3.5 h-3.5" />
              </button>

              {/* Search results dropdown */}
              {showSearchDropdown && searchResults.length > 0 && (
                <div className="absolute top-full left-0 mt-1 w-full min-w-[260px] rounded-lg border border-border dark:border-white/10 bg-cream-surface dark:bg-[#1c1c2e] shadow-xl z-50 overflow-hidden">
                  <div className="px-3 py-1.5 border-b border-border dark:border-white/5">
                    <span className="text-[10px] font-semibold tracking-wider text-text-muted dark:text-white/30 uppercase">
                      {searchResults.length} site{searchResults.length !== 1 ? 's' : ''} found
                    </span>
                  </div>
                  <ul className="max-h-56 overflow-y-auto py-1" role="listbox">
                    {searchResults.map((s, idx) => (
                      <li
                        key={s.siteId}
                        role="option"
                        aria-selected={idx === searchHighlightIdx}
                        onMouseEnter={() => setSearchHighlightIdx(idx)}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSearchFocus(s);
                        }}
                        className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-xs transition-colors ${
                          idx === searchHighlightIdx
                            ? 'bg-tenant-primary/10 dark:bg-white/8 text-tenant-primary dark:text-white'
                            : 'text-text-secondary dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/5'
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            s.status === 'CRITICAL' ? 'bg-red-500' :
                            s.status === 'WARNING'  ? 'bg-amber-400' :
                            s.status === 'OUTAGE'   ? 'bg-red-700' :
                            'bg-emerald-500'
                          }`}
                        />
                        <span className="font-medium truncate">{dId(s.siteId)}</span>
                        {s.siteName && s.siteName !== s.siteId && (
                          <span className="text-text-muted dark:text-white/35 truncate">{s.siteName}</span>
                        )}
                        {s.realSiteId && s.realSiteId !== s.siteId && (
                          <span className="ml-auto text-[10px] text-text-muted dark:text-white/25 flex-shrink-0">{dId(s.realSiteId)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* No results message */}
              {showSearchDropdown && searchQuery.trim() && searchResults.length === 0 && (
                <div className="absolute top-full left-0 mt-1 w-full min-w-[220px] rounded-lg border border-border dark:border-white/10 bg-cream-surface dark:bg-[#1c1c2e] shadow-xl z-50 px-3 py-3 text-xs text-text-muted dark:text-white/35">
                  No sites match &ldquo;{searchQuery}&rdquo;
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setIsSearchExpanded(true)}
              className="p-2 text-text-secondary dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors flex-shrink-0"
              title="Search sites"
            >
              <Search className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Navigation Buttons - Centered */}
      <div className="absolute top-4 left-1/2 z-40 -translate-x-1/2 flex gap-1 rounded-full border border-slate-200/85 bg-white/90 p-1 shadow-[0_14px_32px_rgba(15,23,42,0.12)] backdrop-blur-md dark:border-white/12 dark:bg-black/60 dark:shadow-lg">
        <button
          onClick={() => setMainView('network')}
          className={`px-5 py-2 rounded-full text-xs font-semibold tracking-[0.08em] uppercase transition-colors ${
            mainView === 'network'
              ? 'bg-slate-900 text-white dark:bg-white/20 dark:text-white'
              : 'text-text-muted hover:text-slate-900 dark:text-white/45 dark:hover:text-white/75'
          }`}
        >
          Network Management
        </button>
        <button
          onClick={() => setMainView('insights')}
          className={`px-5 py-2 rounded-full text-xs font-semibold tracking-[0.08em] uppercase transition-colors ${
            mainView === 'insights'
              ? 'bg-slate-900 text-white dark:bg-white/20 dark:text-white'
              : 'text-text-muted hover:text-slate-900 dark:text-white/45 dark:hover:text-white/75'
          }`}
        >
          Insights
        </button>
      </div>

      {/* Network Management - Performance Management (Map or Table) */}
      {mainView === 'network' && (
        <div className="absolute inset-0 flex flex-col min-h-0">

          {/* Map View */}
          {displayMode === 'map' && (
            <div className="flex-1 min-h-0 flex flex-col relative">
              <MapView
                selectedSite={selectedSite}
                onSelectSite={handleSiteSelect}
                hideSitePanel
                isVisible={true}
                rightPanelWidthRatio={selectedSite && analysisPanelMode !== 'full' ? 0.5 : undefined}
                rcaMapSignals={rcaMapSignals}
                provisioningLayerEnabled={provisioningLayerEnabled}
                provisioningFocusSiteId={provisioningFocusSiteId}
                onProvisioningFocusConsumed={() => {
                  publish({ type: 'MAP_PROVISIONING_FOCUS_CONSUMED' });
                }}
                onProvisioningSiteSelected={handleProvisioningSiteSelected}
                hideTopControls={true}
                isMapMenuOpen={isMapMenuOpen}
                onMapMenuOpenChange={setIsMapMenuOpen}
                focusSite={searchFocusSite}
              />
              {/* Compass-style chat bar anchored to bottom center of visible map area */}
              <MapChatBar
                selectedSite={selectedSite}
                selectedDateId={selectedDateId}
                sites={sites}
                onSelectSite={handleSiteSelect}
                currentSubView="network"
                centerX={
                  selectedSite && analysisPanelMode !== 'full'
                    ? '25%'
                    : '50%'
                }
              />
            </div>
          )}

          {/* Table View */}
          {displayMode === 'table' && (
            <div className="absolute inset-0 pt-20">
              <OfferersTable
                offenderSiteIds={offenderSiteIds}
                sites={sites}
                selectedSite={selectedSite}
                onSelectSite={handleSiteSelect}
                selectedDateId={dataDateId || selectedDateId}
              />
            </div>
          )}

          {/* Site panel and tiles overlay - show for both map and table views */}
          {selectedSite && (displayMode === 'map' || displayMode === 'table') && (
        <>
          {/* Split mode: full-viewport overlay so panel is on top and blocks all other interaction until closed */}
          {analysisPanelMode === 'split' ? (
            <div className="absolute inset-0 z-50 flex transition-all duration-[280ms] ease-out">
              {/* Backdrop: blocks map and top bar; click to close (optional) */}
              <button
                type="button"
                className="flex-1 min-w-0 bg-black/20 dark:bg-black/40 cursor-default"
                onClick={() => handleSiteSelect(null)}
                aria-label="Close split view"
              />
              {/* Trends Panel - Right half, on top of backdrop */}
              <aside
                className={`flex flex-col w-1/2 min-w-0 overflow-hidden border border-white/20 dark:border-white/10 border-l bg-white/18 dark:bg-[#1c1c1e]/30 backdrop-blur-2xl shadow-[0_28px_96px_rgba(8,15,35,0.42)] transition-all duration-[280ms] ease-out ${
                  isClosing ? 'animate-panel-exit' : 'animate-panel-enter'
                }`}
              >
                <ObserveSiteAnalysisTile
                  key={selectedSite.siteId}
                  site={selectedSite}
                  selectedDateId={selectedDateId}
                  onClose={() => handleSiteSelect(null)}
                  onRcaMapSignals={setRcaMapSignals}
                  panelMode={analysisPanelMode}
                  onPanelModeChange={setAnalysisPanelMode}
                />
              </aside>
            </div>
          ) : (
            <>
              {/* Trends Panel - Right side (overlay/full), translucent */}
              <aside
                className={`absolute z-10 flex flex-col overflow-hidden border border-white/20 dark:border-white/10 bg-white/18 dark:bg-[#1c1c1e]/30 backdrop-blur-2xl shadow-[0_24px_88px_rgba(8,15,35,0.34)] transition-all duration-[280ms] ease-out ${
                  analysisPanelMode === 'overlay'
                    ? 'top-20 right-4 bottom-4 w-1/2 max-w-[calc(50%-2rem)] rounded-2xl'
                    : 'top-20 left-4 right-4 bottom-4 rounded-2xl'
                } ${
                  isClosing ? 'animate-panel-exit' : 'animate-panel-enter'
                }`}
              >
                <ObserveSiteAnalysisTile
                  key={selectedSite.siteId}
                  site={selectedSite}
                  selectedDateId={selectedDateId}
                  onClose={() => handleSiteSelect(null)}
                  onRcaMapSignals={setRcaMapSignals}
                  panelMode={analysisPanelMode}
                  onPanelModeChange={setAnalysisPanelMode}
                />
              </aside>

              {/* Bottom-left info tile intentionally removed per UX request */}
            </>
          )}
        </>
          )}
        </div>
      )}

      {/* Insights View */}
      {mainView === 'insights' && (
        <div className="absolute inset-0 flex flex-col overflow-hidden">
          <TelemetryDashboard
            onClose={() => handleSiteSelect(null)}
            site={selectedSite}
            activeTab={insightsTab as any}
            onTabChange={setInsightsTab}
          />
          <MapChatBar
            selectedSite={selectedSite}
            selectedDateId={selectedDateId}
            sites={sites}
            onSelectSite={handleSiteSelect}
            centerX="50%"
            currentSubView="insights"
            currentInsightsTab={insightsTab}
            onSwitchInsightsTab={setInsightsTab}
          />
        </div>
      )}
    </div>
  );
}

export function LegacySiteDashboard({
  site,
  offenderSiteIds,
  selectedDateId,
  onClose,
  onRcaMapSignals,
}: {
  site: MapSite;
  offenderSiteIds: Set<string>;
  selectedDateId: string;
  onClose: () => void;
  onRcaMapSignals: (signals: RCAMapSignals | null) => void;
}) {
  const isDegraded = isOffenderSite(site, offenderSiteIds);
  const isRcaEligible = isDegraded;
  const { dId } = useDummifier();
  const [activeScreen, setActiveScreen] = useState<'rca' | 'kpi_trends' | 'info'>(isDegraded ? 'rca' : 'kpi_trends');
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoData, setInfoData] = useState<{ tickets: any[]; alarms: any[] } | null>(null);

  const screenOptions: Array<{ id: 'rca' | 'kpi_trends' | 'info'; label: string }> = isRcaEligible
    ? [
        { id: 'rca', label: 'RCA' },
        { id: 'kpi_trends', label: 'KPI Trends' },
        { id: 'info', label: 'Info' },
      ]
    : [
        { id: 'kpi_trends', label: 'KPI Trends' },
        { id: 'info', label: 'Info' },
      ];

  useEffect(() => {
    setActiveScreen(isRcaEligible ? 'rca' : 'kpi_trends');
  }, [isRcaEligible, site.siteId]);

  useEffect(() => {
    onRcaMapSignals(null);
  }, [site.siteId, selectedDateId, onRcaMapSignals]);

  useEffect(() => {
    if (activeScreen !== 'info') return;
    let cancelled = false;
    const loadInfo = async () => {
      try {
        setInfoLoading(true);
        const response = await api.getSiteOperationalInfo(site.realSiteId ?? site.siteId, selectedDateId, 50);
        if (!cancelled && response.success && response.data) {
          const data = response.data as any;
          setInfoData({
            tickets: data.tickets || [],
            alarms: data.alarms || [],
          });
        }
      } catch {
        if (!cancelled) setInfoData({ tickets: [], alarms: [] });
      } finally {
        if (!cancelled) setInfoLoading(false);
      }
    };
    loadInfo();
    return () => {
      cancelled = true;
    };
  }, [activeScreen, site.siteId, selectedDateId]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header with site name and close button */}
      <div className="px-6 pt-5 pb-4 border-b border-gray-200/30 dark:border-white/10 flex-shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-text-primary dark:text-white truncate">
              {site.siteName}
            </h2>
            {String(site.siteName || '').trim().toUpperCase() !== String(site.siteId || '').trim().toUpperCase() && (
              <p className="text-sm text-text-secondary dark:text-gray-400 mt-1">{dId(site.siteId)}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-white/45 dark:bg-white/7 border border-white/35 dark:border-white/12 backdrop-blur-xl">
              {screenOptions.map((screen) => (
                <button
                  key={screen.id}
                  onClick={() => setActiveScreen(screen.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    activeScreen === screen.id
                      ? 'bg-ui-btn text-ui-btn-fg shadow-sm'
                      : 'text-text-secondary dark:text-gray-300 hover:bg-white/50 dark:hover:bg-white/10'
                  }`}
                >
                  {screen.label}
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="text-text-muted dark:text-gray-400 hover:text-gray-900 dark:hover:text-white text-2xl leading-none p-1"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>
      </div>
      
      {/* Trends content */}
      <div className="flex-1 overflow-y-auto px-6 pt-4 pb-6">
        {activeScreen === 'kpi_trends' ? (
          <SiteKpiTrends siteId={site.siteId} isDegraded={isDegraded} endDate={selectedDateId} />
        ) : activeScreen === 'rca' ? (
          <RCAReasoningPanel
            siteId={site.realSiteId ?? site.siteId}
            dateId={selectedDateId}
            sourceDummySiteId={site.siteId}
            onMapSignals={onRcaMapSignals}
            solutionRec={undefined}
          />
        ) : activeScreen === 'info' ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-white/35 dark:border-white/12 bg-white/35 dark:bg-white/5 backdrop-blur-xl p-4">
              <h3 className="text-sm font-semibold text-text-primary dark:text-white mb-3">Tickets</h3>
              {infoLoading ? (
                <p className="text-sm text-text-secondary dark:text-gray-300">Loading tickets...</p>
              ) : (infoData?.tickets?.length || 0) === 0 ? (
                <p className="text-sm text-text-secondary dark:text-gray-300">No tickets found for this site/date.</p>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-text-muted dark:text-gray-400 border-b border-white/30 dark:border-white/10">
                        <th className="py-2 pr-3">Ticket</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2 pr-3">Category</th>
                        <th className="py-2 pr-3">Assigned</th>
                      </tr>
                    </thead>
                    <tbody>
                      {infoData!.tickets.slice(0, 20).map((t: any, i: number) => (
                        <tr key={`${t.ticket_number || 'ticket'}-${i}`} className="border-b border-white/20 dark:border-white/5">
                          <td className="py-2 pr-3 text-text-primary dark:text-gray-200">{String(t.ticket_number || '-')}</td>
                          <td className="py-2 pr-3 text-text-secondary dark:text-gray-300">{String(t.ticket_status || '-')}</td>
                          <td className="py-2 pr-3 text-text-secondary dark:text-gray-300">{String(t.problem_category || '-')}</td>
                          <td className="py-2 pr-3 text-text-secondary dark:text-gray-300">{String(t.assigned_to || '-')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="rounded-xl border border-white/35 dark:border-white/12 bg-white/35 dark:bg-white/5 backdrop-blur-xl p-4">
              <h3 className="text-sm font-semibold text-text-primary dark:text-white mb-3">Alarms</h3>
              {infoLoading ? (
                <p className="text-sm text-text-secondary dark:text-gray-300">Loading alarms...</p>
              ) : (infoData?.alarms?.length || 0) === 0 ? (
                <p className="text-sm text-text-secondary dark:text-gray-300">No alarms found for this site/date.</p>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-text-muted dark:text-gray-400 border-b border-white/30 dark:border-white/10">
                        <th className="py-2 pr-3">Severity</th>
                        <th className="py-2 pr-3">Summary</th>
                        <th className="py-2 pr-3">Class</th>
                        <th className="py-2 pr-3">Identifier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {infoData!.alarms.slice(0, 20).map((a: any, i: number) => (
                        <tr key={`${a.identifier || 'alarm'}-${i}`} className="border-b border-white/20 dark:border-white/5">
                          <td className="py-2 pr-3 text-text-primary dark:text-gray-200">{String(a.severity || '-')}</td>
                          <td className="py-2 pr-3 text-text-secondary dark:text-gray-300">{String(a.summary || '-')}</td>
                          <td className="py-2 pr-3 text-text-secondary dark:text-gray-300">{String(a.class_name || '-')}</td>
                          <td className="py-2 pr-3 text-text-secondary dark:text-gray-300">{String(a.identifier || '-')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-white/35 dark:border-white/12 bg-white/35 dark:bg-white/5 backdrop-blur-xl p-6">
            <h3 className="text-sm font-semibold text-text-primary dark:text-white mb-2">
              {screenOptions.find((s) => s.id === activeScreen)?.label}
            </h3>
            <p className="text-sm text-text-secondary dark:text-gray-300">
              This screen is ready for your next module. We can wire this menu item to a full panel when you define the requirements.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

