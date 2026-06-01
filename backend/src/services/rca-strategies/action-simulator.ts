/**
 * Action Simulator — predicts KPI deltas for a proposed RecommendedAction.
 *
 * Port of services/recommender/docs/TOOLS.md §Tool 10. Trades accuracy for
 * latency: a fast analytical model that runs in <50 ms per action. The
 * outcome_tracker (spec §10.3) would refine these curves nightly; for now
 * we use the documented heuristics.
 *
 * The simulator never hits the database — it consumes the strategy's own
 * context (busy-hour PRB, current pressure, etc.) which the caller passes in.
 * Keeping it pure lets us scale to many actions without query cost.
 */

import type { RecommendedAction } from './types.js';

export interface PredictedDelta {
  /** Short label rendered on the card chip. */
  label: string;
  /** Value before the action ("88% PRB"). */
  before: string;
  /** Value after the action ("76% PRB"). */
  after: string;
  /** Signed delta as a percent or absolute string ("-12 pp", "+18%"). */
  delta: string;
  /** Direction the engineer wants — green = improvement, amber = trade-off, red = degradation. */
  tone: 'green' | 'amber' | 'red';
}

export interface ActionSimulation {
  /** 0..1 — how confident the simulator is in the prediction. */
  confidence: number;
  /** Ordered list of KPI projections to show on the card. */
  predicted: PredictedDelta[];
  /** Short summary of the assumptions baked into the projection. */
  basedOn: string;
}

// ─── Simulation context the caller passes in ────────────────────────────────

export interface SimContext {
  /** Offender busy-hour PRB (0..100). Used by load_shed / layer_move models. */
  offenderBhPrb?: number;
  /** Per-neighbour state at busy hour for load_shed simulation. */
  loadShedNeighbors?: Array<{
    usid: string;
    prb?: number;            // 0..100 — current PRB at BH
    currentHoShare?: number; // 0..1
  }>;
  /** Source/destination layer PRBs for a layer_move action. */
  layerMove?: { fromPrb?: number; toPrb?: number };
  /** Coverage extension (m) and current PRB (0..100) for tilt actions. */
  tilt?: { neighborPrb?: number; coverageExtensionM?: number };
}

// ─── Per-kind models ────────────────────────────────────────────────────────

/**
 * Empirical curve from the TOOLS.md spec: 1 dB ≈ 4-6% active-share shift,
 * with diminishing returns above 4 dB. We use 5% per dB up to 3 dB, then
 * 3% per dB to 6 dB. Applied to the offender's PRB at BH.
 */
function activeCioShareShift(deltaDb: number): number {
  const cap = Math.min(6, Math.max(0, deltaDb));
  if (cap <= 3) return cap * 0.05;
  return 0.15 + (cap - 3) * 0.03;
}

function simulateLoadShed(action: RecommendedAction, ctx: SimContext): ActionSimulation {
  const bhPrb = clamp01((ctx.offenderBhPrb ?? 0) / 100);
  const shed = action.loadShed ?? [];
  if (!shed.length || bhPrb <= 0) {
    return emptySim('Insufficient data to project load-shed impact.');
  }

  // Total share shift = sum of per-neighbour CIO contributions, capped at
  // 35% of the offender's current PRB so we don't predict overflow.
  let totalShift = 0;
  for (const n of shed) {
    const contribution = activeCioShareShift(Number(n.deltaDb) || 0);
    // Weight by neighbour headroom — if a neighbour can only absorb 5pp,
    // their CIO can't move more than that even on paper.
    const headroomPp = (n.neighborPrbHeadroom ?? 10) / 100;
    totalShift += Math.min(contribution, headroomPp);
  }
  totalShift = Math.min(0.35, totalShift);

  const newPrb = clamp01(bhPrb - totalShift);
  const neighborsAfter = shed.map((n) => {
    const cur = (n.neighborPrbHeadroom != null)
      ? clamp01(0.75 - n.neighborPrbHeadroom / 100)   // back-out current PRB from headroom assuming 0.75 ceiling
      : 0.50;
    const took = totalShift / Math.max(1, shed.length);
    return { usid: n.neighborUsid, before: cur, after: clamp01(cur + took) };
  });

  // Throughput estimate — when PRB drops from saturation toward 70%, avg
  // user throughput rebounds roughly linearly. Approximation: 1 pp PRB
  // relief in the 80-92% band ≈ 2-3% user-tput recovery.
  const reliefPp = Math.max(0, (bhPrb - newPrb) * 100);
  const tputGainPct = Math.min(60, Math.round(reliefPp * 2.5));

  const predicted: PredictedDelta[] = [
    {
      label: 'Offender PRB at BH',
      before: `${Math.round(bhPrb * 100)}%`,
      after: `${Math.round(newPrb * 100)}%`,
      delta: `${(newPrb - bhPrb) >= 0 ? '+' : ''}${Math.round((newPrb - bhPrb) * 100)} pp`,
      tone: 'green',
    },
    {
      label: 'Avg user throughput (site)',
      before: 'baseline',
      after: `+${tputGainPct}%`,
      delta: `+${tputGainPct}%`,
      tone: 'green',
    },
  ];
  // Highlight the most-loaded absorbing neighbour as a trade-off line so the
  // engineer sees we're not freezing them.
  if (neighborsAfter.length) {
    const worst = neighborsAfter.reduce((a, b) => (b.after > a.after ? b : a));
    predicted.push({
      label: `Neighbour ${worst.usid} PRB`,
      before: `${Math.round(worst.before * 100)}%`,
      after: `${Math.round(worst.after * 100)}%`,
      delta: `+${Math.round((worst.after - worst.before) * 100)} pp`,
      tone: worst.after >= 0.7 ? 'amber' : 'green',
    });
  }

  return {
    confidence: shed.length >= 2 ? 0.72 : 0.6,
    predicted,
    basedOn: '5% active share per dB CIO · neighbour-headroom cap · 24h hourly PRB curve',
  };
}

function simulateLayerMove(action: RecommendedAction, ctx: SimContext): ActionSimulation {
  const fromPrb = clamp01((ctx.layerMove?.fromPrb ?? ctx.offenderBhPrb ?? 0) / 100);
  const toPrb = clamp01((ctx.layerMove?.toPrb ?? 0.2));
  if (fromPrb <= 0) return emptySim('No source-layer PRB available for layer-move simulation.');

  // Idle-priority + CIO together shift ~12-22% of users to a higher band,
  // per the LPE worked example. Approximate as 15% absolute shift.
  const shift = 0.15;
  const newFrom = clamp01(fromPrb - shift);
  const newTo = clamp01(toPrb + shift);

  const tputGainPct = Math.round(((fromPrb - newFrom) * 100) * 1.6);

  return {
    confidence: 0.65,
    predicted: [
      {
        label: 'Source layer PRB',
        before: `${Math.round(fromPrb * 100)}%`,
        after: `${Math.round(newFrom * 100)}%`,
        delta: `${Math.round((newFrom - fromPrb) * 100)} pp`,
        tone: 'green',
      },
      {
        label: 'Destination layer PRB',
        before: `${Math.round(toPrb * 100)}%`,
        after: `${Math.round(newTo * 100)}%`,
        delta: `+${Math.round((newTo - toPrb) * 100)} pp`,
        tone: newTo > 0.65 ? 'amber' : 'green',
      },
      {
        label: 'Avg user throughput (site)',
        before: 'baseline',
        after: `+${tputGainPct}%`,
        delta: `+${tputGainPct}%`,
        tone: 'green',
      },
    ],
    basedOn: 'LPE worked example · ~15% absolute UE shift to higher band',
  };
}

function simulateTilt(action: RecommendedAction, ctx: SimContext): ActionSimulation {
  const cur = clamp01((ctx.tilt?.neighborPrb ?? 0.5));
  const extension = ctx.tilt?.coverageExtensionM ?? 200;
  // Reducing downtilt extends coverage but pulls a small extra load — model
  // as +3pp PRB per 100m extension, bounded by 12pp.
  const extraPp = Math.min(0.12, (extension / 100) * 0.03);
  const after = clamp01(cur + extraPp);

  return {
    confidence: 0.55,
    predicted: [
      {
        label: 'Neighbour PRB after tilt',
        before: `${Math.round(cur * 100)}%`,
        after: `${Math.round(after * 100)}%`,
        delta: `+${Math.round(extraPp * 100)} pp`,
        tone: after >= 0.7 ? 'amber' : 'green',
      },
      {
        label: 'Coverage extension',
        before: '—',
        after: `${extension} m`,
        delta: `+${extension} m`,
        tone: 'green',
      },
    ],
    basedOn: 'Empirical: ~3 pp PRB per 100 m extended reach',
  };
}

function simulatePower(action: RecommendedAction, _ctx: SimContext): ActionSimulation {
  const deltaDb = action.power?.deltaDb ?? 0;
  if (!deltaDb) return emptySim('No power delta provided.');
  // 1 dB tx-power → ~10% range² → ~5% effective coverage population.
  const popPct = Math.round(Math.abs(deltaDb) * 5);
  return {
    confidence: 0.45,
    predicted: [
      {
        label: 'Coverage population',
        before: 'baseline',
        after: deltaDb > 0 ? `+${popPct}%` : `-${popPct}%`,
        delta: deltaDb > 0 ? `+${popPct}%` : `-${popPct}%`,
        tone: deltaDb > 0 ? 'green' : 'amber',
      },
    ],
    basedOn: '~5% coverage-pop shift per dB Tx-power',
  };
}

function simulateMonitor(): ActionSimulation {
  return {
    confidence: 1,
    predicted: [{ label: 'No predicted KPI delta', before: '—', after: '—', delta: '—', tone: 'green' }],
    basedOn: 'Observation step — KPIs unchanged until follow-up action.',
  };
}

// ─── Public entry ───────────────────────────────────────────────────────────

export function simulateAction(action: RecommendedAction, ctx: SimContext): ActionSimulation {
  switch (action.kind) {
    case 'load_shed':   return simulateLoadShed(action, ctx);
    case 'layer_move':  return simulateLayerMove(action, ctx);
    case 'tilt':        return simulateTilt(action, ctx);
    case 'power':       return simulatePower(action, ctx);
    case 'monitor':
    case 'validate':    return simulateMonitor();
    case 'revert':
      return {
        confidence: 0.7,
        predicted: [{ label: 'Restore baseline KPI cluster', before: 'degraded', after: 'pre-change baseline', delta: 'recovery', tone: 'green' }],
        basedOn: 'Empirical: reverts within one BH window typically restore the affected KPIs.',
      };
    case 'escalate':
      return {
        confidence: 0.4,
        predicted: [{ label: 'Recovery ETA', before: '—', after: 'pending O&M dispatch', delta: '—', tone: 'amber' }],
        basedOn: 'External dependency — no KPI projection.',
      };
    case 'capacity':
      return {
        confidence: 0.5,
        predicted: [{ label: 'Long-term PRB ceiling', before: 'rising', after: '+1 carrier of headroom', delta: '+33%', tone: 'green' }],
        basedOn: 'Adding a carrier expands the per-sector PRB envelope by ~33% on a 3-sector cell.',
      };
    default:
      return emptySim('No simulator for this action kind.');
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function emptySim(why: string): ActionSimulation {
  return { confidence: 0, predicted: [], basedOn: why };
}
