/**
 * Outage Tilt Optimizer — geometric "directed-reach" tilt selector.
 *
 * Port of services/recommender/docs/TOOLS.md §Tool 2. Identifies neighbour
 * cells that can extend coverage into an outage area by reducing electrical
 * antenna tilt, with a hard safety cap on per-cell tilt deltas.
 *
 * Reads:
 *   - cell_table        — coordinates, AZIMUTH, electrical tilt (RET), HEIGHT
 *   - hourly_intermediate_kpis_table  — neighbour PRB to gate against
 *                                       loading up an already-busy neighbour
 */
import { logger } from '../../utils/logger.js';
import { mirrorOrRemote } from '../db-mirror/lib/mirror-or-remote.js';

const COVERAGE_RADIUS_TARGET_M = 500;
const SAFETY_MAX_TILT_DEG = 3;
const SEARCH_RADIUS_M = 2000;
const NEIGHBOR_PRB_CEILING = 0.65;       // skip neighbours already this busy
const HALF_BEAMWIDTH_V_DEG = 4;          // typical macro antenna
const MAX_AZIMUTH_OFFSET_DEG = 60;       // outside main lobe → skip

// ─── Types ──────────────────────────────────────────────────────────────────

interface OutageSite {
  USID: string;
  cell_name: string;
  LATITUDE: number;
  LONGITUDE: number;
  AZIMUTH: number;
  HEIGHT: number;
  ELECTRICALANTENNATILT?: number;
}

interface NeighborCell {
  USID: string;
  cell_name: string;
  LATITUDE: number;
  LONGITUDE: number;
  AZIMUTH: number;
  HEIGHT: number;
  ELECTRICALANTENNATILT?: number;
  prbAvg?: number;
}

export interface TiltCandidate {
  usid: string;
  cellName: string;
  bearingToOutageDeg: number;
  azimuthOffsetDeg: number;
  distanceM: number;
  currentTiltDeg: number;
  recommendedNewTiltDeg: number;
  deltaTiltDeg: number;            // negative = reduce down-tilt
  currentAvgPrb: number;
  expectedCoverageExtensionM: number;
  score: number;
  rationale: string;
}

export interface OutageTiltPlan {
  outage: { usid: string; lat: number; lon: number };
  candidates: TiltCandidate[];
  uncoveredZones: Array<{ note: string }>;
  notes: string[];
}

// ─── Math ───────────────────────────────────────────────────────────────────

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

function haversineMeters(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6371000;
  const dLa = toRad(la2 - la1);
  const dLo = toRad(lo2 - lo1);
  const a = Math.sin(dLa / 2) ** 2 +
    Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function bearingDeg(la1: number, lo1: number, la2: number, lo2: number): number {
  const φ1 = toRad(la1), φ2 = toRad(la2);
  const λ1 = toRad(lo1), λ2 = toRad(lo2);
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  const θ = Math.atan2(y, x);
  return (toDeg(θ) + 360) % 360;
}

function angularDiff(a: number, b: number): number {
  // Signed shortest angular distance in degrees, range [-180, 180]
  let d = ((b - a + 180) % 360) - 180;
  if (d < -180) d += 360;
  return Math.abs(d);
}

/** Tilt-to-range empirical map (HATA-lite). Range where signal is still ≥ -3 dB of cell edge. */
function rangeMetersFromTilt(heightM: number, tiltDeg: number): number {
  const totalDownDeg = Math.max(0.5, tiltDeg + HALF_BEAMWIDTH_V_DEG);
  return heightM / Math.tan(toRad(totalDownDeg));
}

function tiltForRange(heightM: number, targetRangeM: number): number {
  // Inverse of rangeMetersFromTilt — solve for tiltDeg.
  return toDeg(Math.atan(heightM / Math.max(1, targetRangeM))) - HALF_BEAMWIDTH_V_DEG;
}

// ─── DB fetch ───────────────────────────────────────────────────────────────

async function fetchOutageSite(usid: string, dateId: string): Promise<OutageSite | null> {
  const rows = await mirrorOrRemote<OutageSite>({
    local: {
      sql: `SELECT usid AS "USID", cell_name,
                   CAST(latitude AS FLOAT) AS "LATITUDE",
                   CAST(longitude AS FLOAT) AS "LONGITUDE",
                   CAST(azimuth AS FLOAT) AS "AZIMUTH",
                   CAST(height AS FLOAT) AS "HEIGHT"
            FROM mirror.cell_table
            WHERE usid = $1
            LIMIT 12`,
      params: [usid],
    },
    remote: `SELECT TOP 12 USID, cell_name,
                CAST(LATITUDE AS FLOAT) AS LATITUDE,
                CAST(LONGITUDE AS FLOAT) AS LONGITUDE,
                CAST(AZIMUTH AS FLOAT) AS AZIMUTH,
                CAST(HEIGHT AS FLOAT) AS HEIGHT
             FROM cell_table WITH (NOLOCK)
             WHERE USID = '${usid}'`,
    tag: 'tilt:outage-site',
  });
  if (!rows.length) return null;
  // Pick the first cell with valid coords; outage strategy treats sectors as
  // interchangeable for the "outage area centre" approximation.
  const c = rows.find((r) => Number.isFinite(Number(r.LATITUDE)) && Number.isFinite(Number(r.LONGITUDE)));
  if (!c) return null;
  void dateId;
  return c;
}

interface NeighborQueryRow extends NeighborCell {}

async function fetchNeighborsInRadius(
  centerLat: number,
  centerLon: number,
  dateId: string,
): Promise<NeighborCell[]> {
  // We use a bounding box prefilter, then haversine-trim client-side.
  // 1 deg latitude ≈ 111 km; 1 deg lon ≈ 111 km × cos(lat).
  const latDelta = SEARCH_RADIUS_M / 111_000;
  const lonDelta = SEARCH_RADIUS_M / (111_000 * Math.cos(toRad(centerLat)));
  const minLat = centerLat - latDelta;
  const maxLat = centerLat + latDelta;
  const minLon = centerLon - lonDelta;
  const maxLon = centerLon + lonDelta;

  const rows = await mirrorOrRemote<NeighborQueryRow>({
    local: {
      sql: `SELECT DISTINCT ON (usid, cell_name)
                   usid AS "USID", cell_name,
                   CAST(latitude AS FLOAT) AS "LATITUDE",
                   CAST(longitude AS FLOAT) AS "LONGITUDE",
                   CAST(azimuth AS FLOAT) AS "AZIMUTH",
                   CAST(height AS FLOAT) AS "HEIGHT"
            FROM mirror.cell_table
            WHERE latitude BETWEEN $1 AND $2
              AND longitude BETWEEN $3 AND $4`,
      params: [minLat, maxLat, minLon, maxLon],
    },
    remote: `SELECT USID, cell_name,
                CAST(LATITUDE AS FLOAT) AS LATITUDE,
                CAST(LONGITUDE AS FLOAT) AS LONGITUDE,
                CAST(AZIMUTH AS FLOAT) AS AZIMUTH,
                CAST(HEIGHT AS FLOAT) AS HEIGHT
             FROM cell_table WITH (NOLOCK)
             WHERE LATITUDE BETWEEN ${minLat} AND ${maxLat}
               AND LONGITUDE BETWEEN ${minLon} AND ${maxLon}`,
    tag: 'tilt:neighbors',
  });

  // Haversine-trim to the actual search radius.
  const trimmed = rows.filter((r) =>
    haversineMeters(centerLat, centerLon, Number(r.LATITUDE), Number(r.LONGITUDE)) <= SEARCH_RADIUS_M,
  );

  // Attach 24h-avg PRB for capacity gating.
  const usids = Array.from(new Set(trimmed.map((r) => String(r.USID))));
  if (!usids.length) return trimmed;
  const placeholders = usids.map((_, i) => `$${i + 2}`).join(',');
  const inListSql = usids.map((u) => `'${u.replace(/'/g, "''")}'`).join(',');
  const prbRows = await mirrorOrRemote<{ USID: string; prbAvg: number }>({
    local: {
      sql: `SELECT usid AS "USID", AVG(CAST(kpi_value AS FLOAT))::float AS "prbAvg"
            FROM mirror.hourly_intermediate_kpis_table
            WHERE usid IN (${placeholders})
              AND kpi_name = 'AVG_DL_PRB_UTIL'
              AND date_id::date >= ($1::date - INTERVAL '1 day')
            GROUP BY usid`,
      params: [dateId, ...usids],
    },
    remote: `SELECT USID, AVG(CAST(kpi_value AS FLOAT)) AS prbAvg
             FROM hourly_intermediate_kpis_table WITH (NOLOCK)
             WHERE USID IN (${inListSql})
               AND kpi_name = 'AVG_DL_PRB_UTIL'
               AND CAST(DATE_ID AS DATE) >= DATEADD(day, -1, CAST('${dateId}' AS DATE))
             GROUP BY USID`,
    tag: 'tilt:neighbor-prb',
  });
  const prbByUsid = new Map<string, number>();
  for (const p of prbRows) prbByUsid.set(String(p.USID), Number(p.prbAvg) / 100);

  for (const r of trimmed) r.prbAvg = prbByUsid.get(String(r.USID));
  return trimmed;
}

// ─── Public entry ───────────────────────────────────────────────────────────

export async function runOutageTilt(
  outageUsid: string,
  dateId: string,
): Promise<OutageTiltPlan> {
  const outage = await fetchOutageSite(outageUsid, dateId);
  if (!outage) {
    return {
      outage: { usid: outageUsid, lat: NaN, lon: NaN },
      candidates: [],
      uncoveredZones: [],
      notes: [`No cell coordinates found for USID ${outageUsid}.`],
    };
  }

  const neighbors = await fetchNeighborsInRadius(
    Number(outage.LATITUDE), Number(outage.LONGITUDE), dateId,
  );

  // Drop the outage site's own cells from the neighbour pool.
  const candidates: TiltCandidate[] = [];
  const notes: string[] = [];
  let unreachableCount = 0;

  for (const n of neighbors) {
    if (String(n.USID) === String(outageUsid)) continue;
    const lat = Number(n.LATITUDE);
    const lon = Number(n.LONGITUDE);
    const az = Number(n.AZIMUTH);
    const height = Number(n.HEIGHT) || 30;
    const tilt = Number(n.ELECTRICALANTENNATILT) || 6;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(az)) continue;

    const distance = haversineMeters(lat, lon, Number(outage.LATITUDE), Number(outage.LONGITUDE));
    if (distance > 2 * COVERAGE_RADIUS_TARGET_M) {
      unreachableCount++;
      continue;
    }

    const brg = bearingDeg(lat, lon, Number(outage.LATITUDE), Number(outage.LONGITUDE));
    const offset = angularDiff(az, brg);
    if (offset > MAX_AZIMUTH_OFFSET_DEG) continue;

    const prbAvg = n.prbAvg ?? 0;
    if (prbAvg > NEIGHBOR_PRB_CEILING) continue;

    const currentRange = rangeMetersFromTilt(height, tilt);
    const requiredRange = distance + COVERAGE_RADIUS_TARGET_M;
    if (currentRange >= requiredRange) continue;

    const newTilt = tiltForRange(height, requiredRange);
    let deltaTilt = tilt - newTilt;
    deltaTilt = Math.min(SAFETY_MAX_TILT_DEG, Math.max(0.5, deltaTilt));

    const coverageExtension = rangeMetersFromTilt(height, tilt - deltaTilt) - currentRange;

    const alignmentScore = 1 - offset / MAX_AZIMUTH_OFFSET_DEG;
    const capacityScore = Math.max(0, 1 - prbAvg / NEIGHBOR_PRB_CEILING);
    const riskScore = 1 - deltaTilt / SAFETY_MAX_TILT_DEG;
    const score =
      alignmentScore * 0.5 + capacityScore * 0.3 + riskScore * 0.2;

    candidates.push({
      usid: String(n.USID),
      cellName: String(n.cell_name),
      bearingToOutageDeg: Math.round(brg),
      azimuthOffsetDeg: Math.round(offset),
      distanceM: Math.round(distance),
      currentTiltDeg: Math.round(tilt * 10) / 10,
      recommendedNewTiltDeg: Math.round((tilt - deltaTilt) * 10) / 10,
      deltaTiltDeg: -Math.round(deltaTilt * 10) / 10,    // negative → reduce downtilt
      currentAvgPrb: Math.round(prbAvg * 1000) / 10,     // as percent
      expectedCoverageExtensionM: Math.round(coverageExtension),
      score: Math.round(score * 1000) / 1000,
      rationale:
        `Sector points within ${Math.round(offset)}° of the outage area, ` +
        `has ${Math.round((1 - prbAvg) * 100)}% PRB headroom, and reducing tilt by ${deltaTilt.toFixed(1)}° ` +
        `extends coverage to within ${Math.round(coverageExtension)} m of the outage core.`,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, 3);
  if (!top.length) {
    notes.push(unreachableCount
      ? `No neighbour cells inside the alignment cone are below the ${(NEIGHBOR_PRB_CEILING * 100).toFixed(0)}% PRB ceiling.`
      : 'No neighbour cells point toward the outage area within the configured radius.');
  }

  logger.info(`[outage-tilt] ${outageUsid} candidates=${top.length}/${candidates.length}`);
  return {
    outage: { usid: outageUsid, lat: Number(outage.LATITUDE), lon: Number(outage.LONGITUDE) },
    candidates: top,
    uncoveredZones: top.length === 0
      ? [{ note: 'No neighbour can reach within 60° cone — escalate hardware ticket immediately.' }]
      : [],
    notes,
  };
}
