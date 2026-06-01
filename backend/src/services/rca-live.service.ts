/**
 * Live RCA — HTTP client for the services/rca FastAPI on `RCA_SERVICE_URL`.
 *
 *   POST /api/rca/run-live  { siteId, date? }   → blocking call to RCA pipeline
 *
 * Adds:
 *   - 15-minute in-memory result cache keyed by (siteId, date)
 *   - Short-circuit fallback that reads `cqx_offenders_truth_table.chain_of_thought`
 *     when the live service is unreachable or returns nothing
 *   - Structured "RcaSiteResult" shape the chat tool / UI consumes
 *
 * The downstream service is slow (30-120s typical, multi-process pipeline).
 * Callers should expect long timeouts; the orchestrator's MAX_ITERATIONS is
 * not affected by this — the agent treats this as a normal tool call.
 */
import { logger } from '../utils/logger.js';
import { pool } from '../config/database.js';

// ─── Shapes mirrored from services/rca/pipeline.py output ───────────────────

/**
 * One bucket from the rca_thinker classifier. Confidence is 0..1.
 * The pipeline returns an array of these per site.
 */
export interface RcaBucket {
  bucket: string;
  confidence: number;
}

/**
 * Compact, frontend-friendly result for one site.
 * The raw pipeline payload is much larger — we keep the original under `raw`
 * so the enricher can mine it for parameter mentions later.
 */
export interface RcaSiteResult {
  siteId: string;
  date: string;
  status: 'success' | 'error' | 'no_degradation';
  /** Headline narrative — comes from the rca_thinker LLM output. */
  reasoning: string;
  /** Ranked root-cause categories with confidence. */
  buckets: RcaBucket[];
  /** The solution node's `short_justification` + `category` if present. */
  solutionText?: string;
  solutionCategory?: string;
  /** Map of intuition_name → free-text response from each intuition. */
  intuitions: Record<string, string>;
  /** Original pipeline payload — kept for enrichment / debugging. */
  raw?: Record<string, any>;
  error?: string;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
  fetchedAt: number;
  result: RcaSiteResult;
}
const cache = new Map<string, CacheEntry>();

function cacheKey(siteId: string, date: string): string {
  return `${siteId}|${date}`;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function todayMinus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function sanitizeDate(d?: string): string {
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return todayMinus(3);
}

function sanitizeSiteId(id: string): string {
  return String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
}

function extractReasoning(sitePayload: any): string {
  // The pipeline doesn't expose rca_thinker output under a single fixed key
  // — it lives in `messages[-1].content` of the LangGraph state. Try a few
  // plausible places and fall back to the short_summary.
  const candidates = [
    sitePayload?.rca_thinker_response,
    sitePayload?.rca_reasoning,
    sitePayload?.short_summary?.summary,
    sitePayload?.short_summary?.text,
    sitePayload?.short_summary,
    sitePayload?.messages?.[sitePayload.messages.length - 1]?.content,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 20) return c.trim();
    if (c && typeof c === 'object' && typeof (c as any).text === 'string') {
      return String((c as any).text).trim();
    }
  }
  return '';
}

function extractBuckets(sitePayload: any): RcaBucket[] {
  const raw = sitePayload?.rca_bucket_with_confidence?.categories;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => ({
      bucket: String(c?.bucket ?? '').trim(),
      confidence: Math.max(0, Math.min(1, Number(c?.confidence) || 0)),
    }))
    .filter((c) => c.bucket)
    .sort((a, b) => b.confidence - a.confidence);
}

function extractSolution(sitePayload: any): { solutionText?: string; solutionCategory?: string } {
  const s = sitePayload?.solution_recommendation;
  if (!s || typeof s !== 'object') return {};
  return {
    solutionText: typeof s.short_justification === 'string' ? s.short_justification.trim() : undefined,
    solutionCategory: typeof s.category === 'string' ? s.category.trim() : undefined,
  };
}

function extractIntuitions(sitePayload: any): Record<string, string> {
  const i = sitePayload?.intuitions;
  if (!i || typeof i !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [name, val] of Object.entries(i)) {
    if (typeof val === 'string') out[name] = val;
    else if (val && typeof val === 'object') {
      // Most intuitions return { applicable, response } — keep the prose.
      const v = val as any;
      const txt = v.response ?? v.text ?? v.summary ?? '';
      if (txt) out[name] = String(txt);
    }
  }
  return out;
}

// ─── Mirror fallback ────────────────────────────────────────────────────────

/**
 * Read the precomputed RCA for a site from `mirror.site_table` — the table
 * that actually carries `chain_of_thought`, `rca_bucket`, and `short_summary`
 * (not `cqx_offenders_truth_table` which only has the impact scores).
 *
 * 30-day window so a stale mirror still produces SOMETHING. Returns the
 * freshest available row on or before the requested date.
 */
async function fetchMirrorRca(siteId: string, date: string): Promise<RcaSiteResult | null> {
  try {
    const r = await pool.query(
      `SELECT
         usid AS "USID",
         date_id::date::text AS date_id,
         chain_of_thought,
         rca_bucket,
         short_summary
       FROM mirror.site_table
       WHERE usid = $1
         AND chain_of_thought IS NOT NULL
         AND date_id::date <= $2::date
         AND date_id::date >= ($2::date - INTERVAL '30 days')
       ORDER BY date_id::date DESC
       LIMIT 1`,
      [siteId, date],
    );
    if (!r.rowCount) return null;
    const row = r.rows[0];
    const reasoning = String(row?.chain_of_thought ?? '').trim();
    if (!reasoning) return null;
    const bucketRaw = row?.rca_bucket;
    // rca_bucket can be JSON ({text, details}) or a plain string — be tolerant.
    let bucketName = '';
    let bucketConf = 0;
    try {
      if (typeof bucketRaw === 'string' && bucketRaw.startsWith('{')) {
        const parsed = JSON.parse(bucketRaw);
        bucketName = String(parsed?.text ?? parsed?.bucket ?? '').trim();
        bucketConf = Number(parsed?.details?.[0]?.confidence) || 0;
      } else {
        bucketName = String(bucketRaw ?? '').trim();
      }
    } catch { bucketName = String(bucketRaw ?? '').trim(); }

    const dateUsed = String(row.date_id).slice(0, 10);
    logger.info(`[rca-live] mirror fallback served ${siteId} ${dateUsed} (requested ${date})`);
    return {
      siteId,
      date: dateUsed,
      status: 'success',
      reasoning,
      buckets: bucketName ? [{ bucket: bucketName, confidence: bucketConf || 0.85 }] : [],
      solutionText: String(row?.short_summary ?? '').trim() || undefined,
      solutionCategory: bucketName || undefined,
      intuitions: {},
      raw: { source: 'mirror.site_table', dateRequested: date, dateUsed },
    };
  } catch (err) {
    logger.warn('[rca-live] mirror fallback query failed', err);
    return null;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface RunLiveOpts {
  siteId: string;
  date?: string;
  /** When true, bypass the in-memory cache. */
  fresh?: boolean;
}

export async function runLiveRca(opts: RunLiveOpts): Promise<RcaSiteResult> {
  const siteId = sanitizeSiteId(opts.siteId);
  const date = sanitizeDate(opts.date);

  if (!siteId) {
    return {
      siteId: '',
      date,
      status: 'error',
      reasoning: '',
      buckets: [],
      intuitions: {},
      error: 'siteId is required',
    };
  }

  // 1. Cache
  const key = cacheKey(siteId, date);
  if (!opts.fresh) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.fetchedAt < TTL_MS) {
      logger.info(`[rca-live] cache HIT ${key}`);
      return hit.result;
    }
  }

  // 2. Live call
  const base = (process.env.RCA_SERVICE_URL || 'http://localhost:9444').replace(/\/+$/, '');
  const url = `${base}/api/systems/rca/agentic-pipeline`;
  const timeoutMs = Math.max(30_000, Number(process.env.RCA_REQUEST_TIMEOUT_MS) || 180_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();

  let result: RcaSiteResult | null = null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ date, list_ids: [siteId] }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`RCA service returned ${res.status} ${res.statusText}`);
    }
    const payload: any = await res.json();
    // The service wraps everything in a `data` envelope of shape:
    //   { success, data: { results: { siteId: { ... } } } }
    // or returns the bare `{ results: ... }` — handle both.
    const envelope = payload?.data ?? payload;
    const sitePayload =
      envelope?.results?.[siteId] ??
      envelope?.[siteId] ??
      envelope;

    if (!sitePayload || typeof sitePayload !== 'object') {
      throw new Error('RCA service returned an empty payload');
    }
    if (sitePayload.status === 'error') {
      throw new Error(String(sitePayload.error ?? 'RCA pipeline reported an error'));
    }

    const reasoning = extractReasoning(sitePayload);
    const buckets = extractBuckets(sitePayload);
    const { solutionText, solutionCategory } = extractSolution(sitePayload);
    const intuitions = extractIntuitions(sitePayload);

    // If nothing useful came back, mark as no_degradation rather than error —
    // the agent will say so in chat (per design decision #5).
    const hasSignal =
      buckets.length > 0 ||
      Object.keys(intuitions).length > 0 ||
      reasoning.length > 0 ||
      !!solutionText;

    result = {
      siteId,
      date,
      status: hasSignal ? 'success' : 'no_degradation',
      reasoning,
      buckets,
      solutionText,
      solutionCategory,
      intuitions,
      raw: sitePayload,
    };
    logger.info(
      `[rca-live] ${siteId} ${date} → ${result.status} · ${Object.keys(intuitions).length} intuitions · ${Date.now() - t0}ms`,
    );
  } catch (err) {
    const message = (err as Error).message || 'unknown';
    logger.warn(`[rca-live] live call failed for ${siteId}: ${message}`);

    // 3. Mirror fallback
    const mirror = await fetchMirrorRca(siteId, date);
    if (mirror) {
      logger.info(`[rca-live] using mirror fallback for ${siteId} ${date}`);
      result = mirror;
    } else {
      result = {
        siteId,
        date,
        status: 'error',
        reasoning: '',
        buckets: [],
        intuitions: {},
        error: message,
      };
    }
  } finally {
    clearTimeout(timer);
  }

  // Cache success + no_degradation; skip errors so they retry next time.
  if (result.status !== 'error') {
    cache.set(key, { fetchedAt: Date.now(), result });
  }
  return result;
}

export function getRcaLiveCacheStats() {
  return { entries: cache.size };
}
