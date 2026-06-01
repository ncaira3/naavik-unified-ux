/**
 * Congestion strategy — emits concrete traffic-steering actions.
 *
 * Two action families:
 *   1. Load shed (traffic_balancer)
 *        For each top neighbour with PRB headroom at the offender's busy
 *        hour, recommend a `cellIndividualOffset` shift in dB.
 *   2. Layer move (layer_balancer / LPE-lite)
 *        If multiple congested cells share a band and a co-located neighbour
 *        carrier has headroom, recommend moving the busy hour onto it via
 *        `qRxLevMin` on the destination layer.
 *
 * Both algorithms read the same data the rest of Naavik already mirrors —
 * `hourly_intermediate_kpis_table` (AVG_DL_PRB_UTIL) and
 * `neighbors_table_date_id` (HO share + distance).
 *
 * The output is an action plan; the engineer reads it, copies the change,
 * and applies it via whatever change-management tool they use. No Provision
 * handoff here by design.
 */
import { logger } from '../../utils/logger.js';
import { mirrorOrRemote } from '../db-mirror/lib/mirror-or-remote.js';
import type { RecommendedAction, StrategyContext, StrategyOutput } from './types.js';
import { runLpe } from './layer-balancer.js';
import { simulateAction, type SimContext } from './action-simulator.js';

// Thresholds the strategy uses to decide what to suggest.
const CONGESTION_THRESHOLD_PRB = 75;   // % — sectors above this are congested
const SAFETY_MARGIN_PP = 5;            // pp — never push a neighbour past (threshold - safety)
const NEIGHBOR_LIMIT = 8;              // top N neighbours considered for load shed
const MAX_CIO_DB = 4;                  // hard cap on the recommended CIO shift

// ─── DB row shapes ──────────────────────────────────────────────────────────

interface HourlyPrbRow {
  USID: string;
  cell_name: string;
  HOUR_ID: number;
  kpi_value: number;
}

interface NeighborRow {
  NEIGH_USID: string;
  NEIGH_USID_FACE: string;
  SOURCE_USID_FACE: string;
  PERC_HANDOVER: number;             // 0..1
  SOURCE_NEIGH_DISTANCE_METERS: number;
}

// ─── Queries ────────────────────────────────────────────────────────────────

async function fetchOffenderPrbProfile(usid: string, dateId: string): Promise<HourlyPrbRow[]> {
  return mirrorOrRemote<HourlyPrbRow>({
    local: {
      sql: `SELECT usid AS "USID", cell_name, hour_id AS "HOUR_ID",
                   CAST(kpi_value AS FLOAT) AS kpi_value
            FROM mirror.hourly_intermediate_kpis_table
            WHERE usid = $1
              AND kpi_name = 'AVG_DL_PRB_UTIL'
              AND date_id::date = $2::date
            ORDER BY hour_id`,
      params: [usid, dateId],
    },
    remote: `SELECT USID, cell_name, HOUR_ID, CAST(kpi_value AS FLOAT) AS kpi_value
             FROM hourly_intermediate_kpis_table WITH (NOLOCK)
             WHERE USID = '${usid}'
               AND kpi_name = 'AVG_DL_PRB_UTIL'
               AND CAST(DATE_ID AS DATE) = CAST('${dateId}' AS DATE)
             ORDER BY HOUR_ID`,
    tag: 'congestion-strategy:offender-prb',
  });
}

async function fetchTopNeighbors(usid: string, dateId: string): Promise<NeighborRow[]> {
  return mirrorOrRemote<NeighborRow>({
    local: {
      sql: `SELECT neigh_usid AS "NEIGH_USID",
                   neigh_usid_face AS "NEIGH_USID_FACE",
                   source_usid_face AS "SOURCE_USID_FACE",
                   CAST(perc_handover AS FLOAT) AS "PERC_HANDOVER",
                   CAST(source_neigh_distance_meters AS FLOAT) AS "SOURCE_NEIGH_DISTANCE_METERS"
            FROM mirror.neighbors_table_date_id
            WHERE source_usid = $1
              AND date_id::date = $2::date
            ORDER BY ho_rank ASC
            LIMIT ${NEIGHBOR_LIMIT}`,
      params: [usid, dateId],
    },
    remote: `SELECT TOP ${NEIGHBOR_LIMIT}
                NEIGH_USID, NEIGH_USID_FACE, SOURCE_USID_FACE,
                CAST(PERC_HANDOVER AS FLOAT) AS PERC_HANDOVER,
                CAST(SOURCE_NEIGH_DISTANCE_METERS AS FLOAT) AS SOURCE_NEIGH_DISTANCE_METERS
             FROM neighbors_table_date_id WITH (NOLOCK)
             WHERE SOURCE_USID = '${usid}'
               AND CAST(DATE_ID AS DATE) = CAST('${dateId}' AS DATE)
             ORDER BY HO_RANK ASC`,
    tag: 'congestion-strategy:neighbors',
  });
}

async function fetchNeighborsPrbProfile(usidList: string[], dateId: string): Promise<HourlyPrbRow[]> {
  if (!usidList.length) return [];
  const placeholders = usidList.map((_, i) => `$${i + 2}`).join(',');
  const inListSql = usidList.map((u) => `'${String(u).replace(/'/g, "''")}'`).join(',');
  return mirrorOrRemote<HourlyPrbRow>({
    local: {
      sql: `SELECT usid AS "USID", cell_name, hour_id AS "HOUR_ID",
                   AVG(CAST(kpi_value AS FLOAT))::float AS kpi_value
            FROM mirror.hourly_intermediate_kpis_table
            WHERE usid IN (${placeholders}) -- args 2+
              AND kpi_name = 'AVG_DL_PRB_UTIL'
              AND date_id::date = $1::date
            GROUP BY usid, cell_name, hour_id`,
      params: [dateId, ...usidList],
    },
    remote: `SELECT USID, cell_name, HOUR_ID,
                AVG(CAST(kpi_value AS FLOAT)) AS kpi_value
             FROM hourly_intermediate_kpis_table WITH (NOLOCK)
             WHERE USID IN (${inListSql})
               AND kpi_name = 'AVG_DL_PRB_UTIL'
               AND CAST(DATE_ID AS DATE) = CAST('${dateId}' AS DATE)
             GROUP BY USID, cell_name, HOUR_ID`,
    tag: 'congestion-strategy:neighbor-prb',
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function pickBusyHour(offender: HourlyPrbRow[]): number | null {
  if (!offender.length) return null;
  const byHour = new Map<number, number>();
  for (const r of offender) {
    byHour.set(Number(r.HOUR_ID), Math.max(byHour.get(Number(r.HOUR_ID)) ?? 0, Number(r.kpi_value) || 0));
  }
  let best = -1;
  let bestPrb = -1;
  for (const [h, prb] of byHour.entries()) {
    if (prb > bestPrb) {
      bestPrb = prb;
      best = h;
    }
  }
  return best >= 0 ? best : null;
}

function neighborHourlyAvg(
  neighborRows: HourlyPrbRow[],
  neighUsid: string,
  hour: number,
): number {
  const matches = neighborRows.filter(
    (r) => String(r.USID) === String(neighUsid) && Number(r.HOUR_ID) === hour,
  );
  if (!matches.length) return Number.NaN;
  const avg = matches.reduce((s, r) => s + (Number(r.kpi_value) || 0), 0) / matches.length;
  return avg;
}

function recommendedCioShift(headroomPp: number, currentHoShare: number): number {
  // Neighbours already taking traffic are mechanically easier to push more
  // onto (smaller offset needed). Translate headroom into a dB ask, capped
  // at MAX_CIO_DB so we never recommend an aggressive shift in one go.
  //   0-10 pp headroom  → 1 dB
  //   10-20 pp           → 2 dB
  //   20-30 pp           → 3 dB
  //   30+ pp             → 4 dB
  // Bump down 1 dB when the neighbour already handles >25% of HOs.
  let dB = 1;
  if (headroomPp >= 10) dB = 2;
  if (headroomPp >= 20) dB = 3;
  if (headroomPp >= 30) dB = 4;
  if (currentHoShare > 0.25) dB = Math.max(1, dB - 1);
  return Math.min(MAX_CIO_DB, dB);
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function buildCongestionStrategy(ctx: StrategyContext): Promise<StrategyOutput> {
  const { siteId, date } = ctx;
  const tStart = Date.now();

  // Fetch all three datasets in parallel — saves 2-3 round-trips' worth of latency.
  let offender: HourlyPrbRow[] = [];
  let neighbors: NeighborRow[] = [];
  try {
    [offender, neighbors] = await Promise.all([
      fetchOffenderPrbProfile(siteId, date),
      fetchTopNeighbors(siteId, date),
    ]);
  } catch (err) {
    logger.warn(`[congestion-strategy] data fetch failed for ${siteId} ${date}`, err);
  }
  logger.info(`[congestion-strategy] offender+neighbors fetched in ${Date.now() - tStart}ms`);

  const busyHour = pickBusyHour(offender);
  const offenderBhPrb = busyHour != null
    ? Math.max(0, ...offender.filter((r) => Number(r.HOUR_ID) === busyHour).map((r) => Number(r.kpi_value) || 0))
    : 0;

  // If we have no offender PRB data, fall back to a generic congestion playbook.
  if (busyHour == null) {
    return {
      headline: 'Traffic-driven congestion — narrow the busy hour and rebalance load.',
      confidence: 'medium',
      actions: [
        {
          kind: 'load_shed',
          title: 'Shift load to neighbour cells (traffic balancer)',
          rationale:
            'Identify neighbours of the offender sector with PRB headroom at the busy hour and shift handover share via cellIndividualOffset.',
          confidence: 'medium',
          params: [
            { paramName: 'cellIndividualOffset', change: 'Increase by 1-4 dB toward an under-loaded neighbour' },
          ],
        },
        {
          kind: 'layer_move',
          title: 'Balance layers (layer balancer / LPE)',
          rationale:
            'If multiple sectors share a band, pull the busy hour onto a co-located layer with headroom via qRxLevMin on the destination layer.',
          confidence: 'medium',
          params: [{ paramName: 'qRxLevMin', change: 'Lower on the destination layer to make it more selectable' }],
        },
        {
          kind: 'capacity',
          title: 'Schedule capacity add if soft fixes don’t clear the BH in 7 days',
          rationale: 'Persistent organic growth in this sector warrants a capacity recommendation.',
          confidence: 'low',
        },
      ],
    };
  }

  // Pull neighbour PRB profiles at the offender's busy hour only — cheaper.
  const neighborUsids = neighbors.map((n) => String(n.NEIGH_USID)).filter(Boolean);
  let neighborRows: HourlyPrbRow[] = [];
  try {
    neighborRows = await fetchNeighborsPrbProfile(neighborUsids, date);
  } catch (err) {
    logger.warn('[congestion-strategy] neighbor PRB fetch failed', err);
  }

  // Score each neighbour at the busy hour.
  const ceiling = CONGESTION_THRESHOLD_PRB - SAFETY_MARGIN_PP;  // never push past this
  const candidates = neighbors
    .map((n) => {
      const neighborPrb = neighborHourlyAvg(neighborRows, String(n.NEIGH_USID), busyHour);
      const headroomPp = Number.isFinite(neighborPrb) ? Math.max(0, ceiling - neighborPrb) : Number.NaN;
      return {
        neighborUsid: String(n.NEIGH_USID),
        neighborFace: String(n.NEIGH_USID_FACE ?? ''),
        sourceFace: String(n.SOURCE_USID_FACE ?? ''),
        currentHoShare: Number(n.PERC_HANDOVER) || 0,
        distance: Number(n.SOURCE_NEIGH_DISTANCE_METERS) || NaN,
        neighborPrb,
        headroomPp,
      };
    })
    .filter((c) => Number.isFinite(c.headroomPp) && c.headroomPp > 0)
    .sort((a, b) => b.headroomPp - a.headroomPp);

  const actions: RecommendedAction[] = [];

  // Action 1 — load-shed
  if (candidates.length) {
    const top3 = candidates.slice(0, 3);
    const shedDetails = top3.map((c) => ({
      neighborUsid: c.neighborUsid,
      neighborFace: c.neighborFace,
      currentHoShare: Math.round(c.currentHoShare * 1000) / 1000,
      neighborPrbHeadroom: Math.round(c.headroomPp),
      paramName: 'cellIndividualOffset',
      deltaDb: recommendedCioShift(c.headroomPp, c.currentHoShare),
    }));
    actions.push({
      kind: 'load_shed',
      title: `Shift load to ${top3.length} under-loaded neighbour${top3.length === 1 ? '' : 's'}`,
      rationale:
        `Offender busy hour is ${formatHour(busyHour)} at ~${Math.round(offenderBhPrb)}% PRB. ` +
        `Top neighbours have ${top3[0].headroomPp.toFixed(0)}-${top3[top3.length - 1].headroomPp.toFixed(0)} pp of headroom at the same hour. ` +
        `Adjust cellIndividualOffset on the offender's serving cell to bias handovers toward them.`,
      confidence: top3[0].headroomPp >= 15 ? 'high' : 'medium',
      loadShed: shedDetails,
      params: shedDetails.map((s) => ({
        paramName: 'cellIndividualOffset',
        scope: `Toward NEIGH ${s.neighborUsid}`,
        change: `Increase by ${s.deltaDb} dB`,
        description: 'Per-neighbour offset applied on the source cell that biases reselection / handover decisions toward this neighbour.',
        impact: 'Larger positive values favour this neighbour. Combined with PERC_HANDOVER, controls how much traffic spills over to that cell.',
      })),
      evidence: top3.map((c) =>
        `NEIGH ${c.neighborUsid} (${c.neighborFace || '?'}): PRB ${c.neighborPrb.toFixed(0)}% at ${formatHour(busyHour)}, ` +
        `HO share ${(c.currentHoShare * 100).toFixed(1)}%, ${c.distance ? `${c.distance.toFixed(0)} m` : 'distance n/a'}`,
      ),
    });
  } else {
    actions.push({
      kind: 'load_shed',
      title: 'Neighbour headroom check inconclusive',
      rationale:
        `Offender busy hour is ${formatHour(busyHour)} at ~${Math.round(offenderBhPrb)}% PRB but none of the top neighbours have PRB headroom at the same hour (or PRB data is missing). ` +
        'A capacity-add plan is the likely next step.',
      confidence: 'low',
      params: [],
    });
  }

  // Action 2 — layer balance. Run the LPE solver with a hard 3-second time
  // cap so it can't make the whole RCA path slow. If LPE doesn't finish in
  // time we drop the layer-move action and let the load-shed + capacity
  // recommendations carry the answer. LPE result is cached at the strategy
  // layer (above) so the second call is instant.
  try {
    const LPE_TIMEOUT_MS = 3000;
    const lpePromise = runLpe(siteId, date, { hour: busyHour });
    const lpeOrTimeout = await Promise.race([
      lpePromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LPE_TIMEOUT_MS)),
    ]);
    const lpe = lpeOrTimeout;
    if (lpe && lpe.actions.length) {
      // Group LPE's idle_priority + active_cio for the same (from→to, sector)
      // pair into a single user-facing layer_move action.
      const grouped = new Map<string, typeof lpe.actions>();
      for (const a of lpe.actions) {
        const key = `${a.sector}|${a.fromBand}|${a.toBand}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(a);
      }
      for (const [key, group] of grouped) {
        const [sector, fromBand, toBand] = key.split('|');
        const idlePart = group.find((a) => a.kind === 'idle_priority');
        const activePart = group.find((a) => a.kind === 'active_cio');
        const fromPrb = lpe.baseline.find((b) => b.band === fromBand && b.sector === sector)?.pressure.P_L;
        const toPrb = lpe.baseline.find((b) => b.band === toBand && b.sector === sector)?.pressure.P_L;
        actions.push({
          kind: 'layer_move',
          title: `Sector ${sector}: balance ${fromBand} → ${toBand}`,
          rationale:
            `LPE gradient: ${fromBand} pressure ${(idlePart?.pressureBefore ?? 0).toFixed(2)} vs ${toBand} target (lower). ` +
            (activePart ? `Apply +${activePart.delta} dB CIO and bump reselection priority by ${idlePart?.delta ?? 1}.` : ''),
          confidence: (idlePart?.pressureBefore ?? 0) - (idlePart?.pressureAfter ?? 0) > 0.1 ? 'high' : 'medium',
          layerMove: {
            fromBand,
            toBand,
            bhPeakPrb: Math.round(offenderBhPrb),
            note: 'LPE solver',
          },
          params: [
            ...(idlePart ? [{
              paramName: 'cellReselectionPriority',
              scope: `${toBand} sector ${sector}`,
              change: `Increase by ${idlePart.delta} step${idlePart.delta === 1 ? '' : 's'}`,
              description: 'Idle-mode reselection priority on the destination band.',
              impact: 'Higher priority → capable idle UEs reselect onto this band before the next session.',
            }] : []),
            ...(activePart ? [{
              paramName: 'cellIndividualOffset',
              scope: `${toBand} sector ${sector}`,
              change: `+${activePart.delta} dB toward ${toBand}`,
              description: 'Per-neighbour offset biasing active-mode handover decisions.',
              impact: '5% active-share shift per dB (empirical).',
            }] : []),
          ],
          evidence: [
            `Source ${fromBand}: ${Math.round((fromPrb ?? 0) * 100)}% PRB-load pressure`,
            `Destination ${toBand}: ${Math.round((toPrb ?? 0) * 100)}% PRB-load pressure`,
            ...lpe.notes,
          ],
        });
      }
    } else if (lpe && lpe.notes.length) {
      // LPE ran but had nothing to do — surface the reason if the site is single-band.
      logger.info(`[congestion-strategy] LPE: ${lpe.notes.join(' · ')}`);
    } else if (!lpe) {
      logger.info(`[congestion-strategy] LPE skipped (timed out after 3s) for site ${siteId}`);
    }
  } catch (err) {
    logger.warn('[congestion-strategy] LPE solver failed; skipping layer-move action', err);
  }
  logger.info(`[congestion-strategy] full plan built in ${Date.now() - tStart}ms`);

  // Action 3 — soft-fix capacity hint
  actions.push({
    kind: 'capacity',
    title: 'If soft fixes don’t clear the BH within 7 days, schedule a capacity add',
    rationale:
      `Persistent organic load at ~${Math.round(offenderBhPrb)}% PRB during ${formatHour(busyHour)} is approaching a hard ceiling. ` +
      'Carrier-aggregation or a new sector is the long-term answer.',
    confidence: 'low',
  });

  // Run the action simulator on every action so the card can show predicted
  // KPI deltas. Pure analytical model — no DB cost.
  const simCtx: SimContext = {
    offenderBhPrb,
    loadShedNeighbors: candidates.slice(0, 3).map((c) => ({
      usid: c.neighborUsid,
      prb: c.neighborPrb,
      currentHoShare: c.currentHoShare,
    })),
    layerMove: { fromPrb: offenderBhPrb, toPrb: 22 },
  };
  for (const action of actions) {
    action.simulation = simulateAction(action, simCtx);
  }

  return {
    headline: candidates.length
      ? `Traffic-driven congestion at ${formatHour(busyHour)} (~${Math.round(offenderBhPrb)}% PRB). Shed load to ${candidates.slice(0, 3).map((c) => `NEIGH ${c.neighborUsid}`).join(', ')} and consider a layer rebalance.`
      : `Traffic-driven congestion at ${formatHour(busyHour)} — neighbour headroom is limited; capacity add is the likely path.`,
    confidence: (candidates[0]?.headroomPp ?? 0) >= 15 ? 'high' : 'medium',
    actions,
  };
}

// ─── Cosmetic helpers ───────────────────────────────────────────────────────

function formatHour(h: number | null): string {
  if (h == null) return 'busy hour';
  const hh = String(h).padStart(2, '0');
  return `${hh}:00`;
}

function inferBand(rows: HourlyPrbRow[]): string | null {
  // Take a small sample of cell names and look for band signatures.
  const sample = rows.slice(0, 25).map((r) => String(r.cell_name || '')).join(' ').toUpperCase();
  if (/\bAWS\b|_1700\b/.test(sample)) return 'AWS 1700';
  if (/\bPCS\b|_1900\b/.test(sample)) return 'PCS 1900';
  if (/_700\b|LOWBAND/.test(sample)) return 'Lowband 700';
  if (/N77|N78|C[-_]?BAND/.test(sample)) return '5G C-band';
  return null;
}
