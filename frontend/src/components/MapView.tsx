import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import MapGL, { Marker, Layer, Source, type MapRef } from 'react-map-gl';
import { Loader2, Menu, X, Check, Search, AlertTriangle, MapPinned } from 'lucide-react';
import api from '../services/api';
import { prefetchSiteKpis } from '../services/kpiPrefetch';
import { useMapData } from '../context/MapDataContext';
import { useTheme } from '../context/ThemeContext';
import { useDummifier } from '../context/DummifierContext';
import type { RCAMapSignals } from './RCAReasoningPanel';
import type { ProvisioningCandidateSite } from '../types';
import EventMapOverlay from './LocalEvents/EventMapOverlay';
import EventDetailPopover from './LocalEvents/EventDetailPopover';
import EventsLayerControl, { type EventsLayerState } from './LocalEvents/EventsLayerControl';
import { useLocalEvents } from './LocalEvents/useLocalEvents';
import type { EventCategory } from '../services/localEvents';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapLibre from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

// Mapbox token from environment variable
const MAPBOX_TOKEN = (import.meta as any).env?.VITE_MAPBOX_TOKEN || '';

const MAP_STYLES = [
  { id: 'auto', label: 'Auto', desc: 'Follow app theme (light/dark)', style: null, swatch: '#9ca3af' },
  { id: 'light', label: 'Light', desc: 'Clean light theme for data visualization', style: 'mapbox://styles/mapbox/light-v11', swatch: '#f5f5f4' },
  { id: 'dark', label: 'Dark', desc: 'Dark theme that reduces eye strain', style: 'mapbox://styles/mapbox/dark-v11', swatch: '#1f2937' },
  { id: 'streets', label: 'Streets', desc: 'Detailed street-level view', style: 'mapbox://styles/mapbox/streets-v12', swatch: '#fbbf24' },
  { id: 'satellite', label: 'Satellite', desc: 'High-resolution satellite imagery', style: 'mapbox://styles/mapbox/satellite-v9', swatch: '#0d9488' },
  { id: 'satellite-streets', label: 'Satellite Streets', desc: 'Satellite imagery with street labels', style: 'mapbox://styles/mapbox/satellite-streets-v12', swatch: '#4b5563' },
  { id: 'outdoors', label: 'Outdoors', desc: 'Topographic style with terrain details', style: 'mapbox://styles/mapbox/outdoors-v12', swatch: '#86efac' },
  { id: 'navigation-day', label: 'Navigation Day', desc: 'Optimized for turn-by-turn navigation', style: 'mapbox://styles/mapbox/navigation-day-v1', swatch: '#93c5fd' },
] as const;
type MapStyleId = (typeof MAP_STYLES)[number]['id'];

// ─── External Map Layer providers ─────────────────────────────────────────────
// MapLibre uses their public demo tiles; Esri uses the ArcGIS World Street Map
// tile service (free, no key required for reasonable usage).
// Both are delivered through a secondary MapLibre GL overlay so we get the same
// view-sync machinery for free.
export type ExternalMapProvider = 'maplibre' | 'esri';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ESRI_MAPLIBRE_STYLE: any = {
  version: 8,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sprite: '',
  sources: {
    'esri-world-street': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, HERE, Garmin, USGS, Intermap, increment P Corp.',
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'esri-world-street-layer',
      type: 'raster',
      source: 'esri-world-street',
      minzoom: 0,
      maxzoom: 24,
    },
  ],
};

function normalizeDateId(value?: string | null): string {
  if (!value) return '';
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function getDateDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function clampDateToMax(dateValue: string, maxDate: string): string {
  const d = normalizeDateId(dateValue);
  if (!d) return maxDate;
  return d > maxDate ? maxDate : d;
}

function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function pickValueCaseInsensitive(row: Record<string, any>, candidates: string[]) {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  const lowered = new Map<string, any>();
  Object.keys(row).forEach((k) => lowered.set(k.toLowerCase(), row[k]));
  for (const key of candidates) {
    const hit = lowered.get(key.toLowerCase());
    if (hit !== undefined && hit !== null) return hit;
  }
  return undefined;
}

export interface MapSite {
  siteId: string;          // Dummy ID for display
  realSiteId?: string;      // Real ID for API calls
  siteName: string;        // Dummy name
  latitude: number;
  longitude: number;
  cellCount: number;
  status: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'OUTAGE';
  anomalyCount: number;
  hasActiveTickets: boolean;
  clusterId?: string | null;      // Dummy cluster ID
  realClusterId?: string | null;  // Real cluster ID
}

interface CellSector {
  CellID: string;
  CellName: string;
  SiteID: string;
  realSiteID?: string;
  SiteName: string;
  Technology: string;
  Carrier: string;
  Azimuth: number;
  Height: number;
  SiteLatitude: number;
  SiteLongitude: number;
  CellLatitude: number;
  CellLongitude: number;
  CellAnomalyFlag: boolean;
  CellAnomalyScore: number;
  SiteAnomalyFlag: boolean;
  SiteAnomalyScore: number;
  CellCount: number;
  DateID: string;
}

interface RecentlyProvisionedSiteRecord {
  siteId: string;
  siteName: string;
  latitude?: number;
  longitude?: number;
  quarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  zone?: string;
  technology?: string;
  band?: string;
  status?: 'Provisioned' | 'Monitoring';
  provisionedAt?: string;
}
type ResolvedRecentlyProvisionedSite = RecentlyProvisionedSiteRecord & {
  latitude: number;
  longitude: number;
};

function readRecentProvisionedSites(): RecentlyProvisionedSiteRecord[] {
  const raw = localStorage.getItem('ztp_recent_provisioned_v1');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface MapViewProps {
  /** When provided, selection is controlled by parent (e.g. for split-screen dashboard). */
  selectedSite?: MapSite | null;
  onSelectSite?: (site: MapSite | null) => void;
  /** When true, the overlay site info panel is hidden (use with controlled selection). */
  hideSitePanel?: boolean;
  /** Whether the map is currently visible after a hidden state transition. */
  isVisible?: boolean;
  /** When set (e.g. 0.5), right-side panel is open; map padding centers selected site in visible left area */
  rightPanelWidthRatio?: number;
  /** RCA-derived site highlights/links extracted from reasoning text */
  rcaMapSignals?: RCAMapSignals | null;
  /** Enable dedicated new-site provisioning layer */
  provisioningLayerEnabled?: boolean;
  /** Focus map on a provisioning candidate site ID */
  provisioningFocusSiteId?: string | null;
  /** Callback after focus request has been consumed */
  onProvisioningFocusConsumed?: () => void;
  /** Click handler for provisioning candidate site */
  onProvisioningSiteSelected?: (site: ProvisioningCandidateSite) => void;
  /** Hide the top-left controls (hamburger menu, search) - used when controls are managed by parent */
  hideTopControls?: boolean;
  /** Control menu open state from parent */
  isMapMenuOpen?: boolean;
  /** Callback when menu open state should change */
  onMapMenuOpenChange?: (isOpen: boolean) => void;
  /** Zoom/pan to this site without selecting it (no panel opening). Used by parent search. */
  focusSite?: MapSite | null;
}

function normalizeSiteToken(value?: string | null): string {
  const s = String(value || '').trim();
  if (!s) return '';
  const upper = s.toUpperCase();
  const ustMatch = upper.match(/^UST0*(\d{4,8})$/);
  if (ustMatch) return ustMatch[1];
  if (/^\d{4,8}$/.test(upper)) return String(parseInt(upper, 10));
  return upper;
}

function buildLoadingGhostSites(longitude: number, latitude: number) {
  return [
    { id: 'ghost-1', longitude: longitude - 0.05, latitude: latitude + 0.032, size: 'lg' },
    { id: 'ghost-2', longitude: longitude - 0.012, latitude: latitude + 0.014, size: 'sm' },
    { id: 'ghost-3', longitude: longitude + 0.028, latitude: latitude + 0.022, size: 'md' },
    { id: 'ghost-4', longitude: longitude + 0.046, latitude: latitude - 0.018, size: 'lg' },
    { id: 'ghost-5', longitude: longitude - 0.026, latitude: latitude - 0.031, size: 'md' },
    { id: 'ghost-6', longitude: longitude + 0.008, latitude: latitude - 0.012, size: 'sm' },
  ] as const;
}

export default function MapView({
  selectedSite: controlledSite,
  onSelectSite,
  hideSitePanel,
  isVisible = true,
  rightPanelWidthRatio,
  rcaMapSignals,
  provisioningLayerEnabled = false,
  provisioningFocusSiteId = null,
  onProvisioningFocusConsumed,
  onProvisioningSiteSelected,
  hideTopControls = false,
  isMapMenuOpen: controlledMenuOpen,
  onMapMenuOpenChange,
  focusSite,
}: MapViewProps = {}) {
  const { theme } = useTheme();
  const { dId } = useDummifier();
  const didWarnSectorsRef = useRef(false);
  const {
    sites,
    setSites,
    siteCells,
    setSiteCells,
    isCacheValid,
    primeFromCache,
    offenderSiteIds,
    setOffenderSiteIds,
    selectedDateId,
    setSelectedDateId,
    activeSiteLayer,
    setActiveSiteLayer,
    cellSectors,
    setCellSectors,
    dataDateId,
    chatHighlightSiteIds,
    eventsLayerEnabled,
    setEventsLayerEnabled,
    externalMapLayerEnabled: showExternalMapLayer,
    setExternalMapLayerEnabled: setShowExternalMapLayer,
    externalMapProvider,
    setExternalMapProvider,
  } = useMapData();

  // Map style: 'auto' or null = follow app theme; otherwise use selected style
  const [mapStyleId, setMapStyleId] = useState<MapStyleId | null>(null);
  const effectiveMapStyle = useMemo(() => {
    const themeStyle = theme === 'dark' ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11';
    if (!mapStyleId || mapStyleId === 'auto') return themeStyle;
    const found = MAP_STYLES.find((s) => s.id === mapStyleId);
    return found?.style ?? themeStyle;
  }, [mapStyleId, theme]);
  const selectedMapStyle = mapStyleId ?? 'auto';
  const isStreetsMap = selectedMapStyle === 'streets';
  const isSatelliteFamily = selectedMapStyle === 'satellite' || selectedMapStyle === 'satellite-streets';
  const isOutdoorNavFamily =
    selectedMapStyle === 'navigation-day' || selectedMapStyle === 'outdoors' || selectedMapStyle === 'streets';

  const [viewState, setViewState] = useState({
    longitude: -122.4194,
    latitude: 37.7749,
    zoom: 13,
    pitch: 0,
    bearing: 0,
  });
  // External Map Layer — state lives in MapDataContext so chat can toggle it
  // showExternalMapLayer / externalMapProvider / setShowExternalMapLayer / setExternalMapProvider
  // are all destructured from useMapData() above.
  const [externalMapOpacity, setExternalMapOpacity] = useState(0.6);
  const mapLibreRef = useRef<any>(null);
  const layerPulseRafRef = useRef<number | null>(null);

  const [internalSite, setInternalSite] = useState<MapSite | null>(null);
  const selectedSite = onSelectSite != null ? (controlledSite ?? null) : internalSite;
  const setSelectedSite = onSelectSite ?? setInternalSite;
  const mapRef = useRef<MapRef | null>(null);

  
  // Animate neighbor lines opacity when site is selected
  const [neighborLineOpacity, setNeighborLineOpacity] = useState(0);
  
  useEffect(() => {
    if (selectedSite) {
      // Start from 0 opacity
      setNeighborLineOpacity(0);
      
      // Gradually increase opacity over 800ms
      const steps = 20;
      const increment = 1 / steps;
      const interval = 800 / steps; // 800ms total animation
      
      let currentStep = 0;
      const timer = setInterval(() => {
        currentStep++;
        setNeighborLineOpacity(Math.min(currentStep * increment, 1));
        
        if (currentStep >= steps) {
          clearInterval(timer);
        }
      }, interval);
      
      return () => clearInterval(timer);
    } else {
      setNeighborLineOpacity(0);
    }
  }, [selectedSite?.siteId]);
  
  // When parent selects a site (controlled), center and zoom the map on it.
  // Re-run when right panel ratio changes so the site re-centers in visible map area.
  useEffect(() => {
	    if (controlledSite && onSelectSite) {
	      const map = mapRef.current?.getMap?.();
	      if (map) {
	        const opts: any = {
	          center: [controlledSite.longitude, controlledSite.latitude],
	          zoom: Math.max(map.getZoom(), 12),
	          duration: 650,
	        };
	        if (rightPaddingPx > 0) {
	          opts.padding = { left: 0, right: rightPaddingPx, top: 0, bottom: 0 };
	        }
	        map.easeTo(opts);
	      }
	      setViewState((prev) => ({
	        ...prev,
	        longitude: controlledSite.longitude,
	        latitude: controlledSite.latitude,
        zoom: Math.max(prev.zoom, 12),
      }));
    }
  }, [controlledSite?.siteId, controlledSite?.latitude, controlledSite?.longitude, rightPanelWidthRatio, onSelectSite]);

  // Zoom-only focus from parent search (no site selection / panel opening)
  useEffect(() => {
    if (!focusSite) return;
    const map = mapRef.current?.getMap?.();
    if (map) {
      map.easeTo({
        center: [focusSite.longitude, focusSite.latitude],
        zoom: Math.max(map.getZoom(), 14),
        duration: 650,
      });
    }
    setViewState((prev) => ({
      ...prev,
      longitude: focusSite.longitude,
      latitude: focusSite.latitude,
      zoom: Math.max(prev.zoom, 14),
    }));
  }, [focusSite?.siteId, focusSite?.latitude, focusSite?.longitude]);

  // Compute right padding when panel is open so selected site centers in visible left area
  useEffect(() => {
    if (!containerRef.current || !controlledSite || rightPanelWidthRatio == null) {
      setRightPaddingPx(0);
      return;
    }
    const updatePadding = () => {
      if (containerRef.current) {
        const w = containerRef.current.offsetWidth;
        setRightPaddingPx(Math.round(w * rightPanelWidthRatio!));
      }
    };
    updatePadding();
    const ro = new ResizeObserver(updatePadding);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [controlledSite, rightPanelWidthRatio]);

  const [isLoading, setIsLoading] = useState(!isCacheValid(selectedDateId));
  const [minLoadPending, setMinLoadPending] = useState(() => !isCacheValid(selectedDateId));
  const [error, setError] = useState<string | null>(null);
  // Incrementing this triggers a fresh fetchSites (used by the retry button).
  const [fetchRetryCount, setFetchRetryCount] = useState(0);
  const [interactionState, setInteractionState] = useState({
    isDragging: false,
    isZooming: false,
  });
  const [sectorRadiusMeters, setSectorRadiusMeters] = useState(75); // Default 75m
  const [autoSizeSectors, setAutoSizeSectors] = useState(false);
  const [showSiteLabels, setShowSiteLabels] = useState(true);
  const [internalMenuOpen, setInternalMenuOpen] = useState(false);
  // Use controlled state if provided, otherwise use internal state
  const isMenuOpen = controlledMenuOpen !== undefined ? controlledMenuOpen : internalMenuOpen;
  const setIsMenuOpen = (open: boolean) => {
    if (onMapMenuOpenChange) {
      onMapMenuOpenChange(open);
    } else {
      setInternalMenuOpen(open);
    }
  };
  const [showLegend, setShowLegend] = useState(false);
  const [showProvisioningLayer, setShowProvisioningLayer] = useState(provisioningLayerEnabled);
  const [showRecentProvisionedLayer, setShowRecentProvisionedLayer] = useState(false);
  const [provisioningCandidates, setProvisioningCandidates] = useState<ProvisioningCandidateSite[]>([]);
  const [recentProvisionedSites, setRecentProvisionedSites] = useState<RecentlyProvisionedSiteRecord[]>([]);
  const [provisioningQuarterFilter, setProvisioningQuarterFilter] = useState<'ALL' | 'Q1' | 'Q2' | 'Q3' | 'Q4'>('ALL');
  const [provisioningHover, setProvisioningHover] = useState<{ site: ProvisioningCandidateSite; x: number; y: number } | null>(null);
  const [recentProvisionedMenu, setRecentProvisionedMenu] = useState<{ site: RecentlyProvisionedSiteRecord; x: number; y: number } | null>(null);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const hoverHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoverCardActiveRef = useRef(false);
  const [hoverInfo, setHoverInfo] = useState<{ siteId: string; siteName: string; clusterId: string | null; x: number; y: number } | null>(null);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOffendersOnly, setSearchOffendersOnly] = useState(true);
  const [rankedOffenderIds, setRankedOffenderIds] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [rightPaddingPx, setRightPaddingPx] = useState(0);
  const [mapSettingsTab, setMapSettingsTab] = useState<'filters' | 'layers' | 'mapOptions' | 'mapType'>('filters');
  // Local Events layer — compact control near the zoom buttons drives this.
  // Anchor mode is automatic: if a site is selected we anchor on it, otherwise
  // we anchor on the current map centre (so engineers can browse "what's
  // happening this Saturday near here" without picking a site first).
  const TODAY_ISO = () => new Date().toISOString().slice(0, 10);
  const PLUS_DAYS = (d: string, n: number) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const [eventsLayer, setEventsLayer] = useState<EventsLayerState>(() => ({
    // ON by default so users immediately see nearby events on the map.
    // Anchor starts as 'map' so events load around the map centre before any
    // site is selected; switches to 'site' as soon as the user clicks a site.
    enabled: true,
    startDate: PLUS_DAYS(TODAY_ISO(), -3),
    endDate: PLUS_DAYS(TODAY_ISO(), 3),
    radiusMiles: 5,
    enabledCategories: new Set<EventCategory>([
      'concert', 'sports', 'festival', 'school', 'conference',
      'severe-weather', 'news', 'public-holiday',
    ]),
    anchorMode: 'map',
  }));
  const [hoveredEvent, setHoveredEvent] = useState<{ event: import('../services/localEvents').LocalEvent | null; anchor: { x: number; y: number } | null }>({ event: null, anchor: null });
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [outageSiteIds, setOutageSiteIds] = useState<Set<string>>(new Set());
  const [overutilizedSiteIds, setOverutilizedSiteIds] = useState<Set<string>>(new Set());

  // Sync events layer enabled/disabled from context (allows chat to toggle it).
  useEffect(() => {
    setEventsLayer((prev) =>
      prev.enabled !== eventsLayerEnabled ? { ...prev, enabled: eventsLayerEnabled } : prev
    );
  }, [eventsLayerEnabled]);

  // Auto-switch anchor mode when a site is selected/deselected.
  useEffect(() => {
    setEventsLayer((prev) => ({
      ...prev,
      anchorMode: selectedSite ? 'site' : 'map',
    }));
  }, [selectedSite?.siteId]);

  // Drive the events hook from the consolidated state.
  const eventsAnchorUsid =
    eventsLayer.enabled && eventsLayer.anchorMode === 'site' && selectedSite
      ? (selectedSite.realSiteId ?? selectedSite.siteId)
      : null;
  const eventsAnchorLat =
    eventsLayer.enabled && eventsLayer.anchorMode === 'map'
      ? viewState.latitude
      : null;
  const eventsAnchorLng =
    eventsLayer.enabled && eventsLayer.anchorMode === 'map'
      ? viewState.longitude
      : null;
  const eventsState = useLocalEvents({
    usid: eventsAnchorUsid,
    centerLat: eventsAnchorLat,
    centerLng: eventsAnchorLng,
    radiusMiles: eventsLayer.radiusMiles,
    startDate: eventsLayer.startDate,
    endDate: eventsLayer.endDate,
    enabled: eventsLayer.enabled,
  });

  // Apply category filter client-side (cheap, lets the user toggle without
  // re-fetching the same upstream results).
  const filteredEvents = useMemo(() => {
    if (!eventsState.events?.length) return [];
    return eventsState.events.filter((e) => eventsLayer.enabledCategories.has(e.category));
  }, [eventsState.events, eventsLayer.enabledCategories]);

  // Reset selection / hover whenever the underlying event list changes or layer is toggled off.
  useEffect(() => {
    setHoveredEvent({ event: null, anchor: null });
    setSelectedEventId(null);
  }, [eventsState.events, eventsLayer.enabled]);
  const [isDateResolved, setIsDateResolved] = useState(false);
  const autoFocusedDateRef = useRef<string | null>(null);
  const maxAllowedDate = useMemo(() => getDateDaysAgo(3), []);
  const loadingGhostSites = useMemo(
    () => buildLoadingGhostSites(viewState.longitude, viewState.latitude),
    [viewState.longitude, viewState.latitude],
  );

  useEffect(() => {
    if (!isVisible) return;
    const resizeMap = () => mapRef.current?.resize();
    resizeMap();
    const first = window.setTimeout(resizeMap, 0);
    const second = window.setTimeout(resizeMap, 220);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
    };
  }, [isVisible, rightPaddingPx, effectiveMapStyle]);

  useEffect(() => {
    setShowProvisioningLayer(provisioningLayerEnabled);
    if (provisioningLayerEnabled) {
      setProvisioningQuarterFilter('Q1');
    }
  }, [provisioningLayerEnabled]);

  useEffect(() => {
    let cancelled = false;
    const fetchProvisioningCandidates = async () => {
      try {
        const response = await api.getProvisioningCandidates(provisioningQuarterFilter, undefined, 3);
        if (!cancelled && response.success && response.data?.candidates) {
          setProvisioningCandidates(response.data.candidates);
        }
      } catch {
        if (!cancelled) setProvisioningCandidates([]);
      }
    };
    fetchProvisioningCandidates();
    return () => {
      cancelled = true;
    };
  }, [provisioningQuarterFilter]);

  useEffect(() => {
    const refreshRecent = () => {
      const records = readRecentProvisionedSites();
      setRecentProvisionedSites(records);
    };
    refreshRecent();
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === 'ztp_recent_provisioned_v1') {
        refreshRecent();
      }
    };
    window.addEventListener('storage', onStorage);
    const timer = setInterval(refreshRecent, 2500);
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!queueNotice) return;
    const timer = setTimeout(() => setQueueNotice(null), 1800);
    return () => clearTimeout(timer);
  }, [queueNotice]);

  const cancelProvisioningHoverHide = () => {
    if (hoverHideTimerRef.current) {
      clearTimeout(hoverHideTimerRef.current);
      hoverHideTimerRef.current = null;
    }
  };

  const scheduleProvisioningHoverHide = (delayMs = 320) => {
    cancelProvisioningHoverHide();
    hoverHideTimerRef.current = setTimeout(() => {
      if (!isHoverCardActiveRef.current) {
        setProvisioningHover(null);
      }
    }, delayMs);
  };

  // Debug: Check tokens and environment
  useEffect(() => {
    // Silently validate environment setup on mount
  }, []);

  // The map date is initialised to "today − 3 days" in MapDataContext.
  // We don't fetch the latest data date from the dashboard anymore — the
  // 3-day default is what the user expects to see on first load. This effect
  // only clamps the value if the context default ever exceeds the cap and
  // marks the date as resolved so dependent effects can run.
  useEffect(() => {
    if (selectedDateId && selectedDateId > maxAllowedDate) {
      setSelectedDateId(maxAllowedDate);
    }
    setIsDateResolved(true);
  }, [setSelectedDateId, maxAllowedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedDateId) return;
    if (selectedDateId > maxAllowedDate) {
      setSelectedDateId(maxAllowedDate);
    }
  }, [selectedDateId, maxAllowedDate, setSelectedDateId]);

  // Fetch sites using Compass site-topology endpoint (all 6600+ real sites, no dummification)
  useEffect(() => {
    if (!isDateResolved) return;
    const fetchSites = async () => {
      const loadStart = Date.now();
      try {
        // If this date is already hydrated and fresh (sites + sectors), skip refetch.
        if (dataDateId === selectedDateId && isCacheValid(selectedDateId) && sites.length > 0 && cellSectors.length > 0) {
          setIsLoading(false);
          setError(null);
          return;
        }

        // Try to hydrate instantly from cache (even if stale); fetch will refresh.
        primeFromCache(selectedDateId);
        setIsLoading(true);
        setError(null);

        // Kick off all three requests in parallel, but DO NOT block the
        // loading screen on the (much larger) cell-sectors payload. Sites
        // and offenders unlock the map; sectors stream in afterwards and
        // re-enrich site state when they arrive.
        const sectorsPromise: Promise<Array<Record<string, any>>> = api
          .getCompassCellSectors(selectedDateId)
          .catch(() => [] as Array<Record<string, any>>);
        // Retry topology up to 3 times with backoff — handles the brief window
        // where tsx watch is restarting the backend and the proxy returns 404/ECONNRESET.
        const fetchTopologyWithRetry = async () => {
          const MAX_ATTEMPTS = 3;
          let lastErr: unknown;
          for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            try {
              const rows = await api.getCompassSiteTopology(selectedDateId);
              if (rows.length > 0) return rows;
              // Empty rows — backend may still be warming up. Wait and retry.
              if (attempt < MAX_ATTEMPTS - 1) {
                await new Promise<void>((r) => setTimeout(r, 3_000 * (attempt + 1)));
                continue;
              }
              return rows; // Last attempt — return whatever we got (empty is OK)
            } catch (err) {
              lastErr = err;
              if (attempt < MAX_ATTEMPTS - 1) {
                await new Promise<void>((r) => setTimeout(r, 3_000 * (attempt + 1)));
              }
            }
          }
          if (lastErr) throw lastErr;
          return [];
        };

        const [topoRows, compassOffenders] = await Promise.all([
          fetchTopologyWithRetry(),
          api.getCompassOffenders(selectedDateId).catch(
            () => [] as Array<{ USID: string; Total_Impact_to_CQX_Delta: number }>,
          ),
        ]);

        const mappedSites: MapSite[] = topoRows.map((row) => ({
          siteId: row.USID,
          realSiteId: row.USID,
          siteName: row.site_name || row.USID,
          latitude: row.latitude,
          longitude: row.longitude,
          cellCount: 0,
          status: row.is_offender ? ('CRITICAL' as const) : ('NORMAL' as const),
          anomalyCount: 0,
          hasActiveTickets: false,
          clusterId: row.cluster_id || null,
          realClusterId: row.cluster_id || null,
        }));

        if (mappedSites.length > 0) {
          const lats = mappedSites.map((s) => s.latitude);
          const lons = mappedSites.map((s) => s.longitude);
          const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
          const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
          const next = { latitude: centerLat, longitude: centerLon, zoom: 10, pitch: 0, bearing: 0 };
          setViewState(next);
          const map = mapRef.current?.getMap?.();
          map?.easeTo({ center: [centerLon, centerLat], zoom: 10, duration: 650 });
        }

        setSites(mappedSites);

        // Build offender set: prefer ranked compass offenders (already fetched in parallel),
        // fall back to the is_offender flag from topology if compass returned nothing.
        const topoOffenderSet = new Set<string>(
          topoRows.filter((r) => r.is_offender).map((r) => r.USID)
        );
        const ranked = (compassOffenders || []).map((r: any) => String(r.USID || '')).filter(Boolean);
        const finalOffenderSet = ranked.length
          ? new Set<string>(ranked)
          : topoOffenderSet;
        setRankedOffenderIds(ranked.length ? ranked : []);
        setOffenderSiteIds(finalOffenderSet);

        // Sites + offenders are in — let the map paint NOW. Sectors continue
        // loading in the background and we merge them in below.
        setIsLoading(false);

        // 3. Handle sector fallback if empty (retry latest available date)
        try {
          let sectorRows = await sectorsPromise;
          // Compass-style fallback: if selected date has no sectors, retry latest available date.
          if (!sectorRows.length) {
            const availableDates = await api.getCompassDates().catch(() => []);
            const fallbackDate = availableDates[0];
            if (fallbackDate && fallbackDate !== selectedDateId) {
              sectorRows = await api.getCompassCellSectors(fallbackDate).catch(() => []);
            }
          }
          const mappedSectors: CellSector[] = sectorRows
            .map((row: any) => {
              const siteLat = Number(
                pickValueCaseInsensitive(row, ['site_latitude', 'site_lat', 'latitude', 'lat', 'Source_Lat'])
              );
              const siteLon = Number(
                pickValueCaseInsensitive(row, ['site_longitude', 'site_lon', 'longitude', 'lng', 'lon', 'Source_Lon'])
              );
              const cellLat = Number(
                pickValueCaseInsensitive(row, ['cell_latitude', 'cell_lat', 'latitude', 'lat'])
              );
              const cellLon = Number(
                pickValueCaseInsensitive(row, ['cell_longitude', 'cell_lon', 'longitude', 'lng', 'lon'])
              );
              const azRaw = pickValueCaseInsensitive(row, ['azimuth', 'AZIMUTH']);
              const azNum = Number(azRaw);
              const useid = String(pickValueCaseInsensitive(row, ['USEID', 'useid']) ?? '');
              const usid = String(pickValueCaseInsensitive(row, ['USID', 'usid']) ?? '');

              return {
                CellID: useid,
                CellName: String(pickValueCaseInsensitive(row, ['cell_name', 'CELL_NAME']) ?? useid),
                SiteID: usid,
                realSiteID: usid,
                SiteName: usid,
                Technology: String(pickValueCaseInsensitive(row, ['TECH', 'tech']) ?? ''),
                Carrier: String(pickValueCaseInsensitive(row, ['CARRIER', 'carrier']) ?? ''),
                Azimuth: Number.isFinite(azNum) && azNum !== 0 ? azNum : 1.0,
                Height: Number(pickValueCaseInsensitive(row, ['HEIGHT', 'height']) ?? 0),
                SiteLatitude: siteLat,
                SiteLongitude: siteLon,
                CellLatitude: cellLat,
                CellLongitude: cellLon,
                CellAnomalyFlag: Boolean(Number(pickValueCaseInsensitive(row, ['cell_anomaly_flag']) ?? 0)),
                CellAnomalyScore: Number(pickValueCaseInsensitive(row, ['cell_anomaly_score']) ?? 0),
                SiteAnomalyFlag: Boolean(Number(pickValueCaseInsensitive(row, ['site_anomaly_flag']) ?? 0)),
                SiteAnomalyScore: Number(pickValueCaseInsensitive(row, ['site_anomaly_score']) ?? 0),
                CellCount: 0,
                DateID: String(pickValueCaseInsensitive(row, ['DATE_ID', 'date_id']) ?? selectedDateId ?? ''),
              } as CellSector;
            })
            .filter((s) =>
              Number.isFinite(s.SiteLatitude) &&
              Number.isFinite(s.SiteLongitude) &&
              s.SiteLatitude >= -90 &&
              s.SiteLatitude <= 90 &&
              s.SiteLongitude >= -180 &&
              s.SiteLongitude <= 180
            );

          setCellSectors(mappedSectors);

          // Build cell map keyed by real USID
          const cellMap = new Map<string, any[]>();
          mappedSectors.forEach((sector) => {
            const key = sector.realSiteID || sector.SiteID;
            if (!cellMap.has(key)) cellMap.set(key, []);
            cellMap.get(key)!.push({
              CellID: sector.CellID,
              CellName: sector.CellName,
              SiteID: sector.SiteID,
              realSiteID: sector.realSiteID,
              Technology: sector.Technology,
              Azimuth: sector.Azimuth,
              AnomalyFlag: sector.CellAnomalyFlag,
              AnomalyScore: sector.CellAnomalyScore,
            });
          });
          setSiteCells(cellMap);

          // Enrich site cellCount from sectors
          const cellCountMap = new Map<string, number>();
          mappedSectors.forEach((s) => {
            const key = s.realSiteID || s.SiteID;
            cellCountMap.set(key, (cellCountMap.get(key) || 0) + 1);
          });
          const anomalyCountMap = new Map<string, number>();
          mappedSectors.filter((s) => s.CellAnomalyFlag).forEach((s) => {
            const key = s.realSiteID || s.SiteID;
            anomalyCountMap.set(key, (anomalyCountMap.get(key) || 0) + 1);
          });
          const enrichedSites = mappedSites.map((site) => ({
              ...site,
              cellCount: cellCountMap.get(site.siteId) ?? site.cellCount,
              anomalyCount: anomalyCountMap.get(site.siteId) ?? site.anomalyCount,
              status:
                anomalyCountMap.get(site.siteId)
                  ? (site.status === 'CRITICAL' ? 'CRITICAL' : ('WARNING' as const))
                  : site.status,
          }));
          setSites(enrichedSites);
        } catch (sectorErr) {
          if (!didWarnSectorsRef.current) {
            didWarnSectorsRef.current = true;
            console.warn('Compass sectors unavailable — showing sites only');
          }
        }
      } catch (error: any) {
        setError(error?.response?.data?.error?.message || error?.message || 'Failed to load map data');
        setIsLoading(false);
      } finally {
        const elapsed = Date.now() - loadStart;
        console.debug(`[MapView] sites+offenders ready in ${elapsed}ms`);
      }
    };

    fetchSites();
  }, [selectedDateId, isDateResolved, dataDateId, fetchRetryCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Short minimum so the overlay doesn't flash off before the map tiles paint.
  useEffect(() => {
    if (!isLoading) return;
    const timer = setTimeout(() => setMinLoadPending(false), 400);
    return () => clearTimeout(timer);
  }, [isLoading]);

  // Offenders are now fetched in parallel with the site topology in fetchSites above.

  const nodesByUsid = useMemo(() => {
    const out = new Map<string, string[]>();
    siteCells.forEach((cells: any[], usid: string) => {
      const set = new Set<string>();
      for (const c of cells || []) {
        const name = String(c?.CellName || c?.cellName || '').trim();
        if (!name) continue;
        const prefix = name.split('_')[0]?.trim();
        if (prefix) set.add(prefix);
      }
      out.set(String(usid), Array.from(set).sort());
    });
    return out;
  }, [siteCells]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const siteMatches = q
      ? sites.filter((s) => {
          const siteId = String(s.siteId || '').toLowerCase();
          const real = String(s.realSiteId || '').toLowerCase();
          const name = String(s.siteName || '').toLowerCase();
          return siteId.includes(q) || real.includes(q) || name.includes(q);
        })
      : [];

    const offenderIds = rankedOffenderIds.length ? rankedOffenderIds : Array.from(offenderSiteIds);
    const offenders = offenderIds
      .map((id) => sites.find((s) => s.siteId === id || s.realSiteId === id))
      .filter(Boolean) as MapSite[];

    const base = q ? siteMatches : offenders;
    const filtered = searchOffendersOnly
      ? base.filter((s) => offenderSiteIds.has(s.siteId) || offenderSiteIds.has(s.realSiteId || ''))
      : base;

    // Deduplicate by siteId while preserving order.
    const seen = new Set<string>();
    const out: MapSite[] = [];
    for (const s of filtered) {
      const key = s.siteId;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= 30) break;
    }
    return out;
  }, [sites, rankedOffenderIds, offenderSiteIds, searchOffendersOnly, searchQuery]);

  // Auto-focus map on top offender whenever date changes.
  useEffect(() => {
    if (!isDateResolved) return;
    if (!selectedDateId) return;
    if (!sites.length) return;
    if (autoFocusedDateRef.current === selectedDateId) return;

    const orderedOffenderIds = Array.from(offenderSiteIds);
    if (!orderedOffenderIds.length) {
      return;
    }

    const topOffender = orderedOffenderIds
      .map((offenderId) => sites.find((s) => s.siteId === offenderId || s.realSiteId === offenderId))
      .find((site): site is MapSite => Boolean(site));

    if (!topOffender) {
      return;
    }

    setViewState((prev) => ({
      ...prev,
      longitude: topOffender.longitude,
      latitude: topOffender.latitude,
      zoom: 11,
    }));
    const map = mapRef.current?.getMap?.();
    map?.easeTo({ center: [topOffender.longitude, topOffender.latitude], zoom: 11, duration: 650 });
    autoFocusedDateRef.current = selectedDateId;
  }, [selectedDateId, offenderSiteIds, sites, isDateResolved]);

  useEffect(() => {
    if (!isMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuPanelRef.current?.contains(target)) return;
      if (menuTriggerRef.current?.contains(target)) return;
      setIsMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isMenuOpen]);

  const effectiveOffenderIds = offenderSiteIds;

  useEffect(() => {
    if (!isDateResolved || !selectedDateId) return;
    let cancelled = false;
    const fetchLayerStatus = async () => {
      try {
        const response = await api.getMapLayerSiteStatus(selectedDateId);
        if (!cancelled && response.success && response.data) {
          const outage = new Set<string>([
            ...(response.data.outageSiteIds || []),
            ...(response.data.outageRealUsids || []),
          ]);
          const overutil = new Set<string>([
            ...(response.data.overutilizedSiteIds || []),
            ...(response.data.overutilizedRealUsids || []),
          ]);
          setOutageSiteIds(outage);
          setOverutilizedSiteIds(overutil);
        }
      } catch {
        if (!cancelled) {
          setOutageSiteIds(new Set());
          setOverutilizedSiteIds(new Set());
        }
      }
    };
    fetchLayerStatus();
    return () => {
      cancelled = true;
    };
  }, [isDateResolved, selectedDateId]);

  const layerHighlightColor = useMemo(() => {
    if (isStreetsMap) return '#475569'; // dark slate on Streets only
    if (activeSiteLayer === 'outage') return '#64748b';
    if (activeSiteLayer === 'overutilized') return '#f97316';
    return '#dc2626';
  }, [activeSiteLayer, isStreetsMap]);

  // Sector fills need to stay "glassy" (lighter) even when highlighted.
  const layerHighlightSectorColor = useMemo(() => {
    if (isStreetsMap) return '#94a3b8';
    if (activeSiteLayer === 'outage') return '#cbd5e1';
    if (activeSiteLayer === 'overutilized') return '#fdba74';
    return '#f87171';
  }, [activeSiteLayer, isStreetsMap]);

  const normalSiteColor = useMemo(() => {
    if (isSatelliteFamily) return '#fde68a'; // light yellow on satellite styles
    if (isOutdoorNavFamily) return '#78350f'; // dark brown on navigation/outdoors/streets
    return '#22c55e';
  }, [isSatelliteFamily, isOutdoorNavFamily]);

  const siteLabelPaint = useMemo(() => ({
    'text-color': isSatelliteFamily ? '#f8fafc' : (isOutdoorNavFamily ? '#111827' : (theme === 'dark' ? '#d4a574' : '#000000')),
    'text-halo-color': isSatelliteFamily ? 'rgba(15,23,42,0.96)' : (isOutdoorNavFamily ? 'rgba(255,255,255,0.96)' : (theme === 'dark' ? '#1a1a1f' : '#ffffff')),
    'text-halo-width': isSatelliteFamily ? 2.4 : (isOutdoorNavFamily ? 2.4 : 2.0),
    'text-halo-blur': 0.4,
  }), [isSatelliteFamily, isOutdoorNavFamily, theme]);

  const effectiveLayerSiteIds = useMemo(() => {
    let base: Set<string>;
    if (activeSiteLayer === null) base = new Set();
    else if (activeSiteLayer === 'outage') base = outageSiteIds;
    else if (activeSiteLayer === 'overutilized') base = overutilizedSiteIds;
    else base = effectiveOffenderIds;
    // Merge in any sites highlighted by a chat RCA command
    if (chatHighlightSiteIds.size > 0) {
      return new Set([...base, ...chatHighlightSiteIds]);
    }
    return base;
  }, [activeSiteLayer, outageSiteIds, overutilizedSiteIds, effectiveOffenderIds, chatHighlightSiteIds]);

  const normalizedLayerSiteIds = useMemo(() => {
    const out = new Set<string>();
    effectiveLayerSiteIds.forEach((id) => {
      const raw = String(id || '').trim();
      if (!raw) return;
      out.add(raw);
      out.add(raw.toUpperCase());
      const normalized = normalizeSiteToken(raw);
      if (normalized) out.add(normalized);

      // Expand numeric <-> UST forms
      if (/^\d{4,8}$/.test(normalized)) {
        out.add(`UST${normalized}`);
      }
      const ustMatch = raw.toUpperCase().match(/^UST0*(\d{4,8})$/);
      if (ustMatch) {
        out.add(ustMatch[1]);
      }

      // No dummification mapping — real USIDs used directly
    });
    return out;
  }, [effectiveLayerSiteIds]);

  const isLayerSite = useCallback((site: { siteId: string; realSiteId?: string }) => {
    const siteIdRaw = String(site.siteId || '').trim();
    const realSiteIdRaw = String(site.realSiteId || '').trim();

    if (siteIdRaw) {
      if (normalizedLayerSiteIds.has(siteIdRaw) || normalizedLayerSiteIds.has(siteIdRaw.toUpperCase())) return true;
      const normalized = normalizeSiteToken(siteIdRaw);
      if (normalized && normalizedLayerSiteIds.has(normalized)) return true;
    }

    if (realSiteIdRaw) {
      if (normalizedLayerSiteIds.has(realSiteIdRaw) || normalizedLayerSiteIds.has(realSiteIdRaw.toUpperCase())) return true;
      const normalized = normalizeSiteToken(realSiteIdRaw);
      if (normalized && normalizedLayerSiteIds.has(normalized)) return true;
    }

    return false;
  }, [normalizedLayerSiteIds]);

  // Nearest-neighbor proximity radius map — rebuilt only when cellSectors changes.
  // For each unique site, finds the closest other site and sets radius = 38% of that distance,
  // clamped to [25m, 600m]. Pruned by latitude band for O(n) average performance.
  const proximityRadiusMap = useMemo((): Map<string, number> => {
    if (cellSectors.length === 0) return new Map();
    const R = 6371000;
    // Deduplicate to one point per site
    const seen = new Map<string, { lat: number; lon: number }>();
    for (const s of cellSectors) {
      const id = s.realSiteID || s.SiteID;
      if (!seen.has(id)) seen.set(id, { lat: s.SiteLatitude, lon: s.SiteLongitude });
    }
    const pts = Array.from(seen.entries()).map(([id, { lat, lon }]) => ({ id, lat, lon }));
    if (pts.length < 2) {
      const result = new Map<string, number>();
      pts.forEach((p) => result.set(p.id, 125));
      return result;
    }
    // Sort by latitude for band pruning
    pts.sort((a, b) => a.lat - b.lat);
    const MAX_RADIUS = 600; // meters — cap so rural sites aren't enormous
    const MIN_RADIUS = 25;
    const FRACTION = 0.38;
    // Max lat delta to bother checking (600m / 111,000m per degree ≈ 0.0054°)
    const MAX_LAT_DELTA = (MAX_RADIUS / FRACTION) / 111000;

    const result = new Map<string, number>();
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const latRad = (a.lat * Math.PI) / 180;
      let minDist = Infinity;
      // Search forward
      for (let j = i + 1; j < pts.length; j++) {
        if (pts[j].lat - a.lat > MAX_LAT_DELTA) break;
        const dLat = (pts[j].lat - a.lat) * Math.PI / 180;
        const dLon = (pts[j].lon - a.lon) * Math.PI / 180;
        const sinDLat = Math.sin(dLat / 2);
        const sinDLon = Math.sin(dLon / 2);
        const aa = sinDLat * sinDLat + Math.cos(latRad) * Math.cos(pts[j].lat * Math.PI / 180) * sinDLon * sinDLon;
        const d = 2 * R * Math.asin(Math.sqrt(aa));
        if (d < minDist) minDist = d;
      }
      // Search backward
      for (let j = i - 1; j >= 0; j--) {
        if (a.lat - pts[j].lat > MAX_LAT_DELTA) break;
        const dLat = (pts[j].lat - a.lat) * Math.PI / 180;
        const dLon = (pts[j].lon - a.lon) * Math.PI / 180;
        const sinDLat = Math.sin(dLat / 2);
        const sinDLon = Math.sin(dLon / 2);
        const aa = sinDLat * sinDLat + Math.cos(latRad) * Math.cos(pts[j].lat * Math.PI / 180) * sinDLon * sinDLon;
        const d = 2 * R * Math.asin(Math.sqrt(aa));
        if (d < minDist) minDist = d;
      }
      const radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, minDist * FRACTION));
      result.set(a.id, radius);
    }
    return result;
  }, [cellSectors]);

  // Build sector geometry once per topology (date) + radius; highlight state is applied separately.
  const baseSectorGeometryFeatures = useMemo(() => {
    if (cellSectors.length === 0) return [] as Array<any>;

    // Compass guideline: keep geometry stable during zoom/pan.
    // Use a small, fixed number of points per wedge for performance.
    const numArcPoints = 14;
    const toRadians = (deg: number) => (deg * Math.PI) / 180;
    const beamwidth = 65;
    const earthRadiusMeters = 6371000;

    return cellSectors.map((sector) => {
      const { SiteLatitude, SiteLongitude, Azimuth } = sector;
      const siteKey = sector.realSiteID || sector.SiteID;
      const radius = autoSizeSectors
        ? (proximityRadiusMap.get(siteKey) ?? sectorRadiusMeters)
        : sectorRadiusMeters;
      const angleStart = Azimuth - beamwidth / 2;
      const angleEnd = Azimuth + beamwidth / 2;
      const arcPoints: number[][] = [[SiteLongitude, SiteLatitude]];
      const latRad = (SiteLatitude * Math.PI) / 180;
      for (let i = 0; i <= numArcPoints; i += 1) {
        const angle = angleStart + (angleEnd - angleStart) * (i / numArcPoints);
        const angleRad = toRadians(angle);
        // 0° = North => +lat, 90° = East => +lon
        const dLat = (radius * Math.cos(angleRad) / earthRadiusMeters) * (180 / Math.PI);
        const dLon = (radius * Math.sin(angleRad) / (earthRadiusMeters * Math.cos(latRad))) * (180 / Math.PI);
        arcPoints.push([SiteLongitude + dLon, SiteLatitude + dLat]);
      }
      arcPoints.push([SiteLongitude, SiteLatitude]);

      const cellStatus = sector.CellAnomalyScore >= 0.85
        ? 'critical'
        : sector.CellAnomalyScore >= 0.75
          ? 'warning'
          : 'healthy';

      const siteToken = normalizeSiteToken(sector.realSiteID ?? sector.SiteID) || normalizeSiteToken(sector.SiteID) || '';
      return {
        type: 'Feature' as const,
        id: sector.CellID || `${sector.SiteID}_${sector.Azimuth}`,
        properties: {
          siteId: sector.SiteID,
          siteToken,
          cellId: sector.CellID,
          status: cellStatus,
          technology: sector.Technology,
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [arcPoints],
        },
      };
    });
  }, [cellSectors, sectorRadiusMeters, autoSizeSectors, proximityRadiusMap]);

  const selectedSiteToken = useMemo(() => {
    if (!selectedSite) return '';
    return normalizeSiteToken(selectedSite.realSiteId ?? selectedSite.siteId);
  }, [selectedSite?.siteId, selectedSite?.realSiteId]);

  const cellsGeoJSON = useMemo(() => {
    const features = baseSectorGeometryFeatures.map((f: any) => {
      const siteToken = String(f?.properties?.siteToken || '');
      const isLayerHit = Boolean(siteToken && normalizedLayerSiteIds.has(siteToken));
      const isSelected = Boolean(selectedSiteToken && siteToken && siteToken === selectedSiteToken);
      const color = isLayerHit ? layerHighlightSectorColor : '#00A8E0';
      return {
        ...f,
        properties: {
          ...f.properties,
          isLayerHit,
          isSelected,
          color,
        },
      };
    });

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [baseSectorGeometryFeatures, normalizedLayerSiteIds, layerHighlightSectorColor, selectedSiteToken]);

  const shouldRenderCellSectors = cellsGeoJSON.features.length > 0;

  // Compass-style offender blinking + radiating ring (drives Mapbox paint props; avoids re-rendering).
  useEffect(() => {
    if (layerPulseRafRef.current != null) {
      window.cancelAnimationFrame(layerPulseRafRef.current);
      layerPulseRafRef.current = null;
    }
    if (interactionState.isDragging || interactionState.isZooming) return;
    if (activeSiteLayer !== 'degraded') return;
    if (normalizedLayerSiteIds.size === 0) return;

    let cancelled = false;

    // Blink state for the main dot
    let blinkOpacity = 1;
    let blinkIncreasing = false;

    const tick = () => {
      if (cancelled) return;
      const map = mapRef.current?.getMap?.();
      if (!map) {
        layerPulseRafRef.current = window.requestAnimationFrame(tick);
        return;
      }

      // Blink the offender dot (oscillate opacity 0.25 ↔ 1.0)
      if (blinkIncreasing) {
        blinkOpacity = Math.min(1, blinkOpacity + 0.04);
        if (blinkOpacity >= 1) blinkIncreasing = false;
      } else {
        blinkOpacity = Math.max(0.25, blinkOpacity - 0.04);
        if (blinkOpacity <= 0.25) blinkIncreasing = true;
      }
      if (map.getLayer('unclustered-point')) {
        map.setPaintProperty(
          'unclustered-point',
          'circle-opacity',
          ['case', ['get', 'isLayerHit'], blinkOpacity, 0.96]
        );
      }

      layerPulseRafRef.current = window.requestAnimationFrame(tick);
    };

    layerPulseRafRef.current = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (layerPulseRafRef.current != null) {
        window.cancelAnimationFrame(layerPulseRafRef.current);
        layerPulseRafRef.current = null;
      }
    };
  }, [
    activeSiteLayer,
    interactionState.isDragging,
    interactionState.isZooming,
    normalizedLayerSiteIds.size,
  ]);

  // Memoize site GeoJSON for clustering - only sites with sectors
  const sitesGeoJSON = useMemo(() => {
    // Show ALL sites, regardless of whether they have sectors
    // Sites without sectors will just not show cell visualizations
    // Super KPI offenders (realSiteId in offenderSiteIds) → RED, others → GREEN
    return {
      type: 'FeatureCollection' as const,
      features: sites.map((site: any) => ({
        type: 'Feature' as const,
        properties: {
          siteId: site.siteId,
          siteName: site.siteName,
          status: site.status,
          cellCount: site.cellCount,
          anomalyCount: site.anomalyCount,
          hasActiveTickets: site.hasActiveTickets,
          clusterId: site.clusterId || null,
          isLayerHit: isLayerSite({ siteId: site.siteId, realSiteId: site.realSiteId }),
        },
        geometry: {
          type: 'Point' as const,
          coordinates: [site.longitude, site.latitude],
        },
      })),
    };
  }, [sites, normalizedLayerSiteIds]);

  // Offender sites for CSS ring Markers (only when degraded layer is active)
  const offenderSitesForRings = useMemo(() => {
    if (activeSiteLayer !== 'degraded') return [];
    return sites.filter((s: MapSite) => isLayerSite({ siteId: s.siteId, realSiteId: s.realSiteId }));
  }, [activeSiteLayer, sites, normalizedLayerSiteIds]);

  const provisioningGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: showProvisioningLayer
      ? provisioningCandidates.map((site) => ({
          type: 'Feature' as const,
          properties: {
            siteId: site.siteId,
            siteName: site.siteName,
            quarter: site.quarter,
            status: site.status,
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [site.longitude, site.latitude],
          },
        }))
      : [],
  }), [provisioningCandidates, showProvisioningLayer]);

  const resolvedRecentProvisionedSites = useMemo<ResolvedRecentlyProvisionedSite[]>(() => {
    return recentProvisionedSites
      .map((site) => {
        if (typeof site.latitude === 'number' && typeof site.longitude === 'number') {
          return { ...site, latitude: site.latitude, longitude: site.longitude };
        }
        const fromProvisioning = provisioningCandidates.find((s) => s.siteId === site.siteId);
        if (fromProvisioning) {
          return {
            ...site,
            latitude: fromProvisioning.latitude,
            longitude: fromProvisioning.longitude,
          };
        }
        const fromMapSite = sites.find((s) => s.siteId === site.siteId);
        if (fromMapSite) {
          return {
            ...site,
            latitude: fromMapSite.latitude,
            longitude: fromMapSite.longitude,
          };
        }
        return null;
      })
      .filter((site): site is ResolvedRecentlyProvisionedSite => Boolean(site));
  }, [recentProvisionedSites, provisioningCandidates, sites]);

  const recentProvisionedGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: showRecentProvisionedLayer
      ? resolvedRecentProvisionedSites.map((site) => ({
          type: 'Feature' as const,
          properties: {
            siteId: site.siteId,
            siteName: site.siteName,
            quarter: site.quarter || 'Q1',
            status: site.status || 'Provisioned',
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [site.longitude, site.latitude],
          },
        }))
      : [],
  }), [resolvedRecentProvisionedSites, showRecentProvisionedLayer]);

  const recentProvisionedSectorGeoJSON = useMemo(() => {
    const radiusMeters = 180;
    const radiusDeg = radiusMeters / 111320;
    const beamWidth = 55;
    const toRadians = (deg: number) => (deg * Math.PI) / 180;
    return {
      type: 'FeatureCollection' as const,
      features: showRecentProvisionedLayer
        ? resolvedRecentProvisionedSites.flatMap((site) => {
            const seed = stableHash(site.siteId) % 360;
            const baseAngles = [seed, (seed + 120) % 360, (seed + 240) % 360];
            return baseAngles.map((azimuth, index) => {
              const angleStart = azimuth - beamWidth / 2;
              const angleEnd = azimuth + beamWidth / 2;
              const centerPoint = [site.longitude, site.latitude];
              const points: number[][] = [centerPoint];
              const segments = 14;
              for (let i = 0; i <= segments; i += 1) {
                const angle = angleStart + ((angleEnd - angleStart) * i) / segments;
                const angleRad = toRadians(angle);
                points.push([
                  site.longitude + radiusDeg * Math.sin(angleRad),
                  site.latitude + radiusDeg * Math.cos(angleRad),
                ]);
              }
              points.push(centerPoint);
              return {
                type: 'Feature' as const,
                properties: {
                  siteId: site.siteId,
                  sectorIdx: index,
                },
                geometry: {
                  type: 'Polygon' as const,
                  coordinates: [points],
                },
              };
            });
          })
        : [],
    };
  }, [resolvedRecentProvisionedSites, showRecentProvisionedLayer]);

  const provisioningMetadata = useMemo(() => {
    const reasons = [
      'Coverage gap closure',
      'Capacity expansion',
      'In-building demand',
      'Event hotspot support',
      'Reliability reinforcement',
    ];
    const out = new Map<string, { reason: string }>();
    provisioningCandidates.forEach((site) => {
      const reason = reasons[stableHash(site.siteId) % reasons.length];
      out.set(site.siteId, { reason });
    });
    return out;
  }, [provisioningCandidates]);

  const handleQueueProvisioningSite = (site: ProvisioningCandidateSite) => {
    const key = 'provisioning_queue_v1';
    const raw = localStorage.getItem(key);
    const existing: ProvisioningCandidateSite[] = raw ? JSON.parse(raw) : [];
    const withoutDup = existing.filter((item) => item.siteId !== site.siteId);
    const updated = [...withoutDup, site];
    localStorage.setItem(key, JSON.stringify(updated));
    setQueueNotice(`Added ${site.siteId} to provisioning queue`);
  };

  // Degraded display values when an offender (red) site is selected - for demo visibility
  const degradedDisplay = useMemo(() => {
    if (!selectedSite || !effectiveOffenderIds.has(selectedSite.realSiteId || selectedSite.siteId)) return null;
    const hash = selectedSite.siteId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const cellCount = (hash % 15) + 2; // 2-16, deterministic per site
    const anomalyCount = (hash >> 4) % Math.max(1, cellCount); // 0 to cellCount-1
    return {
      status: 'DEGRADED' as const,
      cellCount,
      anomalyCount,
      hasActiveTickets: true,
    };
  }, [selectedSite?.siteId, selectedSite?.realSiteId, effectiveOffenderIds]);

  // Lines from selected site to closest neighbor sites — only to sites that appear on the map (have sectors)
  const neighborLinesGeoJSON = useMemo(() => {
    if (!selectedSite || sites.length === 0) {
      return { type: 'FeatureCollection' as const, features: [] };
    }
    // Consider ALL sites for neighbor lines
    const CLOSEST_N = 6;
    const otherSites = sites.filter((s) => s.siteId !== selectedSite.siteId);
    if (otherSites.length === 0) return { type: 'FeatureCollection' as const, features: [] };

    const withDist = otherSites.map((s) => {
      const dLat = s.latitude - selectedSite.latitude;
      const dLon = s.longitude - selectedSite.longitude;
      const dist = Math.sqrt(dLat * dLat + dLon * dLon);
      return { site: s, dist };
    });
    withDist.sort((a, b) => a.dist - b.dist);
    const closest = withDist.slice(0, CLOSEST_N).map(({ site }) => site);

    const features = closest.map((neighbor) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [selectedSite.longitude, selectedSite.latitude],
          [neighbor.longitude, neighbor.latitude],
        ],
      },
    }));
    return { type: 'FeatureCollection' as const, features };
  }, [selectedSite, sites, cellSectors]);

  const rcaMapOverlay = useMemo(() => {
    if (!rcaMapSignals) return null;
    const source = sites.find((s) => s.siteId === rcaMapSignals.sourceSiteId) || null;
    if (!source) return null;

    const relatedSites = rcaMapSignals.relatedSiteIds
      .map((id) => sites.find((s) => s.siteId === id))
      .filter((s): s is MapSite => Boolean(s));

    const downSet = new Set(rcaMapSignals.downSiteIds);
    const congestionSet = new Set(rcaMapSignals.congestedSiteIds);

    const lines = relatedSites.map((target) => {
      const severity = downSet.has(target.siteId) ? 'down' : (congestionSet.has(target.siteId) ? 'congestion' : 'related');
      return {
        type: 'Feature' as const,
        properties: { severity },
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [source.longitude, source.latitude],
            [target.longitude, target.latitude],
          ],
        },
      };
    });

    return {
      source,
      relatedSites,
      downSet,
      congestionSet,
      lineGeoJSON: { type: 'FeatureCollection' as const, features: lines },
    };
  }, [rcaMapSignals, sites]);

  useEffect(() => {
    if (!provisioningFocusSiteId) return;
    const target = provisioningCandidates.find((s) => s.siteId === provisioningFocusSiteId);
    if (!target) return;
    setShowProvisioningLayer(true);
    setProvisioningQuarterFilter('Q1');
    const map = mapRef.current?.getMap?.();
    map?.easeTo({ center: [target.longitude, target.latitude], zoom: Math.max(map?.getZoom?.() ?? 0, 14), duration: 650 });
    setViewState((prev) => ({
      ...prev,
      longitude: target.longitude,
      latitude: target.latitude,
      zoom: Math.max(prev.zoom, 14),
    }));
    onProvisioningFocusConsumed?.();
  }, [provisioningFocusSiteId, provisioningCandidates, onProvisioningFocusConsumed]);

  // Show setup message if no token
  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex-1 flex items-center justify-center bg-cream-bg dark:bg-pulse-bg">
        <div className="text-center max-w-md p-8 bg-cream-surface dark:bg-pulse-surface border border-border dark:border-pulse-border rounded-lg">
          <MapPinned className="mx-auto mb-4 h-12 w-12 text-tenant-primary" aria-hidden />
          <h2 className="text-xl font-bold text-text-primary dark:text-text-primary mb-3">
            Mapbox Token Required
          </h2>
          <p className="text-sm text-text-secondary dark:text-text-secondary mb-4">
            To view the network topology map, please set up your Mapbox access token:
          </p>
          <ol className="text-left text-sm text-text-secondary dark:text-text-secondary space-y-2 mb-4">
            <li>1. Get a free token from <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noopener noreferrer" className="text-tenant-primary hover:underline">mapbox.com</a></li>
            <li>2. Create a <code className="bg-cream-surface-light dark:bg-pulse-bg px-1 py-0.5 rounded text-xs">.env</code> file in the frontend folder</li>
            <li>3. Add: <code className="bg-cream-surface-light dark:bg-pulse-bg px-1 py-0.5 rounded text-xs">VITE_MAPBOX_TOKEN=your_token</code></li>
            <li>4. Restart the dev server</li>
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 min-h-0 relative">
      {/* Dismissable error banner — floats over the map instead of replacing it.
          This lets the user retry without losing their map state, and avoids a
          blank screen when a temporary backend restart caused the 404. */}
      {error && !isLoading && (
        <div className="absolute top-4 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-xl border border-red-200 bg-white/95 px-4 py-3 shadow-lg dark:border-red-800/60 dark:bg-slate-900/95 backdrop-blur-sm max-w-md w-[calc(100%-2rem)]">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-500" aria-hidden />
          <span className="flex-1 text-sm text-slate-700 dark:text-slate-200 min-w-0 truncate">{error}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                setError(null);
                setIsLoading(true);
                setFetchRetryCount((n) => n + 1);
              }}
              className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              Retry
            </button>
            <button
              onClick={() => setError(null)}
              aria-label="Dismiss"
              className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors dark:hover:bg-slate-800 dark:hover:text-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      <MapGL
        ref={mapRef}
        initialViewState={viewState as any}
        padding={rightPaddingPx > 0 ? { left: 0, right: rightPaddingPx, top: 0, bottom: 0 } : undefined}
        // Compass guideline: keep map largely uncontrolled for smooth pan/zoom.
        // Persist view state only on moveend/zoomend.
        onMove={(evt) => {
          if (showExternalMapLayer) {
            const { longitude, latitude, zoom, pitch, bearing } = evt.viewState as any;
            mapLibreRef.current?.jumpTo({ center: [longitude, latitude], zoom, pitch, bearing });
          }
        }}
        onMoveEnd={(evt) => {
          setInteractionState({ isDragging: false, isZooming: false });
          setViewState(evt.viewState as any);
        }}
        onMoveStart={() => setInteractionState({ isDragging: true, isZooming: false })}
        onZoomStart={() => setInteractionState({ isDragging: false, isZooming: true })}
        onZoomEnd={(evt) => {
          setInteractionState({ isDragging: false, isZooming: false });
          setViewState(evt.viewState as any);
        }}
        mapStyle={effectiveMapStyle}
        mapboxAccessToken={MAPBOX_TOKEN}
        style={{ width: '100%', height: '100%' }}
        interactiveLayerIds={['clusters', 'unclustered-point', 'provisioning-candidate-point', 'recent-provisioned-point']}
        reuseMaps
        maxPitch={60}
        minZoom={3}
        maxZoom={18}
        attributionControl={false}
        // Keep world copies off for performance/clarity; other Mapbox options vary by mapbox-gl version.
        renderWorldCopies={false}
        onMouseMove={(e) => {
          const features = e.features;
          const provisioningFeature = features?.find((f: any) => f.layer.id === 'provisioning-candidate-point');
          if (provisioningFeature) {
            cancelProvisioningHoverHide();
            const props = provisioningFeature.properties as any;
            const candidate = provisioningCandidates.find((s) => s.siteId === props?.siteId);
            if (candidate) {
              setProvisioningHover({
                site: candidate,
                x: e.point.x,
                y: e.point.y,
              });
              setHoverInfo(null);
              return;
            }
          }

          if (features && features.length > 0 && features[0].layer.id === 'unclustered-point') {
            const props = features[0].properties as any;
            if (props) {
              setHoverInfo({
                siteId: props.siteId,
                siteName: props.siteName,
                clusterId: props.clusterId || null,
                x: e.point.x,
                y: e.point.y,
              });
            }
            scheduleProvisioningHoverHide();
          } else {
            setHoverInfo(null);
            scheduleProvisioningHoverHide();
          }
        }}
        onMouseLeave={() => {
          setHoverInfo(null);
          scheduleProvisioningHoverHide(220);
        }}
        onClick={(e) => {
          // If a site panel is open, any map click should dismiss RCA/info tiles first.
          if (selectedSite) {
            setSelectedSite(null);
            setRecentProvisionedMenu(null);
            return;
          }

          const features = e.features;
          if (features && features.length > 0) {
            const feature = features[0];
            const props = feature.properties as any;
	            if (props && feature.layer.id === 'provisioning-candidate-point') {
	              const candidate = provisioningCandidates.find((s) => s.siteId === props.siteId);
	              if (candidate) {
	                setProvisioningHover({
	                  site: candidate,
	                  x: e.point.x,
	                  y: e.point.y,
	                });
	                const map = mapRef.current?.getMap?.();
	                map?.easeTo({ center: [candidate.longitude, candidate.latitude], zoom: Math.max(map?.getZoom?.() ?? 0, 14), duration: 650 });
	                setViewState((prev) => ({
	                  ...prev,
	                  longitude: candidate.longitude,
	                  latitude: candidate.latitude,
	                  zoom: Math.max(prev.zoom, 14),
	                }));
	              }
	            } else if (props && feature.layer.id === 'recent-provisioned-point') {
              const recentSite = resolvedRecentProvisionedSites.find((s) => s.siteId === props.siteId);
              if (recentSite) {
                setRecentProvisionedMenu({
                  site: recentSite,
                  x: e.point.x,
                  y: e.point.y,
                });
                setProvisioningHover(null);
              }
            } else if (props && feature.layer.id === 'unclustered-point') {
              const site = sites.find(s => s.siteId === props.siteId);
              if (site) {
                setSelectedSite(site);
                prefetchSiteKpis(site.siteId, selectedDateId);
              }
            } else if (feature.layer.id === 'clusters') {
              // Compass-style: use Mapbox cluster expansion zoom.
              const clusterId = (feature.properties as any)?.cluster_id;
              const map = mapRef.current?.getMap?.();
              const src = map?.getSource?.('sites') as any;
              if (map && src?.getClusterExpansionZoom && clusterId != null) {
                src.getClusterExpansionZoom(clusterId, (err: any, zoom: number) => {
                  if (err) return;
                  map.easeTo({
                    center: (feature.geometry as any).coordinates,
                    zoom,
                    duration: 650,
                  });
                });
	              } else {
	                // Fallback: zoom in a bit.
	                const center = (feature.geometry as any).coordinates;
	                const map = mapRef.current?.getMap?.();
	                const nextZoom = Math.min((map?.getZoom?.() ?? viewState.zoom) + 2, 18);
	                map?.easeTo({ center, zoom: nextZoom, duration: 650 });
	                setViewState((prev) => ({
	                  ...prev,
	                  longitude: center[0],
	                  latitude: center[1],
	                  zoom: Math.min(prev.zoom + 2, 18),
	                }));
	              }
	            }
          } else {
            // Click on empty map area: clear selection and hide tiles
            setSelectedSite(null);
            setProvisioningHover(null);
            setRecentProvisionedMenu(null);
          }
        }}
      >
        {isLoading && sites.length === 0 && loadingGhostSites.map((site) => {
          const sizeClass = site.size === 'lg' ? 'h-4 w-4' : site.size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3';
          return (
            <Marker
              key={site.id}
              longitude={site.longitude}
              latitude={site.latitude}
              anchor="center"
              style={{ pointerEvents: 'none' }}
            >
              <div className="relative">
                <div
                  className={`rounded-full border ${sizeClass} animate-pulse`}
                  style={{
                    backgroundColor: 'rgb(var(--tenant-accent-rgb) / 0.2)',
                    borderColor: 'rgb(var(--tenant-accent-rgb) / 0.55)',
                    boxShadow: '0 0 0 12px rgb(var(--tenant-accent-rgb) / 0.08)',
                  }}
                />
              </div>
            </Marker>
          );
        })}

        {/* RCA-driven highlights from reasoning text */}
        {rcaMapOverlay?.relatedSites.map((site) => {
          const isDown = rcaMapOverlay.downSet.has(site.siteId);
          const isCongestion = rcaMapOverlay.congestionSet.has(site.siteId);
          return (
            <Marker
              key={`rca-highlight-${site.siteId}`}
              longitude={site.longitude}
              latitude={site.latitude}
              anchor="center"
              style={{ pointerEvents: 'none' }}
            >
              <div className="relative">
                <div className={`rca-site-highlight ${isDown ? 'down' : (isCongestion ? 'congestion' : 'related')}`} />
                {isDown ? (
                  <span className="rca-outage-bolt" aria-label="Outage site" title="Outage site">
                    ⚡
                  </span>
                ) : null}
              </div>
            </Marker>
          );
        })}

        {/* CSS radar ping rings for offender sites — 3 staggered expanding rings */}
        {offenderSitesForRings.map((site: MapSite) => (
          <Marker
            key={`offender-ring-${site.siteId}`}
            longitude={site.longitude}
            latitude={site.latitude}
            anchor="center"
            style={{ pointerEvents: 'none' }}
          >
            <div className="relative w-0 h-0">
              <div className="offender-pulse-ring" />
              <div className="offender-pulse-ring" />
              <div className="offender-pulse-ring" />
            </div>
          </Marker>
        ))}

          {/* Clustered Site Markers - clustering handled by clusterMaxZoom */}
          <Source
            id="sites"
            type="geojson"
            data={sitesGeoJSON}
            cluster
            clusterMaxZoom={9}
            clusterRadius={50}
            clusterMinPoints={3}
          >
            {/* Cluster circles */}
            <Layer
              id="clusters"
              type="circle"
              filter={['has', 'point_count']}
              paint={{
                'circle-color': [
                  'interpolate',
                  ['linear'],
                  ['get', 'point_count'],
                  1, '#1e3a5f',
                  25, '#1d4ed8',
                  75, '#2563eb',
                  150, '#3b82f6',
                  300, '#60a5fa',
                ],
                'circle-radius': [
                  'step',
                  ['get', 'point_count'],
                  14,
                  10,
                  18,
                  50,
                  23,
                  100,
                  28,
                ],
                'circle-opacity': interactionState.isDragging ? 0.6 : 0.82,
                'circle-stroke-width': 1,
                'circle-stroke-color': 'rgba(99,102,241,0.35)',
              }}
            />

            {/* Cluster count labels */}
            <Layer
              id="cluster-count"
              type="symbol"
              filter={['has', 'point_count']}
              layout={{
                'text-field': ['get', 'point_count_abbreviated'],
                'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
                'text-size': 12,
              }}
              paint={{
                'text-color': '#ffffff',
              }}
            />

            {/* Individual unclustered points */}
            <Layer
              id="unclustered-point"
              type="circle"
              filter={['!', ['has', 'point_count']]}
              paint={{
                'circle-color': ['case', ['get', 'isLayerHit'], layerHighlightColor, normalSiteColor],
                'circle-radius': [
                  'interpolate',
                  ['exponential', 0.5],
                  ['zoom'],
                  6, interactionState.isDragging ? 1.5 : 2,
                  8, interactionState.isDragging ? 2.5 : 3.5,
                  10, interactionState.isDragging ? 3.5 : 5,
                  12, interactionState.isDragging ? 5 : 7,
                  14, interactionState.isDragging ? 7 : 10,
                  16, interactionState.isDragging ? 9 : 12,
                  18, interactionState.isDragging ? 11 : 14,
                ],
                'circle-stroke-width': 0,
                'circle-opacity': interactionState.isDragging ? 0.88 : 0.96,
              }}
            />
          
            {/* Site ID labels — only rendered at zoom ≥ 12 */}
            <Layer
              id="site-labels"
              type="symbol"
              filter={['!', ['has', 'point_count']]}
              minzoom={13}
              layout={{
                'text-field': ['get', 'siteId'],
                'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
                'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 16, 14],
                'text-offset': [0, -1.8],
                'text-anchor': 'bottom',
                'text-allow-overlap': false,
                'text-optional': true,
                'visibility': showSiteLabels ? 'visible' : 'none',
              }}
              paint={{
                ...(siteLabelPaint as any),
                'text-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 13.5, 1],
              }}
            />
            </Source>

        {/* New Site Provisioning Layer */}
        {showProvisioningLayer && provisioningGeoJSON.features.length > 0 && (
          <Source id="provisioning-candidates" type="geojson" data={provisioningGeoJSON}>
            <Layer
              id="provisioning-candidate-point"
              type="circle"
              paint={{
                'circle-color': '#38bdf8',
                'circle-radius': 7,
                'circle-stroke-width': 2,
                'circle-stroke-color': '#f8fafc',
                'circle-opacity': 0.92,
              }}
            />
            <Layer
              id="provisioning-candidate-label"
              type="symbol"
              layout={{
                'text-field': ['get', 'siteId'],
                'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
                'text-size': 10,
                'text-offset': [0, 1.4],
                'text-anchor': 'top',
                'text-allow-overlap': false,
              }}
              paint={{
                'text-color': theme === 'dark' ? '#93c5fd' : '#1e3a8a',
                'text-halo-color': theme === 'dark' ? '#111827' : '#ffffff',
                'text-halo-width': 1.2,
              }}
            />
          </Source>
        )}

        {/* Recently Provisioned Sites Layer */}
        {showRecentProvisionedLayer && recentProvisionedSectorGeoJSON.features.length > 0 && (
          <Source id="recent-provisioned-sectors" type="geojson" data={recentProvisionedSectorGeoJSON}>
            <Layer
              id="recent-provisioned-sector-fill"
              type="fill"
              paint={{
                'fill-color': '#c026d3',
                'fill-opacity': 0.22,
              }}
            />
            <Layer
              id="recent-provisioned-sector-line"
              type="line"
              paint={{
                'line-color': '#86198f',
                'line-width': 1.5,
                'line-opacity': 0.75,
              }}
            />
          </Source>
        )}
        {showRecentProvisionedLayer && recentProvisionedGeoJSON.features.length > 0 && (
          <Source id="recent-provisioned-sites" type="geojson" data={recentProvisionedGeoJSON}>
            <Layer
              id="recent-provisioned-point"
              type="circle"
              paint={{
                'circle-color': '#d946ef',
                'circle-radius': 7.5,
                'circle-stroke-width': 2.5,
                'circle-stroke-color': '#fdf4ff',
                'circle-opacity': 0.96,
              }}
            />
            <Layer
              id="recent-provisioned-label"
              type="symbol"
              layout={{
                'text-field': ['get', 'siteId'],
                'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
                'text-size': 10,
                'text-offset': [0, 1.35],
                'text-anchor': 'top',
                'text-allow-overlap': false,
              }}
              paint={{
                'text-color': theme === 'dark' ? '#f5d0fe' : '#701a75',
                'text-halo-color': theme === 'dark' ? '#111827' : '#ffffff',
                'text-halo-width': 1.2,
              }}
            />
          </Source>
        )}
        {showRecentProvisionedLayer &&
          resolvedRecentProvisionedSites.map((site) => (
            <Marker
              key={`recent-provisioned-pulse-${site.siteId}`}
              longitude={site.longitude}
              latitude={site.latitude}
              anchor="center"
              style={{ pointerEvents: 'none' }}
            >
              <div className="relative w-0 h-0">
                <div className="recent-provisioned-pulse-ring" />
                <div className="recent-provisioned-pulse-ring" />
                <div className="recent-provisioned-pulse-ring" />
              </div>
            </Marker>
          ))}

        {/* Cell Sector Polygons - Rendered AFTER sites to be BELOW them */}
	        {shouldRenderCellSectors && cellsGeoJSON.features.length > 0 && (
	          <Source id="cells" type="geojson" data={cellsGeoJSON}>
	            {/* Sector fill — glassy/translucent so streets remain visible */}
		            <Layer
		              id="cells-fill"
		              type="fill"
		              beforeId="clusters"
		              minzoom={9}
			              paint={{
			                'fill-color': ['get', 'color'],
			                // Mapbox constraint: only one zoom-based subexpression per expression.
			                // So we interpolate by zoom once, and choose state-specific values per stop.
			                'fill-opacity': [
			                  'interpolate',
			                  ['linear'],
			                  ['zoom'],
			                  9, ['case', ['get', 'isSelected'], 0.18, ['get', 'isLayerHit'], 0.14, 0.11],
			                  12, ['case', ['get', 'isSelected'], 0.24, ['get', 'isLayerHit'], 0.20, 0.16],
			                  16, ['case', ['get', 'isSelected'], 0.20, ['get', 'isLayerHit'], 0.18, 0.14],
			                ],
			              }}
			            />
		            {/* Thin outline to keep edges legible, but still "glassy" */}
		            <Layer
		              id="cells-edge"
		              type="line"
		              beforeId="clusters"
		              minzoom={9}
		              filter={['==', '$type', 'Polygon']}
		              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
		              paint={{
		                'line-color': '#ffffff',
		                'line-width': ['case', ['get', 'isSelected'], 1.1, 0.7],
		                'line-opacity': [
		                  'interpolate',
		                  ['linear'],
		                  ['zoom'],
		                  6, 0.12,
		                  9, 0.20,
		                  12, 0.28,
		                  16, 0.26,
		                ],
		              }}
		            />
		          </Source>
		        )}

        {/* Lines to closest neighbors when a site is selected */}
        {selectedSite && neighborLinesGeoJSON.features.length > 0 && (
          <Source id="neighbor-lines" type="geojson" data={neighborLinesGeoJSON}>
            {/* Main neighbor connection line — Pulse indigo style */}
            <Layer
              id="neighbor-lines-layer"
              type="line"
              paint={{
                'line-color': '#6366f1',
                'line-width': 1.8,
                'line-opacity': neighborLineOpacity * 0.85,
                'line-dasharray': [3, 2],
              }}
            />
            {/* Subtle indigo glow behind the line */}
            <Layer
              id="neighbor-lines-glow"
              type="line"
              paint={{
                'line-color': '#6366f1',
                'line-width': 4,
                'line-opacity': neighborLineOpacity * 0.18,
                'line-blur': 3,
              }}
            />
          </Source>
        )}

        {/* RCA-derived explicit source -> mentioned site lines */}
        {rcaMapOverlay && rcaMapOverlay.lineGeoJSON.features.length > 0 && (
          <Source id="rca-lines" type="geojson" data={rcaMapOverlay.lineGeoJSON}>
            <Layer
              id="rca-lines-layer"
              type="line"
              paint={{
                'line-color': [
                  'match',
                  ['get', 'severity'],
                  'down', '#dc2626',
                  'congestion', '#f59e0b',
                  '#94a3b8',
                ],
                'line-width': 3,
                'line-opacity': 0.95,
                'line-dasharray': [1.2, 1.2],
              }}
            />
          </Source>
        )}

        {/* Local Events overlay — radius circle + event pins.
            Hover reveals a popover (rendered outside <MapGL> via portal). */}
        {eventsLayer.enabled && eventsState.centerLat != null && eventsState.centerLng != null && (
          <EventMapOverlay
            centerLat={eventsState.centerLat}
            centerLng={eventsState.centerLng}
            radiusMiles={eventsLayer.radiusMiles}
            events={filteredEvents}
            hoveredEventId={hoveredEvent.event?.id ?? null}
            selectedEventId={selectedEventId}
            onHover={(event, anchor) => setHoveredEvent({ event, anchor })}
            onMarkerClick={(e) => setSelectedEventId(e.id)}
          />
        )}

        </MapGL>

      {/* ── External Map Layer (MapLibre or Esri) ─────────────────────── */}
      {showExternalMapLayer && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            pointerEvents: 'none',
            opacity: externalMapOpacity,
          }}
        >
          <MapLibre
            ref={mapLibreRef}
            initialViewState={viewState}
            style={{ width: '100%', height: '100%' }}
            mapStyle={
              externalMapProvider === 'esri'
                ? ESRI_MAPLIBRE_STYLE
                : 'https://demotiles.maplibre.org/style.json'
            }
            attributionControl={false}
          />
        </div>
      )}

      {(isLoading || minLoadPending) && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
          {/* Semi-transparent frosted overlay — map tiles visible behind it */}
          <div
            className="absolute inset-0"
            style={{
              background: theme === 'dark'
                ? 'rgba(12,12,14,0.62)'
                : 'rgba(241,245,249,0.68)',
              backdropFilter: 'saturate(0.4) blur(2px)',
              WebkitBackdropFilter: 'saturate(0.4) blur(2px)',
            }}
          />
          {/* Centered loading card */}
          <div className="relative z-10 flex flex-col items-center gap-5 px-6">
            {/* Spinner ring */}
            <div className="relative flex h-16 w-16 items-center justify-center">
              <div
                className="absolute inset-0 rounded-full border-2 border-transparent animate-spin"
                style={{
                  borderTopColor: 'rgb(var(--tenant-accent-rgb))',
                  borderRightColor: 'rgb(var(--tenant-accent-rgb) / 0.4)',
                  animationDuration: '0.9s',
                }}
              />
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full border"
                style={{
                  borderColor: 'rgb(var(--tenant-accent-rgb) / 0.3)',
                  background: 'linear-gradient(135deg, rgb(var(--tenant-accent-soft-rgb) / 0.3) 0%, rgb(var(--tenant-accent-rgb) / 0.15) 100%)',
                }}
              >
                <Loader2 className="h-4 w-4 animate-spin text-tenant-primary" aria-hidden />
              </div>
            </div>
            {/* Title + subtitle */}
            <div className="text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-tenant-primary mb-1.5">
                Naavik Observe
              </p>
              <p className="text-lg font-semibold text-text-primary dark:text-white">
                {sites.length > 0 ? 'Syncing overlays…' : 'Loading network map…'}
              </p>
              <p className="mt-1 text-sm text-text-muted dark:text-slate-400">
                {sites.length > 0
                  ? `${sites.length} sites loaded — applying sector and KPI layers`
                  : 'Fetching site inventory, sectors, and KPI data'}
              </p>
            </div>
            {/* Progress bar */}
            <div className="w-64 overflow-hidden rounded-full bg-slate-200/80 dark:bg-white/10 h-1.5">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: !isLoading && !minLoadPending ? '100%' : sites.length > 0 && cellSectors.length > 0 ? '88%' : sites.length > 0 ? '55%' : '15%',
                  background: 'linear-gradient(90deg, rgb(var(--tenant-accent-rgb)) 0%, rgb(var(--tenant-accent-hover-rgb)) 100%)',
                }}
              />
            </div>
            {/* Stage pills */}
            <div className="flex items-center gap-2 text-[11px]">
              {[
                { label: 'Base map', done: true },
                { label: 'Sites', done: sites.length > 0 },
                { label: 'Sectors', done: cellSectors.length > 0 },
              ].map((stage) => (
                <span
                  key={stage.label}
                  className="rounded-full border px-3 py-1 font-medium"
                  style={{
                    borderColor: stage.done ? 'rgb(var(--tenant-accent-rgb) / 0.5)' : (theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.12)'),
                    backgroundColor: stage.done ? 'rgb(var(--tenant-accent-rgb) / 0.1)' : (theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.6)'),
                    color: stage.done ? 'rgb(var(--tenant-accent-rgb))' : (theme === 'dark' ? 'rgba(148,163,184,0.9)' : '#64748b'),
                  }}
                >
                  {stage.done ? '✓ ' : ''}{stage.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Top-left: Hamburger Menu (always show, search hidden when parent manages controls) */}
      {!hideTopControls && (
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/88 p-2 backdrop-blur-md shadow-[0_12px_28px_rgba(15,23,42,0.10)] dark:border-white/10 dark:bg-black/55 dark:shadow-lg">
        {/* Hamburger - opens Map Settings */}
        <button
          ref={menuTriggerRef}
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="p-2.5 rounded-lg bg-cream-bg dark:bg-white/10 backdrop-blur-sm border border-border dark:border-white/10 hover:bg-white dark:hover:bg-tenant-light/10 transition-all"
          title="Map Settings"
          aria-label="Open map settings"
        >
          <Menu className="w-5 h-5 text-tenant-primary" />
	        </button>
	        {/* Search: icon expands to full input */}
	        <div className="relative">
	        <div className="flex items-center rounded-lg overflow-hidden border border-border dark:border-white/10 bg-cream-bg dark:bg-white/10 backdrop-blur-sm transition-all duration-200">
	          {isSearchExpanded ? (
	            <div className="flex items-center gap-2 pl-3 pr-2 py-2 min-w-[240px] max-w-[320px]">
	              <Search className="w-4 h-4 text-tenant-primary flex-shrink-0" />
	              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const q = searchQuery.trim().toLowerCase();
                    const match = sites.find(
                      (s) =>
                        s.siteId.toLowerCase().includes(q) ||
                        s.siteName.toLowerCase().includes(q) ||
                        (s.realSiteId || '').toLowerCase().includes(q)
                    );
	                    if (match) {
	                      const map = mapRef.current?.getMap?.();
	                      map?.easeTo({ center: [match.longitude, match.latitude], zoom: Math.max(map?.getZoom?.() ?? 0, 14), duration: 650 });
	                      setViewState((prev) => ({ ...prev, longitude: match.longitude, latitude: match.latitude, zoom: Math.max(prev.zoom, 14) }));
	                      setSelectedSite(match);
	                      prefetchSiteKpis(match.siteId, selectedDateId);
	                    }
                    (e.target as HTMLInputElement).blur();
                  }
                  if (e.key === 'Escape') {
                    setIsSearchExpanded(false);
                    setSearchQuery('');
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder="Search by Site ID or site name..."
                className="flex-1 min-w-0 bg-transparent text-sm text-text-primary dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none"
                autoFocus
              />
              <button
                onClick={() => {
                  setIsSearchExpanded(false);
                  setSearchQuery('');
                }}
                className="p-1 rounded hover:bg-tenant-light/45 dark:hover:bg-tenant-light/10 text-tenant-primary"
                aria-label="Close search"
              >
                <X className="w-4 h-4" />
	              </button>
	            </div>
	          ) : (
	            <button
	              onClick={() => setIsSearchExpanded(true)}
	              className="p-3 text-tenant-primary transition-colors hover:bg-tenant-light/35 dark:hover:bg-tenant-light/10"
	              title="Search by Site ID or site name"
	            >
	              <Search className="w-5 h-5" />
	            </button>
	          )}
	        </div>
	        {isSearchExpanded && (
	          <div
	            className="absolute left-0 top-full mt-2 w-[360px] max-w-[90vw] overflow-hidden rounded-2xl border shadow-2xl"
	            style={{
	              borderColor: theme === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.12)',
	              background: theme === 'dark' ? 'rgba(17,17,19,0.86)' : 'rgba(255,255,255,0.92)',
	              backdropFilter: 'blur(18px)',
	            }}
	          >
	            <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)' }}>
	              <label className="flex items-center gap-2 text-[12px]" style={{ color: theme === 'dark' ? 'rgba(226,232,240,0.9)' : 'rgba(15,23,42,0.75)' }}>
	                <input
	                  type="checkbox"
	                  checked={searchOffendersOnly}
	                  onChange={(e) => setSearchOffendersOnly(e.target.checked)}
	                  className="h-4 w-4 accent-[rgb(var(--tenant-accent-rgb))]"
	                />
	                Show Offenders Only
	              </label>
	              <span className="text-[11px] font-mono" style={{ color: theme === 'dark' ? 'rgba(148,163,184,0.9)' : 'rgba(100,116,139,0.9)' }}>
	                {searchResults.length} shown
	              </span>
	            </div>
	            <div className="max-h-[360px] overflow-auto">
	              {searchResults.length === 0 ? (
	                <div className="px-3 py-4 text-[12px]" style={{ color: theme === 'dark' ? 'rgba(148,163,184,0.9)' : 'rgba(100,116,139,0.9)' }}>
	                  {searchQuery.trim() ? 'No matching sites' : 'No offenders found for this date'}
	                </div>
	              ) : (
	                searchResults.map((s) => {
	                  const isOff = offenderSiteIds.has(s.siteId) || offenderSiteIds.has(s.realSiteId || '');
	                  const nodes = nodesByUsid.get(s.realSiteId || s.siteId) || [];
	                  const nodeLabel = nodes.length > 0 ? `${nodes[0]}${nodes.length > 1 ? ` +${nodes.length - 1}` : ''}` : '';
	                  return (
	                    <button
	                      key={`search-hit-${s.siteId}`}
	                      type="button"
	                      onClick={() => {
	                        const map = mapRef.current?.getMap?.();
	                        map?.easeTo({ center: [s.longitude, s.latitude], zoom: Math.max(map?.getZoom?.() ?? 0, 14), duration: 650 });
	                        setViewState((prev) => ({ ...prev, longitude: s.longitude, latitude: s.latitude, zoom: Math.max(prev.zoom, 14) }));
	                        setSelectedSite(s);
	                        prefetchSiteKpis(s.siteId, selectedDateId);
	                      }}
	                      className="w-full px-3 py-2.5 text-left border-b last:border-b-0 transition-colors hover:bg-white/10"
	                      style={{ borderColor: theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)' }}
	                    >
	                      <div className="flex items-center gap-3">
	                        <span
	                          className="flex h-7 w-7 items-center justify-center rounded-lg border"
	                          style={{
	                            borderColor: isOff ? 'rgba(239,68,68,0.35)' : (theme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.12)'),
	                            background: isOff ? 'rgba(239,68,68,0.12)' : (theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.04)'),
	                            color: isOff ? '#ef4444' : (theme === 'dark' ? 'rgba(226,232,240,0.85)' : 'rgba(15,23,42,0.75)'),
	                          }}
	                          aria-hidden
	                        >
	                          {isOff ? '⚡' : '•'}
	                        </span>
	                        <div className="min-w-0 flex-1">
	                          <div className="flex items-center gap-2 min-w-0">
	                            <span className="truncate text-[13px] font-semibold" style={{ color: theme === 'dark' ? 'rgba(248,250,252,0.96)' : 'rgba(15,23,42,0.92)' }}>
	                              {dId(s.realSiteId || s.siteId)}
	                            </span>
	                            {nodeLabel ? (
	                              <span className="truncate text-[12px]" style={{ color: theme === 'dark' ? 'rgba(148,163,184,0.95)' : 'rgba(100,116,139,0.95)' }}>
	                                {nodeLabel}
	                              </span>
	                            ) : null}
	                          </div>
	                          <div className="truncate text-[11px]" style={{ color: theme === 'dark' ? 'rgba(148,163,184,0.9)' : 'rgba(100,116,139,0.9)' }}>
	                            {s.siteName}
	                          </div>
	                        </div>
	                      </div>
	                    </button>
	                  );
	                })
	              )}
	            </div>
	          </div>
	        )}
	        </div>
	      </div>
	      )}

      {/* Hamburger Menu (shown when parent hides top controls) */}
      {hideTopControls && (
        <button
          ref={menuTriggerRef}
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="absolute top-4 left-4 z-20 p-2 rounded-lg bg-white/88 dark:bg-white/10 backdrop-blur-sm border border-border dark:border-white/10 hover:bg-white dark:hover:bg-tenant-light/10 transition-all shadow-[0_12px_28px_rgba(15,23,42,0.10)] dark:shadow-none"
          title="Map Settings"
          aria-label="Open map settings"
        >
          <Menu className="w-4 h-4 text-tenant-primary" />
        </button>
      )}

      {/* Site Info Panel (hidden when hideSitePanel for split-screen dashboard) */}
      {selectedSite && !hideSitePanel && (
        <div className="absolute bottom-24 left-4 right-4 sm:left-auto sm:right-4 sm:top-16 sm:w-80 rounded-lg border border-border bg-white/96 p-4 shadow-xl z-10 animate-slide-in dark:border-pulse-border dark:bg-pulse-surface">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-lg font-bold text-text-primary dark:text-text-primary">
                {selectedSite.siteName}
              </h3>
              {String(selectedSite.siteName || '').trim().toUpperCase() !== String(selectedSite.siteId || '').trim().toUpperCase() && (
                <p className="text-xs text-text-secondary dark:text-text-secondary">
                  {dId(selectedSite.siteId)}
                </p>
              )}
            </div>
            <button
              onClick={() => setSelectedSite(null)}
              className="text-text-secondary dark:text-text-secondary hover:text-text-primary dark:hover:text-text-primary text-xl leading-none"
            >
              ×
            </button>
          </div>

          {(() => {
            const d = degradedDisplay;
            const status = d?.status ?? selectedSite.status;
            const cellCount = d?.cellCount ?? selectedSite.cellCount;
            const anomalyCount = d?.anomalyCount ?? selectedSite.anomalyCount;
            const hasActiveTickets = d?.hasActiveTickets ?? selectedSite.hasActiveTickets;
            return (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text-secondary dark:text-text-secondary">Status</span>
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  status === 'NORMAL'
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                    : status === 'WARNING'
                    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                    : status === 'DEGRADED' || status === 'CRITICAL'
                    ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                    : 'bg-red-200 dark:bg-red-800/40 text-red-800 dark:text-red-300'
                }`}
              >
                {status}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary dark:text-text-secondary">Cells</span>
              <span className="text-text-primary dark:text-text-primary font-medium">
                {cellCount}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary dark:text-text-secondary">Anomalies</span>
              <span className="text-text-primary dark:text-text-primary font-medium">
                {anomalyCount}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary dark:text-text-secondary">Active Tickets</span>
              <span className={`font-medium ${hasActiveTickets ? 'text-red-500' : 'text-green-500'}`}>
                {hasActiveTickets ? 'Yes' : 'No'}
              </span>
            </div>
            {/* Cell-level list intentionally hidden; panel shows high-level site metrics only */}
          </div>
            );
          })()}
        </div>
      )}

      {/* Map Settings Panel - opens from hamburger, slides in from left below toolbar */}
      <div
        ref={menuPanelRef}
        className={`absolute top-20 left-4 w-[26rem] max-h-[calc(100vh-10rem)] bg-white/95 dark:bg-black/80 backdrop-blur-xl border border-gray-200/40 dark:border-white/10 rounded-2xl shadow-2xl z-30 transition-all duration-300 ${
          isMenuOpen ? 'translate-x-0 opacity-100' : '-translate-x-[420px] opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex flex-col max-h-[calc(100vh-10rem)]">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200/30 dark:border-pulse-border">
            <h3 className="text-lg font-bold text-tenant-primary">
              Map Settings
            </h3>
            <button
              onClick={() => setIsMenuOpen(false)}
              className="p-2 rounded-lg hover:bg-gray-200/50 dark:hover:bg-pulse-surface-light text-text-secondary dark:text-gray-400"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-200/30 dark:border-pulse-border">
            {(['filters', 'layers', 'mapOptions', 'mapType'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setMapSettingsTab(tab)}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  mapSettingsTab === tab
                    ? 'text-tenant-primary border-b-2 border-tenant-primary'
                    : 'text-text-secondary dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {tab === 'filters' ? 'Filters' : tab === 'layers' ? 'Layers' : tab === 'mapOptions' ? 'Map Options' : 'Map Type'}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {mapSettingsTab === 'filters' && (
              <>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-text-primary dark:text-white">DATE</label>
                  <input
                    type="date"
                    value={selectedDateId}
                    max={maxAllowedDate}
                    onChange={(e) => setSelectedDateId(clampDateToMax(e.target.value, maxAllowedDate))}
                    className="w-full px-3 py-2 rounded-lg bg-cream-surface-light dark:bg-pulse-surface-light border border-border dark:border-pulse-border text-sm text-text-primary dark:text-white"
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-text-muted dark:text-gray-400">
                    Site highlights and KPI windows are filtered to this date.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-cream-surface-light dark:bg-pulse-surface-light p-4 border border-gray-200/50 dark:border-pulse-border">
                    <div className="text-2xl font-bold text-text-primary dark:text-white">{sites.length.toLocaleString()}</div>
                    <div className="text-xs text-text-secondary dark:text-gray-400">SITES</div>
                  </div>
                  <div className="rounded-xl bg-red-500/20 dark:bg-red-900/30 p-4 border border-red-500/30 dark:border-red-500/20">
                    <div className="text-2xl font-bold text-red-700 dark:text-red-400">{effectiveLayerSiteIds.size.toLocaleString()}</div>
                    <div className="text-xs text-red-600 dark:text-red-400">
                      {activeSiteLayer === 'degraded' ? 'DEGRADED' : activeSiteLayer === 'outage' ? 'OUTAGE SITES' : activeSiteLayer === 'overutilized' ? 'OVERUTILIZED SITES' : 'HIGHLIGHTED'}
                    </div>
                  </div>
                </div>
              </>
            )}

            {mapSettingsTab === 'layers' && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-text-primary dark:text-white">Map Layers</label>
                  <button
                    onClick={() => setActiveSiteLayer(activeSiteLayer === 'outage' ? null : 'outage')}
                    className={`w-full flex items-center justify-between p-3 rounded-lg transition-all ${
                      activeSiteLayer === 'outage'
                        ? 'bg-cream-surface-light dark:bg-slate-700/50 border border-slate-400/50'
                        : 'bg-cream-surface-light dark:bg-pulse-surface-light hover:bg-gray-200 dark:hover:bg-pulse-border'
                    }`}
                  >
                    <span className="text-sm text-text-primary dark:text-white">Show Sites with Outages</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${activeSiteLayer === 'outage' ? 'bg-slate-600 text-white' : 'bg-gray-300 dark:bg-gray-600 text-text-secondary dark:text-gray-300'}`}>
                      {activeSiteLayer === 'outage' ? 'ON' : 'OFF'}
                    </span>
                  </button>
                  <button
                    onClick={() => setActiveSiteLayer(activeSiteLayer === 'overutilized' ? null : 'overutilized')}
                    className={`w-full flex items-center justify-between p-3 rounded-lg transition-all ${
                      activeSiteLayer === 'overutilized'
                        ? 'bg-orange-100 dark:bg-orange-900/30 border border-orange-400/50'
                        : 'bg-cream-surface-light dark:bg-pulse-surface-light hover:bg-gray-200 dark:hover:bg-pulse-border'
                    }`}
                  >
                    <span className="text-sm text-text-primary dark:text-white">Show Overutilized Cells</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${activeSiteLayer === 'overutilized' ? 'bg-orange-500 text-white' : 'bg-gray-300 dark:bg-gray-600 text-text-secondary dark:text-gray-300'}`}>
                      {activeSiteLayer === 'overutilized' ? 'ON' : 'OFF'}
                    </span>
                  </button>
                  <button
                    onClick={() => setActiveSiteLayer(activeSiteLayer === 'degraded' ? null : 'degraded')}
                    className={`w-full flex items-center justify-between p-3 rounded-lg transition-all ${
                      activeSiteLayer === 'degraded'
                        ? 'bg-red-100 dark:bg-red-900/30 border border-red-400/50'
                        : 'bg-cream-surface-light dark:bg-pulse-surface-light hover:bg-gray-200 dark:hover:bg-pulse-border'
                    }`}
                  >
                    <span className="text-sm text-text-primary dark:text-white">Degraded Sites</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${activeSiteLayer === 'degraded' ? 'bg-red-600 text-white' : 'bg-gray-300 dark:bg-gray-600 text-text-secondary dark:text-gray-300'}`}>
                      {activeSiteLayer === 'degraded' ? 'ON' : 'OFF'}
                    </span>
                  </button>
                  <button
                    onClick={() =>
                      setShowProvisioningLayer((prev) => {
                        const next = !prev;
                        if (next) setProvisioningQuarterFilter('Q1');
                        return next;
                      })
                    }
                    className={`w-full flex items-center justify-between p-3 rounded-lg transition-all ${
                      showProvisioningLayer
                        ? 'bg-tenant-light/80 border border-tenant-primary/35'
                        : 'bg-cream-surface-light dark:bg-pulse-surface-light hover:bg-gray-200 dark:hover:bg-pulse-border'
                    }`}
                  >
                    <span className="text-sm text-text-primary dark:text-white">Planned Sites (Provisioning)</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${showProvisioningLayer ? 'bg-ui-btn text-ui-btn-fg' : 'bg-gray-300 dark:bg-gray-600 text-text-secondary dark:text-gray-300'}`}>
                      {showProvisioningLayer ? 'ON' : 'OFF'}
                    </span>
                  </button>
                  <button
                    onClick={() => setShowRecentProvisionedLayer((prev) => !prev)}
                    className={`w-full flex items-center justify-between p-3 rounded-lg transition-all ${
                      showRecentProvisionedLayer
                        ? 'bg-cyan-100 dark:bg-fuchsia-900/30 border border-fuchsia-400/50'
                        : 'bg-cream-surface-light dark:bg-pulse-surface-light hover:bg-gray-200 dark:hover:bg-pulse-border'
                    }`}
                  >
                    <span className="text-sm text-text-primary dark:text-white">Recently Provisioned Sites</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${showRecentProvisionedLayer ? 'bg-cyan-600 text-white' : 'bg-gray-300 dark:bg-gray-600 text-text-secondary dark:text-gray-300'}`}>
                      {showRecentProvisionedLayer ? 'ON' : 'OFF'}
                    </span>
                  </button>
                  <button
                    onClick={() => { const next = !eventsLayer.enabled; setEventsLayer((prev) => ({ ...prev, enabled: next })); setEventsLayerEnabled(next); }}
                    className={`w-full flex items-center justify-between p-3 rounded-lg transition-all ${
                      eventsLayer.enabled
                        ? 'bg-indigo-100 dark:bg-indigo-900/30 border border-indigo-400/50'
                        : 'bg-cream-surface-light dark:bg-pulse-surface-light hover:bg-gray-200 dark:hover:bg-pulse-border'
                    }`}
                    title="Toggle local events overlay"
                  >
                    <div className="flex flex-col items-start">
                      <span className="text-sm text-text-primary dark:text-white">Local Events</span>
                      <span className="text-[10px] text-text-muted dark:text-gray-400">
                        Concerts, sports, weather, news within {eventsLayer.radiusMiles} mi
                      </span>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${eventsLayer.enabled ? 'bg-indigo-600 text-white' : 'bg-gray-300 dark:bg-gray-600 text-text-secondary dark:text-gray-300'}`}>
                      {eventsLayer.enabled ? 'ON' : 'OFF'}
                    </span>
                  </button>
                  {/* ── External Map Layer ─────────────────────────────── */}
                  <button
                    onClick={() => setShowExternalMapLayer(!showExternalMapLayer)}
                    className={`w-full flex items-center justify-between p-3 rounded-lg transition-all ${
                      showExternalMapLayer
                        ? 'bg-indigo-100 dark:bg-indigo-900/30 border border-indigo-400/50'
                        : 'bg-cream-surface-light dark:bg-pulse-surface-light hover:bg-gray-200 dark:hover:bg-pulse-border'
                    }`}
                  >
                    <span className="text-sm text-text-primary dark:text-white">External Map Layer</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${showExternalMapLayer ? 'bg-indigo-600 text-white' : 'bg-gray-300 dark:bg-gray-600 text-text-secondary dark:text-gray-300'}`}>
                      {showExternalMapLayer ? 'ON' : 'OFF'}
                    </span>
                  </button>
                  {showExternalMapLayer && (
                    <div className="space-y-2 px-1 pb-1">
                      {/* Provider picker */}
                      <div>
                        <p className="text-xs text-text-muted dark:text-gray-400 mb-1.5">Provider</p>
                        <div className="flex gap-2">
                          {(['maplibre', 'esri'] as ExternalMapProvider[]).map((p) => (
                            <button
                              key={p}
                              onClick={() => setExternalMapProvider(p)}
                              className={`flex-1 py-1.5 rounded-md text-xs font-semibold capitalize transition-all border ${
                                externalMapProvider === p
                                  ? 'bg-indigo-600 text-white border-indigo-600'
                                  : 'bg-transparent text-text-secondary dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300'
                              }`}
                            >
                              {p === 'maplibre' ? 'MapLibre' : 'Esri'}
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-text-muted dark:text-gray-500 mt-1">
                          {externalMapProvider === 'esri'
                            ? 'Esri World Street Map · ArcGIS tile service'
                            : 'MapLibre demo tiles · OpenStreetMap-based'}
                        </p>
                      </div>
                      {/* Opacity slider */}
                      <div>
                        <label className="flex justify-between text-xs text-text-muted dark:text-gray-400 mb-1">
                          <span>Overlay Opacity</span>
                          <span>{Math.round(externalMapOpacity * 100)}%</span>
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={externalMapOpacity}
                          onChange={(e) => setExternalMapOpacity(parseFloat(e.target.value))}
                          className="w-full accent-indigo-600"
                        />
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => setShowLegend(!showLegend)}
                    className="w-full flex items-center justify-between p-3 rounded-lg bg-cream-surface-light dark:bg-pulse-surface-light hover:bg-gray-200 dark:hover:bg-pulse-border transition-all"
                  >
                    <span className="text-sm text-text-primary dark:text-white">Legend</span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${showLegend ? 'bg-ui-btn text-ui-btn-fg' : 'bg-gray-300 dark:bg-gray-600 text-text-secondary dark:text-gray-300'}`}>
                      {showLegend ? 'ON' : 'OFF'}
                    </span>
                  </button>
                </div>
                {showProvisioningLayer ? (
                  <div className="space-y-2 pt-3 border-t border-gray-200/30 dark:border-white/10">
                    <label className="text-sm font-semibold text-text-primary dark:text-white">Provisioning Quarter</label>
                    <div className="flex flex-wrap gap-2">
                      {(['ALL', 'Q1', 'Q2', 'Q3', 'Q4'] as const).map((q) => (
                        <button
                          key={q}
                          onClick={() => setProvisioningQuarterFilter(q)}
                          className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
                            provisioningQuarterFilter === q
                              ? 'bg-ui-btn text-ui-btn-fg'
                              : 'bg-cream-surface-light dark:bg-gray-700 text-text-secondary dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                          }`}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-text-muted dark:text-gray-400">
                      Showing top 3% planned candidates per quarter.
                    </p>
                  </div>
                ) : null}
              </>
            )}

            {mapSettingsTab === 'mapOptions' && (
              <div className="space-y-3">
                {/* Site labels toggle */}
                <button
                  onClick={() => setShowSiteLabels((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all"
                  style={{
                    borderColor: showSiteLabels ? 'rgba(99,102,241,0.5)' : 'rgba(156,163,175,0.3)',
                    background: showSiteLabels ? 'rgba(99,102,241,0.10)' : 'transparent',
                  }}
                >
                  <div className="text-left">
                    <div className="text-sm font-semibold text-text-primary dark:text-white">Site labels</div>
                    <div className="text-[11px] text-text-muted dark:text-gray-400">Show USID at zoom ≥ 13</div>
                  </div>
                  <div className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${showSiteLabels ? 'bg-cyan-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-cream-surface shadow transition-transform ${showSiteLabels ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                </button>

                {/* Auto-size toggle */}
                <button
                  onClick={() => setAutoSizeSectors((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-all"
                  style={{
                    borderColor: autoSizeSectors ? 'rgba(99,102,241,0.5)' : 'rgba(156,163,175,0.3)',
                    background: autoSizeSectors ? 'rgba(99,102,241,0.10)' : 'transparent',
                  }}
                >
                  <div className="text-left">
                    <div className="text-sm font-semibold text-text-primary dark:text-white">Auto-size sectors</div>
                    <div className="text-[11px] text-text-muted dark:text-gray-400">Scale by nearest-neighbor distance</div>
                  </div>
                  <div className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${autoSizeSectors ? 'bg-cyan-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-cream-surface shadow transition-transform ${autoSizeSectors ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </div>
                </button>

                {/* Manual slider — dimmed when auto-size is on */}
                <div className={autoSizeSectors ? 'opacity-40 pointer-events-none' : ''}>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-semibold text-text-primary dark:text-white">Sector Size</label>
                    <span className="text-xs font-mono text-text-secondary dark:text-gray-400 bg-cream-surface-light dark:bg-pulse-surface-light px-2.5 py-1 rounded">{sectorRadiusMeters}m</span>
                  </div>
                  <input
                    type="range"
                    min="25"
                    max="2000"
                    step="25"
                    value={sectorRadiusMeters}
                    onChange={(e) => setSectorRadiusMeters(parseInt(e.target.value))}
                    className="w-full h-2 bg-cream-surface-light dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    style={{ accentColor: 'rgb(var(--tenant-accent-rgb))' }}
                  />
                  <div className="flex justify-between gap-2 mt-2">
                    <button onClick={() => setSectorRadiusMeters(25)} className="px-2 py-1 rounded text-xs border border-border dark:border-white/20 hover:bg-tenant-light/60 dark:hover:bg-tenant-light/10">25m</button>
                    <button onClick={() => setSectorRadiusMeters(125)} className="px-2 py-1 rounded text-xs border border-border dark:border-white/20 hover:bg-tenant-light/60 dark:hover:bg-tenant-light/10">125m</button>
                    <button onClick={() => setSectorRadiusMeters(2000)} className="px-2 py-1 rounded text-xs border border-border dark:border-white/20 hover:bg-tenant-light/60 dark:hover:bg-tenant-light/10">2km</button>
                  </div>
                </div>
              </div>
            )}

            {mapSettingsTab === 'mapType' && (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {MAP_STYLES.map((opt) => {
                  const effectiveSelected = mapStyleId ?? 'auto';
                  const isSelected = effectiveSelected === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setMapStyleId(opt.id === 'auto' ? null : opt.id)}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-all ${
                        isSelected
                          ? 'bg-tenant-light/80 border border-tenant-primary/35 ring-1 ring-tenant-primary/20'
                          : 'bg-cream-surface-light dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-transparent'
                      }`}
                    >
                      <span
                        className="w-8 h-8 rounded flex-shrink-0 border border-border dark:border-white/20"
                        style={{ backgroundColor: opt.swatch }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-text-primary dark:text-white">{opt.label}</div>
                        <div className="text-[10px] text-text-muted dark:text-gray-400 truncate">{opt.desc}</div>
                      </div>
                      {isSelected && (
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-tenant-primary flex items-center justify-center">
                          <Check className="w-3 h-3 text-white" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Legend & Stats - Conditionally Visible */}
      {showLegend && (
        <div className="absolute bottom-4 left-4 rounded-lg border border-border bg-white/94 p-3 text-xs z-10 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-text-primary dark:text-text-primary">
                {sitesGeoJSON.features.length.toLocaleString()} Sites with Sectors
              </div>
              {isCacheValid(selectedDateId) && sites.length > 0 && (
                <div className="flex items-center text-green-600 dark:text-green-400" title="Data loaded from cache">
                  <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-[10px]">Cached</span>
                </div>
              )}
            </div>
            <div className="text-[10px] text-text-muted dark:text-text-muted mb-2">
              Zoom: {viewState.zoom.toFixed(1)} {viewState.zoom <= 8 ? '(Clustered)' : '(Individual Sites)'}
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-text-primary dark:text-text-primary">Normal Sites</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: layerHighlightColor }} />
              <span className="text-text-primary dark:text-text-primary">
                {activeSiteLayer === 'degraded' ? 'Degraded Sites (blinking)' : activeSiteLayer === 'outage' ? 'Outage Sites' : activeSiteLayer === 'overutilized' ? 'Overutilized Sites' : 'Highlighted Sites'}
              </span>
            </div>
            {showProvisioningLayer && (
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-full bg-tenant-primary" />
                <span className="text-text-primary dark:text-text-primary">Provisioning Candidate</span>
              </div>
            )}
            {showRecentProvisionedLayer && (
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-full bg-cyan-500" />
                <span className="text-text-primary dark:text-text-primary">Recently Provisioned (radiating)</span>
              </div>
            )}
            {viewState.zoom >= 9 && cellSectors.length > 0 && (
              <div className="pt-2 mt-2 border-t border-slate-700 dark:border-slate-700 text-[10px] text-text-muted dark:text-text-muted">
                {cellSectors.length.toLocaleString()} cell sectors shown
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hover Tooltip for ClusterID */}
            {hoverInfo && (
                <div
                    className="absolute pointer-events-none z-50 bg-black/90 text-white px-3 py-2 rounded-lg text-sm shadow-lg"
                    style={{
                        left: hoverInfo.x + 10,
                        top: hoverInfo.y + 10,
                    }}
                >
                  <div className="font-semibold">{dId(hoverInfo.siteId)}</div>
                    {String(hoverInfo.siteName || '').trim().toUpperCase() !== String(hoverInfo.siteId || '').trim().toUpperCase() && (
                      <div className="text-xs text-text-muted">{hoverInfo.siteName}</div>
                    )}
                    {/* Cluster ID hidden from hover tooltip for privacy */}
                </div>
            )}

      {/* Provisioning hover card */}
      {provisioningHover && (
        <div
          className="absolute z-50 bg-white/95 dark:bg-black/80 border border-gray-200/60 dark:border-white/10 rounded-xl shadow-2xl p-3 w-72"
          style={{
            left: Math.min(provisioningHover.x + 12, window.innerWidth - 320),
            top: Math.max(16, provisioningHover.y - 10),
          }}
          onMouseEnter={() => {
            isHoverCardActiveRef.current = true;
            cancelProvisioningHoverHide();
          }}
          onMouseLeave={() => {
            isHoverCardActiveRef.current = false;
            setProvisioningHover(null);
          }}
        >
          <div className="text-sm font-semibold text-text-primary dark:text-white">{dId(provisioningHover.site.siteId)}</div>
          {String(provisioningHover.site.siteName || '').trim().toUpperCase() !== String(provisioningHover.site.siteId || '').trim().toUpperCase() && (
            <div className="text-xs text-text-muted dark:text-gray-400 mb-2">{provisioningHover.site.siteName}</div>
          )}
          <div className="space-y-1 text-xs text-text-secondary dark:text-gray-300 mb-3">
            <div>On-air quarter: <span className="font-medium">{provisioningHover.site.quarter}</span></div>
            <div>Reason: <span className="font-medium">{provisioningMetadata.get(provisioningHover.site.siteId)?.reason || 'Capacity expansion'}</span></div>
            <div>OEM: <span className="font-medium">{provisioningHover.site.oem}</span></div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onProvisioningSiteSelected?.(provisioningHover.site)}
              className="flex-1 px-2.5 py-2 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 transition"
            >
              Provision via Control Agent
            </button>
            <button
              onClick={() => handleQueueProvisioningSite(provisioningHover.site)}
              className="px-2.5 py-2 text-xs rounded-lg border border-border dark:border-white/20 hover:bg-gray-100 dark:hover:bg-white/10 transition"
            >
              Add to Queue
            </button>
          </div>
        </div>
      )}

      {/* Recently provisioned site action menu */}
      {recentProvisionedMenu && (
        <div
          className="absolute z-50 bg-white/95 dark:bg-black/80 border border-gray-200/60 dark:border-white/10 rounded-xl shadow-2xl p-3 w-72"
          style={{
            left: Math.min(recentProvisionedMenu.x + 12, window.innerWidth - 320),
            top: Math.max(16, recentProvisionedMenu.y - 10),
          }}
        >
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <div className="text-sm font-semibold text-text-primary dark:text-white">{dId(recentProvisionedMenu.site.siteId)}</div>
              {String(recentProvisionedMenu.site.siteName || '').trim().toUpperCase() !== String(recentProvisionedMenu.site.siteId || '').trim().toUpperCase() && (
                <div className="text-xs text-text-muted dark:text-gray-400">{recentProvisionedMenu.site.siteName}</div>
              )}
            </div>
            <button
              onClick={() => setRecentProvisionedMenu(null)}
              className="text-text-muted dark:text-gray-400 hover:text-gray-700 dark:hover:text-white"
              aria-label="Close menu"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-1 text-xs text-text-secondary dark:text-gray-300 mb-3">
            <div>Quarter: <span className="font-medium">{recentProvisionedMenu.site.quarter || 'Q1'}</span></div>
            <div>Status: <span className="font-medium">{recentProvisionedMenu.site.status || 'Provisioned'}</span></div>
            <div>Technology: <span className="font-medium">{recentProvisionedMenu.site.technology || '4G+5G'}</span></div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => {
                setQueueNotice(`Control Agent: Optimize area initiated for ${recentProvisionedMenu.site.siteId}`);
                setRecentProvisionedMenu(null);
              }}
              className="px-2 py-2 text-[11px] rounded-lg bg-ui-btn text-ui-btn-fg hover:bg-ui-btn-hover transition"
            >
              Optimize area
            </button>
            <button
              onClick={() => {
                setQueueNotice(`Control Agent: Restart initiated for ${recentProvisionedMenu.site.siteId}`);
                setRecentProvisionedMenu(null);
              }}
              className="px-2 py-2 text-[11px] rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition"
            >
              Restart
            </button>
            <button
              onClick={() => {
                setQueueNotice(`Control Agent: Re-provision initiated for ${recentProvisionedMenu.site.siteId}`);
                setRecentProvisionedMenu(null);
              }}
              className="px-2 py-2 text-[11px] rounded-lg bg-cyan-600 text-white hover:bg-fuchsia-700 transition"
            >
              Re-provision
            </button>
          </div>
        </div>
      )}

      {queueNotice && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 px-3 py-2 rounded-lg bg-gray-900/90 text-white text-xs shadow-xl">
          {queueNotice}
        </div>
      )}

      {/* Local Events compact control — sits just above the zoom buttons in
          the top-right corner of the map. Replaces the old docked side panel
          (which was overlapping the right-hand context info). */}
      {eventsLayer.enabled && (
        <div className="absolute right-3 top-4 z-30 flex flex-col items-end gap-2">
          <EventsLayerControl
            state={eventsLayer}
            onChange={setEventsLayer}
            selectedSiteLabel={selectedSite ? `USID ${dId(selectedSite.realSiteId ?? selectedSite.siteId)}` : null}
            loading={eventsState.loading}
            totalEvents={eventsState.events.length}
            filteredEvents={filteredEvents.length}
          />
        </div>
      )}

      {/* Hover popover (portal-mounted to body, so the map's overflow can't
          clip it and it floats over any side panels). */}
      <EventDetailPopover event={hoveredEvent.event} anchor={hoveredEvent.anchor} />
    </div>
  );
}
