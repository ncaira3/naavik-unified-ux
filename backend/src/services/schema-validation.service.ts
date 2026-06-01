/**
 * Schema Validation — pre-flight gate for tool inputs
 *
 * Runs before any data-fetching tool to validate that:
 *   - KPI names exist in the live DB schema (dbSchemaRef)
 *   - Or, failing that, match something in the DataDict (Ericsson EIAP)
 *
 * Returns one of:
 *   - { kind: 'ok', resolved }                 — proceed with execution
 *   - { kind: 'clarify', candidates }          — ambiguous, ask user
 *   - { kind: 'unknown', input }               — hard miss, reject
 *
 * Used by query_data, show_kpi_dashboard, get_hourly_trends, and any tool
 * that takes a KPI/parameter name from the user.
 */
import { dbSchemaRef } from './db-schema-reference.service.js';
import { dataDictResolver } from './datadict-resolver.service.js';
import type { UiBlockSuggestion } from './agent-tools.registry.js';

export interface KpiCandidate {
  value: string;
  label: string;
  confidence: number;
  source: 'db-schema' | 'datadict';
  note?: string;
}

export type KpiResolution =
  | { kind: 'ok'; resolved: string; source: 'exact' | 'fuzzy-high-confidence' }
  | { kind: 'clarify'; input: string; candidates: KpiCandidate[] }
  | { kind: 'unknown'; input: string };

// ─── String similarity ─────────────────────────────────────────────────────

function normalize(s: string): string {
  return String(s).toUpperCase().replace(/[\s\-./]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  // Token overlap
  const tokA = new Set(na.split('_').filter(Boolean));
  const tokB = new Set(nb.split('_').filter(Boolean));
  const intersection = [...tokA].filter((t) => tokB.has(t)).length;
  const union = new Set([...tokA, ...tokB]).size;
  const tokenScore = union > 0 ? intersection / union : 0;
  // Edit distance
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  const editScore = maxLen > 0 ? 1 - dist / maxLen : 0;
  return tokenScore * 0.55 + editScore * 0.45;
}

// ─── Main validator ────────────────────────────────────────────────────────

/**
 * Validate a single KPI name against the live schema + DataDict catalog.
 * Returns a resolution that the caller uses to either proceed or ask the
 * user to clarify.
 */
export function validateKpiName(input: string): KpiResolution {
  const raw = String(input || '').trim();
  if (!raw) return { kind: 'unknown', input: raw };

  const canonical = normalize(raw);
  const liveKpis = dbSchemaRef.getKpiNames();

  // 1. Exact match against live DB schema
  if (liveKpis.includes(canonical)) {
    return { kind: 'ok', resolved: canonical, source: 'exact' };
  }
  // Case-insensitive fallback
  const exactCi = liveKpis.find((k) => k.toUpperCase() === canonical);
  if (exactCi) return { kind: 'ok', resolved: exactCi, source: 'exact' };

  // 2. Fuzzy match against live DB schema
  const scored = liveKpis
    .map((k) => ({ name: k, score: similarity(canonical, k) }))
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score);

  // High-confidence single match → accept silently
  if (scored.length && scored[0].score >= 0.92) {
    return { kind: 'ok', resolved: scored[0].name, source: 'fuzzy-high-confidence' };
  }

  // Multiple candidates → ask the user
  if (scored.length) {
    const top = scored.slice(0, 3).map((s): KpiCandidate => ({
      value: s.name,
      label: s.name,
      confidence: s.score,
      source: 'db-schema',
    }));
    return { kind: 'clarify', input: raw, candidates: top };
  }

  // 3. Fall back to DataDict catalog (parameter, not necessarily a KPI)
  try {
    const matches = dataDictResolver.fuzzyMatch(canonical, { limit: 3, minScore: 0.55 });
    if (matches.length) {
      const candidates: KpiCandidate[] = matches.map((m) => ({
        value: m.paramName,
        label: m.paramName,
        confidence: m.score,
        source: 'datadict',
        note: m.description ? `parameter: ${String(m.description).slice(0, 80)}` : 'parameter — not a chartable KPI',
      }));
      return { kind: 'clarify', input: raw, candidates };
    }
  } catch { /* DataDict not loaded — ignore */ }

  // 4. Nothing found
  return { kind: 'unknown', input: raw };
}

/**
 * Build a `chips` UI block prompting the user to disambiguate.
 * The chip value is a follow-up prompt that re-invokes the tool with the
 * corrected KPI name. The user clicks a chip and the conversation resumes.
 */
export function buildKpiClarifyChips(
  input: string,
  candidates: KpiCandidate[],
  originalQuery: string,
): UiBlockSuggestion {
  const chips = candidates.map((c) => ({
    label: c.label,
    value: originalQuery.replace(new RegExp(input, 'i'), c.value),
    description: c.note || `${Math.round(c.confidence * 100)}% match`,
  }));
  chips.push({
    label: 'None of these — let me clarify',
    value: `I meant something else, not ${input}`,
    description: 'Type your full question',
  });
  return {
    type: 'chips',
    title: 'Did you mean…',
    data: {
      prompt: `I don't have a KPI named "${input}" exactly. Pick the closest match:`,
      chips,
    },
  };
}

/**
 * Build a callout for the "unknown KPI" case — no candidates worth showing.
 */
export function buildKpiUnknownCallout(input: string): UiBlockSuggestion {
  return {
    type: 'callout',
    data: {
      tone: 'warning',
      title: `No KPI matches "${input}"`,
      text:
        `I don't have a KPI named "${input}" in the database, and nothing in the parameter catalog is close enough to be a useful suggestion. ` +
        `Try a full KPI name like DL_DRB_TPUT, DATA_RAN_ACC, HOSR, or DL_PKTLOSS_RT.`,
    },
  };
}
