/**
 * Layer Balancer — Layer Pressure Equilibrium (LPE).
 *
 * Port of services/recommender/docs/ALGORITHM_LPE.md, adapted to read from
 * the data sources Naavik already mirrors. The algorithm computes a
 * 4-component pressure vector per (cell, band) and iteratively closes the
 * gradient via mobility-parameter changes (idle priority + active CIO).
 *
 *   Inputs:
 *     - hourly_intermediate_kpis_table  → AVG_DL_PRB_UTIL, DL_DRB_TPUT
 *     - cell_table                      → CARRIER (band inference), AZIMUTH
 *
 *   Outputs:
 *     - LpePlan with per-action parameter changes + predicted pressure deltas
 *
 * Notes:
 *   - We currently approximate `active_users` and the capability mix from
 *     proxies because exact UE-cat distributions aren't always in the mirror.
 *     The pressure scoring degrades gracefully when those columns are missing.
 *   - All tuneables match the spec's default weights / thresholds.
 */
import { logger } from '../../utils/logger.js';
import { mirrorOrRemote } from '../db-mirror/lib/mirror-or-remote.js';

// ─── Tuneables (mirrors the spec) ───────────────────────────────────────────

const WEIGHTS = { L: 0.30, E: 0.15, Q: 0.35, M: 0.20 };
const TAU = 0.15;
const MAX_ITER = 6;
const PRB_THRESHOLD_PER_BAND: Record<BandName, number> = {
  'Lowband 700': 0.85,
  'PCS 1900': 0.85,
  'AWS 1700': 0.85,
  'AWS-3 2100': 0.80,
  '5G C-band': 0.80,
  'mmWave': 0.75,
  Unknown: 0.85,
};
const SE_OPTIMAL_BPS_HZ: Record<BandName, number> = {
  'Lowband 700': 4.5,
  'PCS 1900': 5.0,
  'AWS 1700': 5.5,
  'AWS-3 2100': 5.5,
  '5G C-band': 6.0,
  'mmWave': 8.0,
  Unknown: 5.0,
};
const TARGET_USER_TPUT_MBPS: Record<BandName, number> = {
  'Lowband 700': 4,
  'PCS 1900': 5,
  'AWS 1700': 15,
  'AWS-3 2100': 25,
  '5G C-band': 100,
  'mmWave': 200,
  Unknown: 10,
};
// Band ordering — higher index = higher capacity / capability requirement.
const BAND_ORDER: BandName[] = [
  'Lowband 700',
  'PCS 1900',
  'AWS 1700',
  'AWS-3 2100',
  '5G C-band',
  'mmWave',
  'Unknown',
];

// ─── Types ──────────────────────────────────────────────────────────────────

export type BandName =
  | 'Lowband 700' | 'PCS 1900' | 'AWS 1700' | 'AWS-3 2100'
  | '5G C-band' | 'mmWave' | 'Unknown';

interface LayerStats {
  cellName: string;
  sector: string;             // azimuth bucket (e.g. "A" / "B" / "C")
  band: BandName;
  prbUtil: number;            // 0..1
  prbCapMax: number;          // threshold_max for this band (0..1)
  dlTputMbps: number;         // observed avg
  avgUserTputMbps: number;    // proxy: DL_TPUT / max(1, active_users) — we use DL_TPUT directly when active_users is missing
  capabilityMix: number;      // 0..1 — fraction of users that COULD be served on a higher band (proxy: share of band capability)
}

interface PressureVec {
  P_L: number; P_E: number; P_Q: number; P_M: number; total: number;
}

export interface LpeAction {
  kind: 'idle_priority' | 'active_cio';
  fromBand: BandName;
  toBand: BandName;
  sector: string;
  cellName?: string;          // source cell name (when sector-scoped)
  paramName: 'cellReselectionPriority' | 'cellIndividualOffset';
  /** Delta to apply. Idle priority is unitless (1 step ≈ ~25% of capable idle UEs). CIO is dB. */
  delta: number;
  rationale: string;
  /** Pressure on the source layer BEFORE and AFTER this action (estimated). */
  pressureBefore: number;
  pressureAfter: number;
}

export interface LpePlan {
  baseline: Array<{ band: BandName; sector: string; cellName: string; pressure: PressureVec }>;
  postPlan: Array<{ band: BandName; sector: string; cellName: string; pressure: number }>;
  actions: LpeAction[];
  notes: string[];
}

// ─── Band inference ─────────────────────────────────────────────────────────

export function inferBand(carrier: string, tech?: string): BandName {
  const c = String(carrier || '').toUpperCase();
  const t = String(tech || '').toUpperCase();
  if (t === '5G' || /N77|N78|C[-_]?BAND/.test(c)) return '5G C-band';
  if (/MMW|28G|39G/.test(c)) return 'mmWave';
  if (/AWS[-_]?3|2100/.test(c)) return 'AWS-3 2100';
  if (/AWS[-_]?1|1700/.test(c) || /\bAWS\b/.test(c)) return 'AWS 1700';
  if (/PCS|1900/.test(c)) return 'PCS 1900';
  if (/700|LOWBAND/.test(c)) return 'Lowband 700';
  return 'Unknown';
}

function bandRank(b: BandName): number {
  return BAND_ORDER.indexOf(b);
}

// ─── Pressure computation ───────────────────────────────────────────────────

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function computePressure(layer: LayerStats, weights = WEIGHTS): PressureVec {
  // P_L — load against per-band threshold
  const P_L = clamp01(layer.prbUtil / Math.max(0.01, layer.prbCapMax));

  // P_E — spectral efficiency proxy: (observed Mbps / PRB_used_MHz) vs band's SE_optimal
  const prbMhz = Math.max(1, layer.prbUtil * 100 * 0.180); // 100 PRBs * 180 kHz (approximation)
  const seActual = (layer.dlTputMbps || 0) / prbMhz;
  const seOptimal = SE_OPTIMAL_BPS_HZ[layer.band] || 5;
  const P_E = 1 - clamp01(seActual / seOptimal);

  // P_Q — observed avg user throughput vs band SLO
  const target = TARGET_USER_TPUT_MBPS[layer.band] || 10;
  const P_Q = clamp01(1 - (layer.avgUserTputMbps || 0) / Math.max(1, target));

  // P_M — capability mismatch (proxy: share of capable users not on the right band)
  const P_M = clamp01(layer.capabilityMix || 0);

  const total = weights.L * P_L + weights.E * P_E + weights.Q * P_Q + weights.M * P_M;
  return { P_L, P_E, P_Q, P_M, total };
}

// ─── DB fetch ───────────────────────────────────────────────────────────────

interface KpiRow {
  USID: string;
  cell_name: string;
  HOUR_ID: number;
  kpi_name: string;
  kpi_value: number;
}

interface CellMetaRow {
  USID: string;
  cell_name: string;
  CARRIER: string;
  TECH?: string;
  AZIMUTH?: number;
}

async function fetchLayerInputs(usid: string, dateId: string, hour: number | null): Promise<LayerStats[]> {
  // Hourly KPIs for this site — both PRB and throughput. The strategy module
  // already filters to busyHour for congestion; for LPE on its own we let the
  // caller pass `hour` (null → take the busy-hour peak we infer here).
  const kpiRows = await mirrorOrRemote<KpiRow>({
    local: {
      sql: `SELECT usid AS "USID", cell_name, hour_id AS "HOUR_ID", kpi_name,
                   CAST(kpi_value AS FLOAT) AS kpi_value
            FROM mirror.hourly_intermediate_kpis_table
            WHERE usid = $1
              AND date_id::date = $2::date
              AND kpi_name IN ('AVG_DL_PRB_UTIL', 'DL_DRB_TPUT', 'DL_VOL_GB')`,
      params: [usid, dateId],
    },
    remote: `SELECT USID, cell_name, HOUR_ID, kpi_name, CAST(kpi_value AS FLOAT) AS kpi_value
             FROM hourly_intermediate_kpis_table WITH (NOLOCK)
             WHERE USID = '${usid}'
               AND CAST(DATE_ID AS DATE) = CAST('${dateId}' AS DATE)
               AND kpi_name IN ('AVG_DL_PRB_UTIL', 'DL_DRB_TPUT', 'DL_VOL_GB')`,
    tag: 'lpe:kpis',
  });

  if (!kpiRows.length) return [];

  // Cell metadata for band + sector inference.
  const cells = await mirrorOrRemote<CellMetaRow>({
    local: {
      sql: `SELECT usid AS "USID", cell_name, carrier AS "CARRIER",
                   tech AS "TECH", CAST(azimuth AS FLOAT) AS "AZIMUTH"
            FROM mirror.cell_table
            WHERE usid = $1`,
      params: [usid],
    },
    remote: `SELECT USID, cell_name, CARRIER, TECH, CAST(AZIMUTH AS FLOAT) AS AZIMUTH
             FROM cell_table WITH (NOLOCK)
             WHERE USID = '${usid}'`,
    tag: 'lpe:cells',
  });

  const cellMeta = new Map<string, CellMetaRow>();
  for (const c of cells) cellMeta.set(String(c.cell_name), c);

  // Aggregate per (cell, hour) → pick the offender hour (max PRB any cell).
  // We collapse over the busy hour for the LPE snapshot.
  let chosenHour = hour ?? -1;
  if (chosenHour < 0) {
    const prbByHour = new Map<number, number>();
    for (const r of kpiRows) {
      if (r.kpi_name !== 'AVG_DL_PRB_UTIL') continue;
      const h = Number(r.HOUR_ID);
      const v = Number(r.kpi_value) || 0;
      prbByHour.set(h, Math.max(prbByHour.get(h) ?? 0, v));
    }
    for (const [h, prb] of prbByHour) {
      if (prb > (prbByHour.get(chosenHour) ?? -1)) chosenHour = h;
    }
  }

  if (chosenHour < 0) return [];

  // Build per-cell snapshot at chosenHour.
  const byCell = new Map<string, { prb?: number; tput?: number; vol?: number }>();
  for (const r of kpiRows) {
    if (Number(r.HOUR_ID) !== chosenHour) continue;
    const slot = byCell.get(String(r.cell_name)) ?? {};
    if (r.kpi_name === 'AVG_DL_PRB_UTIL') slot.prb = Number(r.kpi_value);
    if (r.kpi_name === 'DL_DRB_TPUT') slot.tput = Number(r.kpi_value);
    if (r.kpi_name === 'DL_VOL_GB') slot.vol = Number(r.kpi_value);
    byCell.set(String(r.cell_name), slot);
  }

  const layers: LayerStats[] = [];
  for (const [cellName, slot] of byCell.entries()) {
    const meta = cellMeta.get(cellName);
    const band = inferBand(meta?.CARRIER ?? '', meta?.TECH);
    const az = Number(meta?.AZIMUTH);
    const sector = sectorBucket(az);
    const prb = clamp01((slot.prb ?? 0) / 100); // KPIs are 0..100 typically
    const tputMbps = slot.tput ?? 0;
    // Proxy for avg user throughput when active_users isn't broken out:
    // tput / max(1, prb*nUsers). Without a UE count, use raw tput — biases
    // P_Q upward at low load; we accept the noise.
    const avgUserTput = tputMbps;
    // Capability-mix proxy: we don't have UE-cat distributions in the mirror,
    // so we approximate via band rank — lower bands carry more capability
    // headroom. This is intentionally simple; calibrated later via outcome
    // tracker (spec §8).
    const capabilityMix = bandRank(band) >= 0 && bandRank(band) < BAND_ORDER.length - 1
      ? Math.max(0, 0.3 + 0.15 * (BAND_ORDER.length - 2 - bandRank(band)))
      : 0;

    layers.push({
      cellName,
      sector,
      band,
      prbUtil: prb,
      prbCapMax: PRB_THRESHOLD_PER_BAND[band] ?? 0.85,
      dlTputMbps: tputMbps,
      avgUserTputMbps: avgUserTput,
      capabilityMix,
    });
  }

  return layers;
}

function sectorBucket(azimuth: number): string {
  if (!Number.isFinite(azimuth)) return '?';
  // Three 120° sectors named A/B/C — matches AT&T's typical 3-sector macro.
  const az = ((azimuth % 360) + 360) % 360;
  if (az < 120) return 'A';
  if (az < 240) return 'B';
  return 'C';
}

// ─── Gradient + flow translation ────────────────────────────────────────────

interface LayerScored {
  layer: LayerStats;
  pressure: PressureVec;
}

/** Build feasible (i, j) pairs within the same sector with j a higher band. */
function feasiblePairs(scored: LayerScored[]): Array<[LayerScored, LayerScored, number]> {
  const out: Array<[LayerScored, LayerScored, number]> = [];
  // Group by sector
  const bySector = new Map<string, LayerScored[]>();
  for (const s of scored) {
    if (!bySector.has(s.layer.sector)) bySector.set(s.layer.sector, []);
    bySector.get(s.layer.sector)!.push(s);
  }
  for (const group of bySector.values()) {
    for (const i of group) {
      for (const j of group) {
        if (i === j) continue;
        // Spec: layer_j.band > layer_i.band, AND there's a capability pool.
        if (bandRank(j.layer.band) <= bandRank(i.layer.band)) continue;
        const dp = i.pressure.total - j.pressure.total;
        if (dp <= 0) continue;
        out.push([i, j, dp]);
      }
    }
  }
  return out;
}

/** Idle-priority delta — log scale of target flow vs total idle pool, clamped 1-4. */
function priorityDelta(targetFlow: number, idlePoolEstimate: number): number {
  if (idlePoolEstimate <= 0) return 1;
  const ratio = Math.max(1e-3, targetFlow / Math.max(1e-3, idlePoolEstimate));
  const d = Math.log2(ratio) * 4;
  return Math.min(4, Math.max(1, Math.round(Number.isFinite(d) ? d : 1)));
}

/** Active-mode CIO delta — empirical 5% share shift per dB, clamped 0.5..6.0. */
function cioDelta(targetShareChange: number): number {
  const dB = targetShareChange / 0.05;
  return Math.min(6, Math.max(0.5, Math.round(dB * 2) / 2));  // half-dB rounding
}

// ─── Simulator ──────────────────────────────────────────────────────────────

/** Re-score one layer after a virtual flow movement (additive). */
function simulatePressureAfter(layer: LayerStats, deltaPrbAbs: number): PressureVec {
  const adjusted: LayerStats = {
    ...layer,
    prbUtil: clamp01(layer.prbUtil + deltaPrbAbs),
  };
  return computePressure(adjusted);
}

// ─── Public entry ───────────────────────────────────────────────────────────

/**
 * Run the LPE solver for a site. Returns the baseline pressure snapshot,
 * the post-plan pressure, and the action list. When the site has fewer
 * than 2 layers per sector (single-band, or unknown carriers), returns an
 * empty plan with a `notes` reason — callers should not surface an empty
 * "layer move" action in that case.
 */
export async function runLpe(
  siteId: string,
  dateId: string,
  options: { hour?: number } = {},
): Promise<LpePlan> {
  const layers = await fetchLayerInputs(siteId, dateId, options.hour ?? null);
  if (layers.length === 0) {
    return { baseline: [], postPlan: [], actions: [], notes: ['No hourly KPI data found for this site / date.'] };
  }
  const scored: LayerScored[] = layers.map((l) => ({ layer: l, pressure: computePressure(l) }));
  const baseline = scored.map((s) => ({
    band: s.layer.band, sector: s.layer.sector, cellName: s.layer.cellName, pressure: s.pressure,
  }));

  // Single-layer-per-sector → nothing to balance
  const sectorCounts = new Map<string, number>();
  for (const s of scored) sectorCounts.set(s.layer.sector, (sectorCounts.get(s.layer.sector) ?? 0) + 1);
  const balanceable = Array.from(sectorCounts.values()).some((n) => n > 1);
  if (!balanceable) {
    return {
      baseline,
      postPlan: scored.map((s) => ({ band: s.layer.band, sector: s.layer.sector, cellName: s.layer.cellName, pressure: s.pressure.total })),
      actions: [],
      notes: ['Single-band site (per sector) — LPE has nothing to balance. Consider traffic_balancer for cross-site relief.'],
    };
  }

  const plan: LpeAction[] = [];
  const notes: string[] = [];
  let working = scored.map((s) => ({ ...s, pressure: { ...s.pressure } }));

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const pairs = feasiblePairs(working);
    if (!pairs.length) {
      notes.push('No feasible layer-flow pairs remain — gradient is flat in the upward direction.');
      break;
    }
    pairs.sort((a, b) => b[2] - a[2]);
    const [i, j, maxDelta] = pairs[0];
    if (maxDelta < TAU) {
      notes.push(`Max ΔP ${maxDelta.toFixed(2)} < tolerance ${TAU} — equilibrium reached.`);
      break;
    }

    // Target flow: half-distance times destination capacity headroom.
    const targetFlow = (maxDelta / 2) * Math.max(0, j.layer.prbCapMax - j.layer.prbUtil);
    if (targetFlow <= 0.01) {
      notes.push(`Destination ${j.layer.band} sector ${j.layer.sector} has no headroom — skipping.`);
      // Drop this pair so we don't loop on it forever; perturb working set.
      i.pressure.total = i.pressure.total - 0.001;
      continue;
    }

    // Translate flow to params.
    // Idle priority: estimate idle pool as 1 - prbUtil on source side (rough).
    const idlePool = Math.max(0.05, 1 - i.layer.prbUtil);
    const deltaPrio = priorityDelta(targetFlow, idlePool);
    // Active CIO: convert target flow into a share shift on source.
    const sourceShare = Math.max(0.05, i.layer.prbUtil);
    const targetShareChange = targetFlow / sourceShare;
    const deltaDb = cioDelta(targetShareChange);

    const pressureBeforeI = i.pressure.total;
    const pressureAfterI = simulatePressureAfter(i.layer, -targetFlow).total;
    const pressureAfterJ = simulatePressureAfter(j.layer, +targetFlow).total;

    plan.push({
      kind: 'idle_priority',
      fromBand: i.layer.band,
      toBand: j.layer.band,
      sector: i.layer.sector,
      cellName: j.layer.cellName,
      paramName: 'cellReselectionPriority',
      delta: deltaPrio,
      rationale:
        `Sector ${i.layer.sector}: pressure on ${i.layer.band} is ${pressureBeforeI.toFixed(2)} vs ${j.pressure.total.toFixed(2)} on ${j.layer.band}. ` +
        `Bumping cellReselectionPriority on ${j.layer.band} by ${deltaPrio} step${deltaPrio === 1 ? '' : 's'} shifts idle UEs toward it.`,
      pressureBefore: pressureBeforeI,
      pressureAfter: pressureAfterI,
    });
    plan.push({
      kind: 'active_cio',
      fromBand: i.layer.band,
      toBand: j.layer.band,
      sector: i.layer.sector,
      cellName: i.layer.cellName,
      paramName: 'cellIndividualOffset',
      delta: deltaDb,
      rationale:
        `Sector ${i.layer.sector}: shift ~${Math.round(targetShareChange * 100)}% of active load from ${i.layer.band} to ${j.layer.band} via +${deltaDb} dB CIO.`,
      pressureBefore: pressureBeforeI,
      pressureAfter: pressureAfterI,
    });

    // Update working set so the next iteration sees the new equilibrium.
    i.layer.prbUtil = clamp01(i.layer.prbUtil - targetFlow);
    j.layer.prbUtil = clamp01(j.layer.prbUtil + targetFlow);
    i.pressure = computePressure(i.layer);
    j.pressure = computePressure(j.layer);
  }

  const postPlan = working.map((s) => ({
    band: s.layer.band, sector: s.layer.sector, cellName: s.layer.cellName, pressure: s.pressure.total,
  }));

  if (plan.length === 0) {
    notes.push('System already at equilibrium — no LM action needed.');
  }

  logger.info(`[lpe] ${siteId} ${dateId} layers=${layers.length} actions=${plan.length}`);
  return { baseline, postPlan, actions: plan, notes };
}
