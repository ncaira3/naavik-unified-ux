/**
 * Recommendation Enricher
 *
 * Takes a `RcaSiteResult` (from rca-live.service) and produces a structured
 * "change plan" the frontend can render — one entry per network parameter
 * the RCA agent suggested touching, with DataDict metadata bolted on.
 *
 * Inputs we mine for parameter mentions:
 *   - rcaResult.solutionText        (the RCA service's `short_justification`)
 *   - rcaResult.reasoning           (full rca_thinker output, when available)
 *   - rcaResult.solutionCategory    (the solution type the RCA service named)
 *
 * Sources we enrich from:
 *   1. dataDictResolver — 16k Ericsson EIAP entries with description + dataType
 *   2. services/rca/artifacts/details.json — per-RCA-category `parameter_info`
 *      blocks with `possible_change` and `possible_impact`
 *
 * Important: this is inspection-only. We do NOT push any change to provision.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { dataDictResolver } from './datadict-resolver.service.js';
import type { RcaSiteResult } from './rca-live.service.js';

// ─── Types the frontend consumes ────────────────────────────────────────────

export interface ParameterPlan {
  paramName: string;
  /** Cell/sector/site this would apply to, if extractable. */
  scope?: string;
  /** From RCA text — e.g. "Increase" / "Decrease" / "Set to LOCKED". */
  direction?: string;
  /** Best-effort numeric delta if the RCA text said e.g. "by 2 dB". */
  deltaText?: string;
  /** From DataDict: short description of what the parameter means. */
  description?: string;
  /** From details.json: typical operational impact of changing it. */
  possibleImpact?: string;
  /** From details.json: how the value can change (e.g. "LOCKED <-> UNLOCKED"). */
  possibleChange?: string;
  /** From DataDict: SQL type / range hint. */
  dataType?: string;
  /** Where each field came from — gives the engineer a citation trail. */
  sources: Array<'rca-text' | 'datadict' | 'rca-knowledge'>;
}

export interface RecommendationPlan {
  category?: string;                  // e.g. "Coverage Degradation" — comes from buckets[0]
  confidenceLevel?: 'high' | 'medium' | 'low';
  headline?: string;                  // 1-line "what to do" derived from solutionText
  reasoning?: string;                 // full rca_thinker narrative
  parameters: ParameterPlan[];        // one entry per identified parameter
  /** Per-family strategy actions — populated by services/rca-strategies. */
  actions?: import('./rca-strategies/types.js').RecommendedAction[];
  /** Alternative buckets the upstream classifier also considered. */
  alternatives?: Array<{ bucket: string; confidence: number }>;
  /** Free-text fallback when no parameters could be extracted. */
  freeText?: string;
}

/**
 * Normalise a bucket / category name so we can match cross-source variants:
 *   "Configuration Change Neighbor Site" → "configurationchangeneighborsite"
 *   "configuration_change_neighbor_site" → "configurationchangeneighborsite"
 *   "Coverage Degradation"                → "coveragedegradation"
 * The site_table.rca_bucket column uses a slightly different convention than
 * the details.json keys; this collapse strips both apart so they match.
 */
function normalizeBucket(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// ─── Load services/rca/artifacts/details.json once ──────────────────────────

interface CategoryKnowledge {
  knowledge?: string;
  parameter_info?: Record<
    string,
    {
      description?: string;
      possible_change?: string;
      possible_impact?: string;
    }
  >;
}

let knowledgeByCategory: Record<string, CategoryKnowledge> = {};
let knowledgeLoaded = false;
let knowledgeIndex: Map<string, { category: string; info: NonNullable<CategoryKnowledge['parameter_info']>[string] }> = new Map();
/** Same payload, keyed by normalized bucket name for O(1) lookup from the rca_bucket column. */
let knowledgeByBucketNorm: Map<string, CategoryKnowledge> = new Map();

async function ensureKnowledge(): Promise<void> {
  if (knowledgeLoaded) return;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, '..', '..', '..', 'services', 'rca', 'artifacts', 'details.json'),
    path.join(process.cwd(), 'services', 'rca', 'artifacts', 'details.json'),
    path.join(process.cwd(), '..', 'services', 'rca', 'artifacts', 'details.json'),
  ];
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, 'utf-8');
      knowledgeByCategory = JSON.parse(raw);
      // Build a name -> { category, info } index for O(1) lookups.
      for (const [category, payload] of Object.entries(knowledgeByCategory)) {
        knowledgeByBucketNorm.set(normalizeBucket(category), payload);
        const info = payload?.parameter_info;
        if (!info) continue;
        for (const [name, entry] of Object.entries(info)) {
          if (!knowledgeIndex.has(name.toUpperCase())) {
            knowledgeIndex.set(name.toUpperCase(), { category, info: entry });
          }
        }
      }
      knowledgeLoaded = true;
      logger.info(`[rec-enricher] loaded RCA category knowledge from ${p} (${knowledgeIndex.size} params indexed)`);
      return;
    } catch { /* try next candidate */ }
  }
  logger.warn('[rec-enricher] services/rca/artifacts/details.json not found — running without RCA category knowledge');
  knowledgeLoaded = true;
}

// ─── Parameter extraction ───────────────────────────────────────────────────

const ALL_CAPS_PARAM_RE = /\b[A-Z][A-Z0-9_]{2,}\b/g;        // ELECTRICALANTENNATILT, RRC_FAIL
const CAMEL_PARAM_RE    = /\b(?:[a-z]+[A-Z][a-zA-Z0-9]*)\b/g; // qRxLevMin, cellIndividualOffset

/**
 * Scan the RCA's text payload for parameter mentions. Two passes:
 *   1. ALL_CAPS_WITH_UNDERSCORES — Ericsson EIAP convention.
 *   2. camelCase — 3GPP convention (qRxLevMin, sIntraSearch, etc.).
 *
 * Each candidate is verified against the DataDict; unknown tokens are dropped
 * so we don't surface every random ALL_CAPS word in the RCA narrative.
 */
function extractParameterTokens(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const re of [ALL_CAPS_PARAM_RE, CAMEL_PARAM_RE]) {
    const matches = text.matchAll(re);
    for (const m of matches) {
      const tok = m[0];
      const norm = tok.toUpperCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      // Filter out obvious noise — common English ALL-CAPS words and short tokens.
      if (NOISE_TOKENS.has(norm)) continue;
      out.push(tok);
    }
  }
  return out;
}

const NOISE_TOKENS = new Set([
  'RCA', 'KPI', 'LTE', 'NR', 'DL', 'UL', 'PRB', 'RAN', 'OSS', 'HOSR', 'CQX',
  'USID', 'CELL', 'SITE', 'OK', 'YES', 'NO', 'TBD', 'TODO', 'NOTE', 'API',
  'HTTP', 'JSON', 'CSV', 'SQL', 'AND', 'OR', 'NOT', 'FOR', 'WITH', 'FROM',
  'THE', 'BY', 'IS', 'ARE', 'WAS', 'WERE', 'IN', 'ON', 'AT', 'TO',
  // Common but not-actually-a-parameter telecom acronyms that show up in
  // RCA prose and would otherwise pollute the recommendation card.
  'RSRP', 'RSRQ', 'SINR', 'CQI', 'PCI', 'TAC',
]);

// ─── Direction & delta extraction ───────────────────────────────────────────

function extractDirection(text: string, paramName: string): { direction?: string; deltaText?: string } {
  // Look in a small window around the parameter mention for verbs/deltas.
  const idx = text.toUpperCase().indexOf(paramName.toUpperCase());
  if (idx < 0) return {};
  const start = Math.max(0, idx - 90);
  const end = Math.min(text.length, idx + paramName.length + 90);
  const ctx = text.slice(start, end);

  // Direction
  let direction: string | undefined;
  if (/\b(increase|raise|boost|bump|push up)\b/i.test(ctx)) direction = 'Increase';
  else if (/\b(decrease|reduce|lower|drop|push down|trim)\b/i.test(ctx)) direction = 'Decrease';
  else if (/\b(lock|locked)\b/i.test(ctx)) direction = 'Lock';
  else if (/\b(unlock|unlocked)\b/i.test(ctx)) direction = 'Unlock';
  else if (/\b(disable|turn off)\b/i.test(ctx)) direction = 'Disable';
  else if (/\b(enable|turn on)\b/i.test(ctx)) direction = 'Enable';
  else if (/\b(set\s+to|change\s+to)\b/i.test(ctx)) direction = 'Set';
  else if (/\b(revert|roll\s*back|restore)\b/i.test(ctx)) direction = 'Revert';

  // Delta — numeric magnitude with optional unit
  let deltaText: string | undefined;
  const deltaMatch = ctx.match(/by\s+(-?\d+(?:\.\d+)?\s*(?:dB|deg|degrees?|°|%|dBm)?)/i);
  if (deltaMatch) deltaText = deltaMatch[1].trim();
  else {
    const toMatch = ctx.match(/to\s+(-?\d+(?:\.\d+)?\s*(?:dB|deg|degrees?|°|%|dBm)?)/i);
    if (toMatch) deltaText = `→ ${toMatch[1].trim()}`;
  }

  return { direction, deltaText };
}

function extractScope(text: string, paramName: string): string | undefined {
  // Scan for "on site <id>" / "neighbor <id>" / "cell <name>" near the param.
  const idx = text.toUpperCase().indexOf(paramName.toUpperCase());
  if (idx < 0) return undefined;
  const start = Math.max(0, idx - 120);
  const end = Math.min(text.length, idx + paramName.length + 120);
  const ctx = text.slice(start, end);
  const onSite = ctx.match(/\b(?:on|at|for)\s+(?:site|usid)\s+([A-Za-z0-9_-]{2,})/i);
  if (onSite) return `Site ${onSite[1]}`;
  const onCell = ctx.match(/\b(?:on|at|for)\s+cell\s+([A-Za-z0-9_-]{2,})/i);
  if (onCell) return `Cell ${onCell[1]}`;
  const onNeighbor = ctx.match(/\bneighbor(?:ing)?\s+(?:site\s+)?([A-Za-z0-9_-]{2,})/i);
  if (onNeighbor) return `Neighbor ${onNeighbor[1]}`;
  return undefined;
}

// ─── Confidence bucketing ───────────────────────────────────────────────────

function pickConfidenceLevel(buckets: RcaSiteResult['buckets']): RecommendationPlan['confidenceLevel'] {
  if (!buckets.length) return undefined;
  const top = buckets[0].confidence;
  if (top >= 0.7) return 'high';
  if (top >= 0.45) return 'medium';
  return 'low';
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface EnrichOpts {
  /**
   * When the precomputed RCA path supplies a `rca_bucket` (or the live RCA's
   * top bucket), pass it here so we can pull the matching parameter knowledge
   * from `details.json` even when the chain_of_thought text doesn't name
   * specific parameters. The lookup is order-independent — handles both
   * "Configuration Change Neighbor Site" and "configuration_change_neighbor_site".
   */
  bucketHint?: string;
}

export async function enrichRecommendation(
  rca: RcaSiteResult,
  opts: EnrichOpts = {},
): Promise<RecommendationPlan> {
  await ensureKnowledge();

  if (rca.status === 'no_degradation') {
    return {
      headline: 'No degradation detected — no parameter changes recommended.',
      parameters: [],
    };
  }
  if (rca.status === 'error') {
    return {
      headline: rca.error ? `RCA failed: ${rca.error}` : 'RCA failed.',
      parameters: [],
    };
  }

  const corpus = [rca.solutionText ?? '', rca.reasoning ?? '', rca.solutionCategory ?? '']
    .filter(Boolean)
    .join('\n');

  const params: ParameterPlan[] = [];
  const seen = new Set<string>();

  // Pass 1 — parameters EXPLICITLY mentioned in the RCA text. We require an
  // EXACT DataDict match here on purpose — fuzzy matching scoops up random
  // 3GPP-looking tokens from the chain_of_thought narrative (`n`, `qci`,
  // `rrcConnReestActive`) and renders them as if they were the recommendation.
  // If the RCA narrative wants to name a parameter, it can spell it exactly.
  for (const tok of extractParameterTokens(corpus)) {
    const norm = tok.toUpperCase();
    if (seen.has(norm)) continue;
    // Drop too-short / pure-numeric / single-letter tokens. They produce noise.
    if (tok.length < 4) continue;
    if (/^\d+$/.test(tok)) continue;
    const dd = dataDictResolver.findExact(tok);
    const knowledge = knowledgeIndex.get(norm);
    if (!dd && !knowledge) continue;
    seen.add(norm);

    const { direction, deltaText } = extractDirection(corpus, tok);
    const scope = extractScope(corpus, tok);

    const sources: ParameterPlan['sources'] = [];
    if (corpus.toUpperCase().includes(norm)) sources.push('rca-text');
    if (dd) sources.push('datadict');
    if (knowledge) sources.push('rca-knowledge');

    params.push({
      paramName: dd?.paramName ?? tok,
      scope,
      direction,
      deltaText,
      description: dd?.description ?? knowledge?.info?.description,
      possibleImpact: knowledge?.info?.possible_impact,
      possibleChange: knowledge?.info?.possible_change,
      dataType: dd?.dataType,
      sources,
    });
  }

  // Pass 2 — when a `bucketHint` is supplied (precomputed RCA path), pull the
  // bucket's entire parameter_info catalogue. Add anything the chain_of_thought
  // didn't already name as "candidates" — useful for engineers eyeballing
  // which parameters tend to matter for this RCA class. Marked source-of-truth
  // as 'rca-knowledge' only.
  const bucketSource = opts.bucketHint ?? rca.solutionCategory ?? rca.buckets[0]?.bucket;
  if (bucketSource) {
    const bucketPayload = knowledgeByBucketNorm.get(normalizeBucket(bucketSource));
    const pInfo = bucketPayload?.parameter_info ?? {};
    for (const [name, info] of Object.entries(pInfo)) {
      const norm = name.toUpperCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      const dd = dataDictResolver.findExact(name);
      const sources: ParameterPlan['sources'] = ['rca-knowledge'];
      if (dd) sources.push('datadict');
      params.push({
        paramName: dd?.paramName ?? name,
        // No scope / direction in this pass — these are "candidates" from
        // the bucket's library, not specifically called out by the RCA.
        description: dd?.description ?? info.description,
        possibleImpact: info.possible_impact,
        possibleChange: info.possible_change,
        dataType: dd?.dataType,
        sources,
      });
    }
  }

  const headline = (rca.solutionText && rca.solutionText.length > 4)
    ? rca.solutionText
    : (rca.solutionCategory
      ? `Recommended: ${rca.solutionCategory}.`
      : bucketSource
        ? `Recommended action class: ${bucketSource}.`
        : 'See reasoning below.');

  return {
    category: rca.buckets[0]?.bucket ?? bucketSource,
    confidenceLevel: pickConfidenceLevel(rca.buckets),
    headline,
    reasoning: rca.reasoning || undefined,
    parameters: params,
    freeText: params.length === 0 ? (rca.solutionText || undefined) : undefined,
  };
}
