import { useEffect, useMemo, useState } from 'react';
import MapGL, { Layer, Marker, NavigationControl, Source } from 'react-map-gl';
import { useTheme } from '../../context/ThemeContext';
import { useMapData } from '../../context/MapDataContext';
import api from '../../services/api';

const MAPBOX_TOKEN = (import.meta as any).env?.VITE_MAPBOX_TOKEN || '';

interface RcaMiniMapProps {
  siteId: string;
  height?: number;
}

// ─── Helpers (same normalization as RcaSiteStoryCard) ─────────────────────────

function norm(id: string | null | undefined): string {
  const t = String(id || '').trim().toUpperCase();
  if (!t) return '';
  if (/^\d+$/.test(t)) return String(parseInt(t, 10));
  const m = t.match(/^(?:UST|USID\s*)0*(\d+)$/);
  return m?.[1] ?? t;
}

function validCoord(lat: unknown, lon: unknown): boolean {
  const la = Number(lat), lo = Number(lon);
  return Number.isFinite(la) && Number.isFinite(lo) && !(la === 0 && lo === 0)
    && la >= -90 && la <= 90 && lo >= -180 && lo <= 180;
}

function distKm(
  a: { latitude: unknown; longitude: unknown },
  b: { latitude: unknown; longitude: unknown },
): number {
  const la1 = Number(a.latitude), lo1 = Number(a.longitude);
  const la2 = Number(b.latitude), lo2 = Number(b.longitude);
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(la2 - la1), dLon = toRad(lo2 - lo1);
  const sinDLat = Math.sin(dLat / 2), sinDLon = Math.sin(dLon / 2);
  const a2 = sinDLat * sinDLat + Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * sinDLon * sinDLon;
  return 6371 * 2 * Math.atan2(Math.sqrt(a2), Math.sqrt(1 - a2));
}

// ─── Sector wedge GeoJSON builder (same approach as RcaSiteStoryCard) ─────────

interface SectorInput {
  SiteID: string;
  SiteLatitude: number;
  SiteLongitude: number;
  Azimuth: number;
  isSource: boolean;
}

function buildSectorGeoJSON(sectors: SectorInput[]) {
  const radiusDeg = 110 / 111320; // ~110 m arc radius, visible at zoom 13
  const beamwidth = 62;
  const toRad = (d: number) => (d * Math.PI) / 180;

  return {
    type: 'FeatureCollection' as const,
    features: sectors.map((sec, idx) => {
      const start = sec.Azimuth - beamwidth / 2;
      const end = sec.Azimuth + beamwidth / 2;
      const cp = [sec.SiteLongitude, sec.SiteLatitude];
      const arc: number[][] = [cp];
      for (let i = 0; i <= 16; i++) {
        const angle = start + (end - start) * (i / 16);
        const rad = toRad(angle);
        arc.push([
          sec.SiteLongitude + radiusDeg * Math.sin(rad),
          sec.SiteLatitude + radiusDeg * Math.cos(rad),
        ]);
      }
      arc.push(cp);
      return {
        type: 'Feature' as const,
        properties: { isSource: sec.isSource, idx },
        geometry: { type: 'Polygon' as const, coordinates: [arc] },
      };
    }),
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface FallbackCoord { lat: number; lon: number; sectors: SectorInput[] }

export default function RcaMiniMap({ siteId, height = 260 }: RcaMiniMapProps) {
  const { theme } = useTheme();
  const { sites, cellSectors } = useMapData();
  const srcNorm = norm(siteId);

  // Fallback coords fetched from API when site isn't in MapDataContext
  const [fallback, setFallback] = useState<FallbackCoord | null>(null);
  const [fetchedFor, setFetchedFor] = useState('');

  // Find the source site in topology (fast path — already loaded in Observe view)
  const sourceSite = useMemo(() => {
    if (!srcNorm) return null;
    return (
      sites.find(
        (s) => norm(s.siteId) === srcNorm || (s.realSiteId && norm(s.realSiteId) === srcNorm),
      ) ?? null
    );
  }, [sites, srcNorm]);

  const srcLat = Number(sourceSite?.latitude);
  const srcLon = Number(sourceSite?.longitude);
  const hasSource = sourceSite != null && validCoord(srcLat, srcLon);

  // When not found in context (e.g. chat view), fetch coords + sectors for this site directly.
  // We use getSiteComprehensiveAnalysis for the authoritative lat/lon (topology.latitude/longitude)
  // and getSiteSectors for the azimuth data, then pin all sector wedges to the same coord.
  useEffect(() => {
    if (hasSource || !srcNorm || fetchedFor === srcNorm) return;
    setFetchedFor(srcNorm);

    Promise.all([
      api.getSiteComprehensiveAnalysis(siteId).catch(() => null),
      api.getSiteSectors(siteId).catch(() => null),
    ]).then(([analysisResp, sectorsResp]) => {
      // Authoritative coordinates from topology
      const topo = (analysisResp as any)?.data?.topology;
      const topoLat = topo?.latitude != null ? Number(topo.latitude) : NaN;
      const topoLon = topo?.longitude != null ? Number(topo.longitude) : NaN;

      // Sector azimuths from sectors endpoint
      const rows: any[] = Array.isArray((sectorsResp as any)?.data) ? (sectorsResp as any).data : [];
      const validRows = rows.filter((r) => Number.isFinite(Number(r.Azimuth)));

      // Resolve best lat/lon: topology first, fall back to first valid sector
      let lat = topoLat, lon = topoLon;
      if (!validCoord(lat, lon)) {
        const firstWithCoord = rows.find((r) => validCoord(r.SiteLatitude, r.SiteLongitude));
        lat = Number(firstWithCoord?.SiteLatitude ?? NaN);
        lon = Number(firstWithCoord?.SiteLongitude ?? NaN);
      }
      if (!validCoord(lat, lon)) return;

      // All sectors pinned to the same authoritative coordinate
      const secs: SectorInput[] = validRows.map((r) => ({
        SiteID: r.SiteID || siteId,
        SiteLatitude: lat,
        SiteLongitude: lon,
        Azimuth: Number(r.Azimuth),
        isSource: true,
      }));
      setFallback({ lat, lon, sectors: secs });
    });
  }, [hasSource, srcNorm, siteId, fetchedFor]);

  const resolvedLat = hasSource ? srcLat : fallback?.lat ?? 0;
  const resolvedLon = hasSource ? srcLon : fallback?.lon ?? 0;
  const resolvedHasCoord = hasSource || (fallback != null && validCoord(fallback.lat, fallback.lon));

  const backdropGeoJSON = useMemo(() => ({ type: 'FeatureCollection' as const, features: [] }), []);

  // Sectors — use MapDataContext when available, fallback sectors from API fetch
  const sectorGeoJSON = useMemo(() => {
    // Fallback path: use sectors fetched directly for this site
    if (!hasSource && fallback?.sectors.length) {
      return buildSectorGeoJSON(fallback.sectors);
    }

    if (!hasSource || cellSectors.length === 0)
      return { type: 'FeatureCollection' as const, features: [] };

    const nearbyNormIds = new Set<string>();
    sites.forEach((s) => {
      if (validCoord(s.latitude, s.longitude) && distKm({ latitude: srcLat, longitude: srcLon }, s) <= 5) {
        nearbyNormIds.add(norm(s.siteId));
        if (s.realSiteId) nearbyNormIds.add(norm(s.realSiteId));
      }
    });

    const inputs: SectorInput[] = cellSectors
      .filter(
        (s) =>
          validCoord(s.SiteLatitude, s.SiteLongitude) &&
          Number.isFinite(Number(s.Azimuth)) &&
          (nearbyNormIds.has(norm(s.SiteID)) || nearbyNormIds.has(norm(s.realSiteID))),
      )
      .slice(0, 600)
      .map((s) => ({
        SiteID: s.SiteID,
        SiteLatitude: Number(s.SiteLatitude),
        SiteLongitude: Number(s.SiteLongitude),
        Azimuth: Number(s.Azimuth),
        isSource: norm(s.SiteID) === srcNorm || norm(s.realSiteID) === srcNorm,
      }));

    return buildSectorGeoJSON(inputs);
  }, [cellSectors, sites, hasSource, srcLat, srcLon, srcNorm, fallback]);

  // Map viewport — snap when coordinates resolve (either from context or API fallback)
  const [viewState, setViewState] = useState({
    latitude: resolvedLat || 37.7749,
    longitude: resolvedLon || -122.4194,
    zoom: 13,
  });

  useEffect(() => {
    if (resolvedHasCoord) {
      setViewState({ latitude: resolvedLat, longitude: resolvedLon, zoom: 13 });
    }
  }, [resolvedHasCoord, resolvedLat, resolvedLon]);

  if (!resolvedHasCoord) return null;

  const mapStyle =
    theme === 'dark'
      ? 'mapbox://styles/mapbox/dark-v11'
      : 'mapbox://styles/mapbox/light-v11';

  const mapId = `rcamini-${srcNorm}`;

  return (
    <div className="relative rounded-xl overflow-hidden border border-slate-200/70 dark:border-white/10">
      <MapGL
        key={mapId}
        {...viewState}
        onMove={(e) => setViewState(e.viewState)}
        style={{ width: '100%', height }}
        mapStyle={mapStyle}
        mapboxAccessToken={MAPBOX_TOKEN}
        interactive
      >
        <NavigationControl position="top-right" showCompass={false} />

        {/* ── Backdrop sites (small gray dots) ─────────────────────────── */}
        <Source id={`${mapId}-backdrop`} type="geojson" data={backdropGeoJSON}>
          <Layer
            id={`${mapId}-backdrop-dots`}
            type="circle"
            paint={{
              'circle-radius': 2.2,
              'circle-color': '#6b7280',
              'circle-opacity': 0.55,
            }}
          />
        </Source>

        {/* ── Sector wedges ─────────────────────────────────────────────── */}
        {sectorGeoJSON.features.length > 0 && (
          <Source id={`${mapId}-sectors`} type="geojson" data={sectorGeoJSON as any}>
            <Layer
              id={`${mapId}-sector-fill`}
              type="fill"
              paint={{
                'fill-color': [
                  'case',
                  ['boolean', ['get', 'isSource'], false],
                  '#ef4444',
                  '#475569',
                ],
                'fill-opacity': [
                  'case',
                  ['boolean', ['get', 'isSource'], false],
                  0.42,
                  0.13,
                ],
              }}
            />
            <Layer
              id={`${mapId}-sector-line`}
              type="line"
              paint={{
                'line-color': [
                  'case',
                  ['boolean', ['get', 'isSource'], false],
                  '#fca5a5',
                  '#64748b',
                ],
                'line-width': 0.85,
                'line-opacity': 0.85,
              }}
            />
          </Source>
        )}

        {/* ── Source site marker ────────────────────────────────────────── */}
        <Marker longitude={resolvedLon} latitude={resolvedLat} anchor="center">
          <div style={{ width: 32, height: 32, position: 'relative' }}>
            <div className="absolute inset-0 rounded-full bg-red-500/25 animate-ping" />
            <div className="absolute inset-[8px] rounded-full bg-red-500 border-2 border-white shadow-lg" />
          </div>
        </Marker>
      </MapGL>

      {/* Site count badge */}
      <div className="absolute top-2 left-2 px-2 py-1 text-[11px] font-medium bg-white/90 dark:bg-slate-900/90 border border-slate-200/50 dark:border-white/15 rounded-md shadow backdrop-blur-sm text-slate-700 dark:text-slate-200">
        {backdropGeoJSON.features.length > 0 ? `${backdropGeoJSON.features.length} sites · ` : ''}{sectorGeoJSON.features.length} sectors
      </div>
    </div>
  );
}
