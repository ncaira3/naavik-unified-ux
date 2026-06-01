import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { localCache } from '../services/localCache';
import api from '../services/api';
import { useDummifier } from './DummifierContext';

/**
 * Dates to warm the in-memory + IndexedDB cache for on provider mount.
 * These are the days we demo from; preloading avoids the spinner on first visit.
 */
const PRELOAD_DATE_IDS: string[] = ['2026-04-15', '2026-04-16', '2026-04-17'];

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

interface MapSite {
  siteId: string;
  realSiteId?: string;
  siteName: string;
  latitude: number;
  longitude: number;
  cellCount: number;
  status: 'NORMAL' | 'WARNING' | 'CRITICAL' | 'OUTAGE';
  anomalyCount: number;
  hasActiveTickets: boolean;
}

interface Cell {
  CellID: string;
  CellName: string;
  SiteID: string;
  Technology: string;
  Azimuth?: number;
  AnomalyFlag: boolean;
  AnomalyScore: number;
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

type MapCacheEntry = {
  dateId: string;
  fetchedAt: number;
  sites: MapSite[];
  siteCells: Map<string, Cell[]>;
  cellSectors: CellSector[];
  offenderSiteIds: Set<string>;
};

/** Chat-driven tab navigation request for ObserveSiteAnalysisTile */
export interface ChatTabRequest {
  topTab?: 'site-kpi' | 'rca' | 'operational' | 'topology';
  kpiTab?: 'cqx' | 'daily' | 'hourly' | 'overlay' | 'traffic-profile' | 'mobility' | 'outages';
  rcaSubTab?: 'evidences' | 'summary' | 'raw-data';
  viewMode?: 'summary' | 'diagnostic';
  /** Monotonically increasing timestamp — change triggers the effect even if tabs are the same */
  ts: number;
}

interface MapDataContextType {
  sites: MapSite[];
  setSites: (sites: MapSite[]) => void;
  siteCells: Map<string, Cell[]>;
  setSiteCells: (cells: Map<string, Cell[]>) => void;
  cellSectors: CellSector[];
  setCellSectors: (sectors: CellSector[]) => void;
  dataDateId: string;
  lastFetchTime: number | null;
  isCacheValid: (dateId?: string) => boolean;
  primeFromCache: (dateId: string) => boolean;
  offenderSiteIds: Set<string>;
  setOffenderSiteIds: (ids: Set<string>) => void;
  selectedDateId: string;
  setSelectedDateId: (dateId: string) => void;
  activeSiteLayer: 'degraded' | 'outage' | 'overutilized' | null;
  setActiveSiteLayer: (layer: 'degraded' | 'outage' | 'overutilized' | null) => void;
  /** Optional UI focus requested by chat/commands (USID, USTxxxx, or site token) */
  focusSiteToken: string | null;
  setFocusSiteToken: (token: string | null) => void;
  /** Site IDs to highlight on the map from a chat RCA command */
  chatHighlightSiteIds: Set<string>;
  setChatHighlightSiteIds: (ids: Set<string>) => void;
  /** Pending tab navigation request from chat */
  chatTabRequest: ChatTabRequest | null;
  dispatchTabRequest: (req: Omit<ChatTabRequest, 'ts'>) => void;
  /** Events layer (concerts, weather, news) on/off — shared so chat can toggle it */
  eventsLayerEnabled: boolean;
  setEventsLayerEnabled: (enabled: boolean) => void;
  /** External base-map overlay (MapLibre / Esri) on/off */
  externalMapLayerEnabled: boolean;
  setExternalMapLayerEnabled: (enabled: boolean) => void;
  /** Which external map provider is active */
  externalMapProvider: 'maplibre' | 'esri';
  setExternalMapProvider: (provider: 'maplibre' | 'esri') => void;
}

const MapDataContext = createContext<MapDataContextType | undefined>(undefined);

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours — topology is static per day
const MAX_CACHE_ENTRIES = 6;

/**
 * The map defaults to 3 days prior to the current date — network data
 * typically stabilises after ~72 hours so this is the freshest reliable
 * snapshot to show on first load. Users can still pick any other date.
 */
const DEFAULT_OFFSET_DAYS = 3;
function getDefaultMapDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - DEFAULT_OFFSET_DAYS);
  return d.toISOString().slice(0, 10);
}
const DEFAULT_MAP_DATE = getDefaultMapDate();

export function MapDataProvider({ children }: { children: ReactNode }) {
  const [sites, setSitesState] = useState<MapSite[]>([]);
  const [siteCells, setSiteCellsState] = useState<Map<string, Cell[]>>(new Map());
  const [cellSectors, setCellSectorsState] = useState<CellSector[]>([]);
  const [lastFetchTime, setLastFetchTime] = useState<number | null>(null);
  const [offenderSiteIds, setOffenderSiteIds] = useState<Set<string>>(new Set());
  const [selectedDateId, setSelectedDateId] = useState<string>(DEFAULT_MAP_DATE);
  const [dataDateId, setDataDateId] = useState<string>(DEFAULT_MAP_DATE);
  const [activeSiteLayer, setActiveSiteLayer] = useState<'degraded' | 'outage' | 'overutilized' | null>('degraded');
  const [focusSiteToken, setFocusSiteToken] = useState<string | null>(null);
  const [chatHighlightSiteIds, setChatHighlightSiteIds] = useState<Set<string>>(new Set());
  const [chatTabRequest, setChatTabRequest] = useState<ChatTabRequest | null>(null);
  const [eventsLayerEnabled, setEventsLayerEnabled] = useState<boolean>(true);
  const [externalMapLayerEnabled, setExternalMapLayerEnabled] = useState<boolean>(false);
  const [externalMapProvider, setExternalMapProvider] = useState<'maplibre' | 'esri'>('maplibre');

  const dispatchTabRequest = (req: Omit<ChatTabRequest, 'ts'>) => {
    setChatTabRequest({ ...req, ts: Date.now() });
  };
  const cacheRef = useRef<Map<string, MapCacheEntry>>(new Map());
  const { registerRealIds } = useDummifier();

  // Whenever the live sites list changes, register the real USIDs with the
  // dummifier so reverse-lookup (UST → real) stays warm for chat prompts.
  useEffect(() => {
    if (!sites.length) return;
    registerRealIds(sites.map((s) => s.siteId).concat(sites.map((s) => s.realSiteId ?? '').filter(Boolean) as string[]));
  }, [sites, registerRealIds]);

  // Map date defaults to 3 days prior to the current date (set in initial state
  // via DEFAULT_MAP_DATE). Users can override via the Map Settings date picker.

  const evictIfNeeded = () => {
    const cache = cacheRef.current;
    if (cache.size <= MAX_CACHE_ENTRIES) return;
    const oldest = Array.from(cache.values()).sort((a, b) => a.fetchedAt - b.fetchedAt)[0];
    if (oldest) cache.delete(oldest.dateId);
  };

  const upsertCache = (partial: Partial<Omit<MapCacheEntry, 'dateId'>> & { fetchedAt?: number }) => {
    const cache = cacheRef.current;
    const existing = cache.get(selectedDateId);
    const next: MapCacheEntry = {
      dateId: selectedDateId,
      fetchedAt: partial.fetchedAt ?? existing?.fetchedAt ?? Date.now(),
      sites: partial.sites ?? existing?.sites ?? [],
      siteCells: partial.siteCells ?? existing?.siteCells ?? new Map(),
      cellSectors: partial.cellSectors ?? existing?.cellSectors ?? [],
      offenderSiteIds: partial.offenderSiteIds ?? existing?.offenderSiteIds ?? new Set(),
    };
    cache.set(selectedDateId, next);
    evictIfNeeded();
    return next;
  };

  const primeFromCache = (dateId: string) => {
    const key = String(dateId || '').slice(0, 10);
    const entry = cacheRef.current.get(key);
    if (!entry) return false;
    const age = Date.now() - entry.fetchedAt;
    if (age >= CACHE_DURATION) return false;

    setDataDateId(key);
    setSitesState(entry.sites);
    setSiteCellsState(entry.siteCells);
    setCellSectorsState(entry.cellSectors);
    setOffenderSiteIds(entry.offenderSiteIds);
    setLastFetchTime(entry.fetchedAt);
    return true;
  };

  // ── Background preloader for demo dates ─────────────────────────────────
  // Warms both the in-memory cacheRef (so `primeFromCache` hits) and the
  // on-disk topology / sector caches (so API layer returns instantly on
  // subsequent calls). Runs once on mount in the background — never blocks
  // the initial render.
  const preloadedDatesRef = useRef<Set<string>>(new Set());
  const preloadDate = async (dateId: string): Promise<void> => {
    const key = String(dateId || '').slice(0, 10);
    if (!key) return;
    if (preloadedDatesRef.current.has(key)) return;
    if (isCacheValidFor(key)) return;
    preloadedDatesRef.current.add(key);

    try {
      const [topoRows, sectorRows, compassOffenders] = await Promise.all([
        api.getCompassSiteTopology(key),
        api.getCompassCellSectors(key).catch(() => [] as Array<Record<string, any>>),
        api
          .getCompassOffenders(key)
          .catch(() => [] as Array<{ USID: string; Total_Impact_to_CQX_Delta: number }>),
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
      }));

      const topoOffenderSet = new Set<string>(topoRows.filter((r) => r.is_offender).map((r) => r.USID));
      const ranked = (compassOffenders || []).map((r: any) => String(r.USID || '')).filter(Boolean);
      const offenderSet = ranked.length ? new Set<string>(ranked) : topoOffenderSet;

      const mappedSectors: CellSector[] = (sectorRows || [])
        .map((row: any) => {
          const siteLat = Number(pickValueCaseInsensitive(row, ['site_latitude', 'site_lat', 'latitude', 'lat', 'Source_Lat']));
          const siteLon = Number(pickValueCaseInsensitive(row, ['site_longitude', 'site_lon', 'longitude', 'lng', 'lon', 'Source_Lon']));
          const cellLat = Number(pickValueCaseInsensitive(row, ['cell_latitude', 'cell_lat', 'latitude', 'lat']));
          const cellLon = Number(pickValueCaseInsensitive(row, ['cell_longitude', 'cell_lon', 'longitude', 'lng', 'lon']));
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
            DateID: String(pickValueCaseInsensitive(row, ['DATE_ID', 'date_id']) ?? key),
          } as CellSector;
        })
        .filter(
          (s) =>
            Number.isFinite(s.SiteLatitude) &&
            Number.isFinite(s.SiteLongitude) &&
            s.SiteLatitude >= -90 &&
            s.SiteLatitude <= 90 &&
            s.SiteLongitude >= -180 &&
            s.SiteLongitude <= 180,
        );

      // Build cellCount / anomalyCount lookups and enrich sites
      const cellCountMap = new Map<string, number>();
      const anomalyCountMap = new Map<string, number>();
      const cellMap = new Map<string, Cell[]>();
      mappedSectors.forEach((sector) => {
        const k = sector.realSiteID || sector.SiteID;
        cellCountMap.set(k, (cellCountMap.get(k) || 0) + 1);
        if (sector.CellAnomalyFlag) anomalyCountMap.set(k, (anomalyCountMap.get(k) || 0) + 1);
        if (!cellMap.has(k)) cellMap.set(k, []);
        cellMap.get(k)!.push({
          CellID: sector.CellID,
          CellName: sector.CellName,
          SiteID: sector.SiteID,
          Technology: sector.Technology,
          Azimuth: sector.Azimuth,
          AnomalyFlag: sector.CellAnomalyFlag,
          AnomalyScore: sector.CellAnomalyScore,
        });
      });
      const enrichedSites = mappedSites.map((site) => ({
        ...site,
        cellCount: cellCountMap.get(site.siteId) ?? site.cellCount,
        anomalyCount: anomalyCountMap.get(site.siteId) ?? site.anomalyCount,
        status: anomalyCountMap.get(site.siteId)
          ? site.status === 'CRITICAL'
            ? 'CRITICAL'
            : ('WARNING' as const)
          : site.status,
      }));

      const entry: MapCacheEntry = {
        dateId: key,
        fetchedAt: Date.now(),
        sites: enrichedSites,
        siteCells: cellMap,
        cellSectors: mappedSectors,
        offenderSiteIds: offenderSet,
      };
      cacheRef.current.set(key, entry);
      evictIfNeeded();

      // Warm the dummifier reverse map with these real USIDs so chat prompts
      // typed with the masked UST###### form can be unmapped without waiting
      // for the user to navigate to this date.
      registerRealIds(enrichedSites.map((s) => s.siteId));

      // Also persist sectors to IndexedDB so a page refresh still hits the fast path.
      if (mappedSectors.length > 0) {
        await localCache.set(`ctx:sectors:${key}`, mappedSectors, { ttlMs: 24 * 60 * 60 * 1000 });
      }

      // If the user is already sitting on this date and has no data yet,
      // hydrate the live state from the freshly-warmed cache.
      if (key === selectedDateId && sites.length === 0) {
        primeFromCache(key);
      }
    } catch (err) {
      // Silent failure — preload is best-effort; the real fetch path handles errors.
      preloadedDatesRef.current.delete(key);
      if (import.meta.env?.DEV) {
        console.warn(`[MapDataContext] preload failed for ${key}:`, err);
      }
    }
  };

  const isCacheValidFor = (dateId: string): boolean => {
    const entry = cacheRef.current.get(String(dateId || '').slice(0, 10));
    if (!entry) return false;
    return Date.now() - entry.fetchedAt < CACHE_DURATION;
  };

  useEffect(() => {
    // Kick off after a micro-delay so we don't contend with the primary load.
    const timer = window.setTimeout(() => {
      PRELOAD_DATE_IDS.forEach((d) => {
        void preloadDate(d);
      });
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load from sessionStorage (sites) + IndexedDB (sectors) on mount
  useEffect(() => {
    const restore = async () => {
      try {
        const cachedData = sessionStorage.getItem('mapDataByDate_v2') || sessionStorage.getItem('mapData');
        if (!cachedData) return;
        const parsed = JSON.parse(cachedData);
        const dateId = String(parsed?.dateId || DEFAULT_MAP_DATE).slice(0, 10);
        const fetchedAt = Number(parsed?.fetchedAt || parsed?.lastFetchTime || 0);
        if (!fetchedAt || !Array.isArray(parsed?.sites)) return;
        if (Date.now() - fetchedAt >= CACHE_DURATION) return;

        const cellMap = new Map<string, Cell[]>();
        if (parsed.siteCells && typeof parsed.siteCells === 'object') {
          Object.entries(parsed.siteCells).forEach(([key, value]) => {
            cellMap.set(key, value as Cell[]);
          });
        }

        // Restore sectors from IndexedDB (too large for sessionStorage)
        const cachedSectors = await localCache.get<CellSector[]>(`ctx:sectors:${dateId}`);

        const entry: MapCacheEntry = {
          dateId,
          fetchedAt,
          sites: parsed.sites as MapSite[],
          siteCells: cellMap,
          cellSectors: cachedSectors ?? [],
          offenderSiteIds: new Set<string>(Array.isArray(parsed?.offenderSiteIds) ? parsed.offenderSiteIds : []),
        };
        cacheRef.current.set(dateId, entry);
        // Don't override the today-3 default with whatever date was cached;
        // the cache will be consulted only if the user navigates to that date.
        primeFromCache(dateId);
      } catch (err) {
        console.warn('Failed to load map data from cache:', err);
        sessionStorage.removeItem('mapDataByDate_v2');
        sessionStorage.removeItem('mapData');
      }
    };
    restore();
  }, []);

  // When the user selects a date, hydrate immediately from cache if available; otherwise clear stale data.
  useEffect(() => {
    const hit = primeFromCache(selectedDateId);
    if (!hit) {
      setDataDateId(selectedDateId);
      setSitesState([]);
      setSiteCellsState(new Map());
      setCellSectorsState([]);
      setOffenderSiteIds(new Set());
      setLastFetchTime(null);
    }
  }, [selectedDateId]);

  const setSites = (newSites: MapSite[]) => {
    setSitesState(newSites);
    const fetchTime = Date.now();
    setLastFetchTime(fetchTime);
    setDataDateId(selectedDateId);
    upsertCache({ sites: newSites, fetchedAt: fetchTime });
    
    // Save minimal snapshot (no sectors) to sessionStorage so refresh keeps last-used date quickly.
    try {
      const dataToCache = {
        dateId: selectedDateId,
        fetchedAt: fetchTime,
        sites: newSites,
        siteCells: Object.fromEntries(siteCells),
        offenderSiteIds: Array.from(offenderSiteIds),
      };
      sessionStorage.setItem('mapDataByDate_v2', JSON.stringify(dataToCache));
    } catch (err) {
      console.warn('Failed to cache map data:', err);
    }
  };

  const setSiteCells = (newCells: Map<string, Cell[]>) => {
    setSiteCellsState(newCells);
    setDataDateId(selectedDateId);
    upsertCache({ siteCells: newCells });
    
    // Update minimal sessionStorage snapshot (no sectors)
    try {
      const cached = sessionStorage.getItem('mapDataByDate_v2');
      if (!cached) return;
      const parsed = JSON.parse(cached);
      if (String(parsed?.dateId || '') !== selectedDateId) return;
      parsed.siteCells = Object.fromEntries(newCells);
      sessionStorage.setItem('mapDataByDate_v2', JSON.stringify(parsed));
    } catch (err) {
      console.warn('Failed to cache cell data:', err);
    }
  };

  const setCellSectors = (newSectors: CellSector[]) => {
    setCellSectorsState(newSectors);
    setDataDateId(selectedDateId);
    upsertCache({ cellSectors: newSectors });
    // Persist sectors to IndexedDB — too large for sessionStorage
    if (newSectors.length > 0) {
      localCache.set(`ctx:sectors:${selectedDateId}`, newSectors, { ttlMs: 24 * 60 * 60 * 1000 });
    }
  };

  const isCacheValid = (dateId?: string) => {
    const key = String(dateId || selectedDateId || '').slice(0, 10);
    const entry = cacheRef.current.get(key);
    if (!entry) return false;
    const age = Date.now() - entry.fetchedAt;
    return age < CACHE_DURATION;
  };

  return (
    <MapDataContext.Provider 
      value={{ 
        sites, 
        setSites, 
        siteCells, 
        setSiteCells, 
        cellSectors,
        setCellSectors,
        dataDateId,
        lastFetchTime, 
        isCacheValid,
        primeFromCache,
        offenderSiteIds,
        setOffenderSiteIds,
        selectedDateId,
        setSelectedDateId,
        activeSiteLayer,
        setActiveSiteLayer,
        focusSiteToken,
        setFocusSiteToken,
        chatHighlightSiteIds,
        setChatHighlightSiteIds,
        chatTabRequest,
        dispatchTabRequest,
        eventsLayerEnabled,
        setEventsLayerEnabled,
        externalMapLayerEnabled,
        setExternalMapLayerEnabled,
        externalMapProvider,
        setExternalMapProvider,
      }}
    >
      {children}
    </MapDataContext.Provider>
  );
}

export function useMapData() {
  const context = useContext(MapDataContext);
  if (context === undefined) {
    throw new Error('useMapData must be used within a MapDataProvider');
  }
  return context;
}
