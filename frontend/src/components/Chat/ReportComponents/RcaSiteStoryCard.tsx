import { useEffect, useMemo, useState } from 'react';
import MapGL, { Layer, Marker, NavigationControl, Source } from 'react-map-gl';
import { useTheme } from '../../../context/ThemeContext';
import { useMapData } from '../../../context/MapDataContext';
import { useDummifier } from '../../../context/DummifierContext';
import api from '../../../services/api';
import RCAReasoningPanel from '../../RCAReasoningPanel';

interface StorySite {
  siteId: string;
  realSiteId?: string;
  siteName: string;
  latitude: number;
  longitude: number;
  isOutage?: boolean;
}

interface SolutionRec {
  technique: string;
  moClass: string;
  parameter: string;
  value: number;
  unit: string;
  description: string;
  targetSiteId?: string;
  targetNeighbors?: string[];
}

interface RcaStoryData {
  dateId: string;
  sourceSite: StorySite;
  relatedSites: StorySite[];
  topNeighbors?: StorySite[];
  congestionHighlightSiteIds?: string[];
  allSites?: StorySite[];
  rcaBucket: string;
  shortSummary: string;
  intuitions: Array<{ name: string; applies: boolean; explanation?: string }>;
  outageNeighborSiteId?: string;
  trafficCandidates?: StorySite[];
  executeChoiceId?: string;
  escalateChoiceId?: string;
  noActionChoiceId?: string;
  showRecommendations?: boolean;
  solutionRec?: SolutionRec;
}

interface RcaSiteStoryCardProps {
  data: RcaStoryData;
  onChoiceClick?: (choiceId: string) => void;
}

interface SectorShape {
  SiteID: string;
  SiteLatitude: number;
  SiteLongitude: number;
  Azimuth: number;
}

const MAPBOX_TOKEN = (import.meta as any).env?.VITE_MAPBOX_TOKEN || '';

function distanceSq(a: StorySite, b: StorySite): number {
  const dx = a.latitude - b.latitude;
  const dy = a.longitude - b.longitude;
  return dx * dx + dy * dy;
}

function distanceKm(a: StorySite, b: StorySite): number {
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 6371 * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

function normalizeSiteId(siteId: string | null | undefined): string {
  const token = String(siteId || '').trim().toUpperCase();
  if (!token) return '';
  // Strip leading zeros from numeric-only IDs so "047323" == "47323"
  if (/^\d+$/.test(token)) return String(parseInt(token, 10));
  // Strip UST prefix for comparison so "UST47323" == "47323"
  const ustMatch = token.match(/^UST0*(\d+)$/);
  if (ustMatch?.[1]) return ustMatch[1];
  return token;
}

function isValidCoord(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0);
}

export default function RcaSiteStoryCard({ data, onChoiceClick }: RcaSiteStoryCardProps) {
  const { theme } = useTheme();
  const { sites: observeSites } = useMapData();
  const { dId, dText } = useDummifier();
  const [expanded, setExpanded] = useState(false);
  const [showReasoningModal, setShowReasoningModal] = useState(false);
  const [fetchedBackdropSites, setFetchedBackdropSites] = useState<StorySite[]>([]);
  const [sectorShapes, setSectorShapes] = useState<SectorShape[]>([]);
  const [flowAnimationTime, setFlowAnimationTime] = useState(0);
  const [actualNeighborIds, setActualNeighborIds] = useState<Set<string>>(new Set());
  const mapIdBase = useMemo(
    () => `rca-${data.sourceSite.siteId}-${data.dateId}`.replace(/[^a-zA-Z0-9_-]/g, '-'),
    [data.sourceSite.siteId, data.dateId]
  );
  const showRecommendations = Boolean(data.showRecommendations);
  const outageBoltColor = theme === 'dark' ? '#facc15' : '#111827';
  const outageBoltShadow =
    theme === 'dark'
      ? '0 0 6px rgba(250, 204, 21, 0.85), 0 0 2px rgba(0,0,0,0.75)'
      : '0 0 2px rgba(255,255,255,0.95), 0 0 6px rgba(17,24,39,0.35)';

  const backdropSites = useMemo(() => {
    if (Array.isArray(observeSites) && observeSites.length > 0) {
      return observeSites
        .map((s: any) => ({
          siteId: String(s.siteId || ''),
          siteName: String(s.siteName || s.siteId || ''),
          latitude: Number(s.latitude),
          longitude: Number(s.longitude),
        }))
        .filter((s: StorySite) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
    }
    if (fetchedBackdropSites.length > 0) {
      return fetchedBackdropSites;
    }
    return Array.isArray(data.allSites) ? data.allSites : [];
  }, [observeSites, data.allSites, fetchedBackdropSites]);

  useEffect(() => {
    let cancelled = false;
    if ((Array.isArray(observeSites) && observeSites.length > 0) || fetchedBackdropSites.length > 0) return;
    if (Array.isArray(data.allSites) && data.allSites.length > 0) return;
    void (async () => {
      try {
        const mapRes = await api.getMapSites();
        const rows = Array.isArray(mapRes?.data) ? mapRes.data : [];
        const parsed = rows
          .map((s: any) => ({
            siteId: String(s.siteId || ''),
            siteName: String(s.siteName || s.siteId || ''),
            latitude: Number(s.latitude),
            longitude: Number(s.longitude),
          }))
          .filter((s: StorySite) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
        if (!cancelled) setFetchedBackdropSites(parsed);
      } catch {
        if (!cancelled) setFetchedBackdropSites([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [observeSites, fetchedBackdropSites.length, data.allSites]);

  // Fetch actual network neighbors for this site so we only draw lines to real neighbors
  useEffect(() => {
    let cancelled = false;
    const usid = String(data.sourceSite.realSiteId || data.sourceSite.siteId || '').trim();
    const dateId = String(data.dateId || '').trim();
    if (!usid || !dateId) return;
    void (async () => {
      try {
        const ids: string[] = await api.getCompassNeighborUsids(usid, dateId);
        if (!cancelled && Array.isArray(ids) && ids.length > 0) {
          setActualNeighborIds(new Set(ids.map((id) => normalizeSiteId(id))));
        }
      } catch {
        // silently ignore — fall back to geographic proximity lines
      }
    })();
    return () => { cancelled = true; };
  }, [data.sourceSite.realSiteId, data.sourceSite.siteId, data.dateId]);

  // Resolve source site coords — prefer backdrop (Compass topology) over backend story coords.
  // The backend may return (0,0) or a regional fallback if the site isn't in filtered_sites.
  const resolvedSourceSite = useMemo(() => {
    const targetId = normalizeSiteId(data.sourceSite.siteId);
    // Check backdrop (observeSites → Compass data, most accurate)
    const fromBackdrop = backdropSites.find((s) => normalizeSiteId(s.siteId) === targetId);
    if (fromBackdrop && isValidCoord(fromBackdrop.latitude, fromBackdrop.longitude)) {
      return { ...data.sourceSite, latitude: fromBackdrop.latitude, longitude: fromBackdrop.longitude };
    }
    // Check topNeighbors area (not ideal but better than null island)
    // Fall back to data.sourceSite only if it has valid coords
    if (isValidCoord(data.sourceSite.latitude, data.sourceSite.longitude)) {
      return data.sourceSite;
    }
    // Last resort: centroid of allSites
    const pool = Array.isArray(data.allSites) ? data.allSites.filter(
      (s) => isValidCoord(s.latitude, s.longitude)
    ) : [];
    if (pool.length > 0) {
      const avgLat = pool.reduce((s, x) => s + x.latitude, 0) / pool.length;
      const avgLon = pool.reduce((s, x) => s + x.longitude, 0) / pool.length;
      return { ...data.sourceSite, latitude: avgLat, longitude: avgLon };
    }
    return data.sourceSite;
  }, [backdropSites, data.sourceSite, data.allSites]);

  const topNeighbors: StorySite[] = useMemo(() => {
    // Build a lookup of Compass coords by normalized site ID — the single source of truth for coordinates.
    const backdropById = new Map<string, StorySite>();
    backdropSites.forEach((s) => backdropById.set(normalizeSiteId(s.siteId), s));

    const resolveCoords = (s: StorySite): StorySite => {
      const backdrop = backdropById.get(normalizeSiteId(s.siteId));
      if (backdrop && isValidCoord(backdrop.latitude, backdrop.longitude)) {
        return { ...s, latitude: backdrop.latitude, longitude: backdrop.longitude };
      }
      return s;
    };

    if (Array.isArray(data.topNeighbors) && data.topNeighbors.length > 0) {
      return data.topNeighbors
        .slice(0, 50)
        .map(resolveCoords)
        .filter((s) => isValidCoord(s.latitude, s.longitude));
    }
    // No backend neighbors — derive from backdrop by proximity
    return backdropSites
      .filter((s) => normalizeSiteId(s.siteId) !== normalizeSiteId(resolvedSourceSite.siteId))
      .sort((a, b) => distanceSq(a, resolvedSourceSite) - distanceSq(b, resolvedSourceSite))
      .slice(0, 50)
      .map((s) => ({ ...s, isOutage: false }));
  }, [data.topNeighbors, backdropSites, resolvedSourceSite]);

  const sanitizedRcaBucket = String(data.rcaBucket || 'RCA');
  const sanitizedShortSummary = String(data.shortSummary || 'No short summary available.');

  const extractedOutageSiteId = useMemo(() => {
    const rcaText = `${data.rcaBucket || ''} ${data.shortSummary || ''}`;
    // Extract the raw digits from any mention (USID 12745 or UST12745 → "12745")
    const toRawId = (raw: string) =>
      raw.replace(/^UST/i, '').replace(/^USID\s*/i, '').replace(/\s/g, '').trim();
    const patterns: RegExp[] = [
      /neighbor\s+site(?:\s+site)?\s+(UST\d{4,8})/i,
      /neighbor\s+site(?:\s+site)?[^.]{0,80}?USID\s*[:#-]?\s*(\d{4,8})/i,
      /(?:outage|down|failure)\s+at[^.]{0,80}?site\s+(UST\d{4,8})/i,
      /(?:outage|down|failure)\s+at[^.]{0,80}?USID\s*[:#-]?\s*(\d{4,8})/i,
      /site\s+(UST\d{4,8})\s+(?:caused|experiencing|having|with)[^.]{0,80}?(?:outage|down|issue)/i,
      /USID\s*[:#-]?\s*(\d{4,8})[^.]{0,120}?(?:outage|backhaul|transport|degradation)/i,
    ];
    for (const p of patterns) {
      const m = rcaText.match(p);
      if (m?.[1]) {
        const candidate = toRawId(m[1]);
        if (candidate && candidate !== normalizeSiteId(data.sourceSite.siteId)) return candidate;
      }
    }
    return null;
  }, [data.rcaBucket, data.shortSummary, data.sourceSite.siteId]);

  // Detect RCA category for icon theming
  const rcaCategory = useMemo(() => {
    const text = `${data.rcaBucket || ''} ${data.shortSummary || ''}`.toLowerCase();
    if (/transport|backhaul|transmission|fiber|optical/.test(text)) return 'transport';
    if (/power|battery|electric|ups|generator|outage/.test(text)) return 'power';
    if (/congestion|capacity|throughput|overload/.test(text)) return 'congestion';
    if (/neighbor|handover|handoff/.test(text)) return 'neighbor';
    return 'general';
  }, [data.rcaBucket, data.shortSummary]);

  const sourceSiteNorm = normalizeSiteId(data.sourceSite.siteId);
  const outageNeighborSiteId = useMemo(() => {
    const candidateOrder = [
      extractedOutageSiteId,
      data.outageNeighborSiteId,
      topNeighbors.find((s) => s.isOutage)?.siteId,
    ]
      .map((id) => normalizeSiteId(id))
      .filter(Boolean)
      .filter((id) => id !== sourceSiteNorm);

    const wanted = candidateOrder[0];
    if (!wanted) return undefined;

    const resolved =
      topNeighbors.find((s) => normalizeSiteId(s.siteId) === wanted)?.siteId ||
      data.relatedSites.find((s) => normalizeSiteId(s.siteId) === wanted)?.siteId;

    return resolved || wanted;
  }, [extractedOutageSiteId, data.outageNeighborSiteId, topNeighbors, data.relatedSites, sourceSiteNorm]);
  const outageNeighborNorm = normalizeSiteId(outageNeighborSiteId);
  const isCongestionRca = /congestion/i.test(String(data.rcaBucket || ''));
  const congestionHighlightIds = useMemo(
    () => new Set((data.congestionHighlightSiteIds || []).map((id) => String(id))),
    [data.congestionHighlightSiteIds]
  );

  const farthestNeighborKm = useMemo(() => {
    if (topNeighbors.length === 0) return 5;
    return Math.max(...topNeighbors.map((s) => distanceKm(s, resolvedSourceSite)));
  }, [topNeighbors, resolvedSourceSite]);
  const radiusKm = Math.min(30, Math.max(5, Math.round((farthestNeighborKm + 3) * 10) / 10));

  const displaySites = useMemo(() => {
    // Primary: filter backdropSites by radius around the resolved source
    const fromBackdrop = backdropSites
      .filter((s) => distanceKm(s, resolvedSourceSite) <= radiusKm)
      .slice(0, 1600);
    // Fallback: if backdrop is empty (e.g. observe not loaded), use topNeighbors directly
    if (fromBackdrop.length === 0 && topNeighbors.length > 0) {
      return topNeighbors;
    }
    return fromBackdrop;
  }, [backdropSites, resolvedSourceSite, radiusKm, topNeighbors]);

  const displaySiteIds = useMemo(() => new Set(displaySites.map((s) => s.siteId)), [displaySites]);
  const topNeighborIds = useMemo(() => new Set(topNeighbors.map((s) => s.siteId)), [topNeighbors]);
  const neighborMarkerSites = useMemo(() => {
    const merged: StorySite[] = [...topNeighbors];
    if (outageNeighborNorm && !merged.some((s) => normalizeSiteId(s.siteId) === outageNeighborNorm)) {
      // Prefer displaySites (Compass coords) over relatedSites (backend coords)
      const outageFallback =
        displaySites.find((s) => normalizeSiteId(s.siteId) === outageNeighborNorm) ||
        data.relatedSites.find((s) => normalizeSiteId(s.siteId) === outageNeighborNorm);
      if (outageFallback) {
        // Resolve to Compass coords if possible
        const backdropMatch = backdropSites.find((s) => normalizeSiteId(s.siteId) === outageNeighborNorm);
        merged.unshift(backdropMatch ? { ...outageFallback, latitude: backdropMatch.latitude, longitude: backdropMatch.longitude } : outageFallback);
      }
    }

    const seen = new Set<string>();
    return merged.filter((s) => {
      const key = normalizeSiteId(s.siteId);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [topNeighbors, outageNeighborNorm, displaySites, data.relatedSites]);
  const trafficTargets = useMemo(
    () => {
      const candidates = data.trafficCandidates && data.trafficCandidates.length > 0
        ? data.trafficCandidates
        : topNeighbors.filter((s) => normalizeSiteId(s.siteId) !== outageNeighborNorm).slice(0, 2);
      const filtered = candidates
        .filter((s) => normalizeSiteId(s.siteId) !== outageNeighborNorm)
        .slice(0, 2);

      return filtered;
    },
    [data.trafficCandidates, topNeighbors, outageNeighborNorm, data.sourceSite.siteId, isCongestionRca]
  );

  useEffect(() => {
    let cancelled = false;
    if (displaySiteIds.size === 0) {
      setSectorShapes([]);
      return;
    }
    void (async () => {
      try {
        const sectorsRes = await api.getAllSectors(5000);
        const rows = Array.isArray(sectorsRes?.data) ? sectorsRes.data : [];
        const parsed = rows
          .map((row: any) => row)
          .filter((row: any) => displaySiteIds.has(String(row.SiteID || '')))
          .map((row: any) => ({
            SiteID: String(row.SiteID || ''),
            SiteLatitude: Number(row.SiteLatitude),
            SiteLongitude: Number(row.SiteLongitude),
            Azimuth: Number(row.Azimuth),
          }))
          .filter((row: SectorShape) => Number.isFinite(row.SiteLatitude) && Number.isFinite(row.SiteLongitude) && Number.isFinite(row.Azimuth))
          .slice(0, 3800);
        if (!cancelled) setSectorShapes(parsed);
      } catch {
        if (!cancelled) setSectorShapes([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [displaySiteIds]);

  const center = useMemo(() => {
    return {
      latitude: resolvedSourceSite.latitude,
      longitude: resolvedSourceSite.longitude,
      zoom: expanded ? 12.4 : 11.7,
    };
  }, [resolvedSourceSite.latitude, resolvedSourceSite.longitude, resolvedSourceSite.siteId, expanded]);

  const [viewState, setViewState] = useState({
    longitude: center.longitude,
    latitude: center.latitude,
    zoom: center.zoom,
  });

  useEffect(() => {
    setViewState({
      longitude: center.longitude,
      latitude: center.latitude,
      zoom: center.zoom,
    });
  }, [center.longitude, center.latitude, center.zoom, data.sourceSite.siteId, data.dateId]);

  const displaySitesGeoJSON = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: displaySites.map((site) => ({
        type: 'Feature' as const,
        properties: { siteId: site.siteId },
        geometry: {
          type: 'Point' as const,
          coordinates: [site.longitude, site.latitude],
        },
      })),
    }),
    [displaySites]
  );

  const sectorGeoJSON = useMemo(() => {
    const radiusDeg = 105 / 111320;
    const beamwidth = 62;
    const toRadians = (deg: number) => (deg * Math.PI) / 180;
    return {
      type: 'FeatureCollection' as const,
      features: sectorShapes.map((sector, idx) => {
        const angleStart = sector.Azimuth - beamwidth / 2;
        const angleEnd = sector.Azimuth + beamwidth / 2;
        const centerPoint = [sector.SiteLongitude, sector.SiteLatitude];
        const arcPoints: number[][] = [centerPoint];
        const numArcPoints = 18;
        for (let i = 0; i <= numArcPoints; i += 1) {
          const angle = angleStart + (angleEnd - angleStart) * (i / numArcPoints);
          const angleRad = toRadians(angle);
          arcPoints.push([
            sector.SiteLongitude + radiusDeg * Math.sin(angleRad),
            sector.SiteLatitude + radiusDeg * Math.cos(angleRad),
          ]);
        }
        arcPoints.push(centerPoint);
        const siteId = sector.SiteID;
        const zone =
          normalizeSiteId(siteId) === sourceSiteNorm
            ? 'source'
            : normalizeSiteId(siteId) === outageNeighborNorm
              ? 'outage'
              : showRecommendations && trafficTargets.some((s) => normalizeSiteId(s.siteId) === normalizeSiteId(siteId))
                ? 'traffic_target'
                : isCongestionRca && congestionHighlightIds.has(siteId)
                  ? 'congestion'
                  : 'background';
        return {
          type: 'Feature' as const,
          properties: { siteId, zone, idx },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [arcPoints],
          },
        };
      }),
    };
  }, [sectorShapes, sourceSiteNorm, outageNeighborNorm, trafficTargets, isCongestionRca, congestionHighlightIds, showRecommendations]);

  const lineGeoJSON = useMemo(() => {
    const lines: Array<any> = [];
    const targetSiteIds = new Set(trafficTargets.map((t) => normalizeSiteId(t.siteId)));

    // Which topNeighbors are actual network neighbors?
    // If we have real neighbor data from the API, use it; otherwise fall back to all topNeighbors.
    const linkedNeighbors = actualNeighborIds.size > 0
      ? topNeighbors.filter((n) => actualNeighborIds.has(normalizeSiteId(n.siteId)))
      : topNeighbors;

    const addOutageLine = () => {
      if (!outageNeighborNorm) return;
      const outageSite =
        topNeighbors.find((n) => normalizeSiteId(n.siteId) === outageNeighborNorm) ||
        displaySites.find((s) => normalizeSiteId(s.siteId) === outageNeighborNorm);
      if (outageSite) {
        lines.push({
          type: 'Feature' as const,
          properties: { flow: 'inbound_outage' },
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [outageSite.longitude, outageSite.latitude],
              [resolvedSourceSite.longitude, resolvedSourceSite.latitude],
            ],
          },
        });
      }
    };

    addOutageLine();

    linkedNeighbors
      .filter((n) => normalizeSiteId(n.siteId) !== outageNeighborNorm)
      .forEach((neighbor) => {
        const flow = showRecommendations && targetSiteIds.has(normalizeSiteId(neighbor.siteId))
          ? 'outbound_target'
          : showRecommendations
            ? 'outbound_neighbor'
            : 'neighbor_context';
        lines.push({
          type: 'Feature' as const,
          properties: { flow },
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [resolvedSourceSite.longitude, resolvedSourceSite.latitude],
              [neighbor.longitude, neighbor.latitude],
            ],
          },
        });
      });

    return { type: 'FeatureCollection' as const, features: lines };
  }, [topNeighbors, actualNeighborIds, outageNeighborNorm, displaySites, resolvedSourceSite, trafficTargets, showRecommendations]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setFlowAnimationTime((t) => (t + 0.028) % 1);
    }, 40);
    return () => window.clearInterval(timer);
  }, []);

  const animatedFlowArrows = useMemo(() => {
    const toAngle = (fromLon: number, fromLat: number, toLon: number, toLat: number): number => {
      const radians = Math.atan2(toLat - fromLat, toLon - fromLon);
      return (radians * 180) / Math.PI;
    };

    return (lineGeoJSON.features || [])
      .filter((feature: any) => {
        const flow = String(feature?.properties?.flow || '');
        return flow === 'inbound_outage' || flow === 'outbound_target';
      })
      .flatMap((feature: any, idx: number) => {
        const flow = String(feature?.properties?.flow || '');
        const coords = feature?.geometry?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) return [];
        const [startLon, startLat] = coords[0] || [];
        const [endLon, endLat] = coords[coords.length - 1] || [];
        if (![startLon, startLat, endLon, endLat].every(Number.isFinite)) return [];

        const speed = flow === 'inbound_outage' ? 1.0 : 1.2;
        const gap = flow === 'inbound_outage' ? 0.24 : 0.22;
        const basePhase = idx * 0.11;
        const angle = toAngle(startLon, startLat, endLon, endLat);

        return [0, 1, 2].map((step) => {
          const t = (flowAnimationTime * speed + basePhase + step * gap) % 1;
          const lon = startLon + (endLon - startLon) * t;
          const lat = startLat + (endLat - startLat) * t;
          return {
            id: `${flow}-${idx}-${step}`,
            flow,
            longitude: lon,
            latitude: lat,
            angle,
          };
        });
      })
      .filter(Boolean) as Array<{
      id: string;
      flow: string;
      longitude: number;
      latitude: number;
      angle: number;
    }>;
  }, [lineGeoJSON.features, flowAnimationTime]);

  const sanitizedIntuitions = useMemo(
    () => (Array.isArray(data.intuitions) ? data.intuitions : []).map((item) => ({
      ...item,
      name: String(item.name || ''),
      explanation: String(item.explanation || ''),
    })),
    [data.intuitions]
  );

  const applied = sanitizedIntuitions.filter((i) => i.applies);

  return (
    <div className="mt-3 rounded-xl border border-border dark:border-gray-700 bg-cream-surface dark:bg-gray-900/60 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary dark:text-gray-100">
          RCA Map Story • {dId(data.sourceSite.siteId)}
        </h3>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs px-2 py-1 rounded-md border border-border dark:border-gray-600 text-text-secondary dark:text-gray-300"
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {/* Reasoning Agent summary – above map */}
      <div className="rounded-lg border border-border dark:border-slate-700 bg-white/75 dark:bg-slate-900/40 p-3">
        <div className="text-xs uppercase tracking-[0.14em] text-text-secondary dark:text-slate-300 mb-1">Reasoning Agent - RCA</div>
        <div className="text-base font-semibold text-text-primary dark:text-white mb-2">{dText(sanitizedRcaBucket)}</div>
        <div className="text-sm text-text-secondary dark:text-gray-300 mb-3">{dText(sanitizedShortSummary)}</div>
        <div className="flex flex-wrap gap-2">
          <span className="text-xs rounded-full px-2 py-1 bg-cream-surface-light dark:bg-slate-800 text-text-secondary dark:text-slate-200">
            {applied.length} intuitions applied
          </span>
          <span className="text-xs rounded-full px-2 py-1 bg-cream-surface-light dark:bg-slate-800 text-text-secondary dark:text-slate-200">
            Date {data.dateId}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowReasoningModal(true)}
          className="mt-3 naavik-btn-info"
        >
          Expand RCA Details
        </button>
      </div>

      <div className="rounded-lg overflow-hidden border border-border dark:border-gray-700">
        <MapGL
          key={`map-${data.sourceSite.siteId}-${data.dateId}`}
          {...viewState}
          onMove={(evt) => setViewState(evt.viewState)}
          style={{ width: '100%', height: expanded ? '520px' : '360px' }}
          mapStyle={theme === 'dark' ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11'}
          mapboxAccessToken={MAPBOX_TOKEN}
          interactive
        >
          <NavigationControl position="top-right" />

          <Source id={`${mapIdBase}-sites`} type="geojson" data={displaySitesGeoJSON as any}>
            <Layer
              id={`${mapIdBase}-sites-layer`}
              type="circle"
              paint={{
                'circle-radius': 2.1,
                'circle-color': '#6b7280',
                'circle-opacity': 0.58,
              }}
            />
          </Source>

          <Source id={`${mapIdBase}-sectors`} type="geojson" data={sectorGeoJSON as any}>
            <Layer
              id={`${mapIdBase}-sector-fill`}
              type="fill"
              paint={{
                'fill-color': [
                  'match',
                  ['get', 'zone'],
                  'source', '#ef4444',
                  'outage', '#a855f7',
                  'traffic_target', '#22c55e',
                  'congestion', '#f97316',
                  '#475569',
                ],
                'fill-opacity': [
                  'match',
                  ['get', 'zone'],
                  'source', 0.5,
                  'outage', 0.5,
                  'traffic_target', 0.42,
                  'congestion', 0.36,
                  0.15,
                ],
              }}
            />
            <Layer
              id={`${mapIdBase}-sector-line`}
              type="line"
              paint={{
                'line-color': [
                  'match',
                  ['get', 'zone'],
                  'source', '#fca5a5',
                  'outage', '#d8b4fe',
                  'traffic_target', '#86efac',
                  'congestion', '#fdba74',
                  '#64748b',
                ],
                'line-width': 0.85,
                'line-opacity': 0.8,
              }}
            />
          </Source>

          <Source id={`${mapIdBase}-lines`} type="geojson" data={lineGeoJSON as any}>
            <Layer
              id={`${mapIdBase}-lines-inbound`}
              type="line"
              filter={['==', ['get', 'flow'], 'inbound_outage']}
              paint={{
                'line-color': '#ef4444',
                'line-width': 3.4,
                'line-opacity': 0.96,
                'line-dasharray': [2, 1],
              }}
            />
            <Layer
              id={`${mapIdBase}-lines-inbound-arrows`}
              type="symbol"
              filter={['==', ['get', 'flow'], 'inbound_outage']}
              layout={{
                'symbol-placement': 'line',
                'symbol-spacing': 85,
                'icon-image': 'triangle-11',
                'icon-size': 0.95,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-rotation-alignment': 'map',
                'icon-keep-upright': false,
              }}
              paint={{
                'icon-color': '#ef4444',
                'icon-opacity': 0.98,
              }}
            />
            <Layer
              id={`${mapIdBase}-lines-outbound-target`}
              type="line"
              filter={['==', ['get', 'flow'], 'outbound_target']}
              paint={{
                'line-color': '#22c55e',
                'line-width': 3,
                'line-opacity': 0.95,
              }}
            />
            <Layer
              id={`${mapIdBase}-lines-outbound-target-arrows`}
              type="symbol"
              filter={['==', ['get', 'flow'], 'outbound_target']}
              layout={{
                'symbol-placement': 'line',
                'symbol-spacing': 90,
                'icon-image': 'triangle-11',
                'icon-size': 0.9,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                'icon-rotation-alignment': 'map',
                'icon-keep-upright': false,
              }}
              paint={{
                'icon-color': '#22c55e',
                'icon-opacity': 0.97,
              }}
            />
            <Layer
              id={`${mapIdBase}-lines-outbound-neighbor`}
              type="line"
              filter={['==', ['get', 'flow'], 'outbound_neighbor']}
              paint={{
                'line-color': '#cbd5e1',
                'line-width': 1.8,
                'line-opacity': 0.7,
                'line-dasharray': [1, 1.8],
              }}
            />
            <Layer
              id={`${mapIdBase}-lines-neighbor-context`}
              type="line"
              filter={['==', ['get', 'flow'], 'neighbor_context']}
              paint={{
                'line-color': '#cbd5e1',
                'line-width': 1.9,
                'line-opacity': 0.72,
                'line-dasharray': [1.2, 2],
              }}
            />
          </Source>

          <Marker longitude={resolvedSourceSite.longitude} latitude={resolvedSourceSite.latitude} anchor="center">
            <div className="relative" title={`Offender site: ${resolvedSourceSite.siteId}`}>
              <div className="w-5 h-5 rounded-full bg-red-600 border-2 border-white shadow-lg ring-2 ring-red-500/35" />
              {(rcaCategory === 'power' || rcaCategory === 'transport') && (
                <div
                  className="absolute -top-4 -left-1 text-[13px] font-bold leading-none"
                  style={{ color: outageBoltColor, textShadow: outageBoltShadow }}
                  title={rcaCategory === 'transport' ? 'Transport issue' : 'Power issue'}
                >
                  {rcaCategory === 'transport' ? '📡' : '⚡'}
                </div>
              )}
            </div>
          </Marker>
          {neighborMarkerSites.map((site) => {
            const isOutageNeighbor = normalizeSiteId(site.siteId) === outageNeighborNorm;
            const icon = rcaCategory === 'transport' ? '📡' : rcaCategory === 'power' ? '⚡' : '⚡';
            return (
              <Marker key={site.siteId} longitude={site.longitude} latitude={site.latitude} anchor="center">
                {isOutageNeighbor ? (
                  <div
                    className="relative"
                    title={`Neighbor site with outage (${rcaCategory}): ${site.siteId}`}
                  >
                    <div className="w-4 h-4 rounded-full border-2 border-white shadow-md bg-teal-500" />
                    <div
                      className="absolute -top-4 -left-1 text-[13px] font-bold leading-none"
                      style={{ color: outageBoltColor, textShadow: outageBoltShadow }}
                    >
                      {icon}
                    </div>
                  </div>
                ) : (
                  <div className="w-2.5 h-2.5 rounded-full border border-white/60 shadow bg-emerald-500/80" />
                )}
              </Marker>
            );
          })}
          {isCongestionRca &&
            displaySites
              .filter((s) => congestionHighlightIds.has(s.siteId) && s.siteId !== data.sourceSite.siteId && !topNeighborIds.has(s.siteId))
              .slice(0, 120)
              .map((site) => (
                <Marker key={`cong-${site.siteId}`} longitude={site.longitude} latitude={site.latitude} anchor="center">
                  <div className="w-2.5 h-2.5 rounded-full border border-orange-200 bg-orange-500 shadow" />
                </Marker>
              ))}
          {animatedFlowArrows.map((arrow) => {
            const rotationAngle = arrow.flow === 'outbound_target' ? arrow.angle + 180 : arrow.angle;
            return (
              <Marker key={`flow-arrow-${arrow.id}`} longitude={arrow.longitude} latitude={arrow.latitude} anchor="center">
                <div
                  className="select-none"
                  style={{
                    width: '0',
                    height: '0',
                    borderTop: '5px solid transparent',
                    borderBottom: '5px solid transparent',
                    borderLeft:
                      arrow.flow === 'inbound_outage'
                        ? '10px solid rgba(248,113,113,0.98)'
                        : '10px solid rgba(16,185,129,0.98)',
                    transform: `translate(-1px, 0px) rotate(${rotationAngle}deg)`,
                    filter:
                      arrow.flow === 'inbound_outage'
                        ? 'drop-shadow(0 0 6px rgba(248,113,113,0.8))'
                        : 'drop-shadow(0 0 6px rgba(16,185,129,0.8))',
                  }}
                />
              </Marker>
            );
          })}
        </MapGL>
      </div>
      <div className="text-[11px] text-text-secondary dark:text-gray-400">
        Showing {displaySites.length} sites within ~{radiusKm} km of {resolvedSourceSite.siteId}. {actualNeighborIds.size > 0 ? `${lineGeoJSON.features.filter(f => f.properties.flow !== 'inbound_outage').length} actual neighbors linked` : `${topNeighbors.length} proximity neighbors linked`}. Category: {rcaCategory}.
      </div>

      {!showRecommendations && (
        <div className="text-sm text-text-secondary dark:text-gray-300">
          Would you like solution recommendations for this issue?
        </div>
      )}

      {showRecommendations && (
        <div className="rounded-lg border border-border dark:border-slate-700 bg-white/80 dark:bg-slate-900/45 p-3">
          <div className="text-xs uppercase tracking-[0.14em] text-text-secondary dark:text-slate-300 mb-1">Solution Recommendation</div>
          {data.solutionRec ? (
            <>
              {/* Technique badge */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900/25 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-600">
                  {data.solutionRec.technique}
                </span>
              </div>

              {/* Human-readable description */}
              <div className="text-sm text-text-primary dark:text-gray-200 mb-3">
                {data.solutionRec.description}
              </div>

              {/* Parameter change detail */}
              <div className="rounded-md bg-cream-bg dark:bg-slate-800/60 border border-border dark:border-slate-700 px-3 py-2 mb-3 font-mono text-xs text-text-secondary dark:text-gray-300 space-y-1">
                <div><span className="text-text-muted dark:text-slate-400">MO Class  : </span><span className="font-semibold">{data.solutionRec.moClass}</span></div>
                <div><span className="text-text-muted dark:text-slate-400">Parameter : </span><span className="font-semibold">{data.solutionRec.moClass.toLowerCase()}.{data.solutionRec.parameter.toLowerCase()}</span></div>
                <div><span className="text-text-muted dark:text-slate-400">New Value : </span><span className="font-semibold text-green-600 dark:text-green-400">{data.solutionRec.value} {data.solutionRec.unit}</span></div>
                {data.solutionRec.targetSiteId && (
                  <div><span className="text-text-muted dark:text-slate-400">Target    : </span><span className="font-semibold">{data.solutionRec.targetSiteId}</span></div>
                )}
              </div>

              {/* Affected neighbor sites */}
              {data.solutionRec.targetNeighbors && data.solutionRec.targetNeighbors.length > 0 && (
                <div className="text-xs text-text-secondary dark:text-gray-300 space-y-1 mb-3">
                  {outageNeighborSiteId ? (
                    <div>
                      <span className="inline-block w-2 h-2 rounded-full bg-red-500/80 mr-2" />
                      Inbound outage path: {dId(outageNeighborSiteId)} → {dId(data.sourceSite.siteId)}
                    </div>
                  ) : null}
                  {data.solutionRec.targetNeighbors.map((nId) => (
                    <div key={nId}>
                      <span className="inline-block w-2 h-2 rounded-full bg-green-500/80 mr-2" />
                      Candidate neighbor: {dId(data.sourceSite.siteId)} → {dId(nId)}
                    </div>
                  ))}
                </div>
              )}

              {data.executeChoiceId && onChoiceClick ? (
                <button
                  type="button"
                  onClick={() => onChoiceClick(data.executeChoiceId as string)}
                  className="mt-1 naavik-btn-primary"
                >
                  Execute Parameter Change
                </button>
              ) : null}
            </>
          ) : (
            <div className="text-sm text-text-secondary dark:text-gray-400 italic">
              No recommendation available for this RCA type.
            </div>
          )}
        </div>
      )}

      {showReasoningModal ? (
        <div className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-[1px] flex items-center justify-center p-4" onClick={() => setShowReasoningModal(false)}>
          <div
            className="w-full max-w-5xl max-h-[86vh] overflow-auto rounded-2xl border border-cream-border dark:border-pulse-border bg-cream-surface dark:bg-pulse-surface p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-text-light-primary dark:text-text-primary">
                {dId(data.sourceSite.siteId)}
              </h2>
              <button
                type="button"
                onClick={() => setShowReasoningModal(false)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 text-text-muted dark:text-gray-400"
              >
                ✕
              </button>
            </div>
            <RCAReasoningPanel
              siteId={data.sourceSite.realSiteId || data.sourceSite.siteId}
              dateId={data.dateId}
              sourceDummySiteId={data.sourceSite.siteId}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
