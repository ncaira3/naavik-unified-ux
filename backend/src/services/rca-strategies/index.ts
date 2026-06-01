/**
 * RCA Strategy dispatcher.
 *
 * Maps a precomputed `rca_bucket` (which is a JSON blob in site_table — we
 * parse it here) to one of seven per-family strategies. Each strategy
 * returns a structured `StrategyOutput` the orchestrator turns into a
 * `recommendation_card` UI block.
 *
 * Strategy library:
 *   congestion         — traffic_balancer + layer_balancer (real algorithm)
 *   coverage           — tilt + power playbook
 *   outage             — neighbour-tilt compensation playbook
 *   interference       — power-control / re-tune playbook
 *   config-change      — revert + validate (also seeds DataDict param plan)
 *   hardware-transport — escalate playbook
 *   planned-maintenance— no-op + ETA
 *   default            — generic "investigate" plan when nothing matches
 */
import { logger } from '../../utils/logger.js';
import type { RecommendedAction, StrategyContext, StrategyOutput } from './types.js';
import { buildCongestionStrategy } from './congestion.strategy.js';
import { runOutageTilt } from './outage-tilt.js';
import { simulateAction, type SimContext } from './action-simulator.js';

// ─── Bucket-name normaliser (handles JSON, mixed-case, separators) ──────────

export interface ParsedBucket {
  /** Canonical name as it appears in `rca_bucket.text` or the column value. */
  name: string;
  /** Confidence of the primary bucket, 0..1. */
  confidence?: number;
  /** Ranked alternatives the upstream classifier also considered. */
  alternatives: Array<{ bucket: string; confidence: number }>;
  /** Family inferred from the bucket name — drives strategy dispatch. */
  family: BucketFamily;
}

export type BucketFamily =
  | 'congestion'
  | 'coverage'
  | 'outage'
  | 'interference'
  | 'config-change'
  | 'hardware'
  | 'software'
  | 'transport'
  | 'power'
  | 'planned-maintenance'
  | 'low-throughput'
  | 'unknown';

/**
 * Site_table.rca_bucket can be a JSON blob like:
 *   {"text":"CONGESTION - TRAFFIC INCREASE - SITE",
 *    "details":[{"bucket":"CONGESTION - TRAFFIC INCREASE - SITE","confidence":0.73},
 *               {"bucket":"UPLINK INTERFERENCE","confidence":0.20}]}
 * or just a plain string. Handle both.
 */
export function parseRcaBucket(raw: unknown): ParsedBucket {
  const empty: ParsedBucket = { name: 'Unknown', alternatives: [], family: 'unknown' };
  if (!raw) return empty;
  const text = String(raw).trim();
  if (!text) return empty;

  // Try JSON parse first
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const obj = JSON.parse(text);
      const name = String(obj.text ?? obj.bucket ?? obj.primary ?? '').trim();
      const alternativesRaw = Array.isArray(obj.details) ? obj.details : Array.isArray(obj.categories) ? obj.categories : [];
      const alternatives = alternativesRaw
        .map((a: any) => ({
          bucket: String(a?.bucket ?? a?.text ?? '').trim(),
          confidence: Math.max(0, Math.min(1, Number(a?.confidence) || 0)),
        }))
        .filter((a: { bucket: string }) => a.bucket);
      const top = alternatives[0];
      const final = name || top?.bucket || 'Unknown';
      const confidence = alternatives.find((a: { bucket: string; confidence: number }) => a.bucket === final)?.confidence ?? top?.confidence;
      return { name: final, confidence, alternatives, family: inferFamily(final) };
    } catch {
      // fall through to plain-string path
    }
  }
  return { name: text, alternatives: [], family: inferFamily(text) };
}

function inferFamily(bucketName: string): BucketFamily {
  const n = String(bucketName).toLowerCase();
  if (/congestion|traffic increase|high user|rrc users/.test(n)) return 'congestion';
  if (/coverage|coverage degradation|low throughput.*coverage/.test(n)) return 'coverage';
  if (/outage/.test(n)) return 'outage';
  if (/interference|uplink rssi/.test(n)) return 'interference';
  if (/configuration change|config change/.test(n)) return 'config-change';
  if (/hardware/.test(n)) return 'hardware';
  if (/software/.test(n)) return 'software';
  if (/transport/.test(n)) return 'transport';
  if (/power/.test(n)) return 'power';
  if (/planned maintenance|planned outage/.test(n)) return 'planned-maintenance';
  if (/low throughput|low tput|throughput/.test(n)) return 'low-throughput';
  return 'unknown';
}

// ─── Outage strategy (uses outage_tilt_optimizer) ───────────────────────────

async function buildOutageStrategy(ctx: StrategyContext): Promise<StrategyOutput> {
  let plan: Awaited<ReturnType<typeof runOutageTilt>>;
  try {
    plan = await runOutageTilt(ctx.siteId, ctx.date);
  } catch (err) {
    logger.warn('[outage-strategy] runOutageTilt failed; falling back to generic playbook', err);
    return {
      headline: 'Outage — verify the cell is up and tilt-compensate from neighbours during the recovery window.',
      confidence: 'medium',
      actions: [
        { kind: 'escalate', title: 'Open a hardware/transport ticket for the affected cell', rationale: 'Confirm the cell is down at the eNB / gNB and dispatch O&M if needed.', confidence: 'high' },
        { kind: 'monitor', title: 'Watch HOSR on neighbours during recovery', rationale: 'Confirm load transfer is healthy — no drop spikes on the absorbing cells.' },
      ],
    };
  }

  const actions: RecommendedAction[] = [
    {
      kind: 'escalate',
      title: 'Open a hardware/transport ticket for the affected cell',
      rationale: 'Confirm the cell is down at the eNB / gNB and dispatch O&M.',
      confidence: 'high',
    },
  ];

  for (const c of plan.candidates) {
    actions.push({
      kind: 'tilt',
      title: `Tilt neighbour ${c.usid} (${c.cellName}) toward outage area`,
      rationale: c.rationale,
      confidence: c.score >= 0.7 ? 'high' : c.score >= 0.5 ? 'medium' : 'low',
      tilt: {
        cellName: c.cellName,
        currentDeg: c.currentTiltDeg,
        deltaDeg: c.deltaTiltDeg,
        reason: `Aligned ${c.azimuthOffsetDeg}° from outage bearing; ${c.expectedCoverageExtensionM} m coverage extension.`,
      },
      params: [{
        paramName: 'ELECTRICALANTENNATILT',
        scope: c.cellName,
        change: `${c.currentTiltDeg}° → ${c.recommendedNewTiltDeg}° (Δ ${c.deltaTiltDeg}°)`,
        description: 'Electrical down-tilt; reducing it widens the footprint.',
        impact: `Extends usable coverage ~${c.expectedCoverageExtensionM} m toward the outage centre.`,
      }],
      evidence: [
        `Bearing to outage: ${c.bearingToOutageDeg}°, sector misalignment ${c.azimuthOffsetDeg}°`,
        `Distance: ${c.distanceM} m`,
        `Current PRB load: ${c.currentAvgPrb.toFixed(0)}%`,
      ],
    });
  }

  if (!plan.candidates.length) {
    actions.push({
      kind: 'monitor',
      title: 'No tilt-compensating neighbour found',
      rationale: plan.notes[0] ?? 'No neighbour is within the 60° main-lobe cone and below the PRB ceiling.',
      confidence: 'medium',
    });
  }

  actions.push({
    kind: 'validate',
    title: 'After recovery, revert any tilt changes',
    rationale: 'Outage-compensation tilts are temporary. Restore baseline tilts once the affected cells are back up.',
    confidence: 'medium',
  });

  // Run simulator with tilt context.
  const simCtx: SimContext = {
    tilt: plan.candidates[0]
      ? {
          neighborPrb: plan.candidates[0].currentAvgPrb / 100,
          coverageExtensionM: plan.candidates[0].expectedCoverageExtensionM,
        }
      : undefined,
  };
  for (const a of actions) a.simulation = simulateAction(a, simCtx);

  return {
    headline: plan.candidates.length
      ? `Outage at ${ctx.siteId} — ${plan.candidates.length} neighbour${plan.candidates.length === 1 ? '' : 's'} can tilt to extend coverage.`
      : `Outage at ${ctx.siteId} — no neighbour can compensate; immediate O&M dispatch required.`,
    confidence: plan.candidates[0]?.score >= 0.7 ? 'high' : 'medium',
    actions,
  };
}

// ─── Strategy library ───────────────────────────────────────────────────────

async function genericPlaybook(family: BucketFamily, ctx: StrategyContext): Promise<StrategyOutput> {
  switch (family) {
    case 'coverage':
      return {
        headline: 'Coverage degradation — tilt and power adjustments are the primary levers.',
        confidence: 'medium',
        actions: [
          {
            kind: 'tilt',
            title: 'Reduce electrical antenna tilt on the affected sector',
            rationale:
              'Coverage shrunk after a recent tilt-up or footprint change. Bringing the tilt down 1-3° widens the cell.',
            params: [{ paramName: 'ELECTRICALANTENNATILT', change: 'Decrease by 1-3°', impact: 'Lower tilt → wider footprint, can also raise interference.' }],
          },
          {
            kind: 'power',
            title: 'Verify configured Tx power on the affected cell',
            rationale: 'Confirm CONFIGUREDMAXTXPOWER and MAXIMUMTRANSMISSIONPOWER haven\'t been lowered recently.',
            params: [{ paramName: 'CONFIGUREDMAXTXPOWER' }, { paramName: 'MAXIMUMTRANSMISSIONPOWER' }],
          },
          { kind: 'monitor', title: 'Re-measure RSRP/RSRQ over 24 h after the change', rationale: 'Validate the fix without committing further changes.' },
        ],
      };
    case 'outage':
      return await buildOutageStrategy(ctx);
    case 'interference':
      return {
        headline: 'Uplink interference — re-check uplink power control and verify PRACH / PCI plan.',
        confidence: 'medium',
        actions: [
          { kind: 'power', title: 'Re-tune uplink power control', rationale: 'Adjust p0NominalPusch / alpha if the offender shows persistent high RSSI floor.', params: [{ paramName: 'p0NominalPusch' }, { paramName: 'alpha' }] },
          { kind: 'escalate', title: 'Confirm no external interference source nearby', rationale: 'High UL RSSI without UE traffic suggests an external emitter; site visit or scan may be required.' },
        ],
      };
    case 'config-change':
      return {
        headline: 'Configuration change detected — revert and validate.',
        confidence: 'high',
        actions: [
          {
            kind: 'revert',
            title: 'Revert the recent configuration change on the affected MO',
            rationale: 'Roll back the offending parameter to its prior value and observe the impact for one busy hour.',
          },
          { kind: 'validate', title: 'Validate KPIs after revert', rationale: 'Check the degraded KPI cluster (drop, throughput, accessibility) clears within one BH.' },
        ],
      };
    case 'hardware':
    case 'software':
    case 'transport':
      return {
        headline: `${capitalise(family)} issue — escalate to operations.`,
        confidence: 'medium',
        actions: [
          { kind: 'escalate', title: `Open a ${family} ticket`, rationale: 'No software-controllable lever; route to the right O&M team with the RCA attached.' },
          { kind: 'monitor', title: 'Track the ticket and re-evaluate after the fix', rationale: 'Re-run RCA after the maintenance window closes to confirm clearance.' },
        ],
      };
    case 'power':
      return {
        headline: 'Power-related issue — verify and bring back Tx power.',
        confidence: 'medium',
        actions: [
          { kind: 'power', title: 'Check CONFIGUREDMAXTXPOWER / MAXIMUMTRANSMISSIONPOWER on the affected cell', rationale: 'Most power-class RCAs trace to a recent power reduction that needs reversal.', params: [{ paramName: 'CONFIGUREDMAXTXPOWER' }, { paramName: 'MAXIMUMTRANSMISSIONPOWER' }] },
        ],
      };
    case 'planned-maintenance':
      return {
        headline: 'Planned maintenance — no action required.',
        confidence: 'high',
        actions: [{ kind: 'monitor', title: 'Wait for the maintenance window to close, then re-run RCA', rationale: 'Degradation is expected and clears on its own.' }],
      };
    case 'low-throughput':
      return {
        headline: 'Throughput degradation — investigate scheduling / interference first, then layer balance.',
        confidence: 'medium',
        actions: [
          { kind: 'monitor', title: 'Inspect MAC scheduling and DL_PKTLOSS_RT for the busy hour', rationale: 'Throughput drops usually trace to either PRB exhaustion or packet loss on the air interface.' },
          { kind: 'layer_move', title: 'Consider layer balance toward a less-loaded carrier', rationale: 'If lower-band is congested, biasing toward the mid/high band can recover per-user throughput.' },
        ],
      };
    case 'unknown':
    default:
      return {
        headline: `RCA bucket "${ctx.bucketName}" is unmapped — surfacing the chain-of-thought for engineer review.`,
        confidence: 'low',
        actions: [
          { kind: 'monitor', title: 'Review chain-of-thought and re-classify', rationale: 'No automated playbook matched this bucket. The reasoning narrative is below.' },
        ],
        freeText: ctx.solutionText || ctx.reasoning,
      };
  }
}

// ─── Public entry ───────────────────────────────────────────────────────────

// ─── Strategy cache ─────────────────────────────────────────────────────────
// Strategy outputs are deterministic given (siteId, date, parsed bucket name).
// Caching them for 15 min eliminates the strategy's heaviest cost — the LPE
// solver + outage_tilt_optimizer both do DB round-trips — when the chat agent
// re-asks the same RCA in quick succession (very common in a session).
const STRATEGY_CACHE_TTL_MS = 15 * 60 * 1000;
interface CacheEntry { fetchedAt: number; out: StrategyOutput; }
const strategyCache = new Map<string, CacheEntry>();
function cacheKey(ctx: StrategyContext, parsedName: string): string {
  return `${ctx.siteId}|${ctx.date}|${parsedName}`;
}

export async function buildStrategy(ctx: StrategyContext): Promise<StrategyOutput> {
  const parsed = parseRcaBucket(ctx.bucketName);
  const key = cacheKey(ctx, parsed.name);
  const cached = strategyCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < STRATEGY_CACHE_TTL_MS) {
    logger.info(`[rca-strategy] cache HIT ${key}`);
    return cached.out;
  }

  // Use the parsed family for routing; the strategy still receives the raw
  // bucket name and the full context.
  const family = parsed.family;
  const t0 = Date.now();
  logger.info(`[rca-strategy] dispatch family=${family} bucket="${parsed.name}" site=${ctx.siteId} ${ctx.date}`);

  let out: StrategyOutput;
  try {
    if (family === 'congestion') {
      out = await buildCongestionStrategy({ ...ctx, bucketName: parsed.name });
    } else {
      out = await genericPlaybook(family, { ...ctx, bucketName: parsed.name });
    }
  } catch (err) {
    logger.warn(`[rca-strategy] family=${family} failed; falling back to generic`, err);
    out = await genericPlaybook(family, { ...ctx, bucketName: parsed.name });
  }

  // Ensure EVERY action carries a simulation block — congestion + outage already
  // set their own; here we backfill for the generic playbook families.
  const emptyCtx: SimContext = {};
  for (const a of out.actions) {
    if (!a.simulation) a.simulation = simulateAction(a, emptyCtx);
  }
  strategyCache.set(key, { fetchedAt: Date.now(), out });
  logger.info(`[rca-strategy] family=${family} built in ${Date.now() - t0}ms · ${out.actions.length} actions`);
  return out;
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
